"use client";

import { useState } from "react";
import type { MmBranch, MmBrand, MmCreateMenuInput, MmId } from "@/lib/console/menu-management/types";
import { EditorFooter, Icon, Section, useSaver } from "./common";

/** brands / branches come from the API; if the account has none, the scope fields are hidden. */
interface CreateMenuModalProps {
  brands: MmBrand[];
  branches: MmBranch[];
  defaultBrandId: MmId | null;
  defaultBranchId: MmId | null;
  onClose: () => void;
  onCreate: (data: MmCreateMenuInput) => Promise<void>;
}

export default function CreateMenuModal({ brands, branches, defaultBrandId, defaultBranchId, onClose, onCreate }: CreateMenuModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandId, setBrandId] = useState<MmId | null>(defaultBrandId ?? brands[0]?.id ?? null);
  const [branchIds, setBranchIds] = useState<MmId[]>(defaultBranchId != null ? [defaultBranchId] : []);
  const { saving, error, run } = useSaver();

  const brandBranches = branches.filter(b => brandId == null || b.brandId == null || b.brandId === brandId);
  const toggleBranch = (id: MmId) => setBranchIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  return <div className="overlay">
    <div className="modal create-menu-modal">
      <div className="drawer-head">
        <div><span className="small-label">MENU SETUP</span><h2>Create new menu</h2></div>
        <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
      </div>
      <div className="drawer-body">
        <div className="create-intro">
          <div className="create-icon"><Icon name="book" size={18}/></div>
          <div><strong>Create a menu for your restaurant</strong><p>Give the menu a name and decide where it should be available. You can add categories and items after creating it.</p></div>
        </div>

        <Section title="Basic information">
          <label>Menu name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lunch Menu"/></label>
          <label>Description<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description for your team"/></label>
        </Section>

        {(brands.length > 0 || branches.length > 0) && (
          <Section title="Where should this menu be used?">
            {brands.length > 0 && (
              <label>Brand<select value={brandId ?? ""} onChange={e => { const b = brands.find(x => String(x.id) === e.target.value); setBrandId(b?.id ?? null); setBranchIds([]); }}>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            )}
            {brandBranches.length > 0 && (
              <div className="branch-picker">
                <span>Branches <small>(none selected = all branches)</small></span>
                {brandBranches.map(b => (
                  <label key={b.id} className="checkline"><input type="checkbox" checked={branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)}/> {b.name}</label>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
      <EditorFooter
        problem={name.trim() ? "" : "Add a menu name."} error={error} saving={saving}
        saveLabel="Create menu" onCancel={onClose}
        onSave={() => run(() => onCreate({ name: name.trim(), description: description.trim(), brandId, branchIds }))}
      />
    </div>
  </div>;
}
