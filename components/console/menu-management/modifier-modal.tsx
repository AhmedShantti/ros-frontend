"use client";

import { useState } from "react";
import type { MmId, MmItem, MmModifierGroup, MmModifierGroupInput, MmModifierOption } from "@/lib/console/menu-management/types";
import { CURRENCY_SYMBOL, hasValue, num, ruleText, tempId } from "@/lib/console/menu-management/menu";
import { Icon, useSaver } from "./common";

/** A group being edited. `id` is null until the server has created it. */
type GroupDraft = Omit<MmModifierGroup, "id"> & { id: MmId | null };

const blankGroup = (name = ""): GroupDraft => ({ id: null, name, required: false, multiple: false, maxSelections: null, options: [] });

function toDraft(g: GroupDraft): GroupDraft {
  return { ...g, maxSelections: g.maxSelections ?? "", options: g.options.map(o => ({ ...o, price: o.price ?? "" })) };
}

function toPayload(d: GroupDraft): MmModifierGroupInput {
  return {
    name: d.name.trim(),
    required: d.required,
    multiple: d.multiple,
    maxSelections: d.multiple && hasValue(d.maxSelections) && num(d.maxSelections) > 0 ? Math.floor(num(d.maxSelections)) : null,
    options: d.options.filter(o => String(o.name).trim()).map(o => ({ id: o.id, name: o.name.trim(), price: num(o.price) }))
  };
}

/**
 * Customization groups editor. Edits are kept in a draft and saved per group
 * (automatically when switching groups or pressing Done).
 * onCreate / onUpdate must return the saved group from the server.
 */
interface ModifierModalProps {
  groups: MmModifierGroup[];
  items: MmItem[];
  focusId?: MmId;
  newGroupName?: string;
  onCreate: (payload: MmModifierGroupInput) => Promise<MmModifierGroup>;
  onUpdate: (id: MmId, payload: MmModifierGroupInput) => Promise<MmModifierGroup>;
  onDelete: (id: MmId) => Promise<void>;
  onCreated?: (group: MmModifierGroup) => void;
  onClose: () => void;
}

