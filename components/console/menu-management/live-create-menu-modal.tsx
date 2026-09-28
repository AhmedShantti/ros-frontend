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
import type { Branch, Brand, Localised, Menu } from "@/lib/console/types";
import type { ConsoleKey } from "@/content/console/en";
import { services } from "@/lib/console/services";
import { Icon, Section, useSaver } from "./common";

const ORDER_TYPE_CHOICES = ["dine_in", "takeaway", "delivery", "drive_thru", "pickup"] as const;

interface LiveCreateMenuModalProps {
  availableBrands: Brand[];
  availableBranches: Branch[];
  defaultBranchId?: string | null;
  tx: (value: Localised) => string;
  t: (key: ConsoleKey) => string;
  onClose: () => void;
  onCreated: (menu: Menu) => void;
}

export default function LiveCreateMenuModal({ availableBrands, availableBranches, defaultBranchId, tx, t, onClose, onCreated }: LiveCreateMenuModalProps) {
  const { saving, error, run } = useSaver();
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("10");
  const [orderTypes, setOrderTypes] = useState<string[]>(["dine_in"]);
  const defaultBranch = availableBranches.find((b) => b.id === defaultBranchId);
  const [brandId, setBrandId] = useState<string | null>(defaultBranch?.brandId ?? availableBrands[0]?.id ?? null);
  const [branchIds, setBranchIds] = useState<string[]>(defaultBranchId ? [defaultBranchId] : []);

  // Brand is a pure UI-narrowing filter over the real branch list — Menu
  // itself carries no brandId (only branchIds are ever sent on create).
  const brandBranches = availableBranches.filter((b) => brandId == null || b.brandId === brandId);

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
      <div className="modal create-menu-modal">
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
          <div className="create-intro">
            <div className="create-icon">
              <Icon name="book" size={18} />
            </div>
            <div>
              <strong>{t("menu.createIntroTitle")}</strong>
              <p>{t("menu.createIntroText")}</p>
            </div>
          </div>

          <Section title={t("menu.basicInfo")}>
            <label>
              {t("menu.menuName")}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Menu" />
            </label>
            <label>
              {t("menu.priority")}
              <input inputMode="numeric" dir="ltr" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </label>
          </Section>

          <Section title={t("menu.orderTypes")}>
            <div className="radio-grid three">
              {ORDER_TYPE_CHOICES.map((type) => (
                <button key={type} className={orderTypes.includes(type) ? "radio-card chosen" : "radio-card"} onClick={() => toggleOrderType(type)}>
                  <b>{type.replace("_", " ")}</b>
                </button>
              ))}
            </div>
          </Section>

          {availableBrands.length > 0 || availableBranches.length > 0 ? (
            <Section title={t("menu.assignToBranches")}>
              {availableBrands.length > 0 ? (
                <label>
                  {t("common.brand")}
                  <select
                    value={brandId ?? ""}
                    onChange={(e) => {
                      const brand = availableBrands.find((b) => b.id === e.target.value);
                      setBrandId(brand?.id ?? null);
                      setBranchIds([]);
                    }}
                  >
                    {availableBrands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {tx(brand.name)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {brandBranches.length > 0 ? (
                <div className="branch-picker">
                  <span>
                    {t("menu.branchesLabel")} <small>{t("menu.branchesNoneSelectedHint")}</small>
                  </span>
                  {brandBranches.map((branch) => (
                    <label key={branch.id} className="checkline">
                      <input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} /> {tx(branch.name)}
                    </label>
                  ))}
                </div>
              ) : null}
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
