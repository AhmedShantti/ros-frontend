"use client";

/**
 * The console frame: a permission-filtered sidebar, a topbar carrying scope
 * and identity, and a mobile drawer that shows the same tree.
 *
 * Navigation is derived, never hand-maintained — `NAV_SECTIONS` is the single
 * source, and a section with no permitted children does not render at all.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { NAV_SECTIONS, isItemActive, type NavItem } from "@/lib/console/nav";
import { useDismissable } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { AccountMenu, LanguageToggle, RoleSwitcher, ScopeSummary, ScopeSwitcher, ThemeToggle } from "./switchers";
import { IconButton, cx } from "./ui";

const KEY_COLLAPSED = "ros.console.sidebar";

// ---------------------------------------------------------------------------
// Navigation tree
// ---------------------------------------------------------------------------

function useVisibleSections() {
  const { canAny } = useSession();
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAny(item.permissions)),
  })).filter((section) => section.items.length > 0);
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = t(item.labelKey);

  // A module that is specified but not implemented is shown greyed rather
  // than hidden or, worse, linked to a 404.
  if (item.stub) {
    return (
      <span
        title={collapsed ? label : t("nav.notBuiltHint")}
        aria-disabled="true"
        className={cx(
          "text-fg-subtle/70 flex cursor-not-allowed items-center gap-2.5 rounded-lg py-2 text-sm",
          collapsed ? "justify-center px-2" : "px-2.5",
        )}
      >
        <Icon size={16} className="shrink-0 opacity-60" />
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="border-line shrink-0 rounded border px-1 text-[0.6rem] tracking-wide uppercase">
              {t("nav.notBuilt")}
            </span>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      // The terminals run full-screen outside the console shell.
      target={item.external ? "_blank" : undefined}
      rel={item.external ? "noreferrer" : undefined}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors",
        collapsed ? "justify-center px-2" : "px-2.5",
        active
          ? "bg-accent-soft text-accent font-medium"
          : "text-fg-muted hover:bg-sunken hover:text-fg",
      )}
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {!collapsed && item.external ? (
        <ExternalLink size={12} className="shrink-0 opacity-60" aria-hidden />
      ) : null}
    </Link>
  );
}

function NavTree({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const sections = useVisibleSections();

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t("app.console")}>
      {sections.map((section) => (
        <div key={section.id} className="mb-3 last:mb-0">
          {!collapsed ? (
            <p className="text-fg-subtle px-2.5 pt-2 pb-1 text-[0.65rem] font-semibold tracking-wide uppercase">
              {t(section.labelKey)}
            </p>
          ) : (
            <div className="bg-line mx-2 my-2 h-px first:hidden" aria-hidden />
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isItemActive(item, pathname)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Wordmark({ collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
      <span className="bg-accent text-accent-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold">
        R
      </span>
      {!collapsed ? (
        <span className="min-w-0">
          <span className="text-fg block truncate text-sm font-semibold">{t("app.name")}</span>
          <span className="text-fg-subtle block truncate text-[0.65rem]">
            {t("app.console")}
          </span>
        </span>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <aside
      className={cx(
        "border-line bg-raised sticky top-0 hidden h-screen shrink-0 flex-col border-e lg:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cx(
          "border-line flex h-14 items-center border-b",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        <Wordmark collapsed={collapsed} />
        {!collapsed ? (
          <IconButton
            label={t("nav.collapse")}
            icon={<PanelLeftClose size={15} className="rtl:rotate-180" />}
            onClick={onToggle}
          />
        ) : null}
      </div>

      <NavTree collapsed={collapsed} />

      {collapsed ? (
        <div className="border-line flex justify-center border-t p-2">
          <IconButton
            label={t("nav.expand")}
            icon={<PanelLeftOpen size={15} className="rtl:rotate-180" />}
            onClick={onToggle}
          />
        </div>
      ) : (
        <div className="border-line border-t px-3 py-2.5">
          <ScopeSummary />
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useDismissable(open, onClose);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex bg-black/45 lg:hidden">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("app.console")}
        className="bg-raised border-line ros-fade-in flex h-full w-72 max-w-[85vw] flex-col border-e"
      >
        <div className="border-line flex h-14 items-center justify-between border-b px-4">
          <Wordmark />
          <IconButton label={t("nav.closeMenu")} icon={<X size={16} />} onClick={onClose} />
        </div>

        <NavTree onNavigate={onClose} />

        <div className="border-line space-y-3 border-t px-3 py-3">
          <ScopeSwitcher />
          <RoleSwitcher />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { t } = useI18n();

  return (
    <header className="border-line bg-raised/85 sticky top-0 z-50 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <IconButton
        label={t("nav.openMenu")}
        icon={<MenuIcon size={18} />}
        onClick={onOpenNav}
        className="lg:hidden"
      />

      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
        <ScopeSwitcher />
      </div>
      <div className="min-w-0 flex-1 sm:hidden" />

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden md:block">
          <RoleSwitcher />
        </div>
        <LanguageToggle />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/**
 * Redirects to the sign-in screen once hydration has confirmed there is no
 * session. `authenticated` is optimistically true before that, so the shell
 * renders on the server instead of flashing a redirect.
 */
function useAuthGuard() {
  const router = useRouter();
  const { authenticated } = useSession();

  useEffect(() => {
    if (!authenticated) router.replace("/login");
  }, [authenticated, router]);

  return authenticated;
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const authenticated = useAuthGuard();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY_COLLAPSED) === "true");
    } catch {
      // Storage is unavailable in private mode; the default stands.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(KEY_COLLAPSED, String(next));
      } catch {
        // Ignore — the preference simply will not persist.
      }
      return next;
    });
  };

  if (!authenticated) {
    return (
      <div className="text-fg-muted flex min-h-screen items-center justify-center text-sm">
        {t("auth.notSignedIn")}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#console-main"
        className="bg-accent text-accent-fg sr-only z-100 rounded-lg px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-3 focus:start-3"
      >
        {t("app.skipToContent")}
      </a>

      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main id="console-main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
