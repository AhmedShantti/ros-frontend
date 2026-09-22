"use client";

import { useRef, useState } from "react";
import type { MmCategory, MmId, MmItem, MmItemInput, MmModifierGroup, MmPricingMode, MmSize } from "@/lib/console/menu-management/types";
import { CHANNELS, CURRENCY_SYMBOL, hasValue, money, normalizeItem, num, ruleText, tempId } from "@/lib/console/menu-management/menu";
import { DeleteButton, EditorFooter, Icon, Section, StatusPicker, useSaver } from "./common";

/**
 * Add / edit an item.
 * onSave(payload) must return a promise; the drawer stays open and shows the error if it rejects.
 * attachGroupId: when a customization group is created from here, the parent passes its new id back to attach it.
 */
interface ItemEditorProps {
  item?: MmItem | null;
  defaultCategoryId?: MmId;
  categories: MmCategory[];
  groups: MmModifierGroup[];
  attachGroupId: MmId | null;
  onClose: () => void;
  onSave: (payload: MmItemInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onNewGroup: (name: string) => void;
  onEditGroup: (id: MmId) => void;
}

/** Form state: prices are kept as typed text until save. */
type ItemForm = Omit<MmItem, "categoryId" | "channelPrices" | "sizes"> & {
  categoryId: MmId | undefined;
  channelPrices: { takeaway: string | number; delivery: string | number };
  sizes: MmSize[];
};

export default function ItemEditor({ item, defaultCategoryId, categories, groups, attachGroupId, onClose, onSave, onDelete, onNewGroup, onEditGroup }: ItemEditorProps) {
  const [form, setForm] = useState<ItemForm>(() => {
    const base = normalizeItem(item || { id: "", name: "", kitchenName: "", price: "", description: "" });
    return {
      ...base,
      categoryId: item?.categoryId ?? defaultCategoryId ?? categories[0]?.id,
      price: base.price ?? "",
      channelPrices: { takeaway: base.channelPrices.takeaway ?? "", delivery: base.channelPrices.delivery ?? "" },
      sizes: base.sizes.map(s => ({ ...s }))
    };
  });
  const [pricesOpen, setPricesOpen] = useState(form.pricingMode !== "single");
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const { saving, error, run } = useSaver();

  // Clicking the dimmed page outside the drawer closes it (only if the press started outside too,
  // so selecting text inside the drawer and releasing outside doesn't close it).
  const pressedOutside = useRef(false);

  const set = (patch: Partial<ItemForm>) => setForm(f => ({ ...f, ...patch }));
  const attached = form.modifierGroupIds.filter(id => groups.some(g => g.id === id));
  const toggleGroup = (id: MmId) => set({ modifierGroupIds: attached.includes(id) ? attached.filter(x => x !== id) : [...attached, id] });

  // A group created from this drawer comes back as `attachGroupId`; attach it once when it changes.
  // (Adjusting state while rendering, per React's "storing information from previous renders".)
  const [seenAttachId, setSeenAttachId] = useState<MmId | null>(attachGroupId);
  if (attachGroupId !== seenAttachId) {
    setSeenAttachId(attachGroupId);
    if (attachGroupId != null && !form.modifierGroupIds.includes(attachGroupId)) {
      setForm(f => ({ ...f, modifierGroupIds: [...f.modifierGroupIds, attachGroupId] }));
    }
  }

  function setMode(mode: MmPricingMode) {
    if (mode === "size" && form.sizes.length === 0) {
      set({ pricingMode: mode, sizes: [{ id: tempId("size"), name: "", price: form.price }, { id: tempId("size"), name: "", price: "" }] });
    } else set({ pricingMode: mode });
  }
  const updateSize = (id: MmId, patch: Partial<MmSize>) => set({ sizes: form.sizes.map(s => (s.id === id ? { ...s, ...patch } : s)) });

  const validSizes = form.sizes.filter(s => String(s.name).trim() && hasValue(s.price));
  let problem = "";
  if (!form.name.trim()) problem = "Add an item name.";
  else if (form.categoryId == null) problem = "Create a category first.";
  else if (form.pricingMode === "size" && validSizes.length === 0) problem = "Add at least one size with a name and price.";
  else if (form.pricingMode !== "size" && !hasValue(form.price)) problem = "Add a price.";

  function startGroup() {
    const name = (newGroup || "").trim();
    if (!name) return;
    setNewGroup(null);
    onNewGroup(name);
  }

  function save() {
    const isSize = form.pricingMode === "size";
    const isChannel = form.pricingMode === "channel";
    if (form.categoryId == null) return;
    const payload: MmItemInput = {
      categoryId: form.categoryId,
      name: form.name.trim(),
      kitchenName: form.kitchenName.trim() || form.name.trim(),
      description: form.description.trim(),
      status: form.status,
      pricingMode: form.pricingMode,
      price: isSize ? (validSizes[0] ? num(validSizes[0].price) : 0) : num(form.price),
      channelPrices: {
        takeaway: isChannel && hasValue(form.channelPrices.takeaway) ? num(form.channelPrices.takeaway) : null,
        delivery: isChannel && hasValue(form.channelPrices.delivery) ? num(form.channelPrices.delivery) : null
      },
      sizes: isSize ? validSizes.map(s => ({ id: s.id, name: s.name.trim(), price: num(s.price) })) : [],
      modifierGroupIds: attached
    };
    run(() => onSave(payload));
  }

  return <div
    className="overlay"
    onMouseDown={e => { pressedOutside.current = e.target === e.currentTarget; }}
    onClick={e => { if (pressedOutside.current && e.target === e.currentTarget && !saving) onClose(); pressedOutside.current = false; }}
  >
    <div className="drawer">
      <div className="drawer-head">
        <div><span className="small-label">{item ? "EDIT ITEM" : "NEW ITEM"}</span><h2>{item ? item.name : "Add item"}</h2></div>
        <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
      </div>
      <div className="drawer-body">
        <Section title="Basic information">
          <label>Item name<input autoFocus={!item} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Chicken Burger"/></label>
          <label>Kitchen name<input value={form.kitchenName} onChange={e => set({ kitchenName: e.target.value })} placeholder="Name shown to kitchen (defaults to item name)"/></label>
          <label>Category
            <select value={form.categoryId ?? ""} onChange={e => set({ categoryId: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })}>
              {categories.length === 0 && <option value="">No categories yet</option>}
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Description<textarea value={form.description} onChange={e => set({ description: e.target.value })} placeholder="Short description customers will see"/></label>
        </Section>

        <Section title="Hide item or mark unavailable">
          <p className="section-help">Choose how this item appears to customers. You can also change this from the ⋯ menu on the item list.</p>
          <StatusPicker value={form.status} onChange={status => set({ status })}/>
        </Section>

        <Section title="Pricing">
          {form.pricingMode !== "size" && (
            <label>{form.pricingMode === "channel" ? "Dine-in price (default)" : "Price"}
              <div className="price-field"><span>{CURRENCY_SYMBOL}</span><input type="number" min="0" step="0.01" value={form.price} onChange={e => set({ price: e.target.value })} placeholder="0.00"/></div>
            </label>
          )}

          <button className={`advanced-row ${pricesOpen ? "open" : ""}`} onClick={() => setPricesOpen(o => !o)}>
            <span><strong>Different prices</strong><small>{form.pricingMode === "channel" ? "On — price changes by channel" : form.pricingMode === "size" ? `On — ${form.sizes.length} size${form.sizes.length === 1 ? "" : "s"}` : "Optional — add prices by channel or size"}</small></span>
            <span className="chev"><Icon name="chevron" size={16}/></span>
          </button>

          {pricesOpen && (
            <div className="prices-panel">
              <div className="radio-grid three">
                <button className={form.pricingMode === "single" ? "radio-card chosen" : "radio-card"} onClick={() => setMode("single")}><b>One price</b><small>Same price everywhere.</small></button>
                <button className={form.pricingMode === "channel" ? "radio-card chosen" : "radio-card"} onClick={() => setMode("channel")}><b>By channel</b><small>Different price for takeaway or delivery.</small></button>
                <button className={form.pricingMode === "size" ? "radio-card chosen" : "radio-card"} onClick={() => setMode("size")}><b>By size</b><small>e.g. Small, Medium, Large.</small></button>
              </div>

              {form.pricingMode === "channel" && (
                <div className="channel-prices">
                  <div className="channel-row"><span>Dine-in</span><div className="static-price">{hasValue(form.price) ? money(form.price) : "—"} <small>default</small></div></div>
                  {CHANNELS.filter(c => c.key !== "dineIn").map(c => ({ ...c, key: c.key as "takeaway" | "delivery" })).map(c => (
                    <div className="channel-row" key={c.key}>
                      <span>{c.label}</span>
                      <div className="price-field"><span>{CURRENCY_SYMBOL}</span><input type="number" min="0" step="0.01" value={form.channelPrices[c.key]} onChange={e => set({ channelPrices: { ...form.channelPrices, [c.key]: e.target.value } })} placeholder="Same as dine-in"/></div>
                    </div>
                  ))}
                  <p className="section-help">Leave a channel empty to use the dine-in price.</p>
                </div>
              )}

              {form.pricingMode === "size" && (
                <div className="size-prices">
                  <div className="size-head"><span>Size</span><span>Price</span><span></span></div>
                  {form.sizes.map(s => (
                    <div className="size-row" key={s.id}>
                      <input value={s.name} onChange={e => updateSize(s.id, { name: e.target.value })} placeholder="e.g. Medium"/>
                      <div className="price-field"><span>{CURRENCY_SYMBOL}</span><input type="number" min="0" step="0.01" value={s.price} onChange={e => updateSize(s.id, { price: e.target.value })} placeholder="0.00"/></div>
                      <button className="row-remove" aria-label="Remove size" onClick={() => set({ sizes: form.sizes.filter(x => x.id !== s.id) })}>×</button>
                    </div>
                  ))}
                  <button className="link-button" onClick={() => set({ sizes: [...form.sizes, { id: tempId("size"), name: "", price: "" }] })}>+ Add size</button>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Customizations">
          <p className="section-help">Option groups the customer picks from when ordering this item — e.g. sauces, extras, cooking level. Groups are shared, so one group can be used on many items.</p>
          {groups.length > 0 && <div className="modifier-picker vertical">
            {groups.map(g => (
              <button key={g.id} className={attached.includes(g.id) ? "picked" : ""} onClick={() => toggleGroup(g.id)}>
                <span className="pick-mark">{attached.includes(g.id) ? "✓" : "+"}</span>
                <span className="pick-copy"><strong>{g.name}</strong><small>{ruleText(g)} · {g.options.length ? g.options.map(o => o.name).join(", ") : "no options yet"}</small></span>
                {attached.includes(g.id) && <span className="pick-edit" role="button" onClick={e => { e.stopPropagation(); onEditGroup(g.id); }}>Edit</span>}
              </button>
            ))}
          </div>}
          {newGroup === null ? (
            <button className="link-button" onClick={() => setNewGroup("")}>+ Create customization group</button>
          ) : (
            <div className="inline-create">
              <input autoFocus value={newGroup} onChange={e => setNewGroup(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); startGroup(); } if (e.key === "Escape") { e.preventDefault(); setNewGroup(null); } }} placeholder="Group name, e.g. Cooking level"/>
              <button className="secondary" onClick={() => setNewGroup(null)}>Cancel</button>
              <button className="primary small" disabled={!newGroup.trim()} onClick={startGroup}>Next: add options</button>
            </div>
          )}
        </Section>
      </div>
      <EditorFooter
        left={item ? <DeleteButton label="Delete item" onConfirm={() => run(onDelete)}/> : null}
        problem={problem} error={error} saving={saving}
        saveLabel="Save item" onCancel={onClose} onSave={save}
      />
    </div>
  </div>;
}
