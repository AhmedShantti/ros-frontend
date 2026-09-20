"use client";

/**
 * Orders — SRS ch.8.
 *
 * The ledger of what the terminals rang up, with the line detail behind each
 * one. Names, prices and costs are read off the order, never re-derived from
 * the menu (BR-POS-004): a price change tomorrow must not restate what was
 * charged today.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Order } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { useOrderFeed } from "@/lib/console/feeds";
import { useBranches } from "@/lib/console/hooks";
import { services } from "@/lib/console/services";
import { ServiceError } from "@/lib/console/services/types";
import { formatDate, formatMoney, formatTime, money, percentOf } from "@/lib/console/format";
import {
  ORDER_CHANNEL,
  ORDER_LINE_STATE,
  ORDER_STATE,
  ORDER_TYPE,
  SYNC_STATE,
  TENDER_TYPE,
} from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { ErrorPanel } from "@/components/console/states";
import { MetricTile } from "@/components/console/charts";
import {
  Badge,
  Button,
  Callout,
  Drawer,
  DescList,
  DescRow,
  Field,
  IconButton,
  Input,
  Select,
  SegmentedControl,
  SpecTag,
  Tabs,
} from "@/components/console/ui";
import { ReceiptDrawer } from "@/components/terminal/pos-live";

type Filter = "all" | "open" | "completed" | "cancelled";

/** The server's own keyset cursor, synthesised from the last (oldest, since
 * `list()` orders DESC) row of a page this page already has — exactly the
 * `{businessDay, id}` of that row, which is byte-identical to what the
 * server's own `nextCursor` would have been had that row been the page
 * boundary (see `OrdersService.list`: `next.businessDay`/`next.id` of the
 * last row of ITS page). Never re-derived from anywhere else. */
function cursorAfter(rows: Order[]): { businessDay: string; id: string } | null {
  const last = rows[rows.length - 1];
  return last ? { businessDay: last.businessDay, id: last.id } : null;
}

