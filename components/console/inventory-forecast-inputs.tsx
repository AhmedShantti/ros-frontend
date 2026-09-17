"use client";

/**
 * The inputs to the reorder forecast — SRS FR-INV-067 … FR-INV-070.
 *
 *   - `DemandEventsPanel` — known future demand: events, catering orders and
 *     promotions (FR-INV-069).
 *   - `SeasonalityPanel` — Ramadan and both Eids computed from the Umm
 *     al-Qura calendar, the country's national holidays, and the tenant's own
 *     periods, each with a demand multiplier (FR-INV-070).
 *   - `ReorderParametersPanel` — lookback, lead time, review period, service
 *     level and pack size (FR-INV-067).
 *
 * All three are kept by `services.inventoryControls.forecast` on this device;
 * the backend has no forecasting configuration.
 */

import { useMemo, useState } from "react";
import { CalendarPlus, Pencil, Plus, Trash2, X } from "lucide-react";

import type { Id, IsoDate, StockItem, StockLocation } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ForecastSettings } from "@/lib/console/services/inventory-controls";
import type { DemandEvent, DemandEventKind, ReorderParameters } from "@/lib/console/inventory-reorder";
import { zForServiceLevel } from "@/lib/console/inventory-reorder";
import {
  DEFAULT_MULTIPLIERS,
  addIsoDays,
  hijriSupported,
  seasonalEvents,
  type SeasonKind,
  type SeasonalEvent,
} from "@/lib/console/inventory-seasonality";
import { localId } from "@/lib/console/local-store";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { useConfirm } from "@/components/console/confirm";
import { SearchSelect } from "@/components/console/fields";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { Badge, Button, Callout, Drawer, Field, Input, Select, SegmentedControl, Toggle } from "@/components/console/ui";

const KINDS: DemandEventKind[] = ["event", "catering", "promotion"];

// ---------------------------------------------------------------------------
// FR-INV-069 — known future demand
// ---------------------------------------------------------------------------

export function DemandEventsPanel({
  events,
  items,
  locations,
  onChanged,
}: {
  events: DemandEvent[];
  items: StockItem[];
  locations: StockLocation[];
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canEdit = usePermission("inventory.item.manage");
  const confirm = useConfirm();
  const action = useAction();
  const [editing, setEditing] = useState<DemandEvent | null>(null);

  const locationName = (id: Id | null) => (id ? tx(locations.find((row) => row.id === id)?.name) || id : t("invx.fc.allLocations"));

  async function remove(event: DemandEvent) {
    const ok = await confirm({
      title: t("invx.fc.removeEventTitle"),
      body: t("invx.fc.removeEventBody").replace("{name}", event.name),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.inventoryControls.forecast.removeEvent(event.id), {
      onSuccess: () => onChanged(t("invx.fc.eventRemoved")),
    });
  }

  const columns: Column<DemandEvent>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (row) => <CellStack primary={row.name} secondary={t(`invx.fc.kind.${row.kind}` as ConsoleKey)} />,
    },
    {
      key: "dates",
      header: t("invx.fc.dates"),
      render: (row) => `${formatDate(row.from, fmt)} – ${formatDate(row.to, fmt)}`,
    },
    { key: "location", header: t("common.location"), secondary: true, render: (row) => locationName(row.locationId) },
    {
      key: "effect",
      header: t("invx.fc.effect"),
      render: (row) => (
        <span className="text-xs">
          {row.lines.length > 0 ? t("invx.fc.linesEffect").replace("{n}", String(row.lines.length)) : null}
          {row.lines.length > 0 && row.upliftPercent ? " · " : null}
          {row.upliftPercent ? t("invx.fc.upliftEffect").replace("{p}", formatNumber(row.upliftPercent, fmt, 0)) : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("common.actions"),
      render: (row) =>
        canEdit ? (
          <span className="flex gap-1" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="ghost" icon={<Pencil size={11} />} aria-label={t("common.edit")} onClick={() => setEditing(row)} />
            <Button size="sm" variant="ghost" icon={<Trash2 size={11} />} aria-label={t("common.delete")} onClick={() => void remove(row)} />
          </span>
        ) : null,
    },
  ];

  return (
    <Section
      title={t("invx.fc.eventsTitle")}
      hint={t("invx.fc.eventsHint")}
      spec="FR-INV-069"
      action={
        canEdit ? (
          <Button
            size="sm"
            variant="primary"
            icon={<CalendarPlus size={12} />}
            onClick={() =>
              setEditing({
                id: "",
                kind: "event",
                name: "",
                from: new Date().toISOString().slice(0, 10),
                to: new Date().toISOString().slice(0, 10),
                locationId: null,
                lines: [],
                upliftPercent: null,
                upliftItemIds: [],
              })
            }
          >
            {t("invx.fc.addEvent")}
          </Button>
        ) : null
      }
    >
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <DataTable
        columns={columns}
        rows={[...events].sort((a, b) => a.from.localeCompare(b.from))}
        rowKey={(row) => row.id}
        caption={t("invx.fc.eventsTitle")}
        emptyTitle={t("invx.fc.noEvents")}
        emptyBody={t("invx.fc.noEventsBody")}
        onRowClick={canEdit ? setEditing : undefined}
        dense
      />
      {editing ? (
        <DemandEventDrawer
          event={editing}
          items={items}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged(t("invx.fc.eventSaved"));
          }}
        />
      ) : null}
    </Section>
  );
}

