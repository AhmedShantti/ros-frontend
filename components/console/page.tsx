"use client";

/**
 * Page chrome: the header every screen opens with, and the toolbar that sits
 * above every collection.
 *
 * The header carries the requirement tag. That is deliberate — a screen that
 * cannot say which requirement it satisfies probably should not exist.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { CollectionState } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { Card, CardHeader, Select, SpecTag, cx } from "./ui";

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  subtitle,
  spec,
  actions,
  crumbs,
  meta,
}: {
  title: string;
  subtitle?: ReactNode;
  spec?: string;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Scope, business day, "data as of" — context, not navigation. */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-fg text-xl font-semibold tracking-tight">{title}</h1>
            {spec ? <SpecTag id={spec} /> : null}
          </div>
          {subtitle ? (
            <p className="text-fg-muted mt-1.5 max-w-3xl text-sm leading-relaxed">{subtitle}</p>
          ) : null}
          {meta ? (
            <div className="text-fg-subtle mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {meta}
            </div>
          ) : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="text-fg-subtle flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
            {index > 0 ? (
              <ChevronRight size={12} className="opacity-60 rtl:rotate-180" aria-hidden />
            ) : null}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-fg transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-fg-muted">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Vertical rhythm for a page body — every screen stacks its blocks the same. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("space-y-5", className)}>{children}</div>;
}

/** A titled card. `spec` puts the requirement tag in the corner. */
export function Section({
  title,
  hint,
  action,
  spec,
  children,
  padded = true,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  spec?: string;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <Card padded={padded} className={className}>
      {title ? (
        <div className={padded ? undefined : "px-5 pt-5"}>
          <CardHeader title={title} hint={hint} action={action} spec={spec} />
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/** Responsive grid for metric tiles and small panels. */
export function TileGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "grid gap-3",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export function Toolbar({
  children,
  actions,
  className,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    // Full width on its own line on a phone: sharing a wrapped flex row with
    // two filter selects squeezed the field down to about the width of its own
    // magnifier icon, which is a search box you cannot type in.
    <div className={cx("relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-xs", className)}>
      <Search
        size={14}
        aria-hidden
        className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3"
      />
      <input
        type="search"
        value={value}
        aria-label={label ?? t("common.search")}
        placeholder={placeholder ?? t("common.searchPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
        className="border-line bg-raised text-fg placeholder:text-fg-subtle focus:border-accent w-full rounded-lg border py-2 text-sm outline-none transition-colors ps-9 pe-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={t("common.clearFilters")}
          onClick={() => onChange("")}
          className="text-fg-subtle hover:text-fg absolute top-1/2 -translate-y-1/2 end-2.5"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** Copy for the "no filter" entry; defaults to "All". */
  allLabel?: string;
}

export function FilterSelect({
  filter,
  value,
  onChange,
}: {
  filter: FilterDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      aria-label={filter.label}
      value={value || "all"}
      onChange={(event) => onChange(event.target.value)}
      className="w-auto min-w-32 py-1.5 text-xs"
    >
      <option value="all">{filter.allLabel ?? `${filter.label}: ${t("common.all")}`}</option>
      {filter.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Search box, filter selects and a clear-all — bound to a `useCollection`
 * state so a list page declares its filters and nothing else.
 */
export function CollectionToolbar<T>({
  collection,
  filters = [],
  actions,
  searchPlaceholder,
  children,
}: {
  collection: CollectionState<T>;
  filters?: FilterDef[];
  actions?: ReactNode;
  searchPlaceholder?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Toolbar actions={actions}>
      <SearchInput
        value={collection.search}
        onChange={collection.setSearch}
        placeholder={searchPlaceholder}
      />

      {filters.map((filter) => (
        <FilterSelect
          key={filter.key}
          filter={filter}
          value={collection.filters[filter.key] ?? "all"}
          onChange={(value) => collection.setFilter(filter.key, value)}
        />
      ))}

      {children}

      {collection.filtered ? (
        <button
          type="button"
          onClick={collection.clearFilters}
          className="text-fg-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <SlidersHorizontal size={12} />
          {t("common.clearFilters")}
        </button>
      ) : null}
    </Toolbar>
  );
}
