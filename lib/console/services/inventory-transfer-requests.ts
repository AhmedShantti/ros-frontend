"use client";

/**
 * Transfer requests — SRS §17.4, FR-BRN-016.
 *
 * "A branch requests stock, the source location approves and dispatches."
 * The backend has dispatch and receive (`POST /inventory/transfers`,
 * `/transfers/receive`) and nothing before them: no request document, no
 * approval. So the request and its decision live here, behind an interface a
 * server can take over, and the dispatch that follows an approval is the real
 * one — each approved line becomes a real transfer whose id is written back
 * onto the request, so the paper trail runs from "we need" to "it arrived".
 *
 * The history is append-only. Who asked, who decided, what they cut and why
 * is the record a branch manager points at when the cream did not come.
 */

import type { Id, IsoDate, IsoDateTime, Localised } from "../types";
import { localCollection, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";
import { decimalCompare, isPositiveDecimal } from "../stock-units";

export type TransferRequestStatus =
  | "requested"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "dispatched"
  | "cancelled";

export interface TransferRequestLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  unit: string;
  /** Decimal string, base units. */
  requested: string;
  /** What the source agreed to send; null until decided. "0" declines the line. */
  approved: string | null;
  /** The real transfer this line went out on. */
  transferId: Id | null;
  transferReference: string | null;
}

export interface TransferRequestEvent {
  at: IsoDateTime;
  by: string | null;
  action: "requested" | "approved" | "partially_approved" | "rejected" | "dispatched" | "cancelled";
  note: string;
}

export interface TransferRequest {
  id: Id;
  reference: string;
  /** The location asked to supply. */
  fromLocationId: Id;
  fromLocationName: Localised;
  /** The requesting location. */
  toLocationId: Id;
  toLocationName: Localised;
  neededBy: IsoDate;
  note: string;
  status: TransferRequestStatus;
  lines: TransferRequestLine[];
  requestedBy: string | null;
  requestedByName: Localised | null;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  dispatchedAt: IsoDateTime | null;
  /** Set when the request came from a suggested transfer (FR-BRN-017). */
  suggestionId: string | null;
  history: TransferRequestEvent[];
}

const store = localCollection<TransferRequest>(
  {
    name: "transfer-requests",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.fromLocationName, row.toLocationName, ...row.lines.map((line) => line.itemName)],
    filters: {
      status: (row) => row.status,
      fromLocationId: (row) => row.fromLocationId,
      toLocationId: (row) => row.toLocationId,
    },
    sorters: { requestedAt: (row) => row.requestedAt, neededBy: (row) => row.neededBy },
    factory: (input) => input as TransferRequest,
  },
  () => getActiveTenantId(),
);

/** A decision to decline or cut a request has to say why. */
export const MIN_DECISION_NOTE = 10;

export interface NewTransferRequest {
  fromLocationId: Id;
  fromLocationName: Localised;
  toLocationId: Id;
  toLocationName: Localised;
  neededBy: IsoDate;
  note: string;
  lines: { itemId: Id; itemName: Localised; unit: string; requested: string }[];
  by: string | null;
  byName: Localised | null;
  suggestionId?: string | null;
}

export interface TransferRequestService {
  list: typeof store.list;
  all(): Promise<TransferRequest[]>;
  get(id: Id): Promise<TransferRequest | null>;
  create(input: NewTransferRequest): Promise<TransferRequest>;
  /** `approved` maps line id → quantity; a quantity below the request is a cut. */
  decide(
    id: Id,
    input: { approved: Record<Id, string>; note: string; by: string | null },
  ): Promise<TransferRequest>;
  reject(id: Id, input: { note: string; by: string | null }): Promise<TransferRequest>;
  cancel(id: Id, input: { note: string; by: string | null }): Promise<TransferRequest>;
  /** Record the real transfers an approved request went out on. */
  recordDispatch(
    id: Id,
    input: { lines: { lineId: Id; transferId: Id; transferReference: string }[]; by: string | null },
  ): Promise<TransferRequest>;
}

