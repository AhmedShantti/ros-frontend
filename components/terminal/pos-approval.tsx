"use client";

/**
 * A manager's approval, on the till — FR-POS-048.
 *
 * Opened on top of whatever needs it (a discount, a refund, a void, a table
 * in someone else's section) so the order in hand is never abandoned to get
 * one. Three ways in, each of which proves who is approving:
 *
 *   PIN     staff code and PIN, typed on the terminal
 *   Card    the manager's staff card through the till's reader
 *   Remote  a request the manager decides from the console; the till keeps
 *           working meanwhile and the decision lands on the order when made
 *   Offline FR-SEC-035 — only while the till has no connection, so a remote
 *           request cannot reach anyone. The tenant's policy decides: either
 *           the operation is blocked until a manager approves in person, or a
 *           manager reached by phone reads out their one-time offline code
 *           (TOTP, checked on the till, single use). The approval is written
 *           to the security event log and sits in the console's exception
 *           report until a manager reviews it retrospectively.
 *
 * Verification here is a courtesy to the cashier — it says "wrong PIN"
 * before anything is dispatched. The reducer checks the stamp again and
 * refuses the action without a good one (`lib/console/live/approval.ts`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CreditCard, Delete, KeyRound, ShieldCheck, Smartphone, WifiOff } from "lucide-react";

import type { ApprovalMethod, ApprovalStamp, Currency, Id, Localised } from "@/lib/console/types";
import type { ConsoleKey } from "@/locales";
import { useI18n } from "@/lib/console/providers";
import { useLive, useNow } from "@/lib/console/live/store";
import type { LiveAction } from "@/lib/console/live/reducer";
import {
  PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  approversFor,
  demoPinFor,
  demoStaffCardFor,
  stampFrom,
  verifyCard,
  verifyPin,
  type ApprovalRefusal,
  type RemoteApprovalKind,
} from "@/lib/console/live/approval";
import { formatMoney, formatRelative, money } from "@/lib/console/format";
import { SCANNER_OPT_OUT } from "@/components/terminal/pos-lookup";
import { useConnectivityStore } from "@/store/connectivity";
import { services } from "@/lib/console/services";
import type { OfflineApprovalPolicy } from "@/lib/console/security-policy";
import { worksAt } from "@/lib/console/live/approval";
import { Badge, Button, Callout, Field, Input, Modal, Select, SegmentedControl, cx } from "@/components/console/ui";

export interface ApprovalRequestSpec {
  kind: RemoteApprovalKind;
  /** What the manager is being asked to allow, in a sentence. */
  summary: Localised;
  /** Why it needs a manager — the thresholds crossed, the policy that applies. */
  because: string[];
  amountMinor: number;
  currency: Currency;
  reason: string;
  orderId: Id;
  orderNumber: string;
  /** The action to replay when a remote request is approved. */
  action: LiveAction | null;
}

const REFUSAL_KEY: Record<ApprovalRefusal, ConsoleKey> = {
  unknown: "apv.refused.unknown",
  not_approver: "apv.refused.notApprover",
  wrong_pin: "apv.refused.wrongPin",
  self: "apv.refused.self",
  branch: "apv.refused.branch",
  payment_card: "apv.refused.paymentCard",
  unreadable: "apv.refused.unreadable",
};

