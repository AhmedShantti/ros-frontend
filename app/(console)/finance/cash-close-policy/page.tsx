"use client";

/**
 * Cash-close policy — R-1(a), R-4(a), R-5, GOLDEN-PATH-FINAL-INTEGRATION.
 *
 * The Owner/authorized-manager setup surface for `GET`/`POST
 * /branches/{branchId}/cash-close-policy`: the branch rule a shift close is
 * judged against (variance tolerance, count mode, approval-expiry window).
 *
 * Deliberately NOT on the POS terminal. The endpoint is a dashboard/
 * back-office route — `JwtAuthGuard` refuses every PIN-issued session by
 * construction (FR-SEC-021) — so a cashier could never publish through it,
 * only see a form that 403s. This page is the one real surface, gated the
 * same way `Operations -> Drawers`/`Stations` are.
 *
 * Every save publishes a new immutable version; there is no edit, and the
 * database refuses an effective instant in the past.
 */

import { useEffect, useState } from "react";
import type { CashClosePolicy } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney } from "@/lib/console/format";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Field,
  Input,
  SegmentedControl,
  Select,
  Toast,
} from "@/components/console/ui";

export default function CashClosePolicyPage() {
  return (
    <Gate permissions={["settings.branch.manage"]}>
      <CashClosePolicyScreen />
    </Gate>
  );
}

function CashClosePolicyScreen() {
  const { t, tx } = useI18n();
  const { branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");
  const [message, setMessage] = useTransientMessage();

  // Same branch-context re-sync as Drawers/Stations (DEMO-OPS-HOTFIX-3):
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

  const policyQuery = useAsync(
    () =>
      branchId
        ? services.treasury.getCashClosePolicy(branchId)
        : Promise.resolve(null as CashClosePolicy | null),
    [branchId],
  );

  return (
    <>
      <PageHeader title={t("ccp.title")} subtitle={t("ccp.subtitle")} spec="R-1(a)/R-4(a)/R-5" />

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

        <Section title={t("ccp.currentTitle")}>
          {policyQuery.loading ? (
            <Callout tone="muted">{t("state.loading")}</Callout>
          ) : policyQuery.data ? (
            <CurrentPolicyCard policy={policyQuery.data} />
          ) : (
            <Callout tone="warn" title={t("ccp.notConfigured")}>
              {t("ccp.notConfiguredNote")}
            </Callout>
          )}
        </Section>

        <Section title={t("ccp.newTitle")}>
          <NewPolicyCard
            branchId={branchId}
            onPublished={() => {
              setMessage(t("shift.policyPublished"));
              policyQuery.reload();
            }}
          />
        </Section>
      </PageBody>

      <Toast message={message} />
    </>
  );
}

function CurrentPolicyCard({ policy }: { policy: CashClosePolicy }) {
  const { t, fmt } = useI18n();
  return (
    <Card>
      <DescList>
        <DescRow label={t("shift.countMode")}>
          {policy.countMode === "blind" ? t("shift.countModeBlind") : t("shift.countModeOpen")}
        </DescRow>
        <DescRow label={t("shift.policyTolerance")} mono>
          {formatMoney(policy.tolerance, fmt)}
        </DescRow>
        <DescRow label={t("shift.policyExpiry")} mono>
          {policy.varianceApprovalExpirySeconds}
        </DescRow>
        <DescRow label={t("shift.policyEffectiveFrom")}>
          {formatDateTime(policy.effectiveFrom, fmt)}
        </DescRow>
        <DescRow label={t("common.currency")}>{policy.tolerance.currency}</DescRow>
      </DescList>
    </Card>
  );
}

function NewPolicyCard({
  branchId,
  onPublished,
}: {
  branchId: string;
  onPublished: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [tolerance, setTolerance] = useState("0");
  const [expiry, setExpiry] = useState("900");
  const [countMode, setCountMode] = useState<"blind" | "open">("blind");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const toleranceMinor = Math.round(Number(tolerance) * 100);
  const expirySeconds = Number(expiry);
  const valid =
    branchId !== "" &&
    tolerance.trim() !== "" &&
    Number.isFinite(toleranceMinor) &&
    toleranceMinor >= 0 &&
    Number.isInteger(expirySeconds) &&
    expirySeconds >= 1;

  async function publish() {
    if (!valid) return;
    await action.run(
      () =>
        services.treasury.setCashClosePolicy(branchId, {
          varianceToleranceMinorUnits: String(toleranceMinor),
          varianceApprovalExpirySeconds: expirySeconds,
          countMode,
          // A `datetime-local` value carries no zone; the ISO string it
          // becomes is what the DB's "not in the past" check reads.
          effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
        }),
      { onSuccess: onPublished },
    );
  }

  return (
    <Card>
      <CardHeader title={t("shift.policyTitle")} hint={t("shift.policyNote")} spec="FR-POS-094" />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {!branchId ? <Callout tone="warn">{t("shift.selectBranch")}</Callout> : null}

      <div className="mt-4 space-y-4">
        <Field label={t("shift.policyTolerance")} hint={t("shift.policyToleranceHint")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={tolerance}
            onChange={(event) => setTolerance(event.target.value)}
          />
        </Field>

        <Field label={t("shift.countMode")}>
          <SegmentedControl
            value={countMode}
            onChange={setCountMode}
            options={[
              { value: "blind", label: t("shift.countModeBlind") },
              { value: "open", label: t("shift.countModeOpen") },
            ]}
          />
        </Field>

        <Field label={t("shift.policyExpiry")} required>
          <Input
            inputMode="numeric"
            dir="ltr"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </Field>

        <Field label={t("shift.policyEffectiveFrom")} hint={t("shift.policyEffectiveFromHint")}>
          <Input
            type="datetime-local"
            dir="ltr"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          loading={action.pending}
          disabled={!valid}
          onClick={publish}
        >
          {t("shift.publishPolicy")}
        </Button>
      </div>
    </Card>
  );
}
