"use client";

/**
 * Four small write surfaces that had no form behind them.
 *
 * Grouped rather than given a file each because none is large enough to
 * carry its own module, and they share the same shape: a drawer, a handful
 * of validated fields, and one decision worth explaining.
 *
 *   - **Expense** (FR-FIN-015 … FR-FIN-018). The petty-cash branch matters:
 *     an expense paid out of the drawer has to create the matching pay-out
 *     or the drawer stops reconciling, and the form says so before you post.
 *   - **Combo** (FR-POS-030 … FR-POS-032). Slots, not a bundle of items —
 *     and the allocation basis is asked for, because without it a combo
 *     shows as one line and the sales report cannot answer "how many burgers
 *     did we sell" when half of them were inside meals.
 *   - **User** (FR-SEC-020, FR-SEC-024). MFA is not a preference for a role
 *     holding user management, tenant settings or API keys; the form
 *     enforces that rather than suggesting it.
 *   - **Integration** (FR-INT-004, FR-INT-005). Credentials are write-only
 *     from the UI's point of view: they go in, they never come back out.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import type {
  Combo,
  ComboPricingStrategy,
  ComboSlot,
  Expense,
  Id,
  Integration,
  MenuItem,
  User,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { MFA_REQUIRED_PERMISSIONS, ROLE_LIST, permissionsForRole, type RoleKey } from "@/lib/console/permissions";
import { EMPTY_LOCALISED, LocalisedField, MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

const CURRENCY = "EGP";

// ---------------------------------------------------------------------------
// Expense — FR-FIN-015 … FR-FIN-018
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  { key: "rent", en: "Rent", ar: "إيجار" },
  { key: "utilities", en: "Utilities", ar: "مرافق" },
  { key: "maintenance", en: "Maintenance", ar: "صيانة" },
  { key: "cleaning", en: "Cleaning", ar: "نظافة" },
  { key: "marketing", en: "Marketing", ar: "تسويق" },
  { key: "licences", en: "Licences and fees", ar: "تراخيص ورسوم" },
  { key: "transport", en: "Transport", ar: "نقل" },
  { key: "other", en: "Other", ar: "أخرى" },
];

/** FR-FIN-017 — above this an expense waits for a decision. */
const EXPENSE_APPROVAL_THRESHOLD = 100_000;

