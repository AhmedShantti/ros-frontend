"use client";

/**
 * Floor plans — FR-POS-080.
 *
 * The API models a table's label, section (area) and seat count, and nothing
 * about where it stands or what shape it is. So a table's identity, area and
 * capacity stay with `services.operations` (real endpoints), and its drawing
 * — position, size, shape, rotation — plus the room's fixtures are kept here,
 * one plan per branch, behind a service the backend can replace.
 *
 * Coordinates are grid cells, not pixels, so a plan drawn on a laptop renders
 * the same room on a till of any width.
 */

import type { Id, Localised } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export type FloorShape = "square" | "round" | "rect" | "booth";

export type FloorFixtureKind = "wall" | "bar" | "door" | "window" | "plant" | "label";

export interface FloorPlacement {
  tableId: Id;
  /** The area (room) this table is drawn in — matches `FloorArea.key`. */
  areaKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: FloorShape;
  rotation: 0 | 90;
}

export interface FloorFixture {
  id: Id;
  areaKey: string;
  kind: FloorFixtureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: Localised | null;
}

export interface FloorArea {
  /** Stable key: the area's English name as the table records carry it. */
  key: string;
  name: Localised;
  /** Canvas size in grid cells. */
  cols: number;
  rows: number;
}

export interface FloorPlan {
  branchId: Id;
  areas: FloorArea[];
  placements: FloorPlacement[];
  fixtures: FloorFixture[];
  updatedAt: string;
}

const store = localCollection<FloorPlan>(
  {
    name: "floor-plans",
    idOf: (row) => row.branchId,
    factory: (input) =>
      ({ branchId: input.branchId ?? "", areas: [], placements: [], fixtures: [], updatedAt: nowIso(), ...input }) as FloorPlan,
  },
  () => getActiveTenantId(),
);

export const FLOOR_PLAN_EVENT = "ros:floor-plan";

export interface FloorPlanService {
  get(branchId: Id): Promise<FloorPlan | null>;
  save(plan: Omit<FloorPlan, "updatedAt">): Promise<FloorPlan>;
  remove(branchId: Id): Promise<void>;
}

export const floorPlanService: FloorPlanService = {
  async get(branchId) {
    return store.get(branchId);
  },
  async save(plan) {
    const existing = await store.get(plan.branchId);
    const next = { ...plan, updatedAt: nowIso() };
    const saved = existing ? await store.update(plan.branchId, next) : await store.create(next);
    try {
      window.dispatchEvent(new CustomEvent(FLOOR_PLAN_EVENT, { detail: saved.branchId }));
    } catch {
      // Server render — nobody is listening.
    }
    return saved;
  },
  async remove(branchId) {
    const existing = await store.get(branchId);
    if (existing) await store.remove(branchId);
  },
};
