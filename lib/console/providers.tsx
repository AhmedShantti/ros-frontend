"use client";

/**
 * Console providers — preferences (language, numerals, theme) and session
 * (demo role, tenant/brand/branch scope).
 *
 * Two things worth noting:
 *
 *  1. `dir` and `lang` are written onto the console's own wrapper element as
 *     well as onto <html>. The wrapper is what makes logical properties
 *     (`ps-*`, `border-s`, `start-*`) resolve correctly during the first
 *     paint, before any effect has run.
 *
 *  2. The permission helpers here decide what to *render*. They are not a
 *     security control — FR-SEC-045 is explicit that client-side checks are
 *     presentation only and the server authorises every request.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { consoleEn, type ConsoleKey } from "@/content/console/en";
import { consoleAr } from "@/content/console/ar";
import type {
  Branch,
  Brand,
  Direction,
  Locale,
  Localised,
  Session,
  Tenant,
} from "./types";
import type { PermissionKey, RoleKey } from "./permissions";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "./permissions";
import { buildSession } from "./mock/governance";
import {
  ACTIVE_TENANT_ID,
  branches as mockBranches,
  brands as mockBrands,
  tenants,
} from "./mock/org";
import type { FormatOptions } from "./format";
import { tx } from "./format";
import type { Scope } from "./services";
import { DATA_MODE } from "@/lib/api/config";
import { signOut as apiSignOut } from "@/lib/api/auth";
import { useLiveOrgContext, type LiveOrgContext } from "./live-session";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_LOCALE = "ros.console.locale";
const KEY_NUMERALS = "ros.console.numerals";
const KEY_THEME = "ros.console.theme";
const KEY_ROLE = "ros.console.role";
const KEY_BRAND = "ros.console.brand";
const KEY_BRANCH = "ros.console.branch";
const KEY_AUTH = "ros.console.auth";
const KEY_MFA = "ros.console.mfa";

export const THEME_STORAGE_KEY = KEY_THEME;

export type ThemeChoice = "light" | "dark" | "system";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private-mode storage failures must never break the UI.
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

interface PreferencesValue extends FormatOptions {
  locale: Locale;
  dir: Direction;
  theme: ThemeChoice;
  resolvedTheme: "light" | "dark";
  arabicIndicNumerals: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeChoice) => void;
  setArabicIndicNumerals: (on: boolean) => void;
  /** Translate a dictionary key. */
  t: (key: ConsoleKey) => string;
  /** Pick the right side of a localised value from the data. */
  tx: (value: Localised | null | undefined) => string;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

const dictionaries: Record<Locale, Record<string, string>> = {
  en: consoleEn,
  ar: consoleAr,
};

function PreferencesProvider({ children }: { children: ReactNode }) {
  // English is the default for the console; the marketing site defaults to
  // Arabic. Both directions are first-class — FR-LOC-003.
  const [locale, setLocaleState] = useState<Locale>("en");
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [arabicIndicNumerals, setNumeralsState] = useState(false);

  useEffect(() => {
    const storedLocale = read(KEY_LOCALE);
    if (storedLocale === "en" || storedLocale === "ar") setLocaleState(storedLocale);

    const storedTheme = read(KEY_THEME);
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      setThemeState(storedTheme);
    }

    const storedNumerals = read(KEY_NUMERALS);
    if (storedNumerals !== null) setNumeralsState(storedNumerals === "true");
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const dir: Direction = locale === "ar" ? "rtl" : "ltr";

  // Keep <html> in step so native scrollbars, form controls and the browser's
  // own UI agree with the app.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dir;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
    return () => {
      root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  }, [locale, dir, resolvedTheme]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    write(KEY_LOCALE, next);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    write(KEY_THEME, next);
  }, []);

  const setArabicIndicNumerals = useCallback((on: boolean) => {
    setNumeralsState(on);
    write(KEY_NUMERALS, String(on));
  }, []);

  const value = useMemo<PreferencesValue>(() => {
    const dictionary = dictionaries[locale];
    const fallback = dictionaries.en;
    return {
      locale,
      dir,
      theme,
      resolvedTheme,
      arabicIndicNumerals,
      setLocale,
      setTheme,
      setArabicIndicNumerals,
      // FR-LOC-007 — fall back to the other language rather than show a key.
      t: (key) => dictionary[key] || fallback[key] || key,
      tx: (localised) => tx(localised, locale),
    };
  }, [
    locale,
    dir,
    theme,
    resolvedTheme,
    arabicIndicNumerals,
    setLocale,
    setTheme,
    setArabicIndicNumerals,
  ]);

  return (
    <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside <ConsoleProvider>");
  return ctx;
}

