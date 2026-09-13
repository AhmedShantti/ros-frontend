"use client";

/**
 * What a manager decided about an anomaly flag — FR-CST-040 … FR-CST-042.
 *
 * The flags themselves come from `governance.anomalies` (the demo's
 * detector; live, the backend has no anomaly endpoint and the screen says
 * so). The review of each one — who looked, what they concluded, and why —
 * has nowhere on the server to live, so it is kept here, append-only: a
 * flag's history is the record of how a person was treated, and it must
 * never be quietly rewritten.
 */

import type { AnomalyFlag, Id, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export type ReviewStatus = AnomalyFlag["status"];

export interface AnomalyReviewEntry {
  status: ReviewStatus;
  note: string;
  by: string | null;
  at: IsoDateTime;
}

export interface AnomalyReview {
  flagId: Id;
  status: ReviewStatus;
  history: AnomalyReviewEntry[];
}

const store = localCollection<AnomalyReview>(
  {
    name: "anomaly-reviews",
    idOf: (row) => row.flagId,
    factory: (input) => ({ flagId: input.flagId ?? "", status: input.status ?? "open", history: input.history ?? [] }),
  },
  () => getActiveTenantId(),
);

export interface AnomalyReviewService {
  all(): Promise<AnomalyReview[]>;
  record(flagId: Id, entry: { status: ReviewStatus; note: string; by: string | null }): Promise<AnomalyReview>;
}

export const anomalyReviewService: AnomalyReviewService = {
  async all() {
    return store.all();
  },

  async record(flagId, entry) {
    const note = entry.note.trim();
    // Dismissing or confirming is a conclusion about a person's conduct;
    // FR-CST-042 wants the working shown, so the reason is mandatory.
    if ((entry.status === "dismissed" || entry.status === "confirmed") && note.length < 10) {
      throw new ServiceError("VALIDATION", "Record what the evidence showed, in at least ten characters.", 400);
    }
    const next: AnomalyReviewEntry = { status: entry.status, note, by: entry.by, at: nowIso() };
    const existing = await store.get(flagId);
    return existing
      ? store.update(flagId, { status: entry.status, history: [next, ...existing.history] })
      : store.create({ flagId, status: entry.status, history: [next] });
  },
};
