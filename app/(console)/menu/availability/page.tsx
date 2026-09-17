"use client";

/**
 * Availability board — SRS §10.5, FR-MNU-030 … FR-MNU-035.
 *
 * One screen for the question a shift manager asks every hour: what can we
 * not sell right now, why, and when does that change?
 *
 *  - **86 with a re-enable time** (FR-MNU-030). The 86 and its time are sent
 *    to `POST /catalogue/availability-rules/{id}/86`, per branch.
 *  - **Remaining sellable** (FR-MNU-033), from the recipe against stock.
 *  - **Daily limits** (FR-MNU-035). No catalogue field exists for a limit, so
 *    the limit is held by the console and the count sold is read from real
 *    orders; at zero the console disables the item through the real 86.
 *  - **Overrides** (FR-MNU-032). Automatic unavailability — stock-out or a
 *    spent limit — may be set aside by someone authorised, and never
 *    silently: the override carries a reason, an end, and the name of whoever
 *    granted it.
 *  - **Aggregators** (FR-MNU-034). What the console can honestly say about
 *    whether a change has reached each platform, which is less than a green
 *    tick: the connectors report their last success, not per-item delivery.
 *
 * The automatic parts (limit reached, limit reset next day, due re-enables)
 * are enforced by this page while someone with toggle permission has it
 * open. The screen says so rather than implying a server job exists.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CheckCircle2, Gauge, ShieldCheck } from "lucide-react";

import type { Branch, Id, Integration, MenuItem, Order } from "@/lib/console/types";
import type { AutomaticCause, AvailabilityEvent, DailyLimit } from "@/lib/console/services/menu-availability";
import { dailyLimitId } from "@/lib/console/services/menu-availability";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { BUSINESS_DAY } from "@/lib/console/mock/clock";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import {
  describeItem,
  planEnforcement,
  propagationState,
  soldOn,
  type ItemAvailability,
  type PropagationState,
} from "@/lib/console/menu-availability";
import { useActor } from "@/lib/console/menu-price-actions";
import { localDateTimeValue } from "@/components/console/menu-price-tools";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate, UnsupportedPanel, isUnsupported } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Drawer,
  Field,
  Input,
  Select,
  Tabs,
  Textarea,
  Toast,
  Toggle,
  cx,
} from "@/components/console/ui";

export default function MenuAvailabilityPage() {
  return (
    <Gate permissions={["menu.availability.read"]}>
      <AvailabilityScreen />
    </Gate>
  );
}

/** The trading day the board counts sales against. The demo data sits on a fixed anchor day. */
function currentBusinessDay(): string {
  if (DATA_MODE !== "http") return BUSINESS_DAY;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

type Filter = "all" | "unavailable" | "limited" | "automatic";

function AvailabilityScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canToggle = usePermission("menu.availability.toggle");
  const canManage = usePermission("menu.item.manage");
  // FR-MNU-032 — setting aside an automatic rule is a manager act, not a toggle.
  const canOverride = canToggle && canManage;
  const actor = useActor();
  const now = useNow();
  const businessDay = currentBusinessDay();

  const [branchId, setBranchId] = useState<Id | "">(scope.branchId ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"board" | "log" | "aggregators">("board");
  const [nonce, setNonce] = useState(0);
  const [message, setMessage] = useTransientMessage();

  const [eightySix, setEightySix] = useState<ItemAvailability | null>(null);
  const [limitFor, setLimitFor] = useState<ItemAvailability | null>(null);
  const [overrideFor, setOverrideFor] = useState<ItemAvailability | null>(null);

  const data = useAsync(async () => {
    const [items, orders, limits, events] = await Promise.all([
      services.catalogue.items.list({ limit: 1000, scope }).then((page) => page.rows),
      services.sales.orders
        .list({ limit: 1000, scope })
        .then((page) => page.rows)
        .catch(() => null as Order[] | null),
      services.menuAvailability.limits.all(),
      services.menuAvailability.events.all(),
    ]);
    return { items, orders, limits, events };
  }, [scope.tenantId, scope.brandId, scope.branchId, nonce]);

  const branch = branchId || null;

  const rows = useMemo<ItemAvailability[]>(() => {
    if (!data.data) return [];
    const sold = soldOn(data.data.orders ?? [], businessDay, branch);
    return data.data.items.map((item) =>
      describeItem(item, { limits: data.data!.limits, sold, events: data.data!.events, branchId: branch, now, businessDay }),
    );
  }, [data.data, businessDay, branch, now]);

  // -- Enforcement ---------------------------------------------------------
  const enforcing = useRef(false);
  useEffect(() => {
    if (!canToggle || enforcing.current || rows.length === 0) return;
    const actions = planEnforcement(rows, businessDay);
    if (actions.length === 0) return;
    enforcing.current = true;

    void (async () => {
      let done = 0;
      for (const action of actions) {
        const { item, limit } = action.row;
        try {
          if (action.kind === "reenable") {
            // FR-MNU-030: automatic re-enable time reached.
            await services.catalogue.toggleAvailability(item.id, true, undefined, { branchId: branch });
            await services.menuAvailability.log({
              kind: "auto_reenabled", itemId: item.id, itemName: item.name, branchId: branch,
              reason: null, cause: null, overrideUntil: null, extraQuantity: null,
              autoReenableAt: item.autoReenableAt ?? null, actor,
            });
          } else if (action.kind === "limit_disable" && limit) {
            // FR-MNU-035: auto-disable at zero.
            await services.catalogue.toggleAvailability(item.id, false, t("mna.limitReachedReason"), { branchId: branch });
            await services.menuAvailability.limits.update(limit.id, { disabledOn: businessDay });
            await services.menuAvailability.log({
              kind: "limit_disabled", itemId: item.id, itemName: item.name, branchId: branch,
              reason: t("mna.limitReachedReason"), cause: "daily_limit", overrideUntil: null, extraQuantity: null,
              autoReenableAt: null, actor,
            });
          } else if (action.kind === "limit_reset" && limit) {
            await services.catalogue.toggleAvailability(item.id, true, undefined, { branchId: branch });
            await services.menuAvailability.limits.update(limit.id, { disabledOn: null });
            await services.menuAvailability.log({
              kind: "limit_reset", itemId: item.id, itemName: item.name, branchId: branch,
              reason: null, cause: "daily_limit", overrideUntil: null, extraQuantity: null, autoReenableAt: null, actor,
            });
          }
          done += 1;
        } catch {
          // Left for the next pass; the row still shows why.
        }
      }
      enforcing.current = false;
      if (done > 0) {
        setMessage(t("mna.enforced").replace("{count}", formatNumber(done, fmt)));
        setNonce((n) => n + 1);
      }
    })();
  }, [rows, canToggle, businessDay, branch, actor, t, fmt, setMessage]);

  const visible = rows.filter((row) => {
    if (search && !`${row.item.name.en} ${row.item.name.ar}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "unavailable") return !row.item.available;
    if (filter === "limited") return Boolean(row.limit?.active);
    if (filter === "automatic") return row.automatic !== null || row.override !== null;
    return true;
  });

  const totals = {
    unavailable: rows.filter((row) => !row.item.available).length,
    limited: rows.filter((row) => row.limit?.active).length,
    automatic: rows.filter((row) => row.automatic !== null).length,
    overrides: rows.filter((row) => row.override !== null).length,
  };

  async function restore(row: ItemAvailability) {
    try {
      await services.catalogue.toggleAvailability(row.item.id, true, undefined, { branchId: branch });
      await services.menuAvailability.log({
        kind: "restore", itemId: row.item.id, itemName: row.item.name, branchId: branch,
        reason: null, cause: null, overrideUntil: null, extraQuantity: null, autoReenableAt: null, actor,
      });
      setMessage(t("menu.restored"));
      setNonce((n) => n + 1);
    } catch {
      setMessage(t("state.errorTitle"));
    }
  }

  const columns: Column<ItemAvailability>[] = [
    {
      key: "item",
      header: t("menu.itemName"),
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="text-base leading-none">
            {row.item.imageEmoji}
          </span>
          <CellStack primary={tx(row.item.name)} secondary={row.item.unavailableReason ?? undefined} />
        </div>
      ),
    },
    {
      key: "availability",
      header: t("menu.availability"),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={row.item.available ? "good" : "bad"} dot>
            {row.item.available ? t("menu.available") : t("menu.unavailable")}
          </Badge>
          {!row.item.available && row.item.autoReenableAt ? (
            <Badge tone={row.reenableDue ? "warn" : "muted"}>
              {t("mna.backAt").replace("{time}", formatRelative(row.item.autoReenableAt, fmt))}
            </Badge>
          ) : null}
          {row.automatic ? <Badge tone="warn">{t(`mna.cause.${row.automatic}` as never)}</Badge> : null}
          {row.override ? <Badge tone="accent">{t("mna.overridden")}</Badge> : null}
        </span>
      ),
    },
    {
      key: "remainingSellable",
      header: t("menu.remainingSellable"),
      numeric: true,
      hint: t("menu.remainingHint"),
      // FR-MNU-033: remaining sellable quantity in the console.
      render: (row) =>
        row.item.remainingSellable === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className={cx(row.item.remainingSellable === 0 && "text-bad font-semibold", row.item.remainingSellable > 0 && row.item.remainingSellable <= 5 && "text-warn")}>
            {formatNumber(row.item.remainingSellable, fmt)}
          </span>
        ),
    },
    {
      key: "limit",
      header: t("mna.dailyLimit"),
      numeric: true,
      hint: t("mna.dailyLimitHint"),
      render: (row) =>
        row.limit?.active ? (
          <span className="whitespace-nowrap">
            <span className="text-fg-subtle">
              {formatNumber(row.sold, fmt)}/{formatNumber(row.limit.limit, fmt)}
            </span>{" "}
            <span className={cx("font-semibold", (row.remainingToday ?? 0) <= 0 ? "text-bad" : (row.remainingToday ?? 0) <= 3 ? "text-warn" : "text-fg")}>
              {t("mna.left").replace("{count}", formatNumber(Math.max(0, row.remainingToday ?? 0), fmt))}
            </span>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap justify-end gap-1">
          {canToggle ? (
            row.item.available ? (
              <Button size="sm" variant="ghost" icon={<Ban size={12} />} onClick={() => setEightySix(row)}>
                {t("menu.toggle86")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<CheckCircle2 size={12} />} onClick={() => void restore(row)}>
                {t("menu.toggleAvailable")}
              </Button>
            )
          ) : null}
          {canManage ? (
            <Button size="sm" variant="ghost" icon={<Gauge size={12} />} onClick={() => setLimitFor(row)}>
              {t("mna.limit")}
            </Button>
          ) : null}
          {canOverride && (row.automatic || (row.item.remainingSellable === 0 && !row.override)) ? (
            <Button size="sm" variant="ghost" icon={<ShieldCheck size={12} />} onClick={() => setOverrideFor(row)}>
              {t("mna.override")}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("mna.title")} subtitle={t("mna.subtitle")} spec="FR-MNU-030" />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile label={t("menu.unavailable")} value={formatNumber(totals.unavailable, fmt)} spec="FR-MNU-030" />
          <MetricTile label={t("mna.limitedItems")} value={formatNumber(totals.limited, fmt)} spec="FR-MNU-035" />
          <MetricTile label={t("mna.automaticNow")} value={formatNumber(totals.automatic, fmt)} />
          <MetricTile label={t("mna.overridesActive")} value={formatNumber(totals.overrides, fmt)} spec="FR-MNU-032" />
        </TileGrid>

        <Callout tone="muted">{t("mna.enforcementNote").replace("{day}", businessDay)}</Callout>
        {data.data && data.data.orders === null ? <Callout tone="warn">{t("mna.noOrders")}</Callout> : null}

        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "board" as const, label: t("mna.board") },
            { value: "log" as const, label: t("mna.log") },
            { value: "aggregators" as const, label: t("mna.aggregators") },
          ]}
        />

        {tab === "board" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("mnp.list.branch")}>
                <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">{t("mna.allBranches")}</option>
                  {branches.map((row: Branch) => (
                    <option key={row.id} value={row.id}>
                      {tx(row.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("common.status")}>
                <Select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                  <option value="all">{t("mna.filterAll")}</option>
                  <option value="unavailable">{t("menu.unavailable")}</option>
                  <option value="limited">{t("mna.limitedItems")}</option>
                  <option value="automatic">{t("mna.automaticNow")}</option>
                </Select>
              </Field>
              <Field label={t("common.search")}>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} />
              </Field>
            </div>
            {branch && DATA_MODE !== "http" ? <Callout tone="muted">{t("mna.demoBranchNote")}</Callout> : null}

            <AsyncPanel state={data}>
              {() => <DataTable columns={columns} rows={visible} rowKey={(row) => row.item.id} caption={t("mna.board")} dense />}
            </AsyncPanel>
          </>
        ) : null}

        {tab === "log" ? <EventLog events={data.data?.events ?? []} /> : null}
        {tab === "aggregators" ? <AggregatorPropagation events={data.data?.events ?? []} now={now} /> : null}
      </PageBody>

      {eightySix ? (
        <EightySixDrawer
          row={eightySix}
          branchId={branch}
          onClose={() => setEightySix(null)}
          onDone={() => {
            setEightySix(null);
            setMessage(t("menu.eightySixed"));
            setNonce((n) => n + 1);
          }}
        />
      ) : null}
      {limitFor ? (
        <LimitDrawer
          row={limitFor}
          branchId={branch}
          onClose={() => setLimitFor(null)}
          onDone={(note) => {
            setLimitFor(null);
            setMessage(note);
            setNonce((n) => n + 1);
          }}
        />
      ) : null}
      {overrideFor ? (
        <OverrideDrawer
          row={overrideFor}
          branchId={branch}
          businessDay={businessDay}
          onClose={() => setOverrideFor(null)}
          onDone={() => {
            setOverrideFor(null);
            setMessage(t("mna.overrideRecorded"));
            setNonce((n) => n + 1);
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-030 — 86 with an optional re-enable time
// ---------------------------------------------------------------------------

function EightySixDrawer({
  row,
  branchId,
  onClose,
  onDone,
}: {
  row: ItemAvailability;
  branchId: Id | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const actor = useActor();
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"none" | "30" | "60" | "180" | "custom">("none");
  const [custom, setCustom] = useState(() => localDateTimeValue(new Date(Date.now() + 2 * 3600_000)));

  const reenableAt = (() => {
    if (mode === "none") return null;
    if (mode === "custom") {
      const date = new Date(custom);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return new Date(Date.now() + Number(mode) * 60_000).toISOString();
  })();
  const customInvalid = mode === "custom" && (!reenableAt || new Date(reenableAt).getTime() <= Date.now());
  const valid = reason.trim().length > 0 && !customInvalid;

  async function submit() {
    if (!valid) return;
    await action.run(
      async () => {
        await services.catalogue.toggleAvailability(row.item.id, false, reason.trim(), { autoReenableAt: reenableAt, branchId });
        await services.menuAvailability.log({
          kind: "eighty_six", itemId: row.item.id, itemName: row.item.name, branchId,
          reason: reason.trim(), cause: null, overrideUntil: null, extraQuantity: null, autoReenableAt: reenableAt, actor,
        });
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("menu.toggle86")} — ${tx(row.item.name)}`}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" loading={action.pending} disabled={!valid} onClick={() => void submit()}>
            {t("menu.toggle86")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field label={t("menu.86Reason")} required>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("menu.86Placeholder")} />
        </Field>
        <Field label={t("mna.reenable")} hint={t("mna.reenableHint")}>
          <Select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="none">{t("mna.reenableNever")}</option>
            <option value="30">{t("mna.reenable30")}</option>
            <option value="60">{t("mna.reenable60")}</option>
            <option value="180">{t("mna.reenable180")}</option>
            <option value="custom">{t("mna.reenableCustom")}</option>
          </Select>
        </Field>
        {mode === "custom" ? (
          <Field label={t("mna.reenableAt")} error={customInvalid ? t("mnp.effectiveFuture") : null} required>
            <Input type="datetime-local" dir="ltr" value={custom} onChange={(event) => setCustom(event.target.value)} />
          </Field>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-035 — daily quantity limit
// ---------------------------------------------------------------------------

function LimitDrawer({
  row,
  branchId,
  onClose,
  onDone,
}: {
  row: ItemAvailability;
  branchId: Id | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const actor = useActor();
  const confirm = useConfirm();
  const own = row.limit && row.limit.branchId === branchId ? row.limit : null;
  const [limit, setLimit] = useState(own ? String(own.limit) : "20");
  const [active, setActive] = useState(own?.active ?? true);

  const value = Number(limit);
  const valid = Number.isInteger(value) && value > 0;

  async function save() {
    if (!valid) return;
    await action.run(
      () =>
        services.menuAvailability.setLimit({
          itemId: row.item.id,
          itemName: row.item.name,
          branchId,
          limit: value,
          active,
          updatedBy: actor,
        }),
      { onSuccess: () => onDone(t("mna.limitSaved")) },
    );
  }

  async function remove() {
    if (!own) return;
    const ok = await confirm({
      title: t("mna.removeLimitTitle"),
      body: t("mna.removeLimitBody").replace("{item}", tx(row.item.name)),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.menuAvailability.limits.remove(dailyLimitId(row.item.id, branchId)), {
      onSuccess: () => onDone(t("mna.limitRemoved")),
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("mna.dailyLimit")} — ${tx(row.item.name)}`}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void save()}>
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </div>
          {own ? (
            <Button variant="danger" onClick={() => void remove()}>
              {t("common.delete")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{branchId ? t("mna.limitBranchScope") : t("mna.limitAllScope")}</Callout>
        {row.limit && row.limit !== own ? (
          <Callout tone="muted">
            {t("mna.inheritedLimit").replace("{limit}", formatNumber(row.limit.limit, fmt))}
          </Callout>
        ) : null}
        <Field label={t("mna.portionsPerDay")} required>
          <Input dir="ltr" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </Field>
        <Toggle checked={active} onChange={setActive} label={t("mna.limitActive")} hint={t("mna.limitActiveHint")} />
        <p className="text-fg-subtle text-xs">
          {t("mna.soldToday").replace("{count}", formatNumber(row.sold, fmt))}
        </p>
        <Callout tone="warn">{t("mna.limitHonesty")}</Callout>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-032 — authorised override of automatic unavailability
// ---------------------------------------------------------------------------

function OverrideDrawer({
  row,
  branchId,
  businessDay,
  onClose,
  onDone,
}: {
  row: ItemAvailability;
  branchId: Id | null;
  businessDay: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const actor = useActor();
  const cause: AutomaticCause =
    row.automatic ?? (row.limit?.active && (row.remainingToday ?? 1) <= 0 ? "daily_limit" : "stock_out");
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState("5");
  const [until, setUntil] = useState<"day" | "custom">("day");
  const [custom, setCustom] = useState(() => localDateTimeValue(new Date(Date.now() + 2 * 3600_000)));

  const extraNumber = Number(extra);
  const customIso = (() => {
    const date = new Date(custom);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  })();
  const valid =
    reason.trim().length >= 5 &&
    (cause !== "daily_limit" || (Number.isInteger(extraNumber) && extraNumber > 0)) &&
    (until === "day" || (customIso !== null && new Date(customIso).getTime() > Date.now()));

  async function submit() {
    if (!valid) return;
    await action.run(
      async () => {
        // The underlying toggle is real and audited by the server; the
        // override record says why it was allowed.
        if (!row.item.available) {
          await services.catalogue.toggleAvailability(row.item.id, true, reason.trim(), { branchId });
        }
        await services.menuAvailability.log({
          kind: "override",
          itemId: row.item.id,
          itemName: row.item.name,
          branchId,
          reason: reason.trim(),
          cause,
          overrideUntil: until === "custom" ? customIso : null,
          extraQuantity: cause === "daily_limit" ? extraNumber : null,
          autoReenableAt: null,
          actor,
        });
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("mna.override")} — ${tx(row.item.name)}`}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void submit()}>
            {t("mna.recordOverride")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="warn" title={t(`mna.cause.${cause}` as never)}>
          {cause === "daily_limit" ? t("mna.overrideLimitBody") : t("mna.overrideStockBody")}
        </Callout>
        <Field label={t("mna.overrideReason")} hint={t("mna.overrideReasonHint")} required>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {cause === "daily_limit" ? (
          <Field label={t("mna.extraPortions")} required>
            <Input dir="ltr" inputMode="numeric" value={extra} onChange={(event) => setExtra(event.target.value)} />
          </Field>
        ) : null}
        <Field label={t("mna.overrideUntil")}>
          <Select value={until} onChange={(event) => setUntil(event.target.value as "day" | "custom")}>
            <option value="day">{t("mna.untilDayEnd").replace("{day}", businessDay)}</option>
            <option value="custom">{t("mna.reenableCustom")}</option>
          </Select>
        </Field>
        {until === "custom" ? (
          <Field label={t("mna.overrideUntil")} required>
            <Input type="datetime-local" dir="ltr" value={custom} onChange={(event) => setCustom(event.target.value)} />
          </Field>
        ) : null}
        <p className="text-fg-subtle text-xs">{t("mna.overrideBy").replace("{actor}", actor)}</p>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function EventLog({ events }: { events: AvailabilityEvent[] }) {
  const { t, tx, fmt } = useI18n();
  const rows = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const columns: Column<AvailabilityEvent>[] = [
    { key: "at", header: t("mnp.changedAt"), render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.at, fmt)}</span> },
    { key: "item", header: t("menu.itemName"), render: (row) => tx(row.itemName) },
    {
      key: "kind",
      header: t("mna.event"),
      render: (row) => (
        <Badge tone={row.kind === "override" ? "accent" : row.kind === "eighty_six" || row.kind === "limit_disabled" ? "bad" : "good"}>
          {t(`mna.kind.${row.kind}` as never)}
        </Badge>
      ),
    },
    { key: "reason", header: t("menu.86Reason"), render: (row) => row.reason ?? <span className="text-fg-subtle">—</span> },
    {
      key: "detail",
      header: t("mna.detail"),
      secondary: true,
      render: (row) => (
        <span className="text-fg-muted text-xs">
          {row.autoReenableAt ? t("mna.backAt").replace("{time}", formatDateTime(row.autoReenableAt, fmt)) : ""}
          {row.overrideUntil ? t("mna.untilTime").replace("{time}", formatDateTime(row.overrideUntil, fmt)) : ""}
          {row.extraQuantity ? ` +${formatNumber(row.extraQuantity, fmt)}` : ""}
        </span>
      ),
    },
    { key: "actor", header: t("mnp.changedBy"), render: (row) => <span dir="ltr">{row.actor}</span> },
  ];

  return (
    <Section
      title={t("mna.log")}
      hint={t("mna.logHint")}
      action={
        <ExportButton
          filename="availability-log"
          title={t("mna.log")}
          rows={rows}
          columns={[
            { key: "at", header: "at", value: (row) => row.at },
            { key: "item", header: "item", value: (row) => tx(row.itemName) },
            { key: "branch", header: "branch", value: (row) => row.branchId ?? "" },
            { key: "kind", header: "kind", value: (row) => row.kind },
            { key: "cause", header: "cause", value: (row) => row.cause ?? "" },
            { key: "reason", header: "reason", value: (row) => row.reason ?? "" },
            { key: "until", header: "override_until", value: (row) => row.overrideUntil ?? "" },
            { key: "extra", header: "extra_quantity", value: (row) => row.extraQuantity ?? "" },
            { key: "reenable", header: "auto_reenable_at", value: (row) => row.autoReenableAt ?? "" },
            { key: "actor", header: "actor", value: (row) => row.actor },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <Callout tone="muted">{t("mna.logEmpty")}</Callout>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={t("mna.log")} dense />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-034 — aggregator propagation status
// ---------------------------------------------------------------------------

const PROPAGATION_TONE: Record<PropagationState, "good" | "warn" | "bad" | "muted"> = {
  synced_after: "good",
  waiting: "muted",
  overdue: "warn",
  blocked: "bad",
};

function AggregatorPropagation({ events, now }: { events: AvailabilityEvent[]; now: Date }) {
  const { t, tx, fmt } = useI18n();
  const integrations = useAsync(
    () => services.platform.integrations.list({ limit: 200 }).then((page) => page.rows.filter((row) => row.category === "aggregator")),
    [],
  );

  const changes = [...events]
    .filter((event) => event.kind !== "override" || event.reason)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15);

  if (integrations.error && isUnsupported(integrations.error)) {
    return (
      <Card>
        <CardHeader title={t("mna.aggregators")} spec="FR-MNU-034" />
        <UnsupportedPanel detail={t("mna.aggregatorsUnsupported")} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={t("mna.aggregators")} hint={t("mna.aggregatorsHint")} spec="FR-MNU-034" />
      <AsyncPanel
        state={integrations}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("mna.noAggregators")}</Callout>}
      >
        {(rows: Integration[]) => (
          <div className="mt-3 space-y-4">
            <ul className="grid gap-2 sm:grid-cols-2">
              {rows.map((integration) => (
                <li key={integration.id} className="border-line rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-fg min-w-0 flex-1 truncate text-sm font-medium">{integration.name}</span>
                    <Badge tone={integration.status === "healthy" ? "good" : integration.status === "degraded" ? "warn" : "bad"} dot>
                      {integration.status}
                    </Badge>
                  </div>
                  <p className="text-fg-subtle mt-1 text-xs">
                    {t("mna.lastSuccess").replace(
                      "{time}",
                      integration.lastSuccessAt ? formatRelative(integration.lastSuccessAt, fmt) : "—",
                    )}
                    {integration.circuitOpen ? ` · ${t("mna.circuitOpen")}` : ""}
                    {` · ${t("mna.queue").replace("{count}", formatNumber(integration.queueDepth, fmt))}`}
                  </p>
                </li>
              ))}
            </ul>

            {changes.length === 0 ? (
              <Callout tone="muted">{t("mna.noChanges")}</Callout>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">{t("mna.aggregators")}</caption>
                  <thead>
                    <tr className="text-fg-muted text-start">
                      <th className="px-2 py-1.5 text-start font-medium">{t("menu.itemName")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("mnp.changedAt")}</th>
                      {rows.map((integration) => (
                        <th key={integration.id} className="px-2 py-1.5 text-start font-medium">
                          {integration.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {changes.map((event) => (
                      <tr key={event.id}>
                        <td className="px-2 py-1.5">
                          {tx(event.itemName)} <span className="text-fg-subtle">· {t(`mna.kind.${event.kind}` as never)}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatDateTime(event.at, fmt)}</td>
                        {rows.map((integration) => {
                          const state = propagationState(integration, event.at, now);
                          return (
                            <td key={integration.id} className="px-2 py-1.5">
                              <Badge tone={PROPAGATION_TONE[state]}>{t(`mna.propagation.${state}` as never)}</Badge>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-fg-subtle text-xs leading-relaxed">{t("mna.propagationHonesty")}</p>
          </div>
        )}
      </AsyncPanel>
    </Card>
  );
}