/** Shorthand: `const { t, tx, fmt } = useI18n()`. */
export function useI18n() {
  const prefs = usePreferences();
  return {
    t: prefs.t,
    tx: prefs.tx,
    locale: prefs.locale,
    dir: prefs.dir,
    fmt: {
      locale: prefs.locale,
      arabicIndicNumerals: prefs.arabicIndicNumerals,
    } satisfies FormatOptions,
  };
}

// ---------------------------------------------------------------------------
// Session and scope
// ---------------------------------------------------------------------------

interface SessionValue {
  session: Session | null;
  authenticated: boolean;
  roleKey: RoleKey;
  tenant: Tenant;
  brand: Brand | null;
  branch: Branch | null;
  scope: Scope;
  availableBrands: Brand[];
  availableBranches: Branch[];
  /** True when the role is pinned to one branch and cannot widen its view. */
  scopeLocked: boolean;
  /**
   * The live organisation context, when the app is talking to a backend.
   * `ready` is false while it loads, which is what the shell waits on before
   * it renders a scope switcher that would otherwise be empty.
   */
  org: LiveOrgContext;
  signIn: (roleKey: RoleKey, mfaSatisfied: boolean) => void;
  signOut: () => void;
  setRole: (roleKey: RoleKey) => void;
  setBrandId: (brandId: string | null) => void;
  setBranchId: (branchId: string | null) => void;
  can: (permission: PermissionKey) => boolean;
  canAny: (permissions: PermissionKey[]) => boolean;
  canAll: (permissions: PermissionKey[]) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const [roleKey, setRoleKey] = useState<RoleKey>("owner");
  const [authenticated, setAuthenticated] = useState(false);
  const [brandId, setBrandIdState] = useState<string | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  /**
   * FR-SEC-024 — whether this session actually cleared the MFA challenge.
   *
   * `buildSession` has always taken this, and `signIn` has always declared it
   * in its type — but the implementation ignored the argument and the session
   * was built with a hardcoded `true`. Every session therefore claimed to
   * have passed a check that only the MFA screen performs.
   *
   * Nothing gates on it yet, so this changes no behaviour today. It changes
   * whether the field can be trusted the moment something does.
   */
  const [mfaSatisfied, setMfaSatisfied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedRole = read(KEY_ROLE);
    if (storedRole && storedRole in ROLE_DEFINITIONS) {
      setRoleKey(storedRole as RoleKey);
    }
    setAuthenticated(read(KEY_AUTH) === "true");
    setMfaSatisfied(read(KEY_MFA) === "true");

    const storedBrand = read(KEY_BRAND);
    const storedBranch = read(KEY_BRANCH);
    if (storedBrand) setBrandIdState(storedBrand === "all" ? null : storedBrand);
    if (storedBranch) setBranchIdState(storedBranch === "all" ? null : storedBranch);

    setHydrated(true);
  }, []);

  const live = DATA_MODE === "http";

  const session = useMemo(
    () => (authenticated ? buildSession(roleKey, mfaSatisfied) : null),
    [authenticated, roleKey, mfaSatisfied],
  );

  // The real tenant, brands, branches and permission codes behind the token.
  // In demo mode this stays inert and everything below falls back to the
  // fixtures, exactly as before.
  const org = useLiveOrgContext(authenticated);

  const definition = ROLE_DEFINITIONS[roleKey];

  /**
   * Which org the switchers offer.
   *
   * Against a backend these MUST be the real rows: `services` filters every
   * list by `scope.branchId`, so offering a fixture id here would filter
   * real data down to nothing without reporting an error.
   */
  const brands = live ? org.brands : mockBrands;
  const branches = live ? org.branches : mockBranches;

  /**
   * A branch-scoped role sees exactly one branch. A brand-scoped role may
   * move between the branches of its brands. FR-SEC-002/004.
   *
   * Live, the role is a *guess* — `roleFromPermissions` picks the closest
   * fixture role to the granted codes — and the branch it would pin to is a
   * fixture id that does not exist on the backend. So nothing is pinned:
   * the user picks from the real branches and the server authorises the
   * request, which is where the decision belongs anyway (FR-SEC-045).
   */
  const scopeLocked = live ? false : definition.defaultScope === "branch";

  const effectiveBrandId = scopeLocked
    ? (branches.find((b) => b.id === (session?.branchId ?? branchId))?.brandId ?? brandId)
    : brandId;

  const effectiveBranchId = scopeLocked ? (session?.branchId ?? branchId) : branchId;

  const availableBrands = useMemo(() => {
    // Live: the backend already returns only the brands this token may read.
    if (live) return brands;
    if (definition.defaultScope === "tenant") return brands;
    const assignment = session?.user.assignments[0];
    if (!assignment || assignment.scopeIds.length === 0) return brands;
    const brandIds = new Set(assignment.scopeIds.filter((s) => s.startsWith("brd")));
    const branchBrandIds = new Set(
      assignment.scopeIds
        .filter((s) => s.startsWith("brn"))
        .map((s) => branches.find((b) => b.id === s)?.brandId)
        .filter(Boolean) as string[],
    );
    const allowed = new Set([...brandIds, ...branchBrandIds]);
    return allowed.size === 0 ? brands : brands.filter((b) => allowed.has(b.id));
  }, [live, brands, branches, definition.defaultScope, session]);

  const availableBranches = useMemo(() => {
    let list = branches;
    if (effectiveBrandId) list = list.filter((b) => b.brandId === effectiveBrandId);
    if (live) return list;
    const assignment = session?.user.assignments[0];
    if (assignment && assignment.scopeLevel === "branch_set" && assignment.scopeIds.length > 0) {
      const allowed = new Set(assignment.scopeIds);
      list = list.filter((b) => allowed.has(b.id));
    }
    if (scopeLocked && effectiveBranchId) {
      list = branches.filter((b) => b.id === effectiveBranchId);
    }
    return list;
  }, [live, branches, effectiveBrandId, effectiveBranchId, scopeLocked, session]);

  /**
   * Drop a stored scope that this tenant does not contain.
   *
   * `ros.console.brand` / `.branch` survive a sign-out, so a browser that
   * once ran the demo carries fixture ids into a live session — where they
   * match no row, and `project()` filters every table to empty with nothing
   * on screen to explain it. Anything the real org does not list is cleared.
   */
  useEffect(() => {
    if (!live || !org.ready) return;

    if (brandId && !org.brands.some((b) => b.id === brandId)) {
      setBrandIdState(null);
      write(KEY_BRAND, "all");
    }
    if (branchId && !org.branches.some((b) => b.id === branchId)) {
      setBranchIdState(null);
      write(KEY_BRANCH, "all");
    }
  }, [live, org.ready, org.brands, org.branches, brandId, branchId]);

  const setBrandId = useCallback((next: string | null) => {
    setBrandIdState(next);
    setBranchIdState(null);
    write(KEY_BRAND, next ?? "all");
    write(KEY_BRANCH, "all");
  }, []);

  const setBranchId = useCallback((next: string | null) => {
    setBranchIdState(next);
    write(KEY_BRANCH, next ?? "all");
  }, []);

  const setRole = useCallback((next: RoleKey) => {
    setRoleKey(next);
    write(KEY_ROLE, next);
    // A new role has a new scope; reset rather than carry a stale one over.
    setBrandIdState(null);
    setBranchIdState(null);
    write(KEY_BRAND, "all");
    write(KEY_BRANCH, "all");
  }, []);

  const signIn = useCallback(
    (next: RoleKey, satisfiedMfa: boolean) => {
      setRoleKey(next);
      setAuthenticated(true);
      setMfaSatisfied(satisfiedMfa);
      write(KEY_ROLE, next);
      write(KEY_AUTH, "true");
      write(KEY_MFA, satisfiedMfa ? "true" : "false");
    },
    [],
  );

  const signOut = useCallback(() => {
    setAuthenticated(false);
    setMfaSatisfied(false);
    write(KEY_AUTH, "false");
    write(KEY_MFA, "false");
    // The scope belonged to the session that just ended; carrying it into
    // the next one is how a fixture id ends up scoping a live tenant.
    setBrandIdState(null);
    setBranchIdState(null);
    write(KEY_BRAND, "all");
    write(KEY_BRANCH, "all");

    if (DATA_MODE === "http") {
      // Revokes the refresh token server-side and clears the stored pair.
      // Fire-and-forget: `apiSignOut` already swallows a token that cannot
      // be revoked twice, and the UI must not wait on the network to sign
      // someone out.
      void apiSignOut();
    }
  }, []);

  /**
   * What `can()` actually consults.
   *
   * Live, the authority is `GET /auth/permissions`. But the server issues its
   * own flat codes and there is no published mapping to this console's
   * catalogue, so trusting the granted set blindly would hide the entire
   * navigation the moment the two vocabularies differ. The set is therefore
   * only believed once it demonstrably speaks the same language — at least
   * one granted code matching a key we know. Otherwise the role heuristic
   * stands in, which is what shipped before this and is no less safe:
   * hiding a control is presentation, and the server authorises regardless
   * (FR-SEC-045).
   */
  const granted = useMemo(() => {
    if (!live || !org.ready || org.permissions.size === 0) return null;

    const normalise = (code: string) => code.toLowerCase().replace(/[:/]/g, ".");
    const codes = new Set([...org.permissions].map(normalise));
    const shared = ALL_PERMISSIONS.some((key) => codes.has(key));

    return shared ? codes : null;
  }, [live, org.ready, org.permissions]);

  const value = useMemo<SessionValue>(() => {
    const rolePermissions = session?.permissions ?? new Set<PermissionKey>();
    const has = (permission: PermissionKey) =>
      granted ? granted.has(permission) : rolePermissions.has(permission);

    const tenant = (live ? org.tenant : null) ?? tenants.find((t) => t.id === ACTIVE_TENANT_ID)!;

    return {
      session,
      // Before hydration we assume signed-in, so the shell renders on the
      // server rather than flashing the sign-in redirect.
      authenticated: hydrated ? authenticated : true,
      roleKey,
      tenant,
      brand: brands.find((b) => b.id === effectiveBrandId) ?? null,
      branch: branches.find((b) => b.id === effectiveBranchId) ?? null,
      scope: {
        tenantId: tenant.id,
        brandId: effectiveBrandId,
        branchId: effectiveBranchId,
      },
      availableBrands,
      availableBranches,
      scopeLocked,
      org,
      signIn,
      signOut,
      setRole,
      setBrandId,
      setBranchId,
      can: has,
      canAny: (list) => list.length === 0 || list.some(has),
      canAll: (list) => list.every(has),
    };
  }, [
    session,
    hydrated,
    authenticated,
    roleKey,
    live,
    org,
    granted,
    brands,
    branches,
    effectiveBrandId,
    effectiveBranchId,
    availableBrands,
    availableBranches,
    scopeLocked,
    signIn,
    signOut,
    setRole,
    setBrandId,
    setBranchId,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <ConsoleProvider>");
  return ctx;
}

/** Convenience for the very common `can(...)` check. */
export function usePermission(permission: PermissionKey): boolean {
  return useSession().can(permission);
}

// ---------------------------------------------------------------------------

export function ConsoleProvider({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <SessionProvider>{children}</SessionProvider>
    </PreferencesProvider>
  );
}

/**
 * Applies `dir`/`lang` to the console subtree so the first server-rendered
 * paint is already correct, and marks the subtree for the console-only CSS
 * in globals.css.
 */
export function ConsoleRoot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { locale, dir } = useI18n();
  return (
    <div
      className={`ros-console text-fg ${className ?? ""}`}
      dir={dir}
      lang={locale}
    >
      {children}
    </div>
  );
}
