"use client";

/**
 * Settings overrides — SRS §6.4.
 *
 * The backend has no settings endpoint in `api/openapi.json`, so the
 * overrides live in the browser-local store behind this interface, exactly
 * as customers do (`./crm`). The resolver in `lib/console/settings.ts` is
 * pure and does not care where the rows came from; swapping this file for a
 * server implementation changes nothing above it.
 *
 * Two rules are enforced here rather than in the editor, because they are
 * properties of the data and a second screen writing settings would
 * otherwise have to remember them:
 *
 *   - **A lock above you is final** (FR-PLT-026). Writing at a level that a
 *     higher level has locked is refused, naming the lock.
 *   - **Financial history is append-only** (FR-PLT-028). A financial version
 *     can only take effect today or later, and one already in force can
 *     never be edited or removed — the transactions made under it would be
 *     re-read with a value they were never charged.
 */

import {
  LEVEL_LABEL,
  SETTING_BY_KEY,
  contextFor,
  levelApplies,
  levelIndex,
  resolveSetting,
  todayIso,
  type SettingContext,
  type SettingOverride,
  type SettingValue,
} from "../settings";
import type { CountryPack, Id } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

const tenantOf = () => getActiveTenantId();

const store = localCollection<SettingOverride>(
  {
    name: "settings-overrides",
    idOf: (row) => row.id,
    sorters: { createdAt: (row) => row.createdAt },
    filters: { key: (row) => row.key, level: (row) => row.level },
    factory: (input, id) => ({
      id,
      key: input.key ?? "",
      level: input.level ?? "tenant",
      targetId: input.targetId ?? "",
      value: input.value ?? null,
      locked: input.locked ?? false,
      effectiveFrom: input.effectiveFrom ?? null,
      note: input.note ?? null,
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
    }),
  },
  tenantOf,
);

export interface SetOverrideInput {
  key: string;
  level: SettingOverride["level"];
  targetId: Id;
  /** `null` hands a financial setting back to the level above. */
  value: SettingValue | null;
  locked: boolean;
  /** Required for financial settings; ignored for the rest. */
  effectiveFrom?: string | null;
  note?: string | null;
  createdBy?: string | null;
  /** Where the write is being made from — needed to check the locks above. */
  context: SettingContext;
  packs?: CountryPack[];
}

export interface SettingsService {
  overrides(): Promise<SettingOverride[]>;
  /** Every version ever written for one setting, newest first. */
  history(key: string): Promise<SettingOverride[]>;
  set(input: SetOverrideInput): Promise<SettingOverride>;
  /**
   * Stop overriding at this level. Non-financial rows are removed; a
   * financial setting can only have its *future* versions withdrawn.
   */
  clear(key: string, level: SettingOverride["level"], targetId: Id): Promise<void>;
}

function lockLabel(level: keyof typeof LEVEL_LABEL): string {
  return LEVEL_LABEL[level].en;
}

export const settingsService: SettingsService = {
  async overrides() {
    return store.all();
  },

  async history(key) {
    const all = await store.all();
    return all
      .filter((row) => row.key === key)
      .sort(
        (a, b) =>
          (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") ||
          b.createdAt.localeCompare(a.createdAt),
      );
  },

  async set(input) {
    const definition = SETTING_BY_KEY.get(input.key);
    if (!definition) {
      throw new ServiceError("NOT_FOUND", "That setting does not exist.", 404);
    }
    if (!levelApplies(definition, input.level)) {
      throw new ServiceError(
        "VALIDATION",
        `${definition.label.en} cannot differ below ${lockLabel(definition.lowestLevel)} level.`,
        400,
      );
    }
    if (!input.targetId) {
      throw new ServiceError("VALIDATION", "Choose what this value applies to.", 400);
    }

    const today = todayIso();
    const effectiveFrom = definition.financial ? (input.effectiveFrom ?? today) : null;
    if (definition.financial && effectiveFrom! < today) {
      throw new ServiceError(
        "VALIDATION",
        "A financial setting cannot take effect in the past.",
        400,
        "Transactions already made were charged under the version then in force (FR-PLT-028).",
      );
    }

    const all = await store.all();

    // FR-PLT-026 — the lock is checked as at the moment the value would take
    // effect, so a lock that only starts next month does not block today.
    const resolved = resolveSetting(definition, all, contextFor(input.level, input.context), {
      packs: input.packs,
      asAt: effectiveFrom ?? today,
    });
    if (resolved.lockedAt && levelIndex(resolved.lockedAt) < levelIndex(input.level)) {
      throw new ServiceError(
        "LOCKED",
        `Locked at ${lockLabel(resolved.lockedAt)} level.`,
        409,
        "A higher level has locked this setting, so nothing below it can override it.",
      );
    }

    const sameSlot = (row: SettingOverride) =>
      row.key === input.key && row.level === input.level && row.targetId === input.targetId;

    let kept: SettingOverride[];
    if (definition.financial) {
      // A second version on the same date replaces the first, but only while
      // that date is still ahead of us — once in force it is history.
      kept = all.filter(
        (row) => !(sameSlot(row) && row.effectiveFrom === effectiveFrom && effectiveFrom! > today),
      );
      if (kept.length !== all.length) await store.replace(kept);
    } else {
      kept = all.filter((row) => !sameSlot(row));
      if (kept.length !== all.length) await store.replace(kept);
    }

    return store.create({
      key: input.key,
      level: input.level,
      targetId: input.targetId,
      value: input.value,
      locked: input.value === null ? false : input.locked,
      effectiveFrom,
      note: input.note?.trim() || null,
      createdBy: input.createdBy ?? null,
    });
  },

  async clear(key, level, targetId) {
    const definition = SETTING_BY_KEY.get(key);
    const all = await store.all();
    const today = todayIso();
    const matching = all.filter(
      (row) => row.key === key && row.level === level && row.targetId === targetId,
    );
    if (matching.length === 0) return;

    if (!definition?.financial) {
      await store.replace(all.filter((row) => !matching.includes(row)));
      return;
    }

    const future = matching.filter((row) => (row.effectiveFrom ?? "") > today);
    if (future.length === 0) {
      throw new ServiceError(
        "CONFLICT",
        "Versions already in force cannot be removed.",
        409,
        "Schedule a version that hands the setting back to the level above instead.",
      );
    }
    await store.replace(all.filter((row) => !future.includes(row)));
  },
};
