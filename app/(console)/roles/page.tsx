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
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { services } from "@/lib/console/services";
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
import { users } from "@/lib/console/mock/governance";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, Section } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
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
  const { scope } = useSession();
  const [selected, setSelected] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  /**
   * Roles come from `GET /auth/roles`, not from the fixtures.
   *
   * This screen used to render `mock/governance`'s role table verbatim, so
   * against a real backend it listed roles the tenant does not have and hid
   * the ones it does.
   */
  const collection = useCollection<Role>((query) => services.security.roles.list(query), {
    scope,
    initialSort: "name",
    pageSize: 50,
  });

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
          <Button icon={<Copy size={14} />} onClick={() => setCreating(true)}>
            {t("role.newRole")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("role.cloneNote")}</Callout>

        <CollectionToolbar collection={collection} />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("role.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
        />

        <MembershipRoles roles={collection.rows} onChanged={setMessage} />

        <SodMatrix />
      </PageBody>

      <RoleDrawer role={selected} onClose={() => setSelected(null)} />

      <NewRoleDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setMessage(t("role.created"));
          collection.reload();
        }}
      />

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

// ---------------------------------------------------------------------------

/**
 * FR-SEC-001 — assigning a role to a membership.
 *
 * A role only does anything once somebody holds it, and what holds a role is
 * a *membership* (a user's tie to one tenant), not a user. The API exposes
 * no tenant-wide membership index — `GET /auth/tenants` returns the caller's
 * own memberships and nothing else — so this section is scoped to the signed
 * -in account and says so, rather than implying it can administer everyone.
 */
function MembershipRoles({
  roles,
  onChanged,
}: {
  roles: Role[];
  onChanged: (message: string) => void;
}) {
  const { t } = useI18n();
  const canManage = usePermission("security.role.manage");
  const action = useAction();
  const [roleId, setRoleId] = useState("");

  const memberships = useAsync(() => services.security.memberships(), []);

  if (!canManage) return null;

  async function assign(membershipId: string) {
    if (!roleId) return;
    await action.run(() => services.security.assignRole(membershipId, roleId), {
      onSuccess: () => {
        setRoleId("");
        onChanged(t("role.assigned"));
      },
    });
  }

  async function remove(membershipId: string, id: string) {
    await action.run(() => services.security.removeRole(membershipId, id), {
      onSuccess: () => onChanged(t("role.removed")),
    });
  }

  return (
    <Section title={t("role.membershipsTitle")}>
      <Card>
        <CardHeader title={t("role.membershipsTitle")} hint={t("role.membershipsNote")} />

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <AsyncPanel state={memberships} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <ul className="border-line divide-line mt-3 divide-y rounded-lg border">
              {rows.map((membership) => (
                <li key={membership.membershipId} className="space-y-2 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={13} className="text-fg-subtle shrink-0" aria-hidden />
                    <span className="text-fg min-w-0 flex-1 truncate text-xs font-medium">
                      {membership.tenantName}
                    </span>
                    <Badge tone={membership.status === "active" ? "good" : "muted"}>
                      {membership.status}
                    </Badge>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={t("role.assignRole")}>
                        <Select
                          value={roleId}
                          onChange={(event) => setRoleId(event.target.value)}
                          disabled={action.pending}
                        >
                          <option value="">—</option>
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name.en}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!roleId || action.pending}
                      onClick={() => assign(membership.membershipId)}
                    >
                      {t("common.add")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!roleId || action.pending}
                      onClick={() => remove(membership.membershipId, roleId)}
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AsyncPanel>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------

/** `POST /auth/roles` — a tenant-owned role, then its permission grants. */
function NewRoleDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      () =>
        services.security.roles.create({
          name: { en: name.trim(), ar: name.trim() },
          description: description.trim()
            ? { en: description.trim(), ar: description.trim() }
            : undefined,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("role.newRole")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!name.trim()}
            onClick={create}
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted">{t("role.newRoleNote")}</Callout>

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("common.description")}>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
          />
        </Field>
      </div>
    </Drawer>
  );
}
