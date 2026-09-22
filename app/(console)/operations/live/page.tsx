"use client";

/**
 * Live Operations — LIVE-OPERATIONS-P0.
 *
 * A branch-level cockpit assembled ENTIRELY from three feeds the Console
 * already owns, unchanged:
 *
 *   - Open Orders  — `useBranchOpenOrders`, the same `fetchAllOpenOrders`
 *     walk (`GET /orders/history?state=open`, `pos.order.view_history`)
 *     `/operations/open-orders` runs, branch-gated the way this cockpit
 *     requires (see that hook's own doc comment in `lib/console/feeds.ts`).
 *   - Tables       — `useTableStatus`, the same `GET /orders/tables/status`
 *     `/operations/table-status` reads.
 *   - Kitchen       — `useKitchenQueue`, the same manager-safe
 *     `GET /kitchen/branches/{id}/queue` (`kitchen.queue.view`)
 *     `/operations/kitchen` reads — never the KDS terminal's own
 *     `GET /kds/stations/{id}/queue`, and no KDS session is ever touched.
 *
 * No new alerting engine: "Attention Needed" is nothing but a merged read
 * of what those three feeds already returned — a delayed kitchen ticket, a
 * table the backend itself flagged `ambiguous`, or an open order the
 * backend itself put in `partially_paid`. Nothing here is inferred, and no
 * richer state (offline terminal, seated-too-long, cleaning required, bill
 * requested, abandoned table) is invented.
 *
 * Branch selection mirrors `operations/kitchen/page.tsx` and
 * `operations/table-status/page.tsx` exactly: never a silent default to
 * the first branch while the Console scope is "All branches" — an
 * explicit prompt instead, and none of the three feeds is ever asked for
 * data until a concrete branch is chosen.
 *
 * Each card is gated on the one real permission its own source page
 * already requires — `pos.order.view_history` for Open Orders/Tables,
 * `kitchen.queue.view` for Kitchen — so a principal holding only one of
 * the two still sees the card(s) they ARE authorised for. No combined
 * permission is introduced anywhere; the page itself only requires EITHER
 * (`canAny`), matching its nav entry.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  useBranchOpenOrders,
  useKitchenQueue,
  useTableStatus,
  type BranchOpenOrdersFeed,
  type KitchenQueueFeed,
  type TableStatusFeed,
} from "@/lib/console/feeds";
import type { Id, KitchenQueueTicket } from "@/lib/console/types";
import type { TableStatusRow } from "@/lib/console/services/types";
import { formatElapsed, formatNumber } from "@/lib/console/format";
import { ORDER_STATE } from "@/lib/console/labels";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { LiveNotice } from "@/components/console/live-panels";
import { ErrorPanel, Gate, LoadingPanel, PermissionDenied } from "@/components/console/states";
import { Badge, Callout, Card, CardHeader, Field, Select } from "@/components/console/ui";

const OPEN_ORDERS_PERMISSIONS = ["pos.order.view_history"] as const;
const KITCHEN_PERMISSIONS = ["kitchen.queue.view"] as const;

export default function LiveOperationsPage() {
  return (
    <Gate permissions={[...OPEN_ORDERS_PERMISSIONS, ...KITCHEN_PERMISSIONS]}>
      <LiveOperationsScreen />
    </Gate>
  );
}

function LiveOperationsScreen() {
  const { t, tx } = useI18n();
  const { scope, availableBranches, canAny } = useSession();

  const singleAuthorizedBranch = availableBranches.length === 1 ? availableBranches[0]! : null;
  const contextBranchId = scope.branchId ?? singleAuthorizedBranch?.id ?? null;
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = contextBranchId ?? (pickedBranchId || null);

  const canOrders = canAny([...OPEN_ORDERS_PERMISSIONS]);
  const canKitchen = canAny([...KITCHEN_PERMISSIONS]);

  // Each hook still runs unconditionally (a hook cannot be called
  // conditionally); passing `null` when the card is unauthorised is what
  // `useKitchenQueue`/`useTableStatus`/`useBranchOpenOrders` already treat
  // as "no concrete branch" — no request goes out.
  const openOrders = useBranchOpenOrders(canOrders ? branchId : null);
  const tables = useTableStatus(canOrders ? branchId : null);
  const kitchen = useKitchenQueue(canKitchen ? branchId : null, scope);

  const anyLive = openOrders.live || tables.live || kitchen.live;

  return (
    <>
      <PageHeader title={t("nav.liveOperations")} subtitle={t("liveOps.subtitle")} />

      <PageBody>
        <LiveNotice source={anyLive ? "backend" : "device"} />

        {!contextBranchId && availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={pickedBranchId} onChange={(event) => setPickedBranchId(event.target.value)}>
              <option value="">—</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!branchId ? (
          <Callout tone="muted">{t("liveOps.selectBranch")}</Callout>
        ) : (
          <>
            <TileGrid columns={3}>
              <OpenOrdersCard allowed={canOrders} feed={openOrders} />
              <TablesCard allowed={canOrders} feed={tables} />
              <KitchenCard allowed={canKitchen} branchId={branchId} feed={kitchen} />
            </TileGrid>

            <AttentionSection
              branchId={branchId}
              canOrders={canOrders}
              canKitchen={canKitchen}
              openOrders={openOrders}
              tables={tables}
              kitchen={kitchen}
            />
          </>
        )}
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function ViewAllLink({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} className="text-accent text-xs font-medium hover:underline">
      {t("dash.viewAll")}
    </Link>
  );
}

function OpenOrdersCard({
  allowed,
  feed,
}: {
  allowed: boolean;
  feed: BranchOpenOrdersFeed;
}) {
  const { t, fmt } = useI18n();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t("nav.openOrders")} action={<ViewAllLink href="/operations/open-orders" />} />
      {!allowed ? (
        <PermissionDenied compact permission={[...OPEN_ORDERS_PERMISSIONS]} />
      ) : feed.error ? (
        <ErrorPanel compact error={feed.error} onRetry={feed.reload} />
      ) : !feed.ready || feed.rows === null ? (
        <LoadingPanel compact />
      ) : (
        <p className="text-fg font-mono text-3xl tabular-nums">
          {formatNumber(feed.rows.length, fmt)}
        </p>
      )}
    </Card>
  );
}

function TablesCard({
  allowed,
  feed,
}: {
  allowed: boolean;
  feed: TableStatusFeed;
}) {
  const { t, fmt } = useI18n();

  const counts = useMemo(() => {
    if (!feed.rows) return null;
    return {
      available: feed.rows.filter((r) => r.occupancy === "available").length,
      occupied: feed.rows.filter((r) => r.occupancy === "occupied").length,
      ambiguous: feed.rows.filter((r) => r.occupancy === "ambiguous").length,
    };
  }, [feed.rows]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t("nav.tables")} action={<ViewAllLink href="/operations/table-status" />} />
      {!allowed ? (
        <PermissionDenied compact permission={[...OPEN_ORDERS_PERMISSIONS]} />
      ) : feed.error ? (
        <ErrorPanel compact error={feed.error} onRetry={feed.reload} />
      ) : !feed.ready || !counts ? (
        <LoadingPanel compact />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="good" dot>
            {t("pos.tableAvailable")} · {formatNumber(counts.available, fmt)}
          </Badge>
          <Badge tone="warn" dot>
            {t("pos.tableOccupied")} · {formatNumber(counts.occupied, fmt)}
          </Badge>
          {counts.ambiguous > 0 ? (
            <Badge tone="bad" dot>
              {t("pos.tableConflict")} · {formatNumber(counts.ambiguous, fmt)}
            </Badge>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function KitchenCard({
  allowed,
  branchId,
  feed,
}: {
  allowed: boolean;
  branchId: Id;
  feed: KitchenQueueFeed;
}) {
  const { t, fmt } = useI18n();
  // `useKitchenQueue` sits on the shared `useAsync`, whose data can survive
  // one render past a branch change while the new branch's request is still
  // in flight (unlike `useTableStatus`, which tags its own result). Reading
  // the snapshot's own `branchId` here closes that gap for this cockpit
  // without touching the shared hook or the Kitchen page that also uses it.
  const snapshot = feed.snapshot && feed.snapshot.branchId === branchId ? feed.snapshot : null;
  const ready = feed.ready && snapshot !== null;

  const delayedCount = useMemo(
    () => snapshot?.stations.flatMap((s) => s.tickets).filter((tkt) => tkt.delayed).length ?? 0,
    [snapshot],
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t("nav.kitchen")} action={<ViewAllLink href="/operations/kitchen" />} />
      {!allowed ? (
        <PermissionDenied compact permission={[...KITCHEN_PERMISSIONS]} />
      ) : feed.error ? (
        <ErrorPanel compact error={feed.error} onRetry={feed.reload} />
      ) : !ready || !snapshot ? (
        <LoadingPanel compact />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" dot>
            {t("kds.queue")} · {formatNumber(snapshot.totalActiveTickets, fmt)}
          </Badge>
          {delayedCount > 0 ? (
            <Badge tone="bad" dot>
              {t("kds.delayed")} · {formatNumber(delayedCount, fmt)}
            </Badge>
          ) : null}
          <Badge tone="neutral">
            {t("kds.avgWait")}:{" "}
            {snapshot.averageWaitSeconds === null ? "—" : formatElapsed(snapshot.averageWaitSeconds)}
          </Badge>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attention Needed
// ---------------------------------------------------------------------------

interface AttentionItem {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "bad" | "warn";
}

/** Delayed kitchen tickets, or `null` when not (yet) trustworthy for this branch. */
function delayedTickets(branchId: Id, kitchen: KitchenQueueFeed): KitchenQueueTicket[] | null {
  if (!kitchen.ready || kitchen.error) return null;
  const snapshot = kitchen.snapshot;
  if (!snapshot || snapshot.branchId !== branchId) return null;
  return snapshot.stations.flatMap((s) => s.tickets).filter((tkt) => tkt.delayed);
}

