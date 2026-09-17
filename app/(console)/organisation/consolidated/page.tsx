"use client";

/**
 * Consolidated multi-currency view — FR-BRN-003, FR-BRN-004.
 *
 * A tenant with a branch in Cairo and one in Riyadh trades in EGP and SAR
 * under two different country packs. This page is where those are read
 * together without pretending they are one currency:
 *
 *   - every branch's figure stays in its own currency, beside the country
 *     pack version it trades under;
 *   - the consolidated total is a separate figure, converted per branch at a
 *     rate whose value, source and date are printed next to it;
 *   - a currency with no rate on or before the report date is left out of
 *     the total and the total says so — it is never converted at 1:1 or at
 *     an older rate the reader cannot see.
 *
 * Rates are recorded here too. They are not edited: a rate a report was
 * converted at has to stay readable, so a correction is a new dated rate.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Branch, Currency, IsoDate } from "@/lib/console/types";
import { consolidate, rateProblem, REPORTING_CURRENCIES, type FxRate } from "@/lib/console/branch-fx";
import { versionInForce } from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber, formatPercent, toMajorUnits } from "@/lib/console/format";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { ExportButton } from "@/components/console/export-button";
import { ConsolidatedTotal, ConvertedMoney } from "@/components/console/branch-money";
import { BranchGroupSelect, useBranchGroups, useGroupBranchIds } from "@/components/console/branch-group-filter";
import { Badge, Button, Callout, Field, IconButton, Input, Select, Toast } from "@/components/console/ui";

export default function ConsolidatedPage() {
  return (
    <Gate permissions={["report.view.sales", "report.view.financial", "org.manage"]}>
      <Consolidated />
    </Gate>
  );
}

type Measure = "netSales" | "varianceValue";

function Consolidated() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches, canAny } = useSession();
  const [message, setMessage] = useTransientMessage();
  const [reporting, setReporting] = useState<Currency>("EGP");
  const [asOfInput, setAsOfInput] = useState("");
  const [groupId, setGroupId] = useState("");
  const [measure, setMeasure] = useState<Measure>("netSales");

  const groups = useBranchGroups();
  const allowed = useGroupBranchIds(groups.data, groupId);

  const data = useAsync(async () => {
    const [dashboard, rates, packs] = await Promise.all([
      services.dashboard.get({ ...scope, branchId: null }),
      services.branchNetwork.fxRates.all(),
      services.localisation.packVersions.all().catch(() => []),
    ]);
    return { dashboard, rates, packs };
  }, [scope.tenantId, scope.brandId]);

  const branchById = useMemo(() => new Map(availableBranches.map((row) => [row.id, row])), [availableBranches]);
  const asOf: IsoDate = asOfInput || data.data?.dashboard.businessDay || new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const ready = data.data;
    if (!ready) return [];
    return ready.dashboard.branchRanking
      .filter((row) => !allowed || allowed.has(row.branchId))
      .map((row) => {
        const branch = branchById.get(row.branchId);
        const recorded = measure === "netSales" ? row.netSales : row.varianceValue;
        // FR-BRN-003 — sales are recorded in the branch's own currency. The
        // branch record is the authority for which one that is.
        const money = recorded ? { amount: recorded.amount, currency: branch?.currency ?? recorded.currency } : null;
        const pack = branch ? versionInForce(ready.packs, branch.countryCode, asOf) : null;
        return { row, branch, money, pack };
      });
  }, [data.data, allowed, branchById, measure, asOf]);

  const consolidation = useMemo(
    () =>
      consolidate(
        rows.filter((entry) => entry.money).map((entry) => ({ key: entry.row.branchId, money: entry.money! })),
        reporting,
        data.data?.rates ?? [],
        asOf,
      ),
    [rows, reporting, data.data?.rates, asOf],
  );
  const convertedByBranch = useMemo(() => new Map(consolidation.lines.map((line) => [line.key, line])), [consolidation]);

  type Row = (typeof rows)[number];

  const columns: Column<Row>[] = [
    {
      key: "branch",
      header: t("common.branch"),
      render: (entry) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{tx(entry.row.branchName)}</span>
          <span className="text-fg-subtle text-xs">{tx(entry.row.brandName)}</span>
        </span>
      ),
    },
    {
      key: "pack",
      header: t("brn.cons.pack"),
      render: (entry) =>
        entry.branch ? (
          <span className="flex flex-col font-mono text-xs" dir="ltr">
            <span>
              {entry.branch.countryCode} · {entry.branch.currency}
            </span>
            <span className="text-fg-subtle">{entry.pack ? `v${entry.pack.version}` : t("brn.cons.noPack")}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "amount",
      header: measure === "netSales" ? t("bsc.metric.netSales") : t("bsc.metric.varianceValue"),
      numeric: true,
      render: (entry) =>
        entry.money ? <ConvertedMoney money={entry.money} to={reporting} rates={data.data?.rates ?? []} asOf={asOf} /> : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "share",
      header: t("brn.cons.share"),
      numeric: true,
      secondary: true,
      render: (entry) => {
        const line = convertedByBranch.get(entry.row.branchId);
        if (!line?.converted || consolidation.total.amount === 0) return <span className="text-fg-subtle">—</span>;
        return formatPercent((line.converted.amount / consolidation.total.amount) * 100, fmt);
      },
    },
  ];

  // FR-BRN-003 — the country packs and currencies trading inside this tenant.
  const jurisdictions = useMemo(() => {
    const map = new Map<string, { country: string; currency: Currency; branches: Branch[] }>();
    for (const branch of availableBranches) {
      if (allowed && !allowed.has(branch.id)) continue;
      const key = `${branch.countryCode}:${branch.currency}`;
      const entry = map.get(key) ?? { country: branch.countryCode, currency: branch.currency, branches: [] };
      entry.branches.push(branch);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [availableBranches, allowed]);

  return (
    <>
      <PageHeader
        title={t("nav.consolidated")}
        subtitle={t("brn.cons.subtitle")}
        spec="FR-BRN-004"
        actions={
          <ExportButton
            filename="consolidated-branches"
            title={t("nav.consolidated")}
            filterSummary={`${reporting} · ${asOf}`}
            rows={rows}
            onExported={setMessage}
            columns={[
              { key: "branch", header: t("common.branch"), value: (entry) => tx(entry.row.branchName) },
              { key: "country", header: t("org.country"), value: (entry) => entry.branch?.countryCode ?? "" },
              { key: "pack", header: t("brn.cons.pack"), value: (entry) => entry.pack?.version ?? "" },
              { key: "currency", header: t("common.currency"), value: (entry) => entry.money?.currency ?? "" },
              { key: "original", header: t("brn.cons.original"), value: (entry) => (entry.money ? toMajorUnits(entry.money) : "") },
              {
                key: "rate",
                header: t("brn.fx.rate"),
                value: (entry) => {
                  const line = convertedByBranch.get(entry.row.branchId);
                  return line?.rate ? `${line.rate.quoted}${line.rate.inverted ? " (inverse)" : ""}` : line?.converted ? "1" : "";
                },
              },
              { key: "source", header: t("brn.fx.source"), value: (entry) => convertedByBranch.get(entry.row.branchId)?.rate?.source ?? "" },
              { key: "rateDate", header: t("brn.fx.rateDate"), value: (entry) => convertedByBranch.get(entry.row.branchId)?.rate?.rateDate ?? "" },
              {
                key: "converted",
                header: `${t("brn.cons.converted")} (${reporting})`,
                value: (entry) => {
                  const converted = convertedByBranch.get(entry.row.branchId)?.converted;
                  return converted ? toMajorUnits(converted) : "";
                },
              },
            ]}
          />
        }
      />
      <PageBody>
        <Section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("brn.cons.reportingCurrency")}>
              <Select value={reporting} onChange={(event) => setReporting(event.target.value as Currency)}>
                {REPORTING_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("brn.cons.asOf")} hint={t("brn.cons.asOfHint")}>
              <Input type="date" dir="ltr" value={asOf} onChange={(event) => setAsOfInput(event.target.value)} />
            </Field>
            <Field label={t("brn.cons.measure")}>
              <Select value={measure} onChange={(event) => setMeasure(event.target.value as Measure)}>
                <option value="netSales">{t("bsc.metric.netSales")}</option>
                <option value="varianceValue">{t("bsc.metric.varianceValue")}</option>
              </Select>
            </Field>
            <BranchGroupSelect groups={groups.data ?? []} value={groupId} onChange={setGroupId} />
          </div>
        </Section>

        <AsyncPanel state={data} isEmpty={(ready) => ready.dashboard.branchRanking.length === 0}>
          {(ready) => (
            <>
              <Callout tone="muted">{t("bsc.period").replace("{day}", ready.dashboard.businessDay)}</Callout>
              <Section title={t("brn.cons.totalTitle")} spec="FR-BRN-004">
                <ConsolidatedTotal consolidation={consolidation} />
              </Section>
              <DataTable columns={columns} rows={rows} rowKey={(entry) => entry.row.branchId} caption={t("nav.consolidated")} dense />
              <Section title={t("brn.cons.jurisdictions")} hint={t("brn.cons.jurisdictionsHint")} spec="FR-BRN-003">
                <ul className="divide-line divide-y">
                  {jurisdictions.map((entry) => {
                    const pack = versionInForce(ready.packs, entry.country, asOf);
                    return (
                      <li key={`${entry.country}:${entry.currency}`} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                        <Badge tone="accent">
                          <span dir="ltr">
                            {entry.country} · {entry.currency}
                          </span>
                        </Badge>
                        <span className="text-fg-muted text-xs" dir="ltr">
                          {pack ? `${tx(pack.name)} v${pack.version} · ${pack.taxEngine} · ${pack.pricingMode}` : t("brn.cons.noPack")}
                        </span>
                        <span className="text-fg-subtle ms-auto text-xs">
                          {formatNumber(entry.branches.length, fmt)} {t("common.branches")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </>
          )}
        </AsyncPanel>

        <FxRatesSection canManage={canAny(["org.manage", "report.view.financial", "settings.tenant.manage"])} onChanged={(note) => { setMessage(note); data.reload(); }} />
      </PageBody>
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** FR-BRN-004 — the rates table: currency pair, rate, source, date. Append-only. */
function FxRatesSection({ canManage, onChanged }: { canManage: boolean; onChanged: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const rates = useAsync(() => services.branchNetwork.fxRates.all(), []);
  const [base, setBase] = useState<Currency>("SAR");
  const [quote, setQuote] = useState<Currency>("EGP");
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const problem = rateProblem({ base, quote, rate, source, rateDate });

  const sorted = useMemo(
    () => [...(rates.data ?? [])].sort((a, b) => b.rateDate.localeCompare(a.rateDate) || `${a.base}${a.quote}`.localeCompare(`${b.base}${b.quote}`)),
    [rates.data],
  );

  async function add() {
    await action.run(
      () => services.branchNetwork.fxRates.create({ base, quote, rate, source, rateDate, enteredBy: session?.user.name.en ?? null }),
      {
        onSuccess: () => {
          setRate("");
          rates.reload();
          onChanged(t("brn.fx.added"));
        },
      },
    );
  }

  async function remove(row: FxRate) {
    const ok = await confirm({
      title: t("brn.fx.deleteTitle"),
      body: t("brn.fx.deleteBody").replace("{pair}", `${row.base}→${row.quote}`).replace("{date}", formatDate(row.rateDate, fmt)),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.branchNetwork.fxRates.remove(row.id), {
      onSuccess: () => {
        rates.reload();
        onChanged(t("brn.fx.deleted"));
      },
    });
  }

  const columns: Column<FxRate>[] = [
    { key: "pair", header: t("brn.fx.pair"), render: (row) => <span className="font-mono text-sm" dir="ltr">1 {row.base} = {row.rate} {row.quote}</span> },
    { key: "source", header: t("brn.fx.source"), render: (row) => row.source },
    { key: "rateDate", header: t("brn.fx.rateDate"), render: (row) => formatDate(row.rateDate, fmt) },
    { key: "enteredBy", header: t("brn.fx.enteredBy"), secondary: true, render: (row) => row.enteredBy ?? "—" },
    {
      key: "actions",
      header: "",
      render: (row) => (canManage ? <IconButton label={t("common.delete")} icon={<Trash2 size={14} />} onClick={() => remove(row)} /> : null),
    },
  ];

  return (
    <Section title={t("brn.fx.title")} hint={t("brn.fx.hint")} spec="FR-BRN-004">
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {canManage ? (
          <div className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label={t("brn.fx.base")}>
              <Select value={base} onChange={(event) => setBase(event.target.value as Currency)}>
                {REPORTING_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("brn.fx.quote")}>
              <Select value={quote} onChange={(event) => setQuote(event.target.value as Currency)}>
                {REPORTING_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("brn.fx.rate")}>
              <Input dir="ltr" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="12.95" className="font-mono" />
            </Field>
            <Field label={t("brn.fx.source")}>
              <Input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t("brn.fx.sourcePlaceholder")} />
            </Field>
            <Field label={t("brn.fx.rateDate")}>
              <Input type="date" dir="ltr" value={rateDate} onChange={(event) => setRateDate(event.target.value)} />
            </Field>
            <Button variant="primary" icon={<Plus size={14} />} disabled={Boolean(problem)} loading={action.pending} onClick={add}>
              {t("common.add")}
            </Button>
          </div>
        ) : null}
        {canManage && problem && rate ? <p className="text-warn text-xs">{problem}</p> : null}
        <AsyncPanel state={rates} isEmpty={(ready) => ready.length === 0} empty={<Callout tone="muted">{t("brn.fx.empty")}</Callout>}>
          {() => <DataTable columns={columns} rows={sorted} rowKey={(row) => row.id} caption={t("brn.fx.title")} dense />}
        </AsyncPanel>
        <p className="text-fg-subtle text-xs">{t("brn.fx.immutable")}</p>
      </div>
    </Section>
  );
}
