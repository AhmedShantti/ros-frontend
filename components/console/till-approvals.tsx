"use client";

/**
 * Remote approvals raised at a till — FR-POS-048, FR-SEC-031, FR-SEC-032.
 *
 * FR-POS-048 gives three ways a manager can approve without the order being
 * abandoned: PIN on the terminal, a card swipe, or a request to the manager
 * that leaves the terminal usable. The first two are decided at the till
 * (`components/terminal/pos-approval.tsx`). The third has to be decided
 * somewhere else, and this is that somewhere: the queue a manager is already
 * watching.
 *
 * The SRS says the asynchronous leg goes to a manager's mobile app. There is
 * no mobile app, and inventing a fake push notification would hide that; the
 * console queue is the honest stand-in, and the request carries everything
 * FR-SEC-031 asks for — requester, action, entity, value, the approver it
 * wants, and an expiry — so the surface can move without the record changing.
 *
 * Approving does not write the outcome. It replays the action the cashier
 * was refused, stamped with this manager, through the same reducer path that
 * a PIN approval takes (`APPROVAL_DECIDE`). Three things follow from that:
 *
 *   - What is approved is exactly what was asked for, not a re-description.
 *   - An order that moved on while the request waited — paid, cancelled,
 *     already discounted — is not forced. The replay changes nothing and the
 *     request says "could not be applied" rather than looking like it worked.
 *   - The checks are the reducer's, not this screen's (FR-SEC-045). Nobody
 *     approves their own request and nobody approves at a branch they may not
 *     work at, whatever this component renders.
 *
 * The live store writes through `localStorage` and listens for `storage`, so
 * a manager on this page and a cashier on a till in another tab are two
 * devices on one local network. A decision here lands on that order.
 */

import { useMemo, useState } from "react";
import { BellRing, Check, X } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import type { Id } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useLive, useNow } from "@/lib/console/live/store";
import type { RemoteApproval } from "@/lib/console/live/state";
import { isApprover, worksAt } from "@/lib/console/live/approval";
import { employeeById } from "@/lib/console/mock/workforce";
import { formatMoney, formatRelative } from "@/lib/console/format";
import { useSecurityLog } from "@/lib/console/security-log";
import { Badge, Button, Callout, Card, CardHeader, Field, Textarea } from "@/components/console/ui";

/** How long a decided request stays on screen before it stops being news. */
const RECENT_LIMIT = 6;

