"use client";

/**
 * Suggested purchase orders — SRS §12.4, FR-PRC-022.
 *
 * The quantities come from reorder-point analysis (FR-INV-067): this screen
 * calls the same `suggestReorder` the inventory reorder screen uses, with the
 * same ledger, levels and forecast settings, so the two cannot disagree.
 *
 * What purchasing adds is the order: suggestions are grouped by preferred
 * supplier — the item's supplier ranking (FR-PRC-007) first, the item's
 * default supplier after — and by delivery location, priced from the supplier
 * price list (FR-PRC-006) where there is one, and presented for review. The
 * buyer can change a quantity, a price or a supplier, or leave a line out;
 * nothing becomes an order until they create it, and a created order then
 * routes through approval like any other.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import type { Id, IsoDate, PurchaseOrder, StockItem, StockLevel, StockLocation, Supplier, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ForecastSettings } from "@/lib/console/services/inventory-controls";
import { latestMovementAt, useLedger } from "@/lib/console/inventory-ledger";
import { dailyUsage, suggestReorder, type DemandEvent, type ReorderParameters } from "@/lib/console/inventory-reorder";
import { addIsoDays, seasonalEvents } from "@/lib/console/inventory-seasonality";
import { resolvePrice, tierForTotal, type ProcurementPolicy, type SupplierPriceEntry } from "@/lib/console/purchasing-rules";
import type { ItemSourcing } from "@/lib/console/services/purchasing-local";
import { isPositiveDecimal } from "@/lib/console/stock-units";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, money } from "@/lib/console/format";
import { MoneyInput } from "@/components/console/fields";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, EmptyPanel, Gate } from "@/components/console/states";
import { LedgerGate } from "@/components/console/inventory-ledger-panel";
import { useConfirm } from "@/components/console/confirm";
import { PRC_CURRENCY, useActor, usePolicy } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Card, Input, Select, Toast } from "@/components/console/ui";

interface Inputs {
  levels: StockLevel[];
  locations: StockLocation[];
  suppliers: Supplier[];
  settings: ForecastSettings;
  events: DemandEvent[];
  prices: SupplierPriceEntry[];
  rankings: ItemSourcing[];
}

interface DraftLine {
  key: string;
  itemId: Id;
  itemName: { en: string; ar: string };
  locationId: Id;
  locationName: { en: string; ar: string };
  unit: string;
  suggested: string;
  quantity: string;
  unitPriceMinor: number | null;
  supplierId: Id;
  include: boolean;
  fromPriceList: boolean;
}

export default function SuggestedOrdersPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <SuggestionsScreen />
    </Gate>
  );
}

function SuggestionsScreen() {
  const { t } = useI18n();
  const [message, setMessage] = useTransientMessage();
  const ledger = useLedger();
  const { policy } = usePolicy();
  const inputs = useAsync<Inputs>(async () => {
    const [levels, locations, suppliers, settings, events, prices, rankings] = await Promise.all([
      services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows),
      services.organisation.locations().catch(() => [] as StockLocation[]),
      services.purchasing.suppliers.list({ limit: 500 }).then((page) => page.rows),
      services.inventoryControls.forecast.settings(),
      services.inventoryControls.forecast.events(),
      services.procurement.priceEntries.all(),
      services.procurement.sourcing.all(),
    ]);
    return { levels, locations, suppliers, settings, events, prices, rankings };
  }, []);

  return (
    <>
      <PageHeader
        title={t("prc.suggest.title")}
        subtitle={t("prc.suggest.subtitle")}
        spec="FR-PRC-022"
        actions={
          <Link href="/inventory/reorder">
            <Button>{t("prc.suggest.openReorder")}</Button>
          </Link>
        }
      />
      <PageBody>
        <AsyncPanel state={inputs}>
          {(loaded) => (
            <LedgerGate state={ledger}>
              {(load) => {
                const latest = latestMovementAt(load.movements);
                const asOf: IsoDate = latest ? latest.slice(0, 10) : new Date().toISOString().slice(0, 10);
                return (
                  <SuggestionReview
                    inputs={loaded}
                    items={ledger.items}
                    movements={load.movements}
                    asOf={asOf}
                    policy={policy}
                    onCreated={(orders) => setMessage(t("prc.suggest.created").replace("{n}", String(orders.length)))}
                  />
                );
              }}
            </LedgerGate>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function parametersFor(item: StockItem | undefined, settings: ForecastSettings, suppliers: Supplier[], supplierId: Id | null): ReorderParameters {
  const overrides = item ? (settings.items[item.id] ?? {}) : {};
  const supplier = supplierId ? suppliers.find((row) => row.id === supplierId) : undefined;
  const supplierLead = settings.useSupplierLeadTime && supplier ? supplier.leadTimeDays : undefined;
  return { ...settings.defaults, ...(supplierLead !== undefined ? { leadTimeDays: supplierLead } : {}), ...overrides };
}

function SuggestionReview({
  inputs,
  items,
  movements,
  asOf,
  policy,
  onCreated,
}: {
  inputs: Inputs;
  items: StockItem[];
  movements: import("@/lib/console/types").StockMovement[];
  asOf: IsoDate;
  policy: ProcurementPolicy | null;
  onCreated: (orders: PurchaseOrder[]) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { tenant, scope } = useSession();
  const canRaise = usePermission("purchase.order.create");
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const [locationId, setLocationId] = useState<string>(scope.branchId ?? "all");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const rankingByItem = useMemo(() => new Map(inputs.rankings.map((row) => [row.itemId, row.supplierIds])), [inputs.rankings]);

  // FR-PRC-022 — reorder-point analysis (FR-INV-067), preferred supplier per item.
  useEffect(() => {
    const lookback = Math.max(inputs.settings.defaults.lookbackDays, ...Object.values(inputs.settings.items).map((row) => row.lookbackDays ?? 0));
    const seasons = seasonalEvents({
      country: tenant.countryCode,
      from: addIsoDays(asOf, -lookback - 1),
      to: addIsoDays(asOf, 500),
      multipliers: inputs.settings.multipliers,
      custom: inputs.settings.customSeasons,
    });
    const levels = locationId === "all" ? inputs.levels : inputs.levels.filter((level) => level.locationId === locationId);
    const next: DraftLine[] = [];
    for (const level of levels) {
      const item = itemById.get(level.itemId);
      const preferred = rankingByItem.get(level.itemId)?.[0] ?? item?.defaultSupplierId ?? null;
      const parameters = parametersFor(item, inputs.settings, inputs.suppliers, preferred);
      const suggestion = suggestReorder({
        itemId: level.itemId,
        itemName: level.itemName,
        locationId: level.locationId,
        locationName: level.locationName,
        unit: level.onHand.unit,
        onHand: Number(level.onHand.value),
        onOrder: Number(level.onOrder.value),
        shelfLifeDays: item?.expiryTracked ? item.shelfLifeDays : null,
        supplierId: preferred,
        unitCostMinor: level.unitCost.amount,
        history: dailyUsage(movements, { itemId: level.itemId, locationId: level.locationId, asOf, lookbackDays: parameters.lookbackDays }),
        parameters,
        asOf,
        seasons,
        demandEvents: inputs.events,
        reorderPoint: level.reorderPoint,
        reorderQuantity: level.reorderQuantity,
      });
      if (suggestion.suggested <= 0) continue;
      const quantity = String(suggestion.suggested);
      const price = preferred ? resolvePrice(inputs.prices, preferred, level.itemId, level.onHand.unit as UnitCode, quantity, asOf) : null;
      next.push({
        key: `${level.itemId}|${level.locationId}`,
        itemId: level.itemId,
        itemName: level.itemName,
        locationId: level.locationId,
        locationName: level.locationName,
        unit: level.onHand.unit,
        suggested: quantity,
        quantity,
        unitPriceMinor: price?.unitPriceMinor ?? level.unitCost.amount,
        supplierId: preferred ?? "",
        include: Boolean(preferred),
        fromPriceList: Boolean(price),
      });
    }
    setLines(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, movements, asOf, locationId]);

  function patch(key: string, part: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...part } : line)));
  }

  function changeSupplier(line: DraftLine, supplierId: Id) {
    const price = supplierId ? resolvePrice(inputs.prices, supplierId, line.itemId, line.unit as UnitCode, line.quantity, asOf) : null;
    patch(line.key, {
      supplierId,
      include: Boolean(supplierId) && line.include,
      unitPriceMinor: price?.unitPriceMinor ?? line.unitPriceMinor,
      fromPriceList: Boolean(price),
    });
  }

  const groups = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const line of lines) {
      const key = `${line.supplierId}|${line.locationId}`;
      map.set(key, [...(map.get(key) ?? []), line]);
    }
    return [...map.entries()]
      .map(([key, rows]) => ({
        key,
        supplierId: rows[0]!.supplierId,
        locationId: rows[0]!.locationId,
        locationName: rows[0]!.locationName,
        rows,
        valueMinor: rows.filter((row) => row.include).reduce((sum, row) => sum + Math.round(Number(row.quantity || 0) * (row.unitPriceMinor ?? 0)), 0),
      }))
      .sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || b.valueMinor - a.valueMinor);
  }, [lines]);

  const included = lines.filter((line) => line.include);
  const invalid = included.filter((line) => !line.supplierId || !isPositiveDecimal(line.quantity) || !(line.unitPriceMinor && line.unitPriceMinor > 0));
  const creatable = groups.filter((group) => group.supplierId && group.rows.some((row) => row.include));
  const locations = [...new Map(inputs.levels.map((level) => [level.locationId, level.locationName])).entries()];

  async function create() {
    const ok = await confirm({
      title: t("prc.suggest.confirmTitle"),
      body: t("prc.suggest.confirmBody").replace("{n}", String(creatable.length)),
      confirmLabel: t("prc.suggest.create"),
      tone: "neutral",
    });
    if (!ok) return;
    await action.run(
      async () => {
        const created: PurchaseOrder[] = [];
        for (const group of creatable) {
          const supplier = inputs.suppliers.find((row) => row.id === group.supplierId);
          const location = inputs.locations.find((row) => row.id === group.locationId);
          const orderLines = group.rows
            .filter((row) => row.include)
            .map((row, index) => ({
              id: `pol_${index + 1}`,
              itemId: row.itemId,
              itemName: row.itemName,
              quantity: { value: row.quantity, unit: row.unit as UnitCode },
              receivedQuantity: { value: "0", unit: row.unit as UnitCode },
              unitPrice: money(row.unitPriceMinor ?? 0, PRC_CURRENCY),
              taxRate: 0,
              lineTotal: money(Math.round(Number(row.quantity) * (row.unitPriceMinor ?? 0)), PRC_CURRENCY),
            }));
          const total = orderLines.reduce((sum, line) => sum + line.lineTotal.amount, 0);
          const tier = tierForTotal(total);
          const autoApproved = tier === 0 || (policy ? !policy.steps.poApproval : false);
          let order = await services.purchasing.orders.create({
            supplierId: group.supplierId,
            supplierName: supplier?.tradingName,
            deliveryLocationId: group.locationId,
            deliveryLocationName: location?.name ?? group.locationName,
            expectedDelivery: addIsoDays(new Date().toISOString().slice(0, 10), supplier?.leadTimeDays ?? 2),
            status: autoApproved ? "approved" : "pending_approval",
            approvalTier: tier,
            createdBy: { en: actor.name, ar: actor.name },
            lines: orderLines,
            subtotal: money(total, PRC_CURRENCY),
            taxTotal: money(0, PRC_CURRENCY),
            total: money(total, PRC_CURRENCY),
          });
          if (autoApproved && order.status !== "approved") {
            order = await services.purchasing.orders.update(order.id, { status: "approved", approvedAt: new Date().toISOString() });
          }
          await services.procurement.recordSubmission(order, actor, { source: "suggested" });
          created.push(order);
        }
        return created;
      },
      {
        onSuccess: (created) => {
          const done = new Set(creatable.map((group) => group.key));
          setLines((current) => current.filter((line) => !(line.include && done.has(`${line.supplierId}|${line.locationId}`))));
          onCreated(created);
        },
      },
    );
  }

  const supplierName = (id: Id) => tx(inputs.suppliers.find((row) => row.id === id)?.tradingName) || t("prc.suggest.noSupplier");

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("prc.suggest.note")}</Callout>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <TileGrid columns={3}>
        <MetricTile label={t("prc.suggest.lines")} value={formatNumber(lines.length, fmt)} spec="FR-PRC-022" />
        <MetricTile label={t("prc.suggest.orders")} value={formatNumber(creatable.length, fmt)} />
        <MetricTile
          label={t("prc.suggest.value")}
          value={formatMoney(money(groups.reduce((sum, group) => sum + (group.supplierId ? group.valueMinor : 0), 0), PRC_CURRENCY), fmt, true)}
        />
      </TileGrid>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-56">
          <Select value={locationId} onChange={(event) => setLocationId(event.target.value)} aria-label={t("common.location")}>
            <option value="all">{t("prc.suggest.allLocations")}</option>
            {locations.map(([id, name]) => (
              <option key={id} value={id}>
                {tx(name)}
              </option>
            ))}
          </Select>
        </div>
        {canRaise ? (
          <Button variant="primary" icon={<Sparkles size={14} />} loading={action.pending} disabled={creatable.length === 0 || invalid.length > 0} onClick={create}>
            {t("prc.suggest.create")}
          </Button>
        ) : null}
      </div>

      {invalid.length > 0 ? <Callout tone="warn">{t("prc.suggest.invalid").replace("{n}", String(invalid.length))}</Callout> : null}

      {lines.length === 0 ? (
        <EmptyPanel title={t("prc.suggest.emptyTitle")} body={t("prc.suggest.emptyBody")} />
      ) : (
        groups.map((group) => (
          <Card key={group.key}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-fg text-sm font-semibold">{group.supplierId ? supplierName(group.supplierId) : t("prc.suggest.noSupplier")}</p>
                <p className="text-fg-subtle text-xs">{tx(group.locationName)}</p>
              </div>
              <div className="flex items-center gap-2">
                {group.supplierId ? <Badge tone="accent">{t("prc.inbox.tier").replace("{n}", String(tierForTotal(group.valueMinor)))}</Badge> : null}
                <span className="font-mono text-sm tabular-nums">{formatMoney(money(group.valueMinor, PRC_CURRENCY), fmt)}</span>
              </div>
            </div>
            {!group.supplierId ? <Callout tone="warn">{t("prc.suggest.pickSupplier")}</Callout> : null}
            <ul className="divide-line divide-y">
              {group.rows.map((line) => (
                <li key={line.key} className="grid gap-2 py-2 sm:grid-cols-[auto_2fr_1fr_1fr_1.5fr] sm:items-center">
                  <input
                    type="checkbox"
                    aria-label={`${t("prc.suggest.include")} ${tx(line.itemName)}`}
                    checked={line.include}
                    disabled={!line.supplierId}
                    onChange={(event) => patch(line.key, { include: event.target.checked })}
                  />
                  <div className="min-w-0">
                    <p className="text-fg text-sm">{tx(line.itemName)}</p>
                    <p className="text-fg-subtle text-xs">
                      {t("prc.suggest.suggestedQty").replace("{qty}", `${line.suggested} ${line.unit}`)}
                      {line.fromPriceList ? ` · ${t("prc.suggest.listPrice")}` : ` · ${t("prc.suggest.lastCost")}`}
                    </p>
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    aria-label={`${t("common.quantity")} ${tx(line.itemName)}`}
                    value={line.quantity}
                    onChange={(event) => patch(line.key, { quantity: event.target.value })}
                    className="text-end font-mono tabular-nums"
                  />
                  <MoneyInput
                    value={line.unitPriceMinor}
                    currency={PRC_CURRENCY}
                    onChange={(minor) => patch(line.key, { unitPriceMinor: minor, fromPriceList: false })}
                    aria-label={`${t("doc.unitPrice")} ${tx(line.itemName)}`}
                  />
                  <Select value={line.supplierId} onChange={(event) => changeSupplier(line, event.target.value)} aria-label={`${t("pur.supplier")} ${tx(line.itemName)}`}>
                    <option value="">—</option>
                    {inputs.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {tx(supplier.tradingName)}
                        {rankingByItem.get(line.itemId)?.[0] === supplier.id ? " ★" : ""}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