/** Tables the backend itself flagged `ambiguous`, or `null` when not ready. */
function conflictedTables(tables: TableStatusFeed): TableStatusRow[] | null {
  if (!tables.ready || tables.error || !tables.rows) return null;
  return tables.rows.filter((row) => row.occupancy === "ambiguous");
}

/** Open orders the backend itself put in `partially_paid`, or `null` when not ready. */
function partiallyPaidOrders(openOrders: BranchOpenOrdersFeed): BranchOpenOrdersFeed["rows"] {
  if (!openOrders.ready || openOrders.error || !openOrders.rows) return null;
  return openOrders.rows.filter((order) => order.state === "partially_paid");
}

function AttentionSection({
  branchId,
  canOrders,
  canKitchen,
  openOrders,
  tables,
  kitchen,
}: {
  branchId: Id;
  canOrders: boolean;
  canKitchen: boolean;
  openOrders: BranchOpenOrdersFeed;
  tables: TableStatusFeed;
  kitchen: KitchenQueueFeed;
}) {
  const { t, tx } = useI18n();

  const delayed = canKitchen ? delayedTickets(branchId, kitchen) : [];
  const conflicts = canOrders ? conflictedTables(tables) : [];
  const partiallyPaid = canOrders ? partiallyPaidOrders(openOrders) : [];

  const anySourcePending =
    (canKitchen && delayed === null && !kitchen.error) ||
    (canOrders && ((conflicts === null && !tables.error) || (partiallyPaid === null && !openOrders.error)));
  const anySourceFailed =
    (canKitchen && Boolean(kitchen.error)) || (canOrders && Boolean(tables.error || openOrders.error));

  const items: AttentionItem[] = [
    ...(delayed ?? []).map((tkt) => ({
      key: `kitchen:${tkt.id}`,
      label: tkt.orderNumber,
      detail: t("liveOps.delayedMinutes").replace("{n}", String(Math.floor(tkt.elapsedSeconds / 60))),
      href: "/operations/kitchen",
      tone: "bad" as const,
    })),
    ...(conflicts ?? []).map((row) => ({
      key: `table:${row.id}`,
      label: row.label,
      detail: t("pos.tableConflict"),
      href: "/operations/table-status",
      tone: "bad" as const,
    })),
    ...(partiallyPaid ?? []).map((order) => ({
      key: `order:${order.id}`,
      label: order.orderNumber,
      detail: tx(ORDER_STATE.partially_paid.label),
      href: "/operations/open-orders",
      tone: "warn" as const,
    })),
  ];

  return (
    <Card>
      <CardHeader title={t("liveOps.attention")} />
      {anySourcePending ? (
        <LoadingPanel compact />
      ) : items.length === 0 ? (
        <div className="space-y-2">
          <p className="text-fg-muted text-sm">{t("liveOps.attentionEmpty")}</p>
          {anySourceFailed ? <Callout tone="warn">{t("liveOps.attentionPartial")}</Callout> : null}
        </div>
      ) : (
        <div className="space-y-2">
          {anySourceFailed ? <Callout tone="warn">{t("liveOps.attentionPartial")}</Callout> : null}
          <ul className="divide-line divide-y">
            {items.map((item) => (
              <AttentionRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="hover:bg-sunken -mx-1 flex items-center justify-between gap-3 rounded-md px-1 py-2 text-sm transition-colors"
      >
        <span className="text-fg font-mono font-medium">{item.label}</span>
        <Badge tone={item.tone} dot>
          {item.detail}
        </Badge>
      </Link>
    </li>
  );
}