export default function OrdersPage() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Order | null>(null);

  // The tenant's ledger when there is a backend, this device's when there is
  // not — see `lib/console/feeds.ts` for why the screen does not choose.
  const feed = useOrderFeed(scope);
  const branches = useBranches(scope);

  // ORDERS-MODULE-COMPREHENSIVE-P0 — a REAL branch filter (`GET /orders`'s
  // own `branchId` query param), not a client-side narrowing of whatever
  // the feed already fetched: selecting a branch here re-queries the server
  // for that branch's own order history.
  const [branchId, setBranchId] = useState<string>("");
  const [branchRows, setBranchRows] = useState<Order[] | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);

  // ORDERS-MODULE-COMPREHENSIVE-P0 — real cursor pagination: `extraRows`
  // holds pages fetched by "Load older orders", `moreCursor` the server's
  // own `nextCursor` from the last such fetch (or a synthesised one for the
  // very first click — see `cursorAfter`), `moreExhausted` once a fetch
  // comes back with none. All three reset when the branch filter changes,
  // since that changes which server-side history is being paged through.
  const [extraRows, setExtraRows] = useState<Order[]>([]);
  const [moreCursor, setMoreCursor] = useState<{ businessDay: string; id: string } | null>(null);
  const [moreExhausted, setMoreExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  useEffect(() => {
    setExtraRows([]);
    setMoreCursor(null);
    setMoreExhausted(false);
    setLoadMoreError(null);
    if (!branchId) {
      setBranchRows(null);
      return;
    }
    let cancelled = false;
    setBranchLoading(true);
    services.sales
      .listOrderHistoryPage({ branchId, limit: 200 })
      .then((page) => {
        if (cancelled) return;
        setBranchRows(page.orders);
      })
      .catch(() => {
        if (!cancelled) setBranchRows([]);
      })
      .finally(() => {
        if (!cancelled) setBranchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const baseOrders = branchId ? (branchRows ?? []) : feed.rows;
  const orders = useMemo(() => [...baseOrders, ...extraRows], [baseOrders, extraRows]);
  const ready = branchId ? !branchLoading : feed.ready;

  async function handleLoadMore() {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const seed = moreCursor ?? cursorAfter(orders);
      const page = await services.sales.listOrderHistoryPage({
        branchId: branchId || undefined,
        cursor: seed,
        limit: 50,
      });
      setExtraRows((prev) => [...prev, ...page.orders]);
      setMoreCursor(page.nextCursor);
      if (!page.nextCursor) setMoreExhausted(true);
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "open") {
      return orders.filter((o) =>
        ["draft", "open", "held", "parked", "partially_paid"].includes(o.state),
      );
    }
    if (filter === "completed") {
      return orders.filter((o) =>
        ["completed", "partially_refunded", "refunded"].includes(o.state),
      );
    }
    return orders.filter((o) => o.state === "cancelled");
  }, [orders, filter]);

  const totals = useMemo(() => {
    const done = orders.filter((o) => o.state === "completed" || o.state === "partially_refunded");
    const net = done.reduce((s, o) => s + o.grandTotal.amount + o.roundingAdjustment.amount, 0);
    const cogs = done.reduce((s, o) => s + o.cogsTotal.amount, 0);
    const discounts = orders.reduce((s, o) => s + o.discountTotal.amount, 0);
    return {
      count: done.length,
      net,
      cogs,
      discounts,
      average: done.length > 0 ? Math.round(net / done.length) : 0,
    };
  }, [orders]);

  const currency = orders[0]?.currency ?? "EGP";

  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("orders.number"),
      render: (order) => (
        <CellStack
          primary={<span className="font-mono font-medium">{order.orderNumber}</span>}
          secondary={`${formatTime(order.openedAt, fmt)} · ${order.terminalName}`}
        />
      ),
    },
    {
      // ORDERS-MODULE-COMPREHENSIVE-P0 — the permanent Order Reference
      // (orders.id), distinct from the human, branch/day-scoped Order
      // Number above. Abbreviated here; the full ULID is one click away.
      key: "reference",
      header: t("orders.reference"),
      secondary: true,
      render: (order) => <ReferenceCell id={order.id} />,
    },
    {
      key: "businessDay",
      header: t("fin.businessDay"),
      secondary: true,
      render: (order) => formatDate(order.businessDay, fmt),
    },
    {
      key: "branch",
      header: t("common.branch"),
      secondary: true,
      render: (order) => tx(order.branchName),
    },
    {
      key: "type",
      header: t("orders.type"),
      render: (order) => (
        <CellStack
          primary={tx(ORDER_TYPE[order.orderType].label)}
          secondary={order.tableLabel ?? tx(ORDER_CHANNEL[order.channel].label)}
        />
      ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (order) => (
        <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
      ),
    },
    {
      key: "syncState",
      header: t("orders.sync"),
      render: (order) => (
        <Badge tone={SYNC_STATE[order.syncState].tone}>{tx(SYNC_STATE[order.syncState].label)}</Badge>
      ),
      secondary: true,
    },
    {
      key: "lines",
      header: t("orders.lines"),
      numeric: true,
      render: (order) => order.lines.filter((l) => l.state !== "voided").length,
      secondary: true,
    },
    {
      key: "grandTotal",
      header: t("common.total"),
      numeric: true,
      render: (order) =>
        formatMoney(
          money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
          fmt,
        ),
    },
    {
      key: "outstanding",
      header: t("orders.outstanding"),
      numeric: true,
      secondary: true,
      render: (order) => {
        const due = order.grandTotal.amount + order.roundingAdjustment.amount - order.paidTotal.amount;
        return due > 0 ? formatMoney(money(due, order.currency), fmt) : "—";
      },
    },
    {
      key: "margin",
      header: t("orders.margin"),
      numeric: true,
      hint: t("orders.snapshotNote"),
      secondary: true,
      render: (order) => {
        if (order.grandTotal.amount === 0) return "—";
        const gross = order.grandTotal.amount - order.cogsTotal.amount;
        return `${percentOf(money(gross, order.currency), order.grandTotal).toFixed(1)}%`;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        subtitle={t("orders.subtitle")}
        spec="ch.8"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice source={feed.live ? "backend" : "device"} />

        <FindOrderPanel onFound={setSelected} />

        <TileGrid>
          <MetricTile
            label={t("orders.completed")}
            value={String(totals.count)}
            spec="FR-POS-001"
          />
          <MetricTile
            label={t("fin.netSales")}
            value={formatMoney(money(totals.net, currency), fmt)}
          />
          <MetricTile
            label={t("orders.cogs")}
            value={formatMoney(money(totals.cogs, currency), fmt)}
            spec="BR-CST-001"
          />
          <MetricTile
            label={t("dash.aov")}
            value={formatMoney(money(totals.average, currency), fmt)}
          />
        </TileGrid>

        {feed.error ? <ErrorPanel error={feed.error} onRetry={feed.reload} /> : null}

        {!ready || orders.length === 0 ? (
          <LiveEmpty source={feed.live ? "backend" : "device"} />
        ) : (
          <Section title={t("orders.title")}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Tabs
                value={filter}
                onChange={setFilter}
                label={t("common.filter")}
                options={[
                  { value: "all", label: t("common.all"), count: orders.length },
                  { value: "open", label: t("nav.openOrders") },
                  { value: "completed", label: t("orders.completed") },
                  { value: "cancelled", label: tx(ORDER_STATE.cancelled.label) },
                ]}
              />
              {branches.length > 1 ? (
                <Select
                  aria-label={t("common.branch")}
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-48"
                >
                  <option value="">{t("orders.allBranches")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {tx(branch.name)}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(order) => order.id}
              onRowClick={setSelected}
              activeRowKey={selected?.id ?? null}
              caption={t("orders.title")}
            />
            {/* ORDERS-MODULE-COMPREHENSIVE-P0 — real cursor pagination: never
             * loads the whole tenant's history into the browser at once. */}
            {!moreExhausted ? (
              <div className="mt-3 flex flex-col items-center gap-2">
                {loadMoreError ? <ErrorPanel error={loadMoreError} onRetry={handleLoadMore} /> : null}
                <Button variant="ghost" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? t("common.loading") : t("orders.loadMore")}
                </Button>
              </div>
            ) : null}
          </Section>
        )}
      </PageBody>

      {selected ? (
        <OrderDrawer order={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

/**
 * ORDERS-MODULE-COMPREHENSIVE-P0 — abbreviated Order Reference with the full
 * permanent ULID one click away (title tooltip + copy-to-clipboard), never
 * silently truncated with no way to get the real value back out.
 */
function ReferenceCell({ id }: { id: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <span className="text-fg-subtle font-mono text-xs" title={id}>
        {id.slice(0, 8)}…
      </span>
      <IconButton
        label={copied ? t("common.copied") : t("common.copy")}
        icon={copied ? <Check size={12} /> : <Copy size={12} />}
        className="h-6 w-6"
        onClick={async (e) => {
          e.stopPropagation();
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      />
    </div>
  );
}

type SearchMode = "reference" | "number";

/**
 * ORDERS-MODULE-COMPREHENSIVE-P0 — the exact support/history lookups: the
 * permanent Order Reference (exact, single-order) and the human Order
 * Number (NOT globally unique — only within branch + business day, so an
 * ambiguous match is shown as a list to choose from, never guessed at).
 */
function FindOrderPanel({ onFound }: { onFound: (order: Order) => void }) {
  const { t, tx, fmt } = useI18n();
  const [mode, setMode] = useState<SearchMode>("reference");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [matches, setMatches] = useState<Order[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function runSearch() {
    const value = query.trim();
    if (!value) return;
    setSearching(true);
    setError(null);
    setMatches(null);
    setNotFound(false);
    try {
      if (mode === "reference") {
        const order = await services.sales.findOrderByReference(value);
        if (order) onFound(order);
        else setNotFound(true);
      } else {
        const found = await services.sales.searchOrdersByNumber(value);
        if (found.length === 1) onFound(found[0]!);
        else if (found.length === 0) setNotFound(true);
        else setMatches(found);
      }
    } catch (err) {
      if (err instanceof ServiceError && err.status === 404) setNotFound(true);
      else setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Section title={t("orders.findOrder")}>
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          value={mode}
          onChange={(next) => {
            setMode(next);
            setQuery("");
            setMatches(null);
            setNotFound(false);
            setError(null);
          }}
          options={[
            { value: "reference", label: t("orders.searchByReference") },
            { value: "number", label: t("orders.searchByNumber") },
          ]}
        />
        <div className="min-w-[16rem] flex-1">
          <Field label={mode === "reference" ? t("orders.searchByReference") : t("orders.searchByNumber")}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "reference" ? t("orders.referencePlaceholder") : t("orders.numberPlaceholder")
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
            />
          </Field>
        </div>
        <Button variant="primary" onClick={runSearch} disabled={searching || !query.trim()}>
          {searching ? t("common.loading") : t("common.search")}
        </Button>
      </div>

      {error ? <ErrorPanel error={error} onRetry={runSearch} /> : null}
      {notFound ? <Callout tone="warn">{t("orders.noMatch")}</Callout> : null}

      {matches ? (
        <div className="mt-3">
          <Callout tone="warn">{t("orders.multipleMatches")}</Callout>
          <ul className="divide-line border-line mt-2 divide-y rounded-lg border">
            {matches.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => onFound(order)}
                  className="hover:bg-sunken flex w-full items-center justify-between gap-3 px-3 py-2 text-start"
                >
                  <CellStack
                    primary={<span className="font-mono font-medium">{order.orderNumber}</span>}
                    secondary={tx(order.branchName)}
                  />
                  <span className="text-fg-subtle text-xs">{formatDate(order.businessDay, fmt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/** How much of a cancelled order's payment, if any, has actually been sent back. */
function CancelledOrderInfo({ order }: { order: Order }) {
  const { t, tx, fmt } = useI18n();

  const refunded = order.payments
    .filter((p) => p.amount.amount < 0)
    .reduce((sum, p) => sum + -p.amount.amount, 0);

  const paymentStatus =
    order.paidTotal.amount === 0
      ? t("orders.neverCharged")
      : refunded >= order.paidTotal.amount
        ? t("orders.refunded")
        : refunded > 0
          ? t("orders.partiallyRefunded")
          : t("orders.refundPending");

  return (
    <div className="mt-4">
      <Callout tone="bad" title={t("orders.cancelled")}>
        <DescList>
          {order.cancelledAt ? (
            <DescRow label={t("orders.cancelledAt")}>{formatTime(order.cancelledAt, fmt)}</DescRow>
          ) : null}
          {order.cancelledBy ? (
            <DescRow label={t("orders.cancelledBy")}>{tx(order.cancelledBy)}</DescRow>
          ) : null}
          {order.cancelReason ? (
            <DescRow label={t("orders.cancelReason")}>{order.cancelReason}</DescRow>
          ) : null}
          <DescRow label={t("orders.originalTotal")} mono>
            {formatMoney(order.grandTotal, fmt)}
          </DescRow>
          <DescRow label={t("orders.paymentStatus")}>{paymentStatus}</DescRow>
          {refunded > 0 ? (
            <DescRow label={t("orders.refundAmount")} mono>
              {formatMoney(money(refunded, order.currency), fmt)}
            </DescRow>
          ) : null}
        </DescList>
      </Callout>
    </div>
  );
}

/**
 * ORDERS-MODULE-COMPREHENSIVE-P0 — FR-POS-104 (reprint duplicate-marking /
 * audit) is NOT implemented anywhere in the current backend (confirmed: it
 * exists only as an aspirational doc-comment on `OrdersController`, no
 * actual marking/logging code). This reuses the SAME `ReceiptDrawer`
 * `services.sales.receipt` already prints from — never a second renderer —
 * but that only re-prints the document; it does not, and cannot yet,
 * satisfy real reprint governance. `orders.reprintNotAudited` says so.
 */
const RECEIPT_ELIGIBLE_STATES: Order["state"][] = ["completed", "partially_refunded", "refunded"];

function OrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  const [copied, setCopied] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const canReprint = RECEIPT_ELIGIBLE_STATES.includes(order.state);

  return (
    <Drawer
      open
      onClose={onClose}
      title={order.orderNumber}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
          <Badge tone={SYNC_STATE[order.syncState].tone}>{tx(SYNC_STATE[order.syncState].label)}</Badge>
          <span>{tx(ORDER_TYPE[order.orderType].label)}</span>
          {order.tableLabel ? <span>· {order.tableLabel}</span> : null}
          <SpecTag id="BR-POS-004" />
        </span>
      }
      footer={
        canReprint ? (
          <div>
            <Button variant="ghost" onClick={() => setReprintOpen(true)}>
              {t("orders.reprintReceipt")}
            </Button>
            <p className="text-fg-subtle mt-1 text-xs">{t("orders.reprintNotAudited")}</p>
          </div>
        ) : undefined
      }
    >
      <DescList>
        <DescRow label={t("orders.reference")} mono>
          <span className="inline-flex items-center gap-1">
            {order.id}
            <IconButton
              label={copied ? t("common.copied") : t("common.copy")}
              icon={copied ? <Check size={12} /> : <Copy size={12} />}
              className="h-6 w-6"
              onClick={async () => {
                await navigator.clipboard.writeText(order.id);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          </span>
        </DescRow>
        <DescRow label={t("fin.businessDay")}>{formatDate(order.businessDay, fmt)}</DescRow>
        <DescRow label={t("common.branch")}>{tx(order.branchName)}</DescRow>
        <DescRow label={t("orders.opened")}>{formatTime(order.openedAt, fmt)}</DescRow>
        {order.firstFiredAt ? (
          <DescRow label={t("pos.fired")}>{formatTime(order.firstFiredAt, fmt)}</DescRow>
        ) : null}
        {order.completedAt ? (
          <DescRow label={t("orders.completed")}>{formatTime(order.completedAt, fmt)}</DescRow>
        ) : null}
        {order.syncedAt ? (
          <DescRow label={t("orders.syncedAt")}>{formatTime(order.syncedAt, fmt)}</DescRow>
        ) : null}
        <DescRow label={t("orders.terminal")}>{order.terminalName}</DescRow>
        <DescRow label={t("orders.server")}>{tx(order.openedByName)}</DescRow>
        {order.guestCount ? (
          <DescRow label={t("orders.guests")}>{order.guestCount}</DescRow>
        ) : null}
      </DescList>

      {order.state === "cancelled" ? <CancelledOrderInfo order={order} /> : null}

      <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("orders.lines")}</h3>
      <ul className="divide-line border-line divide-y rounded-lg border">
        {order.lines.map((line) => (
          <li key={line.id} className="px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-fg text-sm">
                  <span className="font-medium tabular-nums">{line.quantity} ×</span>{" "}
                  {tx(line.itemNameSnapshot)}
                </p>
                {line.modifiers.length > 0 ? (
                  <p className="mt-0.5 text-xs">
                    {line.modifiers.map((m) => (
                      <span
                        key={m.id}
                        className={m.kind === "removal" ? "text-bad me-2" : "text-accent me-2"}
                      >
                        {m.kind === "removal" ? "−" : "+"} {tx(m.name)}
                      </span>
                    ))}
                  </p>
                ) : null}
                {line.notes ? (
                  <p className="text-fg-subtle mt-0.5 text-xs italic">“{line.notes}”</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={ORDER_LINE_STATE[line.state].tone}>
                    {tx(ORDER_LINE_STATE[line.state].label)}
                  </Badge>
                  {line.isComp ? <Badge tone="warn">{t("orders.comp")}</Badge> : null}
                  {line.voidReason ? (
                    <span className="text-fg-subtle text-xs">{line.voidReason}</span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-end">
                <p className="text-fg text-sm tabular-nums">{formatMoney(line.lineSubtotal, fmt)}</p>
                <p className="text-fg-subtle text-xs tabular-nums">
                  {t("orders.cogs")} {formatMoney(line.unitCostSnapshot, fmt)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("common.total")}</h3>
      <DescList>
        <DescRow label={t("common.subtotal")} mono>
          {formatMoney(order.subtotal, fmt)}
        </DescRow>
        <DescRow label={t("pos.discountTotal")} mono>
          {formatMoney(order.discountTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.serviceCharge")} mono>
          {formatMoney(order.serviceChargeTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.tax")} mono>
          {formatMoney(order.taxTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.rounding")} mono>
          {formatMoney(order.roundingAdjustment, fmt)}
        </DescRow>
        <DescRow label={t("common.total")} mono>
          <span className="font-semibold">
            {formatMoney(
              money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
              fmt,
            )}
          </span>
        </DescRow>
        <DescRow label={t("orders.cogs")} mono>
          {formatMoney(order.cogsTotal, fmt)}
        </DescRow>
      </DescList>

      {order.payments.length > 0 ? (
        <>
          <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("orders.payments")}</h3>
          <DescList>
            {order.payments.map((payment) => (
              <DescRow
                key={payment.id}
                label={`${tx(TENDER_TYPE[payment.tender].label)}${
                  payment.cardLast4 ? ` ···· ${payment.cardLast4}` : ""
                }`}
                mono
              >
                {formatMoney(payment.amount, fmt)}
              </DescRow>
            ))}
          </DescList>
        </>
      ) : null}

      {order.discounts.length > 0 ? (
        <>
          <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">
            {t("orders.discountsApplied")}
          </h3>
          <DescList>
            {order.discounts.map((discount) => (
              <DescRow key={discount.id} label={tx(discount.reason)} mono>
                {formatMoney(discount.amount, fmt)}
                {discount.approvedBy ? (
                  <span className="text-fg-subtle ms-2 text-xs">
                    {t("orders.approvedBy")} {tx(discount.approvedBy)}
                  </span>
                ) : null}
              </DescRow>
            ))}
          </DescList>
        </>
      ) : null}

      {canReprint ? (
        <ReceiptDrawer order={order} open={reprintOpen} onClose={() => setReprintOpen(false)} />
      ) : null}
    </Drawer>
  );
}
