"use client";

/**
 * The fifteen setup steps.
 *
 * Every step validates against its own schema in `schemas/onboarding.ts` and
 * commits into `store/onboarding.ts`; neither is duplicated here. What lives
 * in this file is only the presentation and the per-step interaction.
 *
 * Two of the steps are not forms. `preview` renders the menu that the earlier
 * steps produced as an actual POS grid, and `sample` rings a sale through it
 * and shows what that sale touched. They are here because a wizard that ends
 * on "Finish" has proved nothing — the SRS's own measure is time to *first
 * order*, so the wizard has to reach one.
 */

import { useMemo, useState, type ComponentType } from "react";
import { ArrowRight, Check, Coins, Plus, Trash2, Utensils } from "lucide-react";

import type { ConsoleKey } from "@/content/console/en";
import type { Localised } from "@/lib/console/types";
import {
  COUNTRIES,
  CURRENCIES,
  ORDER_TYPES,
  TENDER_TYPES,
  brandStepSchema,
  branchStepSchema,
  businessDayStepSchema,
  businessStepSchema,
  categoriesStepSchema,
  employeeStepSchema,
  itemsStepSchema,
  localeStepSchema,
  paymentsStepSchema,
  shiftStepSchema,
  taxStepSchema,
  tenantStepSchema,
  terminalStepSchema,
  type CategoryDraft,
  type ItemDraft,
  type OnboardingStepId,
} from "@/schemas/onboarding";
import { useOnboardingStore } from "@/store/onboarding";
import { useI18n } from "@/lib/console/providers";
import { ROLE_LIST } from "@/lib/console/permissions";
import { ORDER_TYPE, TENDER_TYPE } from "@/lib/console/labels";
import { formatMoney, money } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField, PercentInput } from "@/components/console/fields";
import { localisedError, useStepForm } from "@/components/onboarding/step-form";
import {
  Badge,
  Button,
  Callout,
  Card,
  DescList,
  DescRow,
  Field,
  Input,
  Select,
  SegmentedControl,
  Toggle,
  cx,
} from "@/components/console/ui";

export interface StepProps {
  onDone: () => void;
  onMessage: (message: string) => void;
}

export interface StepMeta {
  labelKey: ConsoleKey;
  hintKey: ConsoleKey;
  spec: string;
}

/** The primary action every form step ends with. */
function Commit({
  onClick,
  label,
}: {
  onClick: () => void;
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="border-line mt-6 border-t pt-4">
      <Button variant="primary" icon={<ArrowRight size={14} />} onClick={onClick}>
        {label ?? t("onb.saveAndContinue")}
      </Button>
    </div>
  );
}

function countryLabel(code: string, t: (k: ConsoleKey) => string): string {
  return t(`country.${code}` as ConsoleKey);
}

// ---------------------------------------------------------------------------
// 1 — Tenant
// ---------------------------------------------------------------------------

function TenantStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(tenantStepSchema, {
    name: (draft.tenant?.name as Localised) ?? EMPTY_LOCALISED,
    country: draft.tenant?.country ?? "EG",
  });

  return (
    <div className="space-y-4">
      <LocalisedField
        label={t("onb.tenantName")}
        hint={t("onb.tenantNameHint")}
        required
        value={form.values.name}
        error={localisedError(form.errorFor, "name")}
        onChange={(name) => form.set({ name })}
      />

      <Field label={t("onb.country")} hint={t("onb.countryHint")} error={form.errorFor("country")} required>
        <Select
          value={form.values.country}
          onChange={(event) => form.set({ country: event.target.value as typeof form.values.country })}
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {countryLabel(code, t)}
            </option>
          ))}
        </Select>
      </Field>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("tenant", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 — Business information
// ---------------------------------------------------------------------------

function BusinessStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(businessStepSchema, {
    legalName: draft.business?.legalName ?? "",
    taxRegistrationNumber: draft.business?.taxRegistrationNumber ?? "",
    commercialRegistration: draft.business?.commercialRegistration ?? "",
    addressLine: draft.business?.addressLine ?? "",
    city: draft.business?.city ?? "",
    phone: draft.business?.phone ?? "",
    email: draft.business?.email ?? "",
  });

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("onb.businessNote")}</Callout>

      <Field label={t("onb.legalName")} error={form.errorFor("legalName")} required>
        <Input
          value={form.values.legalName}
          onChange={(event) => form.set({ legalName: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("onb.taxRegistration")}
          hint={t("onb.taxRegistrationHint")}
          error={form.errorFor("taxRegistrationNumber")}
        >
          <Input
            dir="ltr"
            value={form.values.taxRegistrationNumber}
            onChange={(event) => form.set({ taxRegistrationNumber: event.target.value })}
          />
        </Field>
        <Field
          label={t("onb.commercialRegistration")}
          error={form.errorFor("commercialRegistration")}
        >
          <Input
            dir="ltr"
            value={form.values.commercialRegistration}
            onChange={(event) => form.set({ commercialRegistration: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t("onb.address")} error={form.errorFor("addressLine")} required>
        <Input
          value={form.values.addressLine}
          onChange={(event) => form.set({ addressLine: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("onb.city")} error={form.errorFor("city")} required>
          <Input value={form.values.city} onChange={(event) => form.set({ city: event.target.value })} />
        </Field>
        <Field label={t("onb.phone")} error={form.errorFor("phone")} required>
          <Input
            dir="ltr"
            inputMode="tel"
            value={form.values.phone}
            onChange={(event) => form.set({ phone: event.target.value })}
          />
        </Field>
        <Field label={t("onb.email")} error={form.errorFor("email")} required>
          <Input
            dir="ltr"
            inputMode="email"
            value={form.values.email}
            onChange={(event) => form.set({ email: event.target.value })}
          />
        </Field>
      </div>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("business", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 — Brand
// ---------------------------------------------------------------------------

const CONCEPTS = ["casual_dining", "quick_service", "cafe", "cloud_kitchen", "fine_dining"] as const;
const SWATCHES = ["#0f766e", "#b45309", "#9d174d", "#1d4ed8", "#4d7c0f", "#7c2d12"];

function BrandStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(brandStepSchema, {
    name: (draft.brand?.name as Localised) ?? EMPTY_LOCALISED,
    concept: draft.brand?.concept ?? "casual_dining",
    accentColour: draft.brand?.accentColour ?? "#0f766e",
  });

  return (
    <div className="space-y-4">
      <LocalisedField
        label={t("onb.brandName")}
        hint={t("onb.brandNameHint")}
        required
        value={form.values.name}
        error={localisedError(form.errorFor, "name")}
        onChange={(name) => form.set({ name })}
      />

      <Field label={t("onb.concept")} error={form.errorFor("concept")} required>
        <Select
          value={form.values.concept}
          onChange={(event) => form.set({ concept: event.target.value as typeof form.values.concept })}
        >
          {CONCEPTS.map((concept) => (
            <option key={concept} value={concept}>
              {t(`onb.concept.${concept}` as ConsoleKey)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("onb.accentColour")} hint={t("onb.accentColourHint")} error={form.errorFor("accentColour")}>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={colour}
              onClick={() => form.set({ accentColour: colour })}
              className={cx(
                "h-9 w-9 rounded-lg border-2 transition-transform",
                form.values.accentColour === colour
                  ? "border-fg scale-110"
                  : "border-transparent",
              )}
              style={{ background: colour }}
            />
          ))}
          <Input
            dir="ltr"
            value={form.values.accentColour}
            onChange={(event) => form.set({ accentColour: event.target.value })}
            className="w-32 font-mono"
            aria-label={t("onb.accentColour")}
          />
        </div>
      </Field>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("brand", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 — First branch
// ---------------------------------------------------------------------------

function BranchStep({ onDone, onMessage }: StepProps) {
  const { t, tx } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(branchStepSchema, {
    name: (draft.branch?.name as Localised) ?? EMPTY_LOCALISED,
    addressLine: draft.branch?.addressLine ?? "",
    city: draft.branch?.city ?? "",
    phone: draft.branch?.phone ?? "",
    seats: draft.branch?.seats ?? 40,
    orderTypes: (draft.branch?.orderTypes as (typeof ORDER_TYPES)[number][]) ?? ["dine_in", "takeaway"],
  });

  function toggleType(type: (typeof ORDER_TYPES)[number]) {
    const current = form.values.orderTypes;
    form.set({
      orderTypes: current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type],
    });
  }

  return (
    <div className="space-y-4">
      <LocalisedField
        label={t("onb.branchName")}
        required
        value={form.values.name}
        error={localisedError(form.errorFor, "name")}
        onChange={(name) => form.set({ name })}
      />

      <Field label={t("onb.address")} error={form.errorFor("addressLine")} required>
        <Input
          value={form.values.addressLine}
          onChange={(event) => form.set({ addressLine: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("onb.city")} error={form.errorFor("city")} required>
          <Input value={form.values.city} onChange={(event) => form.set({ city: event.target.value })} />
        </Field>
        <Field label={t("onb.phone")} error={form.errorFor("phone")}>
          <Input
            dir="ltr"
            inputMode="tel"
            value={form.values.phone}
            onChange={(event) => form.set({ phone: event.target.value })}
          />
        </Field>
        <Field label={t("onb.seats")} hint={t("onb.seatsHint")} error={form.errorFor("seats")} required>
          <Input
            dir="ltr"
            inputMode="numeric"
            value={String(form.values.seats)}
            onChange={(event) => form.set({ seats: Number(event.target.value) || 0 })}
            className="text-end font-mono tabular-nums"
          />
        </Field>
      </div>

      <Field
        label={t("onb.orderTypes")}
        hint={t("onb.orderTypesHint")}
        error={form.errorFor("orderTypes")}
        required
      >
        <div className="flex flex-wrap gap-1.5">
          {ORDER_TYPES.map((type) => {
            const on = form.values.orderTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => toggleType(type)}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                  on
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted hover:text-fg",
                )}
              >
                {on ? <Check size={13} aria-hidden /> : null}
                {tx(ORDER_TYPE[type].label)}
              </button>
            );
          })}
        </div>
      </Field>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("branch", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 — Locale and currency
// ---------------------------------------------------------------------------

const TIMEZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Amman",
  "Asia/Kuwait",
  "Asia/Qatar",
];

function LocaleStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(localeStepSchema, {
    country: draft.locale?.country ?? draft.tenant?.country ?? "EG",
    currency: draft.locale?.currency ?? "EGP",
    timezone: draft.locale?.timezone ?? "Africa/Cairo",
    defaultLocale: draft.locale?.defaultLocale ?? "ar",
    arabicIndicNumerals: draft.locale?.arabicIndicNumerals ?? false,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.country")} error={form.errorFor("country")} required>
          <Select
            value={form.values.country}
            onChange={(event) => form.set({ country: event.target.value as typeof form.values.country })}
          >
            {COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("onb.currency")} error={form.errorFor("currency")} required>
          <Select
            value={form.values.currency}
            onChange={(event) => form.set({ currency: event.target.value as typeof form.values.currency })}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t("onb.timezone")} hint={t("onb.timezoneHint")} error={form.errorFor("timezone")} required>
        <Select
          value={form.values.timezone}
          onChange={(event) => form.set({ timezone: event.target.value })}
        >
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("onb.defaultLocale")} hint={t("onb.defaultLocaleHint")}>
        <SegmentedControl
          value={form.values.defaultLocale}
          onChange={(next) => form.set({ defaultLocale: next })}
          options={[
            { value: "ar" as const, label: t("loc.arabic") },
            { value: "en" as const, label: t("loc.english") },
          ]}
        />
      </Field>

      <Toggle
        checked={form.values.arabicIndicNumerals}
        onChange={(arabicIndicNumerals) => form.set({ arabicIndicNumerals })}
        label={t("onb.arabicNumerals")}
        hint={t("onb.arabicNumeralsHint")}
      />

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("locale", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6 — Tax
// ---------------------------------------------------------------------------

function TaxStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(taxStepSchema, {
    pricingMode: draft.tax?.pricingMode ?? "tax_inclusive",
    standardRate: draft.tax?.standardRate ?? 14,
    reducedRate: draft.tax?.reducedRate,
    roundingMode: draft.tax?.roundingMode ?? "HALF_UP",
    computationLevel: draft.tax?.computationLevel ?? "line",
  });

  return (
    <div className="space-y-4">
      <Callout tone="accent" title={t("onb.taxWhyTitle")}>
        {t("onb.taxWhyBody")}
      </Callout>

      <Field label={t("onb.pricingMode")} hint={t("onb.pricingModeHint")}>
        <SegmentedControl
          value={form.values.pricingMode}
          onChange={(next) => form.set({ pricingMode: next })}
          options={[
            { value: "tax_inclusive" as const, label: t("onb.taxInclusive") },
            { value: "tax_exclusive" as const, label: t("onb.taxExclusive") },
          ]}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.standardRate")} error={form.errorFor("standardRate")} required>
          <PercentInput
            value={String(form.values.standardRate)}
            onChange={(next) => form.set({ standardRate: Number(next) || 0 })}
            aria-label={t("onb.standardRate")}
          />
        </Field>
        <Field label={t("onb.reducedRate")} hint={t("onb.reducedRateHint")} error={form.errorFor("reducedRate")}>
          <PercentInput
            value={form.values.reducedRate === undefined ? "" : String(form.values.reducedRate)}
            onChange={(next) => form.set({ reducedRate: next === "" ? undefined : Number(next) })}
            aria-label={t("onb.reducedRate")}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.roundingMode")} hint={t("onb.roundingModeHint")}>
          <Select
            value={form.values.roundingMode}
            onChange={(event) => form.set({ roundingMode: event.target.value as typeof form.values.roundingMode })}
          >
            <option value="HALF_UP">HALF_UP</option>
            <option value="HALF_EVEN">HALF_EVEN</option>
            <option value="DOWN">DOWN</option>
          </Select>
        </Field>
        <Field label={t("onb.computationLevel")} hint={t("onb.computationLevelHint")}>
          <SegmentedControl
            value={form.values.computationLevel}
            onChange={(next) => form.set({ computationLevel: next })}
            options={[
              { value: "line" as const, label: t("onb.perLine") },
              { value: "order" as const, label: t("onb.perOrder") },
            ]}
          />
        </Field>
      </div>

      {form.values.computationLevel === "order" ? (
        <Callout tone="warn">{t("onb.perOrderWarning")}</Callout>
      ) : null}

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("tax", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7 — Business day
// ---------------------------------------------------------------------------

function BusinessDayStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(businessDayStepSchema, {
    closingTime: draft.businessDay?.closingTime ?? "04:00",
    weekStart: draft.businessDay?.weekStart ?? "saturday",
    autoCloseEnabled: draft.businessDay?.autoCloseEnabled ?? true,
  });

  return (
    <div className="space-y-4">
      <Callout tone="accent" title={t("onb.businessDayWhyTitle")}>
        {t("onb.businessDayWhyBody")}
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("onb.closingTime")}
          hint={t("onb.closingTimeHint")}
          error={form.errorFor("closingTime")}
          required
        >
          <Input
            type="time"
            dir="ltr"
            value={form.values.closingTime}
            onChange={(event) => form.set({ closingTime: event.target.value })}
          />
        </Field>
        <Field label={t("onb.weekStart")} error={form.errorFor("weekStart")}>
          <Select
            value={form.values.weekStart}
            onChange={(event) => form.set({ weekStart: event.target.value as typeof form.values.weekStart })}
          >
            <option value="saturday">{t("common.saturday")}</option>
            <option value="sunday">{t("common.sunday")}</option>
            <option value="monday">{t("common.monday")}</option>
          </Select>
        </Field>
      </div>

      <Toggle
        checked={form.values.autoCloseEnabled}
        onChange={(autoCloseEnabled) => form.set({ autoCloseEnabled })}
        label={t("onb.autoClose")}
        hint={t("onb.autoCloseHint")}
      />

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("businessDay", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8 — Categories
// ---------------------------------------------------------------------------

let draftSeq = 0;
const nextDraftId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(draftSeq += 1)}`;

const STARTER_CATEGORIES: { en: string; ar: string }[] = [
  { en: "Starters", ar: "مقبلات" },
  { en: "Main courses", ar: "أطباق رئيسية" },
  { en: "Sandwiches", ar: "سندويتشات" },
  { en: "Sides", ar: "أطباق جانبية" },
  { en: "Drinks", ar: "مشروبات" },
  { en: "Desserts", ar: "حلويات" },
];

function CategoriesStep({ onDone, onMessage }: StepProps) {
  const { t, tx } = useI18n();
  const confirm = useConfirm();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(categoriesStepSchema, {
    categories: (draft.categories?.categories as CategoryDraft[]) ?? [],
  });

  function add(name: Localised = EMPTY_LOCALISED) {
    form.set({
      categories: [
        ...form.values.categories,
        { id: nextDraftId("cat"), name, sortOrder: form.values.categories.length },
      ],
    });
  }

  async function remove(id: string) {
    const row = form.values.categories.find((entry) => entry.id === id);
    const ok = await confirm({
      title: t("onb.removeCategory"),
      body: t("onb.removeCategoryBody").replace("{name}", row ? tx(row.name) : ""),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    form.set({ categories: form.values.categories.filter((entry) => entry.id !== id) });
  }

  function move(index: number, delta: number) {
    const next = [...form.values.categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    form.set({ categories: next.map((entry, order) => ({ ...entry, sortOrder: order })) });
  }

  const unused = STARTER_CATEGORIES.filter(
    (starter) => !form.values.categories.some((entry) => entry.name.en === starter.en),
  );

  return (
    <div className="space-y-4">
      {unused.length > 0 ? (
        <div>
          <p className="text-fg-muted mb-1.5 text-xs">{t("onb.starterCategories")}</p>
          <div className="flex flex-wrap gap-1.5">
            {unused.map((starter) => (
              <button
                key={starter.en}
                type="button"
                onClick={() => add(starter)}
                className="border-line bg-raised text-fg-muted hover:text-fg inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
              >
                <Plus size={12} aria-hidden />
                {tx(starter)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {form.errorFor("categories") ? (
        <Callout tone="bad">{form.errorFor("categories")}</Callout>
      ) : null}

      {form.values.categories.length === 0 ? (
        <div className="border-line rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-fg text-sm font-medium">{t("onb.noCategories")}</p>
          <p className="text-fg-muted mt-1 text-xs">{t("onb.noCategoriesHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {form.values.categories.map((category, index) => (
            <li key={category.id} className="border-line rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <span className="text-fg-subtle mt-2 w-6 shrink-0 text-center font-mono text-xs tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <LocalisedField
                    label={t("common.name")}
                    required
                    value={category.name}
                    error={localisedError(form.errorFor, `categories.${index}.name`)}
                    onChange={(name) =>
                      form.set({
                        categories: form.values.categories.map((entry) =>
                          entry.id === category.id ? { ...entry, name } : entry,
                        ),
                      })
                    }
                  />
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="sm" variant="ghost" aria-label={t("onb.moveUp")} onClick={() => move(index, -1)}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={t("onb.moveDown")} onClick={() => move(index, 1)}>
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.delete")}
                    icon={<Trash2 size={13} />}
                    onClick={() => void remove(category.id)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" icon={<Plus size={13} />} onClick={() => add()}>
        {t("onb.addCategory")}
      </Button>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("categories", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9 — Items
// ---------------------------------------------------------------------------

function ItemsStep({ onDone, onMessage }: StepProps) {
  const { t, tx } = useI18n();
  const confirm = useConfirm();
  const { draft, commit } = useOnboardingStore();
  const categories = (draft.categories?.categories as CategoryDraft[]) ?? [];

  const form = useStepForm(itemsStepSchema, {
    items: (draft.items?.items as ItemDraft[]) ?? [],
  });

  function add() {
    form.set({
      items: [
        ...form.values.items,
        {
          id: nextDraftId("itm"),
          name: EMPTY_LOCALISED,
          categoryId: categories[0]?.id ?? "",
          price: "",
          taxClass: "standard",
          prepMinutes: 5,
        },
      ],
    });
  }

  async function remove(id: string) {
    const row = form.values.items.find((entry) => entry.id === id);
    const ok = await confirm({
      title: t("onb.removeItem"),
      body: t("onb.removeItemBody").replace("{name}", row ? tx(row.name) : ""),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    form.set({ items: form.values.items.filter((entry) => entry.id !== id) });
  }

  function patch(id: string, part: Partial<ItemDraft>) {
    form.set({
      items: form.values.items.map((entry) => (entry.id === id ? { ...entry, ...part } : entry)),
    });
  }

  if (categories.length === 0) {
    return (
      <Callout tone="warn" title={t("onb.noCategoriesYet")}>
        {t("onb.noCategoriesYetBody")}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("onb.itemsNote")}</Callout>

      {form.errorFor("items") ? <Callout tone="bad">{form.errorFor("items")}</Callout> : null}

      {form.values.items.length === 0 ? (
        <div className="border-line rounded-xl border border-dashed px-6 py-10 text-center">
          <Utensils size={20} className="text-fg-subtle mx-auto mb-2" aria-hidden />
          <p className="text-fg text-sm font-medium">{t("onb.noItems")}</p>
          <p className="text-fg-muted mt-1 text-xs">{t("onb.noItemsHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {form.values.items.map((item, index) => (
            <li key={item.id} className="border-line rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <LocalisedField
                    label={t("common.name")}
                    required
                    value={item.name}
                    error={localisedError(form.errorFor, `items.${index}.name`)}
                    onChange={(name) => patch(item.id, { name })}
                  />

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label={t("common.category")}
                      error={form.errorFor(`items.${index}.categoryId`)}
                      required
                    >
                      <Select
                        value={item.categoryId}
                        onChange={(event) => patch(item.id, { categoryId: event.target.value })}
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {tx(category.name)}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label={t("onb.price")}
                      error={form.errorFor(`items.${index}.price`)}
                      required
                    >
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        value={item.price}
                        onChange={(event) => patch(item.id, { price: event.target.value })}
                        className="text-end font-mono tabular-nums"
                      />
                    </Field>

                    <Field label={t("onb.taxClass")} error={form.errorFor(`items.${index}.taxClass`)}>
                      <Select
                        value={item.taxClass}
                        onChange={(event) =>
                          patch(item.id, { taxClass: event.target.value as ItemDraft["taxClass"] })
                        }
                      >
                        <option value="standard">{t("onb.taxStandard")}</option>
                        <option value="reduced">{t("onb.taxReduced")}</option>
                        <option value="zero">{t("onb.taxZero")}</option>
                        <option value="exempt">{t("onb.taxExempt")}</option>
                      </Select>
                    </Field>

                    <Field
                      label={t("onb.prepMinutes")}
                      hint={t("onb.prepMinutesHint")}
                      error={form.errorFor(`items.${index}.prepMinutes`)}
                    >
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        value={String(item.prepMinutes)}
                        onChange={(event) =>
                          patch(item.id, { prepMinutes: Number(event.target.value) || 0 })
                        }
                        className="text-end font-mono tabular-nums"
                      />
                    </Field>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.delete")}
                  icon={<Trash2 size={13} />}
                  onClick={() => void remove(item.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" icon={<Plus size={13} />} onClick={add}>
        {t("onb.addItem")}
      </Button>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("items", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10 — Payments
// ---------------------------------------------------------------------------

function PaymentsStep({ onDone, onMessage }: StepProps) {
  const { t, tx } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(paymentsStepSchema, {
    enabled: (draft.payments?.enabled as (typeof TENDER_TYPES)[number][]) ?? ["cash", "card"],
    cashRoundingMinorUnits: draft.payments?.cashRoundingMinorUnits ?? 0,
  });

  function toggle(tender: (typeof TENDER_TYPES)[number]) {
    const current = form.values.enabled;
    form.set({
      enabled: current.includes(tender)
        ? current.filter((entry) => entry !== tender)
        : [...current, tender],
    });
  }

  return (
    <div className="space-y-4">
      <Field label={t("onb.tenders")} hint={t("onb.tendersHint")} error={form.errorFor("enabled")} required>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {TENDER_TYPES.map((tender) => {
            const on = form.values.enabled.includes(tender);
            return (
              <button
                key={tender}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(tender)}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors",
                  on
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted hover:text-fg",
                )}
              >
                <span
                  className={cx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-accent bg-accent text-white" : "border-line",
                  )}
                  aria-hidden
                >
                  {on ? <Check size={11} /> : null}
                </span>
                {tx(TENDER_TYPE[tender].label)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label={t("onb.cashRounding")}
        hint={t("onb.cashRoundingHint")}
        error={form.errorFor("cashRoundingMinorUnits")}
      >
        <Select
          value={String(form.values.cashRoundingMinorUnits)}
          onChange={(event) => form.set({ cashRoundingMinorUnits: Number(event.target.value) })}
        >
          <option value="0">{t("onb.roundingNone")}</option>
          <option value="5">{t("onb.rounding5")}</option>
          <option value="25">{t("onb.rounding25")}</option>
          <option value="100">{t("onb.rounding100")}</option>
        </Select>
      </Field>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("payments", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11 — First employee
// ---------------------------------------------------------------------------

function EmployeeStep({ onDone, onMessage }: StepProps) {
  const { t, tx } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(employeeStepSchema, {
    name: (draft.employee?.name as Localised) ?? EMPTY_LOCALISED,
    position: draft.employee?.position ?? "",
    email: draft.employee?.email ?? "",
    phone: draft.employee?.phone ?? "",
    pin: draft.employee?.pin ?? "",
    startDate: draft.employee?.startDate ?? new Date().toISOString().slice(0, 10),
    roleKey: draft.employee?.roleKey ?? "cashier",
  });

  return (
    <div className="space-y-4">
      <LocalisedField
        label={t("common.name")}
        required
        value={form.values.name}
        error={localisedError(form.errorFor, "name")}
        onChange={(name) => form.set({ name })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.position")} error={form.errorFor("position")} required>
          <Input
            value={form.values.position}
            onChange={(event) => form.set({ position: event.target.value })}
          />
        </Field>
        <Field label={t("onb.role")} hint={t("onb.roleHint")} error={form.errorFor("roleKey")} required>
          <Select
            value={form.values.roleKey}
            onChange={(event) => form.set({ roleKey: event.target.value })}
          >
            {ROLE_LIST.map((role) => (
              <option key={role.key} value={role.key}>
                {tx(role.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.email")} error={form.errorFor("email")} required>
          <Input
            dir="ltr"
            inputMode="email"
            value={form.values.email}
            onChange={(event) => form.set({ email: event.target.value })}
          />
        </Field>
        <Field label={t("onb.phone")} error={form.errorFor("phone")}>
          <Input
            dir="ltr"
            inputMode="tel"
            value={form.values.phone}
            onChange={(event) => form.set({ phone: event.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.pin")} hint={t("onb.pinHint")} error={form.errorFor("pin")} required>
          <Input
            dir="ltr"
            inputMode="numeric"
            maxLength={4}
            value={form.values.pin}
            onChange={(event) => form.set({ pin: event.target.value.replace(/\D/g, "") })}
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
        </Field>
        <Field label={t("onb.startDate")} error={form.errorFor("startDate")} required>
          <Input
            type="date"
            dir="ltr"
            value={form.values.startDate}
            onChange={(event) => form.set({ startDate: event.target.value })}
          />
        </Field>
      </div>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("employee", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 12 — Terminal
// ---------------------------------------------------------------------------

function TerminalStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const form = useStepForm(terminalStepSchema, {
    name: draft.terminal?.name ?? "",
    deviceType: draft.terminal?.deviceType ?? "pos",
    printerAttached: draft.terminal?.printerAttached ?? true,
    cashDrawerAttached: draft.terminal?.cashDrawerAttached ?? true,
  });

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("onb.terminalNote")}</Callout>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onb.terminalName")} error={form.errorFor("name")} required>
          <Input
            value={form.values.name}
            placeholder={t("onb.terminalNamePlaceholder")}
            onChange={(event) => form.set({ name: event.target.value })}
          />
        </Field>
        <Field label={t("onb.deviceType")} error={form.errorFor("deviceType")}>
          <Select
            value={form.values.deviceType}
            onChange={(event) => form.set({ deviceType: event.target.value as typeof form.values.deviceType })}
          >
            <option value="pos">{t("onb.devicePos")}</option>
            <option value="kds">{t("onb.deviceKds")}</option>
            <option value="kiosk">{t("onb.deviceKiosk")}</option>
            <option value="handheld">{t("onb.deviceHandheld")}</option>
          </Select>
        </Field>
      </div>

      <Toggle
        checked={form.values.printerAttached}
        onChange={(printerAttached) => form.set({ printerAttached })}
        label={t("onb.printerAttached")}
        hint={t("onb.printerAttachedHint")}
      />
      <Toggle
        checked={form.values.cashDrawerAttached}
        onChange={(cashDrawerAttached) => form.set({ cashDrawerAttached })}
        label={t("onb.drawerAttached")}
        hint={t("onb.drawerAttachedHint")}
      />

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("terminal", parsed as never);
            onMessage(t("onb.stepSaved"));
            onDone();
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 13 — Preview
// ---------------------------------------------------------------------------

function PreviewStep({ onDone }: StepProps) {
  const { t, tx, fmt } = useI18n();
  const { draft } = useOnboardingStore();

  const categories = (draft.categories?.categories as CategoryDraft[]) ?? [];
  const items = (draft.items?.items as ItemDraft[]) ?? [];
  const currency = draft.locale?.currency ?? "EGP";
  const accent = draft.brand?.accentColour ?? "#0f766e";

  const [categoryId, setCategoryId] = useState<string>("all");
  const visible = categoryId === "all" ? items : items.filter((item) => item.categoryId === categoryId);

  return (
    <div className="space-y-4">
      <Callout tone="accent" title={t("onb.previewTitle")}>
        {t("onb.previewBody")}
      </Callout>

      <div className="border-line overflow-hidden rounded-xl border">
        <div className="border-line flex gap-1.5 overflow-x-auto border-b p-2.5">
          <button
            type="button"
            onClick={() => setCategoryId("all")}
            className={cx(
              "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium",
              categoryId === "all" ? "text-white" : "border-line bg-raised text-fg-muted",
            )}
            style={categoryId === "all" ? { background: accent, borderColor: accent } : undefined}
          >
            {t("common.all")}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={cx(
                "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap",
                categoryId === category.id ? "text-white" : "border-line bg-raised text-fg-muted",
              )}
              style={
                categoryId === category.id ? { background: accent, borderColor: accent } : undefined
              }
            >
              {tx(category.name)}
            </button>
          ))}
        </div>

        <div className="p-3">
          {visible.length === 0 ? (
            <p className="text-fg-subtle py-8 text-center text-sm">{t("onb.previewEmpty")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((item) => (
                <div
                  key={item.id}
                  className="border-line bg-raised flex min-h-20 flex-col justify-between rounded-xl border p-2.5"
                  style={{ borderInlineStartWidth: 3, borderInlineStartColor: accent }}
                >
                  <span className="text-fg line-clamp-2 text-sm leading-snug font-medium">
                    {tx(item.name)}
                  </span>
                  <span className="text-fg-muted mt-2 text-xs font-medium tabular-nums">
                    {formatMoney(
                      money(Math.round(Number(item.price || 0) * 100), currency as never),
                      fmt,
                      true,
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DescList>
        <DescRow label={t("onb.previewCategories")} mono>
          {categories.length}
        </DescRow>
        <DescRow label={t("onb.previewItems")} mono>
          {items.length}
        </DescRow>
      </DescList>

      <Commit onClick={onDone} label={t("onb.previewLooksRight")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 14 — Open the till
// ---------------------------------------------------------------------------

function ShiftStep({ onDone, onMessage }: StepProps) {
  const { t } = useI18n();
  const { draft, commit } = useOnboardingStore();
  const currency = draft.locale?.currency ?? "EGP";
  const form = useStepForm(shiftStepSchema, {
    openingFloat: draft.shift?.openingFloat ?? "",
  });

  return (
    <div className="space-y-4">
      <Callout tone="accent" title={t("onb.shiftWhyTitle")}>
        {t("onb.shiftWhyBody")}
      </Callout>

      <Field
        label={`${t("onb.openingFloat")} (${currency})`}
        hint={t("onb.openingFloatHint")}
        error={form.errorFor("openingFloat")}
        required
      >
        <Input
          dir="ltr"
          inputMode="decimal"
          autoFocus
          value={form.values.openingFloat}
          onChange={(event) => form.set({ openingFloat: event.target.value })}
          className="text-end font-mono text-lg tabular-nums"
        />
      </Field>

      <Commit
        onClick={() =>
          form.submit((parsed) => {
            commit("shift", parsed as never);
            onMessage(t("onb.shiftOpened"));
            onDone();
          })
        }
        label={t("onb.openShift")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 15 — Sample order
// ---------------------------------------------------------------------------

interface CascadeStage {
  key: ConsoleKey;
  detail: string;
}

function SampleStep({ onMessage }: StepProps) {
  const { t, tx, fmt } = useI18n();
  const { draft, finish } = useOnboardingStore();
  const [stage, setStage] = useState(-1);
  const [done, setDone] = useState(false);

  const items = (draft.items?.items as ItemDraft[]) ?? [];
  const currency = draft.locale?.currency ?? "EGP";
  const taxRate = draft.tax?.standardRate ?? 14;
  const inclusive = (draft.tax?.pricingMode ?? "tax_inclusive") === "tax_inclusive";

  const sample = items[0];
  const gross = sample ? Math.round(Number(sample.price || 0) * 100) : 0;
  const tax = inclusive
    ? Math.round(gross - gross / (1 + taxRate / 100))
    : Math.round(gross * (taxRate / 100));
  const total = inclusive ? gross : gross + tax;

  const stages: CascadeStage[] = useMemo(
    () => [
      { key: "onb.cascadeOrder", detail: sample ? tx(sample.name) : "" },
      {
        key: "onb.cascadeTax",
        detail: formatMoney(money(tax, currency as never), fmt),
      },
      {
        key: "onb.cascadePayment",
        detail: formatMoney(money(total, currency as never), fmt),
      },
      { key: "onb.cascadeKitchen", detail: `${sample?.prepMinutes ?? 0} ${t("onb.minutes")}` },
      { key: "onb.cascadeInventory", detail: t("onb.cascadeInventoryDetail") },
      { key: "onb.cascadeCash", detail: t("onb.cascadeCashDetail") },
      { key: "onb.cascadeReport", detail: t("onb.cascadeReportDetail") },
    ],
    [sample, tax, total, currency, fmt, t, tx],
  );

  function run() {
    setStage(0);
    setDone(false);
    stages.forEach((_, index) => {
      window.setTimeout(() => setStage(index + 1), (index + 1) * 420);
    });
    window.setTimeout(() => {
      setDone(true);
      onMessage(t("onb.sampleDone"));
    }, stages.length * 420 + 200);
  }

  if (!sample) {
    return (
      <Callout tone="warn" title={t("onb.noItemsYet")}>
        {t("onb.noItemsYetBody")}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <Callout tone="accent" title={t("onb.sampleTitle")}>
        {t("onb.sampleBody")}
      </Callout>

      <Card padded={false}>
        <ol className="divide-line divide-y">
          {stages.map((entry, index) => {
            const reached = stage > index;
            return (
              <li
                key={entry.key}
                className={cx(
                  "flex items-center gap-3 px-4 py-2.5 transition-opacity",
                  reached ? "opacity-100" : "opacity-40",
                )}
              >
                <span
                  className={cx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6rem]",
                    reached ? "bg-good text-white" : "border-line text-fg-subtle border",
                  )}
                  aria-hidden
                >
                  {reached ? <Check size={11} /> : index + 1}
                </span>
                <span className="text-fg min-w-0 flex-1 text-sm">{t(entry.key)}</span>
                <span className="text-fg-muted shrink-0 font-mono text-xs tabular-nums">
                  {reached ? entry.detail : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="border-line mt-6 flex flex-wrap gap-2 border-t pt-4">
        <Button variant="primary" icon={<Coins size={14} />} onClick={run} disabled={stage >= 0 && !done}>
          {stage < 0 ? t("onb.runSample") : t("onb.runAgain")}
        </Button>
        {done ? (
          <Button icon={<Check size={14} />} onClick={finish}>
            {t("onb.finishSetup")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STEP_COMPONENTS: Record<OnboardingStepId, ComponentType<StepProps>> = {
  tenant: TenantStep,
  business: BusinessStep,
  brand: BrandStep,
  branch: BranchStep,
  locale: LocaleStep,
  tax: TaxStep,
  businessDay: BusinessDayStep,
  categories: CategoriesStep,
  items: ItemsStep,
  payments: PaymentsStep,
  employee: EmployeeStep,
  terminal: TerminalStep,
  preview: PreviewStep,
  shift: ShiftStep,
  sample: SampleStep,
};

export const STEP_META: Record<OnboardingStepId, StepMeta> = {
  tenant: { labelKey: "onb.step.tenant", hintKey: "onb.step.tenantHint", spec: "FR-PLT-020" },
  business: { labelKey: "onb.step.business", hintKey: "onb.step.businessHint", spec: "FR-PLT-001" },
  brand: { labelKey: "onb.step.brand", hintKey: "onb.step.brandHint", spec: "FR-PLT-002" },
  branch: { labelKey: "onb.step.branch", hintKey: "onb.step.branchHint", spec: "FR-BRN-001" },
  locale: { labelKey: "onb.step.locale", hintKey: "onb.step.localeHint", spec: "FR-LOC-001" },
  tax: { labelKey: "onb.step.tax", hintKey: "onb.step.taxHint", spec: "FR-FIN-030" },
  businessDay: {
    labelKey: "onb.step.businessDay",
    hintKey: "onb.step.businessDayHint",
    spec: "FR-FIN-024",
  },
  categories: {
    labelKey: "onb.step.categories",
    hintKey: "onb.step.categoriesHint",
    spec: "FR-MNU-001",
  },
  items: { labelKey: "onb.step.items", hintKey: "onb.step.itemsHint", spec: "FR-MNU-004" },
  payments: { labelKey: "onb.step.payments", hintKey: "onb.step.paymentsHint", spec: "FR-POS-060" },
  employee: { labelKey: "onb.step.employee", hintKey: "onb.step.employeeHint", spec: "FR-HRM-001" },
  terminal: { labelKey: "onb.step.terminal", hintKey: "onb.step.terminalHint", spec: "FR-SEC-028" },
  preview: { labelKey: "onb.step.preview", hintKey: "onb.step.previewHint", spec: "FR-POS-010" },
  shift: { labelKey: "onb.step.shift", hintKey: "onb.step.shiftHint", spec: "FR-POS-090" },
  sample: { labelKey: "onb.step.sample", hintKey: "onb.step.sampleHint", spec: "NFR-USA-003" },
};
