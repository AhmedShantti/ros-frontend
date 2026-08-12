"use client";

/**
 * The three switchers in the topbar.
 *
 * Scope (brand → branch) is a data control: it changes what every query
 * returns. Role is a demo control: it swaps the permission set so the whole
 * console can be explored from any seat. Preferences are per-device.
 */

import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  Languages,
  LogOut,
  Lock,
  Monitor,
  Moon,
  Store,
  Sun,
  UserCog,
} from "lucide-react";
import { ROLE_DEFINITIONS, ROLE_KEYS, roleRequiresMfa } from "@/lib/console/permissions";
import { initials } from "@/lib/console/format";
import { useI18n, usePreferences, useSession } from "@/lib/console/providers";
import {
  Badge,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Toggle,
  cx,
} from "./ui";

const TRIGGER_CLASS =
  "border-line bg-raised text-fg hover:bg-sunken inline-flex max-w-52 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export function ScopeSwitcher() {
  const { t, tx } = useI18n();
  const {
    brand,
    branch,
    availableBrands,
    availableBranches,
    scopeLocked,
    setBrandId,
    setBranchId,
  } = useSession();

  if (scopeLocked) {
    return (
      <div
        className="border-line bg-sunken text-fg-muted inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
        title={t("scope.locked")}
      >
        <Lock size={13} className="shrink-0" />
        <span className="truncate">{tx(branch?.name) || t("scope.allBranches")}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Menu
        label={t("scope.brand")}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className={TRIGGER_CLASS}>
            <Store size={13} className="text-fg-subtle shrink-0" />
            <span className="truncate">{tx(brand?.name) || t("scope.allBrands")}</span>
            <ChevronDown size={13} className="text-fg-subtle shrink-0" />
          </button>
        )}
      >
        <MenuLabel>{t("scope.brand")}</MenuLabel>
        <MenuItem selected={brand === null} onSelect={() => setBrandId(null)}>
          {t("scope.allBrands")}
        </MenuItem>
        {availableBrands.map((option) => (
          <MenuItem
            key={option.id}
            selected={brand?.id === option.id}
            onSelect={() => setBrandId(option.id)}
          >
            {tx(option.name)}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        label={t("scope.branch")}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className={TRIGGER_CLASS}>
            <Building2 size={13} className="text-fg-subtle shrink-0" />
            <span className="truncate">{tx(branch?.name) || t("scope.allBranches")}</span>
            <ChevronDown size={13} className="text-fg-subtle shrink-0" />
          </button>
        )}
      >
        <MenuLabel>{t("scope.branch")}</MenuLabel>
        <MenuItem selected={branch === null} onSelect={() => setBranchId(null)}>
          {t("scope.allBranches")}
        </MenuItem>
        {availableBranches.map((option) => (
          <MenuItem
            key={option.id}
            selected={branch?.id === option.id}
            onSelect={() => setBranchId(option.id)}
          >
            {tx(option.name)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/** Demo affordance: every standard role, one click away. */
export function RoleSwitcher({ compact }: { compact?: boolean }) {
  const { t, tx } = useI18n();
  const { roleKey, setRole } = useSession();

  return (
    <Menu
      label={t("pref.switchRole")}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} className={TRIGGER_CLASS} title={t("pref.switchRole")}>
          <UserCog size={13} className="text-fg-subtle shrink-0" />
          {!compact ? (
            <span className="truncate">{tx(ROLE_DEFINITIONS[roleKey].name)}</span>
          ) : null}
          <ChevronDown size={13} className="text-fg-subtle shrink-0" />
        </button>
      )}
    >
      <MenuLabel>{t("pref.switchRole")}</MenuLabel>
      {ROLE_KEYS.map((key) => (
        <MenuItem key={key} selected={key === roleKey} onSelect={() => setRole(key)}>
          <span className="flex items-center gap-2">
            {tx(ROLE_DEFINITIONS[key].name)}
            {roleRequiresMfa(key) ? (
              <span className="text-fg-subtle font-mono text-[0.6rem] uppercase">mfa</span>
            ) : null}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Preferences and account
// ---------------------------------------------------------------------------

export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, resolvedTheme, setTheme } = usePreferences();

  const options = [
    { value: "light" as const, label: t("pref.light"), icon: <Sun size={14} /> },
    { value: "dark" as const, label: t("pref.dark"), icon: <Moon size={14} /> },
    { value: "system" as const, label: t("pref.system"), icon: <Monitor size={14} /> },
  ];

  return (
    <Menu
      label={t("pref.theme")}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("pref.toggleTheme")}
          title={t("pref.theme")}
          className="text-fg-muted hover:bg-sunken hover:text-fg inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
        >
          {resolvedTheme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      )}
    >
      <MenuLabel>{t("pref.theme")}</MenuLabel>
      {options.map((option) => (
        <MenuItem
          key={option.value}
          icon={option.icon}
          selected={theme === option.value}
          onSelect={() => setTheme(option.value)}
        >
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function LanguageToggle() {
  const { t, locale } = useI18n();
  const { setLocale, arabicIndicNumerals, setArabicIndicNumerals } = usePreferences();

  return (
    <Menu
      label={t("pref.language")}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("pref.language")}
          title={t("pref.language")}
          className="text-fg-muted hover:bg-sunken hover:text-fg inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
        >
          <Languages size={15} />
          <span className="font-mono uppercase">{locale}</span>
        </button>
      )}
    >
      <MenuLabel>{t("pref.language")}</MenuLabel>
      <MenuItem selected={locale === "en"} onSelect={() => setLocale("en")}>
        English
      </MenuItem>
      <MenuItem selected={locale === "ar"} onSelect={() => setLocale("ar")}>
        العربية
      </MenuItem>
      <MenuSeparator />
      <div className="px-2.5 pb-1">
        <Toggle
          label={t("pref.numerals")}
          hint={arabicIndicNumerals ? t("pref.numeralsArabic") : t("pref.numeralsWestern")}
          checked={arabicIndicNumerals}
          onChange={setArabicIndicNumerals}
        />
      </div>
    </Menu>
  );
}

export function AccountMenu() {
  const router = useRouter();
  const { t, tx } = useI18n();
  const { session, roleKey, signOut } = useSession();

  const definition = ROLE_DEFINITIONS[roleKey];
  const name = session ? tx(session.user.name) : tx(definition.name);
  const permissionCount = session?.permissions.size ?? definition.permissions.length;

  return (
    <Menu
      label={t("pref.account")}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("pref.account")}
          className="bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors"
        >
          {initials(name)}
        </button>
      )}
    >
      <div className="px-2.5 py-2">
        <p className="text-fg truncate text-sm font-medium">{name}</p>
        <p className="text-fg-subtle truncate text-xs">{session?.user.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{tx(definition.name)}</Badge>
          <span className="text-fg-subtle text-[0.68rem]">
            {permissionCount} {t("pref.permissions")}
          </span>
        </div>
        {roleRequiresMfa(roleKey) ? (
          <p className="text-fg-subtle mt-2 text-[0.68rem] leading-relaxed">
            {t("auth.mfaRequired")}
          </p>
        ) : null}
      </div>

      <MenuSeparator />

      <MenuItem
        icon={<LogOut size={14} />}
        onSelect={() => {
          signOut();
          router.replace("/login");
        }}
      >
        {t("auth.signOut")}
      </MenuItem>
    </Menu>
  );
}

/** Compact scope read-out for the mobile drawer, where menus are cramped. */
export function ScopeSummary({ className }: { className?: string }) {
  const { t, tx } = useI18n();
  const { brand, branch, scopeLocked } = useSession();

  return (
    <div className={cx("text-fg-subtle flex items-center gap-1.5 text-xs", className)}>
      {scopeLocked ? <Lock size={11} /> : <Check size={11} className="opacity-0" />}
      <span className="truncate">
        {t("scope.viewing")}: {tx(brand?.name) || t("scope.allBrands")} ·{" "}
        {tx(branch?.name) || t("scope.allBranches")}
      </span>
    </div>
  );
}
