"use client";

/**
 * Price lists — SRS §10.4, FR-POS-040.
 *
 * Price resolution is a precedence problem, not a lookup. Several lists can
 * cover the same item at the same moment — a tenant base list, a delivery
 * uplift, a weekday happy hour — and the POS takes the highest priority among
 * those currently in force. That is why priority, validity and recurrence are
 * the three columns given the most room: together they *are* the price.
 *
 * The drawer shows the previous price beside the current one where the list
 * carries it, because a price change nobody can see the size of is a price
 * change nobody can review (FR-MNU-025).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { PriceList, PriceListEntry } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { ORDER_TYPE, PRICE_LIST_SCOPE, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
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
  cx,
} from "@/components/console/ui";

export default function MenuPricingPage() {
  return (
    <Gate permissions={["menu.view"]}>
      <PricingScreen />
    </Gate>
  );
}

function PricingScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<PriceList | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<PriceList>(
    (query) => services.catalogue.priceLists.list(query),
    { scope, initialSort: "-priority", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.active).length,
      scheduled: rows.filter((row) => row.recurrence !== null).length,
      entries: rows.reduce((sum, row) => sum + row.entryCount, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<PriceList>[]>(
    () => [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={row.orderTypes
              .map((type) => tx(labelOf(ORDER_TYPE, type).label))
              .join(" · ")}
          />
        ),
      },
      {
        key: "scope",
        header: t("menu.scope"),
        render: (row) => {
          const listScope = labelOf(PRICE_LIST_SCOPE, row.scope);
          return <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>;
        },
      },
      {
        key: "priority",
        header: t("menu.priority"),
        sortable: true,
        numeric: true,
        hint: t("menu.priorityHint"),
        render: (row) => formatNumber(row.priority, fmt),
      },
      {
        key: "validFrom",
        header: t("menu.validity"),
        sortable: true,
        secondary: true,
        render: (row) => (
          <span className="whitespace-nowrap" dir="ltr">
            {formatDate(row.validFrom, fmt)} →{" "}
            {row.validTo ? formatDate(row.validTo, fmt) : "∞"}
          </span>
        ),
      },
      {
        key: "recurrence",
        header: t("menu.recurrence"),
        secondary: true,
        render: (row) =>
          row.recurrence ? (
            <span className="text-fg-muted font-mono text-xs">{row.recurrence}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "entryCount",
        header: t("menu.entries"),
        numeric: true,
        render: (row) => formatNumber(row.entryCount, fmt),
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
        title={t("menu.pricingTitle")}
        subtitle={t("menu.pricingSubtitle")}
        spec="FR-POS-040"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("menu.precedenceNote")}</Callout>

        <TileGrid columns={3}>
          <MetricTile
            label={t("menu.pricingTitle")}
            value={formatNumber(collection.total, fmt)}
            footer={
              <span>
                {formatNumber(totals.active, fmt)} {t("common.active").toLowerCase()}
              </span>
            }
          />
          <MetricTile
            label={t("menu.recurrence")}
            value={formatNumber(totals.scheduled, fmt)}
            spec="FR-MNU-022"
          />
          <MetricTile label={t("menu.entries")} value={formatNumber(totals.entries, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "scope",
              label: t("menu.scope"),
              options: Object.entries(PRICE_LIST_SCOPE).map(([value, entry]) => ({
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
          caption={t("menu.pricingTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <PriceListDrawer
        list={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setMessage(t("menu.priceSaved"));
          collection.reload();
        }}
      />
      <NewPriceListDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setMessage(t("menu.priceListCreated"));
          collection.reload();
        }}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function PriceListDrawer({
  list,
  onClose,
  onChanged,
}: {
  list: PriceList | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [editing, setEditing] = useState<PriceListEntry | null>(null);

  /**
   * Entries are fetched, not read off the list row.
   *
   * `GET /catalogue/price-lists` returns list metadata only — the entries
   * live behind `/price-lists/{id}/entries`, so a drawer that rendered
   * `list.entries` showed an empty table against a real backend no matter
   * how many prices the list held.
   */
  const entries = useAsync(
    async () => (list ? services.catalogue.priceEntries(list.id) : []),
    [list?.id],
  );

  const columns = useMemo<Column<PriceListEntry>[]>(
    () => [
      {
        key: "item",
        header: t("menu.itemName"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "previous",
        header: t("menu.previousPrice"),
        numeric: true,
        secondary: true,
        render: (row) =>
          row.previousPrice ? (
            <span className="text-fg-subtle line-through">
              {formatMoney(row.previousPrice, fmt)}
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "price",
        header: t("menu.price"),
        numeric: true,
        render: (row) => formatMoney(row.price, fmt),
      },
      {
        key: "change",
        header: t("common.variance"),
        numeric: true,
        render: (row) => {
          if (!row.previousPrice || row.previousPrice.amount === 0) {
            return <span className="text-fg-subtle">—</span>;
          }
          const change =
            ((row.price.amount - row.previousPrice.amount) / row.previousPrice.amount) * 100;
          if (change === 0) return <span className="text-fg-subtle">—</span>;
          return (
            <span className={cx(change > 0 ? "text-warn" : "text-good")}>
              {change > 0 ? "+" : ""}
              {formatPercent(change, fmt, 1)}
            </span>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  if (!list) return null;

  const listScope = labelOf(PRICE_LIST_SCOPE, list.scope);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(list.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {t("menu.priority")} {list.priority}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("menu.scope")}>
            <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>
          </DescRow>
          <DescRow label={t("menu.orderTypes")}>
            <span className="flex flex-wrap justify-end gap-1">
              {list.orderTypes.map((type) => {
                const entry = labelOf(ORDER_TYPE, type);
                return (
                  <Badge key={type} tone={entry.tone}>
                    {tx(entry.label)}
                  </Badge>
                );
              })}
            </span>
          </DescRow>
          <DescRow label={t("menu.validity")} mono>
            <span dir="ltr">
              {formatDate(list.validFrom, fmt)} →{" "}
              {list.validTo ? formatDate(list.validTo, fmt) : "∞"}
            </span>
          </DescRow>
          <DescRow label={t("menu.recurrence")} mono>
            {list.recurrence ?? t("common.none")}
          </DescRow>
          <DescRow label={t("menu.entries")} mono>
            {formatNumber(list.entryCount, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("menu.entries")}</h3>
          <AsyncPanel
            state={entries}
            isEmpty={(rows) => rows.length === 0}
            empty={<Callout tone="muted">{t("menu.noEntries")}</Callout>}
          >
            {(rows) => (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => `${row.menuItemId}-${row.variantId}`}
                caption={t("menu.entries")}
                onRowClick={setEditing}
                dense
              />
            )}
          </AsyncPanel>
        </section>

        <PriceEditor
          priceListId={list.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            entries.reload();
            onChanged();
          }}
        />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-MNU-023/024 — set one variant's price within one list.
 *
 * The endpoint is an upsert ("set", not "update"), so the same form serves a
 * new price and a correction. The amount is typed in major units because
 * that is what a person reads off a menu; it is converted to the exact minor
 * integer the API wants before it leaves.
 */
function PriceEditor({
  priceListId,
  entry,
  onClose,
  onSaved,
}: {
  priceListId: string;
  entry: PriceListEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (entry) setAmount((entry.price.amount / 100).toFixed(2));
  }, [entry]);

  if (!entry) return null;

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed >= 0 && amount.trim() !== "";

  async function save() {
    if (!entry || !valid) return;
    await action.run(
      () =>
        services.catalogue.setPrice(priceListId, entry.variantId, {
          amount: Math.round(parsed * 100),
          currency: entry.price.currency,
        }),
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(entry.itemName) || t("menu.price")}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {entry.variantId}
        </span>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field
          label={t("menu.price")}
          hint={`${entry.price.currency} · ${t("menu.priceHint")}`}
          required
        >
          <Input
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <DescList>
          <DescRow label={t("menu.currentPrice")}>{formatMoney(entry.price, fmt)}</DescRow>
        </DescList>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** `POST /catalogue/price-lists` — a new list, scoped and prioritised. */
function NewPriceListDrawer({
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
  const [listScope, setListScope] = useState<"tenant" | "brand" | "branch">("tenant");
  const [priority, setPriority] = useState("10");

  if (!open) return null;

  async function create() {
    if (!name.trim()) return;
    await action.run(
      () =>
        services.catalogue.priceLists.create({
          name: { en: name.trim(), ar: name.trim() },
          scope: listScope,
          priority: Number(priority) || 0,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newPriceList")}
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

        <Field label={t("menu.scope")}>
          <Select
            value={listScope}
            onChange={(event) =>
              setListScope(event.target.value as "tenant" | "brand" | "branch")
            }
          >
            <option value="tenant">{t("menu.scopeTenant")}</option>
            <option value="brand">{t("menu.scopeBrand")}</option>
            <option value="branch">{t("menu.scopeBranch")}</option>
          </Select>
        </Field>

        <Field label={t("menu.priority")} hint={t("menu.priorityHint")}>
          <Input
            inputMode="numeric"
            dir="ltr"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
