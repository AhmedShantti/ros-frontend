"use client";

/**
 * Reconciliation forms and detail drawers — FR-FIN-011, FR-FIN-012.
 *
 * Statements are entered by hand or pasted/uploaded as CSV; a CSV is parsed
 * and previewed with its row-level problems before anything is stored. The
 * system side is never entered — it is recomputed from orders.
 */

import { useMemo, useState, type ChangeEvent } from "react";
import { Plus, Trash2, Upload } from "lucide-react";

import type { Currency, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type {
  AggregatorTerms,
  CardBatchLine,
  DiscrepancyResolution,
  PayoutOrderRef,
  ResolutionStatus,
} from "@/lib/console/services/finance-settlements";
import {
  CARD_CSV_COLUMNS,
  CARD_CSV_OPTIONAL,
  PAYOUT_CSV_COLUMNS,
  parseCardCsv,
  parsePayoutCsv,
  type CardMatch,
  type PayoutMatch,
} from "@/lib/console/finance-reconciliation";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { MoneyInput, PercentInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { DataTable, type Column } from "@/components/console/data-table";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  cx,
} from "@/components/console/ui";

const RESOLUTION_TONE: Record<ResolutionStatus, "bad" | "good" | "muted" | "warn"> = {
  open: "bad",
  explained: "good",
  written_off: "muted",
  disputed: "warn",
};

async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const file = event.target.files?.[0];
  if (!file) return null;
  return file.text();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function ResolutionBadge({ resolution, flagged }: { resolution: DiscrepancyResolution | undefined; flagged: boolean }) {
  const { t } = useI18n();
  if (!flagged) return <Badge tone="good">{t("fnc.matched")}</Badge>;
  const status = resolution?.status ?? "open";
  return <Badge tone={RESOLUTION_TONE[status]}>{t(`fnc.res.${status}` as ConsoleKey)}</Badge>;
}

/** Append-only resolution of one flagged difference, with its history. */
export function ResolutionControl({
  resolutionKey,
  resolution,
  onSaved,
}: {
  resolutionKey: string;
  resolution: DiscrepancyResolution | undefined;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const [status, setStatus] = useState<ResolutionStatus>(resolution?.status === "open" || !resolution ? "explained" : resolution.status);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await services.settlements.resolutions.record(resolutionKey, { status, note, by: session?.user.email ?? null });
      setNote("");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-line bg-sunken/40 mt-2 space-y-2 rounded-lg border p-2">
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Select value={status} onChange={(event) => setStatus(event.target.value as ResolutionStatus)}>
          {(["explained", "written_off", "disputed", "open"] as ResolutionStatus[]).map((value) => (
            <option key={value} value={value}>
              {t(`fnc.res.${value}` as ConsoleKey)}
            </option>
          ))}
        </Select>
        <Input value={note} placeholder={t("fnc.resolutionNote")} onChange={(event) => setNote(event.target.value)} />
      </div>
      <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={save}>
        {t("fnc.saveResolution")}
      </Button>
      {resolution?.history.length ? (
        <ul className="space-y-1 text-[0.7rem]">
          {resolution.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="text-fg-subtle">
              <span className="text-fg-muted">{t(`fnc.res.${entry.status}` as ConsoleKey)}</span> · {entry.note || "—"} ·{" "}
              {formatDateTime(entry.at, fmt)} · {entry.by ?? "—"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card batch — entry
// ---------------------------------------------------------------------------

interface LineDraft {
  scheme: string;
  count: string;
  amount: number | null;
}

export function CardBatchForm({
  open,
  currency,
  onClose,
  onSaved,
}: {
  open: boolean;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const { availableBranches, session } = useSession();
  const [acquirer, setAcquirer] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [businessDay, setBusinessDay] = useState("");
  const [terminalName, setTerminalName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [fees, setFees] = useState<number | null>(0);
  const [lines, setLines] = useState<LineDraft[]>([{ scheme: "", count: "", amount: null }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsedLines: CardBatchLine[] = lines
    .filter((line) => line.scheme.trim() !== "")
    .map((line) => ({ scheme: line.scheme.trim().toLowerCase(), count: Number(line.count), amountMinor: line.amount ?? NaN }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await services.settlements.batches.create({
        acquirer: acquirer.trim(),
        batchNumber: batchNumber.trim(),
        businessDay,
        terminalName: terminalName.trim() || null,
        branchId: branchId || null,
        currency,
        feesMinor: fees ?? 0,
        lines: parsedLines,
        source: "manual",
        importedBy: session?.user.email ?? null,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("fnc.enterBatch")}
      subtitle={t("fnc.enterBatchHint")}
      footer={
        <Button variant="primary" loading={busy} disabled={busy} onClick={save}>
          {t("fnc.saveBatch")}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("fnc.acquirer")} required>
            <Input value={acquirer} onChange={(event) => setAcquirer(event.target.value)} />
          </Field>
          <Field label={t("fnc.batchNumber")} required>
            <Input dir="ltr" value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} />
          </Field>
          <Field label={t("fin.businessDay")} required>
            <Input type="date" dir="ltr" value={businessDay} onChange={(event) => setBusinessDay(event.target.value)} />
          </Field>
          <Field label={t("fnc.terminal")} hint={t("fnc.terminalHint")}>
            <Input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} />
          </Field>
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">{t("fnc.anyBranch")}</option>
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fnc.fees")}>
            <MoneyInput value={fees} onChange={setFees} currency={currency} min={0} />
          </Field>
        </div>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.schemeLines")}</h3>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_1fr_auto] items-end gap-2">
                <Field label={t("fnc.scheme")}>
                  <Input
                    dir="ltr"
                    value={line.scheme}
                    placeholder="visa"
                    onChange={(event) =>
                      setLines((all) => all.map((row, i) => (i === index ? { ...row, scheme: event.target.value } : row)))
                    }
                  />
                </Field>
                <Field label={t("fin.count")}>
                  <Input
                    inputMode="numeric"
                    dir="ltr"
                    value={line.count}
                    onChange={(event) =>
                      setLines((all) => all.map((row, i) => (i === index ? { ...row, count: event.target.value } : row)))
                    }
                  />
                </Field>
                <Field label={t("fin.amount")}>
                  <MoneyInput
                    value={line.amount}
                    currency={currency}
                    onChange={(amount) => setLines((all) => all.map((row, i) => (i === index ? { ...row, amount } : row)))}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.delete")}
                  icon={<Trash2 size={14} />}
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((_, i) => i !== index))}
                >
                  {""}
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            icon={<Plus size={14} />}
            onClick={() => setLines((all) => [...all, { scheme: "", count: "", amount: null }])}
          >
            {t("fnc.addLine")}
          </Button>
        </section>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Card batch — CSV import
// ---------------------------------------------------------------------------

export function CardCsvImport({
  open,
  currency,
  onClose,
  onSaved,
}: {
  open: boolean;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const [text, setText] = useState("");
  const [acquirer, setAcquirer] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseCardCsv(text, acquirer.trim() || "—") : null), [text, acquirer]);

  async function importAll() {
    if (!parsed) return;
    setBusy(true);
    const failures: string[] = [];
    let imported = 0;
    for (const batch of parsed.batches) {
      try {
        await services.settlements.batches.create({
          ...batch,
          branchId: null,
          currency,
          source: "csv",
          importedBy: session?.user.email ?? null,
        });
        imported += 1;
      } catch (caught) {
        failures.push(`${batch.batchNumber}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    setBusy(false);
    setResult(
      t("fnc.importResult")
        .replace("{ok}", formatNumber(imported, fmt))
        .replace("{failed}", formatNumber(failures.length, fmt)) + (failures.length ? ` — ${failures.join("; ")}` : ""),
    );
    if (imported > 0) onSaved();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("fnc.importCsv")}
      subtitle={t("fnc.cardCsvHint")}
      footer={
        <Button
          variant="primary"
          icon={<Upload size={14} />}
          loading={busy}
          disabled={busy || !parsed || parsed.batches.length === 0 || parsed.missingColumns.length > 0}
          onClick={importAll}
        >
          {t("fnc.importBatches")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">
          <span dir="ltr" className="font-mono text-xs">
            {[...CARD_CSV_COLUMNS, ...CARD_CSV_OPTIONAL.map((c) => `[${c}]`)].join(",")}
          </span>
        </Callout>
        <Field label={t("fnc.acquirer")} hint={t("fnc.acquirerDefaultHint")}>
          <Input value={acquirer} onChange={(event) => setAcquirer(event.target.value)} />
        </Field>
        <Field label={t("fnc.csvFile")}>
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-fg-muted text-xs"
            onChange={async (event) => {
              const content = await readFile(event);
              if (content !== null) setText(content);
            }}
          />
        </Field>
        <Field label={t("fnc.csvPaste")}>
          <Textarea dir="ltr" rows={6} className="font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>

        {result ? <Callout tone="accent">{result}</Callout> : null}

        {parsed ? (
          parsed.missingColumns.length > 0 ? (
            <Callout tone="bad" title={t("fnc.missingColumns")}>
              <span dir="ltr" className="font-mono text-xs">{parsed.missingColumns.join(", ")}</span>
            </Callout>
          ) : (
            <>
              {parsed.issues.length > 0 ? (
                <Callout tone="warn" title={t("fnc.rowsSkipped")}>
                  <ul className="text-xs">
                    {parsed.issues.map((issue) => (
                      <li key={`${issue.row}-${issue.message}`}>
                        {t("fnc.row")} {issue.row}: <span dir="ltr">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
              <h3 className="text-fg text-sm font-semibold">{t("fnc.preview")}</h3>
              <ul className="divide-line divide-y text-sm">
                {parsed.batches.map((batch) => (
                  <li key={`${batch.acquirer}-${batch.batchNumber}`} className="py-2">
                    <p className="text-fg">
                      <span className="font-mono" dir="ltr">{batch.batchNumber}</span> · {formatDate(batch.businessDay, fmt)} ·{" "}
                      {batch.acquirer}
                    </p>
                    <p className="text-fg-subtle text-xs">
                      {batch.lines
                        .map((line) => `${line.scheme.toUpperCase()} ${line.count} × ${formatMoney(money(line.amountMinor, currency), fmt)}`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Card batch — detail
// ---------------------------------------------------------------------------

export function CardMatchDrawer({
  match,
  resolutions,
  onClose,
  onChanged,
}: {
  match: CardMatch | null;
  resolutions: Map<string, DiscrepancyResolution>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!match) return null;
  const { batch } = match;
  const currency = batch.currency;
  const m = (amount: number) => formatMoney(money(amount, currency), fmt);

  async function remove() {
    const ok = await confirm({
      title: t("fnc.deleteBatchTitle"),
      body: t("fnc.deleteBatchBody").replace("{batch}", batch.batchNumber),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await services.settlements.batches.remove(batch.id);
    onChanged();
    onClose();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("fnc.batchNumber")} ${batch.batchNumber}`}
      subtitle={`${batch.acquirer} · ${formatDate(batch.businessDay, fmt)}${batch.terminalName ? ` · ${batch.terminalName}` : ""}`}
      footer={
        <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove}>
          {t("fnc.deleteBatch")}
        </Button>
      }
    >
      <div className="space-y-4">
        <DescList>
          <DescRow label={t("fnc.statementTotal")} mono>{m(match.statementTotal)}</DescRow>
          <DescRow label={t("fnc.systemTotal")} mono>{m(match.systemTotal)}</DescRow>
          <DescRow label={t("common.variance")} mono>
            <span className={cx(match.difference !== 0 && "text-bad font-semibold")}>{m(match.difference)}</span>
          </DescRow>
          <DescRow label={t("fnc.fees")} mono>{m(batch.feesMinor)}</DescRow>
          <DescRow label={t("fnc.source")}>{t(`fnc.source.${batch.source}` as ConsoleKey)}</DescRow>
        </DescList>

        <ul className="divide-line divide-y">
          {match.rows.map((row) => (
            <li key={row.key} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg font-medium uppercase">{row.scheme}</span>
                <span className="flex items-center gap-1.5">
                  {row.side !== "both" ? <Badge tone="warn">{t(`fnc.side.${row.side}` as ConsoleKey)}</Badge> : null}
                  <ResolutionBadge resolution={resolutions.get(row.key)} flagged={row.flagged} />
                </span>
              </div>
              <p className="text-fg-subtle mt-1 font-mono text-xs tabular-nums">
                {t("fnc.statement")} {formatNumber(row.statementCount, fmt)} · {m(row.statementAmount)} — {t("fnc.system")}{" "}
                {formatNumber(row.systemCount, fmt)} · {m(row.systemAmount)} — Δ {m(row.difference)}
              </p>
              {row.flagged ? (
                openKey === row.key ? (
                  <ResolutionControl resolutionKey={row.key} resolution={resolutions.get(row.key)} onSaved={onChanged} />
                ) : (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpenKey(row.key)}>
                    {t("fnc.resolve")}
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Aggregator terms
// ---------------------------------------------------------------------------

export function TermsEditor({
  terms,
  currency,
  onSaved,
}: {
  terms: AggregatorTerms[];
  currency: Currency;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const [aggregator, setAggregator] = useState("");
  const [commission, setCommission] = useState("");
  const [fee, setFee] = useState<number | null>(0);
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(row: AggregatorTerms) {
    setAggregator(row.aggregator);
    setCommission(String(row.commissionPercent));
    setFee(row.fixedFeeMinor);
    setPrefix(row.refPrefix ?? "");
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await services.settlements.terms.save({
        aggregator: aggregator.trim(),
        commissionPercent: Number(commission),
        fixedFeeMinor: fee ?? 0,
        refPrefix: prefix.trim() || null,
      });
      setAggregator("");
      setCommission("");
      setFee(0);
      setPrefix("");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AggregatorTerms>[] = [
    { key: "aggregator", header: t("fnc.aggregator"), render: (row) => row.aggregator },
    { key: "commission", header: t("fnc.commissionPercent"), numeric: true, render: (row) => `${formatNumber(row.commissionPercent, fmt, 2)}%` },
    { key: "fee", header: t("fnc.fixedFee"), numeric: true, render: (row) => formatMoney(money(row.fixedFeeMinor, currency), fmt) },
    { key: "prefix", header: t("fnc.refPrefix"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.refPrefix ?? "—"}</span> },
    { key: "edit", header: "", render: (row) => <Button size="sm" variant="ghost" onClick={() => edit(row)}>{t("common.edit")}</Button> },
  ];

  return (
    <div className="space-y-3">
      <DataTable columns={columns} rows={terms} rowKey={(row) => row.aggregator} caption={t("fnc.terms")} dense emptyTitle={t("fnc.noTerms")} />
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <div className="grid items-end gap-2 sm:grid-cols-5">
        <Field label={t("fnc.aggregator")} required>
          <Input value={aggregator} onChange={(event) => setAggregator(event.target.value)} />
        </Field>
        <Field label={t("fnc.commissionPercent")} required>
          <PercentInput value={commission} onChange={setCommission} />
        </Field>
        <Field label={t("fnc.fixedFee")}>
          <MoneyInput value={fee} onChange={setFee} currency={currency} min={0} />
        </Field>
        <Field label={t("fnc.refPrefix")}>
          <Input dir="ltr" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
        </Field>
        <Button variant="secondary" loading={busy} disabled={busy || !aggregator.trim() || commission.trim() === ""} onClick={save}>
          {t("fnc.saveTerms")}
        </Button>
      </div>
      <p className="text-fg-subtle text-xs">{t("fnc.refPrefixHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout statement — entry
// ---------------------------------------------------------------------------

export function PayoutForm({
  open,
  currency,
  terms,
  onClose,
  onSaved,
}: {
  open: boolean;
  currency: Currency;
  terms: AggregatorTerms[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches, session } = useSession();
  const [aggregator, setAggregator] = useState("");
  const [branchId, setBranchId] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [gross, setGross] = useState<number | null>(null);
  const [commission, setCommission] = useState<number | null>(null);
  const [fees, setFees] = useState<number | null>(0);
  const [adjustments, setAdjustments] = useState<number | null>(0);
  const [net, setNet] = useState<number | null>(null);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (csv.trim() ? parsePayoutCsv(csv) : null), [csv]);
  const arithmetic = (gross ?? 0) - (commission ?? 0) - (fees ?? 0) + (adjustments ?? 0);
  const arithmeticOff = net !== null && gross !== null && arithmetic !== net;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const refs: PayoutOrderRef[] = parsed && parsed.missingColumns.length === 0 ? parsed.refs : [];
      await services.settlements.payouts.create({
        aggregator: aggregator.trim(),
        branchId: branchId || null,
        periodFrom,
        periodTo,
        currency,
        grossMinor: gross ?? 0,
        commissionMinor: commission ?? 0,
        feesMinor: fees ?? 0,
        adjustmentsMinor: adjustments ?? 0,
        netPayoutMinor: net ?? NaN,
        orderRefs: refs,
        source: refs.length > 0 ? "csv" : "manual",
        importedBy: session?.user.email ?? null,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("fnc.enterPayout")}
      subtitle={t("fnc.enterPayoutHint")}
      footer={
        <Button variant="primary" loading={busy} disabled={busy || (parsed?.missingColumns.length ?? 0) > 0} onClick={save}>
          {t("fnc.savePayout")}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("fnc.aggregator")} required hint={terms.length === 0 ? t("fnc.noTerms") : undefined}>
            <Input list="fnc-aggregators" value={aggregator} onChange={(event) => setAggregator(event.target.value)} />
            <datalist id="fnc-aggregators">
              {terms.map((row) => (
                <option key={row.aggregator} value={row.aggregator} />
              ))}
            </datalist>
          </Field>
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">{t("fnc.anyBranch")}</option>
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fnc.periodFrom")} required>
            <Input type="date" dir="ltr" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
          </Field>
          <Field label={t("fnc.periodTo")} required>
            <Input type="date" dir="ltr" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
          </Field>
          <Field label={t("fnc.statementGross")}>
            <MoneyInput value={gross} onChange={setGross} currency={currency} min={0} />
          </Field>
          <Field label={t("fnc.statementCommission")}>
            <MoneyInput value={commission} onChange={setCommission} currency={currency} min={0} />
          </Field>
          <Field label={t("fnc.fees")}>
            <MoneyInput value={fees} onChange={setFees} currency={currency} min={0} />
          </Field>
          <Field label={t("fnc.adjustments")} hint={t("fnc.adjustmentsHint")}>
            <MoneyInput value={adjustments} onChange={setAdjustments} currency={currency} />
          </Field>
          <Field label={t("fnc.netPayout")} required>
            <MoneyInput value={net} onChange={setNet} currency={currency} />
          </Field>
        </div>
        {arithmeticOff ? (
          <Callout tone="warn">
            {t("fnc.statementArithmetic").replace("{value}", formatMoney(money(arithmetic, currency), fmt))}
          </Callout>
        ) : null}

        <Field label={t("fnc.orderRefsCsv")} hint={`${PAYOUT_CSV_COLUMNS.join(",")} — ${t("fnc.orderRefsHint")}`}>
          <Textarea dir="ltr" rows={5} className="font-mono text-xs" value={csv} onChange={(event) => setCsv(event.target.value)} />
        </Field>
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-fg-muted text-xs"
          onChange={async (event) => {
            const content = await readFile(event);
            if (content !== null) setCsv(content);
          }}
        />
        {parsed ? (
          parsed.missingColumns.length > 0 ? (
            <Callout tone="bad" title={t("fnc.missingColumns")}>
              <span dir="ltr" className="font-mono text-xs">{parsed.missingColumns.join(", ")}</span>
            </Callout>
          ) : (
            <Callout tone={parsed.issues.length ? "warn" : "muted"} title={t("fnc.preview")}>
              <p>
                {formatNumber(parsed.refs.length, fmt)} {t("fnc.orderRefs")} ·{" "}
                {formatMoney(money(parsed.refs.reduce((sum, row) => sum + row.grossMinor, 0), currency), fmt)}
              </p>
              {parsed.issues.map((issue) => (
                <p key={`${issue.row}-${issue.message}`} className="text-xs">
                  {t("fnc.row")} {issue.row}: <span dir="ltr">{issue.message}</span>
                </p>
              ))}
            </Callout>
          )
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Payout statement — detail
// ---------------------------------------------------------------------------

export function PayoutMatchDrawer({
  match,
  resolutions,
  onClose,
  onChanged,
}: {
  match: PayoutMatch | null;
  resolutions: Map<string, DiscrepancyResolution>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const [openKey, setOpenKey] = useState<Id | null>(null);
  if (!match) return null;
  const { statement } = match;
  const m = (amount: number) => formatMoney(money(amount, statement.currency), fmt);

  async function remove() {
    const ok = await confirm({
      title: t("fnc.deletePayoutTitle"),
      body: t("fnc.deletePayoutBody").replace("{aggregator}", statement.aggregator),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await services.settlements.payouts.remove(statement.id);
    onChanged();
    onClose();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={statement.aggregator}
      subtitle={`${formatDate(statement.periodFrom, fmt)} → ${formatDate(statement.periodTo, fmt)}`}
      footer={
        <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove}>
          {t("fnc.deletePayout")}
        </Button>
      }
    >
      <div className="space-y-4">
        {!match.terms ? <Callout tone="warn">{t("fnc.noTermsForAggregator")}</Callout> : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-fg-subtle text-xs">
              <th className="text-start font-normal" />
              <th className="text-end font-normal">{t("fnc.statement")}</th>
              <th className="text-end font-normal">{t("fnc.expected")}</th>
              <th className="text-end font-normal">Δ</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            <tr>
              <td className="text-fg-muted font-sans">{t("fnc.gross")}</td>
              <td className="text-end">{m(statement.grossMinor)}</td>
              <td className="text-end">{m(match.systemGross)}</td>
              <td className={cx("text-end", match.grossDifference !== 0 && "text-warn")}>{m(match.grossDifference)}</td>
            </tr>
            <tr>
              <td className="text-fg-muted font-sans">{t("fnc.commission")}</td>
              <td className="text-end">{m(statement.commissionMinor)}</td>
              <td className="text-end">{m(match.expectedCommission)}</td>
              <td className={cx("text-end", match.commissionDifference !== 0 && "text-warn")}>{m(match.commissionDifference)}</td>
            </tr>
            <tr>
              <td className="text-fg-muted font-sans">{t("fnc.fees")}</td>
              <td className="text-end">{m(statement.feesMinor)}</td>
              <td className="text-end">{m(match.expectedFees)}</td>
              <td className="text-end">{m(statement.feesMinor - match.expectedFees)}</td>
            </tr>
            <tr>
              <td className="text-fg-muted font-sans">{t("fnc.adjustments")}</td>
              <td className="text-end">{m(statement.adjustmentsMinor)}</td>
              <td className="text-end">—</td>
              <td className="text-end">—</td>
            </tr>
            <tr className="border-line border-t font-semibold">
              <td className="text-fg font-sans">{t("fnc.netPayout")}</td>
              <td className="text-end">{m(statement.netPayoutMinor)}</td>
              <td className="text-end">{m(match.expectedNet)}</td>
              <td className={cx("text-end", match.totalFlagged && "text-bad")}>{m(match.netDifference)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-fg-subtle text-xs">
          {t("fnc.expectedFormula")} · {formatNumber(match.orderCount, fmt)} {t("fnc.ordersInPeriod")}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-fg text-sm font-medium">{t("fnc.statementTotal")}</span>
          <ResolutionBadge resolution={resolutions.get(match.totalKey)} flagged={match.totalFlagged} />
        </div>
        {match.totalFlagged ? (
          <ResolutionControl resolutionKey={match.totalKey} resolution={resolutions.get(match.totalKey)} onSaved={onChanged} />
        ) : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.orderRefs")}</h3>
          {match.orders.length === 0 ? (
            <p className="text-fg-subtle text-sm">{t("fnc.noOrderRefs")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {match.orders.map((row) => (
                <li key={row.key} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs" dir="ltr">
                      {row.ref}
                      {row.orderNumber ? ` · #${row.orderNumber}` : ""}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {row.side !== "both" ? <Badge tone="warn">{t(`fnc.side.${row.side}` as ConsoleKey)}</Badge> : null}
                      <ResolutionBadge resolution={resolutions.get(row.key)} flagged={row.flagged} />
                    </span>
                  </div>
                  <p className="text-fg-subtle mt-0.5 font-mono text-xs tabular-nums">
                    {row.statementGross === null ? "—" : m(row.statementGross)} / {row.systemGross === null ? "—" : m(row.systemGross)} — Δ{" "}
                    {m(row.difference)}
                  </p>
                  {row.flagged ? (
                    openKey === row.key ? (
                      <ResolutionControl resolutionKey={row.key} resolution={resolutions.get(row.key)} onSaved={onChanged} />
                    ) : (
                      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpenKey(row.key)}>
                        {t("fnc.resolve")}
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}
