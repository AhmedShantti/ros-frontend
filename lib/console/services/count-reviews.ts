"use client";

/**
 * Count variance review — FR-INV-046, FR-INV-050.
 *
 * "Variances exceeding a configurable threshold SHALL require a recount or a
 * written explanation before posting." The backend posts a count on request
 * and has no notion of either, so the review — who asked for a recount, what
 * the first count said, who explained a variance and why — is kept here,
 * per line, behind an interface a server can take over. The rule itself
 * (nothing over the threshold posts unresolved) is enforced in the count
 * drawer, which is the only place a count is posted from.
 *
 * The first count is kept when a recount is asked for (FR-INV-050: history
 * includes recounts). A recount overwrites the line on the server; without
 * this record the original figure would be gone.
 */

import type { Id, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export interface CountLineReview {
  lineId: Id;
  sessionId: Id;
  recountRequestedAt: IsoDateTime | null;
  recountRequestedBy: string | null;
  /** What the line said when the recount was asked for. */
  firstCount: string | null;
  /** Set when a count is recorded after the recount request. */
  recountedAt: IsoDateTime | null;
  explanation: string | null;
  explainedBy: string | null;
  explainedAt: IsoDateTime | null;
}

const store = localCollection<CountLineReview>(
  {
    name: "count-reviews",
    idOf: (row) => row.lineId,
    factory: (input) =>
      ({
        lineId: input.lineId ?? "",
        sessionId: input.sessionId ?? "",
        recountRequestedAt: null,
        recountRequestedBy: null,
        firstCount: null,
        recountedAt: null,
        explanation: null,
        explainedBy: null,
        explainedAt: null,
        ...input,
      }) as CountLineReview,
  },
  () => getActiveTenantId(),
);

async function upsert(lineId: Id, sessionId: Id, patch: Partial<CountLineReview>): Promise<CountLineReview> {
  const existing = await store.get(lineId);
  return existing ? store.update(lineId, patch) : store.create({ lineId, sessionId, ...patch });
}

/** A written explanation has to say something. */
export const MIN_EXPLANATION = 12;

export interface CountReviewService {
  forSession(sessionId: Id): Promise<CountLineReview[]>;
  requestRecount(input: { sessionId: Id; lineId: Id; currentCount: string | null; by: string | null }): Promise<CountLineReview>;
  explain(input: { sessionId: Id; lineId: Id; text: string; by: string | null }): Promise<CountLineReview>;
  /** Called after a count is recorded; closes a pending recount. */
  noteRecorded(sessionId: Id, lineId: Id): Promise<void>;
}

export const countReviewService: CountReviewService = {
  async forSession(sessionId) {
    return (await store.all()).filter((row) => row.sessionId === sessionId);
  },

  async requestRecount({ sessionId, lineId, currentCount, by }) {
    return upsert(lineId, sessionId, {
      recountRequestedAt: nowIso(),
      recountRequestedBy: by,
      firstCount: currentCount,
      recountedAt: null,
    });
  },

  async explain({ sessionId, lineId, text, by }) {
    const trimmed = text.trim();
    if (trimmed.length < MIN_EXPLANATION) {
      throw new ServiceError(
        "VALIDATION",
        `Explain the variance in at least ${MIN_EXPLANATION} characters.`,
        400,
      );
    }
    return upsert(lineId, sessionId, { explanation: trimmed, explainedBy: by, explainedAt: nowIso() });
  },

  async noteRecorded(sessionId, lineId) {
    const existing = await store.get(lineId);
    // Only a pending recount has anything to close; a first count needs no row.
    if (existing?.recountRequestedAt && !existing.recountedAt && existing.sessionId === sessionId) {
      await store.update(lineId, { recountedAt: nowIso() });
    }
  },
};

/** Where a line over the threshold stands. */
export type ReviewState = "clear" | "needs_review" | "awaiting_recount" | "recounted" | "explained";

export function reviewStateOf(exceeds: boolean, review: CountLineReview | undefined): ReviewState {
  if (!exceeds) return "clear";
  if (review?.explanation) return "explained";
  if (review?.recountRequestedAt) return review.recountedAt ? "recounted" : "awaiting_recount";
  return "needs_review";
}
