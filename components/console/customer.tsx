"use client";

/**
 * Customer capture and detail — SRS §18.2, §18.3.
 *
 * Shared between the console and the till, which is the point: FR-CRM-003
 * says creation from the POS takes a phone number and a name and completes
 * in under fifteen seconds, and the only reliable way to keep that true is
 * for both surfaces to use the same component rather than two forms that
 * drift apart.
 */

import { useMemo, useState } from "react";
import {
  Ban,
  Coins,
  Download,
  MapPin,
  Plus,
  ShieldOff,
  Star,
  Trash2,
} from "lucide-react";

import type {
  ConsentFlag,
  Customer,
  CustomerAddress,
  CustomerSegment,
  Id,
  LoyaltyEntry,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { churnRiskOf } from "@/lib/console/services/crm";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission } from "@/lib/console/providers";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRelative,
} from "@/lib/console/format";
import type { Tone } from "@/lib/console/labels";
import { exportRows } from "@/lib/console/export";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Meter,
  Select,
  Tabs,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

export const SEGMENT_TONE: Record<CustomerSegment, Tone> = {
  champion: "good",
  loyal: "accent",
  at_risk: "warn",
  hibernating: "bad",
  new: "neutral",
  unclassified: "muted",
};

/**
 * E.164-ish normalisation.
 *
 * FR-CRM-002 stores the phone in E.164 because it is the primary identifier
 * and "0100 123 4567" and "+201001234567" have to be the same person. The
 * input stays permissive about how it is typed; only what is stored is
 * strict.
 */
export function normalisePhone(raw: string, countryCode = "+20"): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `${countryCode}${digits.slice(1)}`;
  return digits ? `${countryCode}${digits}` : "";
}

// ---------------------------------------------------------------------------
// Quick create — FR-CRM-003
// ---------------------------------------------------------------------------

/**
 * Two fields, and deliberately no more.
 *
 * Every extra required field at the counter reduces capture rate, and the
 * data you get instead of a refusal is invented. Everything else about a
 * customer can be filled in later by somebody who is not standing at a till
 * with a queue behind them.
 */