function DemandEventDrawer({
  event,
  items,
  locations,
  onClose,
  onSaved,
}: {
  event: DemandEvent;
  items: StockItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [draft, setDraft] = useState<DemandEvent>(event);
  const [uplift, setUplift] = useState(event.upliftPercent === null ? "" : String(event.upliftPercent));
  const set = (patch: Partial<DemandEvent>) => setDraft((current) => ({ ...current, ...patch }));
  const itemName = (id: Id) => tx(items.find((item) => item.id === id)?.name) || id;

  const upliftValue = uplift.trim() === "" ? null : Number(uplift);
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push(t("invx.fc.needName"));
  if (!draft.from || !draft.to || draft.to < draft.from) problems.push(t("invx.fc.badDates"));
  if (upliftValue !== null && !Number.isFinite(upliftValue)) problems.push(t("invx.fc.badUplift"));
  if (draft.lines.some((line) => !(Number(line.quantity) > 0))) problems.push(t("invx.fc.badLine"));
  if (draft.lines.length === 0 && !upliftValue) problems.push(t("invx.fc.needEffect"));

  return (
    <Drawer
      open
      onClose={onClose}
      title={event.id ? event.name : t("invx.fc.addEvent")}
      subtitle="FR-INV-069"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() =>
              void action.run(() => services.inventoryControls.forecast.saveEvent({ ...draft, upliftPercent: upliftValue }), {
                onSuccess: onSaved,
              })
            }
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field label={t("common.name")} required>
          <Input value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder={t("invx.fc.namePlaceholder")} />
        </Field>
        <Field label={t("invx.fc.kind")}>
          <SegmentedControl<DemandEventKind>
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={KINDS.map((kind) => ({ value: kind, label: t(`invx.fc.kind.${kind}` as ConsoleKey) }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("invx.fc.from")} required>
            <Input type="date" dir="ltr" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label={t("invx.fc.to")} required error={draft.to && draft.from && draft.to < draft.from ? t("invx.fc.badDates") : undefined}>
            <Input type="date" dir="ltr" value={draft.to} min={draft.from} onChange={(e) => set({ to: e.target.value })} />
          </Field>
        </div>
        <Field label={t("common.location")}>
          <Select value={draft.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value || null })}>
            <option value="">{t("invx.fc.allLocations")}</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>

        <section className="space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("invx.fc.extraQuantities")}</h3>
          <p className="text-fg-subtle text-xs">{t("invx.fc.extraQuantitiesHint")}</p>
          {draft.lines.map((line, index) => (
            <div key={`${line.itemId}-${index}`} className="flex items-center gap-2">
              <span className="text-fg min-w-0 flex-1 truncate text-sm">{itemName(line.itemId)}</span>
              <Input
                dir="ltr"
                inputMode="decimal"
                className="w-28"
                value={line.quantity}
                aria-label={`${t("inv.quantity")} ${itemName(line.itemId)}`}
                onChange={(e) => set({ lines: draft.lines.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)) })}
              />
              <Button size="sm" variant="ghost" icon={<X size={12} />} aria-label={t("common.remove")} onClick={() => set({ lines: draft.lines.filter((_, i) => i !== index) })} />
            </div>
          ))}
          <SearchSelect
            value={null}
            onChange={(itemId) => {
              if (itemId && !draft.lines.some((line) => line.itemId === itemId)) set({ lines: [...draft.lines, { itemId, quantity: "" }] });
            }}
            options={items.filter((item) => !draft.lines.some((line) => line.itemId === item.id)).map((item) => ({ value: item.id, label: tx(item.name), hint: `${item.sku} · ${item.baseUnit}` }))}
            placeholder={t("invx.fc.addItem")}
            aria-label={t("invx.fc.addItem")}
          />
        </section>

        <Field label={t("invx.fc.uplift")} hint={t("invx.fc.upliftHint")}>
          <Input dir="ltr" inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value)} placeholder="25" />
        </Field>
        {upliftValue ? (
          <Field label={t("invx.fc.upliftItems")} hint={t("invx.fc.upliftItemsHint")}>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {draft.upliftItemIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => set({ upliftItemIds: draft.upliftItemIds.filter((row) => row !== id) })}
                    className="border-line bg-sunken text-fg hover:border-bad inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    aria-label={`${t("common.remove")} ${itemName(id)}`}
                  >
                    {itemName(id)} <X size={11} aria-hidden />
                  </button>
                ))}
              </div>
              <SearchSelect
                value={null}
                onChange={(itemId) => {
                  if (itemId && !draft.upliftItemIds.includes(itemId)) set({ upliftItemIds: [...draft.upliftItemIds, itemId] });
                }}
                options={items.map((item) => ({ value: item.id, label: tx(item.name), hint: item.sku }))}
                placeholder={t("invx.fc.addItem")}
                aria-label={t("invx.fc.upliftItems")}
              />
            </div>
          </Field>
        ) : null}

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-INV-070 — seasonality
// ---------------------------------------------------------------------------

