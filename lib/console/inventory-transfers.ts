/**
 * Transfer helpers — SRS §11.5 / §17.4: FR-INV-033, FR-BRN-017.
 *
 * Pure. The transfer screen, the expiry worklist and the transfer note all
 * import from here.
 */

import type { Batch, Id, Localised, StockLevel, Transfer } from "./types";

// ---------------------------------------------------------------------------
// FR-INV-033 — what the transfer note's QR carries
// ---------------------------------------------------------------------------

/**
 * The QR on a transfer note has to be enough to *receive* against without a
 * lookup, because the backend has no transfer index to look one up in: the
 * receive call needs the dispatch reference and the destination, and the
 * receiving form wants the lines to pre-fill. Pipe-separated rather than
 * JSON because the encoder tops out at 213 bytes and braces and quotes are
 * bytes. Lines that do not fit are dropped and the payload says so, and the
 * receiver then enters those quantities by hand.
 */
const PREFIX = "ROSTRF1";
const MAX_BYTES = 200;

export interface TransferNotePayload {
  transferId: Id;
  toLocationId: Id;
  reference: string;
  lines: { itemId: Id; quantity: string }[];
  /** True when not every line fit in the code. */
  truncated: boolean;
}

export function encodeTransferNote(transfer: Pick<Transfer, "id" | "toLocationId" | "reference" | "lines">): string {
  let payload = [PREFIX, transfer.id, transfer.toLocationId, transfer.reference].join("|");
  let truncated = false;
  for (const line of transfer.lines) {
    const part = `|${line.itemId}:${line.dispatched.value}`;
    if (new TextEncoder().encode(payload + part + "|T").length > MAX_BYTES) {
      truncated = true;
      break;
    }
    payload += part;
  }
  return truncated ? `${payload}|T` : payload;
}

/** Null when the scanned text is not a transfer note. */
export function decodeTransferNote(text: string): TransferNotePayload | null {
  const parts = text.trim().split("|");
  if (parts[0] !== PREFIX || parts.length < 4) return null;
  const truncated = parts[parts.length - 1] === "T";
  const lineParts = parts.slice(4, truncated ? -1 : undefined);
  const lines: TransferNotePayload["lines"] = [];
  for (const part of lineParts) {
    const at = part.lastIndexOf(":");
    if (at <= 0) return null;
    const quantity = part.slice(at + 1);
    if (!/^-?\d*\.?\d+$/.test(quantity)) return null;
    lines.push({ itemId: part.slice(0, at), quantity });
  }
  return { transferId: parts[1]!, toLocationId: parts[2]!, reference: parts[3]!, lines, truncated };
}

// ---------------------------------------------------------------------------
// FR-BRN-017 — suggested transfers
// ---------------------------------------------------------------------------

export interface TransferSuggestionPolicy {
  /** Only batches expiring within this many days are candidates. */
  horizonDays: number;
  /** Days the stock spends on the road — lost shelf life at the destination. */
  transitDays: number;
  /** Ignore suggestions worth less than this (minor units). */
  minValueMinor: number;
}

export const DEFAULT_TRANSFER_SUGGESTION_POLICY: TransferSuggestionPolicy = {
  horizonDays: 7,
  transitDays: 1,
  minValueMinor: 5_000,
};

export interface TransferSuggestion {
  id: string;
  itemId: Id;
  itemName: Localised;
  unit: string;
  fromLocationId: Id;
  fromLocationName: Localised;
  toLocationId: Id;
  toLocationName: Localised;
  batchIds: Id[];
  /** Earliest expiry among the batches the quantity comes from. */
  expiresInDays: number;
  /** What the source holds that it will not use before expiry. */
  excess: number;
  /** How far below its target the destination sits. */
  shortage: number;
  /** What the destination can use before the stock expires. */
  destinationCanUse: number;
  /** False when either end's usage rate was unknown and assumed. */
  usageKnown: boolean;
  quantity: number;
  unitCostMinor: number;
  valueMinor: number;
}

/**
 * The rate a location uses an item, per day, read from the level's own days
 * of cover. Null when the projection does not know. An unknown rate at the
 * source is treated as zero use and the suggestion says so; at the
 * destination the shortage alone bounds the quantity.
 */
