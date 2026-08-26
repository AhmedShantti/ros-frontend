"use client";

/**
 * Branches — SRS ch.17.
 *
 * The branch is the operational unit and the isolation boundary that matters
 * most: its own stock, drawers, roster, trading hours, currency and tax setup.
 * Almost every permission in the system is ultimately scoped to a set of these.
 *
 * The business-day boundary is the field that surprises people. A branch that
 * closes at 02:00 needs its trading day to end at 04:00, not at midnight, or
 * every late Friday splits across two reports and neither one describes a
 * shift anybody worked (FR-FIN-024).
 *
 * Franchises are flagged because the data-sharing rules differ: a franchisee
 * sees its own branch and nothing else, whatever the org chart says.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Branch } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber } from "@/lib/console/format";
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
  Select,
  Toast,
} from "@/components/console/ui";
import { RecordDrawer } from "@/components/console/record-drawer";

export default function BranchesPage() {
  return (
    <Gate permissions={["org.manage", "settings.branch.manage", "report.view.sales"]}>
      <BranchesScreen />
    </Gate>
  );
}

function BranchesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBrands } = useSession();
  const canManage = usePermission("org.manage");
  const [selected, setSelected] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  /**
   * Brand names come from the session's brand list — the real one against a
   * backend. Reading `mock/org` here meant every live branch's brand cell
   * showed "—", because a live brandId matches no fixture.
   */
  const brandName = useMemo(() => {
    const index = new Map(availableBrands.map((brand) => [brand.id, brand]));
    return (brandId: string) => index.get(brandId) ?? null;
  }, [availableBrands]);

  const collection = useCollection<Branch>(
    (query) => services.organisation.branches.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      seats: rows.reduce((sum, row) => sum + row.seats, 0),
      franchises: rows.filter((row) => row.isFranchise).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Branch>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={<span className="font-mono">{row.code}</span>}
          />
        ),
      },
      {
        key: "brand",
        header: t("common.brand"),
        render: (row) => {
          const brand = brandName(row.brandId);
          return brand ? (
            <span className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: brand.colour }}
              />
              {tx(brand.name)}
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          );
        },
      },
      {
        key: "country",
        header: t("org.country"),
        secondary: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.countryCode} · {row.currency}
          </span>
        ),
      },
      {
        key: "dayBoundary",
        header: t("org.dayBoundary"),
        secondary: true,
        hint: t("org.dayBoundaryHint"),
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.businessDayBoundary}
          </span>
        ),
      },
      {
        key: "seats",
        header: t("org.seats"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.seats, fmt),
      },
      {
        key: "openedAt",
        header: t("org.openedOn"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.openedAt, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.active ? "good" : "muted"} dot>
              {row.active ? t("common.active") : t("common.inactive")}
            </Badge>
            {row.isFranchise ? <Badge tone="accent">{t("org.franchise")}</Badge> : null}
          </span>
        ),
      },
    ],
    [t, tx, fmt, brandName],
  );

  return (
    <>
      <PageHeader
        title={t("org.branchesTitle")}
        subtitle={t("org.branchesSubtitle")}
        spec="FR-BRN-001"
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile label={t("org.seats")} value={formatNumber(totals.seats, fmt)} />
          <MetricTile
            label={t("org.franchise")}
            value={formatNumber(totals.franchises, fmt)}
            hint={t("org.franchiseHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("org.branchSearchPlaceholder")}
          filters={[
            {
              key: "brandId",
              label: t("common.brand"),
              options: availableBrands.map((brand) => ({ value: brand.id, label: tx(brand.name) })),
            },
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
            {
              key: "isFranchise",
              label: t("org.franchise"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("org.branchesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <BranchDrawer
        branch={selected}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />
      <RecordDrawer
        open={creating}
        title={t("org.newBranch")}
        fields={[
          { name: "name", label: t("common.name"), required: true, maxLength: 120 },
          { name: "code", label: t("common.code"), required: true, maxLength: 12, ltr: true },
          {
            name: "brandId",
            label: t("common.brand"),
            kind: "select",
            required: true,
            options: availableBrands.map((brand) => ({ value: brand.id, label: tx(brand.name) })),
          },
          { name: "countryCode", label: t("org.country"), initial: "EG", maxLength: 2, ltr: true },
          { name: "currency", label: t("org.currency"), initial: "EGP", maxLength: 3, ltr: true },
          { name: "timezone", label: t("org.timezone"), initial: "Africa/Cairo", ltr: true },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.organisation.branches.create({
            name: { en: values.name.trim(), ar: values.name.trim() },
            code: values.code.trim(),
            brandId: values.brandId,
            countryCode: values.countryCode.trim().toUpperCase() as never,
            currency: values.currency.trim().toUpperCase() as never,
            timezone: values.timezone.trim(),
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("org.branchCreated"));
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function BranchDrawer({
  branch,
  onClose,
  onChanged,
}: {
  branch: Branch | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { availableBrands } = useSession();
  const canManage = usePermission("org.branch.manage");
  if (!branch) return null;

  const brand = availableBrands.find((row) => row.id === branch.brandId) ?? null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(branch.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {branch.code}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.brand")}>{brand ? tx(brand.name) : "—"}</DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={branch.active ? "good" : "muted"} dot>
              {branch.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
          <DescRow label={t("org.franchise")}>
            {branch.isFranchise ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("org.country")} mono>
            <span dir="ltr">{branch.countryCode}</span>
          </DescRow>
          <DescRow label={t("org.currency")} mono>
            <span dir="ltr">{branch.currency}</span>
          </DescRow>
          <DescRow label={t("org.timezone")} mono>
            <span dir="ltr">{branch.timezone}</span>
          </DescRow>
          <DescRow label={t("org.dayBoundary")} mono>
            <span dir="ltr">{branch.businessDayBoundary}</span>
          </DescRow>
          <DescRow label={t("org.seats")} mono>
            {formatNumber(branch.seats, fmt)}
          </DescRow>
          <DescRow label={t("org.area")} mono>
            <span dir="ltr">{formatNumber(branch.areaSqm, fmt)} m²</span>
          </DescRow>
          <DescRow label={t("org.openedOn")}>{formatDate(branch.openedAt, fmt)}</DescRow>
          <DescRow label={t("org.address")}>{branch.address}</DescRow>
        </DescList>

        <Callout tone="muted">{t("org.dayBoundaryHint")}</Callout>

        {canManage ? (
          <BrandReassign branch={branch} brands={availableBrands} onChanged={onChanged} />
        ) : null}

        <OperatingHoursPanel branchId={branch.id} canManage={canManage} onChanged={onChanged} />
        <PrintRoutingPanel branchId={branch.id} canManage={canManage} onChanged={onChanged} />
        <StationRoutingPanel branchId={branch.id} canManage={canManage} onChanged={onChanged} />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** Move a branch to another brand within the same tenant. */
function BrandReassign({
  branch,
  brands,
  onChanged,
}: {
  branch: Branch;
  brands: { id: string; name: { en: string; ar: string } }[];
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [brandId, setBrandId] = useState(branch.brandId);

  const others = brands.filter((brand) => brand.id !== branch.brandId);
  if (others.length === 0) return null;

  async function reassign() {
    if (!brandId || brandId === branch.brandId) return;
    await action.run(() => services.organisation.reassignBranchBrand(branch.id, brandId), {
      onSuccess: () => onChanged(t("org.brandReassigned")),
    });
  }

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("org.reassignBrand")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t("common.brand")} hint={t("org.reassignBrandHint")}>
            <Select
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
              disabled={action.pending}
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {tx(brand.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          variant="secondary"
          disabled={brandId === branch.brandId || action.pending}
          loading={action.pending}
          onClick={reassign}
        >
          {t("common.save")}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const DAY_KEYS = [
  "common.sunday",
  "common.monday",
  "common.tuesday",
  "common.wednesday",
  "common.thursday",
  "common.friday",
  "common.saturday",
] as const;

/**
 * FR-FIN-024 — opening intervals, and the cutover that decides which trading
 * day a late-night sale belongs to.
 */
function OperatingHoursPanel({
  branchId,
  canManage,
  onChanged,
}: {
  branchId: string;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [adding, setAdding] = useState(false);

  const hours = useAsync(() => services.organisation.operatingHours(branchId), [branchId]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">{t("org.operatingHours")}</h3>
        {canManage ? (
          <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            {t("common.add")}
          </Button>
        ) : null}
      </div>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <AsyncPanel
        state={hours}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("org.noOperatingHours")}</Callout>}
      >
        {(rows) => (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="text-fg w-24 shrink-0">{t(DAY_KEYS[row.dayOfWeek] ?? "common.sunday")}</span>
                <span className="text-fg-muted font-mono" dir="ltr">
                  {row.opensAt} – {row.closesAt}
                </span>
                {row.overnight ? <Badge tone="warn">{t("org.overnight")}</Badge> : null}
                <span className="text-fg-subtle ms-auto font-mono" dir="ltr">
                  {row.businessDayCutover}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>

      <RecordDrawer
        open={adding}
        title={t("org.newOperatingHours")}
        note={t("org.dayBoundaryHint")}
        fields={[
          {
            name: "dayOfWeek",
            label: t("org.dayOfWeek"),
            kind: "select",
            required: true,
            options: DAY_KEYS.map((key, index) => ({ value: String(index), label: t(key) })),
          },
          { name: "opensAt", label: t("org.opensAt"), required: true, initial: "10:00", ltr: true },
          { name: "closesAt", label: t("org.closesAt"), required: true, initial: "23:00", ltr: true },
          {
            name: "businessDayCutover",
            label: t("org.dayBoundary"),
            initial: "04:00",
            ltr: true,
          },
        ]}
        onClose={() => setAdding(false)}
        onSubmit={(values) =>
          services.organisation.addOperatingHours(branchId, {
            dayOfWeek: Number(values.dayOfWeek),
            opensAt: values.opensAt.trim(),
            closesAt: values.closesAt.trim(),
            businessDayCutover: values.businessDayCutover.trim() || undefined,
          })
        }
        onDone={() => {
          setAdding(false);
          hours.reload();
          onChanged(t("org.operatingHoursAdded"));
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Which printer each document type goes to, optionally per station. */
function PrintRoutingPanel({
  branchId,
  canManage,
  onChanged,
}: {
  branchId: string;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);

  const routing = useAsync(() => services.organisation.printRouting(branchId), [branchId]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">{t("org.printRouting")}</h3>
        {canManage ? (
          <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            {t("common.add")}
          </Button>
        ) : null}
      </div>

      <AsyncPanel
        state={routing}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("org.noPrintRouting")}</Callout>}
      >
        {(rows) => (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <Badge tone="neutral">{row.documentType}</Badge>
                <span className="text-fg-muted font-mono" dir="ltr">
                  {row.printerTarget}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>

      <RecordDrawer
        open={adding}
        title={t("org.newPrintRouting")}
        fields={[
          {
            name: "documentType",
            label: t("org.documentType"),
            kind: "select",
            required: true,
            options: [
              { value: "receipt", label: t("org.docReceipt") },
              { value: "kitchen_ticket", label: t("org.docKitchen") },
              { value: "bar_ticket", label: t("org.docBar") },
            ],
          },
          {
            name: "printerTarget",
            label: t("org.printerTarget"),
            required: true,
            ltr: true,
            placeholder: "kitchen-1",
          },
        ]}
        onClose={() => setAdding(false)}
        onSubmit={(values) =>
          services.organisation.addPrintRouting(branchId, {
            documentType: values.documentType as "receipt" | "kitchen_ticket" | "bar_ticket",
            printerTarget: values.printerTarget.trim(),
          })
        }
        onDone={() => {
          setAdding(false);
          routing.reload();
          onChanged(t("org.printRoutingAdded"));
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

/** FR-KDS-002 — which station prepares what, most specific match winning. */
function StationRoutingPanel({
  branchId,
  canManage,
  onChanged,
}: {
  branchId: string;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const [adding, setAdding] = useState(false);

  const rules = useAsync(() => services.organisation.stationRoutingRules(branchId), [branchId]);
  const stations = useAsync(
    () => services.operations.stations({ limit: 200 }),
    [branchId],
  );
  const categories = useAsync(() => services.catalogue.categories.list({ limit: 500 }), []);

  const stationName = (stationId: string) =>
    stations.data?.rows.find((row) => row.id === stationId)?.name;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">{t("org.stationRouting")}</h3>
        {canManage ? (
          <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            {t("common.add")}
          </Button>
        ) : null}
      </div>

      <AsyncPanel
        state={rules}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("org.noStationRouting")}</Callout>}
      >
        {(rows) => (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {rows.map((row) => {
              const name = stationName(row.stationId);
              return (
                <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="text-fg min-w-0 flex-1 truncate">
                    {name ? tx(name) : row.stationId}
                  </span>
                  <Badge tone="muted">
                    {t("menu.priority")} {row.priority}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </AsyncPanel>

      <RecordDrawer
        open={adding}
        title={t("org.newStationRouting")}
        note={t("org.stationRoutingHint")}
        fields={[
          {
            name: "stationId",
            label: t("org.station"),
            kind: "select",
            required: true,
            options: (stations.data?.rows ?? []).map((station) => ({
              value: station.id,
              label: tx(station.name),
            })),
          },
          {
            name: "categoryId",
            label: t("menu.category"),
            kind: "select",
            options: (categories.data?.rows ?? []).map((category) => ({
              value: category.id,
              label: tx(category.name),
            })),
          },
          { name: "priority", label: t("menu.priority"), kind: "number", initial: "10" },
        ]}
        onClose={() => setAdding(false)}
        onSubmit={(values) =>
          services.organisation.addStationRoutingRule(branchId, {
            stationId: values.stationId,
            categoryId: values.categoryId || undefined,
            priority: Number(values.priority) || 0,
          })
        }
        onDone={() => {
          setAdding(false);
          rules.reload();
          onChanged(t("org.stationRoutingAdded"));
        }}
      />
    </section>
  );
}
