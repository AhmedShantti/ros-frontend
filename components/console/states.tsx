"use client";

/**
 * The four states every screen in this console has to be able to show:
 * loading, empty, failed, and not-permitted.
 *
 * They are components rather than ad-hoc markup because the rule is uniform —
 * a Storekeeper opening a finance screen should see the same explanation
 * everywhere, and an outage should read the same on a table as on a chart.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock, PlugZap, RotateCw, SearchX } from "lucide-react";
import type { PermissionKey } from "@/lib/console/permissions";
import type { AsyncState } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { Button, Callout, Card, Skeleton, cx } from "./ui";

// ---------------------------------------------------------------------------
// Shared frame
// ---------------------------------------------------------------------------

export function StatePanel({
  icon,
  title,
  body,
  action,
  footer,
  compact,
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-10" : "py-16",
      )}
    >
      <div className="bg-sunken text-fg-subtle mb-3 flex h-10 w-10 items-center justify-center rounded-full">
        {icon}
      </div>
      <p className="text-fg text-sm font-semibold">{title}</p>
      {body ? (
        <div className="text-fg-muted mt-1.5 max-w-md text-xs leading-relaxed">{body}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
      {footer ? <div className="mt-5 w-full max-w-md">{footer}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function LoadingPanel({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "text-fg-muted flex items-center justify-center gap-2 text-xs",
        compact ? "py-8" : "py-16",
      )}
    >
      <span className="ros-skeleton h-2 w-2 rounded-full" />
      {t("state.loadingData")}
    </div>
  );
}

/** Placeholder rows that keep the table's geometry while data is in flight. */
export function TableSkeleton({
  rows = 8,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="divide-line divide-y" aria-hidden>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cx(
                "h-3",
                colIndex === 0 ? "w-40" : colIndex === columns - 1 ? "w-16" : "w-24",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a metric tile or a chart panel. */
export function CardSkeleton({ height = 220 }: { height?: number }) {
  return (
    <Card>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-4 w-full" />
      <div className="mt-4" style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    </Card>
  );
}

export function MetricSkeleton() {
  return (
    <Card>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-32" />
      <Skeleton className="mt-3 h-2 w-20" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

/**
 * Two different emptinesses: nothing exists yet, or a filter hid everything.
 * The second one gets a way out, because "no results" with no escape is a
 * dead end.
 */
export function EmptyPanel({
  title,
  body,
  filtered,
  onClearFilters,
  action,
  compact,
}: {
  title?: string;
  body?: ReactNode;
  filtered?: boolean;
  onClearFilters?: () => void;
  action?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <StatePanel
      compact={compact}
      icon={filtered ? <SearchX size={18} /> : <Inbox size={18} />}
      title={title ?? (filtered ? t("common.noResults") : t("state.emptyTitle"))}
      body={body ?? t("state.emptyBody")}
      action={
        action ??
        (filtered && onClearFilters ? (
          <Button size="sm" onClick={onClearFilters}>
            {t("state.emptyAction")}
          </Button>
        ) : null)
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** `ServiceError` carries a stable code; a plain Error does not. */
function codeOf(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** The detail line a `ServiceError` carries, naming the absent endpoint. */
function detailOf(error: unknown): string | null {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    return typeof detail === "string" && detail.trim() ? detail : null;
  }
  return null;
}

/** True when the failure is "the server does not do this", not "it broke". */
export function isUnsupported(error: unknown): boolean {
  return codeOf(error) === "NOT_IMPLEMENTED";
}

/**
 * A domain the connected backend has no endpoint for.
 *
 * This is deliberately not an error: nothing went wrong, the feature simply
 * is not there. It exists so that a screen with no source of truth shows
 * that plainly instead of falling back to invented rows — the console never
 * substitutes sample data for a live deployment.
 */
export function UnsupportedPanel({
  detail,
  compact,
}: {
  detail?: string | null;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <StatePanel
      compact={compact}
      icon={<PlugZap size={18} />}
      title={t("state.unsupportedTitle")}
      body={
        <>
          {t("state.unsupportedBody")}
          {detail ? (
            <span className="border-line text-fg-subtle mt-2 block rounded border px-2 py-1 font-mono text-[0.62rem] leading-relaxed break-words">
              {t("state.unsupportedDetail")}: {detail}
            </span>
          ) : null}
        </>
      }
    />
  );
}

export function ErrorPanel({
  error,
  onRetry,
  compact,
}: {
  error: Error | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const code = codeOf(error);

  // "No such endpoint" is not an outage and retrying cannot help.
  if (isUnsupported(error)) {
    return <UnsupportedPanel detail={detailOf(error)} compact={compact} />;
  }

  return (
    <StatePanel
      compact={compact}
      icon={<AlertTriangle size={18} className="text-bad" />}
      title={t("state.errorTitle")}
      body={
        <>
          {error?.message}
          {code ? (
            <span className="border-line text-fg-subtle ms-2 rounded border px-1.5 py-0.5 font-mono text-[0.62rem] tracking-wide uppercase">
              {code}
            </span>
          ) : null}
        </>
      }
      action={
        onRetry ? (
          <Button size="sm" icon={<RotateCw size={13} />} onClick={onRetry}>
            {t("state.errorRetry")}
          </Button>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Permission and not-found
// ---------------------------------------------------------------------------

export function PermissionDenied({
  permission,
  compact,
}: {
  permission?: PermissionKey | PermissionKey[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const required = permission ? (Array.isArray(permission) ? permission : [permission]) : [];

  return (
    <StatePanel
      compact={compact}
      icon={<Lock size={18} />}
      title={t("state.deniedTitle")}
      body={t("state.deniedBody")}
      footer={
        <div className="space-y-3">
          {required.length > 0 ? (
            <div className="text-fg-subtle flex flex-wrap items-center justify-center gap-1.5 text-[0.68rem]">
              <span>{t("state.deniedPermission")}</span>
              {required.map((key) => (
                <code
                  key={key}
                  className="border-line bg-sunken text-fg-muted rounded border px-1.5 py-0.5 font-mono"
                >
                  {key}
                </code>
              ))}
            </div>
          ) : null}
          <Callout tone="muted">{t("state.serverNote")}</Callout>
        </div>
      }
    />
  );
}

export function NotFoundPanel({ action }: { action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <StatePanel
      icon={<SearchX size={18} />}
      title={t("state.notFoundTitle")}
      body={t("state.notFoundBody")}
      action={action}
    />
  );
}

// ---------------------------------------------------------------------------
// Gates and boundaries
// ---------------------------------------------------------------------------

/**
 * Renders `children` only when the session holds one of `permissions`.
 * Presentation only — FR-SEC-045 puts the actual authorisation on the server.
 */
export function Gate({
  permissions,
  children,
  fallback,
  silent,
}: {
  permissions: PermissionKey | PermissionKey[];
  children: ReactNode;
  fallback?: ReactNode;
  /** Hide entirely instead of explaining — for buttons and menu entries. */
  silent?: boolean;
}) {
  const { canAny } = useSession();
  const required = Array.isArray(permissions) ? permissions : [permissions];

  if (canAny(required)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (silent) return null;
  return <PermissionDenied permission={required} />;
}

/**
 * Resolves one `useAsync` result into exactly one of the four states, so a
 * page body reads as `<AsyncPanel state={dashboard}>{(data) => …}</AsyncPanel>`
 * rather than a ladder of early returns.
 */
export function AsyncPanel<T>({
  state,
  children,
  skeleton,
  isEmpty,
  empty,
}: {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}) {
  if (state.loading && state.data === null) {
    return <>{skeleton ?? <LoadingPanel />}</>;
  }
  if (state.error) {
    return <ErrorPanel error={state.error} onRetry={state.reload} />;
  }
  if (state.data === null) {
    return <>{empty ?? <EmptyPanel />}</>;
  }
  if (isEmpty?.(state.data)) {
    return <>{empty ?? <EmptyPanel />}</>;
  }
  return <>{children(state.data)}</>;
}
