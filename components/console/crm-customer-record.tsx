"use client";

/**
 * The complete customer record, delivery addresses and the balance link —
 * FR-CRM-001, FR-CRM-006, FR-CRM-022.
 *
 * Quick create (FR-CRM-003) stays the default at the counter. This is the
 * other door: the back-office or phone-order form that captures the whole
 * record the SRS lists — name, phone as the primary identifier, email,
 * addresses, date of birth, preferred language, tags and consent — in one go.
 */

import { useMemo, useState } from "react";
import { Copy, ExternalLink, MapPin, Pencil, Plus, QrCode, Trash2 } from "lucide-react";

import type { ConsentFlag, Customer, CustomerAddress, Id, Localised } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { encodeQr, qrSvgPath } from "@/lib/console/qr";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField, hasLocalisedText, trimLocalised } from "@/components/console/fields";
import { normalisePhone } from "@/components/console/customer";
import { Badge, Button, Callout, Drawer, Field, Input, Select, Textarea, cx } from "@/components/console/ui";

const CHANNELS: ConsentFlag["channel"][] = ["sms", "email", "whatsapp", "push"];
const PURPOSES: ConsentFlag["purpose"][] = ["marketing", "transactional", "loyalty"];
const LABEL_PRESETS = ["home", "work", "other"] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// FR-CRM-006 — labelled delivery addresses with notes
// ---------------------------------------------------------------------------

interface AddressDraft {
  label: string;
  line: string;
  city: string;
  notes: string;
  isDefault: boolean;
}

const EMPTY_ADDRESS: AddressDraft = { label: "", line: "", city: "", notes: "", isDefault: false };