export function TillApprovals({ onDecided }: { onDecided?: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const { state } = useLive();
  const now = useNow(5000);

  /*
    Who this manager is on the floor.

    A console user and an employee are different records — FR-SEC-002 lets one
    person hold several role assignments, and plenty of console accounts
    belong to nobody who works a shift. The stamp on an approval names an
    employee, because that is what the till, the receipt and the audit entry
    all carry, so an account with no employee behind it can read the queue and
    cannot decide on it.
  */
  const decider = session?.user.employeeId ? (employeeById.get(session.user.employeeId) ?? null) : null;

  const pending = useMemo(
    () =>
      state.approvals
        .filter((request) => request.status === "pending")
        .filter((request) => !(now > 0 && now >= Date.parse(request.expiresAt))),
    [state.approvals, now],
  );
  const recent = useMemo(
    () => state.approvals.filter((request) => request.status !== "pending").slice(0, RECENT_LIMIT),
    [state.approvals],
  );

  if (pending.length === 0 && recent.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t("tapv.title")}
        hint={t("tapv.subtitle")}
        spec="FR-POS-048"
        action={pending.length > 0 ? <Badge tone="accent">{String(pending.length)}</Badge> : null}
      />

      {!decider ? <Callout tone="warn">{t("tapv.notLinked")}</Callout> : null}

      {pending.length === 0 ? (
        <p className="text-fg-muted text-sm">{t("tapv.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((request) => (
            <PendingRequest
              key={request.id}
              request={request}
              deciderId={decider?.id ?? null}
              deciderCanApprove={
                decider !== null && isApprover(decider) && worksAt(decider, request.branchId)
              }
              onDecided={onDecided}
            />
          ))}
        </ul>
      )}

      {recent.length > 0 ? (
        <section className="border-line mt-4 border-t pt-3">
          <h3 className="text-fg-subtle mb-2 text-xs font-semibold tracking-wide uppercase">
            {t("tapv.recent")}
          </h3>
          <ul className="space-y-1.5">
            {recent.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-fg min-w-0 flex-1 truncate">{tx(request.summary)}</span>
                <Badge tone={toneFor(request)}>
                  {request.status === "approved" && request.applied === false
                    ? t("apv.status.notApplied")
                    : t(`apv.status.${request.status}` as ConsoleKey)}
                </Badge>
                {request.decidedByName ? (
                  <span className="text-fg-subtle">{tx(request.decidedByName)}</span>
                ) : null}
                {request.decidedAt ? (
                  <span className="text-fg-subtle tabular-nums">
                    {formatRelative(request.decidedAt, fmt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

function toneFor(request: RemoteApproval): "good" | "warn" | "bad" | "muted" {
  if (request.status === "approved") return request.applied === false ? "warn" : "good";
  if (request.status === "rejected") return "bad";
  return "muted";
}

// ---------------------------------------------------------------------------

function PendingRequest({
  request,
  deciderId,
  deciderCanApprove,
  onDecided,
}: {
  request: RemoteApproval;
  deciderId: Id | null;
  /** Whether this manager holds authority at the branch that asked. */
  deciderCanApprove: boolean;
  onDecided?: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();
  const record = useSecurityLog();
  const [comment, setComment] = useState("");

  // FR-SEC-016 — blocked, not warned. The reducer refuses it too.
  const own = deciderId !== null && deciderId === request.requestedBy;
  const refusal = own
    ? t("tapv.own")
    : deciderId === null
      ? t("tapv.notLinked")
      : !deciderCanApprove
        ? t("tapv.notApprover")
        : null;

  const decider = deciderId ? employeeById.get(deciderId) : undefined;

  function decide(decision: "approved" | "rejected") {
    if (!decider || refusal) return;
    dispatch({
      type: "APPROVAL_DECIDE",
      requestId: request.id,
      deciderId: decider.id,
      deciderName: decider.name,
      decision,
      comment: comment.trim() || null,
    });
    // FR-SEC-033 — the till decision joins the immutable decision history.
    void record({
      kind: "approval.decided",
      subjectType: "till_approval",
      subjectId: request.id,
      detail: {
        reference: request.orderNumber,
        kind: request.kind,
        decision,
        comment: comment.trim() || null,
        approverId: decider.id,
        approverName: tx(decider.name),
        requestedBy: request.requestedBy,
        amountMinor: request.amountMinor,
        currency: request.currency,
      },
    });
    setComment("");
    onDecided?.(t("tapv.decided"));
  }

  const target =
    request.targetApproverId === null
      ? t("tapv.toAnyone")
      : request.targetApproverId === deciderId
        ? t("tapv.toYou")
        : t("tapv.toSomeoneElse").replace(
            "{name}",
            request.targetApproverName ? tx(request.targetApproverName) : "—",
          );

  return (
    <li className="border-accent/40 bg-accent-soft/30 space-y-2.5 rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BellRing size={13} className="text-accent shrink-0" aria-hidden />
            <span className="text-fg text-sm font-medium">{tx(request.summary)}</span>
            <Badge tone="accent">{t(`tapv.kind.${request.kind}` as ConsoleKey)}</Badge>
          </div>
          <p className="text-fg-muted mt-1 text-xs">{request.reason}</p>
        </div>
        <span className="text-fg shrink-0 font-mono text-sm tabular-nums">
          {formatMoney({ amount: request.amountMinor, currency: request.currency }, fmt, true)}
        </span>
      </div>

      <dl className="text-fg-subtle grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
        <Fact label={t("tapv.order")} value={request.orderNumber} mono />
        <Fact label={t("pur.requestedBy")} value={tx(request.requestedByName)} />
        <Fact label={t("tapv.terminal")} value={request.terminalId} mono />
        <Fact
          label={t("apr.expires")}
          value={t("tapv.expiresIn").replace("{when}", formatRelative(request.expiresAt, fmt))}
        />
      </dl>

      <p className="text-fg-subtle text-xs">{target}</p>

      {refusal ? (
        <Callout tone="warn">{refusal}</Callout>
      ) : (
        <>
          <Field label={t("tapv.comment")} hint={t("tapv.commentHint")}>
            <Textarea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={240}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Check size={14} />} onClick={() => decide("approved")}>
              {t("tapv.approve")}
            </Button>
            <Button
              icon={<X size={14} />}
              disabled={comment.trim().length === 0}
              onClick={() => decide("rejected")}
            >
              {t("tapv.reject")}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] tracking-wide uppercase">{label}</dt>
      <dd className={mono ? "text-fg truncate font-mono tabular-nums" : "text-fg truncate"}>{value}</dd>
    </div>
  );
}
