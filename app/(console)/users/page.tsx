"use client";

/**
 * Users — SRS §15.
 *
 * A user is a credential. An employee is a person in a job. They are separate
 * entities with an optional link, and conflating them produces a permission
 * model that cannot express either (SRS §14.1) — which is why this screen
 * shows assignments and scopes rather than shifts and pay.
 *
 * The list is deliberately blunt about two things the specification treats as
 * controls rather than decoration: whether MFA is enrolled on a role that
 * requires it (FR-SEC-024), and whether an assignment is a temporary
 * elevation that will expire on its own (FR-SEC-005).
 */

import { useMemo, useState } from "react";
import { ShieldAlert, ShieldCheck, UserCog } from "lucide-react";
import type { RoleAssignment, User } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatRelative } from "@/lib/console/format";
import { SCOPE_LEVEL, USER_STATUS, labelOf } from "@/lib/console/labels";
import {
  ROLE_DEFINITIONS,
  findSodConflicts,
  permissionsForRole,
  roleRequiresMfa,
  type RoleKey,
} from "@/lib/console/permissions";
import { roleById } from "@/lib/console/mock/governance";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";

export default function UsersPage() {
  const { t } = useI18n();

  return (
    <Gate permissions={["security.user.manage"]}>
      <UsersScreen />
      <span className="sr-only">{t("usr.title")}</span>
    </Gate>
  );
}

// ---------------------------------------------------------------------------

function UsersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<User | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<User>(
    (query) => services.security.users.list(query),
    { scope, initialSort: "name" },
  );

  const columns = useMemo<Column<User>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => <CellStack primary={tx(row.name)} secondary={row.email} />,
      },
      {
        key: "role",
        header: t("common.role"),
        render: (row) => <RoleCell assignments={row.assignments} />,
      },
      {
        key: "scope",
        header: t("usr.scopeLevel"),
        secondary: true,
        render: (row) => {
          const assignment = row.assignments[0];
          if (!assignment) return <span className="text-fg-subtle">—</span>;
          const level = labelOf(SCOPE_LEVEL, assignment.scopeLevel);
          return <Badge tone="muted">{tx(level.label)}</Badge>;
        },
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(USER_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
      {
        key: "mfa",
        header: t("usr.mfa"),
        render: (row) => <MfaCell user={row} />,
      },
      {
        key: "lastLoginAt",
        header: t("usr.lastLogin"),
        sortable: true,
        secondary: true,
        render: (row) =>
          row.lastLoginAt ? (
            formatRelative(row.lastLoginAt, fmt)
          ) : (
            <span className="text-fg-subtle">{t("common.never")}</span>
          ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("usr.title")}
        subtitle={t("usr.subtitle")}
        spec="§15.5"
        actions={
          <Button
            variant="primary"
            icon={<UserCog size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.invite")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("usr.employeeNote")}</Callout>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("usr.searchPlaceholder")}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(USER_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "mfaEnrolled",
              label: t("usr.mfa"),
              options: [
                { value: "true", label: t("usr.mfaEnrolled") },
                { value: "false", label: t("usr.mfaMissing") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("usr.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
        />
      </PageBody>

      <UserDrawer user={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** A user may hold several assignments — Branch Manager here, Cashier there. */
function RoleCell({ assignments }: { assignments: RoleAssignment[] }) {
  const { tx } = useI18n();
  if (assignments.length === 0) return <span className="text-fg-subtle">—</span>;

  return (
    <span className="flex flex-wrap gap-1">
      {assignments.map((assignment) => {
        const role = roleById.get(assignment.roleId);
        return (
          <Badge key={assignment.roleId} tone="accent">
            {role ? tx(role.name) : assignment.roleId}
          </Badge>
        );
      })}
    </span>
  );
}

/**
 * MFA is mandatory for any role holding user management, tenant settings or
 * API key management (FR-SEC-024). A user on such a role without it enrolled
 * is a finding, not a preference, so it reads as one.
 */
function MfaCell({ user }: { user: User }) {
  const { t } = useI18n();
  const requires = user.assignments.some((assignment) => {
    const role = roleById.get(assignment.roleId);
    return role ? roleRequiresMfa(role.key) : false;
  });

  if (user.mfaEnrolled) {
    return (
      <Badge tone="good">
        <ShieldCheck size={11} aria-hidden />
        {t("usr.mfaEnrolled")}
      </Badge>
    );
  }

  return (
    <Badge tone={requires ? "bad" : "muted"}>
      {requires ? <ShieldAlert size={11} aria-hidden /> : null}
      {requires ? t("usr.mfaRequiredMissing") : t("usr.mfaMissing")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function UserDrawer({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();

  // Effective permissions are the union across assignments, and the
  // segregation-of-duties check runs against that union rather than against
  // any single role — FR-SEC-004 and FR-SEC-017.
  const { permissionCount, conflicts, roleKeys } = useMemo(() => {
    if (!user) return { permissionCount: 0, conflicts: [], roleKeys: [] as RoleKey[] };

    const keys = user.assignments
      .map((a) => roleById.get(a.roleId)?.key)
      .filter((k): k is RoleKey => Boolean(k));

    const union = new Set<string>();
    for (const key of keys) {
      for (const permission of permissionsForRole(key)) union.add(permission);
    }

    return {
      permissionCount: union.size,
      conflicts: findSodConflicts(union as Set<never>),
      roleKeys: keys,
    };
  }, [user]);

  if (!user) return null;

  const status = labelOf(USER_STATUS, user.status);

  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      title={tx(user.name)}
      subtitle={<span dir="ltr">{user.email}</span>}
      footer={
        <Button variant="danger" onClick={onClose}>
          {t("usr.forceLogout")}
        </Button>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("usr.phone")} mono>
            <span dir="ltr">{user.phone}</span>
          </DescRow>
          <DescRow label={t("usr.locale")}>
            {user.locale === "ar" ? "العربية" : "English"}
          </DescRow>
          <DescRow label={t("usr.mfa")}>
            <MfaCell user={user} />
          </DescRow>
          <DescRow label={t("usr.lastLogin")}>
            {user.lastLoginAt ? formatDateTime(user.lastLoginAt, fmt) : t("common.never")}
          </DescRow>
          <DescRow label={t("role.permissionCount")} mono>
            {permissionCount}
          </DescRow>
          <DescRow label={t("usr.linkedEmployee")}>
            {user.employeeId ? (
              <span className="font-mono text-xs" dir="ltr">
                {user.employeeId}
              </span>
            ) : (
              <span className="text-fg-subtle">{t("common.none")}</span>
            )}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("usr.assignments")}</h3>
          <ul className="divide-line divide-y">
            {user.assignments.map((assignment, index) => (
              <AssignmentRow key={`${assignment.roleId}-${index}`} assignment={assignment} />
            ))}
          </ul>
        </section>

        {conflicts.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("role.sodTitle")}</h3>
            <div className="space-y-2">
              {conflicts.map((pair) => (
                <Callout key={`${pair.a}-${pair.b}`} tone={pair.blocking ? "bad" : "warn"}>
                  <p className="font-medium">{tx(pair.risk)}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 font-mono text-[0.68rem]" dir="ltr">
                    <span>{pair.a}</span>
                    <span aria-hidden>+</span>
                    <span>{pair.b}</span>
                  </p>
                </Callout>
              ))}
            </div>
          </section>
        ) : (
          <Callout tone="good">{t("role.noConflicts")}</Callout>
        )}

        {roleKeys.length > 0 ? (
          <Callout tone="muted">
            {t("usr.scopeNote")}{" "}
            <span className="font-mono text-[0.68rem]" dir="ltr">
              {roleKeys.map((k) => ROLE_DEFINITIONS[k].key).join(" · ")}
            </span>
          </Callout>
        ) : null}
      </div>
    </Drawer>
  );
}

function AssignmentRow({ assignment }: { assignment: RoleAssignment }) {
  const { t, tx, fmt } = useI18n();
  const role = roleById.get(assignment.roleId);
  const level = labelOf(SCOPE_LEVEL, assignment.scopeLevel);

  // A validity window is what makes an elevation temporary rather than
  // permanent, and permanent elevation is how a permission model rots.
  const temporary = Boolean(assignment.validTo);

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg text-sm font-medium">
          {role ? tx(role.name) : assignment.roleId}
        </span>
        <Badge tone="muted">{tx(level.label)}</Badge>
        {temporary ? <Badge tone="warn">{t("usr.temporary")}</Badge> : null}
      </div>

      <p className="text-fg-subtle mt-1 text-xs">
        {assignment.scopeIds.length === 0 ? (
          t("usr.scopeAll")
        ) : (
          <span className="font-mono" dir="ltr">
            {assignment.scopeIds.join(" · ")}
          </span>
        )}
      </p>

      {assignment.validFrom || assignment.validTo ? (
        <p className="text-fg-subtle mt-0.5 text-xs">
          {t("usr.validity")}:{" "}
          {assignment.validFrom ? formatDate(assignment.validFrom, fmt) : "—"} →{" "}
          {assignment.validTo ? formatDate(assignment.validTo, fmt) : "—"}
        </p>
      ) : null}
    </li>
  );
}
