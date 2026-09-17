"use client";

/**
 * Shift swap requests — FR-HRM-016.
 *
 * Three steps, each by a different person, each on the record:
 *
 *   1. An employee asks to give a shift away — outright, or in exchange for
 *      one of the colleague's.
 *   2. The colleague accepts or declines. There is no employee app behind
 *      this console, so the answer is recorded here on their behalf, and the
 *      screen says so.
 *   3. A manager approves or rejects, against the rules as they would stand
 *      *after* the swap (`validateSwap`), re-run at the moment of decision
 *      because the roster may have moved since the request was made.
 *
 * Approval changes the roster first and records the decision only if that
 * worked. A swap marked approved while the roster still shows the old names
 * is the defect this ordering prevents.
 */

import { useMemo, useState } from "react";
import { ArrowLeftRight, Check, Plus, X } from "lucide-react";

import type { Employee, Id, ScheduledShift } from "@/lib/console/types";
import type { SwapRequest, SwapStatus } from "@/lib/console/services/workforce-hr";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime } from "@/lib/console/format";
import {
  isBlocking,
  localDateIso,
  validateSwap,
  type LeaveRequest,
  type SwapShiftSnapshot,
} from "@/lib/console/workforce-rules";
import { useConfirm } from "@/components/console/confirm";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Drawer, Field, Select, Textarea } from "@/components/console/ui";
import type { Tone } from "@/lib/console/labels";

const STATUS_TONE: Record<SwapStatus, Tone> = {
  pending_peer: "neutral",
  pending_manager: "warn",
  approved: "good",
  rejected: "bad",
  declined: "muted",
  cancelled: "muted",
};

function snapshot(shift: ScheduledShift): SwapShiftSnapshot {
  return {
    shiftId: shift.id,
    employeeId: shift.employeeId,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    branchId: shift.branchId,
    position: shift.position,
  };
}

interface SwapData {
  requests: SwapRequest[];
  shifts: ScheduledShift[] | null;
  employees: Employee[];
  leave: LeaveRequest[];
}