export default function ModifierModal({ groups, items, focusId, newGroupName, onCreate, onUpdate, onDelete, onCreated, onClose }: ModifierModalProps) {
  const startGroup: GroupDraft | null = newGroupName != null ? blankGroup(newGroupName) : groups.find(g => g.id === focusId) || groups[0] || null;
  const [draft, setDraft] = useState<GroupDraft | null>(startGroup ? toDraft(startGroup) : null);
  const [original, setOriginal] = useState(startGroup ? JSON.stringify(toPayload(toDraft(startGroup))) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saving, error, run, setError } = useSaver();

  const isNew = Boolean(draft && draft.id == null);
  const dirty = Boolean(draft) && (isNew || (draft !== null && JSON.stringify(toPayload(draft)) !== original));
  const usedBy = draft && draft.id != null ? items.filter(i => i.modifierGroupIds.includes(draft.id as MmId)) : [];
  const invalid = !draft ? "" : (!draft.name.trim() ? "Give the group a name." : toPayload(draft).options.length === 0 ? "Add at least one option." : "");

  function load(g: GroupDraft | null) {
    setDraft(g ? toDraft(g) : null);
    setOriginal(g ? JSON.stringify(toPayload(toDraft(g))) : "");
    setConfirmDelete(false);
    setError("");
  }

  /** Save the current draft if it has changes. Returns false if saving failed or is blocked. */
  async function saveDraft() {
    if (!dirty) return true;
    if (!draft) return true;
    if (invalid) { setError(invalid); return false; }
    const current = draft;
    let ok = false;
    await run(async () => {
      const payload = toPayload(current);
      const saved = current.id == null ? await onCreate(payload) : await onUpdate(current.id, payload);
      if (isNew) onCreated?.(saved);
      load(saved);
      ok = true;
    });
    return ok;
  }

  async function switchTo(next: GroupDraft | null) {
    if (await saveDraft()) load(next);
  }

  async function done() {
    if (await saveDraft()) onClose();
  }

  const update = (patch: Partial<GroupDraft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const updateOption = (id: MmId, patch: Partial<MmModifierOption>) => update({ options: (draft?.options ?? []).map(o => (o.id === id ? { ...o, ...patch } : o)) });

  return <div className="overlay">
    <div className="modal wide">
      <div className="drawer-head"><div><span className="small-label">CUSTOMIZATIONS</span><h2>Customization groups</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close without saving"><Icon name="close"/></button></div>
      <div className="modifier-layout">
        <aside className="modifier-list">
          {groups.map(g => <button className={draft && g.id === draft.id ? "active" : ""} key={g.id} onClick={() => switchTo(g)} disabled={saving}>{g.name}<span>{g.options.length}</span></button>)}
          {isNew && draft && <button className="active">{draft.name || "New group"}<span>new</span></button>}
          {!isNew && <button className="add-category" onClick={() => switchTo(blankGroup())} disabled={saving}>+ New group</button>}
        </aside>
        <div className="modifier-editor">
          {!draft ? (
            <div className="empty">
              <div className="empty-icon"><Icon name="sliders" size={22}/></div>
              <h3>No customization groups yet</h3>
              <p>Create a group like “Sauces” or “Extras”, add its options, then attach it to items.</p>
              <button className="primary" onClick={() => load(blankGroup())}><Icon name="plus" size={16}/> New group</button>
            </div>
          ) : <>
            <label>Group name<input autoFocus={isNew} value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="e.g. Sauces"/></label>

            <div className="rules">
              <label className="checkline"><input type="checkbox" checked={draft.required} onChange={e => update({ required: e.target.checked })}/> Customer must choose (required)</label>
              <label className="checkline"><input type="checkbox" checked={draft.multiple} onChange={e => update({ multiple: e.target.checked })}/> Allow more than one choice</label>
              {draft.multiple && <label className="max-line">Maximum choices <input type="number" min="1" value={draft.maxSelections ?? ""} onChange={e => update({ maxSelections: e.target.value })} placeholder="No limit"/></label>}
            </div>
            <div className="rule-preview">Customer sees: <b>{draft.name || "Untitled"}</b> — {ruleText(draft)}</div>

            <h3>Options</h3>
            <div className="option-table"><div className="option-head"><span>Option</span><span>Extra charge</span><span></span></div>
              {draft.options.map(o => <div className="option-row" key={o.id}>
                <input value={o.name} onChange={e => updateOption(o.id, { name: e.target.value })} placeholder="Option name"/>
                <div className="price-field"><span>+{CURRENCY_SYMBOL}</span><input type="number" min="0" step="0.01" value={o.price} onChange={e => updateOption(o.id, { price: e.target.value })} placeholder="0.00"/></div>
                <button aria-label="Remove option" onClick={() => update({ options: draft.options.filter(x => x.id !== o.id) })}>×</button>
              </div>)}
            </div>
            <button className="link-button" onClick={() => update({ options: [...draft.options, { id: tempId("opt"), name: "", price: "" }] })}>+ Add option</button>

            {!isNew && <div className="used-by">
              <span className="small-label">USED ON {usedBy.length} ITEM{usedBy.length === 1 ? "" : "S"} IN THIS MENU</span>
              <p>{usedBy.length ? usedBy.map(i => i.name).join(", ") : "Not attached to any item in this menu. Open an item and pick this group under Customizations."}</p>
            </div>}

            {!isNew && <div className="group-danger">
              {confirmDelete
                ? <span className="delete-confirm">Delete “{draft.name}” and remove it from every item? <button className="delete" onClick={() => run(async () => { const gone = draft.id; if (gone == null) return; await onDelete(gone); load(groups.find(g => g.id !== gone) || null); })}>Yes, delete</button><button onClick={() => setConfirmDelete(false)}>Keep</button></span>
                : <button className="delete" onClick={() => setConfirmDelete(true)}>Delete group</button>}
            </div>}
          </>}
        </div>
      </div>
      <div className="drawer-footer">
        <div className="footer-status">{draft && (dirty ? <span className="footer-hint">Unsaved changes</span> : <span className="saved-hint">All changes saved</span>)}</div>
        <div className="footer-right">
          {error && <span className="footer-hint error">{error}</span>}
          {draft && dirty && <button className="secondary" data-enter disabled={saving} onClick={saveDraft}>{saving ? "Saving…" : isNew ? "Create group" : "Save group"}</button>}
          <button className="primary" disabled={saving} onClick={done}>Done</button>
        </div>
      </div>
    </div>
  </div>;
}
