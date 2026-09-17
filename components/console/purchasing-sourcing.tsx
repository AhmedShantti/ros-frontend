"use client";

/**
 * Sourcing — SRS §12.3, FR-PRC-006, FR-PRC-007, FR-PRC-010, FR-PRC-011.
 *
 * Three questions an order has to answer before it is raised, and the screens
 * that hold the answers:
 *
 *   - What does this supplier charge? A price list per item, per unit and pack
 *     size, with a validity window and volume tiers (006). Overlapping windows
 *     for the same item are refused: two live prices is a guess, not a list.
 *   - Who else sells it, and in what order do we prefer them? A ranking per
 *     item, shown beside every supplier's price for the quantity (007).
 *   - May we buy this category from them at all? An approved-supplier list per
 *     category, warned or blocked per policy (010), and the supplier's
 *     compliance documents still in date (011).
 *
 * `OrderSourcingChecks` puts all three in front of the person raising an order.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";

import type { Id, Localised, StockItem, Supplier, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ComplianceDocument, ItemSourcing } from "@/lib/console/services/purchasing-local";
import {
  approvedSupplierVerdict,
  categoryKey,
  comparePrices,
  complianceState,
  isEntryValidOn,
  priceEntryProblems,
  resolvePrice,
  type ApprovedSupplierList,
  type ProcurementPolicy,
  type SupplierPriceEntry,
} from "@/lib/console/purchasing-rules";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDate, formatMoney, formatQuantity, money, unitLabel } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { MoneyInput, SearchSelect, type SearchOption } from "@/components/console/fields";
import { useConfirm, useConfirmDelete } from "@/components/console/confirm";
import { ExportButton } from "@/components/console/export-button";
import { EmptyPanel } from "@/components/console/states";
import { PRC_CURRENCY, useActor } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Drawer, Field, IconButton, Input, Select, cx } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// FR-PRC-006 — price list entry
// ---------------------------------------------------------------------------

interface TierDraft {
  key: string;
  minQuantity: string;
  priceMinor: number | null;
}

let tierSeq = 0;

export function PriceEntryDrawer({
  entry,
  open,
  suppliers,
  items,
  prefill,
  onClose,
  onSaved,
}: {
  entry: SupplierPriceEntry | null;
  open: boolean;
  suppliers: Supplier[];
  items: StockItem[];
  prefill?: { supplierId?: Id; itemId?: Id };
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const others = useAsync(() => services.procurement.priceEntries.all(), [open]);

  const [supplierId, setSupplierId] = useState<Id>("");
  const [itemId, setItemId] = useState<Id | null>(null);
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState<UnitCode>("pc");
  const [packSize, setPackSize] = useState("1");
  const [price, setPrice] = useState<number | null>(null);
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validTo, setValidTo] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setSupplierId(entry?.supplierId ?? prefill?.supplierId ?? "");
    setItemId(entry?.itemId ?? prefill?.itemId ?? null);
    setCode(entry?.supplierItemCode ?? "");
    setUnit(entry?.unit ?? items.find((row) => row.id === prefill?.itemId)?.baseUnit ?? "pc");
    setPackSize(entry?.packSize ?? "1");
    setPrice(entry?.priceMinor ?? null);
    setValidFrom(entry?.validFrom ?? todayIso());
    setValidTo(entry?.validTo ?? "");
    setTiers((entry?.tiers ?? []).map((tier) => ({ key: `t${(tierSeq += 1)}`, minQuantity: tier.minQuantity, priceMinor: tier.priceMinor })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const item = items.find((row) => row.id === itemId) ?? null;
  const unitChoices = useMemo<UnitCode[]>(() => {
    if (!item) return [unit];
    return [...new Set<UnitCode>([item.baseUnit, item.purchaseUnit, unit])];
  }, [item, unit]);

  const itemOptions = useMemo<SearchOption[]>(
    () => items.map((row) => ({ value: row.id, label: tx(row.name), hint: `${row.sku} · ${tx(row.category)}` })),
    [items, tx],
  );

  const draft = {
    id: entry?.id,
    supplierId,
    itemId: itemId ?? "",
    itemName: item?.name ?? entry?.itemName ?? { en: "", ar: "" },
    supplierItemCode: code.trim(),
    unit,
    packSize: packSize.trim(),
    priceMinor: price ?? 0,
    currency: PRC_CURRENCY,
    validFrom,
    validTo: validTo || null,
    tiers: tiers.map((tier) => ({ minQuantity: tier.minQuantity.trim(), priceMinor: tier.priceMinor ?? 0 })),
  };
  const problems = priceEntryProblems(draft, others.data ?? []);

  async function save() {
    if (problems.length > 0) return;
    const { id: _ignored, ...input } = draft;
    await action.run(() => services.procurement.savePriceEntry(input, entry?.id ?? null), {
      onSuccess: () => onSaved(entry ? t("prc.price.saved") : t("prc.price.created")),
    });
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={entry ? t("prc.price.edit") : t("prc.price.new")}
      subtitle="FR-PRC-006"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
            {entry ? t("common.save") : t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">—</option>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.price.item")} required>
            <SearchSelect
              options={itemOptions}
              value={itemId}
              onChange={(next) => {
                setItemId(next);
                const picked = items.find((row) => row.id === next);
                if (picked) setUnit(picked.baseUnit);
              }}
              aria-label={t("prc.price.item")}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("prc.price.unit")} hint={t("prc.price.unitHint")}>
            <Select value={unit} onChange={(event) => setUnit(event.target.value as UnitCode)}>
              {unitChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {unitLabel(choice, fmt.locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.price.packSize")} hint={t("prc.price.packSizeHint")} error={problems.includes("bad_pack") ? t("prc.priceProblem.bad_pack") : undefined}>
            <Input dir="ltr" inputMode="decimal" value={packSize} onChange={(event) => setPackSize(event.target.value)} className="text-end font-mono tabular-nums" />
          </Field>
          <Field label={t("prc.price.packPrice")} required>
            <MoneyInput value={price} currency={PRC_CURRENCY} onChange={setPrice} aria-label={t("prc.price.packPrice")} />
          </Field>
        </div>

        <Field label={t("prc.price.supplierCode")}>
          <Input dir="ltr" value={code} onChange={(event) => setCode(event.target.value)} className="font-mono" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("prc.price.validFrom")} required>
            <Input type="date" dir="ltr" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
          </Field>
          <Field label={t("prc.price.validTo")} hint={t("prc.price.validToHint")}>
            <Input type="date" dir="ltr" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
          </Field>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-fg text-sm font-semibold">{t("prc.price.tiers")}</h3>
              <p className="text-fg-subtle text-xs">{t("prc.price.tiersHint")}</p>
            </div>
            <Button
              size="sm"
              icon={<Plus size={12} />}
              onClick={() => setTiers((current) => [...current, { key: `t${(tierSeq += 1)}`, minQuantity: "", priceMinor: null }])}
            >
              {t("prc.price.addTier")}
            </Button>
          </div>
          {tiers.length === 0 ? (
            <p className="text-fg-subtle text-xs">{t("prc.price.noTiers")}</p>
          ) : (
            <ul className="space-y-2">
              {tiers.map((tier) => (
                <li key={tier.key} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label={t("prc.price.fromQuantity")}>
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        value={tier.minQuantity}
                        onChange={(event) =>
                          setTiers((current) => current.map((row) => (row.key === tier.key ? { ...row, minQuantity: event.target.value } : row)))
                        }
                        className="text-end font-mono tabular-nums"
                      />
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label={t("prc.price.packPrice")}>
                      <MoneyInput
                        value={tier.priceMinor}
                        currency={PRC_CURRENCY}
                        onChange={(minor) =>
                          setTiers((current) => current.map((row) => (row.key === tier.key ? { ...row, priceMinor: minor } : row)))
                        }
                        aria-label={t("prc.price.packPrice")}
                      />
                    </Field>
                  </div>
                  <IconButton
                    label={t("prc.price.removeTier")}
                    icon={<X size={14} />}
                    onClick={() => setTiers((current) => current.filter((row) => row.key !== tier.key))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {price && isPositivePack(packSize) ? (
          <Callout tone="muted">
            {t("prc.price.perUnitPreview")
              .replace("{price}", formatMoney(money(Math.round(price / Number(packSize)), PRC_CURRENCY), fmt))
              .replace("{unit}", unitLabel(unit, fmt.locale))}
          </Callout>
        ) : null}

        {problems.length > 0 ? (
          <ul className="text-bad space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {t(`prc.priceProblem.${problem}` as ConsoleKey)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

function isPositivePack(value: string): boolean {
  return Number(value) > 0;
}

// ---------------------------------------------------------------------------
// FR-PRC-006 — the list
// ---------------------------------------------------------------------------

export function PriceListTab({ suppliers, items }: { suppliers: Supplier[]; items: StockItem[] }) {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("supplier.manage");
  const confirmDelete = useConfirmDelete();
  const action = useAction();
  const [supplierFilter, setSupplierFilter] = useState("");
  const [editing, setEditing] = useState<SupplierPriceEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const entries = useAsync(() => services.procurement.priceEntries.all(), []);

  const supplierName = useMemo(() => new Map(suppliers.map((row) => [row.id, row.tradingName])), [suppliers]);
  const today = todayIso();
  const rows = (entries.data ?? []).filter((row) => !supplierFilter || row.supplierId === supplierFilter);

  const columns = useMemo<Column<SupplierPriceEntry>[]>(
    () => [
      {
        key: "item",
        header: t("prc.price.item"),
        render: (row) => <CellStack primary={tx(row.itemName)} secondary={row.supplierItemCode ? <span className="font-mono">{row.supplierItemCode}</span> : undefined} />,
      },
      { key: "supplier", header: t("pur.supplier"), render: (row) => tx(supplierName.get(row.supplierId) ?? { en: "—", ar: "—" }) },
      {
        key: "pack",
        header: t("prc.price.packSize"),
        secondary: true,
        render: (row) => formatQuantity({ value: row.packSize, unit: row.unit }, fmt),
      },
      { key: "price", header: t("prc.price.packPrice"), numeric: true, render: (row) => formatMoney(money(row.priceMinor, PRC_CURRENCY), fmt) },
      {
        key: "tiers",
        header: t("prc.price.tiers"),
        secondary: true,
        render: (row) => (row.tiers.length === 0 ? <span className="text-fg-subtle">—</span> : <Badge tone="accent">{row.tiers.length}</Badge>),
      },
      {
        key: "validity",
        header: t("prc.price.validity"),
        render: (row) => (
          <CellStack
            primary={`${formatDate(row.validFrom, fmt)} – ${row.validTo ? formatDate(row.validTo, fmt) : t("prc.price.openEnded")}`}
            secondary={
              isEntryValidOn(row, today) ? (
                <Badge tone="good">{t("prc.price.current")}</Badge>
              ) : row.validFrom > today ? (
                <Badge tone="accent">{t("prc.price.future")}</Badge>
              ) : (
                <Badge tone="muted">{t("prc.price.lapsed")}</Badge>
              )
            }
          />
        ),
      },
      {
        key: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        align: "end",
        render: (row) =>
          canManage ? (
            <div className="flex justify-end gap-1">
              <IconButton label={t("common.edit")} icon={<Pencil size={14} />} onClick={() => setEditing(row)} />
              <IconButton
                label={t("common.delete")}
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  if (!(await confirmDelete(tx(row.itemName)))) return;
                  await action.run(() => services.procurement.removePriceEntry(row.id), {
                    onSuccess: () => {
                      setNote(t("prc.price.deleted"));
                      entries.reload();
                    },
                  });
                }}
              />
            </div>
          ) : null,
      },
    ],
    [t, tx, fmt, supplierName, today, canManage, confirmDelete, action, entries],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-52">
          <Field label={t("pur.supplier")}>
            <Select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <ExportButton
            filename="supplier-price-list"
            title={t("prc.sourcing.tabPrices")}
            rows={rows}
            size="sm"
            columns={[
              { key: "supplier", header: t("pur.supplier"), value: (row) => tx(supplierName.get(row.supplierId) ?? { en: "", ar: "" }) },
              { key: "item", header: t("prc.price.item"), value: (row) => tx(row.itemName) },
              { key: "code", header: t("prc.price.supplierCode"), value: (row) => row.supplierItemCode },
              { key: "unit", header: t("prc.price.unit"), value: (row) => row.unit },
              { key: "pack", header: t("prc.price.packSize"), value: (row) => row.packSize },
              { key: "price", header: t("prc.price.packPrice"), value: (row) => (row.priceMinor / 100).toFixed(2) },
              { key: "from", header: t("prc.price.validFrom"), value: (row) => row.validFrom },
              { key: "to", header: t("prc.price.validTo"), value: (row) => row.validTo ?? "" },
              { key: "tiers", header: t("prc.price.tiers"), value: (row) => row.tiers.map((tier) => `${tier.minQuantity}+ @ ${(tier.priceMinor / 100).toFixed(2)}`).join("; ") },
            ]}
          />
          {canManage ? (
            <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => setCreating(true)}>
              {t("prc.price.new")}
            </Button>
          ) : null}
        </div>
      </div>

      {note ? <Callout tone="good">{note}</Callout> : null}
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={entries.loading}
        error={entries.error}
        onRetry={entries.reload}
        caption={t("prc.sourcing.tabPrices")}
        emptyTitle={t("prc.price.emptyTitle")}
        emptyBody={t("prc.price.emptyBody")}
        dense
      />

      <PriceEntryDrawer
        entry={editing}
        open={creating || Boolean(editing)}
        suppliers={suppliers}
        items={items}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          setCreating(false);
          setEditing(null);
          setNote(message);
          entries.reload();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-007 — supplier ranking with comparative pricing
// ---------------------------------------------------------------------------

export function SupplierRankingTab({ suppliers, items }: { suppliers: Supplier[]; items: StockItem[] }) {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("supplier.manage");
  const action = useAction();
  const [itemId, setItemId] = useState<Id | null>(null);
  const [quantity, setQuantity] = useState("1");
  const entries = useAsync(() => services.procurement.priceEntries.all(), []);
  const ranking = useAsync(
    () => (itemId ? services.procurement.sourcing.get(itemId) : Promise.resolve(null as ItemSourcing | null)),
    [itemId],
  );

  const item = items.find((row) => row.id === itemId) ?? null;
  const order = ranking.data?.supplierIds ?? [];
  const supplierById = useMemo(() => new Map(suppliers.map((row) => [row.id, row])), [suppliers]);
  const rows = useMemo(
    () => (item ? comparePrices(entries.data ?? [], order, item.id, item.baseUnit, quantity, todayIso()) : []),
    [item, entries.data, order, quantity],
  );
  const unranked = suppliers.filter((row) => row.active && !order.includes(row.id));

  async function setOrder(next: Id[]) {
    if (!itemId) return;
    await action.run(() => services.procurement.setRanking(itemId, next), { onSuccess: () => ranking.reload() });
  }

  function move(supplierId: Id, delta: number) {
    const index = order.indexOf(supplierId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void setOrder(next);
  }

  const options = useMemo<SearchOption[]>(
    () => items.map((row) => ({ value: row.id, label: tx(row.name), hint: `${row.sku} · ${tx(row.category)}` })),
    [items, tx],
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label={t("prc.price.item")}>
          <SearchSelect options={options} value={itemId} onChange={setItemId} aria-label={t("prc.price.item")} />
        </Field>
        <Field label={t("prc.rank.quantity")} hint={item ? unitLabel(item.baseUnit, fmt.locale) : undefined}>
          <Input dir="ltr" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="text-end font-mono tabular-nums" />
        </Field>
      </div>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {!item ? (
        <EmptyPanel compact title={t("prc.rank.pickItem")} body={t("prc.rank.pickItemBody")} />
      ) : rows.length === 0 ? (
        <EmptyPanel compact title={t("prc.rank.noSuppliers")} body={t("prc.rank.noSuppliersBody")} />
      ) : (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {rows.map((row) => {
            const supplier = supplierById.get(row.supplierId);
            return (
              <li key={row.supplierId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", row.rank === 1 ? "bg-accent text-accent-fg" : "bg-sunken text-fg-muted")}>
                  {row.rank ?? "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm">{supplier ? tx(supplier.tradingName) : row.supplierId}</p>
                  <p className="text-fg-subtle text-xs">
                    {row.price
                      ? `${formatMoney(money(row.price.unitPriceMinor, PRC_CURRENCY), fmt)} / ${unitLabel(row.price.entry.unit, fmt.locale)}${row.price.tier ? ` · ${t("prc.rank.tierApplied")}` : ""}`
                      : t("prc.rank.noPrice")}
                  </p>
                </div>
                {row.premiumMinor === 0 ? (
                  <Badge tone="good">{t("prc.rank.cheapest")}</Badge>
                ) : row.premiumMinor !== null ? (
                  <Badge tone="warn">+{formatMoney(money(row.premiumMinor, PRC_CURRENCY), fmt)}</Badge>
                ) : null}
                {canManage ? (
                  <div className="flex gap-1">
                    {row.rank !== null ? (
                      <>
                        <IconButton label={t("prc.rank.up")} icon={<ArrowUp size={14} />} disabled={row.rank === 1 || action.pending} onClick={() => move(row.supplierId, -1)} />
                        <IconButton label={t("prc.rank.down")} icon={<ArrowDown size={14} />} disabled={row.rank === order.length || action.pending} onClick={() => move(row.supplierId, 1)} />
                        <IconButton label={t("prc.rank.remove")} icon={<X size={14} />} disabled={action.pending} onClick={() => void setOrder(order.filter((id) => id !== row.supplierId))} />
                      </>
                    ) : (
                      <Button size="sm" disabled={action.pending} onClick={() => void setOrder([...order, row.supplierId])}>
                        {t("prc.rank.add")}
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {item && canManage && unranked.length > 0 ? (
        <Field label={t("prc.rank.addSupplier")} hint={t("prc.rank.addSupplierHint")}>
          <Select value="" onChange={(event) => event.target.value && void setOrder([...order, event.target.value])}>
            <option value="">—</option>
            {unranked.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.tradingName)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-010 — approved suppliers per category
// ---------------------------------------------------------------------------

export function ApprovedSuppliersTab({ suppliers, items }: { suppliers: Supplier[]; items: StockItem[] }) {
  const { t, tx } = useI18n();
  const canManage = usePermission("supplier.manage");
  const actor = useActor();
  const confirm = useConfirm();
  const action = useAction();
  const lists = useAsync(() => services.procurement.approvedLists.all(), []);
  const [editing, setEditing] = useState<Localised | null>(null);
  const [picked, setPicked] = useState<Id[]>([]);

  const categories = useMemo(() => {
    const seen = new Map<string, Localised>();
    for (const item of items) {
      const key = categoryKey(item.category);
      if (key && !seen.has(key)) seen.set(key, item.category);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const byKey = useMemo(() => new Map((lists.data ?? []).map((row) => [row.id, row])), [lists.data]);
  const supplierName = useMemo(() => new Map(suppliers.map((row) => [row.id, row.tradingName])), [suppliers]);

  function open(category: Localised) {
    setEditing(category);
    setPicked(byKey.get(categoryKey(category))?.supplierIds ?? []);
  }

  async function save() {
    if (!editing) return;
    const previous = byKey.get(categoryKey(editing))?.supplierIds ?? [];
    if (previous.length > 0 && picked.length === 0) {
      const ok = await confirm({
        title: t("prc.approved.clearTitle"),
        body: t("prc.approved.clearBody").replace("{category}", tx(editing)),
        confirmLabel: t("common.save"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await action.run(() => services.procurement.saveApprovedList(editing, picked, actor), {
      onSuccess: () => {
        setEditing(null);
        lists.reload();
      },
    });
  }

  return (
    <div className="space-y-3">
      <Callout tone="muted">{t("prc.approved.note")}</Callout>
      {lists.error ? <Callout tone="bad">{lists.error.message}</Callout> : null}
      {categories.length === 0 ? (
        <EmptyPanel compact title={t("prc.approved.noCategories")} />
      ) : (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {categories.map(([key, category]) => {
            const list: ApprovedSupplierList | undefined = byKey.get(key);
            const ids = list?.supplierIds ?? [];
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm font-medium">{tx(category)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ids.length === 0 ? (
                      <Badge tone="muted">{t("prc.approved.unrestricted")}</Badge>
                    ) : (
                      ids.map((id) => (
                        <Badge key={id} tone="good">
                          {tx(supplierName.get(id) ?? { en: id, ar: id })}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                {canManage ? (
                  <Button size="sm" icon={<Pencil size={12} />} onClick={() => open(category)}>
                    {t("common.edit")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <Drawer
          open
          onClose={() => setEditing(null)}
          title={tx(editing)}
          subtitle="FR-PRC-010"
          footer={
            <div className="flex gap-2">
              <Button variant="primary" loading={action.pending} onClick={save}>
                {t("common.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
            <p className="text-fg-muted text-xs leading-relaxed">{t("prc.approved.editHint")}</p>
            <ul className="space-y-1">
              {suppliers.map((supplier) => {
                const on = picked.includes(supplier.id);
                return (
                  <li key={supplier.id}>
                    <label className="hover:bg-sunken flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked((current) => (on ? current.filter((id) => id !== supplier.id) : [...current, supplier.id]))}
                      />
                      <span className="text-fg flex-1">{tx(supplier.tradingName)}</span>
                      {!supplier.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-007 / 010 / 011 — checks shown while an order is being raised
// ---------------------------------------------------------------------------

export interface SourcingLine {
  key: string;
  itemId: Id | null;
  quantity: { value: string; unit: UnitCode };
  unitPrice: number;
}

export interface SourcingVerdict {
  /** True when policy refuses this order as it stands. */
  blocked: boolean;
  /** Categories on the order bought off their approved list (warn mode), for the record. */
  offListCategories: string[];
}

