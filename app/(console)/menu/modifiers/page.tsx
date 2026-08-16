"use client";

/**
 * Modifier groups — SRS §10.3.
 *
 * A modifier carries two deltas, and the second one is the reason this module
 * exists (FR-MNU-013). The price delta is what the guest pays. The recipe
 * delta is what the store loses: "extra cheese" adds 30 g of cheese to the
 * depletion, "no cheese" removes all of it. A modifier system that only knows
 * about money will quietly mis-state food cost on every customised order.
 *
 * `min/max` is the selection rule the POS enforces — required groups block the
 * line until satisfied (BR-MNU-004), which is why they are called out here
 * rather than left as a boolean column nobody reads.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Modifier, ModifierGroup, RecipeDelta } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { MODIFIER_KIND, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
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

export default function MenuModifiersPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <ModifiersScreen />
    </Gate>
  );
}

function ModifiersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<ModifierGroup | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<ModifierGroup>(
    (query) => services.catalogue.modifierGroups.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      modifiers: rows.reduce((sum, row) => sum + row.modifiers.length, 0),
      required: rows.filter((row) => row.required).length,
      // A group whose modifiers never touch a recipe is a pricing-only group.
      withRecipeDelta: rows.filter((row) =>
        row.modifiers.some((modifier) => modifier.recipeDelta.length > 0),
      ).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<ModifierGroup>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.modifiers
              .slice(0, 3)
              .map((modifier) => tx(modifier.name))
              .join(" · ")}
          />
        ),
      },
      {
        key: "minMax",
        header: t("menu.minMax"),
        numeric: true,
        render: (row) => (
          <span dir="ltr">
            {formatNumber(row.minSelections, fmt)} / {formatNumber(row.maxSelections, fmt)}
          </span>
        ),
      },
      {
        key: "required",
        header: t("menu.required"),
        render: (row) => (
          <Badge tone={row.required ? "accent" : "muted"}>
            {row.required ? t("common.required") : t("common.optional")}
          </Badge>
        ),
      },
      {
        key: "modifierCount",
        header: t("menu.modifierCount"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.modifiers.length, fmt),
      },
      {
        key: "attachedItemCount",
        header: t("menu.attachedItems"),
        sortable: true,
        numeric: true,
        render: (row) => formatNumber(row.attachedItemCount, fmt),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("menu.modifiersTitle")}
        subtitle={t("menu.modifiersSubtitle")}
        spec="FR-MNU-013"
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
            label={t("menu.modifiersTitle")}
            value={formatNumber(collection.total, fmt)}
          />
          <MetricTile
            label={t("menu.modifierCount")}
            value={formatNumber(totals.modifiers, fmt)}
            footer={
              <span>
                {formatNumber(totals.required, fmt)} {t("menu.requiredGroups")}
              </span>
            }
          />
          <MetricTile
            label={t("menu.withRecipeDelta")}
            value={formatNumber(totals.withRecipeDelta, fmt)}
            spec="FR-MNU-013"
            hint={t("menu.recipeDeltaHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "required",
              label: t("menu.required"),
              options: [
                { value: "true", label: t("common.required") },
                { value: "false", label: t("common.optional") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("menu.modifiersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <GroupDrawer group={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function GroupDrawer({
  group,
  onClose,
}: {
  group: ModifierGroup | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!group) return null;

  return (
    <Drawer open onClose={onClose} title={tx(group.name)}>
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("menu.minMax")} mono>
            <span dir="ltr">
              {formatNumber(group.minSelections, fmt)} / {formatNumber(group.maxSelections, fmt)}
            </span>
          </DescRow>
          <DescRow label={t("menu.required")}>
            <Badge tone={group.required ? "accent" : "muted"}>
              {group.required ? t("common.required") : t("common.optional")}
            </Badge>
          </DescRow>
          <DescRow label={t("menu.allowRepeat")}>
            {group.allowRepeat ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("menu.freeThreshold")} mono>
            {group.freeQuantityThreshold === null
              ? t("common.none")
              : formatNumber(group.freeQuantityThreshold, fmt)}
          </DescRow>
          <DescRow label={t("menu.attachedItems")} mono>
            {formatNumber(group.attachedItemCount, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("nav.modifiers")}</h3>
          <ul className="divide-line divide-y">
            {group.modifiers.map((modifier) => (
              <ModifierRow key={modifier.id} modifier={modifier} />
            ))}
          </ul>
        </section>

        <Callout tone="muted">{t("menu.recipeDeltaHint")}</Callout>
      </div>
    </Drawer>
  );
}

function ModifierRow({ modifier }: { modifier: Modifier }) {
  const { t, tx, fmt } = useI18n();
  const kind = labelOf(MODIFIER_KIND, modifier.kind);
  const delta = modifier.priceDelta.amount;

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-fg text-sm">{tx(modifier.name)}</span>
          <Badge tone={kind.tone}>{tx(kind.label)}</Badge>
          {modifier.isDefault ? <Badge tone="muted">{t("menu.default")}</Badge> : null}
        </div>
        <span className="text-fg shrink-0 font-mono text-sm tabular-nums">
          {delta === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <>
              {delta > 0 ? "+" : ""}
              {formatMoney(modifier.priceDelta, fmt)}
            </>
          )}
        </span>
      </div>

      {modifier.recipeDelta.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {modifier.recipeDelta.map((entry, index) => (
            <RecipeDeltaRow key={`${entry.componentId}-${index}`} entry={entry} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** What this modifier does to the depletion, in words rather than a payload. */
function RecipeDeltaRow({ entry }: { entry: RecipeDelta }) {
  const { t, tx, fmt } = useI18n();

  const description =
    entry.operation === "remove_all"
      ? t("menu.deltaRemoveAll")
      : entry.operation === "scale"
        ? t("menu.deltaScale")
        : entry.quantity
          ? `+ ${formatQuantity(entry.quantity, fmt)}`
          : t("menu.deltaAdd");

  return (
    <li className="text-fg-subtle flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="text-fg-muted">{tx(entry.componentName)}</span>
      <span className="font-mono">{description}</span>
    </li>
  );
}
