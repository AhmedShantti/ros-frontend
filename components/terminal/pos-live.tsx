"use client";

/**
 * The point of sale, driven by the backend.
 *
 * ## Why this is a separate screen from the demo POS
 *
 * `components/terminal/pos-*.tsx` run on the in-memory engine in
 * `lib/console/live/`, which simulates far more than the API implements:
 * splits, table state, courses, KDS tickets. The backend offers this much
 * against an order and its drawer:
 *
 *   POST   /cash-sessions                       open the drawer
 *   POST   /cash-sessions/{id}/pay-in|-out|…    move cash without a sale
 *   GET    /cash-sessions/{id}/close-context    what a cashier may see
 *   POST   /cash-sessions/{id}/close            commit the count
 *   POST   /cash-sessions/{id}/close/finalize   a manager's decision
 *   POST   /orders                              open an order
 *   POST   /orders/{day}/{id}/lines             capture a line
 *   DELETE /orders/{day}/{id}/lines/{lineId}    void a pre-fire line
 *   POST   /orders/{day}/{id}/fire              fire to production
 *   POST   /orders/{day}/{id}/payments          pay, partially or in full
 *   POST   /orders/{day}/{id}/discount           discount the order
 *   POST   /orders/{day}/{id}/lines/{l}/discount discount one line
 *   POST   /orders/{day}/{id}/lines/{l}/comp     comp one line
 *   POST   /orders/{day}/{id}/lines/{l}/void-postfire  void a fired line
 *   POST   /orders/{day}/{id}/refunds            refund a settled payment
 *
 * Bridging the simulator onto that surface would mean a screen where half
 * the controls silently do nothing to the server — a till that looks like
 * it took a discount and did not. So this renders only what the API can
 * actually perform, and names the rest as unavailable.
 *
 * Optimistic concurrency is real here: every mutation sends the `version`
 * last seen as `if-match`, so a second terminal editing the same order gets
 * a 412 instead of quietly overwriting.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Flame,
  Gift,
  Percent,
  Plus,
  Receipt,
  Trash2,
  Undo2,
} from "lucide-react";

import type { MenuItem, Order } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney } from "@/lib/console/format";
import { ORDER_LINE_STATE, ORDER_TYPE, TENDER_TYPE, labelOf } from "@/lib/console/labels";
import {
  getCashSessionId,
  getPendingCashOpen,
  getTerminalId,
  setCashSessionId as persistCashSessionId,
  setPendingCashOpen,
  getPosEmployee,
  setPosEmployee,
  getTenantId,
  type PosEmployee,
} from "@/lib/api/session";
import { api } from "@/lib/api/endpoints";
import { signInWithPin } from "@/lib/api/auth";
import { deviceId } from "@/lib/api/ids";
import { AsyncPanel } from "@/components/console/states";
import { CashClosePolicyCard, DrawerSheet } from "@/components/terminal/pos-drawer";
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
  cx,
} from "@/components/console/ui";

/** What the API still cannot do, listed once so the copy stays consistent. */
const UNSUPPORTED_KEYS = [
  "pos.unsupportedSplit",
  "pos.unsupportedTable",
  "pos.unsupportedCourse",
  "pos.unsupportedKds",
] as const;

