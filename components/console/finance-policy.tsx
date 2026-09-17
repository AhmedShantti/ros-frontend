"use client";

/**
 * Branch finance policies read through the settings cascade.
 *
 * The screens that need an effective value (shared-drawer mode on the cash
 * screens, price display on the tax page) all ask `resolveSetting` the same
 * question, with the branch's country pack in play, so a lock at tenant level
 * is honoured here exactly as it is in the settings inspector.
 */

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { Users } from "lucide-react";

import type { CountryPack, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { LEVEL_LABEL, SETTING_BY_KEY, resolveSetting, type ResolvedSetting } from "@/lib/console/settings";
import { Badge, Callout } from "@/components/console/ui";

/** Overrides and country packs, loaded once, and a resolver per branch. */
export function useBranchSettings() {
  const { tenant, availableBranches } = useSession();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);
  // Live, there is no country-pack endpoint; the country level then supplies
  // nothing rather than borrowing the demo's packs.
  const packs = useAsync<CountryPack[]>(
    () =>
      services.platform.countryPacks
        .list({ limit: 50 })
        .then((page) => page.rows)
        .catch(() => []),
    [],
  );

  const resolve = useCallback(
    (key: string, branchId: Id | null): ResolvedSetting | null => {
      const definition = SETTING_BY_KEY.get(key);
      if (!definition) return null;
      const branch = availableBranches.find((row) => row.id === branchId) ?? null;
      return resolveSetting(
        definition,
        overrides.data ?? [],
        {
          countryCode: branch?.countryCode ?? tenant.countryCode,
          tenantId: tenant.id,
          brandId: branch?.brandId ?? null,
          branchId: branch?.id ?? null,
          terminalId: null,
        },
        { packs: packs.data ?? [] },
      );
    },
    [overrides.data, packs.data, availableBranches, tenant],
  );

  return {
    resolve,
    packs: packs.data ?? [],
    loading: overrides.loading || packs.loading,
    reload: () => {
      overrides.reload();
      packs.reload();
    },
  };
}

/** FR-FIN-003 — the set of branches in scope running shared-drawer mode. */
export function useSharedDrawerBranches(): Set<Id> {
  const { availableBranches } = useSession();
  const { resolve } = useBranchSettings();
  return useMemo(
    () =>
      new Set(
        availableBranches
          .filter((branch) => Boolean(resolve("cash.sharedDrawerMode", branch.id)?.value))
          .map((branch) => branch.id),
      ),
    [availableBranches, resolve],
  );
}

/** FR-FIN-003 — the visible "reduced control environment" marker. */
export function SharedDrawerBadge() {
  const { t } = useI18n();
  return (
    <Badge tone="warn">
      <Users size={11} aria-hidden />
      {t("fnc.sharedDrawer")}
    </Badge>
  );
}

/** FR-FIN-003 — the prominent explanation, naming the branches affected. */
export function SharedDrawerCallout({ branchIds }: { branchIds: Set<Id> }) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const { resolve } = useBranchSettings();
  if (branchIds.size === 0) return null;
  const names = availableBranches.filter((branch) => branchIds.has(branch.id));
  return (
    <Callout tone="warn" title={t("fnc.reducedControlTitle")}>
      <p>{t("fnc.reducedControlBody")}</p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {names.map((branch) => {
          const resolved = resolve("cash.sharedDrawerMode", branch.id);
          return (
            <li key={branch.id}>
              {tx(branch.name)}
              {resolved ? ` · ${t("fnc.setAt")} ${tx(LEVEL_LABEL[resolved.suppliedBy])}` : ""}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs">
        <Link href="/settings" className="text-accent underline">
          {t("fnc.changeInSettings")}
        </Link>
      </p>
    </Callout>
  );
}
