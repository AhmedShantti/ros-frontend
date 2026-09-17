"use client";

/**
 * Price maintenance at scale — FR-MNU-024, FR-MNU-025, FR-MNU-026.
 *
 * A price list is edited one entry at a time until the day the landlord puts
 * the rent up, and then it is edited three hundred entries at a time. The
 * failure modes of bulk edits are well known — a percentage applied twice, a
 * rounding rule that turns 9.95 into 10.95, a CSV column shifted by one — so
 * every bulk path here ends in a preview of each old price beside its new
 * one, with the rows that would breach margin flagged, before anything is
 * sent. Nothing is applied from a screen the user has not seen.
 *
 * Every write goes through `changePrice`, which records history (FR-MNU-024).
 * A future effective time becomes a scheduled change, applied through the
 * same path when due — see `applyDueSchedules`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Download, FileUp, History, Settings2, XCircle } from "lucide-react";

import type { Currency, Id, Localised, MenuCategory, MenuItem, PriceList, PriceListEntry } from "@/lib/console/types";
import type { PricePointRule, PricingSettings, ScheduledPriceChange } from "@/lib/console/services/menu-pricing";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { currencyExponent, formatDateTime, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import {
  applyBulk,
  basisPoints,
  checkMargin,
  parseCsv,
  unitOf,
  validateImport,
  type BulkOperation,
  type ImportCatalogueVariant,
  type ImportRow,
} from "@/lib/console/menu-pricing";
import { changePrice, useActor, useVariantCosts } from "@/lib/console/menu-price-actions";
import { downloadBlob } from "@/lib/console/menu-download";
import { DataTable, type Column } from "@/components/console/data-table";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import { MoneyInput } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  Drawer,
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Settings — FR-MNU-025 price point, FR-MNU-026 threshold
// ---------------------------------------------------------------------------

export function usePricingSettings(): [PricingSettings, (next: PricingSettings) => void] {
  const [settings, setSettings] = useState<PricingSettings>(() => ({
    marginThresholdPercent: 60,
    pricePoint: { kind: "none" },
  }));
  useEffect(() => {
    setSettings(services.menuPricing.settings());
  }, []);
  return [
    settings,
    (next) => {
      services.menuPricing.saveSettings(next);
      setSettings(next);
    },
  ];
}

/** FR-MNU-025 — "always end in .95", or round to a step. */
export function PricePointFields({
  value,
  onChange,
  currency,
}: {
  value: PricePointRule;
  onChange: (next: PricePointRule) => void;
  currency: Currency;
}) {
  const { t } = useI18n();
  const direction = value.kind === "none" ? "nearest" : value.direction;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={t("mnp.pricePoint")} hint={t("mnp.pricePointHint")}>
        <Select
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as PricePointRule["kind"];
            if (kind === "none") onChange({ kind });
            if (kind === "ending") onChange({ kind, ending: 95, direction });
            if (kind === "multiple") onChange({ kind, step: 50, direction });
          }}
        >
          <option value="none">{t("mnp.pricePointNone")}</option>
          <option value="ending">{t("mnp.pricePointEnding")}</option>
          <option value="multiple">{t("mnp.pricePointMultiple")}</option>
        </Select>
      </Field>
      {value.kind === "ending" ? (
        <Field label={t("mnp.pricePointEndingValue")} hint={t("mnp.pricePointEndingHint")}>
          <Input
            dir="ltr"
            inputMode="numeric"
            value={String(value.ending)}
            onChange={(event) =>
              onChange({ ...value, ending: Math.max(0, Math.min(unitOf(currencyExponent(currency)) - 1, Number(event.target.value.replace(/\D/g, "")) || 0)) })
            }
          />
        </Field>
      ) : null}
      {value.kind === "multiple" ? (
        <Field label={t("mnp.pricePointStep")} hint={t("mnp.pricePointStepHint")}>
          <MoneyInput
            currency={currency}
            value={value.step}
            onChange={(minor) => onChange({ ...value, step: Math.max(1, minor ?? 1) })}
          />
        </Field>
      ) : null}
      {value.kind !== "none" ? (
        <Field label={t("mnp.roundDirection")}>
          <Select
            value={direction}
            onChange={(event) =>
              onChange({ ...value, direction: event.target.value as "up" | "down" | "nearest" })
            }
          >
            <option value="up">{t("mnp.roundUp")}</option>
            <option value="nearest">{t("mnp.roundNearest")}</option>
            <option value="down">{t("mnp.roundDown")}</option>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

export function PricingSettingsDrawer({
  open,
  settings,
  currency,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: PricingSettings;
  currency: Currency;
  onClose: () => void;
  onSave: (next: PricingSettings) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings, open]);
  if (!open) return null;

  const threshold = Number(draft.marginThresholdPercent);
  const valid = Number.isFinite(threshold) && threshold >= 0 && threshold < 100;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mnp.settingsTitle")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("mnp.settingsLocal")}</Callout>
        {/* FR-MNU-026: configurable threshold */}
        <Field label={t("mnp.marginThreshold")} hint={t("mnp.marginThresholdHint")} required>
          <Input
            dir="ltr"
            inputMode="decimal"
            value={String(draft.marginThresholdPercent)}
            onChange={(event) =>
              setDraft({ ...draft, marginThresholdPercent: Number(event.target.value) })
            }
          />
        </Field>
        <PricePointFields
          currency={currency}
          value={draft.pricePoint}
          onChange={(pricePoint) => setDraft({ ...draft, pricePoint })}
        />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-026 — margin warning
// ---------------------------------------------------------------------------

export function MarginWarning({
  price,
  cost,
  thresholdPercent,
  currency,
}: {
  price: number | null;
  cost: number | null;
  thresholdPercent: number;
  currency: Currency;
}) {
  const { t, fmt } = useI18n();
  if (price === null) return null;
  if (cost === null) {
    return <p className="text-fg-subtle text-xs">{t("mnp.noCostKnown")}</p>;
  }
  const check = checkMargin(price, cost, thresholdPercent);
  const costText = formatMoney({ amount: cost, currency }, fmt);

  // FR-MNU-026: warn below cost, or below the configured threshold.
  if (check.belowCost) {
    return (
      <Callout tone="bad" icon={<AlertTriangle size={14} />} title={t("mnp.belowCostTitle")}>
        {t("mnp.belowCostBody").replace("{cost}", costText)}
      </Callout>
    );
  }
  if (check.belowThreshold && check.marginPercent !== null) {
    return (
      <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("mnp.belowThresholdTitle")}>
        {t("mnp.belowThresholdBody")
          .replace("{margin}", formatPercent(check.marginPercent, fmt, 1))
          .replace("{threshold}", formatPercent(thresholdPercent, fmt, 0))
          .replace("{cost}", costText)}
      </Callout>
    );
  }
  return (
    <p className="text-good text-xs">
      {t("mnp.marginOk")
        .replace("{margin}", formatPercent(check.marginPercent ?? 0, fmt, 1))
        .replace("{cost}", costText)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Effective time — now, or scheduled
// ---------------------------------------------------------------------------

/** A `datetime-local` value for "now + minutes". */
export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface EffectiveChoice {
  mode: "now" | "later";
  at: string;
}

export function effectiveIso(choice: EffectiveChoice): string | null {
  if (choice.mode === "now") return null;
  const date = new Date(choice.at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function effectiveInvalid(choice: EffectiveChoice): boolean {
  if (choice.mode === "now") return false;
  const date = new Date(choice.at);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now();
}

export function EffectiveField({
  value,
  onChange,
}: {
  value: EffectiveChoice;
  onChange: (next: EffectiveChoice) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <Field label={t("mnp.effective")} hint={value.mode === "later" ? t("mnp.scheduleNote") : undefined}>
        <SegmentedControl
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          options={[
            { value: "now" as const, label: t("mnp.effectiveNow") },
            { value: "later" as const, label: t("mnp.effectiveLater") },
          ]}
        />
      </Field>
      {value.mode === "later" ? (
        <Field
          label={t("mnp.effectiveAt")}
          error={effectiveInvalid(value) ? t("mnp.effectiveFuture") : null}
          required
        >
          <Input
            type="datetime-local"
            dir="ltr"
            value={value.at}
            onChange={(event) => onChange({ ...value, at: event.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rows a bulk operation or import works on
// ---------------------------------------------------------------------------

export interface PricingRow {
  entry: PriceListEntry;
  label: Localised;
  categoryId: Id | null;
  codes: string[];
  cost: number | null;
}

/** Entries of one list, joined to item category, codes and portion cost. */
export function usePricingRows(list: PriceList | null) {
  const costs = useVariantCosts();
  const data = useAsync(async () => {
    if (!list) return null;
    const [entries, items, categories] = await Promise.all([
      services.catalogue.priceEntries(list.id),
      services.catalogue.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as MenuItem[]),
      services.catalogue.categories.list({ limit: 500 }).then((page) => page.rows).catch(() => [] as MenuCategory[]),
    ]);
    return { entries, items, categories };
  }, [list?.id]);

  const rows = useMemo<PricingRow[]>(() => {
    if (!data.data) return [];
    const items = new Map(data.data.items.map((item) => [item.id, item]));
    const perItem = new Map<Id, number>();
    for (const entry of data.data.entries) perItem.set(entry.menuItemId, (perItem.get(entry.menuItemId) ?? 0) + 1);

    return data.data.entries.map((entry) => {
      const item = items.get(entry.menuItemId);
      const variant = item?.variants.find((row) => row.id === entry.variantId);
      const shared = (perItem.get(entry.menuItemId) ?? 0) > 1;
      const label: Localised = variant
        ? { en: `${entry.itemName.en} — ${variant.name.en}`, ar: `${entry.itemName.ar} — ${variant.name.ar}` }
        : shared
          ? { en: `${entry.itemName.en} (${entry.variantId.slice(-6)})`, ar: `${entry.itemName.ar} (${entry.variantId.slice(-6)})` }
          : entry.itemName;
      const codes = [entry.variantId, variant?.barcode ?? "", !shared ? (item?.barcodePlu ?? "") : ""].filter(Boolean);
      return {
        entry,
        label,
        categoryId: item?.categoryId ?? null,
        codes,
        cost: costs.costOf(entry.variantId, entry.menuItemId, variant?.recipeId),
      };
    });
  }, [data.data, costs]);

  return { state: data, rows, categories: data.data?.categories ?? [] };
}

// ---------------------------------------------------------------------------
// Apply a batch — shared by bulk and import
// ---------------------------------------------------------------------------

interface PlannedChange {
  row: PricingRow;
  next: number;
  effectiveAt: string | null;
}

async function applyPlan(
  list: PriceList,
  plan: PlannedChange[],
  actor: string,
  source: "bulk" | "import",
  onProgress: (done: number) => void,
): Promise<{ applied: number; scheduled: number; failed: { label: Localised; error: string }[] }> {
  const outcome = { applied: 0, scheduled: 0, failed: [] as { label: Localised; error: string }[] };
  let done = 0;
  for (const change of plan) {
    const target = {
      priceListId: list.id,
      priceListName: list.name,
      menuItemId: change.row.entry.menuItemId,
      variantId: change.row.entry.variantId,
      itemName: change.row.label,
      current: change.row.entry.price,
    };
    const money = { amount: change.next, currency: change.row.entry.price.currency };
    try {
      if (change.effectiveAt) {
        await services.menuPricing.schedules.create({
          ...target,
          priceAtScheduling: target.current,
          price: money,
          effectiveAt: change.effectiveAt,
          createdBy: actor,
        });
        outcome.scheduled += 1;
      } else {
        await changePrice(target, money, { actor, source });
        outcome.applied += 1;
      }
    } catch (caught) {
      outcome.failed.push({ label: change.row.label, error: caught instanceof Error ? caught.message : String(caught) });
    }
    done += 1;
    onProgress(done);
  }
  return outcome;
}

function PlanResult({
  result,
}: {
  result: { applied: number; scheduled: number; failed: { label: Localised; error: string }[] } | null;
}) {
  const { t, tx, fmt } = useI18n();
  if (!result) return null;
  return (
    <Callout tone={result.failed.length > 0 ? "warn" : "good"} title={t("mnp.batchDone")}>
      <p>
        {t("mnp.batchSummary")
          .replace("{applied}", formatNumber(result.applied, fmt))
          .replace("{scheduled}", formatNumber(result.scheduled, fmt))
          .replace("{failed}", formatNumber(result.failed.length, fmt))}
      </p>
      {result.failed.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {result.failed.map((failure, index) => (
            <li key={index}>
              {tx(failure.label)} — {failure.error}
            </li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-025 — bulk price operations
// ---------------------------------------------------------------------------

export function BulkPriceDrawer({
  list,
  settings,
  onClose,
  onDone,
}: {
  list: PriceList | null;
  settings: PricingSettings;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const confirm = useConfirm();
  const actor = useActor();
  const { state, rows, categories } = usePricingRows(list);

  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState<BulkOperation["kind"]>("percent");
  const [percent, setPercent] = useState("5");
  const [amount, setAmount] = useState<number | null>(0);
  const [rule, setRule] = useState<PricePointRule>(settings.pricePoint);
  const [effective, setEffective] = useState<EffectiveChoice>(() => ({
    mode: "now",
    at: localDateTimeValue(new Date(Date.now() + 24 * 3600_000)),
  }));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyPlan>> | null>(null);

  useEffect(() => setRule(settings.pricePoint), [settings.pricePoint]);

  const currency = rows[0]?.entry.price.currency ?? "EGP";
  const unit = unitOf(currencyExponent(currency));

  const operation = useMemo<BulkOperation | null>(() => {
    if (kind === "percent") {
      const bp = basisPoints(percent);
      return bp === null || bp <= -10_000 ? null : { kind, bp };
    }
    if (amount === null) return null;
    return kind === "amount" ? { kind, minor: amount } : { kind, minor: amount };
  }, [kind, percent, amount]);

  const preview = useMemo(() => {
    if (!operation) return [];
    return rows
      .filter((row) => !categoryId || row.categoryId === categoryId)
      .map((row) => {
        const next = applyBulk(row.entry.price.amount, operation, rule, unit);
        const margin = checkMargin(next, row.cost, settings.marginThresholdPercent);
        return { row, next, margin, key: row.entry.variantId };
      });
  }, [rows, categoryId, operation, rule, unit, settings.marginThresholdPercent]);

  const included = preview.filter((row) => !excluded.has(row.key) && row.next !== row.row.entry.price.amount);
  const breaches = included.filter((row) => row.margin.belowCost || row.margin.belowThreshold);

  if (!list) return null;

  async function apply() {
    if (!list || included.length === 0 || effectiveInvalid(effective)) return;
    const effectiveAt = effectiveIso(effective);
    const ok = await confirm({
      title: t("mnp.bulkConfirmTitle"),
      body: (effectiveAt ? t("mnp.bulkConfirmScheduled") : t("mnp.bulkConfirmBody"))
        .replace("{count}", formatNumber(included.length, fmt))
        .replace("{list}", tx(list.name)),
      detail:
        breaches.length > 0
          ? t("mnp.bulkConfirmBreaches").replace("{count}", formatNumber(breaches.length, fmt))
          : undefined,
      confirmLabel: t("mnp.applyChanges"),
      tone: breaches.length > 0 ? "warn" : "neutral",
    });
    if (!ok) return;
    setProgress(0);
    const outcome = await applyPlan(
      list,
      included.map((row) => ({ row: row.row, next: row.next, effectiveAt })),
      actor,
      "bulk",
      setProgress,
    );
    setProgress(null);
    setResult(outcome);
    onDone();
  }

  const columns: Column<(typeof preview)[number]>[] = [
    {
      key: "include",
      header: "",
      width: "2rem",
      render: (row) => (
        <input
          type="checkbox"
          aria-label={tx(row.row.label)}
          checked={!excluded.has(row.key)}
          onChange={(event) => {
            const next = new Set(excluded);
            if (event.target.checked) next.delete(row.key);
            else next.add(row.key);
            setExcluded(next);
          }}
        />
      ),
    },
    { key: "item", header: t("menu.itemName"), render: (row) => tx(row.row.label) },
    {
      key: "from",
      header: t("mnp.from"),
      numeric: true,
      render: (row) => formatMoney(row.row.entry.price, fmt),
    },
    {
      key: "to",
      header: t("mnp.to"),
      numeric: true,
      render: (row) => (
        <span className={cx(row.next === row.row.entry.price.amount && "text-fg-subtle")}>
          {formatMoney({ amount: row.next, currency: row.row.entry.price.currency }, fmt)}
        </span>
      ),
    },
    {
      key: "margin",
      header: t("mnp.margin"),
      numeric: true,
      render: (row) =>
        row.margin.marginPercent === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className={cx(row.margin.belowCost ? "text-bad font-semibold" : row.margin.belowThreshold ? "text-warn" : "text-good")}>
            {formatPercent(row.margin.marginPercent, fmt, 1)}
          </span>
        ),
    },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mnp.bulkTitle")}
      subtitle={tx(list.name)}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={progress !== null}
            disabled={included.length === 0 || effectiveInvalid(effective)}
            onClick={() => void apply()}
          >
            {t("mnp.reviewAndApply").replace("{count}", formatNumber(included.length, fmt))}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {progress !== null ? (
            <span className="text-fg-muted text-xs">
              {formatNumber(progress, fmt)} / {formatNumber(included.length, fmt)}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <PlanResult result={result} />
        <Callout tone="muted">{t("mnp.bulkIntro")}</Callout>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.category")}>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{t("mnp.allCategories")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {tx(category.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("mnp.operation")}>
            <Select value={kind} onChange={(event) => setKind(event.target.value as BulkOperation["kind"])}>
              <option value="percent">{t("mnp.opPercent")}</option>
              <option value="amount">{t("mnp.opAmount")}</option>
              <option value="set">{t("mnp.opSet")}</option>
            </Select>
          </Field>
        </div>

        {kind === "percent" ? (
          <Field label={t("mnp.percentChange")} hint={t("mnp.percentChangeHint")} error={operation ? null : t("mnp.percentInvalid")}>
            <Input dir="ltr" inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} />
          </Field>
        ) : (
          <Field label={kind === "amount" ? t("mnp.amountChange") : t("mnp.setPrice")} hint={kind === "amount" ? t("mnp.amountChangeHint") : undefined}>
            <MoneyInput currency={currency} value={amount} min={kind === "set" ? 0 : undefined} onChange={setAmount} />
          </Field>
        )}

        <PricePointFields currency={currency} value={rule} onChange={setRule} />
        <EffectiveField value={effective} onChange={setEffective} />

        {breaches.length > 0 ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />}>
            {t("mnp.breachesFlagged").replace("{count}", formatNumber(breaches.length, fmt))}
          </Callout>
        ) : null}

        <AsyncPanel state={state} isEmpty={() => rows.length === 0} empty={<Callout tone="muted">{t("menu.noEntries")}</Callout>}>
          {() => (
            <DataTable
              columns={columns}
              rows={preview}
              rowKey={(row) => row.key}
              caption={t("mnp.preview")}
              dense
            />
          )}
        </AsyncPanel>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-025 — CSV import with preview and confirm
// ---------------------------------------------------------------------------

export function PriceImportDrawer({
  list,
  settings,
  onClose,
  onDone,
}: {
  list: PriceList | null;
  settings: PricingSettings;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const confirm = useConfirm();
  const actor = useActor();
  const fileRef = useRef<HTMLInputElement>(null);
  const { state, rows } = usePricingRows(list);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyPlan>> | null>(null);

  const currency: Currency = rows[0]?.entry.price.currency ?? "EGP";
  const exponent = currencyExponent(currency);

  const catalogue = useMemo<ImportCatalogueVariant[]>(
    () =>
      rows.map((row) => ({
        variantId: row.entry.variantId,
        menuItemId: row.entry.menuItemId,
        label: tx(row.label),
        codes: row.codes,
        current: row.entry.price,
        cost: row.cost,
      })),
    [rows, tx],
  );

  const validation = useMemo(() => {
    if (!text.trim()) return null;
    return validateImport(parseCsv(text), catalogue, {
      currency,
      exponent,
      thresholdPercent: settings.marginThresholdPercent,
      now: new Date(),
    });
  }, [text, catalogue, currency, exponent, settings.marginThresholdPercent]);

  const importRows = validation?.rows ?? [];
  const valid = importRows.filter((row) => row.problems.length === 0 && !row.warnings.includes("no_change"));
  const invalid = importRows.filter((row) => row.problems.length > 0);
  const breaches = valid.filter((row) => row.warnings.includes("below_cost") || row.warnings.includes("below_threshold"));

  if (!list) return null;

  function template() {
    const header = "variant,price,effective_from,item\r\n";
    const body = rows
      .map((row) => {
        const major = (row.entry.price.amount / 10 ** exponent).toFixed(exponent);
        const name = tx(row.label).replace(/"/g, '""');
        return `${row.entry.variantId},${major},,"${name}"`;
      })
      .join("\r\n");
    downloadBlob(`﻿${header}${body}\r\n`, `prices-${list?.id ?? "list"}.csv`, "text/csv;charset=utf-8");
  }

  async function readFile(file: File) {
    setText(await file.text());
    setResult(null);
  }

  async function apply() {
    if (!list || valid.length === 0) return;
    const ok = await confirm({
      title: t("mnp.importConfirmTitle"),
      body: t("mnp.importConfirmBody")
        .replace("{count}", formatNumber(valid.length, fmt))
        .replace("{skipped}", formatNumber(invalid.length, fmt))
        .replace("{list}", tx(list.name)),
      detail:
        breaches.length > 0
          ? t("mnp.bulkConfirmBreaches").replace("{count}", formatNumber(breaches.length, fmt))
          : undefined,
      confirmLabel: t("mnp.applyChanges"),
      tone: breaches.length > 0 ? "warn" : "neutral",
    });
    if (!ok) return;

    const byVariant = new Map(rows.map((row) => [row.entry.variantId, row]));
    setProgress(0);
    const outcome = await applyPlan(
      list,
      valid.flatMap((row) => {
        const target = row.variantId ? byVariant.get(row.variantId) : undefined;
        return target && row.next ? [{ row: target, next: row.next.amount, effectiveAt: row.effectiveAt }] : [];
      }),
      actor,
      "import",
      setProgress,
    );
    setProgress(null);
    setResult(outcome);
    setText("");
    onDone();
  }

  const columns: Column<ImportRow>[] = [
    { key: "line", header: "#", numeric: true, width: "3rem", render: (row) => formatNumber(row.line, fmt) },
    { key: "item", header: t("menu.itemName"), render: (row) => <span dir="auto">{row.itemLabel}</span> },
    {
      key: "from",
      header: t("mnp.from"),
      numeric: true,
      render: (row) => (row.current ? formatMoney(row.current, fmt) : "—"),
    },
    {
      key: "to",
      header: t("mnp.to"),
      numeric: true,
      render: (row) => (row.next ? formatMoney(row.next, fmt) : <span className="text-bad">{row.raw.price || "—"}</span>),
    },
    {
      key: "effective",
      header: t("mnp.effective"),
      secondary: true,
      render: (row) => (row.effectiveAt ? formatDateTime(row.effectiveAt, fmt) : t("mnp.effectiveNow")),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.problems.map((problem) => (
            <Badge key={problem} tone="bad">
              {t(`mnp.problem.${problem}` as never)}
            </Badge>
          ))}
          {row.warnings.map((warning) => (
            <Badge key={warning} tone={warning === "below_cost" ? "bad" : warning === "no_change" ? "muted" : "warn"}>
              {t(`mnp.warning.${warning}` as never)}
            </Badge>
          ))}
          {row.problems.length === 0 && row.warnings.length === 0 ? <Badge tone="good">{t("mnp.rowOk")}</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mnp.importTitle")}
      subtitle={tx(list.name)}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={progress !== null} disabled={valid.length === 0} onClick={() => void apply()}>
            {t("mnp.reviewAndApply").replace("{count}", formatNumber(valid.length, fmt))}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <PlanResult result={result} />
        <Callout tone="muted">{t("mnp.importIntro")}</Callout>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download size={13} />} disabled={state.loading} onClick={template}>
            {t("mnp.downloadTemplate")}
          </Button>
          <Button size="sm" icon={<FileUp size={13} />} onClick={() => fileRef.current?.click()}>
            {t("mnp.chooseFile")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
              event.target.value = "";
            }}
          />
        </div>

        <Field label={t("mnp.pasteCsv")} hint={t("mnp.pasteCsvHint")}>
          <Textarea rows={5} dir="ltr" className="font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>

        {validation && validation.missingColumns.length > 0 ? (
          <Callout tone="bad">
            {t("mnp.missingColumns").replace("{columns}", validation.missingColumns.join(", "))}
          </Callout>
        ) : null}

        {importRows.length > 0 ? (
          <>
            <p className="text-fg-muted text-xs">
              {t("mnp.importCounts")
                .replace("{valid}", formatNumber(valid.length, fmt))
                .replace("{invalid}", formatNumber(invalid.length, fmt))
                .replace("{total}", formatNumber(importRows.length, fmt))}
            </p>
            <DataTable columns={columns} rows={importRows} rowKey={(row) => String(row.line)} caption={t("mnp.preview")} dense />
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-024 — history
// ---------------------------------------------------------------------------

export function PriceHistoryPanel({
  priceListId,
  variantId,
  nonce = 0,
}: {
  priceListId?: Id;
  variantId?: Id;
  nonce?: number;
}) {
  const { t, tx, fmt } = useI18n();
  const history = useAsync(
    async () =>
      (await services.menuPricing.history.all())
        .filter((row) => (!priceListId || row.priceListId === priceListId) && (!variantId || row.variantId === variantId))
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    [priceListId, variantId, nonce],
  );

  type Row = NonNullable<typeof history.data>[number];
  const columns: Column<Row>[] = [
    {
      key: "changedAt",
      header: t("mnp.changedAt"),
      render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.changedAt, fmt)}</span>,
    },
    { key: "item", header: t("menu.itemName"), render: (row) => tx(row.itemName) },
    ...(priceListId ? [] : [{ key: "list", header: t("mnp.priceList"), secondary: true, render: (row: Row) => tx(row.priceListName) }]),
    { key: "from", header: t("mnp.from"), numeric: true, render: (row) => (row.from ? formatMoney(row.from, fmt) : "—") },
    { key: "to", header: t("mnp.to"), numeric: true, render: (row) => formatMoney(row.to, fmt) },
    {
      key: "effectiveAt",
      header: t("mnp.effective"),
      render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.effectiveAt, fmt)}</span>,
    },
    { key: "changedBy", header: t("mnp.changedBy"), secondary: true, render: (row) => <span dir="ltr">{row.changedBy}</span> },
    { key: "source", header: t("mnp.source"), render: (row) => <Badge tone="muted">{t(`mnp.source.${row.source}` as never)}</Badge> },
  ];

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
          <History size={14} aria-hidden /> {t("mnp.historyTitle")}
        </h3>
        <ExportButton
          filename="price-history"
          title={t("mnp.historyTitle")}
          rows={history.data ?? []}
          columns={[
            { key: "changedAt", header: t("mnp.changedAt"), value: (row) => row.changedAt },
            { key: "list", header: t("mnp.priceList"), value: (row) => tx(row.priceListName) },
            { key: "item", header: t("menu.itemName"), value: (row) => tx(row.itemName) },
            { key: "variant", header: "variant", value: (row) => row.variantId },
            { key: "from", header: t("mnp.from"), value: (row) => row.from?.amount ?? null },
            { key: "to", header: t("mnp.to"), value: (row) => row.to.amount },
            { key: "currency", header: "currency", value: (row) => row.to.currency },
            { key: "effectiveAt", header: t("mnp.effective"), value: (row) => row.effectiveAt },
            { key: "changedBy", header: t("mnp.changedBy"), value: (row) => row.changedBy },
            { key: "source", header: t("mnp.source"), value: (row) => row.source },
          ]}
        />
      </div>
      <p className="text-fg-subtle text-xs leading-relaxed">{t("mnp.historyScope")}</p>
      <AsyncPanel
        state={history}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("mnp.historyEmpty")}</Callout>}
      >
        {(rows) => <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={t("mnp.historyTitle")} dense />}
      </AsyncPanel>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Future-dated prices
// ---------------------------------------------------------------------------

export function ScheduledPricesPanel({
  priceListId,
  nonce = 0,
  onChanged,
  onApplyDue,
}: {
  priceListId?: Id;
  nonce?: number;
  onChanged: (message: string) => void;
  onApplyDue: () => Promise<void>;
}) {
  const { t, tx, fmt } = useI18n();
  const confirm = useConfirm();
  const actor = useActor();
  const canChange = usePermission("menu.price.change");
  const [local, setLocal] = useState(0);
  const [applying, setApplying] = useState(false);

  const schedules = useAsync(
    async () =>
      (await services.menuPricing.schedules.all())
        .filter((row) => !priceListId || row.priceListId === priceListId)
        .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt)),
    [priceListId, nonce, local],
  );

  const pending = (schedules.data ?? []).filter((row) => row.status === "pending");
  const due = pending.filter((row) => new Date(row.effectiveAt).getTime() <= Date.now());

  async function cancel(row: ScheduledPriceChange) {
    const ok = await confirm({
      title: t("mnp.cancelScheduleTitle"),
      body: t("mnp.cancelScheduleBody")
        .replace("{item}", tx(row.itemName))
        .replace("{price}", formatMoney(row.price, fmt))
        .replace("{at}", formatDateTime(row.effectiveAt, fmt)),
      confirmLabel: t("mnp.cancelSchedule"),
      tone: "danger",
    });
    if (!ok) return;
    await services.menuPricing.schedules.update(row.id, {
      status: "cancelled",
      resolvedAt: new Date().toISOString(),
      resolvedBy: actor,
    });
    setLocal((n) => n + 1);
    onChanged(t("mnp.scheduleCancelled"));
  }

  const columns: Column<ScheduledPriceChange>[] = [
    {
      key: "effectiveAt",
      header: t("mnp.effective"),
      render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.effectiveAt, fmt)}</span>,
    },
    { key: "item", header: t("menu.itemName"), render: (row) => tx(row.itemName) },
    ...(priceListId
      ? []
      : [{ key: "list", header: t("mnp.priceList"), secondary: true, render: (row: ScheduledPriceChange) => tx(row.priceListName) }]),
    {
      key: "from",
      header: t("mnp.from"),
      numeric: true,
      render: (row) => (row.priceAtScheduling ? formatMoney(row.priceAtScheduling, fmt) : "—"),
    },
    { key: "to", header: t("mnp.to"), numeric: true, render: (row) => formatMoney(row.price, fmt) },
    { key: "createdBy", header: t("mnp.changedBy"), secondary: true, render: (row) => <span dir="ltr">{row.createdBy}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={row.status === "applied" ? "good" : row.status === "failed" ? "bad" : row.status === "cancelled" ? "muted" : "warn"}>
            {t(`mnp.schedule.${row.status}` as never)}
          </Badge>
          {row.error ? <span className="text-bad text-xs">{row.error}</span> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canChange && row.status === "pending" ? (
          <Button size="sm" variant="ghost" icon={<XCircle size={12} />} onClick={() => void cancel(row)}>
            {t("mnp.cancelSchedule")}
          </Button>
        ) : null,
    },
  ];

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock size={14} aria-hidden /> {t("mnp.scheduledTitle")}
          {pending.length > 0 ? <Badge tone="warn">{formatNumber(pending.length, fmt)}</Badge> : null}
        </h3>
        {canChange && due.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            loading={applying}
            onClick={async () => {
              setApplying(true);
              await onApplyDue();
              setApplying(false);
              setLocal((n) => n + 1);
            }}
          >
            {t("mnp.applyDue").replace("{count}", formatNumber(due.length, fmt))}
          </Button>
        ) : null}
      </div>
      <p className="text-fg-subtle text-xs leading-relaxed">{t("mnp.scheduleHonesty")}</p>
      <AsyncPanel
        state={schedules}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("mnp.scheduledEmpty")}</Callout>}
      >
        {(rows) => <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={t("mnp.scheduledTitle")} dense />}
      </AsyncPanel>
    </section>
  );
}

export { Settings2 as SettingsIcon };
