"use client";

/**
 * Approval governance in the inbox — FR-SEC-033, FR-SEC-034, FR-SEC-035.
 *
 *   FR-SEC-033  every decision — approver, time, decision, comment — is
 *               written once to the append-only security event log, and the
 *               history shown here is read from that log, not from the
 *               mutable request row. A decision cannot be edited from any
 *               screen; the service has no method to do it.
 *   FR-SEC-034  where each undecided request sits on the escalation ladder,
 *               and when it moves next, from the tenant's policy.
 *   FR-SEC-035  offline approvals granted at a till with a manager's one-time
 *               code are listed as exceptions until a manager reviews them
 *               retrospectively; overdue ones are flagged. A manager can
 *               provision their offline code here.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, KeyRound, ShieldCheck } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useActor, useSecurityLog } from "@/lib/console/security-log";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/console/format";
import { ROLE_DEFINITIONS } from "@/lib/console/permissions";
import { escalationStateOf, type ApprovalPolicy } from "@/lib/console/security-policy";
import type { SecurityEvent } from "@/lib/console/services/security-events";
import { groupSecret, otpauthUri } from "@/lib/console/totp";
import { isApprover } from "@/lib/console/live/approval";
import { employeeById } from "@/lib/console/mock/workforce";
import { useConfirm } from "@/components/console/confirm";
import { ErrorCallout } from "@/components/console/states";
import { Badge, Button, Callout, Card, CardHeader, Field, Textarea } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export function useApprovalPolicy(): ApprovalPolicy | null {
  const state = useAsync(() => services.securitySettings.approvalPolicy().then((row) => row.value), []);
  return state.data;
}

/** FR-SEC-034 — the escalation state of one undecided request. */
export function EscalationCell({
  requestedAt,
  policy,
  now,
}: {
  requestedAt: string;
  policy: ApprovalPolicy | null;
  now: number;
}) {
  const { t, tx, fmt } = useI18n();
  if (!policy || !now) return <span className="text-fg-subtle">—</span>;
  if (!policy.escalationEnabled) return <span className="text-fg-subtle text-xs">{t("esc.off")}</span>;
  const state = escalationStateOf(requestedAt, policy, now);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <Badge tone={state.level === 0 ? "neutral" : state.atTop ? "bad" : "warn"}>
          {t("esc.level").replace("{n}", String(state.level + 1))} · {tx(ROLE_DEFINITIONS[state.role].name)}
        </Badge>
      </span>
      <span className="text-fg-subtle text-[0.68rem]">
        {state.nextAt
          ? t("esc.next").replace("{when}", formatRelative(state.nextAt, fmt))
          : t("esc.top")}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-033 — decision history
// ---------------------------------------------------------------------------

export function DecisionHistory({ subjectId, refreshKey }: { subjectId?: string; refreshKey?: unknown }) {
  const { t, fmt } = useI18n();
  const events = useAsync(
    () => services.securityEvents.list({ kinds: ["approval.decided", "approval.retrospective_reviewed"], subjectId }),
    [subjectId, refreshKey],
  );
  const rows = events.data ?? [];

  return (
    <section aria-labelledby="decision-history">
      <h3 id="decision-history" className="text-fg mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <History size={14} aria-hidden /> {t("dech.title")}
      </h3>
      {events.error ? <ErrorCallout error={events.error} /> : null}
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-xs">{subjectId ? t("dech.noneForRequest") : t("dech.none")}</p>
      ) : (
        <ol className="border-line divide-line divide-y rounded-lg border">
          {rows.map((event) => (
            <DecisionRow key={event.id} event={event} fmt={fmt} />
          ))}
        </ol>
      )}
      <p className="text-fg-subtle mt-2 text-[0.68rem]">{t("dech.immutable")}</p>
    </section>
  );
}

