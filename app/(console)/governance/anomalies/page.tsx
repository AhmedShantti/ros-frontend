"use client";

/**
 * Anomaly flags — SRS §13.7, FR-CST-040 … FR-CST-043.
 *
 * "Every flag is a prompt for human investigation, never an accusation."
 * That sentence decides the whole screen:
 *
 *   - Only `governance.view_anomalies` sees it (FR-CST-041). Not audit.view,
 *     not a manager role by default — an explicit grant.
 *   - Every flag shows its working (FR-CST-042): what was observed, against
 *     which baseline, how far out that is, and the evidence in words.
 *   - The baseline is the branch's and the role's, never the chain's
 *     (FR-CST-043), and the drawer says so, because a fine-dining void rate
 *     measured against a fast-food counter is how false accusations start.
 *   - Concluding anything — dismissing or confirming — needs a written
 *     reason, and the review history is append-only.
 */

import { useMemo, useState } from "react";
import { Eye, ShieldQuestion } from "lucide-react";

import type { AnomalyFlag, AnomalyKind, Severity } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { AnomalyReview, ReviewStatus } from "@/lib/console/services/anomaly-reviews";
import { useAction } from "@/lib/console/actions";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { ANOMALY_KIND, SEVERITY, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, SearchInput, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Meter,
  Textarea,
  Toast,
} from "@/components/console/ui";

export default function AnomaliesPage() {
  return (
    <Gate permissions={["governance.view_anomalies"]}>
      <AnomaliesScreen />
    </Gate>
  );
}

const STATUS_TONE: Record<ReviewStatus, "bad" | "warn" | "muted" | "accent"> = {
  open: "bad",
  reviewing: "warn",
  dismissed: "muted",
  confirmed: "accent",
};

interface Row {
  flag: AnomalyFlag;
  status: ReviewStatus;
  review: AnomalyReview | null;
}

function AnomaliesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const [message, setMessage] = useTransientMessage();
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("open_reviewing");
  const [branchId, setBranchId] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  const flags = useAsync(
    () => services.governance.anomalies.list({ scope, limit: 500, sort: "-detectedAt" }).then((page) => page.rows),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const reviews = useAsync(() => services.anomalyReviews.all(), []);

  const rows: Row[] = useMemo(() => {
    const byId = new Map((reviews.data ?? []).map((row) => [row.flagId, row]));
    return (flags.data ?? []).map((flag) => {
      const review = byId.get(flag.id) ?? null;
      return { flag, review, status: review?.status ?? flag.status };
    });
  }, [flags.data, reviews.data]);

  const visible = rows.filter((row) => {
    if (kind !== "all" && row.flag.kind !== kind) return false;
    if (severity !== "all" && row.flag.severity !== severity) return false;
    if (branchId !== "all" && row.flag.branchId !== branchId) return false;
    if (status === "open_reviewing" && !(row.status === "open" || row.status === "reviewing")) return false;
    if (status !== "open_reviewing" && status !== "all" && row.status !== status) return false;
    const needle = term.trim().toLowerCase();
    if (needle) {
      return [tx(row.flag.title), tx(row.flag.subjectName), tx(row.flag.branchName)].some((text) =>
        text.toLowerCase().includes(needle),
      );
    }
    return true;
  });

  const count = (value: ReviewStatus) => rows.filter((row) => row.status === value).length;

  const columns: Column<Row>[] = [
    {
      key: "detectedAt",
      header: t("anom.detected"),
      render: (row) => <CellStack primary={formatRelative(row.flag.detectedAt, fmt)} secondary={formatDateTime(row.flag.detectedAt, fmt)} />,
    },
    {
      key: "title",
      header: t("anom.pattern"),
      render: (row) => (
        <CellStack primary={tx(row.flag.title)} secondary={tx(labelOf(ANOMALY_KIND, row.flag.kind).label)} />
      ),
    },
    {
      key: "subject",
      header: t("anom.subject"),
      render: (row) => <CellStack primary={tx(row.flag.subjectName)} secondary={tx(row.flag.branchName)} />,
    },
    {
      key: "sigma",
      header: t("anom.deviation"),
      numeric: true,
      render: (row) => (
        <span className="font-mono tabular-nums" title={t("anom.sigmaHint")}>
          {formatNumber(row.flag.sigma, fmt, 1)}σ
        </span>
      ),
    },
    {
      key: "severity",
      header: t("dlv.severity"),
      render: (row) => {
        const entry = labelOf(SEVERITY, row.flag.severity);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {t(`anom.status.${row.status}` as never)}
        </Badge>
      ),
    },
  ];

  const current = rows.find((row) => row.flag.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title={t("anom.title")}
        subtitle={t("anom.subtitle")}
        spec="FR-CST-040"
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
      />

      <PageBody>
        <Callout tone="accent" icon={<ShieldQuestion size={14} />} title={t("anom.principleTitle")}>
          {t("anom.principleBody")}
        </Callout>

        <TileGrid columns={4}>
          <MetricTile label={t("anom.status.open")} value={formatNumber(count("open"), fmt)} />
          <MetricTile label={t("anom.status.reviewing")} value={formatNumber(count("reviewing"), fmt)} />
          <MetricTile label={t("anom.status.confirmed")} value={formatNumber(count("confirmed"), fmt)} />
          <MetricTile label={t("anom.status.dismissed")} value={formatNumber(count("dismissed"), fmt)} />
        </TileGrid>

        <Toolbar>
          <SearchInput value={term} onChange={setTerm} />
          <FilterSelect
            filter={{
              key: "status",
              label: t("common.status"),
              allLabel: `${t("common.status")}: ${t("common.all")}`,
              options: [
                { value: "open_reviewing", label: t("anom.needsAttention") },
                ...(["open", "reviewing", "confirmed", "dismissed"] as ReviewStatus[]).map((value) => ({
                  value,
                  label: t(`anom.status.${value}` as never),
                })),
              ],
            }}
            value={status}
            onChange={setStatus}
          />
          <FilterSelect
            filter={{
              key: "kind",
              label: t("anom.pattern"),
              options: (Object.keys(ANOMALY_KIND) as AnomalyKind[]).map((value) => ({
                value,
                label: tx(labelOf(ANOMALY_KIND, value).label),
              })),
            }}
            value={kind}
            onChange={setKind}
          />
          <FilterSelect
            filter={{
              key: "severity",
              label: t("dlv.severity"),
              options: (Object.keys(SEVERITY) as Severity[]).map((value) => ({
                value,
                label: tx(labelOf(SEVERITY, value).label),
              })),
            }}
            value={severity}
            onChange={setSeverity}
          />
          <FilterSelect
            filter={{
              key: "branch",
              label: t("common.branch"),
              options: branches.map((branch) => ({ value: branch.id, label: tx(branch.name) })),
            }}
            value={branchId}
            onChange={setBranchId}
          />
        </Toolbar>

        <AsyncPanel state={flags}>
          {() => (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(row) => row.flag.id}
              onRowClick={(row) => setSelected(row.flag.id)}
              activeRowKey={selected}
              caption={t("anom.title")}
              emptyTitle={t("anom.none")}
              emptyBody={t("anom.noneBody")}
            />
          )}
        </AsyncPanel>
      </PageBody>

      {current ? (
        <FlagDrawer
          row={current}
          onClose={() => setSelected(null)}
          onChanged={(text) => {
            reviews.reload();
            setMessage(text);
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}

function FlagDrawer({
  row,
  onClose,
  onChanged,
}: {
  row: Row;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session, can } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const [note, setNote] = useState("");
  const { flag } = row;
  const canAct = can("governance.view_anomalies") && (can("approval.act") || can("audit.view"));
  const closed = row.status === "dismissed" || row.status === "confirmed";

  const scale = Math.max(flag.observedValue, flag.baselineValue, 1);

  async function decide(next: ReviewStatus) {
    if (next === "confirmed") {
      const ok = await confirm({
        title: t("anom.confirmTitle"),
        body: t("anom.confirmBody").replace("{name}", tx(flag.subjectName)),
        confirmLabel: t("anom.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    await action.run(
      () => services.anomalyReviews.record(flag.id, { status: next, note, by: session?.user.email ?? null }),
      {
        onSuccess: () => {
          setNote("");
          onChanged(t(`anom.done.${next}` as never));
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(flag.title)}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[row.status]} dot>
            {t(`anom.status.${row.status}` as never)}
          </Badge>
          {tx(flag.subjectName)} · {tx(flag.branchName)}
        </span>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("anom.evidence")}</h3>
          <p className="text-fg text-sm leading-relaxed">{tx(flag.evidence)}</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-fg text-sm font-semibold">{t("anom.comparison")}</h3>
          <div className="space-y-2">
            <div>
              <div className="text-fg-muted mb-1 flex justify-between text-xs">
                <span>{t("anom.observed")}</span>
                <span className="font-mono tabular-nums">{formatNumber(flag.observedValue, fmt, 1)}</span>
              </div>
              <Meter value={(flag.observedValue / scale) * 100} tone="bad" />
            </div>
            <div>
              <div className="text-fg-muted mb-1 flex justify-between text-xs">
                <span>{t("anom.baseline")}</span>
                <span className="font-mono tabular-nums">{formatNumber(flag.baselineValue, fmt, 1)}</span>
              </div>
              <Meter value={(flag.baselineValue / scale) * 100} tone="neutral" />
            </div>
          </div>
          <p className="text-fg-subtle text-xs">{t("anom.baselineScope").replace("{branch}", tx(flag.branchName))}</p>
        </section>

        <DescList>
          <DescRow label={t("anom.pattern")}>{tx(labelOf(ANOMALY_KIND, flag.kind).label)}</DescRow>
          <DescRow label={t("anom.deviation")} mono>
            {formatNumber(flag.sigma, fmt, 1)}σ
          </DescRow>
          <DescRow label={t("dlv.severity")}>{tx(labelOf(SEVERITY, flag.severity).label)}</DescRow>
          <DescRow label={t("anom.detected")}>{formatDateTime(flag.detectedAt, fmt)}</DescRow>
        </DescList>

        {canAct && !closed ? (
          <section className="space-y-3">
            <Field label={t("anom.note")} hint={t("anom.noteHint")}>
              <Textarea rows={3} value={note} maxLength={600} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {row.status === "open" ? (
                <Button icon={<Eye size={13} />} loading={action.pending} onClick={() => void decide("reviewing")}>
                  {t("anom.startReview")}
                </Button>
              ) : null}
              <Button variant="ghost" loading={action.pending} disabled={note.trim().length < 10} onClick={() => void decide("dismissed")}>
                {t("anom.dismiss")}
              </Button>
              <Button variant="danger" loading={action.pending} disabled={note.trim().length < 10} onClick={() => void decide("confirmed")}>
                {t("anom.confirm")}
              </Button>
            </div>
          </section>
        ) : !canAct ? (
          <Callout tone="muted">{t("anom.viewOnly")}</Callout>
        ) : null}

        {row.review && row.review.history.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("anom.history")}</h3>
            <ol className="border-line space-y-3 border-s ps-4">
              {row.review.history.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={STATUS_TONE[entry.status]}>{t(`anom.status.${entry.status}` as never)}</Badge>
                    <span className="text-fg-muted">
                      {entry.by ?? "—"} · {formatDateTime(entry.at, fmt)}
                    </span>
                  </div>
                  {entry.note ? <p className="text-fg mt-1 text-sm">{entry.note}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
