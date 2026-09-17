"use client";

/**
 * Franchise royalties — FR-BRN-036.
 *
 * For a chosen period, each franchisee's net sales are read from the real
 * order list for their branch, and the agreement's royalty and marketing
 * percentages are applied to the period total (once, in integer minor units
 * — see `computeRoyalty`). A minimum monthly fee tops the royalty up when
 * sales fell short. Results are saved as draft statements, issued (which
 * freezes them and refuses overlapping issued periods), voided, and exported.
 */

import { useMemo, useState } from "react";
import { Calculator, FileCheck2, Save, Ban } from "lucide-react";

import type { Id } from "@/lib/console/types";
import { agreementInForce, computeRoyalty, type FranchiseAgreement, type RoyaltyStatement } from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, toMajorUnits } from "@/lib/console/format";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import { todayIso } from "@/components/console/franchise-lock";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, Input } from "@/components/console/ui";

const ORDER_LIMIT = 1000;

type Draft = Omit<RoyaltyStatement, "id" | "status" | "computedAt" | "issuedAt" | "issuedBy">;

function previousMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function FranchiseRoyaltiesTab({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches, session } = useSession();
  const canManage = usePermission("org.manage");
  const confirm = useConfirm();
  const action = useAction();
  const initial = previousMonth();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [selected, setSelected] = useState<Id[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoyaltyStatement | null>(null);
  const [nonce, setNonce] = useState(0);

  const agreements = useAsync(() => services.branchNetwork.franchiseAgreements.all(), []);
  const statements = useAsync(() => services.branchNetwork.royaltyStatements.all(), [nonce]);
  const branchName = (id: Id) => {
    const branch = availableBranches.find((b) => b.id === id);
    return branch ? tx(branch.name) : id;
  };
  const currencyOf = (id: Id) => availableBranches.find((b) => b.id === id)?.currency ?? "EGP";

  const eligible = useMemo(
    () => (agreements.data ?? []).filter((row) => row.active && row.startsOn <= end && (!row.endsOn || row.endsOn >= start)),
    [agreements.data, start, end],
  );
  const chosen = selected ?? eligible.map((row) => row.id);
  const periodValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end && end <= todayIso();

  async function compute() {
    setComputing(true);
    setComputeError(null);
    try {
      const results = await Promise.all(
        eligible
          .filter((row) => chosen.includes(row.id))
          .map(async (agreement: FranchiseAgreement) => {
            const page = await services.sales.orders.list({ scope: { ...scope, brandId: null, branchId: agreement.branchId }, limit: ORDER_LIMIT });
            // A capped read may be missing orders — the statement says so and cannot be issued.
            const truncated = page.rows.length >= ORDER_LIMIT || (typeof page.total === "number" && page.total > page.rows.length);
            return computeRoyalty(agreement, page.rows, start, end, currencyOf(agreement.branchId), truncated);
          }),
      );
      setDrafts(results);
    } catch (caught) {
      setComputeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setComputing(false);
    }
  }

  const money = (minor: number, currency: RoyaltyStatement["currency"]) => formatMoney({ amount: minor, currency }, fmt);

  const draftColumns: Column<Draft>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => branchName(row.branchId) },
    { key: "franchisee", header: t("frn.franchisee"), render: (row) => row.franchiseeName },
    { key: "orders", header: t("frn.orders"), numeric: true, render: (row) => formatNumber(row.orderCount, fmt) },
    { key: "net", header: t("frn.netSales"), numeric: true, render: (row) => money(row.netSalesMinor, row.currency) },
    { key: "royalty", header: t("frn.royalty"), numeric: true, render: (row) => `${money(row.royaltyMinor, row.currency)} (${formatPercent(row.royaltyPercent, fmt, 2)})` },
    { key: "marketing", header: t("frn.marketingFund"), numeric: true, render: (row) => money(row.marketingFundMinor, row.currency) },
    { key: "topup", header: t("frn.minimumTopUp"), numeric: true, render: (row) => money(row.minimumTopUpMinor, row.currency) },
    {
      key: "due",
      header: t("frn.totalDue"),
      numeric: true,
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="font-semibold">{money(row.totalDueMinor, row.currency)}</span>
          {row.truncated ? <Badge tone="warn">{t("frn.truncated")}</Badge> : null}
        </span>
      ),
    },
  ];

  const statementColumns: Column<RoyaltyStatement>[] = [
    { key: "period", header: t("frn.period"), render: (row) => `${formatDate(row.periodStart, fmt)} – ${formatDate(row.periodEnd, fmt)}` },
    { key: "branch", header: t("common.branch"), render: (row) => `${branchName(row.branchId)} · ${row.franchiseeName}` },
    { key: "net", header: t("frn.netSales"), numeric: true, render: (row) => money(row.netSalesMinor, row.currency) },
    { key: "due", header: t("frn.totalDue"), numeric: true, render: (row) => money(row.totalDueMinor, row.currency) },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={row.status === "issued" ? "good" : row.status === "void" ? "muted" : "warn"} dot>
          {t(`frn.status.${row.status}` as never)}
        </Badge>
      ),
    },
  ];

  const exportColumns = [
    { key: "period_start", header: t("frn.periodStart"), value: (row: RoyaltyStatement) => row.periodStart },
    { key: "period_end", header: t("frn.periodEnd"), value: (row: RoyaltyStatement) => row.periodEnd },
    { key: "branch", header: t("common.branch"), value: (row: RoyaltyStatement) => branchName(row.branchId) },
    { key: "franchisee", header: t("frn.franchisee"), value: (row: RoyaltyStatement) => row.franchiseeName },
    { key: "currency", header: t("org.currency"), value: (row: RoyaltyStatement) => row.currency },
    { key: "orders", header: t("frn.orders"), value: (row: RoyaltyStatement) => row.orderCount },
    { key: "net", header: t("frn.netSales"), value: (row: RoyaltyStatement) => toMajorUnits({ amount: row.netSalesMinor, currency: row.currency }) },
    { key: "royalty_pct", header: t("frn.royaltyPercent"), value: (row: RoyaltyStatement) => row.royaltyPercent },
    { key: "royalty", header: t("frn.royalty"), value: (row: RoyaltyStatement) => toMajorUnits({ amount: row.royaltyMinor, currency: row.currency }) },
    { key: "marketing_pct", header: t("frn.marketingPercent"), value: (row: RoyaltyStatement) => row.marketingFundPercent },
    { key: "marketing", header: t("frn.marketingFund"), value: (row: RoyaltyStatement) => toMajorUnits({ amount: row.marketingFundMinor, currency: row.currency }) },
    { key: "topup", header: t("frn.minimumTopUp"), value: (row: RoyaltyStatement) => toMajorUnits({ amount: row.minimumTopUpMinor, currency: row.currency }) },
    { key: "due", header: t("frn.totalDue"), value: (row: RoyaltyStatement) => toMajorUnits({ amount: row.totalDueMinor, currency: row.currency }) },
    { key: "status", header: t("common.status"), value: (row: RoyaltyStatement) => row.status },
    { key: "issued_at", header: t("frn.issuedAt"), value: (row: RoyaltyStatement) => row.issuedAt ?? "" },
  ];

  async function saveDrafts() {
    if (!drafts) return;
    await action.run(
      async () => {
        for (const draft of drafts) await services.branchNetwork.royaltyStatements.create(draft);
      },
      {
        onSuccess: () => {
          setDrafts(null);
          setNonce((n) => n + 1);
          notify(t("frn.draftsSaved"));
        },
      },
    );
  }

  async function issue(row: RoyaltyStatement) {
    const ok = await confirm({
      title: t("frn.issueTitle"),
      body: t("frn.issueBody").replace("{franchisee}", row.franchiseeName).replace("{amount}", money(row.totalDueMinor, row.currency)),
      confirmLabel: t("frn.issue"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(() => services.branchNetwork.royaltyStatements.issue(row.id, session?.user.email ?? null), {
      onSuccess: (next) => {
        setDetail(next);
        setNonce((n) => n + 1);
        notify(t("frn.issued"));
      },
    });
  }

  async function voidStatement(row: RoyaltyStatement) {
    const ok = await confirm({
      title: t("frn.voidTitle"),
      body: t("frn.voidBody").replace("{franchisee}", row.franchiseeName),
      confirmLabel: t("frn.void"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.branchNetwork.royaltyStatements.void(row.id), {
      onSuccess: (next) => {
        setDetail(next);
        setNonce((n) => n + 1);
        notify(t("frn.voided"));
      },
    });
  }

  return (
    <div className="space-y-5">
      <Section title={t("frn.computeTitle")} hint={t("frn.computeHint")} spec="FR-BRN-036">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("frn.periodStart")}>
            <Input type="date" dir="ltr" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label={t("frn.periodEnd")} error={periodValid ? null : t("frn.periodInvalid")}>
            <Input type="date" dir="ltr" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
        <AsyncPanel state={agreements} isEmpty={() => eligible.length === 0} empty={<Callout tone="muted">{t("frn.noEligible")}</Callout>}>
          {() => (
            <fieldset className="mt-3">
              <legend className="text-fg mb-2 text-xs font-medium">{t("frn.franchisees")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {eligible.map((row) => (
                  <label key={row.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.includes(row.id)}
                      onChange={(event) =>
                        setSelected(event.target.checked ? [...new Set([...chosen, row.id])] : chosen.filter((id) => id !== row.id))
                      }
                    />
                    {row.franchiseeName} · {branchName(row.branchId)}
                    {!agreementInForce(row, todayIso()) ? <Badge tone="muted">{t("frn.notInForce")}</Badge> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </AsyncPanel>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" icon={<Calculator size={14} />} loading={computing} disabled={!periodValid || chosen.length === 0} onClick={compute}>
            {t("frn.compute")}
          </Button>
        </div>
        {computeError ? <Callout tone="bad">{computeError}</Callout> : null}
        {drafts ? (
          <div className="mt-4 space-y-3">
            <p className="text-fg-subtle text-xs">{t("frn.netSalesDefinition")}</p>
            <DataTable columns={draftColumns} rows={drafts} rowKey={(row) => row.branchId} caption={t("frn.computeTitle")} dense />
            {canManage ? (
              <div className="flex justify-end">
                <Button variant="secondary" icon={<Save size={14} />} loading={action.pending} onClick={saveDrafts}>
                  {t("frn.saveDrafts")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Section
        title={t("frn.statementsTitle")}
        spec="FR-BRN-036"
        action={<ExportButton filename="royalty-statements" title={t("frn.statementsTitle")} rows={statements.data ?? []} columns={exportColumns} onExported={notify} />}
      >
        <AsyncPanel state={statements}>
          {(rows) => (
            <DataTable
              columns={statementColumns}
              rows={[...rows].sort((a, b) => b.periodStart.localeCompare(a.periodStart))}
              rowKey={(row) => row.id}
              caption={t("frn.statementsTitle")}
              onRowClick={setDetail}
              activeRowKey={detail?.id ?? null}
              emptyTitle={t("frn.noStatements")}
              dense
            />
          )}
        </AsyncPanel>
      </Section>

      {detail ? (
        <Drawer
          open
          onClose={() => setDetail(null)}
          title={detail.franchiseeName}
          subtitle={`${branchName(detail.branchId)} · ${formatDate(detail.periodStart, fmt)} – ${formatDate(detail.periodEnd, fmt)}`}
          footer={
            canManage ? (
              <>
                <ExportButton filename={`royalty-${detail.branchId}-${detail.periodStart}`} title={`${t("frn.statement")} — ${detail.franchiseeName}`} rows={[detail]} columns={exportColumns} onExported={notify} />
                {detail.status === "issued" ? (
                  <Button variant="danger" icon={<Ban size={14} />} onClick={() => voidStatement(detail)}>
                    {t("frn.void")}
                  </Button>
                ) : null}
                {detail.status === "draft" ? (
                  <Button variant="primary" icon={<FileCheck2 size={14} />} disabled={detail.truncated} onClick={() => issue(detail)}>
                    {t("frn.issue")}
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <div className="space-y-4">
            {detail.truncated ? <Callout tone="warn">{t("frn.truncatedBody")}</Callout> : null}
            <DescList>
              <DescRow label={t("common.status")}>{t(`frn.status.${detail.status}` as never)}</DescRow>
              <DescRow label={t("frn.orders")} mono>{formatNumber(detail.orderCount, fmt)}</DescRow>
              <DescRow label={t("frn.netSales")} mono>{money(detail.netSalesMinor, detail.currency)}</DescRow>
              <DescRow label={`${t("frn.royalty")} (${formatPercent(detail.royaltyPercent, fmt, 2)})`} mono>{money(detail.royaltyMinor, detail.currency)}</DescRow>
              <DescRow label={`${t("frn.marketingFund")} (${formatPercent(detail.marketingFundPercent, fmt, 2)})`} mono>{money(detail.marketingFundMinor, detail.currency)}</DescRow>
              <DescRow label={t("frn.minimumTopUp")} mono>{money(detail.minimumTopUpMinor, detail.currency)}</DescRow>
              <DescRow label={t("frn.totalDue")} mono>
                <strong>{money(detail.totalDueMinor, detail.currency)}</strong>
              </DescRow>
              <DescRow label={t("frn.computedAt")}>{formatDateTime(detail.computedAt, fmt)}</DescRow>
              {detail.issuedAt ? (
                <DescRow label={t("frn.issuedAt")}>
                  {formatDateTime(detail.issuedAt, fmt)} {detail.issuedBy ? `· ${detail.issuedBy}` : ""}
                </DescRow>
              ) : null}
            </DescList>
            <p className="text-fg-subtle text-xs">{t("frn.netSalesDefinition")}</p>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
