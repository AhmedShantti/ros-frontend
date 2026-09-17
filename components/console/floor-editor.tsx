"use client";

/**
 * FR-POS-080 — the graphical floor plan editor.
 *
 * Areas, tables, shapes, capacities and positions. What the API owns — a
 * table's label, its area ("section" on the wire) and its seat count — is
 * written through `services.operations` the moment it is changed. What the
 * API has no field for — where a table stands, its shape, rotation, and the
 * room's walls, bar and doors — is a draft here until "Save layout" writes
 * it to `services.floorPlans`, which is browser-local. The page says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Plus, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import type { Id, Localised, RestaurantTable } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type {
  FloorArea,
  FloorFixture,
  FloorFixtureKind,
  FloorPlacement,
  FloorPlan,
  FloorShape,
} from "@/lib/console/services/floor-plans";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField, hasLocalisedText, trimLocalised } from "@/components/console/fields";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  FIXTURE_KINDS,
  FLOOR_SHAPES,
  FixtureBox,
  FloorRoom,
  areaKeyOf,
  areasFor,
  clampPlacement,
  defaultSize,
  footprint,
  placedStyle,
  shapeClass,
  useFloorPlan,
} from "@/components/console/floor-canvas";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Tabs,
  Toast,
  cx,
} from "@/components/console/ui";

type Selection = { kind: "table"; id: Id } | { kind: "fixture"; id: Id } | null;

interface Draft {
  areas: FloorArea[];
  placements: FloorPlacement[];
  fixtures: FloorFixture[];
}

interface DragState {
  kind: "table" | "fixture";
  id: Id;
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
  cellW: number;
  cellH: number;
}

export function FloorEditor({ branchId }: { branchId: Id }) {
  const { t, tx } = useI18n();
  const confirm = useConfirm();

  const { scope } = useSession();
  const tablesQuery = useAsync(
    () =>
      services.operations
        .tables({ scope: { ...scope, branchId }, limit: 500 })
        .then((page) => page.rows.filter((row) => row.branchId === branchId)),
    [branchId, scope.tenantId],
  );
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const { plan, loaded, reload: reloadPlan } = useFloorPlan(branchId);

  const [draft, setDraft] = useState<Draft>({ areas: [], placements: [], fixtures: [] });
  const [dirty, setDirty] = useState(false);
  const [areaKey, setAreaKey] = useState<string>("");
  const [selection, setSelection] = useState<Selection>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  const [areaModal, setAreaModal] = useState<"add" | "rename" | null>(null);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3500);
  }, []);

  // Load (or reload) the stored plan into the draft — unless there are
  // unsaved edits, which a background reload must never throw away.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!loaded || dirtyRef.current) return;
    setDraft({
      areas: plan?.areas ?? [],
      placements: plan?.placements ?? [],
      fixtures: plan?.fixtures ?? [],
    });
  }, [plan, loaded]);

  const areas = useMemo(
    () => areasFor(tables, { ...(plan ?? { branchId, updatedAt: "" }), ...draft } as FloorPlan),
    [tables, plan, draft, branchId],
  );
  const area = areas.find((a) => a.key === areaKey) ?? areas[0] ?? null;

  useEffect(() => {
    if (!areaKey && areas[0]) setAreaKey(areas[0].key);
  }, [areas, areaKey]);

  const tableById = useMemo(() => new Map(tables.map((row) => [row.id, row])), [tables]);

  /** A placement is drawn in the area its table record names now. */
  const placementsHere = draft.placements.filter((p) => {
    const table = tableById.get(p.tableId);
    return table && area && areaKeyOf(table) === area.key;
  });
  const fixturesHere = draft.fixtures.filter((f) => area && f.areaKey === area.key);
  const placedIds = new Set(draft.placements.filter((p) => tableById.has(p.tableId)).map((p) => p.tableId));
  const unplaced = tables.filter((row) => !placedIds.has(row.id));

  const edit = useCallback((mutate: (current: Draft) => Draft) => {
    setDraft((current) => mutate(current));
    setDirty(true);
  }, []);

  // ---- geometry --------------------------------------------------------

  const roomNode = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);

  function beginDrag(
    event: React.PointerEvent<HTMLElement>,
    kind: "table" | "fixture",
    id: Id,
    mode: "move" | "resize",
  ) {
    if (!area || !roomNode.current) return;
    const item =
      kind === "table"
        ? draft.placements.find((p) => p.tableId === id)
        : draft.fixtures.find((f) => f.id === id);
    if (!item) return;
    event.stopPropagation();
    const rect = roomNode.current.getBoundingClientRect();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      kind,
      id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      // Tables drag by their drawn footprint, which a 90° turn swaps.
      orig: kind === "table" ? { x: item.x, y: item.y, ...footprint(item as FloorPlacement) } : { x: item.x, y: item.y, w: item.w, h: item.h },
      cellW: rect.width / area.cols,
      cellH: rect.height / area.rows,
    };
    setSelection(kind === "table" ? { kind: "table", id } : { kind: "fixture", id });
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !area) return;
    // Pointer deltas are physical; in RTL the plan is still drawn left-to-right.
    const dx = Math.round((event.clientX - state.startX) / state.cellW);
    const dy = Math.round((event.clientY - state.startY) / state.cellH);
    if (dx === 0 && dy === 0) return;
    const next =
      state.mode === "move"
        ? { ...state.orig, x: state.orig.x + dx, y: state.orig.y + dy }
        : { ...state.orig, w: state.orig.w + dx, h: state.orig.h + dy };
    patchGeometry(state.kind, state.id, next);
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function patchGeometry(kind: "table" | "fixture", id: Id, geometry: { x: number; y: number; w: number; h: number }) {
    if (!area) return;
    edit((current) =>
      kind === "table"
        ? {
            ...current,
            placements: current.placements.map((p) => {
              if (p.tableId !== id) return p;
              // Clamp the drawn footprint, then store it back unrotated.
              const drawn = p.rotation === 90 ? { ...geometry, w: geometry.h, h: geometry.w } : geometry;
              const clamped = clampPlacement({ ...p, ...drawn }, area);
              return clamped;
            }),
          }
        : { ...current, fixtures: current.fixtures.map((f) => (f.id === id ? clampPlacement({ ...f, ...geometry }, area) : f)) },
    );
  }

  /** Arrow keys move a focused shape one cell; with Shift they resize it. */
  function onShapeKey(event: React.KeyboardEvent, kind: "table" | "fixture", id: Id) {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = step[event.key];
    if (!delta) {
      if (event.key === "Delete" && kind === "fixture") void deleteFixture(id);
      return;
    }
    event.preventDefault();
    const item =
      kind === "table" ? draft.placements.find((p) => p.tableId === id) : draft.fixtures.find((f) => f.id === id);
    if (!item) return;
    const base = kind === "table" ? { ...item, ...footprint(item as FloorPlacement) } : item;
    patchGeometry(
      kind,
      id,
      event.shiftKey
        ? { x: base.x, y: base.y, w: base.w + delta[0], h: base.h + delta[1] }
        : { x: base.x + delta[0], y: base.y + delta[1], w: base.w, h: base.h },
    );
  }

  /** The first spot in the area a shape of this size fits without overlapping. */
  function freeSpot(size: { w: number; h: number }, target: FloorArea, current: Draft): { x: number; y: number } {
    const taken = [
      ...current.placements
        .filter((p) => {
          const table = tableById.get(p.tableId);
          return table && areaKeyOf(table) === target.key;
        })
        .map((p) => ({ x: p.x, y: p.y, ...footprint(p) })),
      ...current.fixtures.filter((f) => f.areaKey === target.key),
    ];
    for (let y = 1; y + size.h <= target.rows; y += 1) {
      for (let x = 1; x + size.w <= target.cols; x += 1) {
        const clash = taken.some(
          (r) => x < r.x + r.w + 1 && x + size.w + 1 > r.x && y < r.y + r.h + 1 && y + size.h + 1 > r.y,
        );
        if (!clash) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function place(table: RestaurantTable) {
    const target = areas.find((a) => a.key === areaKeyOf(table));
    if (!target) return;
    edit((current) => {
      const shape: FloorShape = table.capacity > 4 ? "rect" : "square";
      const size = defaultSize(table.capacity, shape);
      const spot = freeSpot(size, target, current);
      const placement: FloorPlacement = { tableId: table.id, areaKey: target.key, ...size, ...spot, shape, rotation: 0 };
      return {
        ...current,
        // The area the table lives in joins the plan, so its canvas size is kept.
        areas: current.areas.some((a) => a.key === target.key) ? current.areas : [...current.areas, target],
        placements: [...current.placements.filter((p) => p.tableId !== table.id), placement],
      };
    });
    setAreaKey(target.key);
    setSelection({ kind: "table", id: table.id });
  }

  function addFixture(kind: FloorFixtureKind) {
    if (!area) return;
    const size = kind === "wall" ? { w: 8, h: 1 } : kind === "bar" ? { w: 6, h: 2 } : { w: 2, h: 2 };
    const id = `fx_${Date.now().toString(36)}`;
    edit((current) => {
      const spot = freeSpot(size, area, current);
      const fixture: FloorFixture = {
        id,
        areaKey: area.key,
        kind,
        ...size,
        ...spot,
        label: kind === "label" ? { en: "Label", ar: "تسمية" } : null,
      };
      return {
        ...current,
        areas: current.areas.some((a) => a.key === area.key) ? current.areas : [...current.areas, area],
        fixtures: [...current.fixtures, fixture],
      };
    });
    setSelection({ kind: "fixture", id });
  }

  async function deleteFixture(id: Id) {
    const ok = await confirm({
      title: t("floor.deleteFixture"),
      body: t("floor.deleteFixtureBody"),
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    edit((current) => ({ ...current, fixtures: current.fixtures.filter((f) => f.id !== id) }));
    setSelection(null);
  }

  async function saveLayout() {
    setSaving(true);
    try {
      // Placements are recorded against the area their table names now.
      const placements = draft.placements
        .filter((p) => tableById.has(p.tableId))
        .map((p) => ({ ...p, areaKey: areaKeyOf(tableById.get(p.tableId)!) }));
      const usedAreas = new Set([...placements.map((p) => p.areaKey), ...draft.fixtures.map((f) => f.areaKey)]);
      await services.floorPlans.save({
        branchId,
        areas: areas.filter((a) => usedAreas.has(a.key) || draft.areas.some((d) => d.key === a.key)),
        placements,
        fixtures: draft.fixtures,
      });
      setDirty(false);
      reloadPlan();
      flash(t("floor.saved"));
    } catch (error) {
      flash(error instanceof Error ? error.message : t("floor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    const ok = await confirm({
      title: t("floor.discardTitle"),
      body: t("floor.discardBody"),
      tone: "warn",
      confirmLabel: t("floor.discard"),
    });
    if (!ok) return;
    setDirty(false);
    setDraft({ areas: plan?.areas ?? [], placements: plan?.placements ?? [], fixtures: plan?.fixtures ?? [] });
    setSelection(null);
  }

  async function clearPlan() {
    const ok = await confirm({
      title: t("floor.clearTitle"),
      body: t("floor.clearBody"),
      tone: "danger",
      confirmLabel: t("floor.clear"),
    });
    if (!ok) return;
    await services.floorPlans.remove(branchId);
    setDirty(false);
    setDraft({ areas: [], placements: [], fixtures: [] });
    setSelection(null);
    reloadPlan();
    flash(t("floor.cleared"));
  }

  const selectedPlacement =
    selection?.kind === "table" ? draft.placements.find((p) => p.tableId === selection.id) ?? null : null;
  const selectedTable = selection?.kind === "table" ? tableById.get(selection.id) ?? null : null;
  const selectedFixture =
    selection?.kind === "fixture" ? draft.fixtures.find((f) => f.id === selection.id) ?? null : null;

  if (tablesQuery.loading && !tablesQuery.data) {
    return <Callout tone="muted">{t("state.loading")}</Callout>;
  }

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("floor.storageNote")}</Callout>

      <div className="flex flex-wrap items-center gap-2">
        {dirty ? <Badge tone="warn" dot>{t("floor.unsaved")}</Badge> : <Badge tone="good" dot>{t("floor.upToDate")}</Badge>}
        <div className="flex-1" />
        <Button className="min-h-12" icon={<Plus size={14} />} onClick={() => setCreatingTable(true)}>
          {t("floor.newTable")}
        </Button>
        <Button className="min-h-12" icon={<Plus size={14} />} onClick={() => setAreaModal("add")}>
          {t("floor.newArea")}
        </Button>
        <Button className="min-h-12" icon={<Undo2 size={14} />} disabled={!dirty} onClick={discard}>
          {t("floor.discard")}
        </Button>
        <Button className="min-h-12" variant="danger" icon={<Eraser size={14} />} disabled={!plan} onClick={clearPlan}>
          {t("floor.clear")}
        </Button>
        <Button
          className="min-h-12"
          variant="primary"
          icon={<Save size={14} />}
          loading={saving}
          disabled={!dirty}
          onClick={saveLayout}
        >
          {t("floor.saveLayout")}
        </Button>
      </div>

      {areas.length === 0 || !area ? (
        <Callout tone="muted">{t("floor.noTables")}</Callout>
      ) : (
        <>
          <Tabs
            value={area.key}
            onChange={(key) => {
              setAreaKey(key);
              setSelection(null);
            }}
            label={t("floor.areas")}
            options={areas.map((a) => ({
              value: a.key,
              label: tx(a.name),
              count: tables.filter((row) => areaKeyOf(row) === a.key).length,
            }))}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-3">
              {/* Plans are drawn, not read: the room keeps its left-to-right geometry in Arabic too. */}
              <div dir="ltr">
                <FloorRoom
                  area={area}
                  grid
                  roomRef={(node) => {
                    roomNode.current = node;
                  }}
                >
                  <div className="absolute inset-0" onPointerDown={() => setSelection(null)} />
                  {fixturesHere.map((fixture) => (
                    <FixtureBox
                      key={fixture.id}
                      fixture={fixture}
                      area={area}
                      label={fixture.label ? tx(fixture.label) : t(`floor.fixture.${fixture.kind}` as "floor.fixture.bar")}
                      selected={selection?.kind === "fixture" && selection.id === fixture.id}
                      tabIndex={0}
                      role="button"
                      aria-label={t(`floor.fixture.${fixture.kind}` as "floor.fixture.bar")}
                      className="cursor-move focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
                      onPointerDown={(event) => beginDrag(event, "fixture", fixture.id, "move")}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => onShapeKey(event, "fixture", fixture.id)}
                      onFocus={() => setSelection({ kind: "fixture", id: fixture.id })}
                    />
                  ))}
                  {placementsHere.map((placement) => {
                    const table = tableById.get(placement.tableId)!;
                    const drawn = { x: placement.x, y: placement.y, ...footprint(placement) };
                    const selected = selection?.kind === "table" && selection.id === table.id;
                    return (
                      <div
                        key={placement.tableId}
                        role="button"
                        tabIndex={0}
                        aria-label={`${table.label} · ${table.capacity} ${t("pos.seats")}`}
                        style={placedStyle(drawn, area)}
                        onPointerDown={(event) => beginDrag(event, "table", table.id, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(event) => onShapeKey(event, "table", table.id)}
                        onFocus={() => setSelection({ kind: "table", id: table.id })}
                        className={cx(
                          "border-accent/60 bg-raised text-fg flex cursor-move flex-col items-center justify-center border-2 text-center select-none",
                          "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                          shapeClass(placement.shape),
                          selected && "ring-accent ring-2",
                        )}
                      >
                        <span className="truncate px-1 text-xs font-bold">{table.label}</span>
                        <span className="text-fg-subtle text-[0.6rem] tabular-nums">{table.capacity}</span>
                        {selected ? (
                          <span
                            aria-hidden
                            onPointerDown={(event) => beginDrag(event, "table", table.id, "resize")}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            className="bg-accent absolute -right-1.5 -bottom-1.5 h-4 w-4 cursor-se-resize rounded-sm"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </FloorRoom>
              </div>
              <p className="text-fg-subtle text-xs">{t("floor.keyboardHint")}</p>

              <Card>
                <CardHeader title={t("floor.unplaced")} hint={t("floor.unplacedHint")} />
                {unplaced.length === 0 ? (
                  <p className="text-fg-subtle text-sm">{t("floor.allPlaced")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {unplaced.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => place(row)}
                          className="border-line hover:border-accent hover:bg-accent-soft flex min-h-12 min-w-12 flex-col items-start rounded-lg border px-3 py-1.5 text-start"
                        >
                          <span className="text-fg text-sm font-semibold">{row.label}</span>
                          <span className="text-fg-subtle text-[0.68rem]">
                            {tx(row.area)} · {row.capacity} {t("pos.seats")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="space-y-3">
              {selectedTable && selectedPlacement ? (
                <TablePanel
                  key={selectedTable.id}
                  table={selectedTable}
                  placement={selectedPlacement}
                  areas={areas}
                  onGeometry={(patch) =>
                    edit((current) => ({
                      ...current,
                      placements: current.placements.map((p) =>
                        p.tableId === selectedTable.id ? clampPlacement({ ...p, ...patch }, area) : p,
                      ),
                    }))
                  }
                  onUnplace={() => {
                    edit((current) => ({
                      ...current,
                      placements: current.placements.filter((p) => p.tableId !== selectedTable.id),
                    }));
                    setSelection(null);
                  }}
                  onSaved={(updated, movedTo) => {
                    tablesQuery.reload();
                    if (movedTo) {
                      const target = areas.find((a) => a.key === movedTo);
                      if (target) {
                        edit((current) => ({
                          ...current,
                          areas: current.areas.some((a) => a.key === target.key) ? current.areas : [...current.areas, target],
                          placements: current.placements.map((p) =>
                            p.tableId === updated.id ? clampPlacement({ ...p, areaKey: target.key }, target) : p,
                          ),
                        }));
                        setAreaKey(target.key);
                      }
                    }
                    flash(t("floor.tableSaved"));
                  }}
                />
              ) : selectedFixture ? (
                <FixturePanel
                  key={selectedFixture.id}
                  fixture={selectedFixture}
                  onChange={(patch) =>
                    edit((current) => ({
                      ...current,
                      fixtures: current.fixtures.map((f) =>
                        f.id === selectedFixture.id ? clampPlacement({ ...f, ...patch }, area) : f,
                      ),
                    }))
                  }
                  onDelete={() => void deleteFixture(selectedFixture.id)}
                />
              ) : (
                <Card>
                  <CardHeader title={tx(area.name)} spec="FR-POS-080" />
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t("floor.cols")}>
                        <Input
                          type="number"
                          min={8}
                          max={60}
                          value={area.cols}
                          onChange={(event) =>
                            edit((current) => ({
                              ...current,
                              areas: upsertArea(current.areas, {
                                ...area,
                                cols: Math.max(8, Math.min(60, Number(event.target.value) || DEFAULT_COLS)),
                              }),
                            }))
                          }
                        />
                      </Field>
                      <Field label={t("floor.rows")}>
                        <Input
                          type="number"
                          min={6}
                          max={40}
                          value={area.rows}
                          onChange={(event) =>
                            edit((current) => ({
                              ...current,
                              areas: upsertArea(current.areas, {
                                ...area,
                                rows: Math.max(6, Math.min(40, Number(event.target.value) || DEFAULT_ROWS)),
                              }),
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <Button className="min-h-12 w-full" onClick={() => setAreaModal("rename")}>
                      {t("floor.renameArea")}
                    </Button>
                    <div>
                      <p className="text-fg-subtle mb-1.5 text-xs font-medium">{t("floor.addFixture")}</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {FIXTURE_KINDS.map((kind) => (
                          <Button key={kind} className="min-h-12" onClick={() => addFixture(kind)}>
                            {t(`floor.fixture.${kind}` as "floor.fixture.bar")}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-fg-subtle text-xs">{t("floor.selectHint")}</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {creatingTable ? (
        <NewTableModal
          branchId={branchId}
          areas={areas}
          defaultArea={area}
          onClose={() => setCreatingTable(false)}
          onCreated={() => {
            setCreatingTable(false);
            tablesQuery.reload();
            flash(t("floor.tableCreated"));
          }}
        />
      ) : null}

      {areaModal ? (
        <AreaModal
          mode={areaModal}
          area={areaModal === "rename" ? area : null}
          existing={areas}
          tables={tables}
          onClose={() => setAreaModal(null)}
          onAdded={(name) => {
            const key = name.en.trim() || name.ar.trim();
            edit((current) => ({
              ...current,
              areas: upsertArea(current.areas, { key, name, cols: DEFAULT_COLS, rows: DEFAULT_ROWS }),
            }));
            setAreaKey(key);
            setAreaModal(null);
          }}
          onRenamed={async (oldKey, name, failures) => {
            const key = name.en.trim() || name.ar.trim();
            const next: Draft = {
              areas: draft.areas.some((a) => a.key === oldKey)
                ? draft.areas.map((a) => (a.key === oldKey ? { ...a, key, name } : a))
                : [...draft.areas, { ...(area ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }), key, name }],
              placements: draft.placements.map((p) => (p.areaKey === oldKey ? { ...p, areaKey: key } : p)),
              fixtures: draft.fixtures.map((f) => (f.areaKey === oldKey ? { ...f, areaKey: key } : f)),
            };
            setAreaModal(null);
            tablesQuery.reload();
            // The tables already carry the new name on the server, so the
            // plan is saved with it straight away rather than left diverged.
            await services.floorPlans.save({ branchId, ...next });
            setDraft(next);
            setDirty(false);
            setAreaKey(key);
            reloadPlan();
            flash(failures > 0 ? t("floor.renamePartial").replace("{n}", String(failures)) : t("floor.renamed"));
          }}
        />
      ) : null}

      <Toast message={message} />
    </div>
  );
}

function upsertArea(areas: FloorArea[], area: FloorArea): FloorArea[] {
  return areas.some((a) => a.key === area.key) ? areas.map((a) => (a.key === area.key ? area : a)) : [...areas, area];
}

// ---------------------------------------------------------------------------

function TablePanel({
  table,
  placement,
  areas,
  onGeometry,
  onUnplace,
  onSaved,
}: {
  table: RestaurantTable;
  placement: FloorPlacement;
  areas: FloorArea[];
  onGeometry: (patch: Partial<FloorPlacement>) => void;
  onUnplace: () => void;
  onSaved: (table: RestaurantTable, movedToArea: string | null) => void;
}) {
  const { t, tx } = useI18n();
  const [label, setLabel] = useState(table.label);
  const [capacity, setCapacity] = useState(String(table.capacity));
  const [areaKey, setAreaKey] = useState(areaKeyOf(table));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = label.trim() !== table.label || Number(capacity) !== table.capacity || areaKey !== areaKeyOf(table);

  async function save() {
    const seats = Number(capacity);
    if (!label.trim() || !Number.isInteger(seats) || seats < 1) {
      setError(t("floor.tableInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const target = areas.find((a) => a.key === areaKey);
      const updated = await services.operations.updateTable(table.id, {
        label: label.trim(),
        capacity: seats,
        area: target ? target.name : table.area,
      });
      onSaved(updated, areaKey !== areaKeyOf(table) ? areaKey : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("floor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={table.label} hint={t("floor.tableApiNote")} spec="FR-POS-080" />
      <div className="space-y-3">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <Field label={t("ops.tableLabel")} required>
          <Input value={label} maxLength={24} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label={t("floor.capacity")} required>
          <Input
            type="number"
            min={1}
            max={40}
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>
        <Field label={t("floor.area")}>
          <Select value={areaKey} onChange={(event) => setAreaKey(event.target.value)}>
            {areas.map((a) => (
              <option key={a.key} value={a.key}>
                {tx(a.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Button className="min-h-12 w-full" variant="primary" disabled={!changed} loading={saving} onClick={save}>
          {t("floor.saveTable")}
        </Button>

        <div className="border-line space-y-3 border-t pt-3">
          <p className="text-fg-subtle text-xs">{t("floor.layoutLocalNote")}</p>
          <Field label={t("floor.shape")}>
            <SegmentedControl
              value={placement.shape}
              onChange={(shape) => onGeometry({ shape })}
              label={t("floor.shape")}
              options={FLOOR_SHAPES.map((shape) => ({ value: shape, label: t(`floor.shape.${shape}` as "floor.shape.round") }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("floor.width")}>
              <Input
                type="number"
                min={1}
                value={placement.w}
                onChange={(event) => onGeometry({ w: Number(event.target.value) || 1 })}
              />
            </Field>
            <Field label={t("floor.height")}>
              <Input
                type="number"
                min={1}
                value={placement.h}
                onChange={(event) => onGeometry({ h: Number(event.target.value) || 1 })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="min-h-12"
              icon={<RotateCw size={14} />}
              onClick={() => onGeometry({ rotation: placement.rotation === 90 ? 0 : 90 })}
            >
              {t("floor.rotate")}
            </Button>
            <Button className="min-h-12" onClick={onUnplace}>
              {t("floor.unplace")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function FixturePanel({
  fixture,
  onChange,
  onDelete,
}: {
  fixture: FloorFixture;
  onChange: (patch: Partial<FloorFixture>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader title={t(`floor.fixture.${fixture.kind}` as "floor.fixture.bar")} hint={t("floor.layoutLocalNote")} />
      <div className="space-y-3">
        <Field label={t("floor.fixtureKind")}>
          <Select value={fixture.kind} onChange={(event) => onChange({ kind: event.target.value as FloorFixtureKind })}>
            {FIXTURE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`floor.fixture.${kind}` as "floor.fixture.bar")}
              </option>
            ))}
          </Select>
        </Field>
        {fixture.kind !== "wall" ? (
          <LocalisedField
            label={t("floor.fixtureLabel")}
            value={fixture.label ?? EMPTY_LOCALISED}
            onChange={(label) => onChange({ label: hasLocalisedText(label) ? label : null })}
            maxLength={32}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("floor.width")}>
            <Input type="number" min={1} value={fixture.w} onChange={(event) => onChange({ w: Number(event.target.value) || 1 })} />
          </Field>
          <Field label={t("floor.height")}>
            <Input type="number" min={1} value={fixture.h} onChange={(event) => onChange({ h: Number(event.target.value) || 1 })} />
          </Field>
        </div>
        <Button className="min-h-12 w-full" variant="danger" icon={<Trash2 size={14} />} onClick={onDelete}>
          {t("floor.deleteFixture")}
        </Button>
      </div>
    </Card>
  );
}

function NewTableModal({
  branchId,
  areas,
  defaultArea,
  onClose,
  onCreated,
}: {
  branchId: Id;
  areas: FloorArea[];
  defaultArea: FloorArea | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [areaKey, setAreaKey] = useState(defaultArea?.key ?? areas[0]?.key ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const seats = Number(capacity);
    if (!label.trim() || !Number.isInteger(seats) || seats < 1) {
      setError(t("floor.tableInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const area = areas.find((a) => a.key === areaKey);
      await services.operations.createTable(branchId, {
        label: label.trim(),
        capacity: seats,
        area: area?.name ?? { en: "Main floor", ar: "الصالة الرئيسية" },
      });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("floor.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("floor.newTable")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={pending} disabled={!label.trim()} onClick={create}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <Field label={t("ops.tableLabel")} required>
          <Input data-autofocus value={label} maxLength={24} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label={t("floor.capacity")} required>
          <Input type="number" min={1} max={40} value={capacity} onChange={(event) => setCapacity(event.target.value)} />
        </Field>
        {areas.length > 0 ? (
          <Field label={t("floor.area")}>
            <Select value={areaKey} onChange={(event) => setAreaKey(event.target.value)}>
              {areas.map((a) => (
                <option key={a.key} value={a.key}>
                  {tx(a.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <p className="text-fg-subtle text-xs">{t("floor.tableApiNote")}</p>
      </div>
    </Modal>
  );
}

function AreaModal({
  mode,
  area,
  existing,
  tables,
  onClose,
  onAdded,
  onRenamed,
}: {
  mode: "add" | "rename";
  area: FloorArea | null;
  existing: FloorArea[];
  tables: RestaurantTable[];
  onClose: () => void;
  onAdded: (name: Localised) => void;
  onRenamed: (oldKey: string, name: Localised, failures: number) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState<Localised>(area ? area.name : { ...EMPTY_LOCALISED });
  const [pending, setPending] = useState(false);
  const trimmed = trimLocalised(name);
  const key = trimmed.en || trimmed.ar;
  const clash = existing.some((a) => a.key === key && a.key !== area?.key);

  async function submit() {
    if (!hasLocalisedText(trimmed) || clash) return;
    if (mode === "add") {
      onAdded(trimmed);
      return;
    }
    if (!area) return;
    setPending(true);
    // The area is a field on every table in it — rename it there too, one
    // real update per table, and report any the server refused.
    const inArea = tables.filter((row) => areaKeyOf(row) === area.key);
    const results = await Promise.allSettled(
      inArea.map((row) => services.operations.updateTable(row.id, { area: trimmed })),
    );
    setPending(false);
    await onRenamed(area.key, trimmed, results.filter((r) => r.status === "rejected").length);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "add" ? t("floor.newArea") : t("floor.renameArea")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={pending} disabled={!hasLocalisedText(trimmed) || clash} onClick={submit}>
            {mode === "add" ? t("common.create") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <LocalisedField label={t("floor.areaName")} value={name} onChange={setName} required maxLength={48} />
        {clash ? <Callout tone="warn">{t("floor.areaExists")}</Callout> : null}
        {mode === "rename" ? <p className="text-fg-subtle text-xs">{t("floor.renameNote")}</p> : null}
        {mode === "add" ? <p className="text-fg-subtle text-xs">{t("floor.newAreaNote")}</p> : null}
      </div>
    </Modal>
  );
}