/**
 * Everything the person raising an order should see before submitting it:
 * list price versus the price typed (006), who is cheaper or preferred (007),
 * category approval (010) and the supplier's compliance documents (011).
 */
export function OrderSourcingChecks({
  supplierId,
  lines,
  items,
  suppliers,
  policy,
  onUsePrice,
  onVerdict,
}: {
  supplierId: Id;
  lines: SourcingLine[];
  items: StockItem[];
  suppliers: Supplier[];
  policy: ProcurementPolicy | null;
  onUsePrice: (key: string, unitPriceMinor: number) => void;
  onVerdict: (verdict: SourcingVerdict) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const data = useAsync(
    () =>
      Promise.all([
        services.procurement.priceEntries.all(),
        services.procurement.sourcing.all(),
        services.procurement.approvedLists.all(),
        services.procurement.complianceDocs.all(),
      ]),
    [],
  );
  const today = todayIso();
  const itemsById = useMemo(() => new Map(items.map((row) => [row.id, row])), [items]);
  const supplierName = useMemo(() => new Map(suppliers.map((row) => [row.id, row.tradingName])), [suppliers]);

  const analysis = useMemo(() => {
    if (!data.data || !policy || !supplierId) return null;
    const [entries, rankings, lists, docs] = data.data;
    const rankingByItem = new Map(rankings.map((row) => [row.itemId, row.supplierIds]));

    const perLine = lines
      .filter((line) => line.itemId)
      .map((line) => {
        const item = itemsById.get(line.itemId!);
        const quantity = line.quantity.value || "0";
        const own = resolvePrice(entries, supplierId, line.itemId!, line.quantity.unit, quantity, today);
        const comparison = comparePrices(entries, rankingByItem.get(line.itemId!) ?? [], line.itemId!, line.quantity.unit, quantity, today);
        const cheapest = comparison
          .filter((row) => row.price)
          .sort((a, b) => a.price!.unitPriceMinor - b.price!.unitPriceMinor)[0];
        const preferred = comparison.find((row) => row.rank === 1) ?? null;
        const verdict = item ? approvedSupplierVerdict(lists, item.category, supplierId, policy.approvedSupplierMode) : "unrestricted";
        return { line, item, own, cheapest, preferred, verdict };
      });

    const supplierDocs = docs.filter((doc: ComplianceDocument) => doc.supplierId === supplierId && !doc.supersededBy);
    const expired = supplierDocs.filter((doc) => complianceState(doc.expiresOn, today, policy.complianceAlertDays) === "expired");
    const expiring = supplierDocs.filter((doc) => complianceState(doc.expiresOn, today, policy.complianceAlertDays) === "expiring");
    const blocked =
      perLine.some((row) => row.verdict === "block") || (policy.blockExpiredCompliance && expired.length > 0);
    return { perLine, expired, expiring, blocked };
  }, [data.data, policy, supplierId, lines, itemsById, today]);

  const blocked = analysis?.blocked ?? false;
  const offListKey = (analysis?.perLine ?? [])
    .filter((row) => row.verdict === "warn" && row.item)
    .map((row) => row.item!.category.en)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("|");
  useEffect(() => {
    onVerdict({ blocked, offListCategories: offListKey ? offListKey.split("|") : [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, offListKey]);

  if (!analysis) return null;

  const offList = analysis.perLine.filter((row) => row.verdict === "warn" || row.verdict === "block");
  const priced = analysis.perLine.filter((row) => row.own || row.cheapest);

  return (
    <div className="space-y-3">
      {/* FR-PRC-011 */}
      {analysis.expired.length > 0 ? (
        <Callout tone={policy?.blockExpiredCompliance ? "bad" : "warn"} title={t("prc.check.complianceExpired")}>
          {analysis.expired.map((doc) => `${doc.title} (${formatDate(doc.expiresOn, fmt)})`).join(", ")}
          {policy?.blockExpiredCompliance ? ` — ${t("prc.check.blockedByPolicy")}` : null}
        </Callout>
      ) : analysis.expiring.length > 0 ? (
        <Callout tone="warn" title={t("prc.check.complianceExpiring")}>
          {analysis.expiring.map((doc) => `${doc.title} (${formatDate(doc.expiresOn, fmt)})`).join(", ")}
        </Callout>
      ) : null}

      {/* FR-PRC-010 */}
      {offList.length > 0 ? (
        <Callout tone={offList.some((row) => row.verdict === "block") ? "bad" : "warn"} title={t("prc.check.notApproved")}>
          {[...new Set(offList.map((row) => (row.item ? tx(row.item.category) : "")))].join(", ")}
          {offList.some((row) => row.verdict === "block") ? ` — ${t("prc.check.blockedByPolicy")}` : ` — ${t("prc.check.warnOnly")}`}
        </Callout>
      ) : null}

      {/* FR-PRC-006 / 007 */}
      {priced.length > 0 ? (
        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("prc.check.pricingTitle")}</h3>
          <ul className="border-line divide-line divide-y rounded-lg border text-xs">
            {priced.map(({ line, item, own, cheapest, preferred }) => {
              const listPrice = own?.unitPriceMinor ?? null;
              const differs = listPrice !== null && listPrice !== line.unitPrice;
              const cheaperElsewhere = cheapest && cheapest.supplierId !== supplierId && (listPrice === null || cheapest.price!.unitPriceMinor < listPrice);
              return (
                <li key={line.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="text-fg min-w-0 flex-1">{item ? tx(item.name) : "—"}</span>
                  {listPrice !== null ? (
                    <span className="text-fg-muted">
                      {t("prc.check.listPrice")} {formatMoney(money(listPrice, PRC_CURRENCY), fmt)}
                    </span>
                  ) : (
                    <Badge tone="muted">{t("prc.check.noListPrice")}</Badge>
                  )}
                  {differs ? (
                    <Button size="sm" onClick={() => onUsePrice(line.key, listPrice!)}>
                      {t("prc.check.useListPrice")}
                    </Button>
                  ) : null}
                  {cheaperElsewhere ? (
                    <Badge tone="warn">
                      {t("prc.check.cheaperAt")
                        .replace("{supplier}", tx(supplierName.get(cheapest.supplierId) ?? { en: "—", ar: "—" }))
                        .replace("{price}", formatMoney(money(cheapest.price!.unitPriceMinor, PRC_CURRENCY), fmt))}
                    </Badge>
                  ) : null}
                  {preferred && preferred.supplierId !== supplierId ? (
                    <Badge tone="accent">
                      {t("prc.check.preferredIs").replace("{supplier}", tx(supplierName.get(preferred.supplierId) ?? { en: "—", ar: "—" }))}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