export function LivePos() {
  const { t } = useI18n();
  const { scope } = useSession();

  const [cashSessionId, setSessionId] = useState<string | null>(null);
  const [cashier, setCashier] = useState<PosEmployee | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  /**
   * Both the terminal binding and the open drawer live in `localStorage`,
   * which the server render cannot see. Reading them during render would
   * make the first client paint disagree with the server's, so nothing is
   * decided until after mount.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // The drawer the till had open before this reload. Without this the
    // screen offers to open a second one, and the first becomes
    // unreachable: the backend serves no cash-session index to find it in.
    setSessionId(getCashSessionId());
    setCashier(getPosEmployee());
    setMounted(true);
  }, []);

  /** Write through, so the drawer survives the next reload too. */
  const setCashSessionId = (next: string | null) => {
    persistCashSessionId(next);
    setSessionId(next);
  };

  const terminalId = mounted ? getTerminalId() : null;

  /*
   * The terminal this device is bound to, as the server describes it.
   *
   * Two things on this screen need it. `drawerId` must be a UUID the server
   * will accept, and a till has exactly one drawer, so the terminal's own id
   * is it — a cashier typing "DRAWER-1" was never going to pass validation.
   * And the cash-close policy is published per branch, which on a POS is
   * whichever branch the terminal belongs to, not a console-side selection
   * the cashier may never have made.
   */
  const bound = useAsync(async () => {
    if (!terminalId) return null;
    const registered = await api.terminals.list().catch(() => []);
    return registered.find((row) => row.id === terminalId) ?? null;
  }, [terminalId]);

  const branchId = scope.branchId ?? bound.data?.branchId ?? null;

  if (!mounted) {
    return (
      <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 p-8 text-sm">
        <Spinner /> {t("term.loading")}
      </div>
    );
  }

  if (!terminalId) {
    return (
      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto p-4">
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

  /*
   * A drawer is taken into someone's custody, so the token must say whose.
   *
   * Signing in to the console and binding a terminal is not enough: that
   * token identifies a *user*, and the server answers "Opening a cash
   * session requires a session that identifies the employee taking custody
   * of the drawer." Only `POST /auth/pin` mints a token carrying an
   * employee, so the till has a sign-on of its own on top of signing in.
   */
  if (!cashier) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md p-4">
          <CashierSignOn
            terminalId={terminalId}
            onSignedOn={(next) => {
              setCashier(next);
              setMessage(t("shift.signedOn"));
            }}
          />
          <Toast message={message} />
        </div>
      </div>
    );
  }

  if (!cashSessionId) {
    /*
     * This column is taller than the viewport on a laptop, and the terminal
     * layout is `h-dvh overflow-hidden` — a POS must never scroll the page
     * out from under a cashier mid-service. So the pane scrolls, not the
     * document. Without `min-h-0` the flex child refuses to shrink below its
     * content and the overflow never engages, which is what put the policy
     * card's Publish button off the bottom of the screen with no way to
     * reach it.
     */
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md space-y-3 p-4">
          <OpenDrawer
            terminal={bound.data}
            cashier={cashier}
            onNeedsSignOn={() => {
              // The token stopped identifying an employee — a refresh can
              // re-scope it back to the console user. Ask again rather than
              // leaving a dead button behind a stale name.
              setPosEmployee(null);
              setCashier(null);
            }}
            onOpened={setCashSessionId}
          />
          <CashClosePolicyCard branchId={branchId} onMessage={setMessage} />
          <Toast message={message} />
        </div>
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
          onDrawer={() => setDrawer(true)}
        />
      </aside>

      <DrawerSheet
        open={drawer}
        cashSessionId={cashSessionId}
        onClose={() => setDrawer(false)}
        onMessage={setMessage}
        onClosed={() => {
          // The session is gone; so is anything that referenced it, and so
          // is the stored id — a closed drawer must not come back on reload.
          setDrawer(false);
          setCashSessionId(null);
          setOrder(null);
        }}
      />

      <Toast message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-SEC-020 — the cashier signs on to the till by staff code and PIN.
 *
 * Not by email: a POS operator identifies by employee code, and the tenant
 * and terminal are read off the device rather than typed. The session this
 * mints is POS-only and replaces the console token on this device, which is
 * correct — a till in service is the cashier's, not the manager's who set
 * it up.
 */
function CashierSignOn({
  terminalId,
  onSignedOn,
}: {
  terminalId: string;
  onSignedOn: (employee: PosEmployee) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");

  const tenantId = getTenantId();
  const valid = employeeCode.trim() !== "" && /^[0-9]{4,8}$/.test(pin) && Boolean(tenantId);

  async function signOn() {
    if (!valid || !tenantId) return;
    const code = employeeCode.trim();
    await action.run(
      async () => {
        await signInWithPin({ tenantId, terminalId, employeeCode: code, pin });
        return getPosEmployee() ?? { code, name: code };
      },
      {
        onSuccess: (employee) => {
          // Never leave a PIN sitting in a field on a shared till.
          setPin("");
          onSignedOn(employee);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader title={t("shift.signOnTitle")} hint={t("shift.signOnNote")} spec="FR-SEC-020" />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {tenantId ? null : <Callout tone="warn">{t("shift.signOnNoTenant")}</Callout>}

      <div className="mt-4 space-y-4">
        <Field label={t("shift.employeeCode")} required>
          <Input
            dir="ltr"
            autoComplete="off"
            value={employeeCode}
            onChange={(event) => setEmployeeCode(event.target.value)}
          />
        </Field>

        {/* The employee's PIN, not the device's — `auth.pinLabel` is the
            terminal one and reads "Terminal PIN" on this card, which is a
            different secret entirely. */}
        <Field label={t("shift.pinLabel")} hint={t("shift.pinHint")} required>
          <Input
            type="password"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          loading={action.pending}
          disabled={!valid}
          onClick={signOn}
        >
          {t("shift.signOn")}
        </Button>
      </div>
    </Card>
  );
}

/**
 * FR-POS-090, FR-FIN-001/002 — a shift and its cash session, in one call.
 *
 * The drawer is not named by the cashier. It used to be a text field
 * defaulting to "DRAWER-1", which the server rejects outright: `drawerId` is
 * validated as a UUID, like every other id it stores. A till has one drawer,
 * so the drawer *is* the terminal, and the terminal's id is one the server
 * issued and will accept. It is shown, not asked for — a cashier has no way
 * to know a UUID and no reason to choose one.
 */
function OpenDrawer({
  terminal,
  cashier,
  onNeedsSignOn,
  onOpened,
}: {
  terminal: { id: string; name: string } | null;
  cashier: PosEmployee;
  onNeedsSignOn: () => void;
  onOpened: (cashSessionId: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [float, setFloat] = useState("500.00");

  const drawerId = terminal?.id ?? "";
  const valid = drawerId !== "" && Number.isFinite(Number(float)) && Number(float) >= 0;

  async function open() {
    if (!valid) return;

    const drawer = drawerId;
    // Minor units as an exact integer string — never a JSON number.
    const openingFloat = String(Math.round(Number(float) * 100));

    /*
     * An attempt that never came back is resumed, not restarted.
     *
     * A press that reached the server and lost its response leaves a drawer
     * open that this till has no id for, and no `GET /cash-sessions` to
     * find it with. Replaying the same ULID pair asks the server about that
     * exact open instead of asking for another one: it answers with the
     * original session and `created: false`. Fresh ids are minted only for
     * an open of a genuinely different drawer or float.
     */
    const previous = getPendingCashOpen();
    const ids =
      previous && previous.drawerId === drawer && previous.openingFloat === openingFloat
        ? { cashSessionId: previous.cashSessionId, shiftId: previous.shiftId }
        : { cashSessionId: deviceId(), shiftId: deviceId() };

    setPendingCashOpen({ ...ids, drawerId: drawer, openingFloat });

    await action.run(
      () => services.treasury.openCashSession({ drawerId: drawer, openingFloat, ids }),
      {
        onSuccess: (result) => {
          // Answered, so there is nothing left to resume.
          setPendingCashOpen(null);
          onOpened(result.cashSessionId);
        },
        onError: (failure) => {
          // The token no longer identifies an employee — a refresh can
          // re-scope it back to the console user. Nothing was opened, so
          // the pending record would only replay a request that cannot
          // succeed until someone signs on again.
          if (/employee/i.test(failure.message) || failure.code === "UNAUTHENTICATED") {
            setPendingCashOpen(null);
            onNeedsSignOn();
          }
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader title={t("shift.openTitle")} spec="FR-POS-090" />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="mt-4 space-y-4">
        <Field label={t("shift.cashier")} hint={t("shift.cashierHint")}>
          <Input dir="ltr" value={cashier.name} readOnly disabled />
        </Field>

        <Field label={t("shift.drawer")} hint={t("shift.drawerHint")}>
          <Input dir="ltr" value={terminal?.name ?? ""} readOnly disabled />
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
  onDrawer,
}: {
  order: Order | null;
  cashSessionId: string;
  onOrder: (order: Order) => void;
  onMessage: (message: string) => void;
  onClear: () => void;
  onDrawer: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [sheet, setSheet] = useState<PosSheet>(null);
  const [paying, setPaying] = useState(false);

  // The drawer outlives any one order, so its control sits outside the
  // "no order open" branch — a cashier still has to pay out and close.
  const drawerButton = (
    <Button variant="ghost" className="w-full" icon={<Banknote size={14} />} onClick={onDrawer}>
      {t("shift.drawerOps")}
    </Button>
  );

  if (!order) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-fg-subtle text-sm">{t("pos.noActiveOrder")}</p>
        <div className="w-full max-w-56">{drawerButton}</div>
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
            {order.lines.map((line) => {
              const closed = line.state === "voided" || line.state === "comped";
              const editable = !closed && order.state !== "completed" && order.state !== "cancelled";
              return (
                <li key={line.id} className="py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="text-fg-subtle w-6 shrink-0 text-xs tabular-nums">
                      {line.quantity}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-fg truncate text-sm">{tx(line.itemNameSnapshot)}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-fg-subtle text-xs">
                          {tx(labelOf(ORDER_LINE_STATE, line.state).label)}
                        </span>
                        {line.isComp ? <Badge tone="warn">{t("pos.comp")}</Badge> : null}
                        {line.lineDiscount.amount > 0 ? (
                          <Badge tone="bad">−{formatMoney(line.lineDiscount, fmt)}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={cx(
                        "text-fg shrink-0 font-mono text-sm tabular-nums",
                        (closed) && "line-through",
                      )}
                    >
                      {formatMoney(line.lineTotal, fmt)}
                    </span>
                  </div>

                  {editable ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 ps-8">
                      <Button
                        variant="ghost"
                        disabled={action.pending}
                        onClick={() => setSheet({ kind: "discountLine", lineId: line.id })}
                      >
                        <Percent size={13} aria-hidden />
                        <span className="sr-only">{t("pos.discount")}</span>
                      </Button>
                      {!line.isComp ? (
                        <Button
                          variant="ghost"
                          disabled={action.pending}
                          onClick={() => setSheet({ kind: "comp", lineId: line.id })}
                        >
                          <Gift size={13} aria-hidden />
                          <span className="sr-only">{t("pos.comp")}</span>
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        disabled={action.pending}
                        onClick={() => setSheet({ kind: "void", lineId: line.id })}
                      >
                        <Trash2 size={13} aria-hidden />
                        <span className="sr-only">{t("pos.void")}</span>
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-line shrink-0 space-y-2 border-t px-3 py-2.5">
        <DescList>
          <DescRow label={t("orders.net")} mono>
            {formatMoney(order.subtotal, fmt)}
          </DescRow>
          {order.discountTotal.amount > 0 ? (
            <DescRow label={t("pos.discountTotal")} mono>
              <span className="text-bad">−{formatMoney(order.discountTotal, fmt)}</span>
            </DescRow>
          ) : null}
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

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            icon={<Percent size={13} />}
            disabled={
              order.lines.filter((l) => l.state !== "voided" && l.state !== "comped").length ===
                0 ||
              order.state === "completed" ||
              order.state === "cancelled"
            }
            onClick={() => setSheet({ kind: "discountOrder" })}
          >
            {t("pos.discountOrder")}
          </Button>
          <Button
            size="sm"
            icon={<Undo2 size={13} />}
            disabled={
              order.paidTotal.amount <= 0 ||
              (order.state !== "completed" && order.state !== "partially_refunded")
            }
            onClick={() => setSheet({ kind: "refund" })}
          >
            {t("pos.refund")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onClear}>
            {t("pos.closeOrder")}
          </Button>
          {drawerButton}
        </div>
      </footer>

      <VoidLineDrawer
        order={order}
        lineId={sheet?.kind === "void" ? sheet.lineId : null}
        onClose={() => setSheet(null)}
        onVoided={(next) => {
          setSheet(null);
          onOrder(next);
          onMessage(t("pos.lineVoided"));
        }}
      />

      <DiscountDrawer
        order={order}
        lineId={sheet?.kind === "discountLine" ? sheet.lineId : null}
        open={sheet?.kind === "discountOrder" || sheet?.kind === "discountLine"}
        onClose={() => setSheet(null)}
        onApplied={(next) => {
          setSheet(null);
          onOrder(next);
          onMessage(t("pos.discountApplied"));
        }}
      />

      <CompDrawer
        order={order}
        lineId={sheet?.kind === "comp" ? sheet.lineId : null}
        onClose={() => setSheet(null)}
        onComped={(next) => {
          setSheet(null);
          onOrder(next);
          onMessage(t("pos.compApplied"));
        }}
      />

      <RefundDrawer
        order={order}
        cashSessionId={cashSessionId}
        open={sheet?.kind === "refund"}
        onClose={() => setSheet(null)}
        onRefunded={(next) => {
          setSheet(null);
          onOrder(next);
          onMessage(t("pos.refunded"));
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
          // A settling payment completes the order in the same request, and
          // "payment captured" would understate what just happened.
          onMessage(next.state === "completed" ? t("pos.orderSettled") : t("pos.paymentCaptured"));
        }}
      />
    </>
  );
}

/** Which sheet `OrderPane` has open, and the line it applies to (if any). */
type PosSheet =
  | { kind: "void"; lineId: string }
  | { kind: "discountOrder" }
  | { kind: "discountLine"; lineId: string }
  | { kind: "comp"; lineId: string }
  | { kind: "refund" }
  | null;

// ---------------------------------------------------------------------------

/**
 * FR-POS-013/070/071 — a void carries a reason, and the reason is a real
 * reason-code id from `inventory.reason_codes`. The database refuses a
 * voided row without one, so this is required rather than optional.
 *
 * Which route this calls depends on the line, not on the cashier's choice:
 * a `pending` line has never reached the kitchen, so it comes off the bill
 * with `DELETE .../lines/{lineId}`. Any other open state has already been
 * fired — the stock movement Fire created still stands — so this calls the
 * accepted post-fire route instead, which additionally asks where the food
 * went (FR-POS-070).
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
  const [disposition, setDisposition] = useState<"returned_to_stock" | "wasted" | "given_to_staff">(
    "wasted",
  );

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  const line = order.lines.find((l) => l.id === lineId) ?? null;
  if (!lineId || !line) return null;
  const preFire = line.state === "pending";

  async function submit() {
    if (!reasonCodeId) return;
    await action.run(
      () =>
        preFire
          ? services.sales.mutations.voidLine(order.businessDay, order.id, lineId!, reasonCodeId, {
              ifMatch: orderVersion(order),
            })
          : services.sales.mutations.voidLinePostFire(
              order.businessDay,
              order.id,
              lineId!,
              { disposition, reasonCodeId },
              { ifMatch: orderVersion(order) },
            ),
      { onSuccess: onVoided },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("pos.void")} · ${tx(line.itemNameSnapshot)}`}
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

        <Callout tone={preFire ? "neutral" : "warn"}>
          {preFire ? t("pos.voidPreFire") : t("pos.voidPostFire")}
        </Callout>

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

        {!preFire ? (
          <Field label={t("pos.disposition")} hint={t("pos.dispositionNote")} required>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["returned_to_stock", t("pos.dispositionReturn")],
                  ["wasted", t("pos.dispositionWaste")],
                  ["given_to_staff", t("pos.dispositionStaff")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDisposition(value)}
                  className={cx(
                    "rounded-lg border px-3 py-2 text-sm",
                    disposition === value
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-POS-045/046/047 — a discount by percentage or by a fixed minor-unit
 * amount, with a required reason. `lineId` set discounts one line;
 * `lineId` null discounts the whole order.
 *
 * The manager fields are optional: only the backend's own threshold decides
 * whether one is needed (FR-POS-047), and this console has no copy of that
 * number. A discount goes without them first; if the server refuses, its
 * own permission error is what tells the cashier to ask a manager, rather
 * than this screen guessing at a threshold it cannot see.
 */
function DiscountDrawer({
  order,
  lineId,
  open,
  onClose,
  onApplied,
}: {
  order: Order;
  lineId: string | null;
  open: boolean;
  onClose: () => void;
  onApplied: (order: Order) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [type, setType] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("10");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [managerEmployeeCode, setManagerEmployeeCode] = useState("");
  const [managerPin, setManagerPin] = useState("");

  const reasons = useAsync(
    async () => (open ? services.inventory.reasonCodes() : []),
    [open],
  );

  if (!open) return null;
  const line = lineId ? (order.lines.find((l) => l.id === lineId) ?? null) : null;
  if (lineId && !line) return null;

  const parsed = Number(value);
  const validValue =
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    (type === "percentage" ? parsed > 0 && parsed <= 100 : parsed > 0);
  const valid = validValue && Boolean(reasonCodeId);

  async function submit() {
    if (!valid) return;
    const input = {
      type,
      // percentage: exact decimal string. fixed: a whole number of minor
      // units — the field holds a major-unit amount, so it is scaled here,
      // the same convention as every other amount input on this screen.
      value: type === "percentage" ? value.trim() : String(Math.round(parsed * 100)),
      reasonCodeId,
      managerEmployeeCode: managerEmployeeCode.trim() || undefined,
      managerPin: managerPin.trim() ? managerPin : undefined,
    };
    await action.run(
      () =>
        line
          ? services.sales.mutations.discountLine(order.businessDay, order.id, line.id, input, {
              ifMatch: orderVersion(order),
            })
          : services.sales.mutations.discountOrder(order.businessDay, order.id, input, {
              ifMatch: orderVersion(order),
            }),
      {
        onSuccess: (next) => {
          setManagerPin("");
          onApplied(next);
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        line ? `${t("pos.discountLine")} · ${tx(line.itemNameSnapshot)}` : t("pos.discountOrder")
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("pos.apply")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("pos.discountType")}>
          <div className="flex gap-1.5">
            {(
              [
                ["percentage", t("pos.discountByPercent")],
                ["fixed", t("pos.discountByFixed")],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setType(kind);
                  setValue(kind === "percentage" ? "10" : "");
                }}
                className={cx(
                  "flex-1 rounded-lg border px-3 py-2 text-sm",
                  type === kind
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {type === "percentage" ? (
          <Field label={t("pos.discountPercent")} required>
            <div className="flex flex-wrap gap-1.5">
              {["5", "10", "15", "20", "25", "50"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(p)}
                  className={cx(
                    "rounded-lg border px-3 py-2 text-sm tabular-nums",
                    value === p
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
            <div className="mt-2">
              <Input
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label={t("pos.discountPercent")}
              />
            </div>
          </Field>
        ) : (
          <Field label={`${t("pos.discountAmount")} (${order.currency})`} required>
            <Input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        )}

        <AsyncPanel
          state={reasons}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("pos.noReasonCodes")}</Callout>}
        >
          {(rows) => (
            <Field label={t("pos.discountReason")} required>
              <Select value={reasonCodeId} onChange={(event) => setReasonCodeId(event.target.value)}>
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

        <Field label={t("shift.managerCode")} hint={t("pos.approvalHint")}>
          <Input
            dir="ltr"
            autoComplete="off"
            value={managerEmployeeCode}
            onChange={(event) => setManagerEmployeeCode(event.target.value)}
          />
        </Field>
        <Field label={t("shift.managerPin")}>
          <Input
            type="password"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={managerPin}
            onChange={(event) => setManagerPin(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** FR-POS-050 — a comp still costs (the stock is still gone) but is never charged. */
function CompDrawer({
  order,
  lineId,
  onClose,
  onComped,
}: {
  order: Order;
  lineId: string | null;
  onClose: () => void;
  onComped: (order: Order) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [reasonCodeId, setReasonCodeId] = useState("");

  const reasons = useAsync(() => services.inventory.reasonCodes(), []);

  const line = lineId ? (order.lines.find((l) => l.id === lineId) ?? null) : null;
  if (!lineId || !line) return null;

  async function submit() {
    if (!reasonCodeId || !line) return;
    await action.run(
      () =>
        services.sales.mutations.comp(
          order.businessDay,
          order.id,
          line.id,
          { reasonCodeId },
          { ifMatch: orderVersion(order) },
        ),
      { onSuccess: onComped },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("pos.comp")} · ${tx(line.itemNameSnapshot)}`}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!reasonCodeId} onClick={submit}>
            {t("pos.comp")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="warn">{t("pos.compNote")}</Callout>

        <AsyncPanel
          state={reasons}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("pos.noReasonCodes")}</Callout>}
        >
          {(rows) => (
            <Field label={t("pos.discountReason")} required>
              <Select value={reasonCodeId} onChange={(event) => setReasonCodeId(event.target.value)}>
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
 * FR-POS-072/073/074 — a refund is issued against one specific,
 * already-settled payment, never against the order in the abstract.
 *
 * There is no payment index (no `GET /payments`), and `Order.payments` is
 * deliberately left empty by the mapper — the non-fiscal receipt is the
 * only route that reads a completed order's payment ids back, so this
 * reads it to build the picker rather than inventing one.
 */
function RefundDrawer({
  order,
  cashSessionId,
  open,
  onClose,
  onRefunded,
}: {
  order: Order;
  cashSessionId: string;
  open: boolean;
  onClose: () => void;
  onRefunded: (order: Order) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [managerEmployeeCode, setManagerEmployeeCode] = useState("");
  const [managerPin, setManagerPin] = useState("");

  const receiptState = useAsync(
    async () => (open ? services.sales.receipt(order.businessDay, order.id) : null),
    [open, order.businessDay, order.id],
  );
  const reasons = useAsync(
    async () => (open ? services.inventory.reasonCodes() : []),
    [open],
  );

  if (!open) return null;

  const payments = receiptState.data?.payments ?? [];
  const payment = payments.find((row) => row.id === paymentId) ?? null;

  const parsed = Number(amount);
  const minor = Math.round(parsed * 100);
  const valid =
    Boolean(payment) &&
    Boolean(reasonCodeId) &&
    amount.trim() !== "" &&
    Number.isFinite(minor) &&
    minor > 0 &&
    minor <= (payment?.amount.amount ?? 0);

  async function submit() {
    if (!valid || !payment) return;
    await action.run(
      () =>
        services.sales.mutations.refund(
          order.businessDay,
          order.id,
          {
            originalPaymentId: payment.id,
            amountMinor: String(minor),
            tender: payment.tender,
            reasonCodeId,
            // REQUIRED for cash, refused for card — the exact mirror of capturePayment.
            cashSessionId: payment.tender === "cash" ? cashSessionId : undefined,
            managerEmployeeCode: managerEmployeeCode.trim() || undefined,
            managerPin: managerPin.trim() ? managerPin : undefined,
          },
          { ifMatch: orderVersion(order) },
        ),
      {
        onSuccess: (next) => {
          setManagerPin("");
          onRefunded(next);
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("pos.refund")}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("pos.refund")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="warn">{t("pos.refundNote")}</Callout>

        <AsyncPanel
          state={receiptState}
          isEmpty={() => payments.length === 0}
          empty={<Callout tone="warn">{t("pos.refundNoPayments")}</Callout>}
        >
          {() => (
            <Field label={t("pos.refundPayment")} required>
              <Select
                value={paymentId}
                onChange={(event) => {
                  const id = event.target.value;
                  setPaymentId(id);
                  const next = payments.find((row) => row.id === id);
                  if (next) setAmount((next.amount.amount / 100).toFixed(2));
                }}
              >
                <option value="">—</option>
                {payments.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.tender === "cash"
                      ? tx(labelOf(TENDER_TYPE, "cash").label)
                      : t("orders.card")}{" "}
                    · {formatMoney(row.amount, fmt)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>

        <Field label={`${t("pos.refundAmount")} (${order.currency})`} required>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={!payment}
          />
        </Field>

        <AsyncPanel
          state={reasons}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="warn">{t("pos.noReasonCodes")}</Callout>}
        >
          {(rows) => (
            <Field label={t("pos.refundReason")} required>
              <Select value={reasonCodeId} onChange={(event) => setReasonCodeId(event.target.value)}>
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

        <Field label={t("shift.managerCode")} hint={t("pos.approvalHint")}>
          <Input
            dir="ltr"
            autoComplete="off"
            value={managerEmployeeCode}
            onChange={(event) => setManagerEmployeeCode(event.target.value)}
          />
        </Field>
        <Field label={t("shift.managerPin")}>
          <Input
            type="password"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={managerPin}
            onChange={(event) => setManagerPin(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-POS-060 — a payment, partial or settling.
 *
 * The endpoint now completes an order atomically when the payment covers the
 * outstanding balance, so the amount defaults to that balance rather than to
 * nothing: paying the bill in full is the ordinary case and should not need
 * arithmetic from the cashier.
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
  const [amount, setAmount] = useState(() => decimalOf(outstanding));
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

        <Callout tone="muted">{t("pos.settleNote")}</Callout>

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

/** Minor units back to the decimal string the amount inputs carry. */
function decimalOf(minor: number): string {
  if (!Number.isFinite(minor) || minor <= 0) return "";
  return (minor / 100).toFixed(2);
}

/**
 * The optimistic-concurrency token (SRS §24.6.4).
 *
 * Null in demo mode, where there is no server to disagree with; the mutation
 * then goes without `if-match` and the service layer refuses it anyway.
 */
function orderVersion(order: Order): number | undefined {
  return order.version ?? undefined;
}
