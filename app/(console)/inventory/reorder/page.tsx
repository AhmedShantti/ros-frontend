"use client";

/**
 * Reorder suggestions — SRS FR-INV-067 … FR-INV-070.
 *
 * Suggested order quantities per item and location from the real movement
 * ledger and stock levels, computed by `suggestReorder`
 * (`lib/console/inventory-reorder.ts`, which the purchasing module's
 * suggested purchase orders call too). Every number opens into its working:
 * the usage history, the day-of-week weighting, the seasonal periods and
 * known events in the horizon, the safety stock and the shelf-life cap.
 *
 * What is computed here and what is configuration:
 *   - usage, forecast, safety stock, cap — computed, in the browser, from the
 *     ledger as read (the backend has no forecasting endpoint);
 *   - lead time, review period, service level, pack size, known events and
 *     seasonal multipliers — configuration kept on this device
 *     (`services.inventoryControls.forecast`).
 * Nothing is ordered from this screen; purchasing turns suggestions into
 * purchase orders.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, SlidersHorizontal } from "lucide-react";

import type { Id, IsoDate, StockItem, StockLevel, StockLocation, Supplier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ForecastSettings } from "@/lib/console/services/inventory-controls";
import { latestMovementAt, useLedger } from "@/lib/console/inventory-ledger";
import {
  dailyForecast,
  dailyUsage,
  groupBySupplier,
  suggestReorder,
  type DemandEvent,
  type ReorderParameters,
  type ReorderSuggestion,
} from "@/lib/console/inventory-reorder";
import { addIsoDays, seasonalEvents } from "@/lib/console/inventory-seasonality";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile, TrendChart } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { LedgerGate } from "@/components/console/inventory-ledger-panel";
import {
  DemandEventsPanel,
  ParameterFields,
  ReorderParametersPanel,
  SeasonalityPanel,
  draftToOverrides,
  parameterProblems,
  parametersToDraft,
} from "@/components/console/inventory-forecast-inputs";
import { Badge, Button, Callout, DescList, DescRow, Drawer, SegmentedControl, Tabs, Toast } from "@/components/console/ui";

type View = "suggestions" | "events" | "seasonality" | "parameters";

export default function ReorderPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <ReorderScreen />
    </Gate>
  );
}

interface Inputs {
  levels: StockLevel[];
  locations: StockLocation[];
  suppliers: Supplier[];
  settings: ForecastSettings;
  events: DemandEvent[];
}

function ReorderScreen() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("suggestions");
  const [message, setMessage] = useTransientMessage();
  const ledger = useLedger();
  const inputs = useAsync<Inputs>(async () => {
    const [levels, locations, suppliers, settings, events] = await Promise.all([
      services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows),
      services.organisation.locations().catch(() => [] as StockLocation[]),
      // Purchasing has no endpoints live; supplier lead times are then simply unavailable.
      services.purchasing.suppliers.list({ limit: 500 }).then((page) => page.rows).catch(() => [] as Supplier[]),
      services.inventoryControls.forecast.settings(),
      services.inventoryControls.forecast.events(),
    ]);
    return { levels, locations, suppliers, settings, events };
  }, []);

  const changed = (note: string) => {
    setMessage(note);
    inputs.reload();
  };

  return (
    <>
      <PageHeader title={t("invx.ro.title")} subtitle={t("invx.ro.subtitle")} spec="FR-INV-067" />
      <PageBody>
        <Tabs<View>
          value={view}
          onChange={setView}
          label={t("invx.ro.title")}
          options={[
            { value: "suggestions", label: t("invx.ro.tabSuggestions") },
            { value: "events", label: t("invx.ro.tabEvents") },
            { value: "seasonality", label: t("invx.ro.tabSeasonality") },
            { value: "parameters", label: t("invx.ro.tabParameters") },
          ]}
        />
        <AsyncPanel state={inputs}>
          {(loaded) => (
            <LedgerGate state={ledger}>
              {(load) => {
                const latest = latestMovementAt(load.movements);
                const asOf: IsoDate = latest ? latest.slice(0, 10) : new Date().toISOString().slice(0, 10);
                if (view === "events") {
                  return <DemandEventsPanel key={loaded.events.length} events={loaded.events} items={ledger.items} locations={loaded.locations} onChanged={changed} />;
                }
                if (view === "seasonality") {
                  return <SeasonalityPanel key={loaded.settings.updatedAt ?? "s"} settings={loaded.settings} from={addIsoDays(asOf, 1)} onChanged={changed} />;
                }
                if (view === "parameters") {
                  return <ReorderParametersPanel key={loaded.settings.updatedAt ?? "p"} settings={loaded.settings} onChanged={changed} />;
                }
                return <Suggestions inputs={loaded} items={ledger.items} movements={load.movements} asOf={asOf} onChanged={changed} />;
              }}
            </LedgerGate>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

type Show = "to_order" | "all";
type Layout = "rows" | "supplier";

function parametersFor(item: StockItem | undefined, settings: ForecastSettings, suppliers: Supplier[]): ReorderParameters {
  const overrides = item ? (settings.items[item.id] ?? {}) : {};
  const supplier = item?.defaultSupplierId ? suppliers.find((row) => row.id === item.defaultSupplierId) : undefined;
  const supplierLead = settings.useSupplierLeadTime && supplier ? supplier.leadTimeDays : undefined;
  return {
    ...settings.defaults,
    ...(supplierLead !== undefined ? { leadTimeDays: supplierLead } : {}),
    ...overrides,
  };
}

function Suggestions({
  inputs,
  items,
  movements,
  asOf,
  onChanged,
}: {
  inputs: Inputs;
  items: StockItem[];
  movements: import("@/lib/console/types").StockMovement[];
  asOf: IsoDate;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { tenant, scope } = useSession();
  const [locationId, setLocationId] = useState(scope.branchId ?? "all");
  const [show, setShow] = useState<Show>("to_order");
  const [layout, setLayout] = useState<Layout>("rows");
  const [selected, setSelected] = useState<ReorderSuggestion | null>(null);
  const [exported, setExported] = useTransientMessage();

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const supplierName = (id: Id | null) => (id ? tx(inputs.suppliers.find((row) => row.id === id)?.tradingName) || id : t("invx.ro.noSupplier"));

  const rows = useMemo(() => {
    const lookback = Math.max(inputs.settings.defaults.lookbackDays, ...Object.values(inputs.settings.items).map((row) => row.lookbackDays ?? 0));
    // One calendar for every row, wide enough for the longest lookback and
    // the longest horizon plus shelf life.
    const seasons = seasonalEvents({
      country: tenant.countryCode,
      from: addIsoDays(asOf, -lookback - 1),
      to: addIsoDays(asOf, 500),
      multipliers: inputs.settings.multipliers,
      custom: inputs.settings.customSeasons,
    });
    const levels = locationId === "all" ? inputs.levels : inputs.levels.filter((level) => level.locationId === locationId);
    return levels.map((level) => {
      const item = itemById.get(level.itemId);
      const parameters = parametersFor(item, inputs.settings, inputs.suppliers);
      // FR-INV-068 — only perishables are capped: expiry tracking says the date matters.
      const shelfLifeDays = item?.expiryTracked ? item.shelfLifeDays : null;
      return suggestReorder({
        itemId: level.itemId,
        itemName: level.itemName,
        locationId: level.locationId,
        locationName: level.locationName,
        unit: level.onHand.unit,
        onHand: Number(level.onHand.value),
        onOrder: Number(level.onOrder.value),
        shelfLifeDays,
        supplierId: item?.defaultSupplierId ?? null,
        unitCostMinor: level.unitCost.amount,
        history: dailyUsage(movements, { itemId: level.itemId, locationId: level.locationId, asOf, lookbackDays: parameters.lookbackDays }),
        parameters,
        asOf,
        seasons,
        demandEvents: inputs.events,
        reorderPoint: level.reorderPoint,
        reorderQuantity: level.reorderQuantity,
      });
    });
  }, [inputs, itemById, movements, asOf, locationId, tenant.countryCode]);

  const visible = useMemo(
    () => (show === "to_order" ? rows.filter((row) => row.suggested > 0) : rows).sort((a, b) => b.valueMinor - a.valueMinor),
    [rows, show],
  );
  const currency = tenant.baseCurrency;
  const toOrder = rows.filter((row) => row.suggested > 0);
  const capped = rows.filter((row) => row.capped).length;
  const fallback = rows.filter((row) => row.warnings.includes("reorder_point_fallback")).length;
  const totalValue = toOrder.reduce((sum, row) => sum + row.valueMinor, 0);
  const locations = [...new Map(inputs.levels.map((level) => [level.locationId, tx(level.locationName)])).entries()];

  const columns: Column<ReorderSuggestion>[] = [
    {
      key: "item",
      header: t("inv.item"),
      render: (row) => <CellStack primary={tx(row.itemName)} secondary={tx(row.locationName)} />,
    },
    {
      key: "position",
      header: t("invx.ro.position"),
      numeric: true,
      secondary: true,
      render: (row) => (
        <span dir="ltr" className="font-mono text-xs">
          {formatNumber(row.onHand, fmt, 1)} + {formatNumber(row.onOrder, fmt, 1)}
        </span>
      ),
    },
    {
      key: "usage",
      header: t("invx.ro.dailyUsage"),
      numeric: true,
      render: (row) => <span className="font-mono">{formatNumber(row.averageDailyUsage, fmt, 2)}</span>,
    },
    {
      key: "forecast",
      header: t("invx.ro.forecast"),
      numeric: true,
      render: (row) => (
        <CellStack
          primary={<span className="font-mono">{formatNumber(row.forecastDemand, fmt, 1)}</span>}
          secondary={
            row.seasonalAdjustment !== 0 || row.knownDemand > 0 ? (
              <span className="text-accent">
                {row.seasonalAdjustment !== 0 ? `${row.seasonalAdjustment > 0 ? "+" : ""}${formatNumber(row.seasonalAdjustment, fmt, 1)} ${t("invx.ro.seasonalShort")}` : ""}
                {row.knownDemand > 0 ? ` +${formatNumber(row.knownDemand, fmt, 1)} ${t("invx.ro.eventsShort")}` : ""}
              </span>
            ) : undefined
          }
        />
      ),
    },
    {
      key: "safety",
      header: t("invx.ro.safety"),
      numeric: true,
      secondary: true,
      render: (row) => <span className="font-mono">{formatNumber(row.safetyStock, fmt, 1)}</span>,
    },
    {
      key: "suggested",
      header: t("invx.ro.suggested"),
      numeric: true,
      render: (row) => (
        <CellStack
          primary={
            <span className={row.suggested > 0 ? "text-fg font-mono font-semibold" : "text-fg-subtle font-mono"}>
              {formatNumber(row.suggested, fmt, 2)} {row.unit}
            </span>
          }
          secondary={row.capped ? <span className="text-warn">{t("invx.ro.cappedShort")}</span> : undefined}
        />
      ),
    },
    {
      key: "value",
      header: t("common.value"),
      numeric: true,
      render: (row) => formatMoney(money(row.valueMinor, currency), fmt),
    },
    {
      key: "warnings",
      header: t("invx.ro.flags"),
      secondary: true,
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.warnings.map((warning) => (
            <Badge key={warning} tone={warning === "reorder_point_fallback" || warning === "no_history" ? "warn" : "muted"}>
              {t(`invx.ro.warning.${warning}` as ConsoleKey)}
            </Badge>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Callout tone="muted">
        {t("invx.ro.asOf").replace("{date}", formatDate(asOf, fmt)).replace("{from}", formatDate(addIsoDays(asOf, 1), fmt))}
      </Callout>

      <TileGrid columns={4}>
        <MetricTile label={t("invx.ro.toOrder")} value={formatNumber(toOrder.length, fmt)} spec="FR-INV-067" />
        <MetricTile label={t("invx.ro.orderValue")} value={formatMoney(money(totalValue, currency), fmt, true)} />
        <MetricTile label={t("invx.ro.capped")} value={formatNumber(capped, fmt)} hint={t("invx.ro.cappedHint")} spec="FR-INV-068" />
        <MetricTile label={t("invx.ro.fallback")} value={formatNumber(fallback, fmt)} hint={t("invx.ro.fallbackHint")} />
      </TileGrid>

      <Toolbar
        actions={
          <ExportButton
            filename={`reorder-suggestions-${asOf}`}
            title={t("invx.ro.title")}
            rows={visible}
            onExported={setExported}
            columns={[
              { key: "item", header: t("inv.item"), value: (row) => tx(row.itemName) },
              { key: "location", header: t("common.location"), value: (row) => tx(row.locationName) },
              { key: "supplier", header: t("invx.ro.supplier"), value: (row) => supplierName(row.supplierId) },
              { key: "onHand", header: t("inv.onHand"), value: (row) => row.onHand },
              { key: "onOrder", header: t("invx.ro.onOrder"), value: (row) => row.onOrder },
              { key: "usage", header: t("invx.ro.dailyUsage"), value: (row) => row.averageDailyUsage },
              { key: "forecast", header: t("invx.ro.forecast"), value: (row) => row.forecastDemand },
              { key: "safety", header: t("invx.ro.safety"), value: (row) => row.safetyStock },
              { key: "cap", header: t("invx.ro.cap"), value: (row) => row.shelfLifeCap ?? "" },
              { key: "suggested", header: t("invx.ro.suggested"), value: (row) => row.suggested },
              { key: "unit", header: t("common.unit"), value: (row) => row.unit },
              { key: "value", header: t("common.value"), value: (row) => (row.valueMinor / 100).toFixed(2) },
            ]}
          />
        }
      >
        <FilterSelect
          filter={{ key: "location", label: t("common.location"), options: locations.map(([value, label]) => ({ value, label })) }}
          value={locationId}
          onChange={setLocationId}
        />
        <SegmentedControl<Show>
          value={show}
          onChange={setShow}
          label={t("invx.ro.show")}
          options={[
            { value: "to_order", label: t("invx.ro.showToOrder") },
            { value: "all", label: t("invx.ro.showAll") },
          ]}
        />
        <SegmentedControl<Layout>
          value={layout}
          onChange={setLayout}
          label={t("invx.ro.layout")}
          options={[
            { value: "rows", label: t("invx.ro.layoutRows") },
            { value: "supplier", label: t("invx.ro.layoutSupplier") },
          ]}
        />
      </Toolbar>

      {layout === "rows" ? (
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => `${row.itemId}-${row.locationId}`}
          caption={t("invx.ro.title")}
          onRowClick={setSelected}
          emptyTitle={t("invx.ro.emptyTitle")}
          emptyBody={t("invx.ro.emptyBody")}
          dense
        />
      ) : (
        groupBySupplier(visible).map((group) => (
          <Section
            key={group.supplierId ?? "none"}
            title={supplierName(group.supplierId)}
            hint={t("invx.ro.supplierTotal").replace("{value}", formatMoney(money(group.valueMinor, currency), fmt)).replace("{n}", String(group.rows.length))}
            padded={false}
          >
            <DataTable columns={columns} rows={group.rows} rowKey={(row) => `${row.itemId}-${row.locationId}`} caption={supplierName(group.supplierId)} onRowClick={setSelected} dense />
          </Section>
        ))
      )}

      {selected ? (
        <SuggestionDrawer
          suggestion={selected}
          item={itemById.get(selected.itemId)}
          inputs={inputs}
          movements={movements}
          asOf={asOf}
          onClose={() => setSelected(null)}
          onChanged={(note) => {
            setSelected(null);
            onChanged(note);
          }}
        />
      ) : null}
      <Toast message={exported} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SuggestionDrawer({
  suggestion,
  item,
  inputs,
  movements,
  asOf,
  onClose,
  onChanged,
}: {
  suggestion: ReorderSuggestion;
  item: StockItem | undefined;
  inputs: Inputs;
  movements: import("@/lib/console/types").StockMovement[];
  asOf: IsoDate;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session, tenant } = useSession();
  const canEdit = usePermission("inventory.item.manage");
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => parametersToDraft(inputs.settings.items[suggestion.itemId] ?? {}));
  const effective = parametersFor(item, inputs.settings, inputs.suppliers);
  const s = suggestion;

  // History and forecast on one chart: the past as usage, the future as forecast.
  const chart = useMemo(() => {
    const history = dailyUsage(movements, { itemId: s.itemId, locationId: s.locationId, asOf, lookbackDays: effective.lookbackDays });
    const forecast = dailyForecast(
      {
        itemId: s.itemId,
        locationId: s.locationId,
        history,
        seasons: seasonalEvents({
          country: tenant.countryCode,
          from: addIsoDays(asOf, -effective.lookbackDays - 1),
          to: addIsoDays(asOf, s.horizonDays + 1),
          multipliers: inputs.settings.multipliers,
          custom: inputs.settings.customSeasons,
        }),
        demandEvents: inputs.events,
      },
      addIsoDays(asOf, 1),
      s.horizonDays,
    );
    return [
      ...history.map((row) => ({ label: row.date.slice(5), value: row.quantity })),
      ...forecast.map((row) => ({ label: row.date.slice(5), value: 0, comparison: Math.round((row.seasonal + row.known) * 100) / 100 })),
    ];
  }, [movements, s, asOf, effective.lookbackDays, inputs, tenant.countryCode]);

  const overrideProblems = parameterProblems(draft, t, true);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(s.itemName)}
      subtitle={tx(s.locationName)}
      footer={
        editing ? (
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={action.pending}
              disabled={overrideProblems.length > 0}
              onClick={() => {
                const overrides = draftToOverrides(draft);
                const items = { ...inputs.settings.items };
                if (Object.keys(overrides).length === 0) delete items[s.itemId];
                else items[s.itemId] = overrides;
                void action.run(
                  () => services.inventoryControls.forecast.saveSettings({ ...inputs.settings, items, updatedBy: session?.user.email ?? null }),
                  { onSuccess: () => onChanged(t("invx.ro.overridesSaved")) },
                );
              }}
            >
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : canEdit ? (
          <Button icon={<SlidersHorizontal size={14} />} onClick={() => setEditing(true)}>
            {t("invx.ro.editOverrides")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {s.warnings.includes("reorder_point_fallback") ? <Callout tone="warn" icon={<AlertTriangle size={14} />}>{t("invx.ro.fallbackExplain")}</Callout> : null}
        {s.warnings.includes("thin_history") ? <Callout tone="warn">{t("invx.ro.thinExplain").replace("{n}", String(s.activeDays))}</Callout> : null}

        {editing ? (
          <section className="space-y-3">
            <p className="text-fg-muted text-xs">{t("invx.ro.overridesHint")}</p>
            <ParameterFields draft={draft} setDraft={setDraft} placeholders={parametersToDraft(effective)} />
            {overrideProblems.length > 0 ? (
              <ul className="text-fg-subtle space-y-0.5 text-xs">
                {overrideProblems.map((problem) => (
                  <li key={problem}>• {problem}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <TrendChart data={chart} height={180} valueLabel={t("invx.ro.usageSeries")} comparisonLabel={t("invx.ro.forecastSeries")} />

        <DescList>
          <DescRow label={t("invx.ro.formulaUsage")} mono>
            {formatNumber(s.averageDailyUsage, fmt, 3)} {s.unit} · σ {formatNumber(s.usageStdev, fmt, 3)} · {t("invx.ro.activeDays").replace("{n}", String(s.activeDays))}
          </DescRow>
          <DescRow label={t("invx.ro.formulaHorizon")} mono>
            {effective.leadTimeDays} + {effective.reviewPeriodDays} = {s.horizonDays}
          </DescRow>
          <DescRow label={t("invx.ro.formulaBaseline")} mono>
            {formatNumber(s.baselineDemand, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaSeasonal")} mono>
            {s.seasonalAdjustment >= 0 ? "+" : ""}
            {formatNumber(s.seasonalAdjustment, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaKnown")} mono>
            +{formatNumber(s.knownDemand, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.forecast")} mono>
            {formatNumber(s.forecastDemand, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaSafety")} mono>
            {formatNumber(s.z, fmt, 2)} × {formatNumber(s.usageStdev, fmt, 2)} × √{effective.leadTimeDays} = {formatNumber(s.safetyStock, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaTarget")} mono>
            {formatNumber(s.targetLevel, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaPosition")} mono>
            {formatNumber(s.onHand, fmt, 2)} + {formatNumber(s.onOrder, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.formulaUncapped")} mono>
            {formatNumber(s.uncapped, fmt, 2)}
          </DescRow>
          <DescRow label={t("invx.ro.cap")} mono>
            {s.shelfLifeCap === null ? t("invx.ro.notPerishable") : `${formatNumber(s.shelfLifeCap, fmt, 2)} (${item?.shelfLifeDays ?? "—"} ${t("invx.ro.daysShelf")})`}
          </DescRow>
          <DescRow label={<span className="text-fg font-semibold">{t("invx.ro.suggested")}</span>} mono>
            <span className="font-semibold">
              {formatNumber(s.suggested, fmt, 2)} {s.unit}
              {effective.packSize ? ` (${t("invx.ro.packOf").replace("{n}", String(effective.packSize))})` : ""}
            </span>
          </DescRow>
        </DescList>

        {s.seasonsApplied.length > 0 || s.eventsApplied.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays size={14} aria-hidden /> {t("invx.ro.inHorizon")}
            </h3>
            <ul className="space-y-1 text-xs">
              {s.seasonsApplied.map((season) => (
                <li key={season.id} className="text-fg-muted">
                  {tx(season.name)} · {formatDate(season.from, fmt)} – {formatDate(season.to, fmt)} · ×{formatNumber(season.multiplier, fmt, 2)}
                </li>
              ))}
              {s.eventsApplied.map((event) => (
                <li key={event.id} className="text-fg-muted">
                  {event.name} · {formatDate(event.from, fmt)} – {formatDate(event.to, fmt)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
