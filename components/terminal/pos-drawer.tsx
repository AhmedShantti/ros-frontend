"use client";

/**
 * The cash drawer, driven by the backend.
 *
 * FR-POS-091/094/095/096/097 and FR-FIN-006 — everything that happens to the
 * cash itself, as opposed to the orders that move it. `pos-live.tsx` owns the
 * till; this owns the drawer, because the drawer outlives any one order and
 * its close is a state machine rather than a form.
 *
 * That state machine is the backend's, not an invention here:
 *
 *   open ──declareClose──▶ within tolerance ──▶ closed
 *        └─────────────▶ over tolerance  ──▶ closing (frozen)
 *                                              └─finalizeClose─▶ closed
 *                                                             └─▶ rejected,
 *                                                                 still frozen
 *                                                                   └─recountClose─▶ closed
 *                                                                                 └─▶ closing, NEW count
 *
 * A rejection used to be a dead end: the only thing left was another manager
 * decision against the same count, even when the count itself was wrong.
 * CASH-CLOSE-RECOUNT-AFTER-REJECTION-P0 adds `recountClose`: a NEW count that
 * supersedes the rejected one. The rejected count and the rejection stay in
 * history server-side; nothing here edits them. Whether a recount is offered
 * is the server's `recountAvailable`, never inferred from local state, and the
 * recount form starts empty — no expected figure, no previous count — and
 * keeps the blind count blind.
 *
 * Two consequences shape the code below. A `rejected` decision is a committed
 * 200 and not an error, so the outcome is read from the response rather than
 * inferred from the absence of a throw. And under a blind count the server
 * *omits* expected cash and tolerance rather than nulling them — so a figure
 * it has not disclosed renders as absent here, never as a zero.
 */

import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";

import type { Money } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type {
  CashCloseContext,
  CashCloseDeclaration,
  CashMovementKind,
  DenominationCountInput,
} from "@/lib/console/services/types";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatMoney } from "@/lib/console/format";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  SegmentedControl,
  Textarea,
} from "@/components/console/ui";

/**
 * The drawer sheet: what is in it, what moved, and how it closes.
 *
 * `onClosed` fires only when the session is genuinely finished — closed
 * within tolerance, or approved out of a freeze. The caller drops the
 * session id on it, because everything downstream referenced a drawer that
 * no longer exists.
 */
