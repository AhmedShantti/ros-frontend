"use client";

/**
 * Dashboard customisation — FR-RPT-034, NFR-USA-009.
 *
 * Widget selection and arrangement, persisted per user, with a reset to the
 * role's default and — for whoever manages tenant settings — a tenant-level
 * default layout per role.
 *
 * Arrangement works three ways, all ending in the same `moveTo`:
 *
 *   - drag a row with a pointer (native HTML drag and drop);
 *   - focus a row's handle, press Space or Enter to pick it up, move it with
 *     the arrow keys (Home/End jump), Space or Enter to drop, Escape to put
 *     it back where it was;
 *   - the explicit Move up / Move down buttons, for switch and voice users.
 *
 * Every move is announced through a polite live region, so a screen-reader
 * user hears where the widget went.
 */

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Save, X } from "lucide-react";
import type { RoleKey } from "@/lib/console/types";
import { ROLE_DEFINITIONS, ROLE_KEYS } from "@/lib/console/permissions";
import {
  TEMPLATES,
  TEMPLATE_LABEL,
  WIDGETS,
  WIDGET_BY_ID,
  moveBy,
  moveTo,
  templateForRole,
  toggleWidget,
  widgetAllowed,
  type WidgetId,
} from "@/lib/console/reports/dashboard-layout";
import { useI18n, useSession } from "@/lib/console/providers";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Card, CardHeader, Field, Select, cx } from "@/components/console/ui";