function referenceOf(): string {
  return `TRQ-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

async function mustGet(id: Id): Promise<TransferRequest> {
  const row = await store.get(id);
  if (!row) throw new ServiceError("NOT_FOUND", "That transfer request no longer exists.", 404);
  return row;
}

export const transferRequestService: TransferRequestService = {
  list: (query) => store.list(query),

  async all() {
    return store.all();
  },

  async get(id) {
    return store.get(id);
  },

  async create(input) {
    if (input.fromLocationId === input.toLocationId) {
      throw new ServiceError("VALIDATION", "A location cannot request stock from itself.", 400);
    }
    const lines = input.lines.filter((line) => line.itemId);
    if (lines.length === 0) throw new ServiceError("VALIDATION", "Add at least one item to request.", 400);
    const seen = new Set<Id>();
    for (const line of lines) {
      if (!isPositiveDecimal(line.requested)) {
        throw new ServiceError("VALIDATION", "Every requested quantity must be more than zero.", 400);
      }
      if (seen.has(line.itemId)) throw new ServiceError("VALIDATION", "An item appears twice on the request.", 400);
      seen.add(line.itemId);
    }
    const now = nowIso();
    return store.create({
      id: localId("trq"),
      reference: referenceOf(),
      fromLocationId: input.fromLocationId,
      fromLocationName: input.fromLocationName,
      toLocationId: input.toLocationId,
      toLocationName: input.toLocationName,
      neededBy: input.neededBy,
      note: input.note.trim(),
      status: "requested",
      lines: lines.map((line) => ({
        id: localId("trql"),
        itemId: line.itemId,
        itemName: line.itemName,
        unit: line.unit,
        requested: line.requested.trim(),
        approved: null,
        transferId: null,
        transferReference: null,
      })),
      requestedBy: input.by,
      requestedByName: input.byName,
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      dispatchedAt: null,
      suggestionId: input.suggestionId ?? null,
      history: [{ at: now, by: input.by, action: "requested", note: input.note.trim() }],
    });
  },

  async decide(id, input) {
    const row = await mustGet(id);
    if (row.status !== "requested") {
      throw new ServiceError("CONFLICT", "Only an open request can be decided.", 409);
    }
    // FR-BRN-016 — the source decides. The person who asked cannot also agree.
    if (input.by && row.requestedBy && input.by === row.requestedBy) {
      throw new ServiceError("FORBIDDEN", "You raised this request, so someone at the source location has to approve it.", 403);
    }
    let cut = false;
    let anything = false;
    const lines = row.lines.map((line) => {
      const approved = (input.approved[line.id] ?? line.requested).trim();
      if (!/^\d*\.?\d+$/.test(approved)) {
        throw new ServiceError("VALIDATION", "Approved quantities must be zero or more.", 400);
      }
      if (decimalCompare(approved, line.requested) > 0) {
        throw new ServiceError("VALIDATION", "You cannot approve more than was requested; ask for a new request instead.", 400);
      }
      if (decimalCompare(approved, line.requested) < 0) cut = true;
      if (decimalCompare(approved, "0") > 0) anything = true;
      return { ...line, approved };
    });
    if (!anything) {
      throw new ServiceError("VALIDATION", "Nothing is approved. Reject the request instead, with the reason.", 400);
    }
    const note = input.note.trim();
    if (cut && note.length < MIN_DECISION_NOTE) {
      throw new ServiceError("VALIDATION", `Say why the request was cut, in at least ${MIN_DECISION_NOTE} characters.`, 400);
    }
    const status: TransferRequestStatus = cut ? "partially_approved" : "approved";
    const now = nowIso();
    return store.update(id, {
      lines,
      status,
      decidedBy: input.by,
      decidedAt: now,
      decisionNote: note || null,
      history: [{ at: now, by: input.by, action: status, note }, ...row.history],
    });
  },

  async reject(id, input) {
    const row = await mustGet(id);
    if (row.status !== "requested") throw new ServiceError("CONFLICT", "Only an open request can be rejected.", 409);
    if (input.by && row.requestedBy && input.by === row.requestedBy) {
      throw new ServiceError("FORBIDDEN", "Cancel your own request rather than rejecting it.", 403);
    }
    const note = input.note.trim();
    if (note.length < MIN_DECISION_NOTE) {
      throw new ServiceError("VALIDATION", `Say why, in at least ${MIN_DECISION_NOTE} characters.`, 400);
    }
    const now = nowIso();
    return store.update(id, {
      status: "rejected",
      decidedBy: input.by,
      decidedAt: now,
      decisionNote: note,
      history: [{ at: now, by: input.by, action: "rejected", note }, ...row.history],
    });
  },

  async cancel(id, input) {
    const row = await mustGet(id);
    if (row.status !== "requested") {
      throw new ServiceError("CONFLICT", "A request can only be cancelled before it is decided.", 409);
    }
    const now = nowIso();
    return store.update(id, {
      status: "cancelled",
      history: [{ at: now, by: input.by, action: "cancelled", note: input.note.trim() }, ...row.history],
    });
  },

  async recordDispatch(id, input) {
    const row = await mustGet(id);
    if (row.status !== "approved" && row.status !== "partially_approved" && row.status !== "dispatched") {
      throw new ServiceError("CONFLICT", "Only an approved request can be dispatched.", 409);
    }
    const byLine = new Map(input.lines.map((line) => [line.lineId, line]));
    const lines = row.lines.map((line) => {
      const sent = byLine.get(line.id);
      return sent ? { ...line, transferId: sent.transferId, transferReference: sent.transferReference } : line;
    });
    const outstanding = lines.some(
      (line) => line.approved !== null && decimalCompare(line.approved, "0") > 0 && !line.transferId,
    );
    const now = nowIso();
    return store.update(id, {
      lines,
      // Some lines can fail to dispatch; the request stays approved until all have gone.
      status: outstanding ? row.status : "dispatched",
      dispatchedAt: outstanding ? row.dispatchedAt : now,
      history: [
        {
          at: now,
          by: input.by,
          action: "dispatched",
          note: input.lines.map((line) => line.transferReference).join(", "),
        },
        ...row.history,
      ],
    });
  },
};
