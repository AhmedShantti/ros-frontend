"use client";

/**
 * Kitchen display setup — FR-KDS-011, 023, 029, 031, 044, 045.
 *
 * The backend has no KDS configuration endpoints: its queue route takes one
 * sort (`fifo`) and carries no routing rules, per-item targets or station
 * throughput. So the setup is kept here, per tenant, behind a service the
 * backend can replace — and both kitchen displays read it from here.
 *
 * `readKdsSetup()` is synchronous on purpose. The simulator's reducer routes
 * lines with it at fire time, and the live store mirrors it in on mount and
 * whenever `KDS_SETUP_EVENT` or a storage event says it changed.
 */

import { localDocument, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { DEFAULT_KDS_SETUP, normaliseKdsSetup, type KdsSetup } from "../live/kds";

export const KDS_SETUP_EVENT = "ros:kds-setup";
export const KDS_SETUP_COLLECTION = "kds-setup";

const store = localDocument<KdsSetup>(KDS_SETUP_COLLECTION, () => DEFAULT_KDS_SETUP, () => getActiveTenantId());

export interface KdsSetupService {
  get(): Promise<KdsSetup>;
  save(next: KdsSetup): Promise<KdsSetup>;
  reset(): Promise<KdsSetup>;
}

export function readKdsSetup(): KdsSetup {
  try {
    return normaliseKdsSetup(store.read());
  } catch {
    return DEFAULT_KDS_SETUP;
  }
}

function announce(setup: KdsSetup) {
  try {
    window.dispatchEvent(new CustomEvent(KDS_SETUP_EVENT, { detail: setup }));
  } catch {
    // No window (server render) — nothing is listening anyway.
  }
}

export const kdsSetupService: KdsSetupService = {
  async get() {
    return readKdsSetup();
  },
  async save(next) {
    const saved = normaliseKdsSetup({ ...next, updatedAt: nowIso() });
    store.write(saved);
    announce(saved);
    return saved;
  },
  async reset() {
    const fresh = store.reset();
    announce(fresh);
    return fresh;
  },
};
