"use client";

/**
 * Approvals — SRS §15.6.
 *
 * A single queue for every request the system routes to a human: discounts,
 * refunds, purchase orders, waste, count adjustments, expenses, price changes
 * and overtime. One queue rather than nine, because a manager who has to visit
 * nine screens will visit none of them.
 *
 * Two rules are enforced in the UI and, per FR-SEC-045, again on the server:
 *
 *   - A requester cannot approve their own request (§15.4). Self-approval is
 *     the failure mode the whole workflow exists to prevent.
 *   - The approver must hold the permission the request names. A branch
 *     manager seeing a tier-2 purchase order can read it and cannot decide it.
 *
 * Requests expire. An expired request is not a silent approval — it lapses and
 * has to be raised again, because a discount nobody got round to approving is
 * a discount that was never approved.
 *
 * FR-SEC-033 — each decision is also written once, with approver, time,
 * decision and comment, to the append-only security event log; the History
 * tab and the drawer read decisions from there. FR-SEC-034 — undecided rows
 * show where they sit on the tenant's escalation ladder. FR-SEC-035 — offline
 * approvals granted at a till are listed for retrospective review.
 */

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { ApprovalRequest } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage, useBranches } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRelative,
} from "@/lib/console/format";
import { APPROVAL_KIND, APPROVAL_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { TillApprovals } from "@/components/console/till-approvals";
import {
  DecisionHistory,
  EscalationCell,
  OfflineCodeCard,
  OfflineExceptionReport,
  useApprovalPolicy,
} from "@/components/console/security-approvals";
import { useSecurityLog } from "@/lib/console/security-log";
import { useNow } from "@/lib/console/live/store";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Tabs,
  Textarea,
  Toast,
} from "@/components/console/ui";

export default function ApprovalsPage() {
  return (
    <Gate permissions={["approval.act", "report.view.governance", "audit.view"]}>
      <ApprovalsScreen />
    </Gate>
  );
}

function ApprovalsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, session } = useSession();
  const branches = useBranches(scope);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [message, setMessage] = useTransientMessage();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [decisions, setDecisions] = useState(0);
  const policy = useApprovalPolicy();
  const now = useNow(30_000);
  const record = useSecurityLog();

  const collection = useCollection<ApprovalRequest>(
    (query) => services.governance.approvals.list(query),
    { scope, initialSort: "-requestedAt", pageSize: 25, initialFilters: { status: "pending" } },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const pending = rows.filter(
      (row) => row.status === "pending" || row.status === "escalated",
    );
    return {
      pending: pending.length,
      value: pending.reduce((sum, row) => sum + row.value.amount, 0),
      escalated: rows.filter((row) => row.status === "escalated").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.value.currency ?? "EGP";

  async function decide(request: ApprovalRequest, decision: "approved" | "rejected", comment: string) {
    try {
      const decided = await services.governance.decide(request.id, decision, comment || undefined);
      // FR-SEC-033 — approver, timestamp, decision and comment, written once.
      const logged = await record({
        kind: "approval.decided",
        subjectType: "approval_request",
        subjectId: request.id,
        detail: {
          reference: request.reference,
          kind: request.kind,
          decision,
          comment: comment.trim() || null,
          approverId: session?.user.id ?? null,
          decidedAt: decided.decidedAt ?? new Date().toISOString(),
          requestedBy: request.requestedBy,
          amountMinor: request.value.amount,
          currency: request.value.currency,
        },
      });
      setDecisions((n) => n + 1);
      if (!logged) {
        setMessage(t("dech.logFailed"));
        setSelected(null);
        collection.reload();
        return;
      }
      setMessage(decision === "approved" ? t("common.approved") : t("common.rejected"));
      setSelected(null);
      collection.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("state.errorTitle"));
    }
  }

  const columns = useMemo<Column<ApprovalRequest>[]>(
    () => [
      {
        key: "entity",
        header: t("apr.entity"),
        render: (row) => (
          <CellStack
            primary={tx(row.entityLabel)}
            secondary={<span className="font-mono">{row.reference}</span>}
          />
        ),
      },
      {
        key: "kind",
        header: t("apr.kind"),
        render: (row) => {
          const kind = labelOf(APPROVAL_KIND, row.kind);
          return <Badge tone={kind.tone}>{tx(kind.label)}</Badge>;
        },
      },
      {
        key: "branch",
        header: t("common.branch"),
        secondary: true,
        render: (row) => tx(row.branchName),
      },
      {
        key: "requestedBy",
        header: t("pur.requestedBy"),
        render: (row) => (
          <CellStack
            primary={tx(row.requestedByName)}
            secondary={formatRelative(row.requestedAt, fmt)}
          />
        ),
      },
      {
        key: "value",
        header: t("common.value"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.value, fmt),
      },
      {
        // FR-SEC-034 — where an undecided request sits on the ladder.
        key: "escalation",
        header: t("esc.column"),
        secondary: true,
        render: (row) =>
          row.status === "pending" || row.status === "escalated" ? (
            <EscalationCell requestedAt={row.requestedAt} policy={policy} now={now} />
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "expires",
        header: t("apr.expires"),
        secondary: true,
        render: (row) => formatRelative(row.expiresAt, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(APPROVAL_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt, policy, now],
  );

  return (
    <>
      <PageHeader title={t("apr.title")} subtitle={t("apr.subtitle")} spec="§15.6" />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("apr.queue")} value={formatNumber(totals.pending, fmt)} />
          <MetricTile
            label={t("common.value")}
            value={formatMoney({ amount: totals.value, currency }, fmt, true)}
          />
          <MetricTile
            label={tx(APPROVAL_STATUS.escalated.label)}
            value={formatNumber(totals.escalated, fmt)}
            hint={t("apr.escalatedHint")}
          />
        </TileGrid>

        {/*
          FR-POS-048 — the till's remote requests. They are not
          `governance.approvals` rows: a cashier waiting on a discount is
          waiting on this terminal's live state, not on a document the server
          has filed. They sit above the queue because someone is standing at a
          till with a guest in front of them.
        */}
        <TillApprovals onDecided={setMessage} />

        <OfflineExceptionReport policy={policy} refreshKey={decisions} />

        <Tabs
          value={tab}
          onChange={setTab}
          label={t("apr.title")}
          options={[
            { value: "queue", label: t("apr.queue") },
            { value: "history", label: t("apr.history") },
          ]}
        />

        {tab === "history" ? (
          <>
            <DecisionHistory refreshKey={decisions} />
            <OfflineCodeCard notify={setMessage} />
          </>
        ) : (
        <>
        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(APPROVAL_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "kind",
              label: t("apr.kind"),
              options: Object.entries(APPROVAL_KIND).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "branchId",
              label: t("common.branch"),
              options: branches.map((branch) => ({
                value: branch.id,
                label: tx(branch.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("apr.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          emptyTitle={t("apr.queueEmpty")}
          dense
        />
        </>
        )}
      </PageBody>

      <ApprovalDrawer
        request={selected}
        currentUserId={session?.user.id ?? null}
        onClose={() => setSelected(null)}
        onDecide={decide}
        policy={policy}
        now={now}
        historyKey={decisions}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ApprovalDrawer({
  request,
  currentUserId,
  onClose,
  onDecide,
  policy,
  now,
  historyKey,
}: {
  request: ApprovalRequest | null;
  currentUserId: string | null;
  policy: ReturnType<typeof useApprovalPolicy>;
  now: number;
  historyKey: number;
  onClose: () => void;
  onDecide: (
    request: ApprovalRequest,
    decision: "approved" | "rejected",
    comment: string,
  ) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { canAny } = useSession();
  const [comment, setComment] = useState("");

  if (!request) return null;

  const kind = labelOf(APPROVAL_KIND, request.kind);
  const status = labelOf(APPROVAL_STATUS, request.status);

  // §15.4 — the requester is never an approver, and the approver must hold the
  // permission the request names. Both are re-checked on the server.
  const isOwnRequest = currentUserId !== null && request.requestedBy === currentUserId;
  const holdsPermission = canAny([request.requiredPermission]);
  const decidable =
    (request.status === "pending" || request.status === "escalated") &&
    !isOwnRequest &&
    holdsPermission;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(request.entityLabel)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {request.reference}
        </span>
      }
      footer={
        decidable ? (
          <>
            <Button
              variant="danger"
              icon={<X size={14} />}
              onClick={() => {
                onDecide(request, "rejected", comment);
                setComment("");
              }}
            >
              {t("common.reject")}
            </Button>
            <Button
              variant="primary"
              icon={<Check size={14} />}
              onClick={() => {
                onDecide(request, "approved", comment);
                setComment("");
              }}
            >
              {t("common.approve")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-5">
        {isOwnRequest ? (
          <Callout tone="bad">{t("apr.cannotSelfApprove")}</Callout>
        ) : !holdsPermission ? (
          <Callout tone="warn">{t("apr.noPermission")}</Callout>
        ) : null}

        <DescList>
          <DescRow label={t("apr.kind")}>
            <Badge tone={kind.tone}>{tx(kind.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.branch")}>{tx(request.branchName)}</DescRow>
          <DescRow label={t("common.value")} mono>
            {formatMoney(request.value, fmt)}
          </DescRow>
          <DescRow label={t("pur.requestedBy")}>{tx(request.requestedByName)}</DescRow>
          <DescRow label={t("apr.requested")}>
            {formatDateTime(request.requestedAt, fmt)}
          </DescRow>
          <DescRow label={t("apr.expires")}>{formatDateTime(request.expiresAt, fmt)}</DescRow>
          <DescRow label={t("apr.requiredPermission")} mono>
            <span className="text-xs" dir="ltr">
              {request.requiredPermission}
            </span>
          </DescRow>
          {request.status === "pending" || request.status === "escalated" ? (
            <DescRow label={t("esc.column")}>
              <EscalationCell requestedAt={request.requestedAt} policy={policy} now={now} />
            </DescRow>
          ) : null}
          {request.decidedBy ? (
            <DescRow label={t("apr.decidedBy")}>{tx(request.decidedBy)}</DescRow>
          ) : null}
          {request.decidedAt ? (
            <DescRow label={t("dech.decidedAt")}>{formatDateTime(request.decidedAt, fmt)}</DescRow>
          ) : null}
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("common.reason")}</h3>
          <p className="text-fg-muted text-sm leading-relaxed">{tx(request.reason)}</p>
        </section>

        {request.comment ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("apr.comment")}</h3>
            <p className="text-fg-muted text-sm leading-relaxed">{request.comment}</p>
          </section>
        ) : null}

        {decidable ? (
          <Field label={t("apr.comment")} hint={t("apr.commentHint")}>
            <Textarea
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
        ) : null}

        <DecisionHistory subjectId={request.id} refreshKey={historyKey} />

        <Callout tone="muted">{t("apr.expiryNote")}</Callout>
      </div>
    </Drawer>
  );
}
