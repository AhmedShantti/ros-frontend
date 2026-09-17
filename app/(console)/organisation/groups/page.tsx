"use client";

/**
 * Branch groups — FR-BRN-005.
 *
 * A region, a cluster or a franchise territory is a named set of branches.
 * The same set is what the scorecard and the consolidated view filter by, so
 * "how is the Delta region doing?" is one selection rather than a hand-kept
 * list of branch names. Groups may nest (a cluster inside a region), and a
 * branch may sit in several regions or clusters but in at most one franchise
 * territory, because royalties are computed per territory and a branch in
 * two would be billed twice.
 */

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { Id, Localised } from "@/lib/console/types";
import {
  BRANCH_GROUP_KINDS,
  branchesInGroup,
  groupProblem,
  type BranchGroup,
  type BranchGroupKind,
} from "@/lib/console/branch-network";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { useConfirmDelete } from "@/components/console/confirm";
import { EmptyState, LocalisedField, trimLocalised } from "@/components/console/fields";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, Drawer, Field, IconButton, Input, Select, Textarea, Toast } from "@/components/console/ui";

export default function BranchGroupsPage() {
  return (
    <Gate permissions={["org.manage", "settings.tenant.manage", "report.view.sales"]}>
      <GroupsScreen />
    </Gate>
  );
}

const KIND_TONE: Record<BranchGroupKind, "accent" | "neutral" | "warn"> = {
  region: "accent",
  cluster: "neutral",
  franchise_territory: "warn",
};

