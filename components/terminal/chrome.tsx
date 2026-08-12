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
  ChefHat,
  ChevronDown,
  LayoutGrid,
  RotateCcw,
  ScanLine,
  WifiOff,
} from "lucide-react";
import { branches, terminals } from "@/lib/console/mock/org";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatTime, tx as pick } from "@/lib/console/format";
import { useLive } from "@/lib/console/live/store";
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

      <span
        className="text-fg-subtle hidden items-center gap-1.5 text-xs sm:inline-flex"
        title={t("term.offlineNote")}
      >
        <WifiOff size={13} />
        {t("term.offline")}
      </span>
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
