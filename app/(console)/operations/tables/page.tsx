"use client";

/**
 * Table Management — FR-BRN-020.
 *
 * The branch's real, backend-configured tables: label, section, seat
 * capacity. Nothing about a table's live occupancy (seated, bill
 * requested, needs cleaning) lives here — that is order-driven, high-churn
 * state ADR 0008 D-05 deliberately keeps out of Organisation's table
 * configuration aggregate, and the backend has no endpoint for it at all.
 *
 * TABLE-MANAGEMENT-REAL-UI-CORRECTION-P0 — this page used to lead with a
 * "Table status" grid of `T01`..`T16`-labelled cards, sourced entirely from
 * `lib/console/mock/org.ts`'s seeded fixture via `lib/console/live/*`
 * (device-only, behind an explicit "This device only" warning banner), with
 * this real, backend-wired Create/Edit section buried underneath it. That
 * made production look like a device-status screen with no obvious way to
 * add, edit, or manage a table. The fixture grid is removed from this page
 * entirely, not hidden behind a toggle — it has no real backend counterpart
 * to stand in for, and this page's whole purpose is to be the source of
 * truth for a branch's tables, not a demo of what one might look like.
 *
 * No delete/deactivate/archive action exists here: the canonical backend
 * (`TablesService`, `organisation.controller.ts`) exposes exactly three
 * operations on a table — create, list, update — and no DB column, service
 * method or route for removing or deactivating one. Faking that locally
 * would silently diverge from the real record; it is not implemented.
 */

import { useState } from "react";
import type { RestaurantTable } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Plus } from "lucide-react";
import { Button, Callout, Card, CardHeader, Field, Select, Toast } from "@/components/console/ui";
import { DataTable } from "@/components/console/data-table";
import { RecordDrawer } from "@/components/console/record-drawer";

export default function TablesPage() {
  return (
    <Gate permissions={["settings.branch.read", "settings.branch.manage"]}>
      <TablesScreen />
    </Gate>
  );
}

function TablesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, branch, availableBranches } = useSession();
  const canManage = usePermission("settings.branch.manage");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [message, setMessage] = useTransientMessage();

  /**
   * Table definitions are branch-scoped — never fetched or managed against
   * "All branches" (`scope.branchId === null` fans `services.operations
   * .tables()` out across every accessible branch and merges the result,
   * exactly the "manage tables against All branches" this page must not
   * do). A branch is only ever considered selected when:
   *  - the Console's own top-bar scope already names one (an explicit
   *    choice the user already made elsewhere), or
   *  - exactly one branch is authorised at all, so there is no real choice
   *    to make, or
   *  - the user actively picks one from the selector below.
   * Never a silent default to "the first branch in the list."
   */
  const singleAuthorizedBranch = availableBranches.length === 1 ? availableBranches[0]! : null;
  const contextBranchId = scope.branchId ?? singleAuthorizedBranch?.id ?? null;
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = contextBranchId ?? (pickedBranchId || null);

  const selectedBranch =
    branch ??
    singleAuthorizedBranch ??
    availableBranches.find((b) => b.id === branchId) ??
    null;

  const tables = useAsync(
    () =>
      branchId
        ? services.operations.tables({ scope: { ...scope, branchId }, limit: 500 })
        : Promise.resolve({ rows: [] as RestaurantTable[], total: 0, cursor: null }),
    [branchId, scope.tenantId],
  );

  return (
    <>
      <PageHeader
        title={t("nav.tables")}
        subtitle={t("ops.tableManagementSubtitle")}
        spec="FR-BRN-020"
        meta={
          selectedBranch ? (
            <span>
              {t("common.branch")}: {tx(selectedBranch.name)}
            </span>
          ) : null
        }
      />

      <PageBody>
        {!contextBranchId && availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={pickedBranchId} onChange={(event) => setPickedBranchId(event.target.value)}>
              <option value="">—</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!branchId ? (
          <Callout tone="muted">{t("ops.selectBranchToManageTables")}</Callout>
        ) : (
          <Section title={t("ops.tableDefinitions")}>
            <Card>
              <CardHeader
                title={t("ops.tableDefinitions")}
                hint={t("ops.tableDefinitionsNote")}
                spec="FR-BRN-020"
                action={
                  canManage ? (
                    <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
                      {t("common.new")}
                    </Button>
                  ) : null
                }
              />

              <AsyncPanel
                state={tables}
                isEmpty={(page) => page.rows.length === 0}
                empty={<Callout tone="muted">{t("ops.noTables")}</Callout>}
              >
                {(page) => (
                  <DataTable
                    columns={[
                      {
                        key: "label",
                        header: t("ops.tableLabel"),
                        render: (row) => <span className="text-fg text-sm">{row.label}</span>,
                      },
                      {
                        key: "area",
                        header: t("ops.section"),
                        secondary: true,
                        render: (row) => tx(row.area),
                      },
                      {
                        key: "capacity",
                        header: t("pos.seats"),
                        numeric: true,
                        render: (row) => formatNumber(row.capacity, fmt),
                      },
                    ]}
                    rows={page.rows}
                    rowKey={(row) => row.id}
                    caption={t("ops.tableDefinitions")}
                    onRowClick={canManage ? setEditing : undefined}
                    dense
                  />
                )}
              </AsyncPanel>
            </Card>

            <RecordDrawer
              open={creating}
              title={t("ops.newTable")}
              fields={[
                { name: "label", label: t("ops.tableLabel"), required: true, maxLength: 24 },
                { name: "section", label: t("ops.section"), maxLength: 48 },
                { name: "capacity", label: t("pos.seats"), kind: "number", initial: "4" },
              ]}
              onClose={() => setCreating(false)}
              onSubmit={(values) =>
                services.operations.createTable(branchId, {
                  label: values.label.trim(),
                  area: { en: values.section.trim(), ar: values.section.trim() },
                  capacity: Number(values.capacity) || 0,
                })
              }
              onDone={() => {
                setCreating(false);
                setMessage(t("ops.tableCreated"));
                tables.reload();
              }}
            />

            <RecordDrawer
              open={editing !== null}
              title={editing?.label ?? ""}
              submitLabel={t("common.save")}
              fields={[
                {
                  name: "label",
                  label: t("ops.tableLabel"),
                  required: true,
                  maxLength: 24,
                  initial: editing?.label ?? "",
                },
                {
                  name: "section",
                  label: t("ops.section"),
                  maxLength: 48,
                  initial: editing ? tx(editing.area) : "",
                },
                {
                  name: "capacity",
                  label: t("pos.seats"),
                  kind: "number",
                  initial: String(editing?.capacity ?? 0),
                },
              ]}
              onClose={() => setEditing(null)}
              onSubmit={(values) =>
                services.operations.updateTable(editing?.id ?? "", {
                  label: values.label.trim(),
                  area: { en: values.section.trim(), ar: values.section.trim() },
                  capacity: Number(values.capacity) || 0,
                })
              }
              onDone={() => {
                setEditing(null);
                setMessage(t("ops.tableUpdated"));
                tables.reload();
              }}
            />
          </Section>
        )}
      </PageBody>

      <Toast message={message} />
    </>
  );
}