export function ExpenseDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const action = useAction();
  const branches = useBranches(scope);

  const [branchId, setBranchId] = useState<Id>("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]!.key);
  const [description, setDescription] = useState({ ...EMPTY_LOCALISED });
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Expense["paymentMethod"]>("petty_cash");
  const [supplier, setSupplier] = useState("");
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(scope.branchId ?? branches[0]?.id ?? "");
    setDescription({ ...EMPTY_LOCALISED });
    setAmount(null);
    setSupplier("");
    setRecurring(false);
    setAttachment(null);
  }, [open, scope.branchId, branches.length]);

  const needsApproval = (amount ?? 0) > EXPENSE_APPROVAL_THRESHOLD;
  const fromDrawer = method === "petty_cash";

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!branchId) list.push(t("exp.needBranch"));
    if (!amount || amount <= 0) list.push(t("exp.needAmount"));
    if (!description.en.trim() && !description.ar.trim()) list.push(t("exp.needDescription"));
    return list;
  }, [branchId, amount, description, t]);

  async function submit() {
    if (problems.length > 0) return;
    const branch = branches.find((entry) => entry.id === branchId);
    const chosen = EXPENSE_CATEGORIES.find((entry) => entry.key === category)!;

    await action.run(
      () =>
        services.finance.expenses.create({
          branchId,
          branchName: branch?.name,
          category: { en: chosen.en, ar: chosen.ar },
          description,
          amount: money(amount ?? 0, CURRENCY),
          paymentMethod: method,
          supplierName: supplier.trim() ? { en: supplier.trim(), ar: supplier.trim() } : null,
          incurredOn,
          status: needsApproval ? "pending_approval" : "posted",
          recurring,
          hasAttachment: Boolean(attachment),
        }),
      {
        onSuccess: () =>
          onSaved(needsApproval ? t("exp.submitted") : t("exp.posted")),
      },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("exp.newExpense")}
      subtitle="FR-FIN-015"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={submit}
          >
            {needsApproval ? t("exp.submitForApproval") : t("exp.post")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.branch")} required>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">—</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.category")} required>
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              {EXPENSE_CATEGORIES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {tx({ en: entry.en, ar: entry.ar })}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <LocalisedField
          label={t("common.description")}
          required
          value={description}
          onChange={setDescription}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("exp.amount")} required>
            <MoneyInput
              value={amount}
              currency={CURRENCY}
              onChange={setAmount}
              aria-label={t("exp.amount")}
            />
          </Field>
          <Field label={t("exp.paymentMethod")}>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as Expense["paymentMethod"])}
            >
              <option value="petty_cash">{t("exp.method.petty_cash")}</option>
              <option value="bank_transfer">{t("exp.method.bank_transfer")}</option>
              <option value="card">{t("exp.method.card")}</option>
              <option value="on_account">{t("exp.method.on_account")}</option>
            </Select>
          </Field>
          <Field label={t("exp.incurredOn")}>
            <Input
              type="date"
              dir="ltr"
              value={incurredOn}
              onChange={(event) => setIncurredOn(event.target.value)}
            />
          </Field>
        </div>

        {/*
          FR-FIN-016 — petty cash paid from the drawer has to become a pay-out
          against the session, or the drawer will not reconcile at close and
          the cashier gets blamed for a shortage they did not create.
        */}
        {fromDrawer ? (
          <Callout tone="accent" title={t("exp.pettyCashTitle")}>
            {t("exp.pettyCashBody")}
          </Callout>
        ) : null}

        <Field label={t("exp.supplier")} hint={t("exp.supplierHint")}>
          <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} />
        </Field>

        <Field label={t("exp.attachment")} hint={t("exp.attachmentHint")}>
          <Input
            type="file"
            accept="image/*,application/pdf"
            aria-label={t("exp.attachment")}
            onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? null)}
          />
        </Field>

        <Toggle
          checked={recurring}
          onChange={setRecurring}
          label={t("exp.recurring")}
          hint={t("exp.recurringHint")}
        />

        {needsApproval ? (
          <Callout tone="warn" title={t("exp.approvalTitle")}>
            {t("exp.approvalBody").replace(
              "{threshold}",
              formatMoney(money(EXPENSE_APPROVAL_THRESHOLD, CURRENCY), fmt),
            )}
          </Callout>
        ) : null}

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Combo builder — FR-POS-030 … FR-POS-032
// ---------------------------------------------------------------------------

interface SlotDraft {
  key: string;
  name: { en: string; ar: string };
  optionItemIds: Id[];
  priceDeltaMinor: number;
}