export function ManagerApproval({
  request,
  methods = ["pin", "card", "remote"],
  onApproved,
  onRequested,
  onClose,
}: {
  request: ApprovalRequestSpec;
  methods?: ApprovalMethod[];
  onApproved: (stamp: ApprovalStamp) => void;
  /** Called once a remote request is sent; the caller usually closes its sheet. */
  onRequested?: () => void;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const connectivity = useConnectivityStore((s) => s.state);
  // FR-SEC-035 — no link means a remote request reaches nobody.
  const offline = connectivity === "offline" || connectivity === "isolated";
  const [method, setMethod] = useState<ApprovalMethod>(methods[0] ?? "pin");
  const requesterId = state.session?.employeeId ?? "";
  const approvers = useMemo(
    () => approversFor(state.branchId).filter((e) => e.id !== requesterId),
    [state.branchId, requesterId],
  );

  const options = (
    [
      { value: "pin", label: t("apv.pin") },
      { value: "card", label: t("apv.card") },
      { value: "remote", label: t("apv.remote") },
    ] as { value: ApprovalMethod; label: string }[]
  )
    .filter((option) => methods.includes(option.value) && (option.value !== "remote" || request.action))
    // Offline, the remote leg is replaced by the offline-code policy.
    .filter((option) => !(offline && option.value === "remote"))
    .concat(offline ? [{ value: "offline" as ApprovalMethod, label: t("apv.offline") }] : []);
  const active: ApprovalMethod = options.some((option) => option.value === method) ? method : (options[0]?.value ?? "pin");

  const approve = (stamp: ApprovalStamp) => {
    onApproved(stamp);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={t("apv.title")}>
      <div className="space-y-4">
        <div className="border-accent/40 bg-accent-soft/40 rounded-xl border p-3">
          <p className="text-fg flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={15} className="text-accent" aria-hidden />
            {tx(request.summary)}
          </p>
          <p className="text-fg-muted mt-1 font-mono text-xs tabular-nums">
            {request.orderNumber} · {formatMoney(money(request.amountMinor, request.currency as never), fmt)}
          </p>
          {request.because.length > 0 ? (
            <ul className="text-fg-muted mt-2 list-disc space-y-0.5 ps-4 text-xs">
              {request.because.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {approvers.length === 0 ? <Callout tone="warn">{t("apv.noApprovers")}</Callout> : null}

        {offline ? (
          <Callout tone="warn" icon={<WifiOff size={14} />}>
            {t("apv.offlineNotice")}
          </Callout>
        ) : null}

        {options.length > 1 ? (
          <SegmentedControl value={active} onChange={setMethod} options={options} label={t("apv.method")} />
        ) : null}

        {active === "pin" ? (
          <PinPanel approvers={approvers} requesterId={requesterId} onApproved={approve} />
        ) : active === "offline" ? (
          <OfflinePanel approvers={approvers} requesterId={requesterId} request={request} onApproved={approve} />
        ) : active === "card" ? (
          <CardPanel approvers={approvers} requesterId={requesterId} onApproved={approve} />
        ) : (
          <RemotePanel
            approvers={approvers}
            request={request}
            onSent={() => {
              onRequested?.();
              onClose();
            }}
          />
        )}

        <p className="text-fg-subtle text-[0.68rem] leading-relaxed">FR-POS-048 · FR-SEC-016 · FR-SEC-035</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

type Approvers = ReturnType<typeof approversFor>;

function PinPanel({
  approvers,
  requesterId,
  onApproved,
}: {
  approvers: Approvers;
  requesterId: Id;
  onApproved: (stamp: ApprovalStamp) => void;
}) {
  const { t, tx } = useI18n();
  const { state } = useLive();
  const now = useNow(1000);
  const [code, setCode] = useState(approvers[0]?.code ?? "");
  const [pin, setPin] = useState("");
  const [refusal, setRefusal] = useState<ApprovalRefusal | null>(null);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const locked = lockedUntil > 0 && now < lockedUntil;
  const secondsLeft = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  function submit() {
    if (locked || pin.length < 4 || !code.trim()) return;
    const verdict = verifyPin(code, pin, { branchId: state.branchId, requesterId });
    // Never leave a manager's PIN sitting in a field on a shared till.
    setPin("");
    if (verdict.ok) {
      setRefusal(null);
      onApproved(stampFrom(verdict.approver, "pin", new Date().toISOString()));
      return;
    }
    setRefusal(verdict.reason);
    const next = failures + 1;
    setFailures(next);
    if (next >= PIN_ATTEMPTS) {
      setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
      setFailures(0);
    }
  }

  const press = (digit: string) => setPin((current) => (current.length >= 8 ? current : current + digit));

  return (
    <div className="space-y-3">
      <Field label={t("apv.manager")}>
        <Select value={code} onChange={(event) => setCode(event.target.value)}>
          {approvers.map((employee) => (
            <option key={employee.id} value={employee.code}>
              {tx(employee.name)} · {tx(employee.position)} · {employee.code}
            </option>
          ))}
          <option value="">{t("apv.otherCode")}</option>
        </Select>
      </Field>
      {!approvers.some((employee) => employee.code === code) ? (
        <Field label={t("shift.managerCode")}>
          <Input
            dir="ltr"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            className="font-mono"
          />
        </Field>
      ) : null}

      <Field label={t("shift.managerPin")}>
        <Input
          type="password"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          value={pin}
          disabled={locked}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="text-center font-mono text-lg tracking-[0.5em]"
          aria-label={t("shift.managerPin")}
          data-autofocus
        />
      </Field>

      {/* A keypad, because a manager leaning over a counter should not need
          the on-screen keyboard. NFR-USA-002 — 48px targets. */}
      <div className="grid grid-cols-3 gap-2" dir="ltr">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <PadKey key={digit} disabled={locked} onClick={() => press(digit)}>
            {digit}
          </PadKey>
        ))}
        <PadKey disabled={locked} onClick={() => setPin("")} label={t("apv.clear")}>
          C
        </PadKey>
        <PadKey disabled={locked} onClick={() => press("0")}>
          0
        </PadKey>
        <PadKey disabled={locked} onClick={() => setPin((current) => current.slice(0, -1))} label={t("apv.backspace")}>
          <Delete size={16} aria-hidden />
        </PadKey>
      </div>

      {locked ? (
        <Callout tone="bad">{t("apv.locked").replace("{s}", String(secondsLeft))}</Callout>
      ) : refusal ? (
        <Callout tone="bad">
          {t(REFUSAL_KEY[refusal])}
          {refusal === "wrong_pin" && failures > 0
            ? ` ${t("apv.attemptsLeft").replace("{n}", String(PIN_ATTEMPTS - failures))}`
            : ""}
        </Callout>
      ) : null}

      <Button
        variant="primary"
        className="w-full"
        icon={<KeyRound size={14} />}
        disabled={locked || pin.length < 4 || !code.trim()}
        onClick={submit}
      >
        {t("apv.approve")}
      </Button>

      <DemoHint>
        {t("apv.demoPin")}{" "}
        {approvers
          .slice(0, 3)
          .map((employee) => `${employee.code} → ${demoPinFor(employee)}`)
          .join(" · ")}
      </DemoHint>
    </div>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="border-line bg-raised text-fg hover:bg-sunken flex min-h-12 items-center justify-center rounded-xl border text-lg font-semibold tabular-nums disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * A staff card through the reader.
 *
 * The capture field is opted out of the page-level barcode listener, so the
 * swipe is read here and nowhere else. A payment card swiped by mistake is
 * recognised by its track sentinels, refused, and cleared from the field
 * before anything else happens to it (FR-POS-066).
 */
function CardPanel({
  approvers,
  requesterId,
  onApproved,
}: {
  approvers: Approvers;
  requesterId: Id;
  onApproved: (stamp: ApprovalStamp) => void;
}) {
  const { t, tx } = useI18n();
  const { state } = useLive();
  const [raw, setRaw] = useState("");
  const [refusal, setRefusal] = useState<ApprovalRefusal | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  function read(value: string) {
    setRaw("");
    const verdict = verifyCard(value, { branchId: state.branchId, requesterId });
    if (verdict.ok) {
      setRefusal(null);
      onApproved(stampFrom(verdict.approver, "card", new Date().toISOString()));
    } else {
      setRefusal(verdict.reason);
    }
  }

  return (
    <div className="space-y-3">
      <div className="border-line flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center">
        <CreditCard size={26} className="text-accent" aria-hidden />
        <p className="text-fg text-sm font-medium">{t("apv.swipeNow")}</p>
        <p className="text-fg-muted text-xs">{t("apv.swipeHint")}</p>
        <input
          ref={field}
          {...SCANNER_OPT_OUT}
          type="password"
          autoComplete="off"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              read(raw);
            }
          }}
          aria-label={t("apv.swipeNow")}
          className="border-line bg-sunken w-full max-w-60 rounded-lg border px-3 py-2 text-center font-mono text-xs"
        />
      </div>

      {refusal ? <Callout tone="bad">{t(REFUSAL_KEY[refusal])}</Callout> : null}

      {/* The demo has no reader attached, so each manager's card can be
          "swiped" here. It goes through exactly the same parse and checks. */}
      <DemoHint>
        <span className="mb-1.5 block">{t("apv.demoCard")}</span>
        <span className="flex flex-wrap gap-1.5">
          {approvers.slice(0, 4).map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => read(demoStaffCardFor(employee))}
              className="border-line bg-raised text-fg hover:bg-sunken rounded-lg border px-2.5 py-1.5 text-xs"
            >
              {tx(employee.name)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => read("%B4111111111111111^CARDHOLDER/TEST^2612101000000000?")}
            className="border-bad/40 text-bad hover:bg-bad-soft rounded-lg border px-2.5 py-1.5 text-xs"
          >
            {t("apv.demoBankCard")}
          </button>
        </span>
      </DemoHint>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RemotePanel({
  approvers,
  request,
  onSent,
}: {
  approvers: Approvers;
  request: ApprovalRequestSpec;
  onSent: () => void;
}) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const [target, setTarget] = useState<Id>("");

  const chosen = approvers.find((employee) => employee.id === target) ?? null;
  const session = state.session;

  function send() {
    if (!session || !request.action) return;
    dispatch({
      type: "APPROVAL_REQUEST",
      request: {
        kind: request.kind,
        orderId: request.orderId,
        orderNumber: request.orderNumber,
        branchId: state.branchId,
        requestedBy: session.employeeId,
        requestedByName: session.employeeName,
        terminalId: state.terminalId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        summary: request.summary,
        reason: request.reason,
        targetApproverId: chosen?.id ?? null,
        targetApproverName: chosen?.name ?? null,
        action: request.action,
      },
    });
    onSent();
  }

  return (
    <div className="space-y-3">
      <Callout tone="neutral" icon={<Smartphone size={14} />}>
        {t("apv.remoteNote").replace("{m}", String(state.settings.remoteApprovalMinutes))}
      </Callout>
      <Field label={t("apv.sendTo")}>
        <Select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">{t("apv.anyManager")}</option>
          {approvers.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {tx(employee.name)} · {tx(employee.position)}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="primary" className="w-full" icon={<BellRing size={14} />} disabled={!session} onClick={send}>
        {t("apv.sendRequest")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-035 — offline, no approver present
// ---------------------------------------------------------------------------

/** An unreadable policy fails closed: blocked. */
function readOfflinePolicy(): OfflineApprovalPolicy {
  try {
    return services.securitySettings.approvalPolicyNow().offlinePolicy;
  } catch {
    return "block";
  }
}

type OfflineRefusal = "code" | "notEnrolled" | "self" | "branch" | "log";

function OfflinePanel({
  approvers,
  requesterId,
  request,
  onApproved,
}: {
  approvers: Approvers;
  requesterId: Id;
  request: ApprovalRequestSpec;
  onApproved: (stamp: ApprovalStamp) => void;
}) {
  const { t, tx } = useI18n();
  const { state } = useLive();
  const now = useNow(1000);
  const [policy] = useState<OfflineApprovalPolicy>(readOfflinePolicy);
  const [approverId, setApproverId] = useState<Id>(approvers[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<OfflineRefusal | null>(null);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const locked = lockedUntil > 0 && now < lockedUntil;

  if (policy === "block") {
    return <Callout tone="bad">{t("apv.offlineBlocked")}</Callout>;
  }

  const approver = approvers.find((employee) => employee.id === approverId) ?? null;

  async function check(): Promise<OfflineRefusal | null> {
    if (!approver) return "code";
    if (approver.id === requesterId) return "self";
    if (!worksAt(approver, state.branchId)) return "branch";
    const status = await services.securitySettings.offlineCodeStatus(approver.id);
    if (!status.enrolled) return "notEnrolled";
    const ok = await services.securitySettings.verifyOfflineCode(approver.id, code);
    if (!ok) {
      const next = failures + 1;
      setFailures(next);
      if (next >= PIN_ATTEMPTS) {
        setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        setFailures(0);
      }
      return "code";
    }
    // Written before the stamp is handed over: an offline approval that is
    // not in the exception report must not happen at all.
    try {
      await services.securityEvents.record({
        kind: "approval.offline_granted",
        actorId: state.session?.employeeId ?? null,
        actorName: state.session ? tx(state.session.employeeName) : "unknown",
        subjectType: "order",
        subjectId: request.orderId,
        detail: {
          summary: tx(request.summary),
          kind: request.kind,
          orderNumber: request.orderNumber,
          amountMinor: request.amountMinor,
          currency: request.currency,
          reason: request.reason,
          approverId: approver.id,
          approverName: tx(approver.name),
          requesterId,
          terminalId: state.terminalId,
          branchId: state.branchId,
        },
      });
    } catch {
      return "log";
    }
    return null;
  }

  async function submit() {
    if (!approver || locked || !/^[0-9]{6}$/.test(code)) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await check();
    setCode("");
    setBusy(false);
    if (outcome) {
      setRefusal(outcome);
      return;
    }
    onApproved(stampFrom(approver, "offline", new Date().toISOString()));
  }

  return (
    <div className="space-y-3">
      <Callout tone="neutral" icon={<WifiOff size={14} />}>
        {t("apv.offlineRetro")}
      </Callout>
      <Field label={t("apv.manager")}>
        <Select value={approverId} onChange={(event) => setApproverId(event.target.value)}>
          {approvers.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {tx(employee.name)} · {tx(employee.position)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("apv.offlineCode")} hint={t("apv.offlineCodeHint")}>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          value={code}
          disabled={locked}
          aria-label={t("apv.offlineCode")}
          onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          className="text-center font-mono text-lg tracking-[0.5em]"
        />
      </Field>
      {locked ? (
        <Callout tone="bad">{t("apv.locked").replace("{s}", String(Math.ceil((lockedUntil - now) / 1000)))}</Callout>
      ) : refusal ? (
        <Callout tone="bad">{t(`apv.offlineRefused.${refusal}` as ConsoleKey)}</Callout>
      ) : null}
      <Button
        variant="primary"
        className="w-full"
        icon={<KeyRound size={14} />}
        loading={busy}
        disabled={locked || code.length !== 6 || !approver}
        onClick={() => void submit()}
      >
        {t("apv.approve")}
      </Button>
    </div>
  );
}

function DemoHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line bg-sunken/60 text-fg-muted rounded-lg border border-dashed px-3 py-2 text-[0.7rem] leading-relaxed">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What is waiting — FR-POS-048, FR-SEC-032
// ---------------------------------------------------------------------------

/**
 * Remote requests raised on this order, and how each came out.
 *
 * The till is not blocked while a request waits, so the answer has to be
 * visible where the cashier is looking: pending with its countdown, approved
 * (and whether it could still be applied), rejected with the comment, or
 * expired. A pending request can be withdrawn.
 */
export function OrderApprovals({ orderId }: { orderId: Id }) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();
  const now = useNow(5000);

  const requests = state.approvals.filter((request) => request.orderId === orderId).slice(0, 4);
  if (requests.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {requests.map((request) => {
        const expired =
          request.status === "pending" && now > 0 && now >= Date.parse(request.expiresAt);
        const status = expired ? "expired" : request.status;
        const tone =
          status === "approved" ? (request.applied === false ? "warn" : "good") : status === "pending" ? "accent" : "bad";
        return (
          <li
            key={request.id}
            className={cx(
              "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              status === "pending" ? "border-accent/40 bg-accent-soft/40" : "border-line",
            )}
          >
            <BellRing size={12} className="text-fg-subtle shrink-0" aria-hidden />
            <span className="text-fg min-w-0 flex-1 truncate">{tx(request.summary)}</span>
            <Badge tone={tone}>
              {status === "approved" && request.applied === false
                ? t("apv.status.notApplied")
                : t(`apv.status.${status}` as ConsoleKey)}
            </Badge>
            {status === "pending" ? (
              <>
                <span className="text-fg-subtle tabular-nums">{formatRelative(request.expiresAt, fmt)}</span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "APPROVAL_WITHDRAW", requestId: request.id })}
                  className="text-fg-muted hover:text-fg underline"
                >
                  {t("apv.withdraw")}
                </button>
              </>
            ) : request.decidedByName ? (
              <span className="text-fg-subtle">{tx(request.decidedByName)}</span>
            ) : null}
            {request.comment ? <span className="text-fg-muted w-full ps-5 italic">“{request.comment}”</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