const SEASON_KINDS: Exclude<SeasonKind, "custom">[] = ["ramadan", "eid_al_fitr", "eid_al_adha", "holiday"];

export function SeasonalityPanel({
  settings,
  from,
  onChanged,
}: {
  settings: ForecastSettings;
  /** The day the forecast starts; the calendar shows the year from it. */
  from: IsoDate;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { tenant, session } = useSession();
  const canEdit = usePermission("inventory.item.manage");
  const action = useAction();
  const confirm = useConfirm();
  const [multipliers, setMultipliers] = useState<Record<string, string>>(() =>
    Object.fromEntries(SEASON_KINDS.map((kind) => [kind, String(settings.multipliers[kind] ?? DEFAULT_MULTIPLIERS[kind])])),
  );
  const [custom, setCustom] = useState<SeasonalEvent | null>(null);

  const calendar = useMemo(
    () =>
      seasonalEvents({
        country: tenant.countryCode,
        from,
        to: addIsoDays(from, 400),
        multipliers: settings.multipliers,
        custom: settings.customSeasons,
      }),
    [tenant.countryCode, from, settings],
  );

  const parsed = Object.fromEntries(Object.entries(multipliers).map(([kind, value]) => [kind, Number(value)]));
  const invalid = Object.values(parsed).some((value) => !(value > 0 && value <= 10));

  async function saveMultipliers() {
    await action.run(
      () =>
        services.inventoryControls.forecast.saveSettings({
          ...settings,
          multipliers: { ...settings.multipliers, ...parsed },
          updatedBy: session?.user.email ?? null,
        }),
      { onSuccess: () => onChanged(t("invx.fc.multipliersSaved")) },
    );
  }

  async function saveCustom(next: SeasonalEvent) {
    const exists = settings.customSeasons.some((row) => row.id === next.id);
    await action.run(
      () =>
        services.inventoryControls.forecast.saveSettings({
          ...settings,
          customSeasons: exists ? settings.customSeasons.map((row) => (row.id === next.id ? next : row)) : [...settings.customSeasons, next],
          updatedBy: session?.user.email ?? null,
        }),
      {
        onSuccess: () => {
          setCustom(null);
          onChanged(t("invx.fc.seasonSaved"));
        },
      },
    );
  }

  async function removeCustom(id: string) {
    const ok = await confirm({ title: t("invx.fc.removeSeasonTitle"), confirmLabel: t("common.delete"), tone: "danger" });
    if (!ok) return;
    await action.run(
      () =>
        services.inventoryControls.forecast.saveSettings({
          ...settings,
          customSeasons: settings.customSeasons.filter((row) => row.id !== id),
          updatedBy: session?.user.email ?? null,
        }),
      { onSuccess: () => onChanged(t("invx.fc.seasonRemoved")) },
    );
  }

  const columns: Column<SeasonalEvent>[] = [
    { key: "name", header: t("common.name"), render: (row) => <CellStack primary={tx(row.name)} secondary={t(`invx.fc.season.${row.kind}` as ConsoleKey)} /> },
    { key: "dates", header: t("invx.fc.dates"), render: (row) => (row.from === row.to ? formatDate(row.from, fmt) : `${formatDate(row.from, fmt)} – ${formatDate(row.to, fmt)}`) },
    { key: "multiplier", header: t("invx.fc.multiplier"), numeric: true, render: (row) => <span className="font-mono">×{formatNumber(row.multiplier, fmt, 2)}</span> },
    {
      key: "source",
      header: t("invx.fc.source"),
      render: (row) => (
        <span className="flex items-center gap-1">
          <Badge tone={row.source === "tenant" ? "accent" : "muted"}>{t(`invx.fc.source.${row.source}` as ConsoleKey)}</Badge>
          {row.source === "tenant" && canEdit ? (
            <Button size="sm" variant="ghost" icon={<Trash2 size={11} />} aria-label={t("common.delete")} onClick={() => void removeCustom(row.id)} />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {!hijriSupported() ? <Callout tone="warn">{t("invx.fc.noHijri")}</Callout> : null}
      <Callout tone="muted">{t("invx.fc.seasonNote")}</Callout>

      <Section title={t("invx.fc.multipliersTitle")} hint={t("invx.fc.multipliersHint")} spec="FR-INV-070">
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-4">
          {SEASON_KINDS.map((kind) => (
            <Field key={kind} label={t(`invx.fc.season.${kind}` as ConsoleKey)} error={!(parsed[kind]! > 0 && parsed[kind]! <= 10) ? t("invx.fc.badMultiplier") : undefined}>
              <Input dir="ltr" inputMode="decimal" value={multipliers[kind]} onChange={(e) => setMultipliers((current) => ({ ...current, [kind]: e.target.value }))} />
            </Field>
          ))}
        </fieldset>
        {canEdit ? (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" size="sm" loading={action.pending} disabled={invalid} onClick={() => void saveMultipliers()}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </Section>

      <Section
        title={t("invx.fc.calendarTitle")}
        hint={t("invx.fc.calendarHint")}
        padded={false}
        action={
          canEdit ? (
            <Button
              size="sm"
              icon={<Plus size={12} />}
              onClick={() =>
                setCustom({ id: localId("season"), kind: "custom", name: { en: "", ar: "" }, from, to: from, multiplier: 1.2, source: "tenant" })
              }
            >
              {t("invx.fc.addSeason")}
            </Button>
          ) : null
        }
      >
        <DataTable columns={columns} rows={calendar} rowKey={(row) => row.id} caption={t("invx.fc.calendarTitle")} emptyTitle={t("invx.fc.noSeasons")} dense />
      </Section>

      {custom ? <CustomSeasonDrawer season={custom} pending={action.pending} error={action.error} onClose={() => setCustom(null)} onSave={(next) => void saveCustom(next)} /> : null}
    </div>
  );
}

function CustomSeasonDrawer({
  season,
  pending,
  error,
  onClose,
  onSave,
}: {
  season: SeasonalEvent;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (season: SeasonalEvent) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(season);
  const [multiplier, setMultiplier] = useState(String(season.multiplier));
  const value = Number(multiplier);
  const valid = (draft.name.en.trim() || draft.name.ar.trim()) && draft.from && draft.to >= draft.from && value > 0 && value <= 10;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.fc.addSeason")}
      subtitle="FR-INV-070"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={pending} disabled={!valid} onClick={() => onSave({ ...draft, multiplier: value })}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t("common.name")} (EN)`} required>
            <Input dir="ltr" value={draft.name.en} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, en: e.target.value } })} />
          </Field>
          <Field label={`${t("common.name")} (AR)`}>
            <Input dir="rtl" value={draft.name.ar} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, ar: e.target.value } })} />
          </Field>
          <Field label={t("invx.fc.from")} required>
            <Input type="date" dir="ltr" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label={t("invx.fc.to")} required>
            <Input type="date" dir="ltr" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
        </div>
        <Field label={t("invx.fc.multiplier")} hint={t("invx.fc.multiplierHint")} required>
          <Input dir="ltr" inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-INV-067 — parameters
// ---------------------------------------------------------------------------

export function ReorderParametersPanel({ settings, onChanged }: { settings: ForecastSettings; onChanged: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const canEdit = usePermission("inventory.item.manage");
  const action = useAction();
  const [draft, setDraft] = useState(() => parametersToDraft(settings.defaults));
  const [useSupplier, setUseSupplier] = useState(settings.useSupplierLeadTime);
  const parsed = draftToParameters(draft);
  const problems = parameterProblems(draft, t);

  return (
    <Section title={t("invx.fc.paramsTitle")} hint={t("invx.fc.paramsHint")} spec="FR-INV-067">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {!canEdit ? <Callout tone="muted">{t("invx.common.readOnly")}</Callout> : null}
      <fieldset disabled={!canEdit} className="space-y-4">
        <ParameterFields draft={draft} setDraft={setDraft} />
        <Toggle checked={useSupplier} onChange={setUseSupplier} label={t("invx.fc.useSupplierLead")} hint={t("invx.fc.useSupplierLeadHint")} />
        <p className="text-fg-subtle text-xs">
          {t("invx.fc.zExplain")
            .replace("{level}", draft.serviceLevel)
            .replace("{z}", Number.isFinite(parsed.serviceLevel) ? formatNumber(zForServiceLevel(parsed.serviceLevel), fmt, 2) : "—")}
        </p>
      </fieldset>
      {problems.length > 0 ? (
        <ul className="text-fg-subtle mt-3 space-y-0.5 text-xs">
          {problems.map((problem) => (
            <li key={problem}>• {problem}</li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() =>
              void action.run(
                () =>
                  services.inventoryControls.forecast.saveSettings({
                    ...settings,
                    defaults: parsed,
                    useSupplierLeadTime: useSupplier,
                    updatedBy: session?.user.email ?? null,
                  }),
                { onSuccess: () => onChanged(t("invx.fc.paramsSaved")) },
              )
            }
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export interface ParameterDraft {
  lookbackDays: string;
  leadTimeDays: string;
  reviewPeriodDays: string;
  /** Percent, e.g. "95". */
  serviceLevel: string;
  packSize: string;
}

export function parametersToDraft(parameters: Partial<ReorderParameters>): ParameterDraft {
  return {
    lookbackDays: parameters.lookbackDays === undefined ? "" : String(parameters.lookbackDays),
    leadTimeDays: parameters.leadTimeDays === undefined ? "" : String(parameters.leadTimeDays),
    reviewPeriodDays: parameters.reviewPeriodDays === undefined ? "" : String(parameters.reviewPeriodDays),
    serviceLevel: parameters.serviceLevel === undefined ? "" : String(Math.round(parameters.serviceLevel * 1000) / 10),
    packSize: parameters.packSize === undefined || parameters.packSize === null ? "" : String(parameters.packSize),
  };
}

export function draftToParameters(draft: ParameterDraft): ReorderParameters {
  return {
    lookbackDays: Number(draft.lookbackDays),
    leadTimeDays: Number(draft.leadTimeDays),
    reviewPeriodDays: Number(draft.reviewPeriodDays),
    serviceLevel: Number(draft.serviceLevel) / 100,
    packSize: draft.packSize.trim() ? Number(draft.packSize) : null,
  };
}

/** Only the fields filled in — for per-item overrides. */
export function draftToOverrides(draft: ParameterDraft): Partial<ReorderParameters> {
  const full = draftToParameters(draft);
  const out: Partial<ReorderParameters> = {};
  if (draft.lookbackDays.trim()) out.lookbackDays = full.lookbackDays;
  if (draft.leadTimeDays.trim()) out.leadTimeDays = full.leadTimeDays;
  if (draft.reviewPeriodDays.trim()) out.reviewPeriodDays = full.reviewPeriodDays;
  if (draft.serviceLevel.trim()) out.serviceLevel = full.serviceLevel;
  if (draft.packSize.trim()) out.packSize = full.packSize;
  return out;
}

export function parameterProblems(draft: ParameterDraft, t: (key: ConsoleKey) => string, partial = false): string[] {
  const out: string[] = [];
  const check = (value: string, ok: (n: number) => boolean, message: ConsoleKey) => {
    if (partial && !value.trim()) return;
    if (!ok(Number(value)) || !value.trim()) out.push(t(message));
  };
  check(draft.lookbackDays, (n) => Number.isInteger(n) && n >= 7 && n <= 365, "invx.fc.badLookback");
  check(draft.leadTimeDays, (n) => Number.isFinite(n) && n >= 0 && n <= 120, "invx.fc.badLead");
  check(draft.reviewPeriodDays, (n) => Number.isInteger(n) && n >= 1 && n <= 90, "invx.fc.badReview");
  check(draft.serviceLevel, (n) => n >= 50 && n < 100, "invx.fc.badService");
  if (draft.packSize.trim() && !(Number(draft.packSize) > 0)) out.push(t("invx.fc.badPack"));
  return out;
}

export function ParameterFields({
  draft,
  setDraft,
  placeholders,
}: {
  draft: ParameterDraft;
  setDraft: (next: ParameterDraft) => void;
  placeholders?: ParameterDraft;
}) {
  const { t } = useI18n();
  const field = (key: keyof ParameterDraft, label: ConsoleKey, hint: ConsoleKey) => (
    <Field label={t(label)} hint={t(hint)}>
      <Input
        dir="ltr"
        inputMode="decimal"
        value={draft[key]}
        placeholder={placeholders?.[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {field("lookbackDays", "invx.fc.lookback", "invx.fc.lookbackHint")}
      {field("leadTimeDays", "invx.fc.leadTime", "invx.fc.leadTimeHint")}
      {field("reviewPeriodDays", "invx.fc.review", "invx.fc.reviewHint")}
      {field("serviceLevel", "invx.fc.serviceLevel", "invx.fc.serviceLevelHint")}
      {field("packSize", "invx.fc.packSize", "invx.fc.packSizeHint")}
    </div>
  );
}
