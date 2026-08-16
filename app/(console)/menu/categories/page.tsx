"use client";

/**
 * Menu categories — SRS §10.2.
 *
 * The hierarchy the specification names is menu → category → item → variant,
 * so a category is a node rather than a tag: it has a parent, an order, and a
 * colour the POS grid inherits. Sub-categories are rendered indented under
 * their parent rather than as a flat list with a "parent" column, because the
 * ordering only means anything within a level.
 *
 * `itemCount` is the count attached to the category, and it is shown even when
 * the category is inactive — deactivating a category with items in it is the
 * kind of thing someone should notice before the POS grid loses a tile.
 */

import { useMemo, useState } from "react";
import { Layers, Plus } from "lucide-react";
import type { MenuCategory } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Toast, cx } from "@/components/console/ui";

export default function MenuCategoriesPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <CategoriesScreen />
    </Gate>
  );
}

function CategoriesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<MenuCategory>(
    (query) => services.catalogue.categories.list(query),
    { scope, initialSort: "sortOrder", pageSize: 50 },
  );

  // A child is only indentable when its parent is on the same page; when a
  // filter has hidden the parent the child stands on its own rather than
  // pretending to be a root.
  const parentIds = useMemo(
    () => new Set(collection.rows.map((row) => row.id)),
    [collection.rows],
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      items: rows.reduce((sum, row) => sum + row.itemCount, 0),
      inactive: rows.filter((row) => !row.active).length,
      empty: rows.filter((row) => row.itemCount === 0).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<MenuCategory>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => {
          const nested = Boolean(row.parentId) && parentIds.has(row.parentId!);
          return (
            <div className={cx("flex items-center gap-2.5", nested && "ps-5")}>
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.colour }}
              />
              <CellStack primary={tx(row.name)} />
            </div>
          );
        },
      },
      {
        key: "sortOrder",
        header: t("menu.sortOrder"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.sortOrder, fmt),
      },
      {
        key: "itemCount",
        header: t("menu.itemCount"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.itemCount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            formatNumber(row.itemCount, fmt)
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
    [t, tx, fmt, parentIds],
  );

  return (
    <>
      <PageHeader
        title={t("menu.categoriesTitle")}
        subtitle={t("menu.categoriesSubtitle")}
        spec="FR-MNU-001"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("menu.categoriesTitle")}
            value={formatNumber(collection.total, fmt)}
          />
          <MetricTile label={t("menu.itemCount")} value={formatNumber(totals.items, fmt)} />
          <MetricTile
            label={t("common.inactive")}
            value={formatNumber(totals.inactive, fmt)}
            footer={
              totals.empty > 0 ? (
                <span>
                  {formatNumber(totals.empty, fmt)} {t("menu.categoriesEmpty")}
                </span>
              ) : null
            }
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
          caption={t("menu.categoriesTitle")}
          emptyTitle={t("menu.categoriesTitle")}
          emptyAction={<Layers size={16} className="text-fg-subtle" />}
          dense
        />
      </PageBody>

      <Toast message={message} />
    </>
  );
}
