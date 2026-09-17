"use client";

/**
 * Procurement policy — SRS §12.1, FR-PRC-001, FR-PRC-002.
 *
 * The procure-to-pay cycle is requisition → order → approval → receipt →
 * invoice match → payment approval, and not every restaurant runs all of it.
 * A group with a head office wants every step; a single café buying from the
 * market wants to record what arrived and move on. This page is where a
 * tenant decides, and the rest of purchasing reads the answer:
 *
 *   - requisitions skipped → the requisition screens say so and stop raising;
 *   - order approval skipped → a new order is approved on creation;
 *   - receipt skipped → an invoice is recorded against the order alone;
 *   - match skipped → a recorded invoice is eligible for payment approval;
 *   - payment approval skipped → a matched invoice is approved on record;
 *   - simple mode (FR-PRC-002) → receiving without an order creates the order
 *     and the receipt in one action.
 *
 * Combinations that cannot be operated are refused with the reason, not
 * saved and discovered later (`policyProblems`).
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, SkipForward } from "lucide-react";

import {
  PROCUREMENT_STEPS,
  policyProblems,
  type ApprovedSupplierMode,
  type ProcurementPolicy,
  type ProcurementStep,
} from "@/lib/console/purchasing-rules";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDateTime } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { useActor, usePolicy } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Field, Input, SegmentedControl, Toast, Toggle, cx } from "@/components/console/ui";

export default function ProcurementPolicyPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <PolicyScreen />
    </Gate>
  );
}

function PolicyScreen() {
  const { t, fmt } = useI18n();
  const { policy, error, reload } = usePolicy();
  const canManage = usePermission("purchase.policy.manage");
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const [message, setMessage] = useTransientMessage();
  const [draft, setDraft] = useState<ProcurementPolicy | null>(null);

  useEffect(() => {
    if (policy) setDraft(structuredClone(policy));
  }, [policy]);

  const problems = useMemo(() => (draft ? policyProblems(draft) : []), [draft]);
  const dirty = useMemo(() => Boolean(draft && policy && JSON.stringify(draft) !== JSON.stringify(policy)), [draft, policy]);

  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!draft || !policy) return <LoadingPanel />;

  function setStep(step: ProcurementStep, on: boolean) {
    setDraft((current) => (current ? { ...current, steps: { ...current.steps, [step]: on } } : current));
  }

  function patch(part: Partial<ProcurementPolicy>) {
    setDraft((current) => (current ? { ...current, ...part } : current));
  }

  async function save() {
    if (!draft || problems.length > 0) return;
    const skipped = PROCUREMENT_STEPS.filter((step) => policy!.steps[step] && !draft.steps[step]);
    // Switching a control off is the change worth a second look.
    if (skipped.length > 0) {
      const ok = await confirm({
        title: t("prc.policy.confirmSkipTitle"),
        body: t("prc.policy.confirmSkipBody"),
        detail: (
          <ul className="list-disc space-y-0.5 ps-5 text-xs">
            {skipped.map((step) => (
              <li key={step}>{t(`prc.step.${step}` as ConsoleKey)}</li>
            ))}
          </ul>
        ),
        confirmLabel: t("common.save"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await action.run(() => services.procurement.savePolicy(draft, actor), {
      onSuccess: () => {
        setMessage(t("prc.policy.saved"));
        reload();
      },
    });
  }

  const flow: { key: string; label: string; on: boolean; fixed?: boolean }[] = [
    { key: "requisition", label: t("prc.step.requisition"), on: draft.steps.requisition },
    { key: "order", label: t("prc.step.order"), on: true, fixed: true },
    { key: "poApproval", label: t("prc.step.poApproval"), on: draft.steps.poApproval },
    { key: "goodsReceipt", label: t("prc.step.goodsReceipt"), on: draft.steps.goodsReceipt },
    { key: "threeWayMatch", label: t("prc.step.threeWayMatch"), on: draft.steps.threeWayMatch },
    { key: "paymentApproval", label: t("prc.step.paymentApproval"), on: draft.steps.paymentApproval },
  ];

  return (
    <>
      <PageHeader
        title={t("prc.policy.title")}
        subtitle={t("prc.policy.subtitle")}
        spec="FR-PRC-001"
        meta={
          policy.updatedAt ? (
            <span>
              {t("prc.policy.lastChanged")
                .replace("{when}", formatDateTime(policy.updatedAt, fmt))
                .replace("{who}", policy.updatedBy ?? "—")}
            </span>
          ) : null
        }
        actions={
          canManage ? (
            <Button variant="primary" loading={action.pending} disabled={!dirty || problems.length > 0} onClick={save}>
              {t("common.save")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <Callout tone="muted">{t("prc.localNote")}</Callout>
        {!canManage ? <Callout tone="warn">{t("prc.policy.readOnly")}</Callout> : null}
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {/* FR-PRC-001 — the cycle as it will run, skipped steps shown struck through. */}
        <Section title={t("prc.policy.flowTitle")} hint={t("prc.policy.flowHint")}>
          <ol className="flex flex-wrap items-center gap-2" aria-label={t("prc.policy.flowTitle")}>
            {flow.map((step, index) => (
              <li key={step.key} className="flex items-center gap-2">
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
                    step.on ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-fg-subtle line-through",
                  )}
                >
                  {step.on ? <Check size={12} aria-hidden /> : <SkipForward size={12} aria-hidden />}
                  {step.label}
                  {!step.on ? <span className="sr-only">{t("prc.policy.skipped")}</span> : null}
                </span>
                {index < flow.length - 1 ? <ArrowRight size={12} aria-hidden className="text-fg-subtle rtl:rotate-180" /> : null}
              </li>
            ))}
          </ol>
          {draft.simpleMode ? (
            <Callout tone="accent" className="mt-3" title={t("prc.policy.simpleActive")}>
              {t("prc.policy.simpleActiveBody")}
            </Callout>
          ) : null}
        </Section>

        <Section title={t("prc.policy.stepsTitle")} spec="FR-PRC-001">
          <div className="divide-line divide-y">
            {PROCUREMENT_STEPS.map((step) => (
              <Toggle
                key={step}
                checked={draft.steps[step]}
                disabled={!canManage}
                onChange={(on) => setStep(step, on)}
                label={t(`prc.step.${step}` as ConsoleKey)}
                hint={t(`prc.stepHint.${step}` as ConsoleKey)}
              />
            ))}
          </div>
        </Section>

        {/* FR-PRC-002 — simple mode. */}
        <Section title={t("prc.policy.simpleTitle")} spec="FR-PRC-002">
          <Toggle
            checked={draft.simpleMode}
            disabled={!canManage}
            onChange={(simpleMode) =>
              // Turning simple mode on takes approval off with it, which is the
              // combination simple mode needs; the user still sees and saves it.
              patch(simpleMode ? { simpleMode, steps: { ...draft.steps, poApproval: false, goodsReceipt: true } } : { simpleMode })
            }
            label={t("prc.policy.simpleLabel")}
            hint={t("prc.policy.simpleHint")}
          />
        </Section>

        <Section title={t("prc.policy.controlsTitle")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("prc.policy.approvedMode")} hint={t("prc.policy.approvedModeHint")}>
              <SegmentedControl<ApprovedSupplierMode>
                value={draft.approvedSupplierMode}
                onChange={(approvedSupplierMode) => canManage && patch({ approvedSupplierMode })}
                label={t("prc.policy.approvedMode")}
                options={(["off", "warn", "block"] as const).map((value) => ({ value, label: t(`prc.approvedMode.${value}` as ConsoleKey) }))}
              />
            </Field>
            <Field label={t("prc.policy.alertDays")} hint={t("prc.policy.alertDaysHint")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                disabled={!canManage}
                value={String(draft.complianceAlertDays)}
                onChange={(event) => patch({ complianceAlertDays: Math.trunc(Number(event.target.value) || 0) })}
                className="text-end font-mono tabular-nums"
              />
            </Field>
            <div className="md:col-span-2">
              <Toggle
                checked={draft.blockExpiredCompliance}
                disabled={!canManage}
                onChange={(blockExpiredCompliance) => patch({ blockExpiredCompliance })}
                label={t("prc.policy.blockExpired")}
                hint={t("prc.policy.blockExpiredHint")}
              />
            </div>
            <Field label={t("prc.policy.linkHours")} hint={t("prc.policy.linkHoursHint")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                disabled={!canManage}
                value={String(draft.approvalLinkHours)}
                onChange={(event) => patch({ approvalLinkHours: Math.trunc(Number(event.target.value) || 0) })}
                className="text-end font-mono tabular-nums"
              />
            </Field>
          </div>
        </Section>

        {/* FR-PRC-042 — the tolerances that decide matched versus disputed. */}
        <Section title={t("prc.policy.tolerancesTitle")} hint={t("prc.policy.tolerancesHint")} spec="FR-PRC-042">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("prc.tol.quantity")}>
              <Input
                dir="ltr"
                inputMode="decimal"
                disabled={!canManage}
                value={String(draft.tolerances.quantityPercent)}
                onChange={(event) => patch({ tolerances: { ...draft.tolerances, quantityPercent: Number(event.target.value) } })}
                className="text-end font-mono tabular-nums"
              />
            </Field>
            <Field label={t("prc.tol.price")}>
              <Input
                dir="ltr"
                inputMode="decimal"
                disabled={!canManage}
                value={String(draft.tolerances.pricePercent)}
                onChange={(event) => patch({ tolerances: { ...draft.tolerances, pricePercent: Number(event.target.value) } })}
                className="text-end font-mono tabular-nums"
              />
            </Field>
            <Field label={t("prc.tol.total")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                disabled={!canManage}
                value={String(draft.tolerances.totalMinor)}
                onChange={(event) => patch({ tolerances: { ...draft.tolerances, totalMinor: Math.trunc(Number(event.target.value)) } })}
                className="text-end font-mono tabular-nums"
              />
            </Field>
          </div>
        </Section>

        {problems.length > 0 ? (
          <Callout tone="bad" title={t("prc.policy.problemsTitle")}>
            <ul className="space-y-0.5">
              {problems.map((problem) => (
                <li key={problem}>• {t(`prc.policyProblem.${problem}` as ConsoleKey)}</li>
              ))}
            </ul>
          </Callout>
        ) : dirty ? (
          <div className="flex items-center gap-2">
            <Badge tone="warn">{t("prc.unsaved")}</Badge>
          </div>
        ) : null}
      </PageBody>

      <Toast message={message} />
    </>
  );
}
