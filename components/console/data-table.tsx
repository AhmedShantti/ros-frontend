"use client";

/**
 * The table every list screen uses.
 *
 * It owns sorting affordances, the row states, and pagination; it does not
 * own the data. Pages hand it a `CollectionState` from `useCollection` (or
 * plain rows) and a column model, and nothing else.
 *
 * Alignment is logical throughout — `text-start`/`text-end` — so a numeric
 * column sits against the correct edge in both directions.
 */

import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from "lucide-react";
import type { CollectionState } from "@/lib/console/hooks";
import { formatNumber } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { EmptyPanel, ErrorPanel, TableSkeleton } from "./states";
import { Hint, Select, cx } from "./ui";

export interface Column<T> {
  /** Also the sort key sent to the service. */
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  /** Right-aligned and tabular in LTR, left-aligned in RTL. */
  numeric?: boolean;
  align?: "start" | "center" | "end";
  width?: string;
  /** A short definition shown beside the column head. */
  hint?: string;
  /** Dropped below `lg` — detail that is not worth a horizontal scroll. */
  secondary?: boolean;
  className?: string;
}

function alignClass<T>(column: Column<T>): string {
  const align = column.align ?? (column.numeric ? "end" : "start");
  if (align === "end") return "text-end";
  if (align === "center") return "text-center";
  return "text-start";
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Current sort, `key` ascending or `-key` descending. */
  sort?: string;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  /** Marks the row that a detail drawer is currently showing. */
  activeRowKey?: string | null;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  emptyAction?: ReactNode;
  footer?: ReactNode;
  caption?: string;
  dense?: boolean;
  /** A totals or subtotals row rendered inside <tfoot>. */
  totals?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  sort,
  onSort,
  onRowClick,
  activeRowKey,
  filtered,
  onClearFilters,
  emptyTitle,
  emptyBody,
  emptyAction,
  footer,
  caption,
  dense,
  totals,
}: DataTableProps<T>) {
  const { t } = useI18n();

  const showSkeleton = loading && rows.length === 0;
  const showError = Boolean(error) && !loading;
  const showEmpty = !showSkeleton && !showError && rows.length === 0;
  const cellPadding = dense ? "px-4 py-2" : "px-4 py-2.5";

  return (
    <div className="bg-raised border-line overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-line bg-sunken/60 border-b">
              {columns.map((column) => {
                const active = sort === column.key || sort === `-${column.key}`;
                const descending = sort === `-${column.key}`;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      active ? (descending ? "descending" : "ascending") : undefined
                    }
                    className={cx(
                      "text-fg-muted text-xs font-medium whitespace-nowrap",
                      cellPadding,
                      alignClass(column),
                      column.secondary && "hidden lg:table-cell",
                      column.className,
                    )}
                  >
                    <span
                      className={cx(
                        "inline-flex items-center gap-1",
                        (column.align ?? (column.numeric ? "end" : "start")) === "end" &&
                          "flex-row-reverse",
                      )}
                    >
                      {column.sortable && onSort ? (
                        <button
                          type="button"
                          onClick={() => onSort(column.key)}
                          className={cx(
                            "hover:text-fg inline-flex items-center gap-1 transition-colors",
                            active && "text-fg",
                          )}
                        >
                          {column.header}
                          {active ? (
                            descending ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronUp size={12} />
                            )
                          ) : (
                            <ChevronsUpDown size={12} className="opacity-40" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                      {column.hint ? <Hint text={column.hint} /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-line divide-y">
            {showSkeleton || showError || showEmpty ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {showSkeleton ? (
                    <TableSkeleton rows={6} columns={Math.min(columns.length, 6)} />
                  ) : showError ? (
                    <ErrorPanel error={error ?? null} onRetry={onRetry} compact />
                  ) : (
                    <EmptyPanel
                      compact
                      title={emptyTitle}
                      body={emptyBody}
                      filtered={filtered}
                      onClearFilters={onClearFilters}
                      action={emptyAction}
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const key = rowKey(row);
                const clickable = Boolean(onRowClick);
                return (
                  <tr
                    key={key}
                    tabIndex={clickable ? 0 : undefined}
                    aria-selected={activeRowKey === key ? true : undefined}
                    onClick={clickable ? () => onRowClick?.(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick?.(row);
                            }
                          }
                        : undefined
                    }
                    className={cx(
                      "transition-colors",
                      clickable && "hover:bg-sunken/70 cursor-pointer",
                      activeRowKey === key && "bg-accent-soft/60",
                      // A stale table under a pending request should look stale.
                      loading && "opacity-60",
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cx(
                          "text-fg align-middle",
                          cellPadding,
                          alignClass(column),
                          column.numeric && "font-mono tabular-nums",
                          column.secondary && "hidden lg:table-cell",
                          column.className,
                        )}
                      >
                        {column.render(row, index)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>

          {totals && rows.length > 0 ? (
            <tfoot className="border-line bg-sunken/60 border-t">{totals}</tfoot>
          ) : null}
        </table>
      </div>

      {footer ? <div className="border-line border-t">{footer}</div> : null}
      {loading && rows.length > 0 ? (
        <span className="sr-only" role="status">
          {t("state.loading")}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const { t, fmt } = useI18n();
  const number = (value: number) => formatNumber(value, fmt);

  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <p className="text-fg-muted text-xs">
        {t("common.showing")} {number(first)}–{number(last)} {t("common.of")} {number(total)}{" "}
        {t("common.results")}
      </p>

      <div className="flex items-center gap-3">
        {onPageSize ? (
          <label className="text-fg-muted flex items-center gap-2 text-xs">
            <span className="hidden sm:inline">{t("common.rowsPerPage")}</span>
            <Select
              value={pageSize}
              onChange={(event) => onPageSize(Number(event.target.value))}
              aria-label={t("common.rowsPerPage")}
              className="w-auto py-1 text-xs"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {number(size)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <PageButton
            label={t("common.previous")}
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            icon={<ChevronLeft size={15} className="rtl:rotate-180" />}
          />
          <span className="text-fg-muted px-1 text-xs tabular-nums">
            {number(page + 1)} {t("common.of")} {number(pageCount)}
          </span>
          <PageButton
            label={t("common.next")}
            disabled={page + 1 >= pageCount}
            onClick={() => onPage(page + 1)}
            icon={<ChevronRight size={15} className="rtl:rotate-180" />}
          />
        </div>
      </div>
    </div>
  );
}

function PageButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="border-line text-fg-muted hover:bg-sunken hover:text-fg inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collection binding
// ---------------------------------------------------------------------------

/**
 * `useCollection` + `DataTable` + `Pagination`, wired. This is what list
 * pages render; the unbound `DataTable` is for embedded tables that already
 * hold their rows (order lines, recipe components, a report result).
 */
export function CollectionTable<T>({
  collection,
  paginate = true,
  ...table
}: {
  collection: CollectionState<T>;
  paginate?: boolean;
} & Omit<
  DataTableProps<T>,
  "rows" | "loading" | "error" | "onRetry" | "sort" | "onSort" | "filtered" | "onClearFilters" | "footer"
>) {
  return (
    <DataTable
      {...table}
      rows={collection.rows}
      loading={collection.loading}
      error={collection.error}
      onRetry={collection.reload}
      sort={collection.sort}
      onSort={collection.toggleSort}
      filtered={collection.filtered}
      onClearFilters={collection.clearFilters}
      footer={
        paginate && collection.total > 0 ? (
          <Pagination
            page={collection.page}
            pageCount={collection.pageCount}
            pageSize={collection.pageSize}
            total={collection.total}
            onPage={collection.setPage}
            onPageSize={collection.setPageSize}
          />
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

/** Primary line with a quieter second line — the most common cell shape. */
export function CellStack({
  primary,
  secondary,
  mono,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={cx("text-fg truncate text-sm", mono && "font-mono")}>{primary}</div>
      {secondary ? (
        <div className="text-fg-subtle mt-0.5 truncate text-xs">{secondary}</div>
      ) : null}
    </div>
  );
}

/** A signed number that colours itself: over is bad, under is good. */
export function DeltaCell({
  value,
  children,
  invert,
}: {
  value: number;
  children: ReactNode;
  /** Set when a positive value is the good outcome. */
  invert?: boolean;
}) {
  const good = invert ? value > 0 : value < 0;
  const bad = invert ? value < 0 : value > 0;
  return (
    <span
      className={cx(
        "font-mono tabular-nums",
        value === 0 && "text-fg-muted",
        good && "text-good",
        bad && "text-bad",
      )}
    >
      {children}
    </span>
  );
}
