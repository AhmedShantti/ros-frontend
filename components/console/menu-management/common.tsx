"use client";

/** Menu Management — shared building blocks (icons, badges, menus, footers). */

import { useState, type ReactNode } from "react";
import { STATUS } from "@/lib/console/menu-management/menu";
import type { MmStatus } from "@/lib/console/menu-management/types";

export type IconName =
  | "search" | "plus" | "chevron" | "dots" | "edit" | "close" | "check" | "arrow" | "copy" | "menu" | "tag"
  | "settings" | "sort" | "plate" | "folder" | "sliders" | "book" | "image" | "store" | "pin" | "eye"
  | "eyeOff" | "ban" | "trash" | "combo";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></>,
    plus: <><path d="M12 5v14"></path><path d="M5 12h14"></path></>,
    chevron: <><path d="m7 10 5 5 5-5"></path></>,
    dots: <><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></>,
    edit: <><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></>,
    close: <><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></>,
    check: <path d="m5 12 4 4L19 6"></path>,
    arrow: <><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></>,
    menu: <><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></>,
    tag: <><path d="M20 13 13 20l-9-9V4h7Z"></path><circle cx="8" cy="8" r="1"></circle></>,
    settings: <><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.4 1.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L9 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H7v-2h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L8.4 9 9.8 7.6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 9l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2H21a1.7 1.7 0 0 0-1.6 1Z"></path></>,
    sort: <><path d="M7 4v16"></path><path d="m3 8 4-4 4 4"></path><path d="M17 20V4"></path><path d="m13 16 4 4 4-4"></path></>,
    plate: <><circle cx="12" cy="13" r="6"></circle><circle cx="12" cy="13" r="3"></circle><path d="M3 4v6M5 4v6M3 7h2M4 10v10M21 4c-1.5 0-2 2-2 4s.8 3 2 3v9"></path></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path>,
    sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle></>,
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"></path><path d="M4 21V5M8 7h7M8 11h5"></path></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="m21 16-5-5-9 9"></path></>,
    store: <><path d="M4 10v10h16V10"></path><path d="M3 4h18l-1.5 6h-15Z"></path><path d="M10 20v-5h4v5"></path></>,
    pin: <><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></>,
    eyeOff: <><path d="M3 3l18 18"></path><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1"></path><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></>,
    ban: <><circle cx="12" cy="12" r="9"></circle><path d="m5.7 5.7 12.6 12.6"></path></>,
    trash: <><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M5 7l1 13h12l1-13"></path><path d="M9 7V4h6v3"></path></>,
    combo: <><rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="3" width="8" height="8" rx="2"></rect><rect x="3" y="13" width="8" height="8" rx="2"></rect><path d="M17 14v6"></path><path d="M14 17h6"></path></>
  };
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <div className="drawer-section"><h3>{title}</h3>{children}</div>;
}

export function StatusBadge({ status }: { status: MmStatus }) {
  return <span className={`availability ${status}`}>{STATUS[status]?.badge || status}</span>;
}

export interface RowMenuProps {
  status: MmStatus;
  onStatus: (status: MmStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

export function RowMenu({ status, onStatus, onDuplicate, onDelete, onEdit }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = () => { setOpen(false); setConfirm(false); };
  const act = (fn: () => void) => () => { fn(); close(); };
  return (
    <div className="dots-wrap">
      <button className="dots" aria-label="More actions" onClick={() => setOpen(o => !o)}><Icon name="dots" size={17}/></button>
      {open && <>
        <div className="menu-backdrop" onClick={close}></div>
        <div className="row-menu">
          <button onClick={act(onEdit)}><Icon name="edit" size={15}/> Edit</button>
          <div className="row-menu-label">Show on menu as</div>
          {status !== "available" && <button onClick={act(() => onStatus("available"))}><Icon name="check" size={15}/> Available</button>}
          {status !== "unavailable" && <button onClick={act(() => onStatus("unavailable"))}><Icon name="ban" size={15}/> Mark unavailable (sold out)</button>}
          {status !== "hidden" && <button onClick={act(() => onStatus("hidden"))}><Icon name="eyeOff" size={15}/> Hide from menu</button>}
          <div className="row-menu-sep"></div>
          <button onClick={act(onDuplicate)}><Icon name="copy" size={15}/> Duplicate</button>
          {confirm
            ? <button className="danger" onClick={act(onDelete)}><Icon name="trash" size={15}/> Click again to delete</button>
            : <button className="danger" onClick={() => setConfirm(true)}><Icon name="trash" size={15}/> Delete</button>}
        </div>
      </>}
    </div>
  );
}

export function StatusPicker({ value, onChange, noun = "item" }: { value: MmStatus; onChange: (status: MmStatus) => void; noun?: string }) {
  return <div className="radio-grid three">
    {(Object.entries(STATUS) as [MmStatus, (typeof STATUS)[MmStatus]][]).map(([key, s]) => (
      <button key={key} className={value === key ? "radio-card chosen" : "radio-card"} onClick={() => onChange(key)}>
        <b><Icon name={key === "available" ? "eye" : key === "unavailable" ? "ban" : "eyeOff"} size={14}/> {s.label}</b>
        <small>{key === "hidden" ? `This ${noun} is not shown to customers at all.` : s.help}</small>
      </button>
    ))}
  </div>;
}

export function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm
    ? <span className="delete-confirm">Sure? <button className="delete" onClick={onConfirm}>Yes, delete</button><button onClick={() => setConfirm(false)}>Keep</button></span>
    : <button className="delete" onClick={() => setConfirm(true)}>{label}</button>;
}

export function EmptyState({
  icon = "plate",
  title = "No items yet",
  text = "Add your first item to this category. You can add its price and customizations at the same time.",
  actionLabel = "Add item",
  onAction,
}: {
  icon?: IconName;
  title?: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return <div className="empty">
    <div className="empty-icon"><Icon name={icon} size={22}/></div>
    <h3>{title}</h3>
    <p>{text}</p>
    {onAction && <button className="primary" onClick={onAction}><Icon name="plus" size={16}/> {actionLabel}</button>}
  </div>;
}

/** Footer used by all editors: shows validation hint / server error and a busy Save button. */
export function EditorFooter({
  left,
  problem,
  error,
  saving,
  saveLabel,
  onCancel,
  onSave,
}: {
  left?: ReactNode;
  problem?: string;
  error?: string;
  saving: boolean;
  saveLabel: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <div className="drawer-footer">
    {left || <div></div>}
    <div className="footer-right">
      {error ? <span className="footer-hint error">{error}</span> : problem && <span className="footer-hint">{problem}</span>}
      <button className="secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      <button className="primary" disabled={Boolean(problem) || saving} onClick={onSave}>{saving ? "Saving…" : saveLabel}</button>
    </div>
  </div>;
}

/** Runs an async save, tracking busy + error state for an editor. */
export function useSaver() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setError("");
    try { await fn(); }
    catch (e) { setError((e instanceof Error && e.message) || "Something went wrong. Try again."); }
    finally { setSaving(false); }
  }
  return { saving, error, run, setError };
}
