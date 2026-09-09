"use client";

/**
 * Promotions — SRS §18.4.
 *
 * A rules engine is only usable if you can read back what you just built, so
 * the builder carries a plain-language summary that regenerates as the rules
 * change. Without it, "percent_off_items 15, minQty 2, tags=[vip]" is a
 * configuration nobody can check and everybody approves.
 *
 * Stacking defaults to off with best-value selection (FR-CRM-030). Two
 * promotions that both apply and both stack is how a 15% offer becomes 40%
 * on a Friday night, and the operator finds out from the P&L.
 */

import { useMemo, useState } from "react";
import { BadgePercent, Plus, Ticket, Trash2 } from "lucide-react";

import type { Promotion, PromotionEffectType } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import { EmptyState } from "@/components/console/fields";
import { PromotionDrawer } from "@/components/console/promotion";
import { Badge, Button, Toast } from "@/components/console/ui";

export default function PromotionsPage() {
  return (
    <Gate permissions={["crm.promotion.view"]}>
      <PromotionsScreen />
    </Gate>
  );
}

const EFFECT_KEY: Record<PromotionEffectType, string> = {
  percent_off_order: "promo.effect.percentOrder",
  percent_off_items: "promo.effect.percentItems",
  amount_off_order: "promo.effect.amountOrder",
  free_item: "promo.effect.freeItem",
  buy_x_get_y: "promo.effect.bxgy",
  cheapest_free: "promo.effect.cheapestFree",
  bundle_price: "promo.effect.bundle",
  free_delivery: "promo.effect.freeDelivery",
  points_multiplier: "promo.effect.points",
};

function PromotionsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const canManage = usePermission("crm.promotion.manage");

  const [selected, setSelected] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Promotion>(
    (query) => services.crm.promotions.list(query),
    { scope, initialSort: "-priority", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      redemptions: rows.reduce((sum, row) => sum + row.redemptions, 0),
      cost: rows.reduce((sum, row) => sum + row.discountCost.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.discountCost.currency ?? "EGP";

  async function remove(promotion: Promotion) {
    const ok = await confirm({
      title: t("promo.deleteTitle"),
      body: t("promo.deleteBody").replace("{name}", tx(promotion.name)),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.crm.promotions.remove(promotion.id), {
      onSuccess: () => {
        setSelected(null);
        setMessage(t("promo.deleted"));
        collection.reload();
      },
    });
  }

  const columns = useMemo<Column<Promotion>[]>(
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
                {row.kind === "markdown" ? (
                  <Badge tone="warn">{t("promo.markdown")}</Badge>
                ) : null}
              </span>
            }
            secondary={t(EFFECT_KEY[row.effect.type] as never)}
          />
        ),
      },
      {
        key: "window",
        header: t("promo.window"),
        secondary: true,
        render: (row) =>
          row.startsOn || row.endsOn ? (
            <span className="text-xs">
              {row.startsOn ? formatDate(row.startsOn, fmt) : "—"} →{" "}
              {row.endsOn ? formatDate(row.endsOn, fmt) : t("common.never")}
            </span>
          ) : (
            <span className="text-fg-subtle">{t("promo.always")}</span>
          ),
      },
      {
        key: "priority",
        header: t("promo.priority"),
        numeric: true,
        sortable: true,
        secondary: true,
        render: (row) => formatNumber(row.priority, fmt),
      },
      {
        key: "redemptions",
        header: t("promo.redemptions"),
        numeric: true,
        sortable: true,
        render: (row) => formatNumber(row.redemptions, fmt),
      },
      {
        key: "discountCost",
        header: t("promo.cost"),
        numeric: true,
        render: (row) => formatMoney(row.discountCost, fmt),
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
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("promo.title")}
        subtitle={t("promo.subtitle")}
        spec="§18.4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              filename="promotions"
              title={t("promo.title")}
              permission="crm.promotion.view"
              rows={collection.rows}
              onExported={setMessage}
              columns={[
                { key: "name", header: t("common.name"), value: (row) => tx(row.name) },
                { key: "effect", header: t("promo.effect"), value: (row) => row.effect.type },
                { key: "value", header: t("promo.value"), value: (row) => row.effect.value },
                { key: "starts", header: t("range.from"), value: (row) => row.startsOn ?? "" },
                { key: "ends", header: t("range.to"), value: (row) => row.endsOn ?? "" },
                { key: "redemptions", header: t("promo.redemptions"), value: (row) => row.redemptions },
                { key: "cost", header: t("promo.cost"), value: (row) => row.discountCost.amount / 100 },
                { key: "active", header: t("common.status"), value: (row) => (row.active ? "active" : "inactive") },
              ]}
            />
            {canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("promo.newPromotion")}
              </Button>
            ) : null}
          </div>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("promo.activeCount")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("promo.redemptions")}
            value={formatNumber(totals.redemptions, fmt)}
          />
          <MetricTile
            label={t("promo.cost")}
            value={formatMoney({ amount: totals.cost, currency }, fmt, true)}
            hint={t("promo.costHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("promo.searchPlaceholder")}
          filters={[
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
            {
              key: "kind",
              label: t("common.type"),
              options: [
                { value: "promotion", label: t("promo.promotion") },
                { value: "markdown", label: t("promo.markdown") },
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
          caption={t("promo.title")}
          emptyTitle={t("promo.noneTitle")}
          emptyBody={t("promo.noneBody")}
        />

        {!collection.loading && collection.total === 0 && !collection.filtered ? (
          <EmptyState
            title={t("promo.firstTitle")}
            body={t("promo.firstBody")}
            icon={<BadgePercent size={22} />}
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  {t("promo.newPromotion")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </PageBody>

      <PromotionDrawer
        promotion={selected}
        open={Boolean(selected) || creating}
        creating={creating}
        canManage={canManage}
        onClose={() => {
          setSelected(null);
          setCreating(false);
        }}
        onDelete={remove}
        onSaved={(note) => {
          setMessage(note);
          collection.reload();
          setCreating(false);
          setSelected(null);
        }}
      />

      <Toast message={message} />
    </>
  );
}
