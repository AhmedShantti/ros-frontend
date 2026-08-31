"use client";

/**
 * The bar across the top of every terminal.
 *
 * A POS bar is not a dashboard topbar: it carries the few things a cashier
 * needs mid-service — which branch and terminal this is, whether the drawer
 * is open, and how to get to the other screen — and nothing else.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChefHat,
  ChevronDown,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Wifi,
  WifiOff,
} from "lucide-react";
import { branches, terminals } from "@/lib/console/mock/org";
import { useI18n, useSession } from "@/lib/console/providers";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { DATA_MODE } from "@/lib/api/config";
import { api } from "@/lib/api/endpoints";
import { getTerminalId } from "@/lib/api/session";
import { formatMoney, formatNumber, formatTime, tx as pick } from "@/lib/console/format";
import { useLive } from "@/lib/console/live/store";
import {
  pendingCount,
  useBrowserConnectivity,
  useConnectivityStore,
} from "@/store/connectivity";
import {
  Badge,
  Button,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  cx,
} from "@/components/console/ui";
import { LanguageToggle, ThemeToggle } from "@/components/console/switchers";
import { useState } from "react";

const TRIGGER =
  "border-line bg-raised text-fg hover:bg-sunken inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors";

export function TerminalBar() {
  const { t, tx, locale, fmt } = useI18n();
  const { state, dispatch, reset } = useLive();
  const pathname = usePathname();
  const [confirmReset, setConfirmReset] = useState(false);

  /*
   * Against a live deployment the picker, the shift badge and the reset are
   * all the simulator's, and none of them means anything to the server.
   *
   * The picker in particular was actively misleading: it lists fixture
   * branches and terminals and dispatches SET_BRANCH/SET_TERMINAL into the
   * in-memory store, so on a live till it looked like a way to move the
   * terminal and moved nothing. A real terminal changes branch by being
   * re-bound through `POST /auth/terminal`, not by a dropdown.
   */
  const live = DATA_MODE === "http";

  const branch = branches.find((b) => b.id === state.branchId);
  const terminal = terminals.find((x) => x.id === state.terminalId);
  const branchTerminals = terminals.filter(
    (x) => x.branchId === state.branchId && x.kind === "pos" && x.status !== "revoked",
  );

  return (
    <header className="border-line bg-raised flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="bg-accent text-accent-fg grid h-7 w-7 place-items-center rounded-lg text-xs font-bold">
          R
        </span>
        <nav className="flex items-center gap-1">
          <TerminalLink href="/pos" icon={<ScanLine size={14} />} active={pathname === "/pos"}>
            {t("term.pos")}
          </TerminalLink>
          <TerminalLink href="/kds" icon={<ChefHat size={14} />} active={pathname === "/kds"}>
            {t("term.kds")}
          </TerminalLink>
        </nav>
      </div>

      {live ? (
        <BoundIdentity />
      ) : (
      <Menu
        label={t("term.branch")}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className={TRIGGER}>
            <span className="max-w-40 truncate">{tx(branch?.name)}</span>
            <span className="text-fg-subtle">·</span>
            <span className="text-fg-muted">{terminal?.name}</span>
            <ChevronDown size={13} className="text-fg-subtle" />
          </button>
        )}
      >
        <MenuLabel>{t("term.branch")}</MenuLabel>
        {branches
          .filter((b) => b.active)
          .map((b) => (
            <MenuItem
              key={b.id}
              selected={b.id === state.branchId}
              onSelect={() => dispatch({ type: "SET_BRANCH", branchId: b.id })}
            >
              {pick(b.name, locale)}
            </MenuItem>
          ))}
        <MenuSeparator />
        <MenuLabel>{t("term.terminal")}</MenuLabel>
        {branchTerminals.map((x) => (
          <MenuItem
            key={x.id}
            selected={x.id === state.terminalId}
            onSelect={() => dispatch({ type: "SET_TERMINAL", terminalId: x.id })}
          >
            {x.name}
          </MenuItem>
        ))}
      </Menu>
      )}

      {/*
        The simulator's shift, not the server's. The live drawer is opened
        and counted inside the till itself, where its real state is known.
      */}
      {live ? null : state.session ? (
        <Badge tone="good" dot>
          {tx(state.session.employeeName)} · {formatTime(state.session.openedAt, fmt)} ·{" "}
          {formatMoney(state.session.expectedCash, fmt, true)}
        </Badge>
      ) : (
        <Badge tone="warn">{t("shift.none")}</Badge>
      )}

      <div className="flex-1" />

      <ConnectivityBadge />
      <Link
        href="/dashboard"
        className="border-line bg-raised text-fg-muted hover:bg-sunken hover:text-fg inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
      >
        <LayoutGrid size={13} />
        {t("term.console")}
      </Link>
      <LanguageToggle />
      <ThemeToggle />
      {/* Resets the in-memory demo. There is nothing here to reset when the
          data belongs to a server. */}
      {live ? null : (
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          onClick={() => setConfirmReset(true)}
        >
          <span className="sr-only sm:not-sr-only">{t("term.reset")}</span>
        </Button>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t("term.reset")}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              {t("term.reset")}
            </Button>
          </>
        }
      >
        <p className="text-fg text-sm">{t("term.resetConfirm")}</p>
        <p className="text-fg-subtle mt-2 text-xs leading-relaxed">{t("term.resetNote")}</p>
      </Modal>
    </header>
  );
}

