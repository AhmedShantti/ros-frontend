"use client";

/**
 * Price lists — SRS §10.4, FR-POS-040, FR-MNU-020 … FR-MNU-026.
 *
 * Price resolution is a precedence problem, not a lookup. Several lists can
 * cover the same item at the same moment — a tenant base list, a delivery
 * uplift, a weekday happy hour — and the POS takes the highest priority among
 * those currently in force. That is why priority, validity and recurrence are
 * the three columns given the most room: together they *are* the price, and
 * the "By order type" tab shows the outcome for one item (FR-MNU-021).
 *
 * Every price written from this page goes through `changePrice`, so each one
 * leaves a history row (FR-MNU-024); every new price is checked against the
 * portion cost and the margin threshold before it is sent (FR-MNU-026); and
 * lists can be changed in bulk or from a CSV, always through a preview
 * (FR-MNU-025).
 */

import { useEffect, useMemo, useState } from "react";
import { FileUp, Percent, Plus, Settings2 } from "lucide-react";
import type { Currency, PriceList, PriceListEntry } from "@/lib/console/types";
import { getDefaultCurrency, services } from "@/lib/console/services";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  currencyExponent,
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  minorFromInput,
  numberFromInput,
  toMajorUnits,
} from "@/lib/console/format";
import { ORDER_TYPE, PRICE_LIST_SCOPE, labelOf } from "@/lib/console/labels";
import { applyDueSchedules, changePrice, useActor, useVariantCosts } from "@/lib/console/menu-price-actions";
import { checkMargin } from "@/lib/console/menu-pricing";
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
  Tabs,
  Toast,
  cx,
} from "@/components/console/ui";
import {
  BulkPriceDrawer,
  EffectiveField,
  MarginWarning,
  PriceHistoryPanel,
  PriceImportDrawer,
  PricingSettingsDrawer,
  ScheduledPricesPanel,
  effectiveInvalid,
  effectiveIso,
  localDateTimeValue,
  usePricingSettings,
  type EffectiveChoice,
} from "@/components/console/menu-price-tools";
import { FranchiseLockNotice, useFranchiseLock } from "@/components/console/franchise-lock";
import {
  BranchGroupsPanel,
  NewPriceListDrawer,
  PriceResolutionPanel,
  RecurrenceText,
  useListGroup,
} from "@/components/console/menu-price-lists";

export default function MenuPricingPage() {
  return (
    <Gate permissions={["menu.price.read"]}>
      <PricingScreen />
    </Gate>
  );
}

type Tab = "lists" | "orderTypes" | "scheduled" | "history" | "groups";

function PricingScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canChange = usePermission("menu.price.change");
  const actor = useActor();
  const [tab, setTab] = useState<Tab>("lists");
  const [selected, setSelected] = useState<PriceList | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, saveSettings] = usePricingSettings();
  const [nonce, setNonce] = useState(0);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<PriceList>(
    (query) => services.catalogue.priceLists.list(query),
    { scope, initialSort: "-priority", pageSize: 25 },
  );

  // Every list, for the resolution preview — the table above is paged.
  const allLists = useAsync(
    () => services.catalogue.priceLists.list({ limit: 500, scope }).then((page) => page.rows),
    [scope.tenantId, scope.brandId, scope.branchId, nonce],
  );

  async function runDue(silent: boolean) {
    const outcome = await applyDueSchedules(actor);
    if (outcome.applied + outcome.failed > 0) {
      setMessage(
        t("mnp.dueApplied")
          .replace("{applied}", formatNumber(outcome.applied, fmt))
          .replace("{failed}", formatNumber(outcome.failed, fmt)),
      );
      collection.reload();
      setNonce((n) => n + 1);
    } else if (!silent) {
      setMessage(t("mnp.nothingDue"));
    }
  }

  // Scheduled prices fall due while nobody is looking; apply them on arrival.
  useEffect(() => {
    if (canChange) void runDue(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canChange]);

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
            secondary={
              row.orderTypes.length > 0
                ? row.orderTypes.map((type) => tx(labelOf(ORDER_TYPE, type).label)).join(" · ")
                : t("mnp.list.allOrderTypes")
            }
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
            {row.validFrom ? formatDate(row.validFrom, fmt) : "—"} →{" "}
            {row.validTo ? formatDate(row.validTo, fmt) : "∞"}
          </span>
        ),
      },
      {
        key: "recurrence",
        header: t("menu.recurrence"),
        secondary: true,
        render: (row) => <RecurrenceText recurrence={row.recurrence} />,
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
        spec="FR-MNU-020"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<Settings2 size={14} />} onClick={() => setSettingsOpen(true)}>
              {t("mnp.settingsTitle")}
            </Button>
            {canChange ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("common.new")}
              </Button>
            ) : null}
          </div>
        }
      />

      <PageBody>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "lists" as const, label: t("menu.pricingTitle") },
            { value: "orderTypes" as const, label: t("mnp.resolve.title") },
            { value: "scheduled" as const, label: t("mnp.scheduledTitle") },
            { value: "history" as const, label: t("mnp.historyTitle") },
            { value: "groups" as const, label: t("mnp.group.title") },
          ]}
        />

        {tab === "lists" ? (
          <>
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
              <MetricTile label={t("menu.recurrence")} value={formatNumber(totals.scheduled, fmt)} spec="FR-MNU-022" />
              <MetricTile
                label={t("mnp.marginThreshold")}
                value={formatPercent(settings.marginThresholdPercent, fmt, 0)}
                spec="FR-MNU-026"
              />
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
          </>
        ) : null}

        {tab === "orderTypes" ? <PriceResolutionPanel lists={allLists.data ?? []} /> : null}

        {tab === "scheduled" ? (
          <ScheduledPricesPanel nonce={nonce} onChanged={setMessage} onApplyDue={() => runDue(false)} />
        ) : null}

        {tab === "history" ? <PriceHistoryPanel nonce={nonce} /> : null}

        {tab === "groups" ? <BranchGroupsPanel onChanged={setMessage} /> : null}
      </PageBody>

      <PriceListDrawer
        list={selected}
        settings={settings}
        nonce={nonce}
        onApplyDue={() => runDue(false)}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          setNonce((n) => n + 1);
          collection.reload();
        }}
      />
      <NewPriceListDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(count) => {
          setCreating(false);
          setMessage(count > 1 ? t("mnp.list.createdMany").replace("{count}", formatNumber(count, fmt)) : t("menu.priceListCreated"));
          setNonce((n) => n + 1);
          collection.reload();
        }}
      />
      <PricingSettingsDrawer
        open={settingsOpen}
        settings={settings}
        currency={getDefaultCurrency()}
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => {
          saveSettings(next);
          setSettingsOpen(false);
          setMessage(t("mnp.settingsSaved"));
        }}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function PriceListDrawer({
  list,
  settings,
  nonce,
  onApplyDue,
  onClose,
  onChanged,
}: {
  list: PriceList | null;
  onApplyDue: () => Promise<void>;
  settings: ReturnType<typeof usePricingSettings>[0];
  nonce: number;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  // FR-BRN-035 — a franchise branch may keep pricing with the brand.
  const lock = useFranchiseLock(list?.scope === "branch" ? list.scopeId : null, "pricing");
  const canChange = usePermission("menu.price.change") && !lock.locked;
  const costs = useVariantCosts();
  const group = useListGroup(list?.id ?? null);
  const [editing, setEditing] = useState<PriceListEntry | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [importing, setImporting] = useState(false);
  const [section, setSection] = useState<"entries" | "history" | "scheduled">("entries");

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
    [list?.id, nonce],
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
            <span className="text-fg-subtle line-through">{formatMoney(row.previousPrice, fmt)}</span>
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
        key: "margin",
        header: t("mnp.margin"),
        numeric: true,
        hint: t("mnp.marginColumnHint"),
        render: (row) => {
          // FR-MNU-026: flag entries already below threshold or cost.
          const check = checkMargin(row.price.amount, costs.costOf(row.variantId, row.menuItemId), settings.marginThresholdPercent);
          if (check.marginPercent === null) return <span className="text-fg-subtle">—</span>;
          return (
            <span className={cx(check.belowCost ? "text-bad font-semibold" : check.belowThreshold ? "text-warn" : "text-good")}>
              {formatPercent(check.marginPercent, fmt, 1)}
            </span>
          );
        },
      },
    ],
    [t, tx, fmt, costs, settings.marginThresholdPercent],
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
      footer={
        canChange ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<Percent size={13} />} onClick={() => setBulk(true)}>
              {t("mnp.bulkTitle")}
            </Button>
            <Button icon={<FileUp size={13} />} onClick={() => setImporting(true)}>
              {t("mnp.importTitle")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <FranchiseLockNotice lock={lock} domain="pricing" />
        <DescList>
          <DescRow label={t("menu.scope")}>
            <span className="flex flex-wrap justify-end gap-1">
              <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>
              {group.data ? <Badge tone="accent">{tx(group.data.name)}</Badge> : null}
            </span>
          </DescRow>
          <DescRow label={t("menu.orderTypes")}>
            <span className="flex flex-wrap justify-end gap-1">
              {list.orderTypes.length === 0 ? (
                <Badge tone="muted">{t("mnp.list.allOrderTypes")}</Badge>
              ) : (
                list.orderTypes.map((type) => {
                  const entry = labelOf(ORDER_TYPE, type);
                  return (
                    <Badge key={type} tone={entry.tone}>
                      {tx(entry.label)}
                    </Badge>
                  );
                })
              )}
            </span>
          </DescRow>
          <DescRow label={t("menu.validity")} mono>
            <span dir="ltr">
              {list.validFrom ? formatDate(list.validFrom, fmt) : "—"} → {list.validTo ? formatDate(list.validTo, fmt) : "∞"}
            </span>
          </DescRow>
          <DescRow label={t("menu.recurrence")}>
            <RecurrenceText recurrence={list.recurrence} />
          </DescRow>
          <DescRow label={t("menu.entries")} mono>
            {formatNumber(list.entryCount, fmt)}
          </DescRow>
        </DescList>

        <Tabs
          value={section}
          onChange={setSection}
          options={[
            { value: "entries" as const, label: t("menu.entries") },
            { value: "history" as const, label: t("mnp.historyTitle") },
            { value: "scheduled" as const, label: t("mnp.scheduledTitle") },
          ]}
        />

        {section === "entries" ? (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-fg text-sm font-semibold">{t("menu.entries")}</h3>
              {canChange ? (
                <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAddingEntry(true)}>
                  {t("menu.newPriceEntry")}
                </Button>
              ) : null}
            </div>
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
                  onRowClick={canChange ? setEditing : undefined}
                  dense
                />
              )}
            </AsyncPanel>
          </section>
        ) : null}

        {section === "history" ? <PriceHistoryPanel priceListId={list.id} nonce={nonce} /> : null}
        {section === "scheduled" ? (
          <ScheduledPricesPanel priceListId={list.id} nonce={nonce} onChanged={onChanged} onApplyDue={onApplyDue} />
        ) : null}

        <PriceEditor
          list={list}
          entry={editing}
          settings={settings}
          cost={editing ? costs.costOf(editing.variantId, editing.menuItemId) : null}
          groupListIds={group.data?.priceListIds ?? []}
          onClose={() => setEditing(null)}
          onSaved={(note) => {
            setEditing(null);
            entries.reload();
            onChanged(note);
          }}
        />

        <NewPriceEntryDrawer
          list={list}
          open={addingEntry}
          settings={settings}
          onClose={() => setAddingEntry(false)}
          onCreated={() => {
            setAddingEntry(false);
            entries.reload();
            onChanged(t("menu.priceSaved"));
          }}
        />

        {bulk ? (
          <BulkPriceDrawer
            list={list}
            settings={settings}
            onClose={() => setBulk(false)}
            onDone={() => {
              entries.reload();
              onChanged(t("mnp.batchDone"));
            }}
          />
        ) : null}
        {importing ? (
          <PriceImportDrawer
            list={list}
            settings={settings}
            onClose={() => setImporting(false)}
            onDone={() => {
              entries.reload();
              onChanged(t("mnp.batchDone"));
            }}
          />
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** True once a typed amount carries more fractional digits than the currency allows. */
function excessPrecision(raw: string, exponent: number): boolean {
  const dot = raw.trim().indexOf(".");
  if (dot === -1) return false;
  return raw.trim().length - dot - 1 > exponent;
}

function futureDefault(): EffectiveChoice {
  return { mode: "now", at: localDateTimeValue(new Date(Date.now() + 24 * 3600_000)) };
}

/**
 * FR-MNU-023/024 — set one variant's price within one list, now or later.
 *
 * The endpoint is an upsert ("set", not "update"), so the same form serves a
 * new price and a correction. The amount is typed in major units because
 * that is what a person reads off a menu; `minorFromInput` — the same
 * decimal-safe shelf-price parser the terminal uses for cash counts — turns
 * it into the exact minor integer the API wants before it leaves.
 */
function PriceEditor({
  list,
  entry,
  settings,
  cost,
  groupListIds,
  onClose,
  onSaved,
}: {
  list: PriceList;
  entry: PriceListEntry | null;
  settings: ReturnType<typeof usePricingSettings>[0];
  cost: number | null;
  groupListIds: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const actor = useActor();
  const [amount, setAmount] = useState("");
  const [effective, setEffective] = useState<EffectiveChoice>(futureDefault);
  const [wholeGroup, setWholeGroup] = useState(false);

  useEffect(() => {
    if (entry) {
      setAmount(toMajorUnits(entry.price).toFixed(currencyExponent(entry.price.currency)));
      setEffective(futureDefault());
      setWholeGroup(false);
    }
  }, [entry]);

  if (!entry) return null;

  const exponent = currencyExponent(entry.price.currency);
  const parsedMajor = numberFromInput(amount);
  const valid = parsedMajor !== null && parsedMajor >= 0 && !excessPrecision(amount, exponent) && !effectiveInvalid(effective);
  const minor = valid ? (minorFromInput(amount) ?? 0) : null;
  const siblings = groupListIds.filter((id) => id !== list.id);

  async function save() {
    if (!entry || minor === null) return;
    const to = { amount: minor, currency: entry.price.currency };
    const effectiveAt = effectiveIso(effective);
    const listIds = [list.id, ...(wholeGroup ? siblings : [])];

    await action.run(
      async () => {
        for (const listId of listIds) {
          const listName =
            listId === list.id ? list.name : ((await services.catalogue.priceLists.get(listId).catch(() => null))?.name ?? list.name);
          const current =
            listId === list.id
              ? entry.price
              : ((await services.catalogue.priceEntries(listId).catch(() => [])).find((row) => row.variantId === entry.variantId)?.price ?? null);
          const target = {
            priceListId: listId,
            priceListName: listName,
            menuItemId: entry.menuItemId,
            variantId: entry.variantId,
            itemName: entry.itemName,
            current,
          };
          if (effectiveAt) {
            await services.menuPricing.schedules.create({
              ...target,
              priceAtScheduling: current,
              price: to,
              effectiveAt,
              createdBy: actor,
            });
          } else {
            await changePrice(target, to, { actor, source: "manual" });
          }
        }
      },
      { onSuccess: () => onSaved(effectiveAt ? t("mnp.scheduled") : t("menu.priceSaved")) },
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
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void save()}>
            {effective.mode === "later" ? t("mnp.schedulePrice") : t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("menu.price")} hint={`${entry.price.currency} · ${t("menu.priceHint")}`} required>
          <Input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>

        {/* FR-MNU-026: warn before a change moves margin below threshold or cost */}
        <MarginWarning price={minor} cost={cost} thresholdPercent={settings.marginThresholdPercent} currency={entry.price.currency} />

        <EffectiveField value={effective} onChange={setEffective} />

        {siblings.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wholeGroup} onChange={(event) => setWholeGroup(event.target.checked)} />
            {t("mnp.applyToGroup").replace("{count}", formatNumber(siblings.length, fmt))}
          </label>
        ) : null}

        <DescList>
          <DescRow label={t("menu.currentPrice")}>{formatMoney(entry.price, fmt)}</DescRow>
        </DescList>

        <PriceHistoryPanel priceListId={list.id} variantId={entry.variantId} />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * DEMO-CATALOGUE-POS-ADD-P0 — the only way to reach `PriceEditor` was to
 * click an existing entry in the table above, which means a variant that
 * has never had a price could never get its first one through this screen:
 * there was no row to click. `setPrice` is a "set" — create or overwrite
 * (FR-MNU-023/024) — so this reaches the same `changePrice` path.
 *
 * Variants do not come back on `GET /catalogue/items` (`ItemDrawer` in
 * `/menu/items` notes the same thing) — they hang off `/items/{id}/variants`
 * — so the variant picker only fills in once an item is chosen.
 */
function NewPriceEntryDrawer({
  list,
  open,
  settings,
  onClose,
  onCreated,
}: {
  list: PriceList;
  open: boolean;
  settings: ReturnType<typeof usePricingSettings>[0];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const actor = useActor();
  const costs = useVariantCosts();
  const currency: Currency = getDefaultCurrency();
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [amount, setAmount] = useState("");

  const items = useAsync(
    async () => (open ? services.catalogue.items.list({ limit: 500 }) : null),
    [open],
  );
  const itemRows = items.data?.rows ?? [];

  const detail = useAsync(
    async () => (itemId ? services.catalogue.items.get(itemId) : null),
    [itemId],
  );
  const variants = detail.data?.variants ?? [];

  useEffect(() => {
    setVariantId("");
  }, [itemId]);

  if (!open) return null;

  const exponent = currencyExponent(currency);
  const parsedMajor = numberFromInput(amount);
  const valid =
    Boolean(itemId) &&
    Boolean(variantId) &&
    parsedMajor !== null &&
    parsedMajor >= 0 &&
    !excessPrecision(amount, exponent);
  const minor = parsedMajor !== null && !excessPrecision(amount, exponent) ? (minorFromInput(amount) ?? null) : null;
  const variant = variants.find((row) => row.id === variantId);

  async function create() {
    if (!valid || !detail.data) return;
    await action.run(
      () =>
        changePrice(
          {
            priceListId: list.id,
            priceListName: list.name,
            menuItemId: itemId,
            variantId,
            itemName: detail.data!.name,
            current: null,
          },
          { amount: minorFromInput(amount) ?? 0, currency },
          { actor, source: "manual" },
        ),
      {
        onSuccess: () => {
          setItemId("");
          setVariantId("");
          setAmount("");
          onCreated();
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newPriceEntry")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void create()}>
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

        <Callout tone="muted">{t("menu.newPriceEntryHint")}</Callout>

        <Field label={t("menu.itemName")} required>
          <Select value={itemId} disabled={items.loading} onChange={(event) => setItemId(event.target.value)}>
            <option value="">—</option>
            {itemRows.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("menu.variants")} required>
          <Select value={variantId} disabled={!itemId || detail.loading} onChange={(event) => setVariantId(event.target.value)}>
            <option value="">—</option>
            {variants.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("menu.price")} hint={`${currency} · ${t("menu.priceHint")}`} required>
          <Input inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>

        {variantId ? (
          <MarginWarning
            price={minor}
            cost={costs.costOf(variantId, itemId, variant?.recipeId)}
            thresholdPercent={settings.marginThresholdPercent}
            currency={currency}
          />
        ) : null}
      </div>
    </Drawer>
  );
}
