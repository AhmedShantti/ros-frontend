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
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatTime, tx as pick } from "@/lib/console/format";
import { useLive } from "@/lib/console/live/store";
import { DATA_MODE } from "@/lib/api/config";
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

      {state.session ? (
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
      <Button
        size="sm"
        variant="ghost"
        icon={<RotateCcw size={13} />}
        onClick={() => setConfirmReset(true)}
      >
        <span className="sr-only sm:not-sr-only">{t("term.reset")}</span>
      </Button>

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
 * With no backend configured the honest answer is still "working locally":
 * there is no link to lose, and reporting "online" would be a claim about a
 * server that does not exist. Once an API is configured the real state is
 * shown, with the count of writes still waiting to reach it.
 */
function ConnectivityBadge() {
  const { t, fmt } = useI18n();
  useBrowserConnectivity();

  const state = useConnectivityStore((s) => s.state);
  const hydrated = useConnectivityStore((s) => s.hydrated);
  const pending = useConnectivityStore(pendingCount);

  // No API configured: the store is describing a link that is not there.
  if (DATA_MODE !== "http") {
    return (
      <span
        className="text-fg-subtle hidden items-center gap-1.5 text-xs sm:inline-flex"
        title={t("term.offlineNote")}
      >
        <WifiOff size={13} />
        {t("term.offline")}
      </span>
    );
  }

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
    <span
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
    </span>
  );
}