export function DrawerSheet({
  open,
  cashSessionId,
  cashierName,
  onClose,
  onMessage,
  onClosed,
}: {
  open: boolean;
  cashSessionId: string;
  /** Named in the closing confirmation, when the caller knows who is closing it. */
  cashierName?: string;
  onClose: () => void;
  onMessage: (message: string) => void;
  onClosed: () => void;
}) {
  const { t, fmt } = useI18n();
  const [nonce, setNonce] = useState(0);
  const [declaration, setDeclaration] = useState<CashCloseDeclaration | null>(null);
  // UI-only: which panel is showing. Whether a recount is ALLOWED is the
  // server's `recountAvailable`; a reload simply lands back on that truth.
  const [recounting, setRecounting] = useState(false);
  const [showDecision, setShowDecision] = useState(false);

  const context = useAsync(
    async () => (open ? services.treasury.closeContext(cashSessionId) : null),
    [open, cashSessionId, nonce],
  );

  if (!open) return null;

  // A freeze survives a re-read: the server reports `closing` whether or not
  // this tab is the one that declared the count.
  const frozen = declaration?.approvalRequired === true || context.data?.frozen === true;
  // The manager REJECTED the current count — the one state a recount is
  // allowed in. Read from the server, so it survives a reload or another till.
  const rejected = frozen && context.data?.recountAvailable === true;
  const concealCounts = recounting && context.data?.countMode === "blind";

  /**
   * The confirmation names who closed it and what the server settled on —
   * counted and variance — rather than a bare "it's closed", so the cashier
   * sees the same figures the close was decided against.
   */
  function closedMessage(base: string, counted: Money, variance: Money): string {
    const figures = t("shift.closedSummary")
      .replace("{counted}", formatMoney(counted, fmt))
      .replace("{variance}", formatMoney(variance, fmt));
    return cashierName ? `${base} ${cashierName} — ${figures}` : `${base} ${figures}`;
  }

  return (
    <Drawer open onClose={onClose} title={t("shift.drawerOps")}>
      <div className="space-y-5">
        <AsyncPanel state={context}>
          {(loaded) =>
            loaded ? (
              <CloseContextSummary context={loaded} concealCounts={concealCounts} />
            ) : (
              <span />
            )
          }
        </AsyncPanel>

        {frozen ? null : (
          <MovementForm
            cashSessionId={cashSessionId}
            onRecorded={() => {
              onMessage(t("shift.movementRecorded"));
              // Expected cash has moved. Re-read it rather than patch it.
              setNonce((n) => n + 1);
            }}
          />
        )}

        {frozen && recounting && context.data?.closeAttemptId ? (
          <DeclareCloseForm
            cashSessionId={cashSessionId}
            context={context.data ?? null}
            recount={{
              supersedesCloseAttemptId: context.data.closeAttemptId,
              onCancel: () => setRecounting(false),
            }}
            onDeclared={(result) => {
              // The recount is the session's current count now: its figures,
              // not the superseded count's, are what a manager decides on.
              setDeclaration(result);
              setRecounting(false);
              setShowDecision(false);
              if (result.status === "closed") {
                onMessage(closedMessage(t("shift.closedWithin"), result.countedCash, result.variance));
                onClosed();
              } else {
                onMessage(t("shift.recountDeclared"));
                setNonce((n) => n + 1);
              }
            }}
          />
        ) : frozen ? (
          <>
            {rejected ? (
              <RejectedRecountPanel
                decisionShown={showDecision}
                onRecount={() => setRecounting(true)}
                onToggleDecision={() => setShowDecision((shown) => !shown)}
              />
            ) : null}
            {rejected && !showDecision ? null : (
              <FinalizeCloseForm
                cashSessionId={cashSessionId}
                declaration={declaration}
                context={context.data ?? null}
                onOutcome={(outcome, figures) => {
                  if (outcome === "closed") {
                    onMessage(
                      figures?.countedCash && figures.variance
                        ? closedMessage(
                            t("shift.approvedOutcome"),
                            figures.countedCash,
                            figures.variance,
                          )
                        : t("shift.approvedOutcome"),
                    );
                    onClosed();
                  } else {
                    onMessage(t("shift.rejectedOutcome"));
                    setShowDecision(false);
                    setNonce((n) => n + 1);
                  }
                }}
              />
            )}
          </>
        ) : (
          <DeclareCloseForm
            cashSessionId={cashSessionId}
            context={context.data ?? null}
            onDeclared={(result) => {
              setDeclaration(result);
              if (result.status === "closed") {
                onMessage(closedMessage(t("shift.closedWithin"), result.countedCash, result.variance));
                onClosed();
              } else {
                onMessage(t("shift.declared"));
                setNonce((n) => n + 1);
              }
            }}
          />
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * What the cashier is allowed to know before counting.
 *
 * A dash where the expected cash would be is FR-POS-095 working, not a
 * loading state.
 */
function CloseContextSummary({
  context,
  concealCounts = false,
}: {
  context: CashCloseContext;
  /**
   * While a blind RECOUNT is being entered the count-side figures are held
   * back again — the cashier has seen them once already (that is exactly why
   * a recount is recorded as one, not as a first blind count), but the entry
   * form must still give nothing to copy a number from.
   */
  concealCounts?: boolean;
}) {
  const { t, fmt } = useI18n();
  const blind = context.countMode === "blind";
  const held = (value: Money | null) => (concealCounts ? null : value);

  const statusKey =
    context.status === "open"
      ? "shift.title"
      : context.frozen
        ? "shift.frozenTitle"
        : "shift.closed";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={context.frozen ? "warn" : context.status === "closed" ? "muted" : "accent"}>
          {t(statusKey)}
        </Badge>
        <Badge tone="muted">
          {t(blind ? "shift.countModeBlind" : "shift.countModeOpen")}
        </Badge>
      </div>

      <Callout tone="muted">{t(blind ? "shift.blindLiveNote" : "shift.openCountNote")}</Callout>
      {context.tolerance === null ? <Callout tone="warn">{t("shift.noPolicy")}</Callout> : null}

      <DescList>
        <DescRow label={t("fin.openingFloat")} mono>
          {formatMoney(context.openingFloat, fmt)}
        </DescRow>
        <DescRow label={t("shift.tolerance")} mono>
          <Withheld value={held(context.tolerance)} />
        </DescRow>
        <DescRow label={t("shift.expected")} mono>
          <Withheld value={held(context.expectedCash)} />
        </DescRow>
        <DescRow label={t("shift.countedTotal")} mono>
          <Withheld value={held(context.countedCash)} />
        </DescRow>
        <DescRow label={t("shift.variance")} mono>
          <Withheld value={held(context.variance)} />
        </DescRow>
      </DescList>
    </section>
  );
}

/** A figure the server has not disclosed reads as absent, never as zero. */
function Withheld({ value }: { value: Money | null }) {
  const { fmt } = useI18n();
  if (!value) return <span className="text-fg-subtle">—</span>;
  return <>{formatMoney(value, fmt)}</>;
}

// ---------------------------------------------------------------------------

/** FR-POS-091 [M] — pay-in, pay-out, safe drop. The reason is not optional. */
function MovementForm({
  cashSessionId,
  onRecorded,
}: {
  cashSessionId: string;
  onRecorded: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [kind, setKind] = useState<CashMovementKind>("pay_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const minor = Math.round(Number(amount) * 100);
  const valid = amount.trim() !== "" && Number.isFinite(minor) && minor > 0 && reason.trim() !== "";

  async function record() {
    if (!valid) return;
    await action.run(
      () =>
        services.treasury.recordMovement(cashSessionId, kind, {
          amountMinor: String(minor),
          reason: reason.trim(),
        }),
      {
        onSuccess: () => {
          setAmount("");
          setReason("");
          onRecorded();
        },
      },
    );
  }

  return (
    <section className="border-line space-y-3 border-t pt-4">
      <h3 className="text-fg text-sm font-semibold">{t("shift.drawerOps")}</h3>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <SegmentedControl
        value={kind}
        onChange={setKind}
        options={[
          { value: "pay_in", label: t("shift.payIn") },
          { value: "pay_out", label: t("shift.payOut") },
          { value: "safe_drop", label: t("shift.safeDrop") },
        ]}
      />

      <Field label={t("shift.amount")} hint={t("shift.movementAmountHint")} required>
        <Input
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>

      <Field label={t("shift.reason")} hint={t("shift.reasonRequired")} required>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>

      <Button
        variant="secondary"
        className="w-full"
        loading={action.pending}
        disabled={!valid}
        onClick={record}
      >
        {t("shift.record")}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-POS-094/096/097 [M] — the count.
 *
 * Two ways to count, because the backend accepts either: one total, or a
 * denomination breakdown it totals itself. The breakdown leads, because it is
 * the honest one under a blind count — a cashier who types a single figure
 * has usually already done the arithmetic against something.
 */
function DeclareCloseForm({
  cashSessionId,
  context,
  onDeclared,
  recount,
}: {
  cashSessionId: string;
  context: CashCloseContext | null;
  onDeclared: (declaration: CashCloseDeclaration) => void;
  /**
   * Present only when recounting after a manager rejection. The form is the
   * SAME count entry — denominations included — but mounts empty every time
   * (nothing from the earlier count, no expected figure, no default) and
   * submits to the recount route naming the attempt it replaces.
   */
  recount?: { supersedesCloseAttemptId: string; onCancel: () => void };
}) {
  const { t } = useI18n();
  const action = useAction();
  const [mode, setMode] = useState<"denominations" | "total">("denominations");
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<{ face: string; count: string }[]>([{ face: "", count: "" }]);

  // Finished elsewhere — another terminal, or a previous visit to this sheet.
  if (context?.status === "closed") {
    return <Callout tone="muted">{t("shift.closed")}</Callout>;
  }

  const denominations: DenominationCountInput[] = rows
    .map((row) => ({
      denominationMinorUnits: String(Math.round(Number(row.face) * 100)),
      quantity: Number(row.count),
    }))
    .filter(
      (row) =>
        /^[1-9][0-9]*$/.test(row.denominationMinorUnits) &&
        Number.isInteger(row.quantity) &&
        row.quantity >= 1,
    );

  const totalMinor = Math.round(Number(total) * 100);
  const valid =
    mode === "denominations"
      ? denominations.length > 0
      : total.trim() !== "" && Number.isFinite(totalMinor) && totalMinor >= 0;

  async function declare() {
    if (!valid) return;
    const count =
      mode === "denominations"
        ? { denominations }
        : { countedTotalMinorUnits: String(totalMinor) };
    await action.run(
      () =>
        recount
          ? services.treasury.recountClose(cashSessionId, {
              ...count,
              supersedesCloseAttemptId: recount.supersedesCloseAttemptId,
            })
          : services.treasury.declareClose(cashSessionId, count),
      { onSuccess: onDeclared },
    );
  }

  function editRow(index: number, patch: Partial<{ face: string; count: string }>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <section className="border-line space-y-3 border-t pt-4">
      <h3 className="text-fg text-sm font-semibold">
        {t(recount ? "shift.recountTitle" : "shift.closeDrawer")}
      </h3>

      {recount ? <Callout tone="muted">{t("shift.recountNote")}</Callout> : null}

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("shift.countBy")}>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "denominations", label: t("shift.countByDenomination") },
            { value: "total", label: t("shift.countByTotal") },
          ]}
        />
      </Field>

      {mode === "total" ? (
        <Field label={t("shift.countedTotal")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
          />
        </Field>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-2 gap-2">
              <Field label={index === 0 ? t("shift.faceValue") : ""}>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={row.face}
                  onChange={(event) => editRow(index, { face: event.target.value })}
                />
              </Field>
              <Field label={index === 0 ? t("shift.count") : ""}>
                <Input
                  inputMode="numeric"
                  dir="ltr"
                  value={row.count}
                  onChange={(event) => editRow(index, { count: event.target.value })}
                />
              </Field>
            </div>
          ))}
          <Button
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={() => setRows((current) => [...current, { face: "", count: "" }])}
          >
            {t("shift.addDenomination")}
          </Button>
        </div>
      )}

      <Button
        variant="primary"
        className="w-full"
        loading={action.pending}
        disabled={!valid}
        onClick={declare}
      >
        {t(recount ? "shift.recountCommit" : "shift.declare")}
      </Button>

      {recount ? (
        <Button variant="ghost" className="w-full" disabled={action.pending} onClick={recount.onCancel}>
          {t("shift.recountCancel")}
        </Button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * The manager rejected the variance. The old screen offered nothing here but
 * another manager decision against the same count — which, when the count
 * itself was wrong, meant approving a false variance to get out. The primary
 * action is now the honest one: count the drawer again.
 *
 * A fresh decision on the SAME count stays possible (R-6(a) clause 8) but is
 * deliberately secondary, and never the default.
 */
function RejectedRecountPanel({
  decisionShown,
  onRecount,
  onToggleDecision,
}: {
  decisionShown: boolean;
  onRecount: () => void;
  onToggleDecision: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="border-line space-y-3 border-t pt-4">
      <h3 className="text-fg text-sm font-semibold">{t("shift.rejectedTitle")}</h3>

      <Callout tone="warn" icon={<AlertTriangle size={14} />}>
        {t("shift.rejectedNote")}
      </Callout>

      <Button variant="primary" className="w-full" onClick={onRecount}>
        {t("shift.recount")}
      </Button>

      {decisionShown ? null : (
        <Button variant="ghost" className="w-full" onClick={onToggleDecision}>
          {t("shift.recordNewDecision")}
        </Button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-FIN-006 [M] — the manager's decision on a frozen close.
 *
 * The PIN belongs to the *manager*, not the signed-in cashier: the server
 * checks `cash.variance.approve` against the verified manager's permissions,
 * which is the entire reason it is asked for at the till. `declaration` is
 * null when the freeze was declared on another terminal — the figures then
 * come from `close-context`, which discloses them once the count is durable.
 */
function FinalizeCloseForm({
  cashSessionId,
  declaration,
  context,
  onOutcome,
}: {
  cashSessionId: string;
  declaration: CashCloseDeclaration | null;
  context: CashCloseContext | null;
  onOutcome: (
    outcome: "closed" | "rejected",
    figures?: { countedCash: Money | null; variance: Money | null },
  ) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [managerEmployeeCode, setManagerEmployeeCode] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  // The figures the manager is shown and the attempt the decision is bound to
  // come from ONE source: the server's current count when it has been read,
  // else this tab's own declaration. That is what lets the server refuse a
  // decision on a count that a recount has since superseded.
  const current = context?.closeAttemptId ? context : null;
  const expected = (current ? current.expectedCash : declaration?.expectedCash) ?? null;
  const counted = (current ? current.countedCash : declaration?.countedCash) ?? null;
  const variance = (current ? current.variance : declaration?.variance) ?? null;
  const tolerance = (current ? current.tolerance : declaration?.tolerance) ?? null;
  const shownAttemptId = (current ? current.closeAttemptId : declaration?.closeAttemptId) ?? null;

  const valid =
    managerEmployeeCode.trim() !== "" && /^[0-9]{4,8}$/.test(managerPin) && reason.trim() !== "";

  async function decide(decision: "approved" | "rejected") {
    if (!valid) return;
    await action.run(
      () =>
        services.treasury.finalizeClose(cashSessionId, {
          decision,
          reason: reason.trim(),
          managerEmployeeCode: managerEmployeeCode.trim(),
          managerPin,
          comment: comment.trim() || undefined,
          closeAttemptId: shownAttemptId ?? undefined,
        }),
      {
        onSuccess: (result) => {
          // Never leave a manager's PIN sitting in a field on a shared till.
          setManagerPin("");
          onOutcome(result.outcome, { countedCash: counted, variance });
        },
      },
    );
  }

  return (
    <section className="border-line space-y-3 border-t pt-4">
      <h3 className="text-fg text-sm font-semibold">{t("shift.frozenTitle")}</h3>

      <Callout tone="warn" icon={<AlertTriangle size={14} />}>
        {t("shift.frozenNote")}
      </Callout>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <DescList>
        <DescRow label={t("shift.expected")} mono>
          <Withheld value={expected} />
        </DescRow>
        <DescRow label={t("shift.countedTotal")} mono>
          <Withheld value={counted} />
        </DescRow>
        <DescRow label={t("shift.variance")} mono>
          <Withheld value={variance} />
        </DescRow>
        <DescRow label={t("shift.tolerance")} mono>
          <Withheld value={tolerance} />
        </DescRow>
      </DescList>

      <Field label={t("shift.managerCode")} required>
        <Input
          dir="ltr"
          autoComplete="off"
          value={managerEmployeeCode}
          onChange={(event) => setManagerEmployeeCode(event.target.value)}
        />
      </Field>

      <Field label={t("shift.managerPin")} required>
        <Input
          type="password"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          value={managerPin}
          onChange={(event) => setManagerPin(event.target.value)}
        />
      </Field>

      <Field label={t("shift.decisionReason")} hint={t("shift.decisionReasonHint")} required>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>

      <Field label={t("shift.comment")}>
        <Textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          loading={action.pending}
          disabled={!valid}
          onClick={() => decide("approved")}
        >
          {t("shift.approveClose")}
        </Button>
        <Button
          variant="danger"
          loading={action.pending}
          disabled={!valid}
          onClick={() => decide("rejected")}
        >
          {t("shift.rejectClose")}
        </Button>
      </div>

    </section>
  );
}
