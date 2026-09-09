"use client";

/**
 * Customers — SRS ch.18.
 *
 * Restaurants historically know nothing about their customers, and the usual
 * reason is the capture form: a counter form demanding email, birthday and
 * address gets filled in with fake data or skipped, and the resulting
 * database is worse than none because it is trusted while being wrong. So
 * creation here asks for a phone number and a name, and everything else is
 * something the record grows into.
 *
 * Three things on this screen are controls rather than decoration:
 *
 *   - **Consent is per channel and per purpose** (FR-CRM-008), with the
 *     timestamp and the source of each. A single "marketing" checkbox cannot
 *     answer the question a regulator actually asks, which is *when* and
 *     *how* this person agreed.
 *   - **Erasure anonymises** (FR-CRM-009). Deleting the order would be a tax
 *     compliance breach, so the person is replaced with a token and the
 *     financial record stays. The dialog says so plainly rather than
 *     promising a deletion it will not perform.
 *   - **Blocking carries a reason.** A flag with no reason is one nobody can
 *     lift with any confidence six months later.
 */

import { useMemo, useState } from "react";
import { Ban, Plus, ShieldOff, Trash2, UserCheck } from "lucide-react";

import type { Customer, CustomerSegment } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { churnRiskOf } from "@/lib/console/services/crm";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatRelative } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import { EmptyState } from "@/components/console/fields";
import { CustomerDrawer, CustomerQuickCreate, SEGMENT_TONE } from "@/components/console/customer";
import { Badge, Button, Toast } from "@/components/console/ui";

export default function CustomersPage() {
  return (
    <Gate permissions={["crm.customer.view"]}>
      <CustomersScreen />
    </Gate>
  );
}

function CustomersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const confirm = useConfirm();
  const action = useAction();

  const canManage = usePermission("crm.customer.manage");
  const canBlock = usePermission("crm.customer.block");
  const canErase = usePermission("crm.customer.erase");

  const [selected, setSelected] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Customer>(
    (query) => services.crm.customers.list(query),
    { scope, initialSort: "-lastOrderAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      spend: rows.reduce((sum, row) => sum + row.totalSpend.amount, 0),
      withConsent: rows.filter((row) =>
        row.consent.some((flag) => flag.purpose === "marketing" && flag.granted),
      ).length,
      atRisk: rows.filter((row) => row.segment === "at_risk" || row.segment === "hibernating")
        .length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.totalSpend.currency ?? "EGP";

  async function block(customer: Customer) {
    const ok = await confirm({
      title: t("crm.blockTitle").replace("{name}", tx(customer.name)),
      body: t("crm.blockBody"),
      confirmLabel: t("crm.block"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      () => services.crm.customers.setBlocked(customer.id, true, t("crm.blockDefaultReason")),
      {
        onSuccess: () => {
          setMessage(t("crm.blocked"));
          collection.reload();
        },
      },
    );
  }

  async function erase(customer: Customer) {
    const ok = await confirm({
      title: t("crm.eraseTitle"),
      body: t("crm.eraseBody"),
      confirmLabel: t("crm.erase"),
      tone: "danger",
      typeToConfirm: customer.phone,
    });
    if (!ok) return;
    await action.run(() => services.crm.customers.erase(customer.id), {
      onSuccess: () => {
        setMessage(t("crm.erased"));
        setSelected(null);
        collection.reload();
      },
    });
  }

  const columns = useMemo<Column<Customer>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={
              <span className="flex items-center gap-1.5">
                {tx(row.name)}
                {row.blocked ? <Ban size={12} className="text-bad" aria-hidden /> : null}
                {row.anonymisedAt ? <Badge tone="muted">{t("crm.anonymised")}</Badge> : null}
              </span>
            }
            secondary={<span dir="ltr">{row.phone}</span>}
          />
        ),
      },
      {
        key: "segment",
        header: t("crm.segment"),
        render: (row) => (
          <Badge tone={SEGMENT_TONE[row.segment]}>
            {t(`crm.segment.${row.segment}` as never)}
          </Badge>
        ),
      },
      {
        key: "orderCount",
        header: t("crm.orders"),
        numeric: true,
        sortable: true,
        render: (row) => formatNumber(row.orderCount, fmt),
      },
      {
        key: "totalSpend",
        header: t("crm.totalSpend"),
        numeric: true,
        sortable: true,
        render: (row) => formatMoney(row.totalSpend, fmt),
      },
      {
        key: "loyaltyPoints",
        header: t("crm.points"),
        numeric: true,
        sortable: true,
        secondary: true,
        render: (row) => formatNumber(row.loyaltyPoints, fmt),
      },
      {
        key: "lastOrderAt",
        header: t("crm.lastOrder"),
        sortable: true,
        secondary: true,
        render: (row) => {
          if (!row.lastOrderAt) return <span className="text-fg-subtle">—</span>;
          const risk = churnRiskOf(row);
          return (
            <CellStack
              primary={formatRelative(row.lastOrderAt, fmt)}
              secondary={
                risk !== null && risk > 0.5
                  ? t("crm.overdueForThem")
                  : formatDate(row.lastOrderAt, fmt)
              }
            />
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("crm.title")}
        subtitle={t("crm.subtitle")}
        spec="§18.2"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              filename="customers"
              title={t("crm.title")}
              permission="crm.customer.export"
              rows={collection.rows}
              onExported={setMessage}
              filterSummary={collection.filtered ? t("crm.filteredExport") : undefined}
              columns={[
                { key: "phone", header: t("crm.phone"), value: (row) => row.phone },
                { key: "name", header: t("common.name"), value: (row) => tx(row.name) },
                { key: "email", header: t("crm.email"), value: (row) => row.email ?? "" },
                { key: "segment", header: t("crm.segment"), value: (row) => row.segment },
                { key: "orders", header: t("crm.orders"), value: (row) => row.orderCount },
                { key: "spend", header: t("crm.totalSpend"), value: (row) => row.totalSpend.amount / 100 },
                { key: "points", header: t("crm.points"), value: (row) => row.loyaltyPoints },
                { key: "lastOrder", header: t("crm.lastOrder"), value: (row) => row.lastOrderAt ?? "" },
              ]}
            />
            {canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("crm.newCustomer")}
              </Button>
            ) : null}
          </div>
        }
      />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile label={t("crm.customers")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("crm.totalSpend")}
            value={formatMoney({ amount: totals.spend, currency }, fmt, true)}
            hint={t("crm.spendHint")}
          />
          <MetricTile
            label={t("crm.marketingConsent")}
            value={formatNumber(totals.withConsent, fmt)}
            hint={t("crm.consentHint")}
          />
          <MetricTile
            label={t("crm.needAttention")}
            value={formatNumber(totals.atRisk, fmt)}
            hint={t("crm.needAttentionHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("crm.searchPlaceholder")}
          filters={[
            {
              key: "segment",
              label: t("crm.segment"),
              options: (
                [
                  "champion",
                  "loyal",
                  "at_risk",
                  "hibernating",
                  "new",
                ] as CustomerSegment[]
              ).map((segment) => ({
                value: segment,
                label: t(`crm.segment.${segment}` as never),
              })),
            },
            {
              key: "blocked",
              label: t("crm.blockedFilter"),
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
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          caption={t("crm.title")}
          emptyTitle={t("crm.noneTitle")}
          emptyBody={t("crm.noneBody")}
          emptyAction={
            canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("crm.newCustomer")}
              </Button>
            ) : undefined
          }
        />

        {!collection.loading && collection.total === 0 && !collection.filtered ? (
          <EmptyState
            title={t("crm.captureTitle")}
            body={t("crm.captureBody")}
            icon={<UserCheck size={22} />}
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  {t("crm.newCustomer")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </PageBody>

      <CustomerDrawer
        customer={selected}
        canManage={canManage}
        canBlock={canBlock}
        canErase={canErase}
        onClose={() => setSelected(null)}
        onBlock={block}
        onUnblock={async (customer) => {
          await action.run(() => services.crm.customers.setBlocked(customer.id, false, null), {
            onSuccess: () => {
              setMessage(t("crm.unblocked"));
              collection.reload();
            },
          });
        }}
        onErase={erase}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <CustomerQuickCreate
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(customer) => {
          setCreating(false);
          setMessage(t("crm.created"));
          collection.reload();
          setSelected(customer);
        }}
      />

      <Toast message={message} />
    </>
  );
}