/**
 * Which branch and terminal this device is actually bound to.
 *
 * Read from the server rather than from a fixture, and not a control: the
 * binding is changed by registering the device, which is a different screen
 * and a different authority. While it is loading, or if the terminal has
 * been revoked out from under the till, the slot stays empty rather than
 * naming a branch that might not be this one.
 */
function BoundIdentity() {
  const { tx } = useI18n();
  const { scope } = useSession();
  const terminalId = getTerminalId();

  const bound = useAsync(async () => {
    // `GET /auth/terminal` answers with the bound id and nothing else, so
    // the name comes from the registered list.
    const [registered, branch] = await Promise.all([
      terminalId ? api.terminals.list().catch(() => []) : [],
      scope.branchId
        ? services.organisation.branches.get(scope.branchId).catch(() => null)
        : null,
    ]);
    const terminal = registered.find((row) => row.id === terminalId) ?? null;
    return { terminalName: terminal?.name ?? null, branchName: branch?.name ?? null };
  }, [terminalId, scope.branchId]);

  if (!bound.data?.branchName && !bound.data?.terminalName) return null;

  return (
    <span className={TRIGGER}>
      <span className="max-w-40 truncate">{tx(bound.data.branchName ?? undefined)}</span>
      {bound.data.terminalName ? (
        <>
          <span className="text-fg-subtle">·</span>
          <span className="text-fg-muted">{bound.data.terminalName}</span>
        </>
      ) : null}
    </span>
  );
}

function TerminalLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-muted hover:bg-sunken hover:text-fg",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/**
 * What the link is actually doing.
 *
 * This was six lines of hard-coded markup showing one state forever, beside a
 * fully built connectivity store with six states, a persisted outbound queue
 * and copy in both languages — none of which anything imported. A terminal
 * that always says the same thing about the network is worse than one that
 * says nothing, because staff stop reading it.
 *
 * In http mode the queue carries every write waiting on the real backend. In
 * mock mode there is no backend, but a completed sale taken while
 * `navigator.onLine` is false still queues here the same way, so the badge
 * genuinely reflects "this order hasn't synced yet" rather than a claim about
 * a server — see `useOfflineOrderSync` in `lib/console/live/store.tsx`.
 */
function ConnectivityBadge() {
  const { t, fmt } = useI18n();
  useBrowserConnectivity();

  const state = useConnectivityStore((s) => s.state);
  const hydrated = useConnectivityStore((s) => s.hydrated);
  const pending = useConnectivityStore(pendingCount);
  const [open, setOpen] = useState(false);

  // Before rehydration the queue length is unknown; showing a count that then
  // corrects itself is worse than showing none for a frame.
  if (!hydrated) return null;

  const look = {
    online: { icon: <Wifi size={13} />, label: t("sync.online"), tone: "text-fg-subtle" },
    degraded: { icon: <Wifi size={13} />, label: t("sync.degraded"), tone: "text-warn" },
    offline: { icon: <WifiOff size={13} />, label: t("sync.offline"), tone: "text-bad" },
    syncing: {
      icon: <RefreshCw size={13} className="animate-spin" />,
      label: t("sync.syncing"),
      tone: "text-fg-muted",
    },
    conflict: {
      icon: <AlertTriangle size={13} />,
      label: t("sync.conflict"),
      tone: "text-bad",
    },
    synced: { icon: <Check size={13} />, label: t("sync.synced"), tone: "text-good" },
  }[state];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "hidden items-center gap-1.5 text-xs sm:inline-flex",
          look.tone,
        )}
        title={state === "offline" ? t("sync.offlineNote") : undefined}
      >
        {look.icon}
        {look.label}
        {pending > 0 ? (
          <span className="text-fg-subtle">
            · {t("sync.pending").replace("{n}", formatNumber(pending, fmt, 0))}
          </span>
        ) : null}
      </button>
      <SyncQueueModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Every write still waiting on the server — what the connectivity badge summarises. */
function SyncQueueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const queue = useConnectivityStore((s) => s.queue);
  const lastSyncedAt = useConnectivityStore((s) => s.lastSyncedAt);
  const retry = useConnectivityStore((s) => s.retry);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title={t("sync.queueTitle")}>
      <p className="text-fg-subtle text-xs leading-relaxed">{t("sync.queueLede")}</p>

      {queue.length === 0 ? (
        <p className="text-fg-subtle mt-4 text-sm">{t("sync.queueEmpty")}</p>
      ) : (
        <ul className="divide-line border-line mt-4 divide-y rounded-lg border">
          {queue.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-fg min-w-0 truncate text-sm">{q.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={q.status === "failed" ? "bad" : "warn"}>
                  {q.status === "failed" ? t("sync.statusFailed") : t("sync.statusPending")}
                </Badge>
                {q.status === "failed" ? (
                  <Button size="sm" variant="ghost" onClick={() => retry(q.id)}>
                    {t("sync.retryNow")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {lastSyncedAt ? (
        <p className="text-fg-subtle mt-3 text-xs">
          {t("sync.lastSynced")} · {formatTime(new Date(lastSyncedAt).toISOString(), fmt)}
        </p>
      ) : null}
    </Modal>
  );
}
