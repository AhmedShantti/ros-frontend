"use client";

/**
 * Nested modifier groups — FR-POS-023.
 *
 * "Add sauce" → "which sauce" → "how much": a modifier that opens another
 * group. The catalogue API has no field linking a modifier to a child group,
 * so the links are kept here, keyed by modifier id, behind the interface a
 * server can take over. Depth and cycles are checked by `canNest` in
 * `lib/console/modifier-rules.ts` before anything is written.
 */

import type { Id } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export interface NestingLink {
  modifierId: Id;
  childGroupId: Id;
  updatedAt: string;
}

const store = localCollection<NestingLink>(
  {
    name: "modifier-nesting",
    idOf: (row) => row.modifierId,
    factory: (input) => ({ modifierId: input.modifierId ?? "", childGroupId: input.childGroupId ?? "", updatedAt: nowIso() }),
  },
  () => getActiveTenantId(),
);

export interface ModifierNestingService {
  /** modifier id → child group id. */
  map(): Promise<Map<Id, Id>>;
  set(modifierId: Id, childGroupId: Id | null): Promise<void>;
}

export const modifierNestingService: ModifierNestingService = {
  async map() {
    return new Map((await store.all()).map((row) => [row.modifierId, row.childGroupId]));
  },
  async set(modifierId, childGroupId) {
    const existing = await store.get(modifierId);
    if (!childGroupId) {
      if (existing) await store.remove(modifierId);
      return;
    }
    if (existing) await store.update(modifierId, { childGroupId, updatedAt: nowIso() });
    else await store.create({ modifierId, childGroupId });
  },
};