export function CustomerQuickCreate({
  open,
  onClose,
  onCreated,
  compact,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  /** Terminal variant: bigger touch targets, no chrome. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");

  const normalised = normalisePhone(phone);
  const valid = normalised.length >= 8 && name.trim().length > 0;

  async function submit() {
    if (!valid) return;
    await action.run(
      () => services.crm.customers.quickCreate({ phone: normalised, name: name.trim() }),
      {
        onSuccess: (customer) => {
          setPhone("");
          setName("");
          onCreated(customer as Customer);
        },
      },
    );
  }

  const body = (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field
        label={t("crm.phone")}
        hint={normalised && normalised !== phone ? `${t("crm.storedAs")} ${normalised}` : t("crm.phoneHint")}
        required
      >
        <Input
          data-autofocus
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={cx(compact && "py-3 text-lg")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) void submit();
          }}
        />
      </Field>

      <Field label={t("common.name")} required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={cx(compact && "py-3 text-lg")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) void submit();
          }}
        />
      </Field>

      <p className="text-fg-subtle text-xs leading-relaxed">{t("crm.quickCreateNote")}</p>
    </div>
  );

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("crm.newCustomer")}
      subtitle="FR-CRM-003"
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
      {body}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function CustomerDrawer({
  customer,
  canManage,
  canBlock,
  canErase,
  onClose,
  onBlock,
  onUnblock,
  onErase,
  onChanged,
}: {
  customer: Customer | null;
  canManage: boolean;
  canBlock: boolean;
  canErase: boolean;
  onClose: () => void;
  onBlock: (customer: Customer) => void;
  onUnblock: (customer: Customer) => Promise<void> | void;
  onErase: (customer: Customer) => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [tab, setTab] = useState<"profile" | "loyalty" | "addresses" | "consent">("profile");

  if (!customer) return null;

  const risk = churnRiskOf(customer);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(customer.name)}
      subtitle={
        <span dir="ltr" className="font-mono text-xs">
          {customer.phone}
        </span>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          {canBlock ? (
            customer.blocked ? (
              <Button icon={<ShieldOff size={13} />} onClick={() => void onUnblock(customer)}>
                {t("crm.unblock")}
              </Button>
            ) : (
              <Button icon={<Ban size={13} />} onClick={() => onBlock(customer)}>
                {t("crm.block")}
              </Button>
            )
          ) : null}
          {canErase && !customer.anonymisedAt ? (
            <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => onErase(customer)}>
              {t("crm.erase")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {customer.blocked ? (
          <Callout tone="bad" title={t("crm.blockedTitle")}>
            {customer.blockedReason ?? t("crm.blockedNoReason")}
          </Callout>
        ) : null}

        {customer.anonymisedAt ? (
          <Callout tone="muted" title={t("crm.anonymisedTitle")}>
            {t("crm.anonymisedBody").replace(
              "{date}",
              formatDate(customer.anonymisedAt, fmt),
            )}
          </Callout>
        ) : null}

        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "profile" as const, label: t("crm.tabProfile") },
            { value: "loyalty" as const, label: t("crm.tabLoyalty") },
            {
              value: "addresses" as const,
              label: t("crm.tabAddresses"),
              count: customer.addresses.length,
            },
            { value: "consent" as const, label: t("crm.tabConsent") },
          ]}
        />

        {tab === "profile" ? (
          <ProfileTab customer={customer} risk={risk} canManage={canManage} onChanged={onChanged} />
        ) : null}
        {tab === "loyalty" ? <LoyaltyTab customer={customer} onChanged={onChanged} /> : null}
        {tab === "addresses" ? (
          <AddressesTab customer={customer} canManage={canManage} onChanged={onChanged} />
        ) : null}
        {tab === "consent" ? (
          <ConsentTab customer={customer} canManage={canManage} onChanged={onChanged} />
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function ProfileTab({
  customer,
  risk,
  canManage,
  onChanged,
}: {
  customer: Customer;
  risk: number | null;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const canExport = usePermission("crm.customer.export");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: customer.name,
    email: customer.email ?? "",
    dateOfBirth: customer.dateOfBirth ?? "",
    preferredLanguage: customer.preferredLanguage,
    tags: customer.tags.join(", "),
  }));

  async function save() {
    await action.run(
      () =>
        services.crm.customers.update(customer.id, {
          name: draft.name,
          email: draft.email.trim() || null,
          dateOfBirth: draft.dateOfBirth || null,
          preferredLanguage: draft.preferredLanguage,
          tags: draft.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      {
        onSuccess: () => {
          setEditing(false);
          onChanged(t("crm.saved"));
        },
      },
    );
  }

  /** FR-CRM-009 — everything held about this person, as a file. */
  async function exportSubject() {
    const bundle = await services.crm.customers.exportOne(customer.id);
    exportRows("csv", {
      filename: `customer-${customer.id}`,
      title: tx(customer.name),
      columns: [
        { key: "field", header: t("crm.field"), value: (row) => row.field },
        { key: "value", header: t("crm.value"), value: (row) => row.value },
      ],
      rows: [
        { field: "phone", value: bundle.customer.phone },
        { field: "name_en", value: bundle.customer.name.en },
        { field: "name_ar", value: bundle.customer.name.ar },
        { field: "email", value: bundle.customer.email ?? "" },
        { field: "date_of_birth", value: bundle.customer.dateOfBirth ?? "" },
        { field: "tags", value: bundle.customer.tags.join("|") },
        { field: "total_spend", value: String(bundle.customer.totalSpend.amount / 100) },
        { field: "order_count", value: String(bundle.customer.orderCount) },
        { field: "loyalty_points", value: String(bundle.customer.loyaltyPoints) },
        ...bundle.customer.addresses.map((address, index) => ({
          field: `address_${index + 1}`,
          value: `${address.label}: ${address.line}, ${address.city}`,
        })),
        ...bundle.customer.consent.map((flag, index) => ({
          field: `consent_${index + 1}`,
          value: `${flag.channel}/${flag.purpose}=${flag.granted} @${flag.recordedAt} via ${flag.source}`,
        })),
        ...bundle.loyalty.map((entry) => ({
          field: `loyalty_${entry.occurredAt}`,
          value: `${entry.kind} ${entry.points} → ${entry.balanceAfter} (${entry.reason})`,
        })),
      ],
    });
    onChanged(t("crm.subjectExported"));
  }

  if (editing) {
    return (
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <LocalisedField
          label={t("common.name")}
          required
          value={draft.name ?? EMPTY_LOCALISED}
          onChange={(name) => setDraft((current) => ({ ...current, name }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("crm.email")}>
            <Input
              dir="ltr"
              inputMode="email"
              value={draft.email}
              onChange={(event) => setDraft((c) => ({ ...c, email: event.target.value }))}
            />
          </Field>
          <Field label={t("crm.dateOfBirth")} hint={t("crm.dateOfBirthHint")}>
            <Input
              type="date"
              dir="ltr"
              value={draft.dateOfBirth}
              onChange={(event) => setDraft((c) => ({ ...c, dateOfBirth: event.target.value }))}
            />
          </Field>
        </div>

        <Field label={t("crm.preferredLanguage")}>
          <Select
            value={draft.preferredLanguage}
            onChange={(event) =>
              setDraft((c) => ({
                ...c,
                preferredLanguage: event.target.value as Customer["preferredLanguage"],
              }))
            }
          >
            <option value="ar">{t("loc.arabic")}</option>
            <option value="en">{t("loc.english")}</option>
          </Select>
        </Field>

        <Field label={t("crm.tags")} hint={t("crm.tagsHint")}>
          <Input
            value={draft.tags}
            onChange={(event) => setDraft((c) => ({ ...c, tags: event.target.value }))}
          />
        </Field>

        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} onClick={save}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DescList>
        <DescRow label={t("crm.segment")}>
          <Badge tone={SEGMENT_TONE[customer.segment]}>
            {t(`crm.segment.${customer.segment}` as never)}
          </Badge>
        </DescRow>
        <DescRow label={t("crm.email")}>{customer.email ?? "—"}</DescRow>
        <DescRow label={t("crm.dateOfBirth")}>
          {customer.dateOfBirth ? formatDate(customer.dateOfBirth, fmt) : "—"}
        </DescRow>
        <DescRow label={t("crm.preferredLanguage")}>
          {customer.preferredLanguage === "ar" ? t("loc.arabic") : t("loc.english")}
        </DescRow>
        <DescRow label={t("crm.tags")}>
          {customer.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {customer.tags.map((tag) => (
                <Badge key={tag} tone="muted">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : (
            "—"
          )}
        </DescRow>
      </DescList>

      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("crm.behaviour")}</h3>
        <DescList>
          <DescRow label={t("crm.orders")} mono>
            {formatNumber(customer.orderCount, fmt)}
          </DescRow>
          <DescRow label={t("crm.totalSpend")} mono>
            {formatMoney(customer.totalSpend, fmt)}
          </DescRow>
          <DescRow label={t("crm.aov")} mono>
            {formatMoney(customer.averageOrderValue, fmt)}
          </DescRow>
          <DescRow label={t("crm.firstOrder")}>
            {customer.firstOrderAt ? formatDate(customer.firstOrderAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("crm.lastOrder")}>
            {customer.lastOrderAt ? formatRelative(customer.lastOrderAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("crm.favourite")}>
            {customer.favouriteItem ? tx(customer.favouriteItem) : "—"}
          </DescRow>
        </DescList>

        {risk !== null ? (
          <div className="mt-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-fg-muted text-xs">{t("crm.churnRisk")}</span>
              <span className="text-fg font-mono text-xs tabular-nums">
                {Math.round(risk * 100)}%
              </span>
            </div>
            <Meter value={risk * 100} tone={risk > 0.6 ? "bad" : risk > 0.35 ? "warn" : "good"} />
            <p className="text-fg-subtle mt-1.5 text-xs leading-relaxed">
              {t("crm.churnRiskHint")}
            </p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {canManage && !customer.anonymisedAt ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        ) : null}
        {canExport ? (
          <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={exportSubject}>
            {t("crm.exportSubject")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LoyaltyTab({
  customer,
  onChanged,
}: {
  customer: Customer;
  onChanged: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const canAdjust = usePermission("crm.loyalty.adjust");

  const ledger = useAsync<LoyaltyEntry[]>(
    () => services.crm.loyalty.ledger(customer.id),
    [customer.id],
  );
  const programme = useAsync(() => services.crm.loyalty.programme(), []);

  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");

  const tier = useMemo(() => {
    const tiers = programme.data?.tiers ?? [];
    return tiers.find((entry) => entry.id === customer.loyaltyTier) ?? null;
  }, [programme.data, customer.loyaltyTier]);

  const nextTier = useMemo(() => {
    const tiers = [...(programme.data?.tiers ?? [])].sort(
      (a, b) => a.thresholdPoints - b.thresholdPoints,
    );
    return tiers.find((entry) => entry.thresholdPoints > customer.loyaltyPoints) ?? null;
  }, [programme.data, customer.loyaltyPoints]);

  async function adjust(kind: "adjust" | "redeem") {
    const numeric = Number(points);
    if (!Number.isFinite(numeric) || numeric === 0 || !reason.trim()) return;
    await action.run(
      () =>
        services.crm.loyalty.post({
          customerId: customer.id,
          kind,
          points: Math.abs(numeric),
          reason: reason.trim(),
        }),
      {
        onSuccess: () => {
          setPoints("");
          setReason("");
          ledger.reload();
          onChanged(t("crm.pointsPosted"));
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <DescList>
        <DescRow label={t("crm.points")} mono>
          <span className="text-fg text-lg font-semibold">
            {formatNumber(customer.loyaltyPoints, fmt)}
          </span>
        </DescRow>
        <DescRow label={t("crm.tier")}>
          {tier ? (
            <Badge tone="accent">
              <span style={{ color: tier.colour }}>●</span> {t("crm.tierName")}
            </Badge>
          ) : (
            "—"
          )}
        </DescRow>
      </DescList>

      {nextTier ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="text-fg-muted">{t("crm.toNextTier")}</span>
            <span className="text-fg font-mono tabular-nums">
              {formatNumber(nextTier.thresholdPoints - customer.loyaltyPoints, fmt)}
            </span>
          </div>
          <Meter
            value={(customer.loyaltyPoints / Math.max(1, nextTier.thresholdPoints)) * 100}
            tone="accent"
          />
        </div>
      ) : null}

      {canAdjust ? (
        <section className="border-line rounded-lg border p-3">
          <h3 className="text-fg mb-2 text-xs font-semibold">{t("crm.adjustPoints")}</h3>
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("crm.points")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={points}
                onChange={(event) => setPoints(event.target.value)}
                className="text-end font-mono tabular-nums"
              />
            </Field>
            <Field label={t("shift.reason")} required>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              loading={action.pending}
              disabled={!points || !reason.trim()}
              onClick={() => void adjust("adjust")}
            >
              {t("crm.addPoints")}
            </Button>
            <Button
              size="sm"
              loading={action.pending}
              disabled={!points || !reason.trim()}
              onClick={() => void adjust("redeem")}
            >
              {t("crm.removePoints")}
            </Button>
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("crm.ledger")}</h3>
        <p className="text-fg-subtle mb-2 text-xs leading-relaxed">{t("crm.ledgerNote")}</p>
        <AsyncPanel
          state={ledger}
          isEmpty={(rows) => rows.length === 0}
          empty={<Callout tone="muted">{t("crm.ledgerEmpty")}</Callout>}
        >
          {(rows) => (
            <ul className="border-line divide-line divide-y rounded-lg border">
              {rows.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span
                    className={cx(
                      "w-12 shrink-0 text-end font-mono tabular-nums",
                      entry.points > 0 ? "text-good" : "text-bad",
                    )}
                  >
                    {entry.points > 0 ? "+" : ""}
                    {formatNumber(entry.points, fmt)}
                  </span>
                  <span className="text-fg min-w-0 flex-1 truncate">{entry.reason}</span>
                  {entry.offlineCapture ? <Badge tone="warn">{t("crm.offline")}</Badge> : null}
                  <span className="text-fg-subtle shrink-0 tabular-nums">
                    {formatDateTime(entry.occurredAt, fmt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsyncPanel>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddressesTab({
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
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", line: "", city: "", notes: "" });

  async function save(next: CustomerAddress[]) {
    await action.run(() => services.crm.customers.update(customer.id, { addresses: next }), {
      onSuccess: () => onChanged(t("crm.saved")),
    });
  }

  async function add() {
    if (!draft.line.trim()) return;
    const entry: CustomerAddress = {
      id: `adr_${Date.now().toString(36)}`,
      label: draft.label.trim() || t("crm.addressDefaultLabel"),
      line: draft.line.trim(),
      city: draft.city.trim(),
      notes: draft.notes.trim() || null,
      isDefault: customer.addresses.length === 0,
    };
    await save([...customer.addresses, entry]);
    setDraft({ label: "", line: "", city: "", notes: "" });
    setAdding(false);
  }

  async function remove(id: Id) {
    const ok = await confirm({
      title: t("crm.removeAddress"),
      body: t("crm.removeAddressBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await save(customer.addresses.filter((entry) => entry.id !== id));
  }

  return (
    <div className="space-y-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {customer.addresses.length === 0 ? (
        <Callout tone="muted">{t("crm.noAddresses")}</Callout>
      ) : (
        <ul className="space-y-2">
          {customer.addresses.map((address) => (
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
                  {address.notes ? (
                    <p className="text-fg-subtle mt-1 text-xs italic">{address.notes}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-1">
                    {!address.isDefault ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void save(
                            customer.addresses.map((entry) => ({
                              ...entry,
                              isDefault: entry.id === address.id,
                            })),
                          )
                        }
                      >
                        {t("crm.makeDefault")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.delete")}
                      icon={<Trash2 size={13} />}
                      onClick={() => void remove(address.id)}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        adding ? (
          <div className="border-line space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("crm.addressLabel")} hint={t("crm.addressLabelHint")}>
                <Input
                  data-autofocus
                  value={draft.label}
                  onChange={(event) => setDraft((c) => ({ ...c, label: event.target.value }))}
                />
              </Field>
              <Field label={t("onb.city")}>
                <Input
                  value={draft.city}
                  onChange={(event) => setDraft((c) => ({ ...c, city: event.target.value }))}
                />
              </Field>
            </div>
            <Field label={t("onb.address")} required>
              <Input
                value={draft.line}
                onChange={(event) => setDraft((c) => ({ ...c, line: event.target.value }))}
              />
            </Field>
            <Field label={t("crm.deliveryNotes")} hint={t("crm.deliveryNotesHint")}>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(event) => setDraft((c) => ({ ...c, notes: event.target.value }))}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={action.pending}
                disabled={!draft.line.trim()}
                onClick={add}
              >
                {t("common.add")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            {t("crm.addAddress")}
          </Button>
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const CHANNELS: ConsentFlag["channel"][] = ["sms", "email", "whatsapp", "push"];
const PURPOSES: ConsentFlag["purpose"][] = ["marketing", "transactional", "loyalty"];

/**
 * FR-CRM-008 — consent per channel and per purpose, with provenance.
 *
 * The grid shape is the point. A single "marketing" switch cannot answer
 * "may we WhatsApp this person about a promotion", which is the question
 * that actually gets asked, and it loses the timestamp and source that make
 * the answer defensible.
 */
function ConsentTab({
  customer,
  canManage,
  onChanged,
}: {
  customer: Customer;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();

  function flagFor(
    channel: ConsentFlag["channel"],
    purpose: ConsentFlag["purpose"],
  ): ConsentFlag | undefined {
    return customer.consent.find(
      (entry) => entry.channel === channel && entry.purpose === purpose,
    );
  }

  async function toggle(
    channel: ConsentFlag["channel"],
    purpose: ConsentFlag["purpose"],
    granted: boolean,
  ) {
    const rest = customer.consent.filter(
      (entry) => !(entry.channel === channel && entry.purpose === purpose),
    );
    const next: ConsentFlag[] = [
      ...rest,
      {
        channel,
        purpose,
        granted,
        recordedAt: new Date().toISOString(),
        source: "console",
      },
    ];
    await action.run(() => services.crm.customers.update(customer.id, { consent: next }), {
      onSuccess: () => onChanged(t("crm.consentSaved")),
    });
  }

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("crm.consentNote")}</Callout>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("crm.tabConsent")}</caption>
          <thead>
            <tr className="border-line border-b">
              <th scope="col" className="text-fg-muted px-2 py-2 text-start text-xs font-medium">
                {t("crm.channel")}
              </th>
              {PURPOSES.map((purpose) => (
                <th
                  key={purpose}
                  scope="col"
                  className="text-fg-muted px-2 py-2 text-center text-xs font-medium"
                >
                  {t(`crm.purpose.${purpose}` as never)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {CHANNELS.map((channel) => (
              <tr key={channel}>
                <th scope="row" className="text-fg px-2 py-2 text-start text-sm font-normal">
                  {t(`crm.channel.${channel}` as never)}
                </th>
                {PURPOSES.map((purpose) => {
                  const flag = flagFor(channel, purpose);
                  return (
                    <td key={purpose} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={flag?.granted ?? false}
                        disabled={!canManage || Boolean(customer.anonymisedAt)}
                        aria-label={`${t(`crm.channel.${channel}` as never)} — ${t(`crm.purpose.${purpose}` as never)}`}
                        onClick={() => void toggle(channel, purpose, !(flag?.granted ?? false))}
                        title={
                          flag
                            ? `${formatDateTime(flag.recordedAt, fmt)} · ${flag.source}`
                            : t("crm.noConsentRecorded")
                        }
                        className={cx(
                          "mx-auto flex h-7 w-12 items-center justify-center rounded-full border text-[0.65rem] font-medium transition-colors disabled:opacity-50",
                          flag?.granted
                            ? "border-good bg-good/15 text-good"
                            : "border-line bg-sunken text-fg-subtle",
                        )}
                      >
                        {flag?.granted ? t("common.yes") : t("common.no")}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-fg-subtle text-xs leading-relaxed">{t("crm.consentProvenance")}</p>
    </div>
  );
}
