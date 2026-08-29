"use client";

/**
 * The point of sale, driven by the backend.
 *
 * ## Why this is a separate screen from the demo POS
 *
 * `components/terminal/pos-*.tsx` run on the in-memory engine in
 * `lib/console/live/`, which simulates far more than the API implements:
 * discounts, comps, splits, refunds, table state, courses, KDS tickets. The
 * backend offers exactly six operations against an order:
 *
 *   POST   /cash-sessions                       open the drawer
 *   POST   /orders                              open an order
 *   POST   /orders/{day}/{id}/lines             capture a line
 *   DELETE /orders/{day}/{id}/lines/{lineId}    void a pre-fire line
 *   POST   /orders/{day}/{id}/fire              fire to production
 *   POST   /orders/{day}/{id}/payments          capture a PARTIAL payment
 *
 * Bridging the simulator onto that surface would mean a screen where half
 * the controls silently do nothing to the server — an till that looks like
 * it took a discount and did not. So this renders only what the API can
 * actually perform, and names the rest as unavailable.
 *
 * ## Two things the API refuses on purpose
 *
 *  - **Full settlement.** `POST /payments` rejects a payment that would
 *    close the order, because Completion is not implemented. The remaining
 *    balance is shown and the refusal is passed through verbatim.
 *  - **Voiding a fired line.** Only pre-fire voids exist. After Fire the
 *    line is the kitchen's, and there is no endpoint to take it back.
 *
 * Optimistic concurrency is real here: every mutation sends the `version`
 * last seen as `if-match`, so a second terminal editing the same order gets
 * a 412 instead of quietly overwriting.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Flame,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";

import type { MenuItem, Order } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney } from "@/lib/console/format";
import { ORDER_TYPE, TENDER_TYPE, labelOf } from "@/lib/console/labels";
import { getTerminalId } from "@/lib/api/session";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Spinner,
  Toast,
} from "@/components/console/ui";

/** What the API cannot do, listed once so the copy stays consistent. */
const UNSUPPORTED_KEYS = [
  "pos.unsupportedDiscount",
  "pos.unsupportedComp",
  "pos.unsupportedSplit",
  "pos.unsupportedRefund",
  "pos.unsupportedTable",
  "pos.unsupportedCourse",
  "pos.unsupportedKds",
] as const;

export function LivePos() {
  const { t } = useI18n();
  const { scope } = useSession();

  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const terminalId = typeof window === "undefined" ? null : getTerminalId();

  if (!terminalId) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <Card>
          <CardHeader title={t("pos.noTerminal")} spec="FR-SEC-030" />
          <Callout tone="warn">{t("pos.noTerminalNote")}</Callout>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => {
              window.location.href = "/register-device";
            }}
          >
            {t("auth.deviceTitle")}
          </Button>
        </Card>
      </div>
    );
  }

  if (!cashSessionId) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <OpenDrawer onOpened={setCashSessionId} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        {order ? (
          <MenuPane order={order} onOrder={setOrder} onMessage={setMessage} />
        ) : (
          <NewOrderPane
            branchId={scope.branchId}
            terminalId={terminalId}
            onOpened={(next) => {
              setOrder(next);
              setMessage(t("pos.orderOpened"));
            }}
          />
        )}
      </div>

      <aside className="border-line bg-raised flex w-full shrink-0 flex-col border-s md:max-w-sm">
        <OrderPane
          order={order}
          cashSessionId={cashSessionId}
          onOrder={setOrder}
          onMessage={setMessage}
          onClear={() => setOrder(null)}
        />
      </aside>

      <Toast message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** FR-POS-090, FR-FIN-001/002 — a shift and its cash session, in one call. */
