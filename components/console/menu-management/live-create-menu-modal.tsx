"use client";

/**
 * Menu Management LIVE workspace — Create menu.
 *
 * Visual counterpart of the demo workspace's `create-menu-modal.tsx` (same
 * centered `.overlay`/`.modal` shape, same shared `menu-management.css`),
 * wired to the real `services.catalogue.menus.create` + branch assignment
 * calls — no mock state, current canonical order-type/branch data only.
 */

import { useState } from "react";
import type { Branch, Localised, Menu } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { services } from "@/lib/console/services";
import { ORDER_TYPE } from "@/lib/console/labels";
import { Icon, Section, useEscape, useSaver } from "./common";

const ORDER_TYPE_CHOICES = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup"] as const;

interface LiveCreateMenuModalProps {
  availableBranches: Branch[];
  defaultBranchId?: string | null;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onClose: () => void;
  onCreated: (menu: Menu) => void;
}

export default function LiveCreateMenuModal({ availableBranches, defaultBranchId, tx, t, onClose, onCreated }: LiveCreateMenuModalProps) {
  const { saving, error, run } = useSaver(t("mm.somethingWrong"));
  useEscape(!saving, onClose);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("10");
  const [orderTypes, setOrderTypes] = useState<string[]>(["dine_in"]);
  const [branchIds, setBranchIds] = useState<string[]>(defaultBranchId ? [defaultBranchId] : []);

  const problem = !name.trim() ? t("menu.addAMenuName") : "";

  function toggleOrderType(type: string) {
    setOrderTypes((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
  }
  function toggleBranch(id: string) {
    setBranchIds((cur) => (cur.includes(id) ? cur.filter((b) => b !== id) : [...cur, id]));
  }

  function create() {
    if (!name.trim()) return;
    run(async () => {
      const menu = await services.catalogue.menus.create({
        name: { en: name.trim(), ar: name.trim() },
        priority: Number(priority) || 0,
        orderTypes,
      });
      for (const branchId of branchIds) {
        await services.catalogue.assignMenuToBranch(menu.id, branchId);
      }
      onCreated(menu);
    });
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal">
        <div className="drawer-head">
          <div>
            <span className="small-label">{t("menu.newMenuLabel")}</span>
            <h2>{t("menu.newMenuTitle")}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <Section title={t("menu.basicInfo")}>
            <label>
              {t("menu.menuName")}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mm.placeholderMenuName")} />
            </label>
            <label>
              {t("menu.priority")}
              <input inputMode="numeric" dir="ltr" value={priority} onChange={(e) => setPriority(e.target.value)} />
              <small className="field-hint">{t("mm.priorityHint")}</small>
            </label>
          </Section>

          <Section title={t("menu.orderTypes")}>
            <div className="radio-grid three">
              {ORDER_TYPE_CHOICES.map((type) => (
                <button key={type} className={orderTypes.includes(type) ? "radio-card chosen" : "radio-card"} onClick={() => toggleOrderType(type)}>
                  <b>{tx(ORDER_TYPE[type].label)}</b>
                </button>
              ))}
            </div>
          </Section>

          {availableBranches.length > 0 ? (
            <Section title={t("menu.assignToBranches")}>
              <div className="radio-grid three">
                {availableBranches.map((branch) => (
                  <button key={branch.id} className={branchIds.includes(branch.id) ? "radio-card chosen" : "radio-card"} onClick={() => toggleBranch(branch.id)}>
                    <b>{tx(branch.name)}</b>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
        <div className="drawer-footer">
          <div></div>
          <div className="footer-right">
            {error ? <span className="footer-hint error">{error}</span> : problem ? <span className="footer-hint">{problem}</span> : null}
            <button className="secondary" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button className="primary" disabled={Boolean(problem) || saving} onClick={create}>
              {saving ? `${t("common.saving")}…` : t("menu.createMenuButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