export function DashboardCustomise({
  draft,
  onDraft,
  onSave,
  onCancel,
  onResetToRole,
  onSaveRoleDefault,
  onClearRoleDefault,
  saving,
  hasUserLayout,
}: {
  draft: WidgetId[];
  onDraft: (next: WidgetId[]) => void;
  onSave: () => void;
  onCancel: () => void;
  onResetToRole: () => void;
  onSaveRoleDefault: (role: RoleKey) => void;
  onClearRoleDefault: (role: RoleKey) => void;
  saving: boolean;
  hasUserLayout: boolean;
}) {
  const { t, tx } = useI18n();
  const { canAny, can, roleKey } = useSession();
  const confirm = useConfirm();

  const [grabbed, setGrabbed] = useState<{ id: WidgetId; origin: WidgetId[] } | null>(null);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [targetRole, setTargetRole] = useState<RoleKey>(roleKey);
  const handles = useRef(new Map<WidgetId, HTMLButtonElement>());
  const pendingFocus = useRef<WidgetId | null>(null);

  const titleOf = (id: WidgetId) => t(WIDGET_BY_ID.get(id)!.titleKey);
  const available = WIDGETS.filter((widget) => !draft.includes(widget.id) && widgetAllowed(widget.id, canAny));
  const canManageTenant = can("settings.tenant.manage");

  // Keep focus on the handle of the widget that just moved: React re-orders
  // the DOM nodes, and without this the focus ring would stay on whatever
  // row now occupies the old position.
  useEffect(() => {
    const id = pendingFocus.current;
    if (id) {
      handles.current.get(id)?.focus();
      pendingFocus.current = null;
    }
  });

  function announce(id: WidgetId, list: WidgetId[]) {
    setAnnouncement(
      t("dashc.moved")
        .replace("{widget}", titleOf(id))
        .replace("{position}", String(list.indexOf(id) + 1))
        .replace("{total}", String(list.length)),
    );
  }

  function move(id: WidgetId, delta: number) {
    const next = moveBy(draft, id, delta);
    pendingFocus.current = id;
    onDraft(next);
    announce(id, next);
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, id: WidgetId) {
    const index = draft.indexOf(id);
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbed?.id === id) {
        setGrabbed(null);
        setAnnouncement(t("dashc.dropped").replace("{widget}", titleOf(id)).replace("{position}", String(index + 1)));
      } else {
        setGrabbed({ id, origin: draft });
        setAnnouncement(t("dashc.grabbed").replace("{widget}", titleOf(id)));
      }
      return;
    }
    if (event.key === "Escape" && grabbed?.id === id) {
      event.preventDefault();
      pendingFocus.current = id;
      onDraft(grabbed.origin);
      setGrabbed(null);
      setAnnouncement(t("dashc.cancelled").replace("{widget}", titleOf(id)));
      return;
    }
    // Alt+Arrow moves without picking up first — a shortcut for sighted
    // keyboard users; the grab mode is the discoverable path.
    const active = grabbed?.id === id || event.altKey;
    if (!active) return;
    const target =
      event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? index - 1
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? index + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? draft.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = moveTo(draft, index, target);
    pendingFocus.current = id;
    onDraft(next);
    announce(id, next);
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, id: WidgetId) {
    setDragging(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function onDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();
    const id = (dragging ?? event.dataTransfer.getData("text/plain")) as WidgetId;
    const from = draft.indexOf(id);
    if (from !== -1) {
      const next = moveTo(draft, from, index);
      onDraft(next);
      announce(id, next);
    }
    setDragging(null);
    setOverIndex(null);
  }

  async function resetToRole() {
    const ok = await confirm({
      title: t("dashc.resetTitle"),
      body: t("dashc.resetBody"),
      confirmLabel: t("dashc.reset"),
      tone: "warn",
    });
    if (ok) onResetToRole();
  }

  async function saveRoleDefault() {
    const role = ROLE_DEFINITIONS[targetRole];
    const ok = await confirm({
      title: t("dashc.roleDefaultTitle").replace("{role}", tx(role.name)),
      body: t("dashc.roleDefaultBody"),
      confirmLabel: t("dashc.saveRoleDefault"),
      tone: "neutral",
    });
    if (ok) onSaveRoleDefault(targetRole);
  }

  async function clearRoleDefault() {
    const role = ROLE_DEFINITIONS[targetRole];
    const ok = await confirm({
      title: t("dashc.clearRoleDefaultTitle").replace("{role}", tx(role.name)),
      body: t("dashc.clearRoleDefaultBody"),
      confirmLabel: t("dashc.clearRoleDefault"),
      tone: "danger",
    });
    if (ok) onClearRoleDefault(targetRole);
  }

  return (
    <Card>
      <CardHeader
        title={t("dashc.title")}
        hint={t("dashc.hint")}
        spec="FR-RPT-034"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" icon={<X size={13} />} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" icon={<Save size={13} />} onClick={onSave} loading={saving}>
              {t("dashc.save")}
            </Button>
          </div>
        }
      />

      <p id="dashc-instructions" className="text-fg-subtle mb-3 text-xs leading-relaxed">
        {t("dashc.keyboardHelp")}
      </p>
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h3 className="text-fg mb-2 text-xs font-semibold">
            {t("dashc.onDashboard")} ({draft.length})
          </h3>
          {draft.length === 0 ? (
            <p className="text-fg-subtle border-line rounded-lg border border-dashed p-4 text-xs">{t("dashc.emptyDraft")}</p>
          ) : (
            <ol className="space-y-1.5" aria-label={t("dashc.onDashboard")}>
              {draft.map((id, index) => {
                const definition = WIDGET_BY_ID.get(id)!;
                const isGrabbed = grabbed?.id === id;
                return (
                  <li
                    key={id}
                    draggable
                    onDragStart={(event) => onDragStart(event, id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOverIndex(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setOverIndex(index);
                    }}
                    onDrop={(event) => onDrop(event, index)}
                    className={cx(
                      "border-line bg-raised flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                      isGrabbed && "border-accent bg-accent-soft",
                      dragging === id && "opacity-50",
                      overIndex === index && dragging !== null && dragging !== id && "border-accent",
                    )}
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) handles.current.set(id, node);
                        else handles.current.delete(id);
                      }}
                      aria-roledescription={t("dashc.sortable")}
                      aria-describedby="dashc-instructions"
                      aria-pressed={isGrabbed}
                      aria-label={t("dashc.handleLabel")
                        .replace("{widget}", titleOf(id))
                        .replace("{position}", String(index + 1))
                        .replace("{total}", String(draft.length))}
                      // No blur-to-drop: React re-inserting the moved row
                      // blurs it for a tick, and the effect above restores
                      // focus. Picking up another row replaces the grab.
                      onKeyDown={(event) => onHandleKey(event, id)}
                      className="text-fg-subtle hover:text-fg focus-visible:ring-accent flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                    <span className="text-fg-subtle w-5 shrink-0 text-center font-mono text-xs tabular-nums">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-fg truncate text-sm">{t(definition.titleKey)}</p>
                      <p className="text-fg-subtle text-[0.68rem]">
                        {definition.size === "full" ? t("dashc.fullWidth") : t("dashc.halfWidth")} · {definition.spec}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <IconAction label={t("dashc.moveUp").replace("{widget}", titleOf(id))} disabled={index === 0} onClick={() => move(id, -1)}>
                        <ArrowUp size={13} aria-hidden />
                      </IconAction>
                      <IconAction label={t("dashc.moveDown").replace("{widget}", titleOf(id))} disabled={index === draft.length - 1} onClick={() => move(id, 1)}>
                        <ArrowDown size={13} aria-hidden />
                      </IconAction>
                      <IconAction
                        label={t("dashc.remove").replace("{widget}", titleOf(id))}
                        onClick={() => {
                          const next = toggleWidget(draft, id);
                          onDraft(next);
                          setAnnouncement(t("dashc.removed").replace("{widget}", titleOf(id)));
                        }}
                      >
                        <X size={13} aria-hidden />
                      </IconAction>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div>
          <h3 className="text-fg mb-2 text-xs font-semibold">
            {t("dashc.available")} ({available.length})
          </h3>
          {available.length === 0 ? (
            <p className="text-fg-subtle text-xs">{t("dashc.allAdded")}</p>
          ) : (
            <ul className="space-y-1.5">
              {available.map((widget) => (
                <li key={widget.id} className="border-line flex items-start gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-fg text-sm">{t(widget.titleKey)}</p>
                    <p className="text-fg-subtle mt-0.5 text-[0.68rem] leading-relaxed">{t(widget.descriptionKey)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus size={12} aria-hidden />}
                    aria-label={t("dashc.add").replace("{widget}", t(widget.titleKey))}
                    onClick={() => {
                      onDraft(toggleWidget(draft, widget.id));
                      setAnnouncement(t("dashc.added").replace("{widget}", t(widget.titleKey)));
                    }}
                  >
                    {t("common.add")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-line mt-4 space-y-2 border-t pt-4">
            <p className="text-fg-muted text-xs">
              {t("dashc.roleTemplate")}: <Badge tone="muted">{t(TEMPLATE_LABEL[templateForRole(roleKey)])}</Badge>
            </p>
            <Button size="sm" variant="secondary" icon={<RotateCcw size={12} aria-hidden />} onClick={resetToRole} disabled={!hasUserLayout && sameAsTemplate(draft, roleKey)}>
              {t("dashc.reset")}
            </Button>
          </div>

          {canManageTenant ? (
            <div className="border-line mt-4 space-y-2 border-t pt-4">
              <h3 className="text-fg text-xs font-semibold">{t("dashc.tenantDefaults")}</h3>
              <p className="text-fg-subtle text-[0.68rem] leading-relaxed">{t("dashc.tenantDefaultsHint")}</p>
              <Field label={t("dashc.role")}>
                <Select value={targetRole} onChange={(event) => setTargetRole(event.target.value as RoleKey)}>
                  {ROLE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {tx(ROLE_DEFINITIONS[key].name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={saveRoleDefault}>
                  {t("dashc.saveRoleDefault")}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearRoleDefault}>
                  {t("dashc.clearRoleDefault")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function sameAsTemplate(list: WidgetId[], role: RoleKey): boolean {
  const template = TEMPLATES[templateForRole(role)];
  return list.length === template.length && list.every((id, index) => id === template[index]);
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-fg-muted hover:bg-sunken hover:text-fg focus-visible:ring-accent inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}
