"use client";

/**
 * Inventory approval policy — FR-INV-035/047/058.
 *
 * The Owner/authorized-manager setup surface for `GET`/`POST
 * /branches/{branchId}/inventory-approval-policy`: the per-branch value
 * thresholds above which a manual adjustment, a count variance, or a waste
 * record is routed to a manager for approval instead of posting directly.
 *
 * Mirrors `finance/cash-close-policy` (same insert-only, effective-dated,
 * branch-scoped policy shape, same `settings.branch.manage` gate) — every
 * Save publishes a new effective version; there is no edit endpoint, and a
 * `null` threshold is not "unset", it means "always require approval" for
 * that action. Currency is always server-derived from the branch; this
 * screen never sends one.
 */

import { useEffect, useState } from "react";
import type { InventoryApprovalPolicy } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime } from "@/lib/console/format";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { Button, Callout, Field, Input, Select, Toast } from "@/components/console/ui";
import { percentToBps, bpsToPercent } from "@/lib/console/count-variance-review";
import { MoneyInput } from "@/components/console/fields";

export default function InventoryApprovalPolicyPage() {
  return (
    <Gate permissions={["settings.branch.manage"]}>
      <InventoryApprovalPolicyScreen />
    </Gate>
  );
}

function InventoryApprovalPolicyScreen() {
  const { t, tx } = useI18n();
  const { branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");
  const [message, setMessage] = useTransientMessage();

  // Same branch-context re-sync as cash-close-policy (DEMO-OPS-HOTFIX-3):
  // `branch`/`availableBranches` resolve asynchronously, so a one-time
  // initializer would lock onto an empty/stale selection forever.
  useEffect(() => {
    const defaultBranchId = branch?.id ?? availableBranches[0]?.id ?? "";
    setBranchId((current) => {
      if (current && availableBranches.some((b) => b.id === current)) {
        return current;
      }
      return defaultBranchId;
    });
  }, [branch, availableBranches]);

  const selectedBranch = availableBranches.find((b) => b.id === branchId) ?? null;

  const policyQuery = useAsync(
    () =>
      branchId
        ? services.inventory.getApprovalPolicy(branchId)
        : Promise.resolve(null as InventoryApprovalPolicy | null),
    [branchId],
  );

  return (
    <>
      <PageHeader
        title={t("inv.approvalPolicyTitle")}
        subtitle={t("inv.approvalPolicySubtitle")}
        spec="FR-INV-035/046/047/058"
      />

      <PageBody>
        {availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Section title={t("inv.approvalPolicy")} hint={t("inv.approvalPolicyHint")}>
          {!branchId ? (
            <Callout tone="warn">{t("shift.selectBranch")}</Callout>
          ) : policyQuery.loading ? (
            <Callout tone="muted">{t("state.loading")}</Callout>
          ) : policyQuery.error ? (
            <Callout tone="bad">{policyQuery.error.message}</Callout>
          ) : (
            <>
              {!policyQuery.data ? <Callout tone="muted">{t("inv.noApprovalPolicy")}</Callout> : null}
              {selectedBranch ? (
                <ApprovalPolicyForm
                  key={`${branchId}:${policyQuery.data?.id ?? "none"}`}
                  branchId={branchId}
                  currency={policyQuery.data?.currency ?? selectedBranch.currency}
                  policy={policyQuery.data}
                  onSaved={() => {
                    setMessage(t("inv.approvalPolicySaved"));
                    policyQuery.reload();
                  }}
                />
              ) : null}
            </>
          )}
        </Section>
      </PageBody>

      <Toast message={message} />
    </>
  );
}

function ApprovalPolicyForm({
  branchId,
  currency,
  policy,
  onSaved,
}: {
  branchId: string;
  currency: InventoryApprovalPolicy["currency"];
  policy: InventoryApprovalPolicy | null;
  onSaved: () => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();

  // Minor units as a number, exactly `MoneyInput`'s own contract — null is
  // both "field left blank" and "always require approval" (FR-INV-035/047/
  // 058: a null threshold fails closed). Safe to parse with `Number` here:
  // these are manager-set approval ceilings, never the arbitrarily large
  // running totals `InventoryValuationRow.value` has to guard against.
  const [adjustment, setAdjustment] = useState<number | null>(
    policy?.adjustmentValueThresholdMinor != null ? Number(policy.adjustmentValueThresholdMinor) : null,
  );
  const [countVariance, setCountVariance] = useState<number | null>(
    policy?.countVarianceValueThresholdMinor != null
      ? Number(policy.countVarianceValueThresholdMinor)
      : null,
  );
  const [waste, setWaste] = useState<number | null>(
    policy?.wasteValueThresholdMinor != null ? Number(policy.wasteValueThresholdMinor) : null,
  );

  const [recountValue, setRecountValue] = useState<number | null>(
    policy?.countRecountVarianceValueThresholdMinor != null ? Number(policy.countRecountVarianceValueThresholdMinor) : null,
  );
  const [recountPercent, setRecountPercent] = useState(bpsToPercent(policy?.countRecountVariancePercentBps));
  const recountBps = percentToBps(recountPercent);

  async function save() {
    if (recountBps === undefined) return;
    await action.run(
      () =>
        services.inventory.createApprovalPolicy(branchId, {
          adjustmentValueThresholdMinor: adjustment === null ? null : String(adjustment),
          countVarianceValueThresholdMinor: countVariance === null ? null : String(countVariance),
          wasteValueThresholdMinor: waste === null ? null : String(waste),
          countRecountVarianceValueThresholdMinor: recountValue === null ? null : String(recountValue),
          countRecountVariancePercentBps: recountBps,
        }),
      { onSuccess: onSaved },
    );
  }

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("inv.adjustmentThreshold")} hint={t("inv.thresholdBlankHint")}>
        <MoneyInput value={adjustment} onChange={setAdjustment} currency={currency} disabled={action.pending} />
      </Field>
      <Field label={t("inv.countVarianceThreshold")} hint={t("inv.thresholdBlankHint")}>
        <MoneyInput
          value={countVariance}
          onChange={setCountVariance}
          currency={currency}
          disabled={action.pending}
        />
      </Field>
      <Field label={t("inv.wasteThreshold")} hint={t("inv.thresholdBlankHint")}>
        <MoneyInput value={waste} onChange={setWaste} currency={currency} disabled={action.pending} />
      </Field>

      <Field label={t("inv.recountValueThreshold")} hint={t("inv.recountThresholdHint")}>
        <MoneyInput value={recountValue} onChange={setRecountValue} currency={currency} disabled={action.pending} min={0} />
      </Field>
      <Field label={t("inv.recountPercentThreshold")} hint={t("inv.recountPercentHint")}>
        <Input inputMode="decimal" dir="ltr" value={recountPercent} disabled={action.pending}
          aria-invalid={recountBps === undefined} onChange={(event) => setRecountPercent(event.target.value)} />
      </Field>
      {recountBps === undefined ? <Callout tone="bad">{t("inv.recountPercentInvalid")}</Callout> : null}

      {policy ? (
        <p className="text-fg-subtle text-xs">
          {t("inv.approvalPolicyEffectiveSince")} {formatDateTime(policy.effectiveFrom, fmt)}
        </p>
      ) : null}

      <Button variant="primary" loading={action.pending} disabled={recountBps === undefined} onClick={save}>
        {t("common.save")}
      </Button>
    </div>
  );
}