export function ComboDrawer({
  combo,
  open,
  onClose,
  onSaved,
}: {
  combo: Combo | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const confirm = useConfirm();

  const items = useAsync(
    () => services.catalogue.items.list({ limit: 300 }).then((page) => page.rows),
    [],
  );

  const [name, setName] = useState({ ...EMPTY_LOCALISED });
  const [strategy, setStrategy] = useState<ComboPricingStrategy>("fixed");
  const [priceMinor, setPriceMinor] = useState<number | null>(null);
  const [allocation, setAllocation] = useState<"equal" | "list_price" | "cost">("list_price");
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (combo) {
      setName(combo.name);
      setStrategy(combo.pricingStrategy);
      setPriceMinor(combo.price.amount);
      setActive(combo.active);
      setSlots(
        combo.slots.map((slot, index) => ({
          key: `slot_${index}`,
          name: slot.name,
          optionItemIds: slot.optionItemIds,
          priceDeltaMinor: slot.priceDelta.amount,
        })),
      );
    } else {
      setName({ ...EMPTY_LOCALISED });
      setStrategy("fixed");
      setPriceMinor(null);
      setSlots([]);
      setActive(true);
    }
  }, [open, combo?.id]);

  const menuItems = items.data ?? [];

  function addSlot() {
    setSlots((current) => [
      ...current,
      {
        key: `slot_${current.length}_${Date.now().toString(36)}`,
        name: { ...EMPTY_LOCALISED },
        optionItemIds: [],
        priceDeltaMinor: 0,
      },
    ]);
  }

  async function removeSlot(key: string) {
    const ok = await confirm({
      title: t("combo.removeSlot"),
      body: t("combo.removeSlotBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setSlots((current) => current.filter((slot) => slot.key !== key));
  }

  function patchSlot(key: string, part: Partial<SlotDraft>) {
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...part } : slot)));
  }

  /** Sum of the cheapest option in each slot — what the combo replaces. */
  const componentSum = useMemo(() => {
    return slots.reduce((sum, slot) => {
      const prices = slot.optionItemIds
        .map((id) => menuItems.find((item) => item.id === id)?.variants[0]?.basePrice.amount ?? 0)
        .filter((price) => price > 0);
      return sum + (prices.length > 0 ? Math.min(...prices) : 0);
    }, 0);
  }, [slots, menuItems]);

  const saving = componentSum - (priceMinor ?? 0);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!name.en.trim() && !name.ar.trim()) list.push(t("combo.needName"));
    if (slots.length === 0) list.push(t("combo.needSlots"));
    if (slots.some((slot) => slot.optionItemIds.length === 0)) list.push(t("combo.needOptions"));
    if (strategy === "fixed" && (!priceMinor || priceMinor <= 0)) list.push(t("combo.needPrice"));
    return list;
  }, [name, slots, strategy, priceMinor, t]);

  async function save() {
    if (problems.length > 0) return;
    const payload: Partial<Combo> = {
      name,
      pricingStrategy: strategy,
      price: money(priceMinor ?? 0, CURRENCY),
      active,
      slots: slots.map((slot, index) => ({
        id: `cs_${index + 1}`,
        name: slot.name,
        optionItemIds: slot.optionItemIds,
        optionNames: slot.optionItemIds.map(
          (id) => menuItems.find((item) => item.id === id)?.name ?? { en: "", ar: "" },
        ),
        priceDelta: money(slot.priceDeltaMinor, CURRENCY),
      })) satisfies ComboSlot[],
    };

    await action.run(
      () =>
        combo
          ? services.catalogue.combos.update(combo.id, payload)
          : services.catalogue.combos.create(payload),
      { onSuccess: () => onSaved(combo ? t("combo.saved") : t("combo.created")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={combo ? t("combo.edit") : t("combo.new")}
      subtitle="FR-POS-030"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={save}
          >
            {combo ? t("common.save") : t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <LocalisedField label={t("common.name")} required value={name} onChange={setName} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("combo.strategy")} hint={t("combo.strategyHint")}>
            <Select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as ComboPricingStrategy)}
            >
              <option value="fixed">{t("combo.strategy.fixed")}</option>
              <option value="sum_minus_discount">{t("combo.strategy.sum")}</option>
              <option value="component_override">{t("combo.strategy.override")}</option>
            </Select>
          </Field>
          <Field label={t("combo.price")} required={strategy === "fixed"}>
            <MoneyInput
              value={priceMinor}
              currency={CURRENCY}
              onChange={setPriceMinor}
              aria-label={t("combo.price")}
            />
          </Field>
        </div>

        {/*
          FR-POS-032 — without an allocation basis a combo shows as a single
          line and the sales report cannot answer "how many burgers did we
          sell", because half of them were inside meals. Restaurateurs treat
          that as a defect, correctly.
        */}
        <Field label={t("combo.allocation")} hint={t("combo.allocationHint")}>
          <Select
            value={allocation}
            onChange={(event) =>
              setAllocation(event.target.value as "equal" | "list_price" | "cost")
            }
          >
            <option value="equal">{t("combo.allocation.equal")}</option>
            <option value="list_price">{t("combo.allocation.listPrice")}</option>
            <option value="cost">{t("combo.allocation.cost")}</option>
          </Select>
        </Field>

        {/* -- Slots ------------------------------------------------------ */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-fg text-sm font-semibold">{t("combo.slots")}</h3>
            <Button size="sm" icon={<Plus size={12} />} onClick={addSlot}>
              {t("combo.addSlot")}
            </Button>
          </div>
          <p className="text-fg-subtle mb-2 text-xs leading-relaxed">{t("combo.slotsNote")}</p>

          {slots.length === 0 ? (
            <Callout tone="muted">{t("combo.noSlots")}</Callout>
          ) : (
            <ul className="space-y-2">
              {slots.map((slot, index) => (
                <li key={slot.key} className="border-line rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-fg-subtle mt-2.5 w-5 shrink-0 text-center font-mono text-xs tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <LocalisedField
                        label={t("combo.slotName")}
                        value={slot.name}
                        onChange={(next) => patchSlot(slot.key, { name: next })}
                      />

                      <Field label={t("combo.options")} hint={t("combo.optionsHint")} required>
                        <div className="max-h-40 overflow-y-auto">
                          <div className="flex flex-wrap gap-1.5">
                            {menuItems.map((item) => {
                              const on = slot.optionItemIds.includes(item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() =>
                                    patchSlot(slot.key, {
                                      optionItemIds: on
                                        ? slot.optionItemIds.filter((id) => id !== item.id)
                                        : [...slot.optionItemIds, item.id],
                                    })
                                  }
                                  className={cx(
                                    "rounded-lg border px-2.5 py-1.5 text-xs",
                                    on
                                      ? "border-accent bg-accent-soft text-accent font-medium"
                                      : "border-line bg-raised text-fg-muted",
                                  )}
                                >
                                  {tx(item.name)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </Field>

                      <Field label={t("combo.priceDelta")} hint={t("combo.priceDeltaHint")}>
                        <MoneyInput
                          value={slot.priceDeltaMinor}
                          currency={CURRENCY}
                          onChange={(minor) => patchSlot(slot.key, { priceDeltaMinor: minor ?? 0 })}
                          aria-label={t("combo.priceDelta")}
                        />
                      </Field>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.delete")}
                      icon={<Trash2 size={13} />}
                      onClick={() => void removeSlot(slot.key)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {slots.length > 0 ? (
          <DescList>
            <DescRow label={t("combo.componentSum")} mono>
              {formatMoney(money(componentSum, CURRENCY), fmt)}
            </DescRow>
            <DescRow label={t("combo.customerSaves")} mono>
              <span className={cx(saving > 0 ? "text-good" : "text-warn")}>
                {formatMoney(money(saving, CURRENCY), fmt)}
              </span>
            </DescRow>
          </DescList>
        ) : null}

        <Toggle checked={active} onChange={setActive} label={t("common.active")} />

        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// User — FR-SEC-020, FR-SEC-024
// ---------------------------------------------------------------------------

export function UserDrawer({
  user,
  open,
  onClose,
  onSaved,
}: {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();

  const [name, setName] = useState({ ...EMPTY_LOCALISED });
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState<User["locale"]>("ar");
  const [roleKey, setRoleKey] = useState<RoleKey>("cashier");
  const [mfaEnrolled, setMfaEnrolled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? { ...EMPTY_LOCALISED });
    setEmail(user?.email ?? "");
    setPhone(user?.phone ?? "");
    setLocale(user?.locale ?? "ar");
    setMfaEnrolled(user?.mfaEnrolled ?? false);
    setRoleKey((user?.assignments[0]?.roleId as RoleKey) ?? "cashier");
  }, [open, user?.id]);

  /**
   * FR-SEC-024 — MFA is mandatory for any role holding user management,
   * tenant settings or API key management. The form refuses rather than
   * warns, because a warning on a security control is a suggestion.
   */
  const mfaRequired = useMemo(() => {
    const granted = permissionsForRole(roleKey);
    return MFA_REQUIRED_PERMISSIONS.some((permission) => granted.has(permission));
  }, [roleKey]);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!name.en.trim() && !name.ar.trim()) list.push(t("usr.needName"));
    if (!emailValid) list.push(t("usr.needEmail"));
    if (mfaRequired && !mfaEnrolled) list.push(t("usr.mfaMandatory"));
    return list;
  }, [name, emailValid, mfaRequired, mfaEnrolled, t]);

  async function save() {
    if (problems.length > 0) return;
    const payload: Partial<User> = {
      name,
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      locale,
      mfaEnrolled,
      status: "active",
    };

    await action.run(
      () =>
        user
          ? services.security.users.update(user.id, payload)
          : services.security.users.create(payload),
      { onSuccess: () => onSaved(user ? t("usr.saved") : t("usr.invited")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={user ? t("usr.editUser") : t("usr.newUser")}
      subtitle="FR-SEC-020"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={save}
          >
            {user ? t("common.save") : t("common.invite")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <LocalisedField label={t("common.name")} required value={name} onChange={setName} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("auth.email")}
            hint={t("usr.emailHint")}
            required
            error={email.length > 0 && !emailValid ? t("usr.badEmail") : undefined}
          >
            <Input
              dir="ltr"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t("usr.phone")}>
            <Input
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("onb.role")} hint={t("usr.roleHint")}>
            <Select
              value={roleKey}
              onChange={(event) => setRoleKey(event.target.value as RoleKey)}
            >
              {ROLE_LIST.map((role) => (
                <option key={role.key} value={role.key}>
                  {tx(role.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("usr.locale")}>
            <Select
              value={locale}
              onChange={(event) => setLocale(event.target.value as User["locale"])}
            >
              <option value="ar">{t("loc.arabic")}</option>
              <option value="en">{t("loc.english")}</option>
            </Select>
          </Field>
        </div>

        {mfaRequired ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("usr.mfaRequiredTitle")}>
            {t("usr.mfaRequiredBody")}
          </Callout>
        ) : null}

        <Toggle
          checked={mfaEnrolled}
          onChange={setMfaEnrolled}
          label={t("usr.mfaEnrol")}
          hint={mfaRequired ? t("usr.mfaCannotDisable") : t("usr.mfaEnrolHint")}
          disabled={mfaRequired && mfaEnrolled}
        />

        {problems.length > 0 ? (
          <ul className="text-bad space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Integration — FR-INT-004, FR-INT-005
// ---------------------------------------------------------------------------

export function IntegrationDrawer({
  integration,
  open,
  onClose,
  onSaved,
}: {
  integration: Integration | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const confirm = useConfirm();

  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(integration?.enabled ?? false);
    setEndpoint("");
    setApiKey("");
    setReveal(false);
  }, [open, integration?.id]);

  if (!open || !integration) return null;

  async function save() {
    await action.run(
      () => services.platform.integrations.update(integration!.id, { enabled }),
      { onSuccess: () => onSaved(t("int.saved")) },
    );
  }

  async function resetBreaker() {
    const ok = await confirm({
      title: t("int.resetBreakerTitle"),
      body: t("int.resetBreakerBody"),
      confirmLabel: t("int.resetBreaker"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      () => services.platform.integrations.update(integration!.id, { circuitOpen: false }),
      { onSuccess: () => onSaved(t("int.breakerReset")) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={integration.name}
      subtitle={integration.vendor}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={action.pending} onClick={save}>
            {t("common.save")}
          </Button>
          {integration.circuitOpen ? (
            <Button loading={action.pending} onClick={() => void resetBreaker()}>
              {t("int.resetBreaker")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <p className="text-fg-muted text-sm leading-relaxed">{tx(integration.description)}</p>

        {integration.circuitOpen ? (
          <Callout tone="bad" icon={<AlertTriangle size={14} />} title={t("int.breakerOpenTitle")}>
            {t("int.breakerOpenBody")}
          </Callout>
        ) : null}

        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label={t("int.enabled")}
          hint={t("int.enabledHint")}
        />

        <Field label={t("int.endpoint")} hint={t("int.endpointHint")}>
          <Input
            dir="ltr"
            value={endpoint}
            placeholder={t("int.endpointPlaceholder")}
            onChange={(event) => setEndpoint(event.target.value)}
            className="font-mono text-xs"
          />
        </Field>

        {/*
          FR-INT-005 — credentials are write-only from here. They go in, they
          are never rendered back, and they never appear in a log or an error
          message. Showing a stored secret to help someone check it is how it
          ends up in a screenshot in a support thread.
        */}
        <Field label={t("int.apiKey")} hint={t("int.apiKeyHint")}>
          <div className="flex gap-1.5">
            <Input
              dir="ltr"
              type={reveal ? "text" : "password"}
              value={apiKey}
              autoComplete="off"
              placeholder={t("int.apiKeyPlaceholder")}
              onChange={(event) => setApiKey(event.target.value)}
              className="font-mono text-xs"
            />
            <Button
              variant="ghost"
              aria-label={reveal ? t("int.hide") : t("int.reveal")}
              icon={reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              onClick={() => setReveal((current) => !current)}
            />
          </div>
        </Field>

        <Callout tone="muted">{t("int.credentialNote")}</Callout>

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={integration.enabled ? "good" : "muted"} dot>
              {integration.status}
            </Badge>
          </DescRow>
          <DescRow label={t("int.branches")} mono>
            {integration.branchCount}
          </DescRow>
        </DescList>
      </div>
    </Drawer>
  );
}