function dailyUseOf(level: StockLevel | undefined): number | null {
  if (!level || level.daysOfCover === null || level.daysOfCover <= 0) return null;
  const onHand = Number(level.onHand.value);
  return onHand > 0 ? onHand / level.daysOfCover : null;
}

export function suggestTransfers(
  batches: Batch[],
  levels: StockLevel[],
  policy: TransferSuggestionPolicy = DEFAULT_TRANSFER_SUGGESTION_POLICY,
): TransferSuggestion[] {
  const levelOf = new Map(levels.map((level) => [`${level.itemId}|${level.locationId}`, level]));
  const out: TransferSuggestion[] = [];

  // Batches grouped per (item, source), nearest expiry first (FEFO).
  const groups = new Map<string, Batch[]>();
  for (const batch of batches) {
    if (batch.daysToExpiry < 0 || batch.daysToExpiry > policy.horizonDays) continue;
    if (!(Number(batch.quantity.value) > 0)) continue;
    const key = `${batch.itemId}|${batch.locationId}`;
    groups.set(key, [...(groups.get(key) ?? []), batch]);
  }

  for (const [key, list] of groups) {
    list.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
    const sourceLevel = levelOf.get(key);
    const knownSourceUse = dailyUseOf(sourceLevel);
    const sourceUse = knownSourceUse ?? 0;

    // What the source cannot get through before each batch expires. Earlier
    // batches are used first, so each later batch only gets the capacity the
    // earlier ones left.
    let capacityUsed = 0;
    let excess = 0;
    const atRisk: Batch[] = [];
    for (const batch of list) {
      const capacity = Math.max(0, sourceUse * batch.daysToExpiry - capacityUsed);
      const quantity = Number(batch.quantity.value);
      const used = Math.min(quantity, capacity);
      capacityUsed += used;
      if (quantity - used > 0) {
        excess += quantity - used;
        atRisk.push(batch);
      }
    }
    if (excess <= 0 || atRisk.length === 0) continue;
    const first = atRisk[0]!;
    const usableDays = first.daysToExpiry - policy.transitDays;
    if (usableDays <= 0) continue;

    // Destinations short of the same item, most short first.
    const destinations = levels
      .filter((level) => level.itemId === first.itemId && level.locationId !== first.locationId)
      .map((level) => {
        const target = Math.max(level.parLevel, level.reorderPoint);
        const shortage = Math.max(0, target - Math.max(0, Number(level.onHand.value)));
        const use = dailyUseOf(level);
        const canUse = use === null ? shortage : use * usableDays;
        return { level, shortage, canUse, useKnown: use !== null };
      })
      .filter((row) => row.shortage > 0 && (row.level.status === "low" || row.level.status === "critical" || row.level.status === "negative"))
      .sort((a, b) => b.shortage - a.shortage);

    let remaining = excess;
    for (const destination of destinations) {
      if (remaining <= 0) break;
      const quantity = Math.floor(Math.min(remaining, destination.shortage, destination.canUse) * 1000) / 1000;
      if (quantity <= 0) continue;
      const valueMinor = Math.round(quantity * first.unitCost.amount);
      if (valueMinor < policy.minValueMinor) continue;
      remaining -= quantity;
      out.push({
        id: `sug:${first.itemId}:${first.locationId}:${destination.level.locationId}`,
        itemId: first.itemId,
        itemName: first.itemName,
        unit: first.quantity.unit,
        fromLocationId: first.locationId,
        fromLocationName: first.locationName,
        toLocationId: destination.level.locationId,
        toLocationName: destination.level.locationName,
        batchIds: atRisk.map((batch) => batch.id),
        expiresInDays: first.daysToExpiry,
        excess: Math.round(excess * 1000) / 1000,
        shortage: Math.round(destination.shortage * 1000) / 1000,
        destinationCanUse: Math.round(destination.canUse * 1000) / 1000,
        usageKnown: knownSourceUse !== null && destination.useKnown,
        quantity,
        unitCostMinor: first.unitCost.amount,
        valueMinor,
      });
    }
  }

  return out.sort((a, b) => a.expiresInDays - b.expiresInDays || b.valueMinor - a.valueMinor);
}
