"use client";

import { useState } from "react";
import type { MmCategory, MmCombo, MmComboInput, MmComboPricing, MmComboSlot, MmId, MmStatus } from "@/lib/console/menu-management/types";
import type { ItemIndex } from "@/lib/console/menu-management/menu";
import { CURRENCY_SYMBOL, STATUS, channelPrice, comboPrice, comboRegularPrice, money, num, tempId } from "@/lib/console/menu-management/menu";
import { DeleteButton, EditorFooter, Icon, Section, StatusPicker, useSaver } from "./common";

/** Create / edit a combo. onSave(payload) must return a promise. */
interface ComboEditorProps {
  combo?: MmCombo | null;
  categories: MmCategory[];
  itemById: ItemIndex;
  onClose: () => void;
  onSave: (payload: MmComboInput) => Promise<void>;
  onDelete: () => Promise<void>;
}

/** Form state: price and discount are kept as typed text until save. */
interface ComboForm {
  name: string;
  description: string;
  status: MmStatus;
  pricing: MmComboPricing;
  price: string;
  discountPercent: string;
  slots: MmComboSlot[];
}

export default function ComboEditor({ combo, categories, itemById, onClose, onSave, onDelete }: ComboEditorProps) {
  const [form, setForm] = useState<ComboForm>(() => combo
    ? { ...combo, price: String(combo.price ?? ""), discountPercent: String(combo.discountPercent ?? ""), slots: combo.slots.map(s => ({ ...s, itemIds: s.itemIds.filter(id => itemById[id]) })) }
    : { name: "", description: "", status: "available", pricing: "fixed", price: "", discountPercent: "10", slots: [
        { id: tempId("slot"), label: "Main", itemIds: [] },
        { id: tempId("slot"), label: "Side", itemIds: [] },
        { id: tempId("slot"), label: "Drink", itemIds: [] }
      ] });
  const { saving, error, run } = useSaver();
  const set = (patch: Partial<ComboForm>) => setForm(f => ({ ...f, ...patch }));
  const updateSlot = (id: MmId, patch: Partial<MmComboSlot>) => set({ slots: form.slots.map(s => (s.id === id ? { ...s, ...patch } : s)) });

  const regular = comboRegularPrice(form, itemById);
  const price = comboPrice(form, itemById);
  const saving$ = regular - price;
  const hasPrice = form.pricing === "fixed" ? num(form.price) > 0 : num(form.discountPercent) > 0;
  const hasItems = categories.some(c => c.items.length);

  // Parts left empty are simply not saved, so you can fill only "Main" and ignore the rest.
  const filledSlots = form.slots.filter(s => s.itemIds.length);
  const pickedAny = filledSlots.length > 0;

  let problem = "";
  if (!form.name.trim()) problem = "Add a combo name.";
  else if (!pickedAny) problem = "Add at least one item to the combo.";
  else if (form.pricing === "fixed" && !(num(form.price) > 0)) problem = "Set the combo price.";
  else if (form.pricing === "discount" && !(num(form.discountPercent) > 0 && num(form.discountPercent) < 100)) problem = "Discount must be between 1 and 99%.";

  function save() {
    run(() => onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      status: form.status,
      pricing: form.pricing,
      price: form.pricing === "fixed" ? num(form.price) : null,
      discountPercent: form.pricing === "discount" ? num(form.discountPercent) : null,
      slots: filledSlots.map(s => ({ id: s.id, label: s.label.trim() || "Choice", itemIds: s.itemIds }))
    }));
  }

  return <div className="overlay">
    <div className="modal wide">
      <div className="drawer-head">
        <div><span className="small-label">COMBO</span><h2>{combo ? `Edit ${combo.name}` : "Create combo"}</h2></div>
        <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
      </div>
      <div className="drawer-body">
        <Section title="Basic information">
          <label>Combo name<input autoFocus={!combo} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Chicken Meal"/></label>
          <label>Description<input value={form.description} onChange={e => set({ description: e.target.value })} placeholder="e.g. Burger, side and a drink"/></label>
        </Section>

        <Section title="What's in the combo">
          <p className="section-help">Each part is one pick for the customer. Add several items to a part to let the customer choose — the first item is the default. Parts you leave empty are removed when you save.</p>
          {!hasItems && <p className="warn-text">This menu has no items yet. Add items first, then build combos from them.</p>}
          {form.slots.map((slot, idx) => (
            <div className="combo-slot" key={slot.id}>
              <div className="combo-slot-head">
                <span className="slot-num">{idx + 1}</span>
                <input value={slot.label} onChange={e => updateSlot(slot.id, { label: e.target.value })} placeholder="Part name, e.g. Drink"/>
                <button className="row-remove" aria-label="Remove part" onClick={() => set({ slots: form.slots.filter(s => s.id !== slot.id) })}>×</button>
              </div>
              <div className="slot-items">
                {slot.itemIds.length === 0 && <span className="muted">Empty — add an item, or leave it empty to skip this part.</span>}
                {slot.itemIds.map((id, i) => {
                  const it = itemById[id];
                  if (!it) return null;
                  return <span key={id} className={`slot-chip ${it.status !== "available" ? "dim" : ""}`}>
                    {it.name} <em>{money(channelPrice(it))}</em>
                    {i === 0 && <b>default</b>}
                    {it.status !== "available" && <b className="chip-warn">{STATUS[it.status].badge}</b>}
                    <button aria-label={`Remove ${it.name}`} onClick={() => updateSlot(slot.id, { itemIds: slot.itemIds.filter(x => x !== id) })}>×</button>
                  </span>;
                })}
              </div>
              <select value="" onChange={e => { const id = itemById[e.target.value]?.id; if (id != null) updateSlot(slot.id, { itemIds: [...slot.itemIds, id] }); }}>
                <option value="">+ Add an item to “{slot.label || "this part"}”…</option>
                {categories.filter(c => c.items.length).map(c => (
                  <optgroup key={c.id} label={c.name}>
                    {c.items.filter(i => !slot.itemIds.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.name} — {money(channelPrice(i))}{i.status !== "available" ? ` (${STATUS[i.status].badge})` : ""}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
          <button className="link-button" onClick={() => set({ slots: [...form.slots, { id: tempId("slot"), label: "", itemIds: [] }] })}>+ Add another part</button>
        </Section>

        <Section title="Pricing">
          <div className="radio-grid">
            <button className={form.pricing === "fixed" ? "radio-card chosen" : "radio-card"} onClick={() => set({ pricing: "fixed" })}><b>Fixed price</b><small>Customer pays one combo price, whatever they pick.</small></button>
            <button className={form.pricing === "discount" ? "radio-card chosen" : "radio-card"} onClick={() => set({ pricing: "discount" })}><b>Discount %</b><small>Sum of the picked items, minus a percentage.</small></button>
          </div>
          {form.pricing === "fixed"
            ? <label>Combo price<div className="price-field"><span>{CURRENCY_SYMBOL}</span><input type="number" min="0" step="0.01" value={form.price} onChange={e => set({ price: e.target.value })} placeholder="0.00"/></div></label>
            : <label>Discount<div className="price-field"><span>%</span><input type="number" min="1" max="99" step="1" value={form.discountPercent} onChange={e => set({ discountPercent: e.target.value })} placeholder="10"/></div></label>}
          {pickedAny ? (
            <div className="combo-summary">
              <div><span>Items bought separately (defaults)</span><b>{money(regular)}</b></div>
              <div><span>Combo price</span><b>{hasPrice ? money(price) : "—"}</b></div>
              {hasPrice && (
                <div className={saving$ > 0.004 ? "good" : saving$ < -0.004 ? "bad" : ""}>
                  <span>{saving$ < -0.004 ? "Combo costs more than buying the items separately" : saving$ > 0.004 ? "Customer saves" : "Same as buying separately"}</span>
                  <b>{Math.abs(saving$) > 0.004 ? money(Math.abs(saving$)) : ""}{regular > 0 && saving$ > 0.004 ? ` (${Math.round((saving$ / regular) * 100)}%)` : ""}</b>
                </div>
              )}
            </div>
          ) : (
            <p className="section-help summary-hint">Add items to the combo to see how much the customer saves.</p>
          )}
        </Section>

        <Section title="Hide combo or mark unavailable">
          <StatusPicker value={form.status} onChange={status => set({ status })} noun="combo"/>
        </Section>
      </div>
      <EditorFooter
        left={combo ? <DeleteButton label="Delete combo" onConfirm={() => run(onDelete)}/> : null}
        problem={problem} error={error} saving={saving}
        saveLabel={combo ? "Save combo" : "Create combo"} onCancel={onClose} onSave={save}
      />
    </div>
  </div>;
}
