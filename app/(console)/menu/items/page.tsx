"use client";

/**
 * Menu items — SRS §10.2, §10.5.
 *
 * Three names per item is not redundancy (FR-MNU-005). The guest reads one
 * name on the menu, the line cook reads a short one on the ticket, and the
 * receipt carries a third that has to fit the paper width. Collapsing them
 * into one field is how kitchens end up with "Grilled Chicken Shawarma
 * Sandwich — Large" on a 40-column ticket.
 *
 * "86" is a first-class state (FR-MNU-030): it carries a reason, it is
 * reversible, and it is what the POS reads to grey a tile. `remainingSellable`
 * (FR-MNU-033) is the other half — the count derived from the recipe against
 * live stock, which is why an item can be available and still be nearly out.
 */

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Plus } from "lucide-react";
import type { MenuCategory, MenuItem, MenuItemVariant } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDuration, formatMoney, formatNumber } from "@/lib/console/format";
import { STATION_TYPE, TAX_CLASS, labelOf } from "@/lib/console/labels";
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
  Modal,
  Select,
  Textarea,
  Toast,
  cx,
} from "@/components/console/ui";

export default function MenuItemsPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <MenuItemsScreen />
    </Gate>
  );
}

function MenuItemsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canToggle = usePermission("menu.availability.toggle");

  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [pending86, setPending86] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  /**
   * Categories come from the service, not from `mock/catalogue`.
   *
   * Reading them from the fixtures — as this screen used to — meant a live
   * item's category cell rendered blank and the category filter offered ids
   * that match nothing on the backend.
   */
  const categoryPage = useAsync(
    () => services.catalogue.categories.list({ limit: 500, scope }),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const categories = useMemo(() => categoryPage.data?.rows ?? [], [categoryPage.data]);

  const collection = useCollection<MenuItem>(
    (query) => services.catalogue.items.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      unavailable: rows.filter((row) => !row.available).length,
      lowStock: rows.filter(
        (row) => row.remainingSellable !== null && row.remainingSellable <= 5,
      ).length,
    };
  }, [collection.rows]);

  /** FR-MNU-030 — bringing an item back needs no reason; taking it off does. */
  async function setAvailability(item: MenuItem, available: boolean, reason?: string) {
    try {
      await services.catalogue.toggleAvailability(item.id, available, reason);
      setMessage(available ? t("menu.restored") : t("menu.eightySixed"));
      setSelected(null);
      setPending86(null);
      collection.reload();
    } catch {
      setMessage(t("state.errorTitle"));
    }
  }

  const columns = useMemo<Column<MenuItem>[]>(
    () => [
      {
        key: "name",
        header: t("menu.itemName"),
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="text-base leading-none">
              {row.imageEmoji}
            </span>
            <CellStack primary={tx(row.name)} secondary={tx(row.kitchenName)} />
          </div>
        ),
      },
      {
        key: "category",
        header: t("common.category"),
        secondary: true,
        render: (row) => {
          const category = categories.find((c) => c.id === row.categoryId);
          return category ? (
            <span className="text-fg-muted text-xs">{tx(category.name)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          );
        },
      },
      {
        key: "price",
        header: t("menu.price"),
        sortable: true,
        numeric: true,
        render: (row) => <VariantPrice item={row} />,
      },
      {
        key: "station",
        header: t("menu.station"),
        secondary: true,
        render: (row) => {
          const station = labelOf(STATION_TYPE, row.stationType);
          return <Badge tone={station.tone}>{tx(station.label)}</Badge>;
        },
      },
      {
        key: "prepTimeSeconds",
        header: t("menu.prepTime"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatDuration(row.prepTimeSeconds, fmt),
      },
      {
        key: "remainingSellable",
        header: t("menu.remainingSellable"),
        numeric: true,
        hint: t("menu.remainingHint"),
        render: (row) =>
          row.remainingSellable === null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span
              className={cx(
                row.remainingSellable === 0 && "text-bad font-semibold",
                row.remainingSellable > 0 && row.remainingSellable <= 5 && "text-warn",
              )}
            >
              {formatNumber(row.remainingSellable, fmt)}
            </span>
          ),
      },
      {
        key: "available",
        header: t("menu.availability"),
        render: (row) => (
          <Badge tone={row.available ? "good" : "bad"} dot>
            {row.available ? t("menu.available") : t("menu.unavailable")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt, categories],
  );

  return (
    <>
      <PageHeader
        title={t("menu.itemsTitle")}
        subtitle={t("menu.itemsSubtitle")}
        spec="FR-MNU-005"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("menu.itemsTitle")} value={formatNumber(collection.total, fmt)} />
          <MetricTile
            label={t("menu.unavailable")}
            value={formatNumber(totals.unavailable, fmt)}
            spec="FR-MNU-030"
          />
          <MetricTile
            label={t("menu.lowRemaining")}
            value={formatNumber(totals.lowStock, fmt)}
            spec="FR-MNU-033"
            hint={t("menu.remainingHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("menu.searchPlaceholder")}
          filters={[
            {
              key: "categoryId",
              label: t("common.category"),
              options: categories.map((category) => ({
                value: category.id,
                label: tx(category.name),
              })),
            },
            {
              key: "available",
              label: t("menu.availability"),
              options: [
                { value: "true", label: t("menu.available") },
                { value: "false", label: t("menu.unavailable") },
              ],
            },
            {
              key: "stationType",
              label: t("menu.station"),
              options: Object.entries(STATION_TYPE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "taxClass",
              label: t("menu.taxClass"),
              options: Object.entries(TAX_CLASS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("menu.itemsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ItemDrawer
        item={selected}
        canToggle={canToggle}
        categories={categories}
        onClose={() => setSelected(null)}
        onRestore={(item) => setAvailability(item, true)}
        onRequest86={(item) => setPending86(item)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
      />

      <NewItemDrawer
        open={creating}
        categories={categories}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setMessage(t("menu.itemCreated"));
          collection.reload();
        }}
      />

      <Eighty6Modal
        item={pending86}
        onCancel={() => setPending86(null)}
        onConfirm={(item, reason) => setAvailability(item, false, reason)}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Items are priced per variant; the list shows the range, not the first one. */
function VariantPrice({ item }: { item: MenuItem }) {
  const { t, fmt } = useI18n();

  if (item.isOpenPrice) return <span className="text-fg-muted text-xs">{t("menu.openPrice")}</span>;
  if (item.variants.length === 0) return <span className="text-fg-subtle">—</span>;

  const amounts = item.variants.map((variant) => variant.basePrice.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const currency = item.variants[0]!.basePrice.currency;

  if (low === high) return <>{formatMoney({ amount: low, currency }, fmt)}</>;

  return (
    <span className="whitespace-nowrap">
      {formatMoney({ amount: low, currency }, fmt)} –{" "}
      {formatMoney({ amount: high, currency }, fmt)}
    </span>
  );
}

// ---------------------------------------------------------------------------

function ItemDrawer({
  item,
  canToggle,
  categories,
  onClose,
  onRestore,
  onRequest86,
  onChanged,
}: {
  item: MenuItem | null;
  canToggle: boolean;
  categories: MenuCategory[];
  onClose: () => void;
  onRestore: (item: MenuItem) => void;
  onRequest86: (item: MenuItem) => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("menu.manage");
  const action = useAction();
  const [addingVariant, setAddingVariant] = useState(false);

  /**
   * The list row carries no variants — `GET /catalogue/items` returns none,
   * they hang off `/items/{id}/variants`. `items.get()` fans those calls
   * out, so the drawer refetches rather than rendering the list's stub.
   */
  const detail = useAsync(
    async () => (item ? services.catalogue.items.get(item.id) : null),
    [item?.id],
  );

  if (!item) return null;

  const current = detail.data ?? item;
  const tax = labelOf(TAX_CLASS, current.taxClass);
  const station = labelOf(STATION_TYPE, current.stationType);

  async function place(categoryId: string) {
    if (!item) return;
    await action.run(() => services.catalogue.placeItem(item.id, categoryId), {
      onSuccess: () => {
        detail.reload();
        onChanged(t("menu.itemPlaced"));
      },
    });
  }

  async function toggleVariant(variantId: string, next: boolean) {
    await action.run(() => services.catalogue.setVariantActive(variantId, next), {
      onSuccess: () => {
        detail.reload();
        onChanged(next ? t("menu.variantActivated") : t("menu.variantDeactivated"));
      },
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${current.imageEmoji} ${tx(current.name)}`}
      subtitle={tx(current.description) || undefined}
      footer={
        canToggle ? (
          current.available ? (
            <Button variant="danger" icon={<Ban size={14} />} onClick={() => onRequest86(item)}>
              {t("menu.toggle86")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<CheckCircle2 size={14} />}
              onClick={() => onRestore(item)}
            >
              {t("menu.toggleAvailable")}
            </Button>
          )
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {!current.available && current.unavailableReason ? (
          <Callout tone="bad" title={t("menu.unavailable")}>
            {current.unavailableReason}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("menu.kitchenName")}>{tx(current.kitchenName)}</DescRow>
          <DescRow label={t("menu.receiptName")}>{tx(current.receiptName)}</DescRow>
          <DescRow label={t("menu.station")}>
            <Badge tone={station.tone}>{tx(station.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.taxClass")}>
            <Badge tone={tax.tone}>{tx(tax.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.prepTime")} mono>
            {formatDuration(current.prepTimeSeconds, fmt)}
          </DescRow>
          <DescRow label={t("menu.remainingSellable")} mono>
            {current.remainingSellable === null
              ? "—"
              : formatNumber(current.remainingSellable, fmt)}
          </DescRow>
          <DescRow label={t("menu.sortOrder")} mono>
            {formatNumber(current.sortOrder, fmt)}
          </DescRow>
        </DescList>

        {canManage ? (
          <Field label={t("menu.category")} hint={t("menu.placementHint")}>
            <Select
              value={current.categoryId}
              disabled={action.pending}
              onChange={(event) => place(event.target.value)}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {tx(category.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-fg text-sm font-semibold">{t("menu.variants")}</h3>
            {canManage ? (
              <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAddingVariant(true)}>
                {t("common.add")}
              </Button>
            ) : null}
          </div>

          {current.variants.length === 0 ? (
            <Callout tone="muted">{t("menu.noVariants")}</Callout>
          ) : (
            <ul className="divide-line divide-y">
              {current.variants.map((variant) => (
                <li key={variant.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-fg truncate text-sm">{tx(variant.name)}</p>
                    {variant.barcode ? (
                      <p className="text-fg-subtle mt-0.5 font-mono text-xs" dir="ltr">
                        {variant.barcode}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!variant.available ? <Badge tone="bad">{t("menu.unavailable")}</Badge> : null}
                    <span className="text-fg font-mono text-sm tabular-nums">
                      {formatMoney(variant.basePrice, fmt)}
                    </span>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        disabled={action.pending}
                        onClick={() => toggleVariant(variant.id, !variant.available)}
                      >
                        {variant.available ? t("common.deactivate") : t("common.activate")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ModifierGroupLinker
          itemId={current.id}
          canManage={canManage}
          onLinked={() => onChanged(t("menu.groupLinked"))}
        />

        <NewVariantDrawer
          open={addingVariant}
          itemId={current.id}
          currency={current.variants[0]?.basePrice.currency ?? "EGP"}
          onClose={() => setAddingVariant(false)}
          onCreated={() => {
            setAddingVariant(false);
            detail.reload();
            onChanged(t("menu.variantAdded"));
          }}
        />

        {current.allergens.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.allergens")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {current.allergens.map((allergen) => (
                <Badge key={allergen} tone="warn">
                  {allergen}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {current.isCombo ? <Badge tone="accent">{t("nav.combos")}</Badge> : null}
          {current.isOpenPrice ? <Badge tone="muted">{t("menu.openPrice")}</Badge> : null}
          {current.isWeighed ? <Badge tone="muted">{t("menu.weighed")}</Badge> : null}
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** An 86 without a reason is untraceable an hour later, so the reason is required. */
function Eighty6Modal({
  item,
  onCancel,
  onConfirm,
}: {
  item: MenuItem | null;
  onCancel: () => void;
  onConfirm: (item: MenuItem, reason: string) => void;
}) {
  const { t, tx } = useI18n();
  const [reason, setReason] = useState("");

  if (!item) return null;

  const trimmed = reason.trim();

  return (
    <Modal
      open
      onClose={onCancel}
      title={`${t("menu.toggle86")} — ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            disabled={trimmed.length === 0}
            onClick={() => {
              onConfirm(item, trimmed);
              setReason("");
            }}
          >
            {t("menu.toggle86")}
          </Button>
        </>
      }
    >
      <Field label={t("menu.86Reason")} required>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("menu.86Placeholder")}
        />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-MNU-010 — attach a reusable modifier group to this item.
 *
 * The API has no endpoint to read an item's attached groups back, only one
 * to attach. So this lists the tenant's groups and confirms the attachment,
 * rather than claiming to show current state it cannot see.
 */
function ModifierGroupLinker({
  itemId,
  canManage,
  onLinked,
}: {
  itemId: string;
  canManage: boolean;
  onLinked: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [groupId, setGroupId] = useState("");

  const groups = useAsync(() => services.catalogue.modifierGroups.list({ limit: 200 }), []);

  if (!canManage) return null;

  async function link() {
    if (!groupId) return;
    await action.run(() => services.catalogue.linkModifierGroup(itemId, groupId), {
      onSuccess: () => {
        setGroupId("");
        onLinked();
      },
    });
  }

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.modifierGroups")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <AsyncPanel state={groups} isEmpty={(page) => page.rows.length === 0}>
        {(page) => (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={t("menu.attachGroup")} hint={t("menu.attachGroupHint")}>
                <Select
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  disabled={action.pending}
                >
                  <option value="">—</option>
                  {page.rows.map((group) => (
                    <option key={group.id} value={group.id}>
                      {tx(group.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button
              variant="secondary"
              disabled={!groupId || action.pending}
              loading={action.pending}
              onClick={link}
            >
              {t("common.add")}
            </Button>
          </div>
        )}
      </AsyncPanel>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** FR-MNU-006 — a sellable size or portion of an item. */
function NewVariantDrawer({
  open,
  itemId,
  currency,
  onClose,
  onCreated,
}: {
  open: boolean;
  itemId: string;
  currency: MenuItemVariant["basePrice"]["currency"];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      () =>
        services.catalogue.addVariant(itemId, {
          name: { en: name.trim(), ar: name.trim() },
          barcode: barcode.trim() || null,
          basePrice: { amount: 0, currency },
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newVariant")}
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

        <Callout tone="muted">{t("menu.variantPriceNote")}</Callout>

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("menu.barcode")}>
          <Input
            dir="ltr"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            maxLength={64}
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** `POST /catalogue/items`, then `POST /items/{id}/placements` for its category. */
function NewItemDrawer({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: MenuCategory[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [kitchenName, setKitchenName] = useState("");
  const [categoryId, setCategoryId] = useState("");

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      async () => {
        const created = await services.catalogue.items.create({
          name: { en: name.trim(), ar: name.trim() },
          kitchenName: kitchenName.trim()
            ? { en: kitchenName.trim(), ar: kitchenName.trim() }
            : undefined,
        });
        // C-02 — an item is only reachable on a menu once it is placed in a
        // category, so the two calls belong to one user action.
        if (categoryId) await services.catalogue.placeItem(created.id, categoryId);
        return created;
      },
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newItem")}
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

        <Field label={t("menu.kitchenName")} hint={t("menu.kitchenNameHint")}>
          <Input
            value={kitchenName}
            onChange={(event) => setKitchenName(event.target.value)}
            maxLength={120}
          />
        </Field>

        <Field label={t("menu.category")} hint={t("menu.placementHint")}>
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {tx(category.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Drawer>
  );
}
