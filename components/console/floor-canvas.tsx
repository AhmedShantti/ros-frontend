"use client";

/**
 * Floor plan geometry and drawing — FR-POS-080/081.
 *
 * One renderer for both the console editor and the till. The plan is stored
 * in grid cells, and every shape is placed as a percentage of the room, so
 * the same plan fits a wide laptop editor and a narrow till pane without a
 * second layout.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { Id, Localised, Order, RestaurantTable } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  FLOOR_PLAN_EVENT,
  type FloorArea,
  type FloorFixture,
  type FloorFixtureKind,
  type FloorPlacement,
  type FloorPlan,
  type FloorShape,
} from "@/lib/console/services/floor-plans";
import { cx } from "@/components/console/ui";

/** FR-POS-083 — when the last course went to the kitchen, or null if none has. */
export function lastCourseAt(order: Order | null | undefined): string | null {
  if (!order) return null;
  let latest: string | null = null;
  for (const line of order.lines) {
    if (line.state === "voided" || !line.firedAt) continue;
    if (!latest || line.firedAt > latest) latest = line.firedAt;
  }
  return latest;
}

export const DEFAULT_COLS = 24;
export const DEFAULT_ROWS = 16;

export const FLOOR_SHAPES: FloorShape[] = ["square", "round", "rect", "booth"];
export const FIXTURE_KINDS: FloorFixtureKind[] = ["wall", "bar", "door", "window", "plant", "label"];

/** The area key a table record belongs to: its English area name, or "main". */
export function areaKeyOf(table: Pick<RestaurantTable, "area">): string {
  const key = table.area?.en?.trim() || table.area?.ar?.trim();
  return key || "main";
}

/**
 * Every area on a branch: those the plan already knows (with their canvas
 * size) plus any a table names that the plan has not seen yet.
 */
export function areasFor(tables: RestaurantTable[], plan: FloorPlan | null): FloorArea[] {
  const areas = [...(plan?.areas ?? [])];
  for (const table of tables) {
    const key = areaKeyOf(table);
    if (areas.some((a) => a.key === key)) continue;
    const name: Localised =
      table.area && (table.area.en.trim() || table.area.ar.trim())
        ? table.area
        : { en: "Main floor", ar: "الصالة الرئيسية" };
    areas.push({ key, name, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
  }
  return areas;
}

/** Default footprint for a table of this many seats, in cells. */
export function defaultSize(capacity: number, shape: FloorShape): { w: number; h: number } {
  if (shape === "rect" || shape === "booth") return { w: capacity > 4 ? 5 : 4, h: 2 };
  const side = capacity > 6 ? 4 : capacity > 2 ? 3 : 2;
  return { w: side, h: side };
}

export function clampPlacement<T extends { x: number; y: number; w: number; h: number }>(
  item: T,
  area: Pick<FloorArea, "cols" | "rows">,
): T {
  const w = Math.max(1, Math.min(area.cols, Math.round(item.w)));
  const h = Math.max(1, Math.min(area.rows, Math.round(item.h)));
  return {
    ...item,
    w,
    h,
    x: Math.max(0, Math.min(area.cols - w, Math.round(item.x))),
    y: Math.max(0, Math.min(area.rows - h, Math.round(item.y))),
  };
}

/** The drawn footprint once a 90° rotation swaps width and height. */
export function footprint(p: Pick<FloorPlacement, "w" | "h" | "rotation">): { w: number; h: number } {
  return p.rotation === 90 ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/** Reads a branch's plan and follows saves from this tab and others. */
export function useFloorPlan(branchId: Id | null): { plan: FloorPlan | null; loaded: boolean; reload: () => void } {
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!branchId) {
      setPlan(null);
      setLoaded(true);
      return;
    }
    services.floorPlans
      .get(branchId)
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, tick]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key?.endsWith(".floor-plans")) bump();
    };
    window.addEventListener(FLOOR_PLAN_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(FLOOR_PLAN_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { plan, loaded, reload: () => setTick((n) => n + 1) };
}

const FIXTURE_LOOK: Record<FloorFixtureKind, string> = {
  wall: "bg-fg/70",
  bar: "bg-warn-soft border border-warn/60",
  door: "border-2 border-dashed border-accent/60 bg-transparent",
  window: "bg-accent-soft border border-accent/40",
  plant: "bg-good-soft border border-good/50 rounded-full",
  label: "bg-transparent",
};

export function shapeClass(shape: FloorShape): string {
  if (shape === "round") return "rounded-full";
  if (shape === "booth") return "rounded-t-2xl rounded-b-md border-b-4";
  return "rounded-lg";
}

/**
 * The room: a grid-paper canvas at the area's aspect ratio. Children are
 * positioned with `PlacedBox`.
 */
export function FloorRoom({
  area,
  children,
  grid = false,
  className,
  roomRef,
}: {
  area: Pick<FloorArea, "cols" | "rows">;
  children: ReactNode;
  /** Draw the cell grid — the editor wants it, the till does not. */
  grid?: boolean;
  className?: string;
  roomRef?: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={roomRef}
      className={cx("border-line bg-sunken relative w-full overflow-hidden rounded-xl border", grid && "touch-none", className)}
      style={{
        aspectRatio: `${area.cols} / ${area.rows}`,
        backgroundImage: grid
          ? "linear-gradient(to right, color-mix(in oklab, currentColor 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, currentColor 8%, transparent) 1px, transparent 1px)"
          : undefined,
        backgroundSize: grid ? `${100 / area.cols}% ${100 / area.rows}%` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** Absolutely positions a box in grid cells inside `FloorRoom`. Direction-agnostic (plans are drawn, not read). */
export function placedStyle(
  item: { x: number; y: number; w: number; h: number },
  area: Pick<FloorArea, "cols" | "rows">,
): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(item.x / area.cols) * 100}%`,
    top: `${(item.y / area.rows) * 100}%`,
    width: `${(item.w / area.cols) * 100}%`,
    height: `${(item.h / area.rows) * 100}%`,
  };
}

export function FixtureBox({
  fixture,
  area,
  label,
  selected,
  className,
  ...rest
}: {
  fixture: FloorFixture;
  area: Pick<FloorArea, "cols" | "rows">;
  label: string;
  selected?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={placedStyle(fixture, area)}
      className={cx(
        "text-fg-muted flex items-center justify-center overflow-hidden rounded-md text-[0.65rem] font-medium",
        FIXTURE_LOOK[fixture.kind],
        selected && "ring-accent ring-2",
        className,
      )}
    >
      {fixture.kind === "wall" ? null : <span className="truncate px-1">{label}</span>}
    </div>
  );
}