function useSwapData(reloadKey: number) {
  return useAsync<SwapData>(
    async () => {
      const [requests, shifts, employees, leave] = await Promise.all([
        services.workforceHr.swaps.all(),
        services.workforce.shifts
          .list({ limit: 1000 })
          .then((page) => page.rows)
          .catch(() => null),
        services.workforce.employees
          .list({ limit: 500 })
          .then((page) => page.rows)
          .catch(() => [] as Employee[]),
        services.workforceHr.leave.requests.all(),
      ]);
      return {
        requests: [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        shifts,
        employees,
        leave,
      };
    },
    [reloadKey],
  );
}

/** FR-HRM-016 — the rule check for a request against the roster as it is now. */
function checkSwap(
  give: SwapShiftSnapshot,
  take: SwapShiftSnapshot | null,
  toEmployeeId: Id,
  data: SwapData,
): string[] {
  return validateSwap({
    give,
    take,
    toEmployeeId,
    roster: (data.shifts ?? []).map((shift) => ({
      id: shift.id,
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
    })),
    employees: new Map(data.employees.map((row) => [row.id, row])),
    approvedLeave: data.leave.filter((row) => row.status === "approved"),
    today: localDateIso(new Date()),
  });
}

export function SwapsPanel({ reloadKey, onChanged }: { reloadKey: number; onChanged: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const [nonce, setNonce] = useState(0);
  const state = useSwapData(reloadKey + nonce);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<SwapRequest | null>(null);
  const canManage = usePermission("hr.schedule.manage");
  const action = useAction(onChanged);
  const confirm = useConfirm();

  function refresh(message: string) {
    setNonce((n) => n + 1);
    onChanged(message);
  }

  async function respond(request: SwapRequest, accept: boolean) {
    const ok = await confirm({
      title: accept ? t("wf.swap.acceptTitle") : t("wf.swap.declineTitle"),
      body: t("wf.swap.onBehalfBody").replace("{name}", tx(request.toName)),
      confirmLabel: accept ? t("wf.swap.accept") : t("wf.swap.decline"),
      tone: accept ? "warn" : "danger",
    });
    if (!ok) return;
    await action.run(() => services.workforceHr.swaps.respond(request.id, accept), {
      onSuccess: () => refresh(accept ? t("wf.swap.accepted") : t("wf.swap.declined")),
    });
  }

  async function cancel(request: SwapRequest) {
    const ok = await confirm({
      title: t("wf.swap.cancelTitle"),
      body: t("wf.swap.cancelBody"),
      confirmLabel: t("wf.swap.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.workforceHr.swaps.update(request.id, { status: "cancelled" }), {
      onSuccess: () => refresh(t("wf.swap.cancelled")),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-muted text-xs">{t("wf.swap.intro")}</p>
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
          {t("wf.swap.new")}
        </Button>
      </div>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <AsyncPanel
        state={state}
        isEmpty={(data) => data.requests.length === 0}
        empty={<Callout tone="muted">{t("wf.swap.none")}</Callout>}
      >
        {(data) => (
          <ul className="space-y-2">
            {data.shifts === null ? <Callout tone="warn">{t("wf.swap.rosterUnavailable")}</Callout> : null}
            {data.requests.map((request) => (
              <li key={request.id} className="border-line rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="text-fg flex flex-wrap items-center gap-1.5 font-medium">
                      {tx(request.fromName)}
                      <ArrowLeftRight size={13} aria-hidden className="text-fg-subtle" />
                      {tx(request.toName)}
                    </p>
                    <p className="text-fg-muted mt-0.5 text-xs">
                      {t("wf.swap.gives")
                        .replace("{date}", formatDate(request.give.date, fmt))
                        .replace("{time}", `${request.give.startTime}–${request.give.endTime}`)}
                      {request.take
                        ? ` · ${t("wf.swap.takes")
                            .replace("{date}", formatDate(request.take.date, fmt))
                            .replace("{time}", `${request.take.startTime}–${request.take.endTime}`)}`
                        : ` · ${t("wf.swap.giveAway")}`}
                    </p>
                    {request.reason ? <p className="text-fg-subtle mt-1 text-xs">“{request.reason}”</p> : null}
                    {request.decisionNote ? (
                      <p className="text-fg-subtle mt-1 text-xs">
                        {t("wf.swap.decisionBy")
                          .replace("{who}", request.decidedBy ?? "—")
                          .replace("{when}", formatDateTime(request.decidedAt, fmt))}
                        : {request.decisionNote}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={STATUS_TONE[request.status]} dot>
                    {t(`wf.swap.status.${request.status}` as never)}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.status === "pending_peer" ? (
                    <>
                      <Button size="sm" icon={<Check size={12} />} loading={action.pending} onClick={() => void respond(request, true)}>
                        {t("wf.swap.accept")}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<X size={12} />} loading={action.pending} onClick={() => void respond(request, false)}>
                        {t("wf.swap.decline")}
                      </Button>
                    </>
                  ) : null}
                  {request.status === "pending_manager" && canManage ? (
                    <Button size="sm" variant="primary" onClick={() => setDeciding(request)}>
                      {t("wf.swap.review")}
                    </Button>
                  ) : null}
                  {request.status === "pending_peer" || request.status === "pending_manager" ? (
                    <Button size="sm" variant="ghost" onClick={() => void cancel(request)}>
                      {t("wf.swap.cancel")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>

      {creating && state.data ? (
        <NewSwapDrawer
          data={state.data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh(t("wf.swap.created"));
          }}
        />
      ) : null}
      {deciding && state.data ? (
        <SwapDecisionDrawer
          request={deciding}
          data={state.data}
          onClose={() => setDeciding(null)}
          onDecided={(message) => {
            setDeciding(null);
            refresh(message);
          }}
        />
      ) : null}
    </div>
  );
}

function ViolationList({ keys }: { keys: string[] }) {
  const { t } = useI18n();
  if (keys.length === 0) return <Callout tone="good">{t("wf.swap.noViolations")}</Callout>;
  const blocking = keys.filter(isBlocking);
  const warnings = keys.filter((key) => !isBlocking(key));
  return (
    <div className="space-y-2">
      {blocking.length > 0 ? (
        <Callout tone="bad" title={t("wf.swap.blockingTitle")}>
          <ul className="space-y-0.5">
            {blocking.map((key) => (
              <li key={key}>• {t(key as never)}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {warnings.length > 0 ? (
        <Callout tone="warn" title={t("wf.violations")}>
          <ul className="space-y-0.5">
            {warnings.map((key) => (
              <li key={key}>• {t(key as never)}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}

function shiftLabel(shift: ScheduledShift, tx: (value: ScheduledShift["employeeName"]) => string): string {
  return `${shift.date} · ${shift.startTime}–${shift.endTime} · ${tx(shift.employeeName)}`;
}

function NewSwapDrawer({
  data,
  onClose,
  onCreated,
}: {
  data: SwapData;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const today = localDateIso(new Date());
  const upcoming = useMemo(
    () =>
      (data.shifts ?? [])
        .filter((shift) => shift.date >= today && shift.status !== "draft")
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
    [data.shifts, today],
  );

  const [giveId, setGiveId] = useState("");
  const [toId, setToId] = useState("");
  const [takeId, setTakeId] = useState("");
  const [reason, setReason] = useState("");

  const give = upcoming.find((shift) => shift.id === giveId) ?? null;
  const take = upcoming.find((shift) => shift.id === takeId) ?? null;
  const recipients = data.employees.filter((row) => row.status === "active" && row.id !== give?.employeeId);
  const theirShifts = upcoming.filter((shift) => shift.employeeId === toId);

  const violations = give && toId ? checkSwap(snapshot(give), take ? snapshot(take) : null, toId, data) : [];
  const blocked = violations.some(isBlocking);

  async function create() {
    if (!give || !toId) return;
    const from = data.employees.find((row) => row.id === give.employeeId);
    const to = data.employees.find((row) => row.id === toId);
    await action.run(
      () =>
        services.workforceHr.swaps.create({
          give: snapshot(give),
          take: take ? snapshot(take) : null,
          fromEmployeeId: give.employeeId,
          fromName: from?.name ?? give.employeeName,
          toEmployeeId: toId,
          toName: to?.name ?? { en: toId, ar: toId },
          reason: reason.trim(),
          violations,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.swap.new")}
      subtitle="FR-HRM-016"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!give || !toId || blocked} onClick={create}>
            {t("wf.swap.submit")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {data.shifts === null ? <Callout tone="warn">{t("wf.swap.rosterUnavailable")}</Callout> : null}

        <Field label={t("wf.swap.shiftToGive")} required>
          <Select
            value={giveId}
            onChange={(event) => {
              setGiveId(event.target.value);
              setToId("");
              setTakeId("");
            }}
          >
            <option value="">—</option>
            {upcoming.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shiftLabel(shift, tx)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("wf.swap.colleague")} required hint={t("wf.swap.colleagueHint")}>
          <Select
            value={toId}
            disabled={!give}
            onChange={(event) => {
              setToId(event.target.value);
              setTakeId("");
            }}
          >
            <option value="">—</option>
            {recipients.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)} · {tx(row.position)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("wf.swap.inExchange")} hint={t("wf.swap.inExchangeHint")}>
          <Select value={takeId} disabled={!toId} onChange={(event) => setTakeId(event.target.value)}>
            <option value="">{t("wf.swap.giveAway")}</option>
            {theirShifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shiftLabel(shift, tx)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("wf.swap.reason")}>
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>

        {give && toId ? <ViolationList keys={violations} /> : null}
      </div>
    </Drawer>
  );
}

function SwapDecisionDrawer({
  request,
  data,
  onClose,
  onDecided,
}: {
  request: SwapRequest;
  data: SwapData;
  onClose: () => void;
  onDecided: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const confirm = useConfirm();
  const [note, setNote] = useState("");

  // Re-run now: the roster may have moved since the request was raised.
  const violations = checkSwap(request.give, request.take, request.toEmployeeId, data);
  const blocked = violations.some(isBlocking);
  const by = session?.user.name.en ?? "";

  async function approve() {
    if (blocked) return;
    if (violations.length > 0) {
      const ok = await confirm({
        title: t("wf.swap.approveWithWarnings"),
        body: t("wf.swap.approveWithWarningsBody"),
        confirmLabel: t("common.approve"),
        tone: "warn",
      });
      if (!ok) return;
      if (!note.trim()) return;
    }
    await action.run(
      async () => {
        // The roster first. If it cannot be changed, nothing is approved.
        await services.workforce.shifts.update(request.give.shiftId, {
          employeeId: request.toEmployeeId,
          employeeName: request.toName,
        });
        if (request.take) {
          await services.workforce.shifts.update(request.take.shiftId, {
            employeeId: request.fromEmployeeId,
            employeeName: request.fromName,
          });
        }
        return services.workforceHr.swaps.decide(request.id, {
          approve: true,
          by,
          note: note.trim() || null,
          violations,
          applied: true,
          applyError: null,
        });
      },
      { onSuccess: () => onDecided(t("wf.swap.approved")) },
    );
  }

  async function reject() {
    if (!note.trim()) return;
    await action.run(
      () =>
        services.workforceHr.swaps.decide(request.id, {
          approve: false,
          by,
          note: note.trim(),
          violations,
          applied: false,
          applyError: null,
        }),
      { onSuccess: () => onDecided(t("wf.swap.rejected")) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.swap.review")}
      subtitle="FR-HRM-016"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            icon={<Check size={13} />}
            loading={action.pending}
            disabled={blocked || (violations.length > 0 && !note.trim())}
            onClick={() => void approve()}
          >
            {t("common.approve")}
          </Button>
          <Button variant="danger" icon={<X size={13} />} loading={action.pending} disabled={!note.trim()} onClick={() => void reject()}>
            {t("common.reject")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <p className="text-fg text-sm">
          {tx(request.fromName)} → {tx(request.toName)}
        </p>
        <p className="text-fg-muted text-xs">
          {t("wf.swap.gives")
            .replace("{date}", formatDate(request.give.date, fmt))
            .replace("{time}", `${request.give.startTime}–${request.give.endTime}`)}
          {request.take
            ? ` · ${t("wf.swap.takes")
                .replace("{date}", formatDate(request.take.date, fmt))
                .replace("{time}", `${request.take.startTime}–${request.take.endTime}`)}`
            : ""}
        </p>
        <ViolationList keys={violations} />
        <Field
          label={t("wf.swap.decisionNote")}
          hint={violations.length > 0 ? t("wf.swap.decisionNoteRequired") : t("wf.swap.decisionNoteHint")}
        >
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