function GroupsScreen() {
  const { t, tx, fmt } = useI18n();
  const { availableBranches, canAny } = useSession();
  const canManage = canAny(["org.manage", "settings.tenant.manage"]);
  const confirmDelete = useConfirmDelete();
  const action = useAction();
  const [message, setMessage] = useTransientMessage();
  const [editing, setEditing] = useState<BranchGroup | "new" | null>(null);
  const [kindFilter, setKindFilter] = useState<"" | BranchGroupKind>("");

  const groups = useAsync(() => services.branchNetwork.groups.all(), []);
  const branchName = useMemo(() => new Map(availableBranches.map((row) => [row.id, row])), [availableBranches]);

  const rows = useMemo(
    () => (groups.data ?? []).filter((row) => !kindFilter || row.kind === kindFilter).sort((a, b) => a.code.localeCompare(b.code)),
    [groups.data, kindFilter],
  );

  const assigned = useMemo(() => new Set((groups.data ?? []).flatMap((row) => row.branchIds)), [groups.data]);

  async function remove(group: BranchGroup) {
    if (!(await confirmDelete(tx(group.name) || group.code))) return;
    await action.run(() => services.branchNetwork.groups.remove(group.id), {
      onSuccess: () => {
        setMessage(t("brn.groups.deleted"));
        groups.reload();
      },
    });
  }

  const columns: Column<BranchGroup>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{tx(row.name)}</span>
          <span className="text-fg-subtle font-mono text-xs" dir="ltr">
            {row.code}
          </span>
        </span>
      ),
    },
    {
      key: "kind",
      header: t("common.type"),
      render: (row) => <Badge tone={KIND_TONE[row.kind]}>{t(`brn.group.kind.${row.kind}` as ConsoleKey)}</Badge>,
    },
    {
      key: "parent",
      header: t("brn.groups.parent"),
      secondary: true,
      render: (row) => {
        const parent = groups.data?.find((other) => other.id === row.parentId);
        return parent ? tx(parent.name) : <span className="text-fg-subtle">—</span>;
      },
    },
    {
      key: "branches",
      header: t("brn.groups.members"),
      render: (row) => {
        const all = branchesInGroup(groups.data ?? [], row.id);
        return (
          <span className="flex flex-wrap gap-1">
            {all.slice(0, 6).map((id) => (
              <Badge key={id} tone="muted">
                {branchName.get(id) ? tx(branchName.get(id)!.name) : id}
              </Badge>
            ))}
            {all.length > 6 ? <Badge tone="muted">+{all.length - 6}</Badge> : null}
            {all.length > row.branchIds.length ? (
              <span className="text-fg-subtle text-xs">{t("brn.groups.includesChildren")}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "updatedAt",
      header: t("brn.groups.updated"),
      secondary: true,
      render: (row) => formatDateTime(row.updatedAt, fmt),
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canManage ? (
          <span className="flex justify-end gap-1">
            <IconButton label={t("common.edit")} icon={<Pencil size={14} />} onClick={() => setEditing(row)} />
            <IconButton label={t("common.delete")} icon={<Trash2 size={14} />} onClick={() => remove(row)} />
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("nav.branchGroups")}
        subtitle={t("brn.groups.lede")}
        spec="FR-BRN-005"
        actions={
          <div className="flex gap-2">
            <ExportButton
              filename="branch-groups"
              title={t("nav.branchGroups")}
              rows={rows}
              onExported={setMessage}
              columns={[
                { key: "code", header: t("common.code"), value: (row) => row.code },
                { key: "name", header: t("common.name"), value: (row) => tx(row.name) },
                { key: "kind", header: t("common.type"), value: (row) => t(`brn.group.kind.${row.kind}` as ConsoleKey) },
                {
                  key: "branches",
                  header: t("brn.groups.members"),
                  value: (row) =>
                    branchesInGroup(groups.data ?? [], row.id)
                      .map((id) => branchName.get(id)?.code ?? id)
                      .join(" "),
                },
              ]}
            />
            {canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
                {t("common.new")}
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <TileGrid columns={4}>
          {BRANCH_GROUP_KINDS.map((kind) => (
            <MetricTile
              key={kind}
              label={t(`brn.group.kind.${kind}` as ConsoleKey)}
              value={formatNumber((groups.data ?? []).filter((row) => row.kind === kind).length, fmt)}
            />
          ))}
          <MetricTile
            label={t("brn.groups.ungrouped")}
            value={formatNumber(availableBranches.filter((row) => !assigned.has(row.id)).length, fmt)}
            hint={t("brn.groups.ungroupedHint")}
          />
        </TileGrid>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label={t("common.type")}>
              <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "" | BranchGroupKind)}>
                <option value="">{t("common.all")}</option>
                {BRANCH_GROUP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`brn.group.kind.${kind}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-fg-subtle max-w-xl pb-2 text-xs">{t("brn.groups.usedBy")}</p>
        </div>

        <AsyncPanel
          state={groups}
          isEmpty={(ready) => ready.length === 0}
          empty={
            <EmptyState
              title={t("brn.groups.empty")}
              body={t("brn.groups.emptyBody")}
              action={
                canManage ? (
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
                    {t("common.new")}
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {() => <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={t("nav.branchGroups")} dense />}
        </AsyncPanel>
      </PageBody>

      {editing ? (
        <GroupDrawer
          group={editing === "new" ? null : editing}
          all={groups.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage(t("brn.groups.saved"));
            groups.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

function GroupDrawer({
  group,
  all,
  onClose,
  onSaved,
}: {
  group: BranchGroup | null;
  all: BranchGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const action = useAction();
  const [name, setName] = useState<Localised>(group?.name ?? { en: "", ar: "" });
  const [code, setCode] = useState(group?.code ?? "");
  const [kind, setKind] = useState<BranchGroupKind>(group?.kind ?? "region");
  const [parentId, setParentId] = useState<Id | "">(group?.parentId ?? "");
  const [branchIds, setBranchIds] = useState<Id[]>(group?.branchIds ?? []);
  const [notes, setNotes] = useState(group?.notes ?? "");

  // FR-BRN-005 — the same rule the service enforces, shown before saving.
  const problem = groupProblem({ id: group?.id ?? "", code, kind, branchIds, parentId: parentId || null }, all);
  const nameMissing = !name.en.trim() && !name.ar.trim();

  function toggle(id: Id) {
    setBranchIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  async function save() {
    const input = { name: trimLocalised(name), code: code.trim(), kind, parentId: parentId || null, branchIds, notes: notes.trim() };
    await action.run(
      () => (group ? services.branchNetwork.groups.update(group.id, input) : services.branchNetwork.groups.create(input)),
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={group ? t("brn.groups.edit") : t("brn.groups.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={Boolean(problem) || nameMissing} loading={action.pending} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={120} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.code")} required>
            <Input dir="ltr" value={code} maxLength={16} onChange={(event) => setCode(event.target.value)} className="font-mono" />
          </Field>
          <Field label={t("common.type")}>
            <Select value={kind} onChange={(event) => setKind(event.target.value as BranchGroupKind)}>
              {BRANCH_GROUP_KINDS.map((option) => (
                <option key={option} value={option}>
                  {t(`brn.group.kind.${option}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("brn.groups.parent")} hint={t("brn.groups.parentHint")}>
          <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">{t("common.none")}</option>
            {all
              .filter((row) => row.id !== group?.id)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)} ({row.code})
                </option>
              ))}
          </Select>
        </Field>
        <fieldset>
          <legend className="text-fg mb-1.5 text-xs font-medium">
            {t("brn.groups.members")} · {branchIds.length}
          </legend>
          <ul className="border-line divide-line max-h-72 divide-y overflow-y-auto rounded-lg border">
            {availableBranches.map((branch) => (
              <li key={branch.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggle(branch.id)} />
                  <span className="text-fg flex-1">{tx(branch.name)}</span>
                  <span className="text-fg-subtle font-mono text-xs" dir="ltr">
                    {branch.code} · {branch.countryCode}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field label={t("common.notes")}>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        {problem ? <Callout tone="warn">{problem}</Callout> : null}
      </div>
    </Drawer>
  );
}