function AddressForm({
  draft,
  onChange,
  onSave,
  onCancel,
  pending,
  saveLabel,
}: {
  draft: AddressDraft;
  onChange: (next: AddressDraft) => void;
  onSave: () => void;
  onCancel?: () => void;
  pending?: boolean;
  saveLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="border-line space-y-3 rounded-lg border p-3">
      <Field label={t("crm.addressLabel")} hint={t("crm.addressLabelHint")}>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {LABEL_PRESETS.map((preset) => {
              const label = t(`crm.addr.preset.${preset}` as never);
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={draft.label === label}
                  onClick={() => onChange({ ...draft, label })}
                  className={cx(
                    "rounded-lg border px-2.5 py-1 text-xs",
                    draft.label === label ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-fg-muted",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Input value={draft.label} maxLength={40} onChange={(event) => onChange({ ...draft, label: event.target.value })} />
        </div>
      </Field>
      <Field label={t("onb.address")} required>
        <Input value={draft.line} onChange={(event) => onChange({ ...draft, line: event.target.value })} />
      </Field>
      <Field label={t("onb.city")}>
        <Input value={draft.city} onChange={(event) => onChange({ ...draft, city: event.target.value })} />
      </Field>
      <Field label={t("crm.deliveryNotes")} hint={t("crm.deliveryNotesHint")}>
        <Textarea rows={2} maxLength={300} value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} />
      </Field>
      <label className="text-fg flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-accent h-4 w-4"
          checked={draft.isDefault}
          onChange={(event) => onChange({ ...draft, isDefault: event.target.checked })}
        />
        {t("crm.addr.useAsDefault")}
      </label>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={pending} disabled={!draft.line.trim()} onClick={onSave}>
          {saveLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function toAddress(draft: AddressDraft, id: Id, fallbackLabel: string): CustomerAddress {
  return {
    id,
    label: draft.label.trim() || fallbackLabel,
    line: draft.line.trim(),
    city: draft.city.trim(),
    notes: draft.notes.trim() || null,
    isDefault: draft.isDefault,
  };
}

/** Exactly one default whenever there is at least one address. */
function withSingleDefault(addresses: CustomerAddress[], preferId: Id | null): CustomerAddress[] {
  if (addresses.length === 0) return addresses;
  const chosen = preferId ?? addresses.find((row) => row.isDefault)?.id ?? addresses[0]!.id;
  return addresses.map((row) => ({ ...row, isDefault: row.id === chosen }));
}

/** FR-CRM-006 — list, add, edit, remove and choose the default. */
export function CustomerAddressBook({
  customer,
  canManage,
  onChanged,
}: {
  customer: Customer;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const confirm = useConfirm();
  const [addresses, setAddresses] = useState(customer.addresses);
  const [editing, setEditing] = useState<Id | "new" | null>(null);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);

  async function save(next: CustomerAddress[]) {
    await action.run(() => services.crm.customers.update(customer.id, { addresses: next }), {
      onSuccess: () => {
        setAddresses(next);
        setEditing(null);
        onChanged(t("crm.saved"));
      },
    });
  }

  async function commit() {
    if (!draft.line.trim()) return;
    if (editing === "new") {
      const id = `adr_${Date.now().toString(36)}`;
      const entry = toAddress(draft, id, t("crm.addressDefaultLabel"));
      await save(withSingleDefault([...addresses, entry], draft.isDefault || addresses.length === 0 ? id : null));
    } else if (editing) {
      const next = addresses.map((row) => (row.id === editing ? toAddress(draft, row.id, row.label) : row));
      await save(withSingleDefault(next, draft.isDefault ? editing : null));
    }
  }

  async function remove(address: CustomerAddress) {
    const ok = await confirm({
      title: t("crm.removeAddress"),
      body: t("crm.removeAddressBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await save(withSingleDefault(addresses.filter((row) => row.id !== address.id), null));
  }

  return (
    <div className="space-y-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {addresses.length === 0 && editing !== "new" ? <Callout tone="muted">{t("crm.noAddresses")}</Callout> : null}
      <ul className="space-y-2">
        {addresses.map((address) =>
          editing === address.id ? (
            <li key={address.id}>
              <AddressForm
                draft={draft}
                onChange={setDraft}
                onSave={() => void commit()}
                onCancel={() => setEditing(null)}
                pending={action.pending}
                saveLabel={t("common.save")}
              />
            </li>
          ) : (
            <li key={address.id} className="border-line rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-fg-subtle mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-fg flex items-center gap-2 text-sm font-medium">
                    {address.label}
                    {address.isDefault ? <Badge tone="accent">{t("crm.default")}</Badge> : null}
                  </p>
                  <p className="text-fg-muted mt-0.5 text-xs">
                    {address.line}
                    {address.city ? `, ${address.city}` : ""}
                  </p>
                  {address.notes ? <p className="text-fg-subtle mt-1 text-xs italic">{address.notes}</p> : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-1">
                    {!address.isDefault ? (
                      <Button size="sm" variant="ghost" loading={action.pending} onClick={() => void save(withSingleDefault(addresses, address.id))}>
                        {t("crm.makeDefault")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.edit")}
                      icon={<Pencil size={13} />}
                      onClick={() => {
                        setDraft({
                          label: address.label,
                          line: address.line,
                          city: address.city,
                          notes: address.notes ?? "",
                          isDefault: address.isDefault,
                        });
                        setEditing(address.id);
                      }}
                    />
                    <Button size="sm" variant="ghost" aria-label={t("common.delete")} icon={<Trash2 size={13} />} onClick={() => void remove(address)} />
                  </div>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ul>
      {canManage ? (
        editing === "new" ? (
          <AddressForm
            draft={draft}
            onChange={setDraft}
            onSave={() => void commit()}
            onCancel={() => setEditing(null)}
            pending={action.pending}
            saveLabel={t("common.add")}
          />
        ) : editing === null ? (
          <Button
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setDraft({ ...EMPTY_ADDRESS, isDefault: addresses.length === 0 });
              setEditing("new");
            }}
          >
            {t("crm.addAddress")}
          </Button>
        ) : null
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-CRM-001 — the complete record
// ---------------------------------------------------------------------------

export function CustomerRecordDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState<Localised>({ ...EMPTY_LOCALISED });
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [language, setLanguage] = useState<Customer["preferredLanguage"]>("ar");
  const [tags, setTags] = useState("");
  const [address, setAddress] = useState<AddressDraft>({ ...EMPTY_ADDRESS, isDefault: true });
  const [consent, setConsent] = useState<Record<string, boolean>>({ "sms:transactional": true });

  const normalised = normalisePhone(phone);
  const emailInvalid = email.trim() !== "" && !EMAIL.test(email.trim());
  const today = new Date().toISOString().slice(0, 10);
  const dobInvalid = dateOfBirth !== "" && dateOfBirth > today;
  const valid = normalised.length >= 8 && hasLocalisedText(name) && !emailInvalid && !dobInvalid;

  async function submit() {
    if (!valid) return;
    const now = new Date().toISOString();
    const flags: ConsentFlag[] = [];
    for (const channel of CHANNELS) {
      for (const purpose of PURPOSES) {
        const key = `${channel}:${purpose}`;
        if (key in consent) flags.push({ channel, purpose, granted: consent[key]!, recordedAt: now, source: "console" });
      }
    }
    await action.run(
      () =>
        services.crm.customers.create({
          phone: normalised,
          name: trimLocalised(name),
          email: email.trim() || null,
          dateOfBirth: dateOfBirth || null,
          preferredLanguage: language,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          addresses: address.line.trim() ? [toAddress({ ...address, isDefault: true }, `adr_${Date.now().toString(36)}`, t("crm.addressDefaultLabel"))] : [],
          consent: flags,
        }),
      { onSuccess: (customer) => onCreated(customer as Customer) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("crm.record.title")}
      subtitle="FR-CRM-001"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={submit}>
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field
          label={t("crm.phone")}
          required
          hint={normalised && normalised !== phone ? `${t("crm.storedAs")} ${normalised}` : t("crm.record.phonePrimary")}
        >
          <Input data-autofocus dir="ltr" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <LocalisedField label={t("common.name")} required value={name} onChange={setName} maxLength={120} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("crm.email")} error={emailInvalid ? t("crm.record.emailInvalid") : undefined}>
            <Input dir="ltr" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label={t("crm.dateOfBirth")} hint={t("crm.dateOfBirthHint")} error={dobInvalid ? t("crm.record.dobFuture") : undefined}>
            <Input type="date" dir="ltr" max={today} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
          </Field>
        </div>
        <Field label={t("crm.preferredLanguage")}>
          <Select value={language} onChange={(event) => setLanguage(event.target.value as Customer["preferredLanguage"])}>
            <option value="ar">{t("loc.arabic")}</option>
            <option value="en">{t("loc.english")}</option>
          </Select>
        </Field>
        <Field label={t("crm.tags")} hint={t("crm.tagsHint")}>
          <Input value={tags} onChange={(event) => setTags(event.target.value)} />
        </Field>

        <section className="space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("crm.tabAddresses")}</h3>
          <div className="space-y-3">
            <Field label={t("crm.addressLabel")} hint={t("crm.addressLabelHint")}>
              <Input value={address.label} onChange={(event) => setAddress({ ...address, label: event.target.value })} />
            </Field>
            <Field label={t("onb.address")}>
              <Input value={address.line} onChange={(event) => setAddress({ ...address, line: event.target.value })} />
            </Field>
            <Field label={t("onb.city")}>
              <Input value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} />
            </Field>
            <Field label={t("crm.deliveryNotes")} hint={t("crm.deliveryNotesHint")}>
              <Textarea rows={2} value={address.notes} onChange={(event) => setAddress({ ...address, notes: event.target.value })} />
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("crm.tabConsent")}</h3>
          <p className="text-fg-subtle text-xs">{t("crm.record.consentHint")}</p>
          <div className="border-line overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-sunken border-line border-b">
                  <th scope="col" className="px-2 py-1.5 text-start font-medium" />
                  {PURPOSES.map((purpose) => (
                    <th key={purpose} scope="col" className="text-fg-muted px-2 py-1.5 text-center font-medium">
                      {t(`crm.purpose.${purpose}` as never)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {CHANNELS.map((channel) => (
                  <tr key={channel}>
                    <th scope="row" className="text-fg px-2 py-1.5 text-start font-normal">
                      {t(`crm.channel.${channel}` as never)}
                    </th>
                    {PURPOSES.map((purpose) => {
                      const key = `${channel}:${purpose}`;
                      return (
                        <td key={purpose} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            className="accent-accent h-4 w-4"
                            aria-label={`${channel} ${purpose}`}
                            checked={consent[key] === true}
                            onChange={(event) => setConsent({ ...consent, [key]: event.target.checked })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-CRM-022 — the balance link a receipt QR carries
// ---------------------------------------------------------------------------

export function LoyaltyBalanceQr({ path, size = "h-36 w-36" }: { path: string; size?: string }) {
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const encoded = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(url), 3);
    } catch {
      return null;
    }
  }, [url]);
  if (!encoded) return null;
  return (
    <svg viewBox={`0 0 ${encoded.size} ${encoded.size}`} className={size} shapeRendering="crispEdges" role="img" aria-label={url}>
      <rect width={encoded.size} height={encoded.size} fill="#fff" />
      <path d={encoded.path} fill="#000" />
    </svg>
  );
}

export function LoyaltyBalanceLinkPanel({ customerId }: { customerId: Id }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = useAsync(() => (shown ? services.crm.loyalty.balanceLink(customerId) : Promise.resolve(null)), [customerId, shown]);
  const url = link.data && typeof window !== "undefined" ? `${window.location.origin}${link.data.path}` : "";

  return (
    <section className="border-line space-y-2 rounded-lg border p-3">
      <h3 className="text-fg flex items-center gap-2 text-sm font-semibold">
        <QrCode size={14} aria-hidden /> {t("crm.balanceLink.title")}
      </h3>
      <p className="text-fg-subtle text-xs">{t("crm.balanceLink.hint")}</p>
      {!shown ? (
        <Button size="sm" onClick={() => setShown(true)}>
          {t("crm.balanceLink.show")}
        </Button>
      ) : link.data ? (
        <div className="space-y-2">
          <LoyaltyBalanceQr path={link.data.path} />
          <p className="text-fg-muted font-mono text-[0.65rem] break-all" dir="ltr">
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Copy size={12} />}
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? t("crm.balanceLink.copied") : t("crm.balanceLink.copy")}
            </Button>
            <a href={link.data.path} target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1 text-xs">
              <ExternalLink size={12} aria-hidden /> {t("crm.balanceLink.open")}
            </a>
          </div>
          <Callout tone="warn">{t("crm.balanceLink.serverNote")}</Callout>
        </div>
      ) : null}
    </section>
  );
}
