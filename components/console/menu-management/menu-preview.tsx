"use client";

import { useState } from "react";
import type { MmCategory, MmChannel, MmCombo, MmItem, MmMenu, MmModifierGroup } from "@/lib/console/menu-management/types";
import type { ItemIndex } from "@/lib/console/menu-management/menu";
import { CHANNELS, channelPrice, comboBlockedSlots, comboPrice, comboRegularPrice, money, num, ruleText } from "@/lib/console/menu-management/menu";
import { Icon } from "./common";

/** Read-only customer view of the current (unpublished) menu. */
interface MenuPreviewProps {
  menu: MmMenu;
  categories: MmCategory[];
  combos: MmCombo[];
  itemById: ItemIndex;
  groups: MmModifierGroup[];
  onClose: () => void;
}

export default function MenuPreview({ menu, categories, combos, itemById, groups, onClose }: MenuPreviewProps) {
  const [channel, setChannel] = useState<MmChannel>(/delivery/i.test(menu.name) ? "delivery" : "dineIn");
  const shownCategories = categories.map(c => ({ ...c, items: c.items.filter(i => i.status !== "hidden") })).filter(c => c.items.length);
  const shownCombos = combos.filter(c => c.status !== "hidden");
  const groupsFor = (item: MmItem) => item.modifierGroupIds.map(id => groups.find(g => g.id === id)).filter((g): g is MmModifierGroup => Boolean(g && g.options.length));

  return <div className="preview-overlay">
    <div className="preview-window">
      <div className="preview-topbar">
        <div>
          <span className="preview-kicker">CUSTOMER PREVIEW</span>
          <h2>{menu.name}</h2>
        </div>
        <div className="preview-tools">
          <div className="segmented">
            {CHANNELS.map(c => <button key={c.key} className={channel === c.key ? "on" : ""} onClick={() => setChannel(c.key)}>{c.label}</button>)}
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
        </div>
      </div>

      <div className="customer-menu">
        <div className="customer-hero">
          <span>OUR MENU</span>
          <h1>{menu.name}</h1>
          {menu.description && <p>{menu.description}</p>}
        </div>

        {shownCombos.length > 0 && (
          <section className="customer-category">
            <h3>Combos</h3>
            <div className="customer-items">
              {shownCombos.map(combo => {
                const soldOut = combo.status === "unavailable" || comboBlockedSlots(combo, itemById).length > 0;
                const regular = comboRegularPrice(combo, itemById, channel);
                const price = comboPrice(combo, itemById, channel);
                return <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={combo.id}>
                  <div className="customer-food-copy">
                    <div><h4>{combo.name}</h4><strong>{money(price)}</strong></div>
                    {soldOut ? <span className="sold-tag">Sold out</span> : regular - price > 0.004 && <span className="save-tag">Save {money(regular - price)}</span>}
                    {combo.description && <p>{combo.description}</p>}
                    <ul className="combo-lines">
                      {combo.slots.map(s => {
                        const choices = s.itemIds.map(id => itemById[id]).filter((i): i is MmItem => Boolean(i && i.status === "available"));
                        return <li key={s.id}><b>{s.label}:</b> {choices.map(i => i.name).join(" or ") || "—"}</li>;
                      })}
                    </ul>
                  </div>
                </article>;
              })}
            </div>
          </section>
        )}

        {shownCategories.length ? shownCategories.map(c => (
          <section className="customer-category" key={c.id}>
            <h3>{c.name}</h3>
            <div className="customer-items">
              {c.items.map(item => {
                const soldOut = item.status === "unavailable";
                const sized = item.pricingMode === "size" && item.sizes.length > 0;
                return <article className={`customer-item ${soldOut ? "sold-out" : ""}`} key={item.id}>
                  <div className="customer-food-copy">
                    <div><h4>{item.name}</h4>{!sized && <strong>{money(channelPrice(item, channel))}</strong>}</div>
                    {soldOut && <span className="sold-tag">Sold out</span>}
                    {item.description && <p>{item.description}</p>}
                    {sized && <ul className="size-lines">{item.sizes.map(s => <li key={s.id}><span>{s.name}</span><b>{money(s.price)}</b></li>)}</ul>}
                    {groupsFor(item).map(g => (
                      <small className="mod-line" key={g.id}><b>{g.name}</b> ({ruleText(g).toLowerCase()}): {g.options.map(o => num(o.price) > 0 ? `${o.name} +${money(o.price)}` : o.name).join(", ")}</small>
                    ))}
                  </div>
                </article>;
              })}
            </div>
          </section>
        )) : (
          shownCombos.length === 0 && <div className="customer-empty">Nothing to show yet — add items to this menu.</div>
        )}
      </div>

      <div className="preview-footer">
        <span>Preview — hidden items are left out, unavailable items show as “Sold out”. Switch channel to check channel prices.</span>
        <button className="secondary" onClick={onClose}>Close preview</button>
      </div>
    </div>
  </div>;
}
