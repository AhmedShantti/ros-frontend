"use client";

/**
 * FR-POS-084 — server sections.
 *
 * Sections are drawn up at the start of a service and redrawn when someone
 * calls in sick, so they are edited on the till, as a draft, and applied in
 * one audited `SECTIONS_SET`. The mode decides what a section does on the
 * floor: nothing, highlight the server's own tables, or restrict new
 * seating to them.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Id } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { tablesOf } from "@/lib/console/live/reducer";
import type { LiveState, ServerSection } from "@/lib/console/live/state";
import { worksAt } from "@/lib/console/live/approval";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { useConfirm } from "@/components/console/confirm";
import { Button, Callout, Field, Input, Modal, SegmentedControl, Select, cx } from "@/components/console/ui";

const SECTION_COLOURS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

type Mode = LiveState["settings"]["sectionMode"];

export function FloorSectionsSheet({ onClose }: { onClose: () => void }) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const confirm = useConfirm();

  const tables = useMemo(() => tablesOf(state), [state]);
  const servers = useMemo(() => activeEmployees.filter((e) => worksAt(e, state.branchId)), [state.branchId]);

  const [draft, setDraft] = useState<ServerSection[]>(() =>
    state.sections.filter((s) => s.branchId === state.branchId),
  );
  const [mode, setMode] = useState<Mode>(state.settings.sectionMode);
  const [activeId, setActiveId] = useState<Id | null>(draft[0]?.id ?? null);
  const active = draft.find((s) => s.id === activeId) ?? null;

  const patch = (id: Id, next: Partial<ServerSection>) =>
    setDraft((current) => current.map((s) => (s.id === id ? { ...s, ...next } : s)));

  function addSection() {
    const id = `sec_${Date.now().toString(36)}`;
    setDraft((current) => [
      ...current,
      {
        id,
        branchId: state.branchId,
        name: `${t("floor.section")} ${current.length + 1}`,
        colour: SECTION_COLOURS[current.length % SECTION_COLOURS.length]!,
        tableIds: [],
        serverId: null,
        serverName: null,
      },
    ]);
    setActiveId(id);
  }

  async function removeSection(section: ServerSection) {
    const ok = await confirm({
      title: t("floor.deleteSection").replace("{name}", section.name),
      body: t("floor.deleteSectionBody"),
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setDraft((current) => current.filter((s) => s.id !== section.id));
    setActiveId((current) => (current === section.id ? null : current));
  }

  /** A table belongs to one section: taking it into this one takes it out of any other. */
  function toggleTable(tableId: Id) {
    if (!active) return;
    setDraft((current) =>
      current.map((s) => {
        if (s.id === active.id) {
          return s.tableIds.includes(tableId)
            ? { ...s, tableIds: s.tableIds.filter((id) => id !== tableId) }
            : { ...s, tableIds: [...s.tableIds, tableId] };
        }
        return { ...s, tableIds: s.tableIds.filter((id) => id !== tableId) };
      }),
    );
  }

  // The reducer drops a section with neither tables nor a server; say so first.
  const empty = draft.filter((s) => s.tableIds.length === 0 && !s.serverId);

  function apply() {
    dispatch({ type: "SECTIONS_SET", sections: draft.map((s) => ({ ...s, name: s.name.trim() || t("floor.section") })) });
    if (mode !== state.settings.sectionMode) dispatch({ type: "SET_SETTINGS", patch: { sectionMode: mode } });
    onClose();
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("floor.sectionsTitle")}
      footer={
        <>
          <Button className="min-h-12" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="min-h-12" variant="primary" onClick={apply}>
            {t("floor.applySections")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("floor.sectionMode")} hint={t(`floor.mode.${mode}Hint` as "floor.mode.offHint")}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            label={t("floor.sectionMode")}
            options={[
              { value: "off", label: t("floor.mode.off") },
              { value: "highlight", label: t("floor.mode.highlight") },
              { value: "restrict", label: t("floor.mode.restrict") },
            ]}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {draft.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-pressed={section.id === activeId}
              onClick={() => setActiveId(section.id)}
              className={cx(
                "flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm",
                section.id === activeId ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-muted",
              )}
            >
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: section.colour }} />
              {section.name}
              <span className="text-fg-subtle text-xs tabular-nums">{section.tableIds.length}</span>
            </button>
          ))}
          <Button className="min-h-12" icon={<Plus size={14} />} onClick={addSection}>
            {t("floor.addSection")}
          </Button>
        </div>

        {active ? (
          <div className="border-line space-y-3 rounded-xl border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("common.name")}>
                <Input value={active.name} maxLength={32} onChange={(event) => patch(active.id, { name: event.target.value })} />
              </Field>
              <Field label={t("floor.server")}>
                <Select
                  value={active.serverId ?? ""}
                  onChange={(event) => {
                    const server = servers.find((e) => e.id === event.target.value) ?? null;
                    patch(active.id, { serverId: server?.id ?? null, serverName: server?.name ?? null });
                  }}
                >
                  <option value="">{t("floor.noServer")}</option>
                  {servers.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {tx(employee.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("floor.colour")}>
              <div className="flex flex-wrap gap-1.5">
                {SECTION_COLOURS.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    aria-label={colour}
                    aria-pressed={active.colour === colour}
                    onClick={() => patch(active.id, { colour })}
                    className={cx(
                      "h-12 w-12 rounded-lg border-2",
                      active.colour === colour ? "border-fg" : "border-transparent",
                    )}
                    style={{ background: colour }}
                  />
                ))}
              </div>
            </Field>
            <Field label={t("floor.sectionTables")} hint={t("floor.sectionTablesHint")}>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {tables.map((table) => {
                  const owner = draft.find((s) => s.tableIds.includes(table.id));
                  const mine = owner?.id === active.id;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      aria-pressed={mine}
                      onClick={() => toggleTable(table.id)}
                      className={cx(
                        "flex min-h-12 flex-col items-center justify-center rounded-lg border text-xs",
                        mine ? "text-fg font-semibold" : "border-line text-fg-muted",
                      )}
                      style={
                        owner
                          ? { boxShadow: `inset 0 0 0 ${mine ? 3 : 2}px ${owner.colour}`, opacity: mine ? 1 : 0.7 }
                          : undefined
                      }
                    >
                      {table.label}
                      {owner && !mine ? <span className="text-fg-subtle text-[0.6rem]">{owner.name}</span> : null}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Button className="min-h-12" variant="danger" icon={<Trash2 size={14} />} onClick={() => removeSection(active)}>
              {t("floor.deleteSectionShort")}
            </Button>
          </div>
        ) : (
          <Callout tone="muted">{t("floor.noSections")}</Callout>
        )}

        {empty.length > 0 ? (
          <Callout tone="warn">{t("floor.emptySections").replace("{names}", empty.map((s) => s.name).join(", "))}</Callout>
        ) : null}
        <p className="text-fg-subtle text-[0.68rem]">FR-POS-084</p>
      </div>
    </Modal>
  );
}
