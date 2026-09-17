"use client";

/**
 * FR-BRN-005 — branch groups as a report filter.
 *
 * Any report that lists branches can take this select and narrow its rows
 * to a region, cluster or franchise territory (child groups included).
 */

import { useMemo } from "react";

import type { Id } from "@/lib/console/types";
import { branchesInGroup, type BranchGroup } from "@/lib/console/branch-network";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import { Field, Select } from "@/components/console/ui";

export function useBranchGroups() {
  return useAsync(() => services.branchNetwork.groups.all(), []);
}

/** The branch ids a group selection allows, or null for "all branches". */
export function useGroupBranchIds(groups: BranchGroup[] | null, groupId: string): Set<Id> | null {
  return useMemo(() => {
    if (!groupId || !groups) return null;
    return new Set(branchesInGroup(groups, groupId));
  }, [groups, groupId]);
}

export function BranchGroupSelect({
  groups,
  value,
  onChange,
}: {
  groups: BranchGroup[];
  value: string;
  onChange: (groupId: string) => void;
}) {
  const { t, tx } = useI18n();
  return (
    <Field label={t("brn.group.filter")}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("brn.group.all")}</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {tx(group.name)} · {t(`brn.group.kind.${group.kind}` as ConsoleKey)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
