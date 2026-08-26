"use client";

/**
 * Menus — FR-MNU-001/002/003.
 *
 * A menu is the layer above categories that the console never had a screen
 * for, though the backend has carried seven endpoints for it throughout.
 * Without it there was no way to see — let alone change — which menu a
 * branch actually serves.
 *
 * Priority is the column that matters. A branch can have several menus
 * assigned at once (all-day, breakfast, delivery) and the highest priority
 * in force wins. Two menus sharing a priority make that resolution
 * non-deterministic, so the resolver panel says so out loud rather than
 * showing whichever one the database happened to return first.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Store, TriangleAlert } from "lucide-react";
import type { Menu } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
  Toggle,
} from "@/components/console/ui";

export default function MenusPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <MenusScreen />
    </Gate>
  );
}

function MenusScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const canManage = usePermission("menu.manage");

  const [selected, setSelected] = useState<Menu | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Menu>((query) => services.catalogue.menus.list(query), {
    scope,
    initialSort: "-priority",
    pageSize: 25,
  });

  const branchName = useMemo(() => {
    const index = new Map(availableBranches.map((branch) => [branch.id, branch]));
    return (branchId: string) => {
      const branch = index.get(branchId);
      return branch ? tx(branch.name) : branchId;
    };
  }, [availableBranches, tx]);

  /**
   * FR-MNU-003 — two active menus on one branch at the same priority have no
   * deterministic winner. Surfacing the count here is what makes it a thing
   * somebody notices before a cashier rings up the wrong price.
   */
  const ambiguities = useMemo(() => {
    const perBranch = new Map<string, number[]>();
    for (const menu of collection.rows) {
      if (!menu.active) continue;
      for (const branchId of menu.branchIds) {
        perBranch.set(branchId, [...(perBranch.get(branchId) ?? []), menu.priority]);
      }
    }
    let clashes = 0;
    for (const priorities of perBranch.values()) {
      if (new Set(priorities).size !== priorities.length) clashes += 1;
    }
    return clashes;
  }, [collection.rows]);

  const columns = useMemo<Column<Menu>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.orderTypes.join(" · ") || t("common.none")}
          />
        ),
      },
      {
        key: "priority",
        header: t("menu.priority"),
        sortable: true,
        numeric: true,
        hint: t("menu.menuPriorityHint"),
        render: (row) => formatNumber(row.priority, fmt),
      },
      {
        key: "branches",
        header: t("menu.assignedBranches"),
        render: (row) =>
          row.branchIds.length === 0 ? (
            <span className="text-fg-subtle">{t("menu.noBranches")}</span>
          ) : (
            <span className="text-fg-muted text-xs">
              {row.branchIds.length === 1
                ? branchName(row.branchIds[0]!)
                : `${formatNumber(row.branchIds.length, fmt)} ${t("common.branches")}`}
            </span>
          ),
      },
      {
        key: "active",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={row.active ? "good" : "muted"} dot>
            {row.active ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt, branchName],
  );

  return (
    <>
      <PageHeader
        title={t("menu.menusTitle")}
        subtitle={t("menu.menusSubtitle")}
        spec="FR-MNU-001"
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        {ambiguities > 0 ? (
          <Callout tone="warn" icon={<TriangleAlert size={14} />} title={t("menu.ambiguousTitle")}>
            {t("menu.ambiguousNote")}
          </Callout>
        ) : (
          <Callout tone="muted">{t("menu.menuPriorityHint")}</Callout>
        )}

        <TileGrid columns={3}>
          <MetricTile label={t("menu.menusTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("common.active")}
            value={formatNumber(collection.rows.filter((row) => row.active).length, fmt)}
          />
          <MetricTile
            label={t("menu.ambiguousTitle")}
            value={formatNumber(ambiguities, fmt)}
            spec="FR-MNU-003"
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("menu.menusTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <MenuDrawer
        menu={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <NewMenuDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setMessage(t("menu.menuCreated"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function MenuDrawer({
  menu,
  canManage,
  onClose,
  onChanged,
}: {
  menu: Menu | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const action = useAction();
  const [assigning, setAssigning] = useState("");

  // Re-read after each assignment so the drawer reflects the server, not a
  // guess about what the server did.
  const detail = useAsync(
    async () => (menu ? services.catalogue.menus.get(menu.id) : null),
    [menu?.id],
  );

  if (!menu) return null;

  const current = detail.data ?? menu;
  const unassigned = availableBranches.filter(
    (branch) => !current.branchIds.includes(branch.id),
  );

  async function assign(branchId: string) {
    if (!menu) return;
    await action.run(() => services.catalogue.assignMenuToBranch(menu.id, branchId), {
      onSuccess: () => {
        setAssigning("");
        detail.reload();
        onChanged(t("menu.branchAssigned"));
      },
    });
  }

  async function unassign(branchId: string) {
    if (!menu) return;
    await action.run(() => services.catalogue.unassignMenuFromBranch(menu.id, branchId), {
      onSuccess: () => {
        detail.reload();
        onChanged(t("menu.branchUnassigned"));
      },
    });
  }

  async function toggleActive() {
    if (!menu) return;
    await action.run(() => services.catalogue.setMenuActive(menu.id, !current.active), {
      onSuccess: () => {
        detail.reload();
        onChanged(current.active ? t("menu.menuDeactivated") : t("menu.menuActivated"));
      },
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(current.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {t("menu.priority")} {current.priority}
        </span>
      }
      footer={
        canManage ? (
          <Button
            variant={current.active ? "danger" : "primary"}
            loading={action.pending}
            onClick={toggleActive}
          >
            {current.active ? t("common.deactivate") : t("common.activate")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={current.active ? "good" : "muted"} dot>
              {current.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
          <DescRow label={t("menu.priority")} mono>
            {formatNumber(current.priority, fmt)}
          </DescRow>
          <DescRow label={t("menu.orderTypes")}>
            {current.orderTypes.length === 0 ? (
              t("common.none")
            ) : (
              <span className="flex flex-wrap justify-end gap-1">
                {current.orderTypes.map((type) => (
                  <Badge key={type} tone="neutral">
                    {type}
                  </Badge>
                ))}
              </span>
            )}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.assignedBranches")}</h3>

          {current.branchIds.length === 0 ? (
            <Callout tone="muted">{t("menu.noBranches")}</Callout>
          ) : (
            <ul className="border-line divide-line divide-y rounded-lg border">
              {current.branchIds.map((branchId) => {
                const branch = availableBranches.find((row) => row.id === branchId);
                return (
                  <li key={branchId} className="flex items-center gap-2 px-3 py-2">
                    <Store size={13} className="text-fg-subtle shrink-0" aria-hidden />
                    <span className="text-fg min-w-0 flex-1 truncate text-xs">
                      {branch ? tx(branch.name) : branchId}
                    </span>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        disabled={action.pending}
                        onClick={() => unassign(branchId)}
                      >
                        {t("common.remove")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && unassigned.length > 0 ? (
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Field label={t("menu.assignBranch")}>
                  <Select
                    value={assigning}
                    onChange={(event) => setAssigning(event.target.value)}
                    disabled={action.pending}
                  >
                    <option value="">—</option>
                    {unassigned.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {tx(branch.name)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={!assigning || action.pending}
                onClick={() => assign(assigning)}
              >
                {t("common.add")}
              </Button>
            </div>
          ) : null}
        </section>

        <BranchResolution branchIds={current.branchIds} />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-MNU-003 — what a branch would actually resolve to right now.
 *
 * This is the check that catches an assignment mistake: it asks the server
 * the same question the POS asks, rather than re-deriving the answer here
 * from the rows already on screen.
 */
function BranchResolution({ branchIds }: { branchIds: string[] }) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const [branchId, setBranchId] = useState(branchIds[0] ?? "");

  const effective = branchIds.includes(branchId) ? branchId : (branchIds[0] ?? "");

  const resolution = useAsync(
    async () => (effective ? services.catalogue.resolveBranchMenus(effective) : null),
    [effective],
  );

  if (branchIds.length === 0) return null;

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.resolutionTitle")}</h3>

      {branchIds.length > 1 ? (
        <Field label={t("common.branch")}>
          <Select value={effective} onChange={(event) => setBranchId(event.target.value)}>
            {branchIds.map((id) => {
              const branch = availableBranches.find((row) => row.id === id);
              return (
                <option key={id} value={id}>
                  {branch ? tx(branch.name) : id}
                </option>
              );
            })}
          </Select>
        </Field>
      ) : null}

      <div className="mt-2">
        <AsyncPanel state={resolution}>
          {(data) =>
            data === null ? null : (
              <div className="space-y-2">
                {data.ambiguous ? (
                  <Callout tone="warn" icon={<TriangleAlert size={14} />}>
                    {data.warning ?? t("menu.ambiguousNote")}
                  </Callout>
                ) : (
                  <Callout tone="good" icon={<CheckCircle2 size={14} />}>
                    {t("menu.resolutionClear")}
                  </Callout>
                )}

                <ol className="border-line divide-line divide-y rounded-lg border">
                  {data.menus.map((row, index) => (
                    <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-fg-subtle w-4 shrink-0 text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <span className="text-fg min-w-0 flex-1 truncate text-xs">
                        {tx(row.name)}
                      </span>
                      <Badge tone={index === 0 ? "good" : "muted"}>
                        {t("menu.priority")} {row.priority}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </div>
            )
          }
        </AsyncPanel>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const ORDER_TYPE_CHOICES = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup"] as const;

function NewMenuDrawer({
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
  const [priority, setPriority] = useState("10");
  const [orderTypes, setOrderTypes] = useState<string[]>(["dine_in"]);

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      () =>
        services.catalogue.menus.create({
          name: { en: name.trim(), ar: name.trim() },
          priority: Number(priority) || 0,
          orderTypes,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newMenu")}
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

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("menu.priority")} hint={t("menu.menuPriorityHint")}>
          <Input
            inputMode="numeric"
            dir="ltr"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-fg-subtle mb-1 text-xs font-medium">
            {t("menu.orderTypes")}
          </legend>
          {ORDER_TYPE_CHOICES.map((type) => (
            <Toggle
              key={type}
              checked={orderTypes.includes(type)}
              onChange={(next) =>
                setOrderTypes((current) =>
                  next ? [...current, type] : current.filter((row) => row !== type),
                )
              }
              label={type}
            />
          ))}
        </fieldset>
      </div>
    </Drawer>
  );
}
