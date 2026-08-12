"use client";

/**
 * Roles and permissions — SRS §15.
 *
 * RBAC for what, ABAC for where: a permission answers "may this action be
 * performed?", a scope answers "on which data?", and both must be satisfied
 * (FR-SEC-001..004).
 *
 * The permission editor shows a plain-language description for every entry
 * and marks the sensitive ones, because FR-SEC-012 treats "the administrator
 * understood what they were granting" as a requirement rather than a hope.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Copy, ShieldCheck } from "lucide-react";
import type { Role } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { SCOPE_LEVEL, labelOf } from "@/lib/console/labels";
import {
  PERMISSION_GROUPS,
  ROLE_DEFINITIONS,
  SOD_PAIRS,
  permissionsForRole,
  permissionsInGroup,
  roleRequiresMfa,
  surfacesForRole,
  type PermissionGroup,
  type RoleKey,
} from "@/lib/console/permissions";
import { roles, users } from "@/lib/console/mock/governance";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section } from "@/components/console/page";
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

export default function RolesPage() {
  return (
    <Gate permissions={["security.role.manage"]}>
      <RolesScreen />
    </Gate>
  );
}

// ---------------------------------------------------------------------------

function RolesScreen() {
  const { t, tx } = useI18n();
  const [selected, setSelected] = useState<Role | null>(null);
  const [message, setMessage] = useTransientMessage();

  /** How many users hold each role — the number that makes a role real. */
  const holders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of users) {
      for (const assignment of user.assignments) {
        counts.set(assignment.roleId, (counts.get(assignment.roleId) ?? 0) + 1);
      }
    }
    return counts;
  }, []);

  const columns = useMemo<Column<Role>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.name)} secondary={tx(row.description)} />,
      },
      {
        key: "system",
        header: t("common.type"),
        render: (row) =>
          row.system ? (
            <Badge tone="muted">{t("role.system")}</Badge>
          ) : (
            <Badge tone="accent">{t("role.custom")}</Badge>
          ),
      },
      {
        key: "scope",
        header: t("role.defaultScope"),
        render: (row) => {
          const definition = ROLE_DEFINITIONS[row.key as RoleKey];
          if (!definition) return <span className="text-fg-subtle">—</span>;
          return <Badge tone="muted">{tx(labelOf(SCOPE_LEVEL, definition.defaultScope).label)}</Badge>;
        },
      },
      {
        key: "permissions",
        header: t("role.permissionCount"),
        numeric: true,
        render: (row) => {
          const definition = ROLE_DEFINITIONS[row.key as RoleKey];
          return definition ? permissionsForRole(row.key as RoleKey).size : 0;
        },
      },
      {
        key: "mfa",
        header: t("role.mfaRequired"),
        render: (row) =>
          roleRequiresMfa(row.key as RoleKey) ? (
            <Badge tone="warn">
              <ShieldCheck size={11} aria-hidden />
              {t("common.yes")}
            </Badge>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "surfaces",
        header: t("role.surfaces"),
        secondary: true,
        render: (row) => (
          <span className="flex flex-wrap gap-1">
            {surfacesForRole(row.key as RoleKey).map((surface) => (
              <Badge key={surface} tone="muted">
                {surface.toUpperCase()}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        key: "users",
        header: t("role.users"),
        numeric: true,
        secondary: true,
        render: (row) => holders.get(row.id) ?? 0,
      },
    ],
    [t, tx, holders],
  );

  return (
    <>
      <PageHeader
        title={t("role.title")}
        subtitle={t("role.subtitle")}
        spec="§15.1"
        actions={
          <Button icon={<Copy size={14} />} onClick={() => setMessage(t("common.notInBuild"))}>
            {t("role.clone")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("role.cloneNote")}</Callout>

        <DataTable
          columns={columns}
          rows={roles}
          rowKey={(row) => row.id}
          caption={t("role.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
        />

        <SodMatrix />
      </PageBody>

      <RoleDrawer role={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Segregation of duties
// ---------------------------------------------------------------------------

/**
 * The incompatible pairs themselves, not the users holding them. Four of these
 * are blocked outright rather than warned about (FR-SEC-016) — approving your
 * own requisition, discount, cash variance or count.
 */
function SodMatrix() {
  const { t, tx } = useI18n();

  return (
    <Section title={t("role.sodTitle")} hint={t("role.sodSubtitle")} spec="FR-SEC-015" padded={false}>
      <ul className="divide-line divide-y">
        {SOD_PAIRS.map((pair) => (
          <li key={`${pair.a}-${pair.b}`} className="flex flex-wrap items-start gap-3 px-5 py-3">
            <AlertTriangle
              size={14}
              aria-hidden
              className={pair.blocking ? "text-bad mt-0.5 shrink-0" : "text-warn mt-0.5 shrink-0"}
            />
            <div className="min-w-0 flex-1">
              <p className="text-fg text-sm">{tx(pair.risk)}</p>
              <p className="text-fg-subtle mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[0.68rem]" dir="ltr">
                <span className="border-line rounded border px-1.5 py-0.5">{pair.a}</span>
                <span aria-hidden>+</span>
                <span className="border-line rounded border px-1.5 py-0.5">{pair.b}</span>
              </p>
            </div>
            <Badge tone={pair.blocking ? "bad" : "warn"}>
              {pair.blocking ? t("role.sodBlocking") : t("role.sodWarning")}
            </Badge>
          </li>
        ))}
      </ul>

      <div className="px-5 pb-5">
        <Callout tone="muted">{t("role.blockedNote")}</Callout>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Permission editor
// ---------------------------------------------------------------------------

function RoleDrawer({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { t, tx } = useI18n();

  const granted = useMemo(
    () => (role ? permissionsForRole(role.key as RoleKey) : new Set<string>()),
    [role],
  );

  if (!role) return null;

  const definition = ROLE_DEFINITIONS[role.key as RoleKey];

  return (
    <Drawer
      open={Boolean(role)}
      onClose={onClose}
      title={tx(role.name)}
      subtitle={tx(role.description)}
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.type")}>
            {role.system ? t("role.system") : t("role.custom")}
          </DescRow>
          {definition ? (
            <DescRow label={t("role.defaultScope")}>
              {tx(labelOf(SCOPE_LEVEL, definition.defaultScope).label)}
            </DescRow>
          ) : null}
          <DescRow label={t("role.permissionCount")} mono>
            {granted.size}
          </DescRow>
          <DescRow label={t("role.mfaRequired")}>
            {roleRequiresMfa(role.key as RoleKey) ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("role.surfaces")}>
            <span className="flex flex-wrap gap-1">
              {surfacesForRole(role.key as RoleKey).map((surface) => (
                <Badge key={surface} tone="muted">
                  {surface.toUpperCase()}
                </Badge>
              ))}
            </span>
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-3 text-sm font-semibold">{t("role.editor")}</h3>
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => (
              <PermissionGroupBlock key={group} group={group} granted={granted} />
            ))}
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function PermissionGroupBlock({
  group,
  granted,
}: {
  group: PermissionGroup;
  granted: Set<string>;
}) {
  const { t, tx } = useI18n();
  const permissions = permissionsInGroup(group);
  const held = permissions.filter((p) => granted.has(p.key));

  if (held.length === 0) return null;

  return (
    <div className="border-line rounded-lg border">
      <div className="border-line bg-sunken flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-fg text-xs font-semibold capitalize">{group}</p>
        <p className="text-fg-subtle font-mono text-[0.68rem] tabular-nums">
          {held.length} / {permissions.length} {t("role.permissionsIn")}
        </p>
      </div>

      <ul className="divide-line divide-y">
        {held.map((permission) => (
          <li key={permission.key} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-fg font-mono text-[0.7rem]" dir="ltr">
                {permission.key}
              </code>
              {permission.sensitive ? (
                <Badge tone="warn">{t("role.sensitive")}</Badge>
              ) : null}
            </div>
            <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">
              {tx(permission.description)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
