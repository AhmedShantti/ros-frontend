"use client";

/**
 * FR-BRN-035 — restricted configuration authority at franchise branches.
 *
 * Any screen that changes menu, recipes, pricing, suppliers, receipt branding
 * or promotions at one branch asks `useFranchiseLock(branchId, domain)`
 * before offering the change, and shows `<FranchiseLockNotice>`:
 *
 *   - locked: the branch's franchise agreement keeps that domain with the
 *     brand and this person is not the franchisor — the change is refused;
 *   - franchisorOverride: the domain is locked, but this person holds
 *     `org.manage` and is changing it on the brand's behalf — allowed, and
 *     said so.
 */

import { Lock, ShieldAlert } from "lucide-react";

import type { Id } from "@/lib/console/types";
import { franchiseLockFor, type FranchiseDomain, type FranchiseLock } from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import { Callout } from "@/components/console/ui";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useFranchiseLock(branchId: Id | null, domain: FranchiseDomain): FranchiseLock & { loading: boolean } {
  const isFranchisor = usePermission("org.manage");
  const agreements = useAsync(() => services.branchNetwork.franchiseAgreements.all(), []);
  const lock = franchiseLockFor(agreements.data ?? [], branchId, domain, isFranchisor, todayIso());
  return { ...lock, loading: agreements.loading && agreements.data === null };
}

export function FranchiseLockNotice({ lock, domain }: { lock: FranchiseLock; domain: FranchiseDomain }) {
  const { t } = useI18n();
  const domainLabel = t(`frn.domain.${domain}` as ConsoleKey);
  const franchisee = lock.agreement?.franchiseeName ?? "";
  if (lock.locked) {
    return (
      <Callout tone="bad" icon={<Lock size={14} />} title={t("frn.lock.lockedTitle")}>
        {t("frn.lock.lockedBody").replace("{domain}", domainLabel).replace("{franchisee}", franchisee)}
      </Callout>
    );
  }
  if (lock.franchisorOverride) {
    return (
      <Callout tone="warn" icon={<ShieldAlert size={14} />} title={t("frn.lock.overrideTitle")}>
        {t("frn.lock.overrideBody").replace("{domain}", domainLabel).replace("{franchisee}", franchisee)}
      </Callout>
    );
  }
  return null;
}
