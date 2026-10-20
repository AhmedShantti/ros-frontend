"use client";

import { useEffect, useMemo, useState } from "react";
import type { Supplier, SupplierAddress, SupplierContact } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission } from "@/lib/console/providers";
import { Button, Callout, Drawer, Field, Input, Toggle } from "@/components/console/ui";

export function supplierExponent(currency: string): number {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}
export function supplierMajor(minor: string, currency: string): string {
  const scale = supplierExponent(currency); const n = BigInt(minor); const power = 10n ** BigInt(scale);
  return scale ? `${n / power}.${(n % power).toString().padStart(scale, "0")}` : n.toString();
}
export function supplierMinor(major: string, currency: string): string | null {
  const scale = supplierExponent(currency);
  if (!new RegExp(`^\\d{1,18}(?:\\.\\d{1,${Math.max(1, scale)}})?$`).test(major) || (scale === 0 && major.includes("."))) return null;
  const [whole, fraction = ""] = major.split(".");
  const result = (BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0")).toString();
  return result.length <= 18 ? result : null;
}
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function seed(s: Supplier | null) {
  const currency = s?.currencyCode ?? s?.currency ?? "EGP";
  return { code: s?.code ?? "", legal: s?.legalName.en || s?.legalName.ar || "", trading: s?.tradingNameValue !== undefined ? s.tradingNameValue ?? "" : s?.tradingName.en || s?.tradingName.ar || "",
    tax: s?.taxRegistration ?? "", terms: String(s?.paymentTermsDays ?? 30), lead: String(s?.leadTimeDays ?? 2), currency,
    minimum: supplierMajor(s?.minimumOrderValueMinor ?? String(s?.minimumOrderValue.amount ?? 0), currency),
    days: s?.deliveryDays ?? [], active: s?.active ?? true,
    addresses: structuredClone(s?.addresses ?? []) as SupplierAddress[],
    contacts: structuredClone(s?.contacts ?? (s?.contactName ? [{ name: s.contactName, phone: s.phone, email: s.email }] : [])) as SupplierContact[],
  };
}
export function SupplierDrawer({ supplier, open, onClose, onSaved }: {
  supplier: Supplier | null; open: boolean; onClose: () => void; onSaved: (message: string, saved?: Supplier) => void;
}) {
  const { t } = useI18n(); const allowed = usePermission("supplier.manage"); const action = useAction();
  const [draft, setDraft] = useState(() => seed(supplier));
  useEffect(() => { if (open) setDraft(seed(supplier)); }, [open, supplier?.id]);
  const patch = (part: Partial<typeof draft>) => setDraft(d => ({ ...d, ...part }));
  const valid = useMemo(() => {
    const integer = (s: string) => /^\d{1,10}$/.test(s) && Number(s) <= 2147483647;
    return Boolean(draft.code.trim() && draft.code.trim().length <= 32 && draft.legal.trim() && draft.legal.trim().length <= 255 &&
      draft.trading.trim().length <= 255 && draft.tax.trim().length <= 64 && /^[A-Z]{3}$/.test(draft.currency) &&
      integer(draft.terms) && integer(draft.lead) && supplierMinor(draft.minimum, draft.currency) !== null &&
      draft.addresses.every(a => a.line1.trim() && (!a.countryCode || /^[A-Z]{2}$/.test(a.countryCode))) && draft.contacts.every(c => c.name.trim()));
  }, [draft]);
  async function save() {
    if (!allowed || !valid || action.pending) return;
    const input: Partial<Supplier> = {
      code: draft.code.trim(), legalName: { en: draft.legal.trim(), ar: draft.legal.trim() },
      tradingName: { en: draft.trading.trim(), ar: draft.trading.trim() }, taxRegistration: draft.tax.trim(),
      currencyCode: draft.currency, paymentTermsDays: Number(draft.terms), leadTimeDays: Number(draft.lead),
      minimumOrderValueMinor: supplierMinor(draft.minimum, draft.currency)!, deliveryDays: draft.days,
      addresses: draft.addresses.map(a => Object.fromEntries(Object.entries(a).filter(([,v]) => typeof v !== "string" || v.trim()).map(([k,v]) => [k, typeof v === "string" ? v.trim() : v])) as unknown as SupplierAddress),
      contacts: draft.contacts.map(c => Object.fromEntries(Object.entries(c).filter(([,v]) => typeof v !== "string" || v.trim()).map(([k,v]) => [k, typeof v === "string" ? v.trim() : v])) as unknown as SupplierContact),
      ...(supplier ? { active: draft.active } : {}),
    };
    await action.run(() => supplier ? services.purchasing.suppliers.update(supplier.id, input) : services.purchasing.suppliers.create(input),
      { onSuccess: saved => onSaved(t(supplier ? "pur.supplierSaved" : "pur.supplierCreated"), saved) });
  }
  if (!open) return null;
  if (!allowed) return <Callout tone="bad">{t("pur.supplierDenied")}</Callout>;
  const text = (key: "code" | "legal" | "trading" | "tax" | "terms" | "lead" | "currency" | "minimum", label: string, maxLength = 255, required = false) =>
    <Field label={label} required={required}><Input aria-label={label} value={draft[key]} maxLength={maxLength}
      onChange={e => patch({ [key]: key === "currency" ? e.target.value.toUpperCase() : e.target.value })} /></Field>;
  return <Drawer open onClose={onClose} title={t(supplier ? "pur.editSupplier" : "pur.newSupplier")} subtitle="FR-PRC-005"
    footer={<div className="flex gap-2"><Button variant="primary" loading={action.pending} disabled={!valid || action.pending} onClick={save}>{t(supplier ? "common.save" : "common.create")}</Button><Button onClick={onClose}>{t("common.cancel")}</Button></div>}>
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {text("code", t("common.code"), 32, true)}{text("legal", t("pur.legalName"), 255, true)}{text("trading", t("pur.tradingName"))}{text("tax", t("pur.taxRegistration"), 64)}
      {text("currency", t("common.currency"), 3, true)}{text("terms", t("pur.paymentTerms"), 10, true)}{text("lead", t("pur.leadTime"), 10, true)}{text("minimum", `${t("pur.minimumOrder")} (${draft.currency})`, 24, true)}
      <Field label={t("pur.deliveryDays")}><div className="flex flex-wrap gap-2">{DAYS.map(day => <Button key={day} aria-pressed={draft.days.includes(day)} onClick={() => patch({ days: draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day] })}>{t(`pur.day.${day}` as never)}</Button>)}</div></Field>
      <section><h3>{t("pur.addresses")}</h3>{draft.addresses.map((a,i) => <div className="my-3 space-y-2" key={i}>
        {([['line1',255],['line2',255],['city',120],['state',120],['postalCode',20],['countryCode',2]] as const).map(([key,max]) => <Field key={key} label={`${t(`pur.address.${key}` as never)} ${i+1}`} required={key==='line1'}><Input aria-label={`${t(`pur.address.${key}` as never)} ${i+1}`} maxLength={max} value={a[key] ?? ''} onChange={e => patch({addresses:draft.addresses.map((x,n)=>n===i?{...x,[key]:key==='countryCode'?e.target.value.toUpperCase():e.target.value}:x)})}/></Field>)}
        <Toggle label={t("pur.primary")} checked={a.isPrimary ?? false} onChange={on=>patch({addresses:draft.addresses.map((x,n)=>({...x,isPrimary:n===i?on:false}))})}/><Button onClick={()=>patch({addresses:draft.addresses.filter((_,n)=>n!==i)})}>{t("common.remove")}</Button>
      </div>)}<Button disabled={draft.addresses.length>=20} onClick={()=>patch({addresses:[...draft.addresses,{line1:''}]})}>{t("pur.addAddress")}</Button></section>
      <section><h3>{t("pur.contacts")}</h3>{draft.contacts.map((c,i) => <div className="my-3 space-y-2" key={i}>
        {([['name',120],['role',64],['phone',32],['email',160]] as const).map(([key,max])=><Field key={key} label={`${t(`pur.contact.${key}` as never)} ${i+1}`} required={key==='name'}><Input aria-label={`${t(`pur.contact.${key}` as never)} ${i+1}`} maxLength={max} value={c[key] ?? ''} onChange={e=>patch({contacts:draft.contacts.map((x,n)=>n===i?{...x,[key]:e.target.value}:x)})}/></Field>)}
        <Toggle label={t("pur.primary")} checked={c.isPrimary ?? false} onChange={on=>patch({contacts:draft.contacts.map((x,n)=>({...x,isPrimary:n===i?on:false}))})}/><Button onClick={()=>patch({contacts:draft.contacts.filter((_,n)=>n!==i)})}>{t("common.remove")}</Button>
      </div>)}<Button disabled={draft.contacts.length>=20} onClick={()=>patch({contacts:[...draft.contacts,{name:''}]})}>{t("pur.addContact")}</Button></section>
      {supplier ? <Toggle checked={draft.active} onChange={active=>patch({active})} label={t("pur.activeSupplier")} hint={t("pur.activeSupplierHint")}/> : null}
      {!valid ? <Callout tone="warn">{t("pur.supplierInvalid")}</Callout> : null}
    </div>
  </Drawer>;
}
