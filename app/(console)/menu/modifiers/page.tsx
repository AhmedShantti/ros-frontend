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
import { Plus, SlidersHorizontal } from "lucide-react";
import {
  ContextPricing,
  GroupRulesDrawer,
  GroupSimulator,
  NestingPicker,
} from "@/components/console/modifier-group-editor";
import type { Modifier, ModifierGroup, RecipeDelta, Localised } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { MODIFIER_KIND, labelOf } from "@/lib/console/labels";
import { ModifierEffects } from "@/components/console/modifier-effects";
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
  Field,
  Input,
  Select,
  Toast,
  Toggle,
} from "@/components/console/ui";
import { LocalisedField, EMPTY_LOCALISED, hasLocalisedText, trimLocalised } from "@/components/console/fields";

export default function MenuModifiersPage() {
  return (
    <Gate permissions={["menu.item.read"]}>
      <ModifiersScreen />
    </Gate>
  );
}

function ModifiersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<ModifierGroup | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
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
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreatingGroup(true)}>
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

      <GroupDrawer
        group={selected}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <NewGroupDrawer
        open={creatingGroup}
        onClose={() => setCreatingGroup(false)}
        onCreated={() => {
          setCreatingGroup(false);
          setMessage(t("menu.groupCreated"));
          collection.reload();
        }}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function GroupDrawer({
  group,
  onClose,
  onChanged,
}: {
  group: ModifierGroup | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canManage = usePermission("menu.item.manage");
  const [adding, setAdding] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const context = useAsync(async () => {
    const [groups, nesting, priceRules, priceLists] = await Promise.all([
      services.catalogue.modifierGroups.list({ limit: 300 }).then((page) => page.rows),
      services.modifierNesting.map(),
      // FR-POS-022 — the per-context deltas, read once for the whole drawer
      // rather than per modifier row.
      services.modifierPricing.all(),
      services.catalogue.priceLists.list({ limit: 200 }).then((page) => page.rows),
    ]);
    return { groups, nesting, priceRules, priceLists };
  }, [group?.id]);
  if (!group) return null;

  // The drawer is opened from a list row; the freshest copy of this group is
  // the one in the context read, which reloads after every change.
  const current = context.data?.groups.find((row) => row.id === group.id) ?? group;
  const changed = (note: string) => {
    context.reload();
    onChanged(note);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(current.name)}
      footer={
        canManage ? (
          <Button icon={<SlidersHorizontal size={14} />} onClick={() => setEditingRules(true)}>
            {t("mge.editRules")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("menu.minMax")} mono>
            <span dir="ltr">
              {formatNumber(current.minSelections, fmt)} / {formatNumber(current.maxSelections, fmt)}
            </span>
          </DescRow>
          <DescRow label={t("menu.required")}>
            <Badge tone={current.required ? "accent" : "muted"}>
              {current.required ? t("common.required") : t("common.optional")}
            </Badge>
          </DescRow>
          <DescRow label={t("menu.allowRepeat")}>
            {current.allowRepeat ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("menu.freeThreshold")} mono>
            {current.freeQuantityThreshold === null
              ? t("common.none")
              : formatNumber(current.freeQuantityThreshold, fmt)}
          </DescRow>
          <DescRow label={t("menu.attachedItems")} mono>
            {formatNumber(current.attachedItemCount, fmt)}
          </DescRow>
        </DescList>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-fg text-sm font-semibold">{t("nav.modifiers")}</h3>
            {canManage ? (
              <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
                {t("common.add")}
              </Button>
            ) : null}
          </div>

          {current.modifiers.length === 0 ? (
            <Callout tone="muted">{t("menu.noModifiers")}</Callout>
          ) : (
            <ul className="divide-line divide-y">
              {current.modifiers.map((modifier) => (
                <ModifierRow
                  key={modifier.id}
                  modifier={modifier}
                  onChanged={changed}
                  nesting={
                    canManage && context.data ? (
                      <>
                        <NestingPicker
                          parent={current}
                          modifier={modifier}
                          groups={context.data.groups}
                          nesting={context.data.nesting}
                          onChanged={changed}
                        />
                        <ContextPricing
                          modifier={modifier}
                          rules={context.data.priceRules}
                          branches={branches}
                          priceLists={context.data.priceLists}
                          onChanged={changed}
                        />
                      </>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <NewModifierDrawer
          open={adding}
          groupId={current.id}
          currency={current.modifiers[0]?.priceDelta.currency ?? "EGP"}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            changed(t("menu.modifierAdded"));
          }}
        />

        {context.data ? (
          <GroupSimulator group={current} groups={context.data.groups} nesting={context.data.nesting} />
        ) : null}

        <Callout tone="muted">{t("menu.recipeDeltaHint")}</Callout>

        {editingRules ? (
          <GroupRulesDrawer
            group={current}
            onClose={() => setEditingRules(false)}
            onSaved={(note) => {
              setEditingRules(false);
              changed(note);
            }}
          />
        ) : null}
      </div>
    </Drawer>
  );
}

function ModifierRow({
  modifier,
  onChanged,
  nesting,
}: {
  modifier: Modifier;
  onChanged: (message: string) => void;
  /** FR-POS-023 — the "opens group" control, when the viewer may edit. */
  nesting?: React.ReactNode;
}) {
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

      {/* `recipeDelta` is what the demo fixtures carry; the backend serves the
          same thing from its own endpoint, one modifier at a time. Whichever
          source is live, the modifier's effect on stock is shown here. */}
      {modifier.recipeDelta.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {modifier.recipeDelta.map((entry, index) => (
            <RecipeDeltaRow key={`${entry.componentId}-${index}`} entry={entry} />
          ))}
        </ul>
      ) : (
        <ModifierEffects modifier={modifier} onSaved={onChanged} />
      )}
      {nesting}
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

// ---------------------------------------------------------------------------

/**
 * `POST /catalogue/modifier-groups/{id}/modifiers`.
 *
 * `kind` is required by the DTO and has no default the server will accept:
 * FR-POS-021 needs to know whether a modifier adds, removes or substitutes,
 * because that is what decides how the line depletes stock. So the field is
 * a choice here, not a hidden constant.
 */
function NewModifierDrawer({
  open,
  groupId,
  currency,
  onClose,
  onCreated,
}: {
  open: boolean;
  groupId: string;
  currency: Modifier["priceDelta"]["currency"];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState<Localised>({ ...EMPTY_LOCALISED });
  const [kind, setKind] = useState<Modifier["kind"]>("addition");
  const [priceDelta, setPriceDelta] = useState("0");
  const [isDefault, setIsDefault] = useState(false);

  if (!open) return null;

  const parsed = Number(priceDelta);
  const valid = hasLocalisedText(name) && Number.isFinite(parsed);

  async function create() {
    if (!valid) return;
    await action.run(
      () =>
        services.catalogue.addModifier(groupId, {
          name: trimLocalised(name),
          kind,
          priceDelta: { amount: Math.round(parsed * 100), currency },
          isDefault,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newModifier")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={create}>
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

        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={120} />

        <Field label={t("menu.modifierKind")} hint={t("menu.modifierKindHint")} required>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as Modifier["kind"])}
          >
            {(["addition", "removal", "substitution"] as const).map((value) => (
              <option key={value} value={value}>
                {tx(labelOf(MODIFIER_KIND, value).label)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("menu.priceDelta")} hint={currency}>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={priceDelta}
            onChange={(event) => setPriceDelta(event.target.value)}
          />
        </Field>

        <Toggle checked={isDefault} onChange={setIsDefault} label={t("menu.default")} />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** `POST /catalogue/modifier-groups` — the reusable group itself. */
function NewGroupDrawer({
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
  const [name, setName] = useState<Localised>({ ...EMPTY_LOCALISED });
  const [minSelections, setMin] = useState("0");
  const [maxSelections, setMax] = useState("1");
  const [required, setRequired] = useState(false);

  if (!open) return null;

  async function create() {
    if (!hasLocalisedText(name)) return;
    await action.run(
      () =>
        services.catalogue.modifierGroups.create({
          name: trimLocalised(name),
          minSelections: Number(minSelections) || 0,
          maxSelections: Number(maxSelections) || 1,
          required,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newGroup")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!hasLocalisedText(name)}
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

        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={120} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("menu.minSelections")}>
            <Input
              inputMode="numeric"
              dir="ltr"
              value={minSelections}
              onChange={(event) => setMin(event.target.value)}
            />
          </Field>
          <Field label={t("menu.maxSelections")}>
            <Input
              inputMode="numeric"
              dir="ltr"
              value={maxSelections}
              onChange={(event) => setMax(event.target.value)}
            />
          </Field>
        </div>

        <Toggle checked={required} onChange={setRequired} label={t("menu.required")} />
      </div>
    </Drawer>
  );
}