function DecisionRow({ event, fmt }: { event: SecurityEvent; fmt: ReturnType<typeof useI18n>["fmt"] }) {
  const { t } = useI18n();
  const decision = String(event.detail.decision ?? "");
  const tone = decision === "approved" || decision === "confirmed" ? "good" : decision ? "bad" : "neutral";
  return (
    <li className="space-y-0.5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{decision ? t(`dech.decision.${decision}` as ConsoleKey) : event.kind}</Badge>
        <span className="text-fg font-medium">{String(event.detail.reference ?? event.subjectId)}</span>
        <span className="text-fg-muted">{event.actorName}</span>
        <span className="text-fg-subtle ms-auto tabular-nums">{formatDateTime(event.at, fmt)}</span>
      </div>
      {event.detail.comment ? <p className="text-fg-muted italic">“{String(event.detail.comment)}”</p> : null}
      <p className="text-fg-subtle font-mono text-[0.62rem]" dir="ltr">
        {event.id} · {event.hash.slice(0, 16)}…
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-035 — offline exceptions
// ---------------------------------------------------------------------------

interface OfflineException {
  grant: SecurityEvent;
  review: SecurityEvent | null;
  overdue: boolean;
}

export function OfflineExceptionReport({ policy, refreshKey }: { policy: ApprovalPolicy | null; refreshKey?: unknown }) {
  const { t, fmt } = useI18n();
  const [nonce, setNonce] = useState(0);
  const events = useAsync(
    () => services.securityEvents.list({ kinds: ["approval.offline_granted", "approval.retrospective_reviewed"] }),
    [refreshKey, nonce],
  );

  const exceptions = useMemo<OfflineException[]>(() => {
    const rows = events.data ?? [];
    const reviews = new Map(rows.filter((row) => row.kind === "approval.retrospective_reviewed").map((row) => [row.correlationId, row]));
    const windowMs = (policy?.retrospectiveReviewHours ?? 24) * 3_600_000;
    return rows
      .filter((row) => row.kind === "approval.offline_granted")
      .map((grant) => {
        const review = reviews.get(grant.id) ?? null;
        return { grant, review, overdue: !review && Date.now() - Date.parse(grant.at) > windowMs };
      });
  }, [events.data, policy]);

  const open = exceptions.filter((row) => !row.review);
  if (exceptions.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t("offx.title")}
        hint={t("offx.hint")}
        spec="FR-SEC-035"
        action={open.length > 0 ? <Badge tone="warn">{String(open.length)}</Badge> : null}
      />
      <ul className="space-y-3">
        {exceptions.slice(0, 20).map((row) => (
          <li key={row.grant.id} className="border-line space-y-2 rounded-lg border p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {row.overdue ? (
                <Badge tone="bad">
                  <AlertTriangle size={10} aria-hidden /> {t("offx.overdue")}
                </Badge>
              ) : row.review ? (
                <Badge tone={row.review.detail.decision === "confirmed" ? "good" : "bad"}>
                  {t(`dech.decision.${String(row.review.detail.decision)}` as ConsoleKey)}
                </Badge>
              ) : (
                <Badge tone="warn">{t("offx.awaiting")}</Badge>
              )}
              <span className="text-fg font-medium">{String(row.grant.detail.summary ?? row.grant.subjectId)}</span>
              <span className="text-fg ms-auto font-mono tabular-nums">
                {typeof row.grant.detail.amountMinor === "number" && typeof row.grant.detail.currency === "string"
                  ? formatMoney({ amount: row.grant.detail.amountMinor, currency: row.grant.detail.currency as never }, fmt, true)
                  : ""}
              </span>
            </div>
            <dl className="text-fg-muted grid grid-cols-2 gap-x-4 sm:grid-cols-4">
              <div>
                <dt className="text-fg-subtle">{t("offx.order")}</dt>
                <dd className="font-mono">{String(row.grant.detail.orderNumber ?? "—")}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{t("offx.cashier")}</dt>
                <dd>{row.grant.actorName}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{t("offx.approver")}</dt>
                <dd>{String(row.grant.detail.approverName ?? "—")}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{t("offx.when")}</dt>
                <dd className="tabular-nums">{formatDateTime(row.grant.at, fmt)}</dd>
              </div>
            </dl>
            {row.grant.detail.reason ? <p className="text-fg-muted">{String(row.grant.detail.reason)}</p> : null}
            {row.review ? (
              <p className="text-fg-subtle">
                {t("offx.reviewedBy").replace("{who}", row.review.actorName).replace("{when}", formatDateTime(row.review.at, fmt))}
                {row.review.detail.comment ? ` — “${String(row.review.detail.comment)}”` : ""}
              </p>
            ) : (
              <ReviewForm grant={row.grant} onDone={() => setNonce((n) => n + 1)} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReviewForm({ grant, onDone }: { grant: SecurityEvent; onDone: () => void }) {
  const { t } = useI18n();
  const { can, session } = useSession();
  const record = useSecurityLog();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // The cashier who needed the approval does not get to sign it off afterwards.
  const own = session?.user.employeeId != null && grant.detail.requesterId === session.user.employeeId;
  if (!can("approval.act")) return <p className="text-fg-subtle">{t("offx.noPermission")}</p>;
  if (own) return <Callout tone="warn">{t("offx.own")}</Callout>;

  async function review(decision: "confirmed" | "disputed") {
    setBusy(true);
    await record({
      kind: "approval.retrospective_reviewed",
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      correlationId: grant.id,
      detail: {
        decision,
        comment: comment.trim(),
        reference: String(grant.detail.orderNumber ?? grant.subjectId),
      },
    });
    setBusy(false);
    setComment("");
    onDone();
  }

  return (
    <div className="space-y-2">
      <Field label={t("offx.comment")} hint={t("offx.commentHint")}>
        <Textarea rows={2} maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!comment.trim()} onClick={() => void review("confirmed")}>
          {t("offx.confirm")}
        </Button>
        <Button size="sm" variant="danger" loading={busy} disabled={!comment.trim()} onClick={() => void review("disputed")}>
          {t("offx.dispute")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-035 — a manager's offline code
// ---------------------------------------------------------------------------

export function OfflineCodeCard({ notify }: { notify: (message: string) => void }) {
  const { t, tx } = useI18n();
  const { session } = useSession();
  const actor = useActor();
  const confirm = useConfirm();
  const employee = session?.user.employeeId ? (employeeById.get(session.user.employeeId) ?? null) : null;
  const status = useAsync(
    () => (employee ? services.securitySettings.offlineCodeStatus(employee.id) : Promise.resolve(null)),
    [employee?.id],
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nowMs, setNowMs] = useState(0);
  const step = Math.floor(nowMs / 30_000);
  const employeeId = employee?.id ?? null;

  useEffect(() => {
    if (!showCode) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showCode]);

  // A new code every 30-second step, fetched as the step turns over.
  useEffect(() => {
    if (!showCode || !employeeId) return;
    let cancelled = false;
    void services.securitySettings.currentOfflineCode(employeeId).then((value) => {
      if (!cancelled) setCode(value);
    });
    return () => {
      cancelled = true;
    };
  }, [showCode, employeeId, step]);

  if (!employee || !isApprover(employee)) return null;

  const secondsLeft = 30 - (Math.floor(nowMs / 1000) % 30);

  async function provision() {
    if (!employee) return;
    if (status.data?.enrolled) {
      const ok = await confirm({
        title: t("offc.replaceTitle"),
        body: t("offc.replaceBody"),
        confirmLabel: t("offc.replace"),
        tone: "warn",
      });
      if (!ok) return;
    }
    try {
      setError(null);
      const next = await services.securitySettings.provisionOfflineCode(employee.id, tx(employee.name), actor);
      setSecret(next);
      status.reload();
      notify(t("offc.provisioned"));
    } catch (caught) {
      setError(caught);
    }
  }

  async function revoke() {
    if (!employee) return;
    const ok = await confirm({ title: t("offc.revokeTitle"), body: t("offc.revokeBody"), confirmLabel: t("offc.revoke"), tone: "danger" });
    if (!ok) return;
    await services.securitySettings.revokeOfflineCode(employee.id, actor);
    setSecret(null);
    setShowCode(false);
    status.reload();
  }

  return (
    <Card>
      <CardHeader
        title={t("offc.title")}
        hint={t("offc.hint")}
        spec="FR-SEC-035"
        action={status.data?.enrolled ? <Badge tone="good"><ShieldCheck size={10} aria-hidden /> {t("offc.active")}</Badge> : null}
      />
      <ErrorCallout error={error} />
      {secret ? (
        <Callout tone="warn" title={t("offc.secretTitle")}>
          <p>{t("offc.secretBody")}</p>
          <p className="mt-1 font-mono text-sm" dir="ltr">
            {groupSecret(secret)}
          </p>
          <p className="text-fg-subtle mt-1 font-mono text-[0.62rem] break-all" dir="ltr">
            {otpauthUri({ issuer: "TRENDOW offline", account: employee.code, secret })}
          </p>
        </Callout>
      ) : null}
      {status.data?.enrolled ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<KeyRound size={13} />} onClick={() => setShowCode((on) => !on)}>
              {showCode ? t("offc.hideCode") : t("offc.showCode")}
            </Button>
            {showCode && code ? (
              <span className="flex items-baseline gap-2">
                <span className="text-fg font-mono text-2xl tracking-[0.3em] tabular-nums" dir="ltr" aria-live="polite">
                  {code}
                </span>
                <span className="text-fg-subtle text-xs tabular-nums">{t("offc.expiresIn").replace("{s}", String(secondsLeft))}</span>
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => void provision()}>
              {t("offc.replace")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void revoke()}>
              {t("offc.revoke")}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3" variant="primary" icon={<KeyRound size={13} />} onClick={() => void provision()}>
          {t("offc.provision")}
        </Button>
      )}
      <Callout tone="muted" className="mt-3">
        {t("offc.note")}
      </Callout>
    </Card>
  );
}