function OpenDrawer({ onOpened }: { onOpened: (cashSessionId: string) => void }) {
  const { t } = useI18n();
  const action = useAction();
  const [drawerId, setDrawerId] = useState("DRAWER-1");
  const [float, setFloat] = useState("500.00");

  const valid = drawerId.trim() !== "" && Number.isFinite(Number(float));

  async function open() {
    if (!valid) return;
    await action.run(
      () =>
        services.treasury.openCashSession({
          drawerId: drawerId.trim(),
          // Minor units as an exact integer string — never a JSON number.
          openingFloat: String(Math.round(Number(float) * 100)),
        }),
      { onSuccess: (result) => onOpened(result.cashSessionId) },
    );
  }

  return (
    <Card>
      <CardHeader title={t("shift.openTitle")} spec="FR-POS-090" />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="mt-4 space-y-4">
        <Field label={t("shift.drawer")} required>
          <Input
            dir="ltr"
            value={drawerId}
            onChange={(event) => setDrawerId(event.target.value)}
          />
        </Field>

        <Field label={t("shift.openingFloat")} hint={t("shift.openingFloatHint")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={float}
            onChange={(event) => setFloat(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          loading={action.pending}
          disabled={!valid}
          onClick={open}
        >
          {t("shift.open")}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function NewOrderPane({
  branchId,
  terminalId,
  onOpened,
}: {
  branchId: string | null;
  terminalId: string;
  onOpened: (order: Order) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway" | "pickup">("dine_in");
  const [guestCount, setGuestCount] = useState("2");

  async function open() {
    await action.run(
      () =>
        services.sales.mutations.open({
          orderType,
          channel: "pos",
          terminalId,
          guestCount: Number(guestCount) || undefined,
        }),
      { onSuccess: onOpened },
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader title={t("pos.newOrder")} spec="FR-POS-001" />

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!branchId ? <Callout tone="muted">{t("pos.branchFromTerminal")}</Callout> : null}

        <div className="mt-4 space-y-4">
          <Field label={t("orders.type")}>
            <Select
              value={orderType}
              onChange={(event) =>
                setOrderType(event.target.value as "dine_in" | "takeaway" | "pickup")
              }
            >
              {(["dine_in", "takeaway", "pickup"] as const).map((value) => (
                <option key={value} value={value}>
                  {tx(labelOf(ORDER_TYPE, value).label)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("pos.guests")}>
            <Input
              inputMode="numeric"
              dir="ltr"
              value={guestCount}
              onChange={(event) => setGuestCount(event.target.value)}
            />
          </Field>

          <Button
            variant="primary"
            className="w-full"
            loading={action.pending}
            icon={<Plus size={14} />}
            onClick={open}
          >
            {t("pos.openOrder")}
          </Button>
        </div>
      </Card>

      <UnsupportedNotice />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The sellable catalogue: items, their variants, and the prices in force. */
function MenuPane({
  order,
  onOrder,
  onMessage,
}: {
  order: Order;
  onOrder: (order: Order) => void;
  onMessage: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [search, setSearch] = useState("");

  const items = useAsync(() => services.catalogue.items.list({ limit: 500 }), []);

  const filtered = useMemo(() => {
    const rows = items.data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.name.en.toLowerCase().includes(needle) ||
        row.name.ar.includes(search.trim()) ||
        row.kitchenName.en.toLowerCase().includes(needle),
    );
  }, [items.data, search]);

  async function add(item: MenuItem, variantId: string) {
    await action.run(
      () =>
        services.sales.mutations.addLine(
          order.businessDay,
          order.id,
          { menuItemId: item.id, variantId, quantity: "1" },
          { ifMatch: orderVersion(order) },
        ),
      {
        onSuccess: (next) => {
          onOrder(next);
          onMessage(t("pos.lineAdded"));
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("pos.searchPlaceholder")}
      />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <AsyncPanel state={items} isEmpty={() => filtered.length === 0}>
        {() => (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((item) => (
              <ItemTile
                key={item.id}
                item={item}
                busy={action.pending}
                onAdd={(variantId) => add(item, variantId)}
              />
            ))}
          </div>
        )}
      </AsyncPanel>
    </div>
  );
}

/**
 * One sellable item.
 *
 * A line references a *variant*, not an item, so an item whose variants have
 * not loaded cannot be rung up — and says so rather than sending a request
 * that is guaranteed to 400.
 */
function ItemTile({
  item,
  busy,
  onAdd,
}: {
  item: MenuItem;
  busy: boolean;
  onAdd: (variantId: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [picking, setPicking] = useState(false);

  const detail = useAsync(
    async () => (picking ? services.catalogue.items.get(item.id) : null),
    [picking, item.id],
  );

  const variants = detail.data?.variants ?? [];

  return (
    <>
      <button
        type="button"
        disabled={busy || !item.available}
        onClick={() => setPicking(true)}
        className="border-line bg-raised hover:border-accent focus-visible:border-accent flex min-h-20 flex-col justify-between rounded-lg border p-2.5 text-start transition-colors disabled:opacity-50"
      >
        <span className="text-fg line-clamp-2 text-xs font-medium">{tx(item.name)}</span>
        {!item.available ? (
          <Badge tone="bad">{t("menu.unavailable")}</Badge>
        ) : (
          <span className="text-fg-subtle mt-1 text-xs">{item.imageEmoji}</span>
        )}
      </button>

      {picking ? (
        <Drawer open onClose={() => setPicking(false)} title={tx(item.name)}>
          <AsyncPanel
            state={detail}
            isEmpty={() => variants.length === 0}
            empty={<Callout tone="warn">{t("pos.noSellableVariant")}</Callout>}
          >
            {() => (
              <ul className="divide-line divide-y">
                {variants.map((variant) => (
                  <li key={variant.id}>
                    <button
                      type="button"
                      disabled={!variant.available}
                      onClick={() => {
                        setPicking(false);
                        onAdd(variant.id);
                      }}
                      className="hover:bg-sunken flex w-full items-center justify-between gap-3 px-1 py-3 text-start transition-colors disabled:opacity-50"
                    >
                      <span className="text-fg text-sm">{tx(variant.name)}</span>
                      <span className="text-fg font-mono text-sm tabular-nums">
                        {formatMoney(variant.basePrice, fmt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AsyncPanel>
        </Drawer>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function OrderPane({
  order,
  cashSessionId,
  onOrder,
  onMessage,
  onClear,
}: {
  order: Order | null;
  cashSessionId: string;
  onOrder: (order: Order) => void;
  onMessage: (message: string) => void;
  onClear: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (!order) {
    return (
      <div className="text-fg-subtle flex flex-1 items-center justify-center p-6 text-center text-sm">
        {t("pos.noActiveOrder")}
      </div>
    );
  }

  const pending = order.lines.filter((line) => line.state === "pending");
  const outstanding = order.grandTotal.amount - order.paidTotal.amount;

  async function fire() {
    await action.run(
      () =>
        services.sales.mutations.fire(order!.businessDay, order!.id, {
          ifMatch: orderVersion(order!),
        }),
      {
        onSuccess: (next) => {
          onOrder(next);
          onMessage(t("pos.fired"));
        },
      },
    );
  }

  return (
    <>
      <header className="border-line shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-fg font-mono text-sm">{order.orderNumber}</span>
          <Badge tone="neutral">{order.state}</Badge>
        </div>
        <p className="text-fg-subtle mt-0.5 text-xs">
          {tx(order.branchName)} · {order.businessDay}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {order.lines.length === 0 ? (
          <p className="text-fg-subtle py-6 text-center text-sm">{t("pos.noLines")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {order.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-2 py-2.5">
                <span className="text-fg-subtle w-6 shrink-0 text-xs tabular-nums">
                  {line.quantity}×
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-fg truncate text-sm">{tx(line.itemNameSnapshot)}</p>
                  <p className="text-fg-subtle text-xs">
                    {line.state === "pending" ? t("pos.pending") : line.state}
                  </p>
                </div>
                <span className="text-fg shrink-0 font-mono text-sm tabular-nums">
                  {formatMoney(line.lineTotal, fmt)}
                </span>
                {/* Only a pre-fire line can be voided — there is no endpoint
                    to take back a line the kitchen already has. */}
                {line.state === "pending" ? (
                  <Button
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() => setVoiding(line.id)}
                  >
                    <Trash2 size={13} aria-hidden />
                    <span className="sr-only">{t("pos.void")}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-line shrink-0 space-y-2 border-t px-3 py-2.5">
        <DescList>
          <DescRow label={t("orders.net")} mono>
            {formatMoney(order.subtotal, fmt)}
          </DescRow>
          <DescRow label={t("orders.tax")} mono>
            {formatMoney(order.taxTotal, fmt)}
          </DescRow>
          <DescRow label={t("orders.grandTotal")} mono>
            {formatMoney(order.grandTotal, fmt)}
          </DescRow>
          <DescRow label={t("orders.paid")} mono>
            {formatMoney(order.paidTotal, fmt)}
          </DescRow>
        </DescList>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            icon={<Flame size={14} />}
            disabled={pending.length === 0 || action.pending}
            loading={action.pending}
            onClick={fire}
          >
            {t("pos.fire")}
          </Button>
          <Button
            variant="primary"
            icon={<Receipt size={14} />}
            disabled={order.lines.length === 0}
            onClick={() => setPaying(true)}
          >
            {t("pos.pay")}
          </Button>
        </div>

        <Button variant="ghost" className="w-full" onClick={onClear}>
          {t("pos.closeOrder")}
        </Button>
      </footer>

      <VoidLineDrawer
        order={order}
        lineId={voiding}
        onClose={() => setVoiding(null)}
        onVoided={(next) => {
          setVoiding(null);
          onOrder(next);
          onMessage(t("pos.lineVoided"));
        }}
      />

      <PaymentDrawer
        order={order}
        open={paying}
        cashSessionId={cashSessionId}
        outstanding={outstanding}
        onClose={() => setPaying(false)}
        onPaid={(next) => {
          setPaying(false);
          onOrder(next);
          onMessage(t("pos.paymentCaptured"));
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-POS-013 — a void carries a reason, and the reason is a real reason-code
 * id from `inventory.reason_codes`. The database refuses a voided row
 * without one, so this is required rather than optional.
 */
function VoidLineDrawer({
  order,
  lineId,
  onClose,
  onVoided,
}: {
  order: Order;
  lineId: string | null;
  onClose: () => void;
  onVoided: (order: Order) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [reasonCodeId, setReasonCodeId] = useState("");

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  if (!lineId) return null;

  async function submit() {
    if (!reasonCodeId) return;
    await action.run(
      () =>
        services.sales.mutations.voidLine(order.businessDay, order.id, lineId!, reasonCodeId, {
          ifMatch: orderVersion(order),
        }),
      { onSuccess: onVoided },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pos.void")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="danger"
            loading={action.pending}
            disabled={!reasonCodeId}
            onClick={submit}
          >
            {t("pos.void")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <AsyncPanel
          state={reasons}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("pos.noReasonCodes")}</Callout>}
        >
          {(rows) => (
            <Field label={t("inv.reason")} hint={t("pos.voidReasonHint")} required>
              <Select
                value={reasonCodeId}
                onChange={(event) => setReasonCodeId(event.target.value)}
              >
                <option value="">—</option>
                {rows.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {tx(reason.label)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-POS-060 — a partial payment.
 *
 * The endpoint refuses anything that would settle the order in full, because
 * Completion does not exist yet. That is stated up front rather than left
 * for the cashier to discover by being rejected.
 */
function PaymentDrawer({
  order,
  open,
  cashSessionId,
  outstanding,
  onClose,
  onPaid,
}: {
  order: Order;
  open: boolean;
  cashSessionId: string;
  outstanding: number;
  onClose: () => void;
  onPaid: (order: Order) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [tender, setTender] = useState<"cash" | "manual_external_card">("cash");
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [terminalReference, setTerminalReference] = useState("");

  if (!open) return null;

  const minor = Math.round(Number(amount) * 100);
  const valid =
    amount.trim() !== "" &&
    Number.isFinite(minor) &&
    minor > 0 &&
    (tender === "cash"
      ? tendered.trim() !== "" && Number.isFinite(Number(tendered))
      : terminalReference.trim() !== "");

  async function capture() {
    if (!valid) return;
    await action.run(
      () =>
        services.sales.mutations.capturePayment(
          order.businessDay,
          order.id,
          {
            cashSessionId,
            tender,
            amountMinor: String(minor),
            tenderedAmountMinor:
              tender === "cash" ? String(Math.round(Number(tendered) * 100)) : undefined,
            terminalReference:
              tender === "manual_external_card" ? terminalReference.trim() : undefined,
          },
          { ifMatch: orderVersion(order) },
        ),
      { onSuccess: onPaid },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pos.pay")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={capture}>
            {t("pos.capturePayment")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="warn" icon={<AlertTriangle size={14} />}>
          {t("pos.partialOnlyNote")}
        </Callout>

        <DescList>
          <DescRow label={t("orders.outstanding")} mono>
            {formatMoney({ amount: outstanding, currency: order.currency }, fmt)}
          </DescRow>
        </DescList>

        <Field label={t("orders.tender")}>
          <Select
            value={tender}
            onChange={(event) =>
              setTender(event.target.value as "cash" | "manual_external_card")
            }
          >
            <option value="cash">{tx(labelOf(TENDER_TYPE, "cash").label)}</option>
            <option value="manual_external_card">{t("orders.card")}</option>
          </Select>
        </Field>

        <Field label={t("orders.amount")} required>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        {tender === "cash" ? (
          <Field label={t("orders.tendered")} hint={t("pos.tenderedHint")} required>
            <Input
              inputMode="decimal"
              dir="ltr"
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
            />
          </Field>
        ) : (
          <Field label={t("orders.terminalReference")} hint={t("pos.terminalRefHint")} required>
            <Input
              dir="ltr"
              value={terminalReference}
              onChange={(event) => setTerminalReference(event.target.value)}
            />
          </Field>
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** Says plainly which till features the backend does not implement. */
export function UnsupportedNotice() {
  const { t } = useI18n();

  return (
    <Card className="mt-3">
      <CardHeader title={t("pos.unsupportedTitle")} hint={t("pos.unsupportedNote")} />
      <ul className="mt-2 space-y-1">
        {UNSUPPORTED_KEYS.map((key) => (
          <li key={key} className="text-fg-subtle flex items-start gap-1.5 text-xs">
            <span aria-hidden>·</span>
            {t(key)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * The optimistic-concurrency token (SRS §24.6.4).
 *
 * Null in demo mode, where there is no server to disagree with; the mutation
 * then goes without `if-match` and the service layer refuses it anyway.
 */
function orderVersion(order: Order): number | undefined {
  return order.version ?? undefined;
}
