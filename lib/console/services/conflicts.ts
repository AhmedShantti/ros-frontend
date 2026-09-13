"use client";

/**
 * The conflict register and the clock-skew log — FR-OFF-040 … FR-OFF-044.
 *
 * The server records conflicts it cannot resolve (`sync.conflict_records`,
 * named in the `POST /v1/sync/batch` response) but publishes no endpoint to
 * list or resolve them. So the register a manager works from is kept here,
 * behind the interface a server implementation will take over, and it is
 * filled from the one source this client really has: the till's own
 * outbound queue, whose entries go to `conflict` when the server refuses a
 * write (`store/connectivity.ts`). The demo seeds a handful of typical cases
 * so the screen can be exercised; a live deployment is never seeded.
 *
 * Clock skew is the same story (FR-OFF-042): the server measures it on every
 * sync and reports `clockSkewMs`; this log keeps what the client has been
 * told, per device, so a skew banner has something true to say.
 */

import type { Id, IsoDateTime } from "../types";
import { DATA_MODE } from "@/lib/api/config";
import { localCollection, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

/** FR-OFF-040 — how each entity type resolves a conflict. */
export type ConflictStrategy =
  | "crdt_lines"
  | "server_authoritative"
  | "ledger_append"
  | "exclusive_lock"
  | "append_only_dedupe"
  | "lww_hlc"
  | "single_writer";

export interface ConflictRecord {
  id: Id;
  detectedAt: IsoDateTime;
  deviceId: string;
  deviceName: string;
  branchId: Id | null;
  entityType: string;
  entityId: Id;
  /** "Order #1043 · line 3", "Count CNT-2211 · Chicken breast". */
  label: string;
  strategy: ConflictStrategy;
  reasonCode: string | null;
  reasonDetail: string | null;
  /** What the device sent, and when it thought it happened. */
  device: Record<string, unknown>;
  deviceAt: IsoDateTime | null;
  /** What the server holds. Null when the server did not return it. */
  server: Record<string, unknown> | null;
  serverAt: IsoDateTime | null;
  /** Resolved without a person — FR-OFF-044 wants the rule on record. */
  automatic: boolean;
  appliedRule: string | null;
  status: "open" | "resolved";
  resolution: "kept_device" | "kept_server" | "merged" | null;
  merged: Record<string, unknown> | null;
  resolvedBy: string | null;
  resolvedAt: IsoDateTime | null;
  note: string | null;
  /** Set when the record mirrors an entry in the till's outbound queue. */
  queueId: string | null;
}

export interface SkewObservation {
  id: Id;
  deviceId: string;
  deviceName: string;
  observedAt: IsoDateTime;
  /** Positive: the device runs ahead of the server. */
  skewMs: number;
  source: "sync" | "simulated";
}

const tenantOf = () => getActiveTenantId();

function minutesAgo(minutes: number): IsoDateTime {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function seedConflicts(): ConflictRecord[] {
  if (DATA_MODE === "http") return [];
  const base = {
    reasonCode: null,
    reasonDetail: null,
    automatic: false,
    appliedRule: null,
    status: "open" as const,
    resolution: null,
    merged: null,
    resolvedBy: null,
    resolvedAt: null,
    note: null,
    queueId: null,
    branchId: null,
  };
  return [
    {
      ...base,
      id: localId("cfl"),
      detectedAt: minutesAgo(38),
      deviceId: "trm_0007",
      deviceName: "Maadi · POS 2",
      entityType: "order_line",
      entityId: "ord_1043:ln_3",
      label: "Order #1043 · Table 12 · line 3",
      strategy: "crdt_lines",
      reasonCode: "SAME_HLC_TIE",
      reasonDetail: "Two waiters edited the same line with identical hybrid-logical-clock stamps during the outage.",
      device: { item: "Mixed grill", quantity: 2, notes: "No onions", course: 2 },
      deviceAt: minutesAgo(52),
      server: { item: "Mixed grill", quantity: 3, notes: null, course: 2 },
      serverAt: minutesAgo(52),
    },
    {
      ...base,
      id: localId("cfl"),
      detectedAt: minutesAgo(95),
      deviceId: "trm_0012",
      deviceName: "Zamalek · Stock tablet",
      entityType: "count_session",
      entityId: "cnt_2211",
      label: "Count CNT-2211 · Chicken breast",
      strategy: "exclusive_lock",
      reasonCode: "SECOND_SUBMISSION",
      reasonDetail: "The same shelf was counted on two devices while offline. The second submission was held.",
      device: { counted: "14.5 kg", countedBy: "Hany", countedAt: "10:42" },
      deviceAt: minutesAgo(130),
      server: { counted: "12 kg", countedBy: "Mona", countedAt: "10:31" },
      serverAt: minutesAgo(141),
    },
    {
      ...base,
      id: localId("cfl"),
      detectedAt: minutesAgo(210),
      deviceId: "trm_0003",
      deviceName: "Nasr City · POS 1",
      entityType: "loyalty_redemption",
      entityId: "loy_8812",
      label: "Loyalty · Omar Fathy · redemption",
      strategy: "ledger_append",
      reasonCode: "OVERDRAW",
      reasonDetail: "Redeemed offline against a balance another branch had already spent. The ledger is overdrawn by 40 points.",
      device: { redeemed: 120, balanceSeenOnDevice: 129 },
      deviceAt: minutesAgo(260),
      server: { balanceAfterServerReplay: -40, otherRedemption: "Maadi, 90 points" },
      serverAt: minutesAgo(215),
    },
    {
      ...base,
      id: localId("cfl"),
      detectedAt: minutesAgo(400),
      deviceId: "trm_0007",
      deviceName: "Maadi · POS 2",
      entityType: "price_entry",
      entityId: "pri_0441",
      label: "Price · Chicken shawarma (large)",
      strategy: "server_authoritative",
      device: { price: "EGP 95.00" },
      deviceAt: minutesAgo(420),
      server: { price: "EGP 105.00" },
      serverAt: minutesAgo(1440),
      automatic: true,
      appliedRule: "Reference data is server-authoritative; the device's change was rejected and the server price re-sent.",
      status: "resolved",
      resolution: "kept_server",
      resolvedAt: minutesAgo(400),
      resolvedBy: "system",
    },
    {
      ...base,
      id: localId("cfl"),
      detectedAt: minutesAgo(600),
      deviceId: "trm_0009",
      deviceName: "Heliopolis · POS 1",
      entityType: "clock_event",
      entityId: "att_7721",
      label: "Clock-in · Karim Adel",
      strategy: "append_only_dedupe",
      device: { event: "clock_in", at: "08:02:11" },
      deviceAt: minutesAgo(610),
      server: { event: "clock_in", at: "08:02:09" },
      serverAt: minutesAgo(610),
      automatic: true,
      appliedRule: "Duplicate detected by (employee, event type, 2-minute window); the second event was discarded.",
      status: "resolved",
      resolution: "kept_server",
      resolvedAt: minutesAgo(600),
      resolvedBy: "system",
    },
  ];
}

const conflictsStore = localCollection<ConflictRecord>(
  {
    name: "sync-conflicts",
    idOf: (row) => row.id,
    seed: seedConflicts,
    search: (row) => [row.label, row.deviceName, row.entityType, row.reasonCode],
    filters: {
      status: (row) => row.status,
      automatic: (row) => String(row.automatic),
      strategy: (row) => row.strategy,
    },
    sorters: { detectedAt: (row) => row.detectedAt },
    factory: (input, id) =>
      ({
        id,
        detectedAt: nowIso(),
        status: "open",
        resolution: null,
        merged: null,
        resolvedBy: null,
        resolvedAt: null,
        note: null,
        automatic: false,
        appliedRule: null,
        queueId: null,
        branchId: null,
        reasonCode: null,
        reasonDetail: null,
        server: null,
        serverAt: null,
        deviceAt: null,
        ...input,
      }) as ConflictRecord,
  },
  tenantOf,
);

const skewStore = localCollection<SkewObservation>(
  {
    name: "clock-skew",
    idOf: (row) => row.id,
    sorters: { observedAt: (row) => row.observedAt },
    factory: (input, id) =>
      ({ id, observedAt: nowIso(), source: "sync", deviceId: "", deviceName: "", skewMs: 0, ...input }) as SkewObservation,
  },
  tenantOf,
);

export interface ConflictService {
  list(): Promise<ConflictRecord[]>;
  /** Mirror a queue entry the server refused. Idempotent on `queueId`. */
  recordFromQueue(input: {
    queueId: string;
    label: string;
    entityType: string;
    device: Record<string, unknown>;
    reason: string | null;
    deviceName: string;
  }): Promise<ConflictRecord>;
  resolve(
    id: Id,
    input: {
      resolution: "kept_device" | "kept_server" | "merged";
      merged?: Record<string, unknown> | null;
      note: string;
      by: string | null;
    },
  ): Promise<ConflictRecord>;
  skew(): Promise<SkewObservation[]>;
  recordSkew(input: Omit<SkewObservation, "id" | "observedAt">): Promise<SkewObservation>;
}

export const conflictService: ConflictService = {
  async list() {
    return (await conflictsStore.all()).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  },

  async recordFromQueue(input) {
    const existing = (await conflictsStore.all()).find((row) => row.queueId === input.queueId);
    if (existing) return existing;
    return conflictsStore.create({
      queueId: input.queueId,
      label: input.label,
      entityType: input.entityType,
      entityId: input.queueId,
      device: input.device,
      deviceAt: nowIso(),
      deviceId: "this-device",
      deviceName: input.deviceName,
      strategy: "single_writer",
      reasonCode: "SERVER_REFUSED",
      reasonDetail: input.reason,
    });
  },

  async resolve(id, input) {
    const row = await conflictsStore.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That conflict no longer exists.", 404);
    if (row.status === "resolved") {
      throw new ServiceError("CONFLICT", "This conflict has already been resolved.", 409);
    }
    if (input.note.trim().length < 5) {
      throw new ServiceError("VALIDATION", "Say why — the resolution is part of the audit trail.", 400);
    }
    return conflictsStore.update(id, {
      status: "resolved",
      resolution: input.resolution,
      merged: input.merged ?? null,
      note: input.note.trim(),
      resolvedBy: input.by,
      resolvedAt: nowIso(),
    });
  },

  async skew() {
    return (await skewStore.all()).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  },

  async recordSkew(input) {
    return skewStore.create(input);
  },
};

/** Strategy copy, for the register and the resolution drawer. */
export const STRATEGY_LABEL: Record<ConflictStrategy, { en: string; ar: string }> = {
  crdt_lines: { en: "Shared-table lines: add-wins, last writer per field", ar: "أسطر الطاولة المشتركة: الإضافة تفوز وآخر كاتب لكل حقل" },
  server_authoritative: { en: "Server-authoritative", ar: "الخادم هو المرجع" },
  ledger_append: { en: "Ledger append; server recomputes", ar: "إلحاق بالسجل ويعيد الخادم الحساب" },
  exclusive_lock: { en: "Exclusive lock by scope", ar: "قفل حصري حسب النطاق" },
  append_only_dedupe: { en: "Append-only with duplicate detection", ar: "إلحاق فقط مع كشف التكرار" },
  lww_hlc: { en: "Last writer wins (hybrid logical clock)", ar: "آخر كاتب يفوز (ساعة منطقية هجينة)" },
  single_writer: { en: "Single writer", ar: "كاتب واحد" },
};
