"use client";

/**
 * Stock counts — SRS §11.6, UC-INV-01.
 *
 * A blind count hides the expected quantity from the counter (FR-INV-042).
 * That is the entire control: if the counter can see what the system expects,
 * the count stops being evidence and becomes confirmation. So this screen
 * withholds the expected column while a blind session is still open, and
 * reveals it — along with the variance — only once the count is submitted.
 *
 * Posting a count writes count_adjustment movements against the ledger, which
 * is why the flagged-line count matters more than the net variance: offsetting
 * errors net to zero and still mean two items are wrong.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarClock, MapPinned, MessageSquareText, Plus, RotateCcw, ScanBarcode, X } from "lucide-react";
import { orderForSheet } from "@/lib/console/services/inventory-controls";
import { CountSheetButton } from "@/components/console/inventory-count-sheet";
import type { CountLine, CountSession, StockItem } from "@/lib/console/types";
import { MIN_EXPLANATION, reviewStateOf, type ReviewState } from "@/lib/console/services/count-reviews";
import { LEVEL_LABEL, SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { useConfirm } from "@/components/console/confirm";
import { SearchSelect } from "@/components/console/fields";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  unitLabel,
} from "@/lib/console/format";
import { COUNT_MODE, COUNT_STATUS, labelOf } from "@/lib/console/labels";
import {
  CellStack,
  CollectionTable,
  DataTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Textarea,
  Toast,
  Toggle,
} from "@/components/console/ui";

/**
 * FR-INV-041 — two count modes: blind hides the expected quantity while
 * counting, open displays it. FR-INV-042 — the expected figure stays hidden
 * until the count is in.
 */
function expectedIsHidden(session: CountSession): boolean {
  return session.mode === "blind" && (session.status === "draft" || session.status === "counting");
}

export default function StockCountsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      {/* `useSearchParams` suspends during prerender; the boundary keeps the route static. */}
      <Suspense fallback={null}>
        <CountsScreen />
      </Suspense>
    </Gate>
  );
}

function CountsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<CountSession | null>(null);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const searchParams = useSearchParams();

  /*
   * FR-INV-048 — the cycle-count schedule opens a session and links here
   * with `?open=<id>`. Live there is no count index to find it in, so the
   * session is read by id and opened straight into the drawer, carrying the
   * mode and location the link names (the lines read cannot say either).
   */
  const openId = searchParams.get("open");
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    void services.inventory.counts
      .get(openId)
      .then((read) => {
        if (cancelled || !read) return;
        const mode = searchParams.get("mode");
        setSelected({
          ...read,
          reference: read.reference || searchParams.get("reference") || read.id,
          locationId: read.locationId || searchParams.get("location") || "",
          mode: mode === "open" || mode === "blind" ? mode : read.mode,
          status: read.status ?? "counting",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // Locations come from the service so the filter offers real ids.
  const locationList = useAsync(() => services.organisation.locations(), []);
  const locations = locationList.data ?? [];

  const collection = useCollection<CountSession>(
    (query) => services.inventory.counts.list(query),
    { scope, initialSort: "-openedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      open: rows.filter((row) => row.status === "counting" || row.status === "draft").length,
      awaiting: rows.filter((row) => row.status === "submitted").length,
      flagged: rows.reduce((sum, row) => sum + row.flaggedCount, 0),
      netVariance: rows.reduce((sum, row) => sum + row.netVarianceValue.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.netVarianceValue.currency ?? "EGP";

  const columns = useMemo<Column<CountSession>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.scope)}
          />
        ),
      },
      {
        key: "location",
        header: t("common.location"),
        render: (row) => tx(row.locationName),
      },
      {
        key: "mode",
        header: t("inv.mode"),
        render: (row) => {
          const mode = labelOf(COUNT_MODE, row.mode);
          return <Badge tone={mode.tone}>{tx(mode.label)}</Badge>;
        },
      },
      {
        key: "openedAt",
        header: t("common.created"),
        sortable: true,
        secondary: true,
        render: (row) => formatDateTime(row.openedAt, fmt),
      },
      {
        key: "lineCount",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lineCount, fmt),
      },
      {
        key: "flaggedCount",
        header: t("inv.flagged"),
        sortable: true,
        numeric: true,
        render: (row) =>
          row.flaggedCount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="text-warn font-semibold">{formatNumber(row.flaggedCount, fmt)}</span>
          ),
      },
      {
        key: "netVarianceValue",
        header: t("inv.netVariance"),
        sortable: true,
        numeric: true,
        render: (row) =>
          expectedIsHidden(row) ? (
            <span className="text-fg-subtle" title={t("inv.blindNote")}>
              ••••
            </span>
          ) : (
            <DeltaCell value={row.netVarianceValue.amount}>
              {formatMoney(row.netVarianceValue, fmt)}
            </DeltaCell>
          ),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(COUNT_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("inv.countsTitle")}
        subtitle={t("inv.countsSubtitle")}
        spec="FR-INV-042"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/inventory/counts/cycle"
              className="border-line bg-raised text-fg hover:bg-sunken inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium"
            >
              <CalendarClock size={14} aria-hidden /> {t("invx.cyc.title")}
            </Link>
            <Link
              href="/inventory/counts/storage"
              className="border-line bg-raised text-fg hover:bg-sunken inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium"
            >
              <MapPinned size={14} aria-hidden /> {t("invx.sto.title")}
            </Link>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpening(true)}>
              {t("common.new")}
            </Button>
          </div>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("inv.blindNote")}</Callout>

        {DATA_MODE === "http" ? (
          <Callout tone="warn">{t("inv.countsNoIndex")}</Callout>
        ) : null}

        <TileGrid columns={4}>
          <MetricTile label={t("inv.countsOpen")} value={formatNumber(totals.open, fmt)} />
          <MetricTile
            label={t("inv.countsAwaiting")}
            value={formatNumber(totals.awaiting, fmt)}
            spec="FR-INV-047"
          />
          <MetricTile label={t("inv.flagged")} value={formatNumber(totals.flagged, fmt)} />
          <MetricTile
            label={t("inv.netVariance")}
            value={formatMoney({ amount: totals.netVariance, currency }, fmt, true)}
            hint={t("inv.netVarianceHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(COUNT_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "mode",
              label: t("inv.mode"),
              options: Object.entries(COUNT_MODE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "locationId",
              label: t("common.location"),
              options: locations.map((location) => ({
                value: location.id,
                label: tx(location.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("inv.countsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <CountDrawer
        session={selected}
        onClose={() => setSelected(null)}
        onChanged={(note) => {
          setMessage(note);
          collection.reload();
        }}
        onOpened={(session) => {
          setSelected(session);
          collection.reload();
        }}
      />

      <OpenCountDrawer
        open={opening}
        onClose={() => setOpening(false)}
        onOpened={(session) => {
          setOpening(false);
          setMessage(t("inv.countOpened"));
          // There is no index to find this session again by, so it is
          // opened straight into the detail drawer rather than left to a
          // list that cannot show it (see `inv.countsNoIndex` above).
          setSelected(session);
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Variance thresholds — FR-INV-046, read from the settings cascade
// ---------------------------------------------------------------------------

interface CountPolicy {
  percent: number;
  valueMinor: number;
  blindDefault: boolean;
  /** Set when a level has locked blind counting, making it mandatory (FR-INV-042). */
  blindLockedAt: string | null;
}

function useCountPolicy(locationId: string | null): CountPolicy {
  const { tenant, availableBranches } = useSession();
  const { tx } = useI18n();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);

  return useMemo(() => {
    const branch = availableBranches.find((row) => row.id === locationId) ?? null;
    const context = {
      countryCode: branch?.countryCode ?? tenant.countryCode,
      tenantId: tenant.id,
      brandId: branch?.brandId ?? null,
      branchId: branch?.id ?? null,
      terminalId: null,
    };
    const rows = overrides.data ?? [];
    const resolve = (key: string) => resolveSetting(SETTING_BY_KEY.get(key)!, rows, context);
    const blind = resolve("inv.blindStockCount");
    return {
      percent: Number(resolve("inv.countVariancePercent").value),
      valueMinor: Number(resolve("inv.countVarianceValue").value),
      blindDefault: Boolean(blind.value),
      blindLockedAt: blind.lockedAt && blind.value ? tx(LEVEL_LABEL[blind.lockedAt]) : null,
    };
  }, [overrides.data, availableBranches, locationId, tenant, tx]);
}

function exceedsPolicy(line: CountLine, policy: CountPolicy): boolean {
  if (!line.counted) return false;
  return (
    Math.abs(line.variancePercent) > policy.percent ||
    Math.abs(line.varianceValue.amount) > policy.valueMinor
  );
}

const REVIEW_TONE: Record<ReviewState, "good" | "warn" | "bad" | "accent" | "muted"> = {
  clear: "muted",
  needs_review: "bad",
  awaiting_recount: "warn",
  recounted: "good",
  explained: "accent",
};

// ---------------------------------------------------------------------------

function CountDrawer({
  session,
  onClose,
  onChanged,
  onOpened,
}: {
  session: CountSession | null;
  onClose: () => void;
  onChanged: (message: string) => void;
  onOpened: (session: CountSession) => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { session: auth } = useSession();
  const canPost = usePermission("inventory.count.post");
  const canCount = usePermission("inventory.count.perform");
  const confirm = useConfirm();
  const action = useAction();
  const scanAction = useAction();
  const [editing, setEditing] = useState<CountLine | null>(null);
  const [explaining, setExplaining] = useState<CountLine | null>(null);
  const [scan, setScan] = useState("");
  const [candidate, setCandidate] = useState<StockItem | null>(null);
  const [adhocRefused, setAdhocRefused] = useState(false);
  const [postedHere, setPostedHere] = useState(false);
  const live = DATA_MODE === "http";

  /**
   * Lines are fetched, not read off the row: `GET /inventory/counts` has no
   * list endpoint for them, they hang off `/counts/{id}/lines`, and
   * `counts.get()` is what fans that out.
   */
  const detail = useAsync(
    async () => (session ? services.inventory.counts.get(session.id) : null),
    [session?.id],
  );
  const reviews = useAsync(
    async () => (session ? services.countReviews.forSession(session.id) : []),
    [session?.id],
  );
  const catalogue = useAsync(
    () => services.inventory.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
    [],
  );
  const policy = useCountPolicy(session?.locationId ?? null);

  // FR-INV-049 — the location's storage layout puts the lines in walking order.
  const layout = useAsync(
    async () => (session?.locationId ? services.inventoryControls.storage.get(session.locationId).catch(() => null) : null),
    [session?.locationId],
  );

  /*
   * Live, `counts.get` can only read the lines — the backend has no route
   * for the session itself — so the identity the drawer was opened with
   * (blind or open, location, status) is kept and only the lines and their
   * totals are taken from the read. Taking the whole read would silently
   * turn a blind count into an open one on the first reload.
   */
  const current: CountSession | null = useMemo(() => {
    if (!session) return null;
    const read = detail.data;
    const merged = !read
      ? session
      : live
        ? {
            ...session,
            lines: read.lines,
            lineCount: read.lineCount,
            flaggedCount: read.flaggedCount,
            netVarianceValue: read.netVarianceValue,
          }
        : read;
    return postedHere ? { ...merged, status: "posted" as const } : merged;
  }, [session, detail.data, live, postedHere]);

  const reviewByLine = useMemo(
    () => new Map((reviews.data ?? []).map((row) => [row.lineId, row])),
    [reviews.data],
  );

  const walk = useMemo(() => orderForSheet(layout.data ?? null, current?.lines ?? [], locale), [layout.data, current?.lines, locale]);
  const slotByLine = useMemo(() => new Map(walk.map((row) => [row.line.id, row])), [walk]);

  // A poster reviews variances; a counter never sees what is expected.
  const hidden = current ? expectedIsHidden(current) && !canPost : false;
  const posted = current?.status === "posted";

  const states = useMemo(() => {
    const map = new Map<string, ReviewState>();
    for (const line of current?.lines ?? []) {
      map.set(line.id, reviewStateOf(exceedsPolicy(line, policy), reviewByLine.get(line.id)));
    }
    return map;
  }, [current?.lines, policy, reviewByLine]);

  const unresolved = [...states.values()].filter(
    (state) => state === "needs_review" || state === "awaiting_recount",
  ).length;
  const uncounted = (current?.lines ?? []).filter((line) => !line.counted).length;

  async function post() {
    if (!session || !current) return;
    if (uncounted > 0) {
      const ok = await confirm({
        title: t("inv.postWithUncountedTitle"),
        body: t("inv.postWithUncountedBody").replace("{n}", String(uncounted)),
        confirmLabel: t("inv.postCount"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await action.run(() => services.inventory.counts.update(session.id, { status: "posted" }), {
      onSuccess: () => {
        setPostedHere(true);
        detail.reload();
        onChanged(t("inv.countPosted"));
      },
    });
  }

  async function requestRecount(line: CountLine) {
    if (!session) return;
    await action.run(
      () =>
        services.countReviews.requestRecount({
          sessionId: session.id,
          lineId: line.id,
          currentCount: line.counted?.value ?? null,
          by: auth?.user.email ?? null,
        }),
      {
        onSuccess: () => {
          reviews.reload();
          onChanged(t("inv.recountRequested"));
        },
      },
    );
  }

  /**
   * FR-INV-043 — a scanner types the code and presses Enter. The code is
   * tried as a barcode (the item profiles), then as a SKU; a hit on the
   * sheet opens that line, a hit off it offers to add the item.
   */
  async function resolveScan() {
    const code = scan.trim();
    if (!code || !current) return;
    await scanAction.run(async () => {
      const byBarcode = await services.stockProfiles.findByBarcode(code);
      const itemId =
        byBarcode?.itemId ??
        current.lines.find((line) => line.sku.toLowerCase() === code.toLowerCase())?.itemId ??
        (catalogue.data ?? []).find((item) => item.sku.toLowerCase() === code.toLowerCase())?.id ??
        null;
      if (!itemId) throw new Error(t("inv.scanNoMatch").replace("{code}", code));

      const line = current.lines.find((row) => row.itemId === itemId);
      setScan("");
      if (line) {
        setEditing(line);
        return;
      }
      const item = (catalogue.data ?? []).find((row) => row.id === itemId) ?? (await services.inventory.items.get(itemId));
      if (item) {
        setAdhocRefused(false);
        setCandidate(item);
      }
    });
  }

  async function addCandidate() {
    if (!session || !candidate) return;
    await scanAction.run(() => services.inventory.addCountLine(session.id, candidate.id), {
      onSuccess: () => {
        setCandidate(null);
        detail.reload();
        onChanged(t("inv.adhocAdded"));
      },
      onError: (error) => {
        if (error.code === "NOT_IMPLEMENTED") {
          scanAction.clearError();
          setAdhocRefused(true);
        }
      },
    });
  }

  async function openAdhocSession() {
    if (!session || !candidate) return;
    await scanAction.run(
      () =>
        services.inventory.counts.create({
          locationId: session.locationId,
          mode: session.mode,
          scopeType: "item_list",
          itemIds: [candidate.id],
        }),
      {
        onSuccess: (created) => {
          setCandidate(null);
          setAdhocRefused(false);
          onChanged(t("inv.adhocOpened"));
          onOpened(created);
        },
      },
    );
  }

  const columns = useMemo<Column<CountLine>[]>(() => {
    const base: Column<CountLine>[] = [
      {
        key: "item",
        header: t("inv.sku"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.sku}</span>}
          />
        ),
      },
      {
        // FR-INV-049 — where to find it on the walk.
        key: "slot",
        header: t("invx.sheet.shelf"),
        secondary: true,
        render: (row) => {
          const slot = slotByLine.get(row.id);
          return slot?.area ? (
            <CellStack primary={<span className="font-mono">{slot.area.code}</span>} secondary={slot.slot?.shelf || undefined} />
          ) : (
            <span className="text-fg-subtle">—</span>
          );
        },
      },
      {
        key: "counted",
        header: t("inv.counted"),
        numeric: true,
        render: (row) =>
          states.get(row.id) === "awaiting_recount" ? (
            <Badge tone="warn">{t("inv.recountPending")}</Badge>
          ) : row.counted ? (
            formatQuantity(row.counted, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
    ];

    // Expected and variance only exist once the blind is lifted.
    if (!hidden) {
      base.splice(1, 0, {
        key: "expected",
        header: t("inv.expected"),
        numeric: true,
        render: (row) => formatQuantity(row.expected, fmt),
      });
      base.push(
        {
          key: "varianceQty",
          header: t("common.variance"),
          numeric: true,
          render: (row) =>
            row.counted ? (
              <DeltaCell value={row.varianceQty}>
                {row.varianceQty > 0 ? "+" : ""}
                {formatNumber(row.varianceQty, fmt, 2)}
              </DeltaCell>
            ) : (
              <span className="text-fg-subtle">—</span>
            ),
        },
        {
          key: "variancePercent",
          header: "%",
          numeric: true,
          secondary: true,
          render: (row) =>
            row.counted ? (
              <DeltaCell value={row.variancePercent}>
                {formatPercent(row.variancePercent, fmt, 1)}
              </DeltaCell>
            ) : (
              <span className="text-fg-subtle">—</span>
            ),
        },
        {
          key: "varianceValue",
          header: t("common.value"),
          numeric: true,
          render: (row) =>
            row.counted ? (
              <DeltaCell value={row.varianceValue.amount}>
                {formatMoney(row.varianceValue, fmt)}
              </DeltaCell>
            ) : (
              <span className="text-fg-subtle">—</span>
            ),
        },
      );

      base.push({
        key: "review",
        header: t("inv.review"),
        render: (row) => {
          const state = states.get(row.id) ?? "clear";
          const review = reviewByLine.get(row.id);
          if (state === "clear") return <span className="text-fg-subtle">—</span>;
          return (
            <div className="flex flex-col items-start gap-1">
              <Badge tone={REVIEW_TONE[state]} dot>
                {t(`inv.reviewState.${state}` as ConsoleKey)}
              </Badge>
              {review?.firstCount ? (
                <span className="text-fg-subtle text-[0.68rem]">
                  {t("inv.firstCount").replace("{value}", review.firstCount)}
                </span>
              ) : null}
              {review?.explanation ? (
                <span className="text-fg-muted line-clamp-2 max-w-48 text-[0.68rem]" title={review.explanation}>
                  “{review.explanation}”
                </span>
              ) : null}
              {!posted && canPost && state === "needs_review" ? (
                <span className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={11} />} onClick={() => void requestRecount(row)}>
                    {t("inv.requestRecount")}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<MessageSquareText size={11} />} onClick={() => setExplaining(row)}>
                    {t("inv.explain")}
                  </Button>
                </span>
              ) : null}
            </div>
          );
        },
      });
    }

    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tx, fmt, hidden, states, reviewByLine, posted, canPost, slotByLine]);

  if (!session || !current) return null;

  const status = labelOf(COUNT_STATUS, current.status);
  const mode = labelOf(COUNT_MODE, current.mode);
  const onSheet = new Set(current.lines.map((line) => line.itemId));

  return (
    <Drawer
      open
      onClose={onClose}
      title={current.reference}
      subtitle={tx(current.scope)}
      footer={
        canPost && !posted ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-fg-muted text-xs">
              {unresolved > 0
                ? t("inv.postBlocked").replace("{n}", String(unresolved))
                : t("inv.readyToPost")}
            </span>
            <Button variant="primary" loading={action.pending} disabled={unresolved > 0} onClick={post}>
              {t("inv.postCount")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {hidden ? <Callout tone="accent">{t("inv.blindNote")}</Callout> : null}
        {!hidden && current.mode === "blind" && !posted && canPost ? (
          <Callout tone="muted">{t("inv.posterSeesVariance")}</Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.location")}>{tx(current.locationName)}</DescRow>
          <DescRow label={t("inv.mode")}>
            <Badge tone={mode.tone}>{tx(mode.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("inv.countedBy")}>{tx(current.countedByName) || "—"}</DescRow>
          <DescRow label={t("common.created")}>{formatDateTime(current.openedAt, fmt)}</DescRow>
          <DescRow label={t("inv.posted")}>
            {current.postedAt ? formatDateTime(current.postedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.countProgress")} mono>
            {formatNumber(current.lines.length - uncounted, fmt)} / {formatNumber(current.lines.length, fmt)}
          </DescRow>
          <DescRow label={t("inv.threshold")}>
            <span className="text-xs">
              {t("inv.thresholdValue")
                .replace("{percent}", formatPercent(policy.percent, fmt, 0))
                .replace("{value}", formatMoney({ amount: policy.valueMinor, currency: current.netVarianceValue.currency }, fmt))}
            </span>
          </DescRow>
          {!hidden ? (
            <DescRow label={t("inv.netVariance")} mono>
              <DeltaCell value={current.netVarianceValue.amount}>
                {formatMoney(current.netVarianceValue, fmt)}
              </DeltaCell>
            </DescRow>
          ) : null}
        </DescList>

        {!hidden && unresolved > 0 && !posted ? (
          <Callout tone="warn" title={t("inv.reviewNeededTitle")}>
            {t("inv.reviewNeededBody")}
          </Callout>
        ) : null}

        {!posted && canCount ? (
          <section className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <ScanBarcode
                  size={14}
                  aria-hidden
                  className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3"
                />
                <Input
                  dir="ltr"
                  value={scan}
                  onChange={(event) => setScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void resolveScan();
                    }
                  }}
                  placeholder={t("inv.scanToCount")}
                  aria-label={t("inv.scanToCount")}
                  className="ps-9 font-mono"
                  data-autofocus
                />
              </div>
              <div className="min-w-44">
                <SearchSelect
                  value={null}
                  onChange={(itemId) => {
                    const item = (catalogue.data ?? []).find((row) => row.id === itemId);
                    if (!item) return;
                    const line = current.lines.find((row) => row.itemId === item.id);
                    if (line) setEditing(line);
                    else {
                      setAdhocRefused(false);
                      setCandidate(item);
                    }
                  }}
                  options={(catalogue.data ?? []).map((item) => ({
                    value: item.id,
                    label: tx(item.name),
                    hint: `${item.sku}${onSheet.has(item.id) ? "" : ` · ${t("inv.notOnSheet")}`}`,
                  }))}
                  placeholder={t("inv.findItem")}
                  aria-label={t("inv.findItem")}
                />
              </div>
            </div>
            {scanAction.error ? <Callout tone="bad">{scanAction.error}</Callout> : null}
            {candidate ? (
              <Callout tone="accent" title={t("inv.notOnSheetTitle").replace("{item}", tx(candidate.name))}>
                {adhocRefused ? (
                  <>
                    <p>{t("inv.adhocRefused")}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="primary" loading={scanAction.pending} onClick={openAdhocSession}>
                        {t("inv.openAdhoc")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCandidate(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{t("inv.notOnSheetBody")}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="primary" icon={<Plus size={12} />} loading={scanAction.pending} onClick={addCandidate}>
                        {t("inv.addToCount")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCandidate(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </>
                )}
              </Callout>
            ) : null}
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg text-sm font-semibold">{t("inv.countLines")}</h3>
            <CountSheetButton
              title={t("invx.sheet.title")}
              reference={current.reference}
              locationId={current.locationId}
              locationName={tx(current.locationName)}
              blind={expectedIsHidden(current)}
              lines={current.lines.map((line) => ({
                itemId: line.itemId,
                itemName: line.itemName,
                sku: line.sku,
                unit: line.expected.unit,
                expected: line.expected.value,
              }))}
            />
          </div>
          {!layout.loading && (layout.data?.areas.length ?? 0) === 0 ? (
            <p className="text-fg-subtle mb-2 text-xs">{t("invx.sheet.noLayout")}</p>
          ) : null}
          <DataTable
            columns={columns}
            rows={walk.map((row) => row.line)}
            rowKey={(row) => row.id}
            caption={t("inv.countLines")}
            emptyTitle={t("inv.countLines")}
            onRowClick={canCount && !posted ? setEditing : undefined}
            loading={detail.loading && current.lines.length === 0}
            dense
          />

          <RecordCountDrawer
            line={editing}
            sessionId={session.id}
            recountPending={editing ? states.get(editing.id) === "awaiting_recount" : false}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              detail.reload();
              reviews.reload();
              onChanged(t("inv.countRecorded"));
            }}
          />

          {explaining ? (
            <ExplainVarianceModal
              line={explaining}
              sessionId={session.id}
              onClose={() => setExplaining(null)}
              onSaved={() => {
                setExplaining(null);
                reviews.reload();
                onChanged(t("inv.explanationSaved"));
              }}
            />
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-042 — record what was actually on the shelf for one line.
 *
 * The expected figure stays hidden while a blind count is in progress, so
 * this form deliberately shows the counter nothing to anchor against — and a
 * recount starts from an empty box, not from the first count, for the same
 * reason.
 */
function RecordCountDrawer({
  line,
  sessionId,
  recountPending,
  onClose,
  onSaved,
}: {
  line: CountLine | null;
  sessionId: string;
  recountPending: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, locale } = useI18n();
  const action = useAction();
  const [counted, setCounted] = useState("");

  useEffect(() => {
    if (line) setCounted(recountPending ? "" : (line.counted?.value ?? ""));
  }, [line, recountPending]);

  if (!line) return null;

  const valid = counted.trim() !== "" && /^\d*\.?\d+$/.test(counted.trim());

  async function save() {
    if (!line || !valid) return;
    await action.run(
      async () => {
        await services.inventory.recordCount(line.id, counted.trim());
        await services.countReviews.noteRecorded(sessionId, line.id);
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(line.itemName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {line.sku}
        </span>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {recountPending ? <Callout tone="warn">{t("inv.recountNote")}</Callout> : null}

        <Field
          label={t("inv.counted")}
          hint={`${t("inv.countedHint")} · ${unitLabel(line.expected.unit, locale)}`}
          required
        >
          <Input
            inputMode="decimal"
            dir="ltr"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid) {
                event.preventDefault();
                void save();
              }
            }}
            data-autofocus
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function ExplainVarianceModal({
  line,
  sessionId,
  onClose,
  onSaved,
}: {
  line: CountLine;
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const [text, setText] = useState("");
  const short = text.trim().length < MIN_EXPLANATION;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("inv.explainTitle").replace("{item}", tx(line.itemName))}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={short}
            onClick={() =>
              void action.run(
                () =>
                  services.countReviews.explain({
                    sessionId,
                    lineId: line.id,
                    text,
                    by: session?.user.email ?? null,
                  }),
                { onSuccess: onSaved },
              )
            }
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <p className="text-fg-muted text-xs">
          {t("inv.explainContext")
            .replace("{qty}", formatNumber(line.varianceQty, fmt, 2))
            .replace("{value}", formatMoney(line.varianceValue, fmt))}
        </p>
        <Field
          label={t("inv.explanation")}
          hint={t("inv.explanationHint").replace("{n}", String(MIN_EXPLANATION))}
          required
        >
          <Textarea rows={4} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} data-autofocus />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * FR-INV-040/041 — open a session and freeze expected quantities for its
 * scope: a full location, or an ad-hoc list of items.
 *
 * `onOpened` carries the created session back to the caller: there is no
 * index endpoint to find it again by, so this is the one and only moment
 * the console has its id and totals without the cashier writing it down.
 */
function OpenCountDrawer({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (session: CountSession) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [locationId, setLocationId] = useState("");
  const [scopeType, setScopeType] = useState<"full_location" | "item_list">("full_location");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [blindChoice, setBlindChoice] = useState<boolean | null>(null);

  const locations = useAsync(() => services.organisation.locations(), []);
  const items = useAsync(
    () => services.inventory.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
    [],
  );
  const policy = useCountPolicy(locationId || null);
  // FR-INV-041 — the session is opened blind or open; FR-INV-042 — blind is
  // the default, and a lock anywhere above makes it mandatory.
  const blind = policy.blindLockedAt ? true : (blindChoice ?? policy.blindDefault);

  useEffect(() => {
    const rows = locations.data;
    if (rows && rows.length > 0 && !locationId) setLocationId(rows[0]!.id);
  }, [locations.data, locationId]);

  if (!open) return null;

  const needsItems = scopeType === "item_list" && itemIds.length === 0;

  async function create() {
    if (!locationId || needsItems) return;
    await action.run(
      () =>
        services.inventory.counts.create({
          locationId,
          mode: blind ? "blind" : "open",
          scopeType,
          itemIds: scopeType === "item_list" ? itemIds : undefined,
        }),
      { onSuccess: onOpened },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("inv.newCount")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!locationId || needsItems}
            onClick={create}
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Callout tone="muted">{t("inv.newCountNote")}</Callout>

        <AsyncPanel state={locations} isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <Field label={t("common.location")} required>
              <Select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                disabled={action.pending}
              >
                {rows.map((location) => (
                  <option key={location.id} value={location.id}>
                    {tx(location.name)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>

        <Field label={t("inv.countScope")}>
          <SegmentedControl
            value={scopeType}
            onChange={setScopeType}
            options={[
              { value: "full_location", label: t("inv.scopeFull") },
              { value: "item_list", label: t("inv.scopeItems") },
            ]}
          />
        </Field>

        {scopeType === "item_list" ? (
          <div className="space-y-2">
            <Field label={t("inv.countItems")} hint={t("inv.countItemsHint")} required>
              <SearchSelect
                value={null}
                onChange={(value) => {
                  if (value && !itemIds.includes(value)) setItemIds([...itemIds, value]);
                }}
                options={(items.data ?? [])
                  .filter((item) => !itemIds.includes(item.id))
                  .map((item) => ({ value: item.id, label: tx(item.name), hint: item.sku }))}
                placeholder={t("inv.findItem")}
                aria-label={t("inv.countItems")}
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {itemIds.map((id) => {
                const item = (items.data ?? []).find((row) => row.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setItemIds(itemIds.filter((row) => row !== id))}
                    className="border-line bg-sunken text-fg hover:border-bad inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    aria-label={`${t("common.remove")} ${tx(item?.name)}`}
                  >
                    {tx(item?.name) || id}
                    <X size={11} aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <Toggle
          checked={blind}
          onChange={setBlindChoice}
          label={t("inv.blindCount")}
          hint={policy.blindLockedAt ? t("inv.blindMandatory").replace("{level}", policy.blindLockedAt) : t("inv.blindNote")}
          disabled={Boolean(policy.blindLockedAt)}
        />
      </div>
    </Drawer>
  );
}
