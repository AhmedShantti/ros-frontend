"use client";

/**
 * Effective access, scope by scope — FR-SEC-003, FR-SEC-004.
 *
 * A user may be Branch Manager at one branch and Cashier at another. The
 * users drawer already lists each assignment; what it could not answer is
 * the question an auditor actually asks: "at Branch 2, what can this person
 * do?" This groups the assignments in force today by where they apply —
 * tenant-wide, a brand, a branch set, one branch — and shows, per place,
 * the roles that apply and the permissions they add up to.
 *
 * A tenant-wide or brand assignment also reaches every branch beneath it,
 * so each branch row includes what flows down from above and says which
 * permissions came from there. The segregation-of-duties check is not
 * repeated here: it runs on the union (see `lib/console/access.ts`), because
 * a conflict split across two branches is still a conflict.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import type { Branch, Brand, Role, RoleAssignment } from "@/lib/console/types";
import { PERMISSION_BY_KEY, PERMISSION_GROUPS, type PermissionKey } from "@/lib/console/permissions";
import { isInForce } from "@/lib/console/access";
import { useI18n, useSession } from "@/lib/console/providers";
import { SCOPE_LEVEL, labelOf } from "@/lib/console/labels";
import { Badge, cx } from "@/components/console/ui";

interface ScopeRow {
  key: string;
  label: string;
  level: RoleAssignment["scopeLevel"];
  direct: Role[];
  inherited: Role[];
  permissions: Set<PermissionKey>;
  inheritedOnly: Set<PermissionKey>;
}

function union(roles: Role[]): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  for (const role of roles) for (const permission of role.permissions) out.add(permission);
  return out;
}

export function buildScopeRows(
  assignments: RoleAssignment[],
  rolesById: Map<string, Role>,
  brands: Brand[],
  branches: Branch[],
  name: (value: Brand | Branch | undefined) => string,
  allLabel: string,
): ScopeRow[] {
  const inForce = assignments.filter((assignment) => isInForce(assignment));
  const roleOf = (assignment: RoleAssignment) => rolesById.get(assignment.roleId);
  const present = (roles: (Role | undefined)[]) => roles.filter((role): role is Role => Boolean(role));

  const tenantRoles = present(inForce.filter((a) => a.scopeLevel === "tenant").map(roleOf));
  const brandRoles = (brandId: string) =>
    present(
      inForce
        .filter((a) => a.scopeLevel === "brand" && (a.scopeIds.length === 0 || a.scopeIds.includes(brandId)))
        .map(roleOf),
    );
  const branchRoles = (branchId: string) =>
    present(
      inForce
        .filter(
          (a) =>
            (a.scopeLevel === "branch" || a.scopeLevel === "branch_set") &&
            (a.scopeIds.length === 0 || a.scopeIds.includes(branchId)),
        )
        .map(roleOf),
    );

  const rows: ScopeRow[] = [];
  if (tenantRoles.length > 0) {
    const permissions = union(tenantRoles);
    rows.push({ key: "tenant", label: allLabel, level: "tenant", direct: tenantRoles, inherited: [], permissions, inheritedOnly: new Set() });
  }

  const brandIds = new Set(inForce.filter((a) => a.scopeLevel === "brand").flatMap((a) => (a.scopeIds.length ? a.scopeIds : brands.map((b) => b.id))));
  for (const brandId of brandIds) {
    const direct = brandRoles(brandId);
    const permissions = union([...tenantRoles, ...direct]);
    const own = union(direct);
    rows.push({
      key: `brand:${brandId}`,
      label: name(brands.find((b) => b.id === brandId)) || brandId,
      level: "brand",
      direct,
      inherited: tenantRoles,
      permissions,
      inheritedOnly: new Set([...permissions].filter((p) => !own.has(p))),
    });
  }

  const branchIds = new Set(
    inForce
      .filter((a) => a.scopeLevel === "branch" || a.scopeLevel === "branch_set")
      .flatMap((a) => (a.scopeIds.length ? a.scopeIds : branches.map((b) => b.id))),
  );
  for (const branchId of branchIds) {
    const branch = branches.find((b) => b.id === branchId);
    const direct = branchRoles(branchId);
    const fromAbove = [...tenantRoles, ...(branch ? brandRoles(branch.brandId) : [])];
    const permissions = union([...fromAbove, ...direct]);
    const own = union(direct);
    rows.push({
      key: `branch:${branchId}`,
      label: name(branch) || branchId,
      level: "branch",
      direct,
      inherited: fromAbove,
      permissions,
      inheritedOnly: new Set([...permissions].filter((p) => !own.has(p))),
    });
  }
  return rows;
}

export function EffectiveAccessByScope({
  assignments,
  roles,
}: {
  assignments: RoleAssignment[];
  roles: Role[];
}) {
  const { t, tx } = useI18n();
  const { availableBrands, availableBranches } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const rows = useMemo(
    () =>
      buildScopeRows(assignments, rolesById, availableBrands, availableBranches, (value) => tx(value?.name), t("usr.scopeAll")),
    [assignments, rolesById, availableBrands, availableBranches, tx, t],
  );

  return (
    <section>
      <h3 className="text-fg mb-1 text-sm font-semibold">{t("eff.title")}</h3>
      <p className="text-fg-muted mb-2 text-xs">{t("eff.hint")}</p>
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("eff.none")}</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {rows.map((row) => {
            const expanded = open === row.key;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : row.key)}
                  className="hover:bg-sunken flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start"
                >
                  {expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden className="rtl:rotate-180" />}
                  <span className="text-fg text-sm font-medium">{row.label}</span>
                  <Badge tone="muted">{tx(labelOf(SCOPE_LEVEL, row.level).label)}</Badge>
                  <span className="text-fg-muted text-xs">{row.direct.map((role) => tx(role.name)).join(" · ")}</span>
                  <span className="text-fg-muted ms-auto font-mono text-xs tabular-nums">
                    {t("eff.count").replace("{n}", String(row.permissions.size))}
                  </span>
                </button>
                {expanded ? (
                  <div className="space-y-2 px-3 pb-3">
                    {row.inherited.length > 0 ? (
                      <p className="text-fg-subtle text-xs">
                        {t("eff.inherits").replace("{roles}", row.inherited.map((role) => tx(role.name)).join(", "))}
                      </p>
                    ) : null}
                    {PERMISSION_GROUPS.map((group) => {
                      const keys = [...row.permissions].filter((key) => PERMISSION_BY_KEY.get(key)?.group === group);
                      if (keys.length === 0) return null;
                      return (
                        <div key={group}>
                          <p className="text-fg-subtle text-[0.68rem] font-semibold tracking-wide uppercase">
                            {t(`perm.group.${group}` as ConsoleKey)}
                          </p>
                          <ul className="mt-0.5 flex flex-wrap gap-1">
                            {keys.map((key) => (
                              <li
                                key={key}
                                title={row.inheritedOnly.has(key) ? t("eff.fromAbove") : undefined}
                                className={cx(
                                  "rounded border px-1.5 py-0.5 text-[0.68rem]",
                                  row.inheritedOnly.has(key) ? "border-line text-fg-muted border-dashed" : "border-line text-fg",
                                )}
                              >
                                {tx(PERMISSION_BY_KEY.get(key)?.label)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
