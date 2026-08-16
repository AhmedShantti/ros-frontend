"use client";

/**
 * Combos — SRS §10.2.4, §8.2.4.
 *
 * A combo is a set of slots, not a bundle of items. Each slot offers a choice
 * and may carry its own price delta, which is how "upgrade to large fries"
 * stays a single line on the receipt rather than a separate sale that breaks
 * the meal's reporting.
 *
 * The pricing strategy decides what the guest is charged: a flat price, the
 * component sum less a discount, or per-component overrides. It is shown as a
 * column because the same slot layout under two strategies is two different
 * products from a margin point of view.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Combo, ComboSlot } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber } from "@/lib/console/format";
import { COMBO_STRATEGY, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, DescList, DescRow, Drawer, Toast } from "@/components/console/ui";

export default function MenuCombosPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <CombosScreen />
    </Gate>
  );
}

function CombosScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Combo | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Combo>(
    (query) => services.catalogue.combos.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      inactive: rows.filter((row) => !row.active).length,
      slots: rows.reduce((sum, row) => sum + row.slots.length, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Combo>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.slots.map((slot) => tx(slot.name)).join(" + ")}
          />
        ),
      },
      {
        key: "price",
        header: t("menu.price"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.price, fmt),
      },
      {
        key: "pricingStrategy",
        header: t("menu.strategy"),
        render: (row) => {
          const strategy = labelOf(COMBO_STRATEGY, row.pricingStrategy);
          return <Badge tone={strategy.tone}>{tx(strategy.label)}</Badge>;
        },
      },
      {
        key: "slots",
        header: t("menu.slots"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.slots.length, fmt),
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
        title={t("menu.combosTitle")}
        subtitle={t("menu.combosSubtitle")}
        spec="FR-MNU-016"
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
          <MetricTile label={t("menu.combosTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile label={t("menu.slots")} value={formatNumber(totals.slots, fmt)} />
          <MetricTile label={t("common.inactive")} value={formatNumber(totals.inactive, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "pricingStrategy",
              label: t("menu.strategy"),
              options: Object.entries(COMBO_STRATEGY).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
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
          caption={t("menu.combosTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ComboDrawer combo={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ComboDrawer({ combo, onClose }: { combo: Combo | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!combo) return null;

  const strategy = labelOf(COMBO_STRATEGY, combo.pricingStrategy);

  return (
    <Drawer open onClose={onClose} title={tx(combo.name)}>
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("menu.price")} mono>
            {formatMoney(combo.price, fmt)}
          </DescRow>
          <DescRow label={t("menu.strategy")}>
            <Badge tone={strategy.tone}>{tx(strategy.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={combo.active ? "good" : "muted"} dot>
              {combo.active ? t("common.active") : t("common.inactive")}
            </Badge>
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.slots")}</h3>
          <ul className="space-y-3">
            {combo.slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} />
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}

function SlotRow({ slot }: { slot: ComboSlot }) {
  const { t, tx, fmt } = useI18n();
  const delta = slot.priceDelta.amount;

  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg text-sm font-medium">{tx(slot.name)}</span>
        {delta === 0 ? (
          <Badge tone="muted">{t("menu.noSurcharge")}</Badge>
        ) : (
          <span className="text-fg font-mono text-sm tabular-nums">
            {delta > 0 ? "+" : ""}
            {formatMoney(slot.priceDelta, fmt)}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {slot.optionNames.map((name, index) => (
          <Badge key={`${slot.id}-${index}`} tone="neutral">
            {tx(name)}
          </Badge>
        ))}
      </div>
    </li>
  );
}
