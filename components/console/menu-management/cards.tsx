"use client";

/** Menu Management — item and combo rows in the list. */

import { money, priceSummary, comboRegularPrice, comboPrice, comboBlockedSlots, type ItemIndex } from "@/lib/console/menu-management/menu";
import type { MmCombo, MmItem, MmModifierGroup } from "@/lib/console/menu-management/types";
import { Icon, RowMenu, StatusBadge, type RowMenuProps } from "./common";

type RowActions = Omit<RowMenuProps, "status">;

export function ItemCard({
  item,
  groups,
  showCategory,
  onEdit,
  onStatus,
  onDuplicate,
  onDelete,
}: RowActions & { item: MmItem & { categoryName?: string }; groups: MmModifierGroup[]; showCategory?: boolean }) {
  const price = priceSummary(item);
  const attached = item.modifierGroupIds.map(id => groups.find(g => g.id === id)).filter((g): g is MmModifierGroup => Boolean(g));
  return (
    <div className={`item-card status-${item.status}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{item.name}</h3>
            <StatusBadge status={item.status}/>
            {showCategory && <span className="category-badge">{item.categoryName}</span>}
          </div>
          <p>{item.description || "No description added."}</p>
          {attached.length > 0 && <div className="modifier-chips">{attached.map(g => <span key={g.id}>{g.name}</span>)}</div>}
        </div>
      </div>
      <div className="item-price">{price.main}{price.sub && <small>{price.sub}</small>}</div>
      <button className="edit-item" onClick={onEdit}><Icon name="edit" size={15}/> Edit</button>
      <RowMenu status={item.status} onEdit={onEdit} onStatus={onStatus} onDuplicate={onDuplicate} onDelete={onDelete}/>
    </div>
  );
}

export function ComboCard({ combo, itemById, onEdit, onStatus, onDuplicate, onDelete }: RowActions & { combo: MmCombo; itemById: ItemIndex }) {
  const regular = comboRegularPrice(combo, itemById);
  const price = comboPrice(combo, itemById);
  const saving = regular - price;
  const blocked = comboBlockedSlots(combo, itemById);
  return (
    <div className={`item-card status-${combo.status}`}>
      <div className="item-main">
        <div className="item-copy">
          <div className="item-title-row">
            <h3>{combo.name}</h3>
            <StatusBadge status={combo.status}/>
            {combo.status === "available" && blocked.length > 0 && <span className="warn-badge">Can&apos;t be ordered</span>}
          </div>
          <p>{combo.slots.map(s => `${s.label}: ${s.itemIds.map(id => itemById[id]?.name).filter(Boolean).join(" / ") || "—"}`).join("  ·  ")}</p>
          {combo.status === "available" && blocked.length > 0 && <p className="warn-text">No available item in: {blocked.map(s => s.label).join(", ")}</p>}
        </div>
      </div>
      <div className="item-price">{money(price)}{saving > 0.004 && <small className="saving">Save {money(saving)}</small>}</div>
      <button className="edit-item" onClick={onEdit}><Icon name="edit" size={15}/> Edit</button>
      <RowMenu status={combo.status} onEdit={onEdit} onStatus={onStatus} onDuplicate={onDuplicate} onDelete={onDelete}/>
    </div>
  );
}
