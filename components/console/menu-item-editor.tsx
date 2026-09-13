"use client";

/**
 * The full menu item edit — FR-MNU-004, FR-MNU-005, FR-MNU-007.
 *
 * Four names, because four surfaces read them (FR-MNU-005): the POS button
 * ("Chkn Sw"), the kitchen display ("GRL CHKN SW"), the receipt ("Grilled
 * Chicken Sandwich with Garlic Sauce") and the aggregator listing, plus the
 * menu name itself. Each is shown in a live preview at the size it will
 * actually render, because a name that fits in a text box and not on a
 * 40-column receipt is a name nobody checked.
 *
 * What the API stores and what it does not is split in the service layer —
 * see `lib/console/services/menu-profiles.ts` — and the form does not need
 * to know which is which.
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import type { Localised, MenuItem, TaxClassCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { thumbnailFrom } from "@/lib/console/services/menu-profiles";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatMoney } from "@/lib/console/format";
import { ALLERGENS } from "@/lib/console/allergens";
import { barcodeProblem, detectBarcodeKind } from "@/lib/console/stock-units";
import { TAX_CLASS } from "@/lib/console/labels";
import { EMPTY_LOCALISED, LocalisedField } from "@/components/console/fields";
import { Badge, Button, Callout, Drawer, Field, Input, Select, Tabs, Textarea, Toggle, cx } from "@/components/console/ui";

type Section = "names" | "appearance" | "details" | "dietary";

const LIMITS = { pos: 18, kitchen: 20, receipt: 40, aggregator: 80 } as const;

const PALETTE = ["#0f6f7a", "#b45309", "#be123c", "#7c3aed", "#15803d", "#1d4ed8", "#a16207", "#475569", "#db2777", "#0e7490"];

export const DIETARY_TAGS: { code: string; label: Localised }[] = [
  { code: "vegetarian", label: { en: "Vegetarian", ar: "نباتي" } },
  { code: "vegan", label: { en: "Vegan", ar: "نباتي صرف" } },
  { code: "halal", label: { en: "Halal", ar: "حلال" } },
  { code: "gluten_free", label: { en: "Gluten-free", ar: "خالٍ من الغلوتين" } },
  { code: "dairy_free", label: { en: "Dairy-free", ar: "خالٍ من الألبان" } },
  { code: "spicy", label: { en: "Spicy", ar: "حار" } },
  { code: "kids", label: { en: "Kids", ar: "للأطفال" } },
  { code: "low_calorie", label: { en: "Light", ar: "خفيف" } },
];

interface Draft {
  name: Localised;
  posName: Localised;
  kitchenName: Localised;
  receiptName: Localised;
  aggregatorName: Localised;
  description: Localised;
  image: string | null;
  imageEmoji: string;
  colour: string;
  sortOrder: string;
  taxClass: TaxClassCode;
  revenueAccountCode: string;
  barcodePlu: string;
  allergens: string[];
  dietaryTags: string[];
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
}

function same(a: Localised, b: Localised | null | undefined): boolean {
  return Boolean(b) && a.en === b!.en && a.ar === b!.ar;
}

function draftOf(item: MenuItem, profile: { posName: Localised | null; receiptName: Localised | null; image: string | null } | null): Draft {
  // A surface name equal to the menu name is shown empty — "falls back to the
  // menu name" is the honest reading of it, and it keeps the form short.
  const surface = (value: Localised | null | undefined) =>
    value && !same(item.name, value) ? value : { ...EMPTY_LOCALISED };
  return {
    name: item.name,
    posName: surface(profile?.posName ?? item.posName),
    kitchenName: surface(item.kitchenName),
    receiptName: surface(profile?.receiptName ?? item.receiptName),
    aggregatorName: surface(item.aggregatorName),
    description: item.description ?? { ...EMPTY_LOCALISED },
    image: profile?.image ?? item.imageUrl ?? null,
    imageEmoji: item.imageEmoji,
    colour: item.colour || PALETTE[0]!,
    sortOrder: String(item.sortOrder ?? 0),
    taxClass: item.taxClass,
    revenueAccountCode: item.revenueAccountCode ?? "",
    barcodePlu: item.barcodePlu ?? "",
    allergens: item.allergens,
    dietaryTags: item.dietaryTags ?? [],
    isCombo: item.isCombo,
    isOpenPrice: item.isOpenPrice,
    isWeighed: item.isWeighed,
  };
}

function has(value: Localised): boolean {
  return Boolean(value.en.trim() || value.ar.trim());
}

function longest(value: Localised): number {
  return Math.max(value.en.length, value.ar.length);
}

export function MenuItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const profile = useAsync(() => services.menuProfiles.get(item.id), [item.id]);
  const catalogue = useAsync(
    () => services.catalogue.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as MenuItem[]),
    [],
  );
  if (profile.loading && !profile.data) {
    return (
      <Drawer open onClose={onClose} title={item.name.en}>
        <p className="text-fg-muted text-sm">…</p>
      </Drawer>
    );
  }
  return (
    <EditorForm
      item={item}
      initial={draftOf(item, profile.data)}
      others={(catalogue.data ?? []).filter((row) => row.id !== item.id)}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditorForm({
  item,
  initial,
  others,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  initial: Draft;
  others: MenuItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, locale, fmt } = useI18n();
  const action = useAction();
  const [section, setSection] = useState<Section>("names");
  const [draft, setDraft] = useState<Draft>(initial);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  // What each surface will actually print, fallbacks applied.
  const show = (value: Localised) => (has(value) ? tx(value) : tx(draft.name));
  const price = item.variants[0]?.basePrice;

  const pluKind = draft.barcodePlu.trim() ? detectBarcodeKind(draft.barcodePlu) : null;
  const pluProblem =
    pluKind && /^\d+$/.test(draft.barcodePlu.trim()) && draft.barcodePlu.trim().length >= 8
      ? barcodeProblem(draft.barcodePlu, pluKind)
      : draft.barcodePlu.trim() && !/^[A-Za-z0-9-]{3,32}$/.test(draft.barcodePlu.trim())
        ? "format"
        : null;
  const pluClash = draft.barcodePlu.trim()
    ? others.find((row) => (row.barcodePlu ?? "").trim() === draft.barcodePlu.trim())
    : undefined;

  const problems = useMemo(() => {
    const out: { section: Section; message: string }[] = [];
    if (!has(draft.name)) out.push({ section: "names", message: t("loc.bothEmpty") });
    if (longest(draft.posName) > LIMITS.pos) out.push({ section: "names", message: t("mie.tooLong").replace("{surface}", t("mie.posName")).replace("{n}", String(LIMITS.pos)) });
    if (longest(draft.kitchenName) > LIMITS.kitchen) out.push({ section: "names", message: t("mie.tooLong").replace("{surface}", t("menu.kitchenName")).replace("{n}", String(LIMITS.kitchen)) });
    if (longest(draft.receiptName) > LIMITS.receipt) out.push({ section: "names", message: t("mie.tooLong").replace("{surface}", t("menu.receiptName")).replace("{n}", String(LIMITS.receipt)) });
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.colour)) out.push({ section: "appearance", message: t("mie.badColour") });
    if (!/^-?\d+$/.test(draft.sortOrder.trim())) out.push({ section: "appearance", message: t("mie.badSort") });
    if (pluProblem) out.push({ section: "details", message: t(`inv.barcode.${pluProblem}` as never) });
    if (pluClash) out.push({ section: "details", message: t("mie.pluClash").replace("{item}", tx(pluClash.name)) });
    return out;
  }, [draft, pluProblem, pluClash, t, tx]);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    if (file.size > 8 * 1024 * 1024) {
      setImageError(t("mie.imageTooBig"));
      return;
    }
    try {
      set({ image: await thumbnailFrom(file) });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function save() {
    const orName = (value: Localised) => (has(value) ? value : draft.name);
    await action.run(
      async () => {
        await services.catalogue.items.update(item.id, {
          name: draft.name,
          kitchenName: orName(draft.kitchenName),
          aggregatorName: orName(draft.aggregatorName),
          receiptName: orName(draft.receiptName),
          posName: has(draft.posName) ? draft.posName : null,
          description: draft.description,
          taxClass: draft.taxClass,
          revenueAccountCode: draft.revenueAccountCode.trim() || null,
          barcodePlu: draft.barcodePlu.trim() || null,
          allergens: draft.allergens,
          dietaryTags: draft.dietaryTags,
          sortOrder: Number(draft.sortOrder),
          colour: draft.colour,
          imageEmoji: draft.imageEmoji,
          isCombo: draft.isCombo,
          isOpenPrice: draft.isOpenPrice,
          isWeighed: draft.isWeighed,
        });
        await services.menuProfiles.save({
          itemId: item.id,
          posName: has(draft.posName) ? draft.posName : null,
          receiptName: has(draft.receiptName) ? draft.receiptName : null,
          image: draft.image,
        });
      },
      { onSuccess: () => onSaved(t("mie.saved")) },
    );
  }

  const count = (id: Section) => problems.filter((row) => row.section === id).length || undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mie.title").replace("{item}", tx(item.name))}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Tabs<Section>
          value={section}
          onChange={setSection}
          label={t("mie.sections")}
          options={[
            { value: "names", label: t("mie.names"), count: count("names") },
            { value: "appearance", label: t("mie.appearance"), count: count("appearance") },
            { value: "details", label: t("mie.details"), count: count("details") },
            { value: "dietary", label: t("mie.dietary"), count: count("dietary") },
          ]}
        />

        {problems.length > 0 ? (
          <Callout tone="warn">
            <ul className="list-disc space-y-0.5 ps-4">
              {problems.map((row) => (
                <li key={row.message}>{row.message}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        {section === "names" ? (
          <div className="space-y-4">
            <LocalisedField label={t("mie.menuName")} hint={t("mie.menuNameHint")} value={draft.name} onChange={(name) => set({ name })} required maxLength={120} />
            <LocalisedField label={t("mie.posName")} hint={t("mie.fallbackHint").replace("{n}", String(LIMITS.pos))} value={draft.posName} onChange={(posName) => set({ posName })} maxLength={LIMITS.pos + 10} />
            <LocalisedField label={t("menu.kitchenName")} hint={t("mie.fallbackHint").replace("{n}", String(LIMITS.kitchen))} value={draft.kitchenName} onChange={(kitchenName) => set({ kitchenName })} maxLength={LIMITS.kitchen + 10} />
            <LocalisedField label={t("menu.receiptName")} hint={t("mie.fallbackHint").replace("{n}", String(LIMITS.receipt))} value={draft.receiptName} onChange={(receiptName) => set({ receiptName })} maxLength={LIMITS.receipt + 10} />
            <LocalisedField label={t("mie.aggregatorName")} hint={t("mie.aggregatorHint")} value={draft.aggregatorName} onChange={(aggregatorName) => set({ aggregatorName })} maxLength={LIMITS.aggregator} />
            <LocalisedField label={t("mie.description")} value={draft.description} onChange={(description) => set({ description })} multiline maxLength={400} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Preview label={t("mie.previewPos")}>
                <PosTile name={show(draft.posName)} colour={draft.colour} image={draft.image} emoji={draft.imageEmoji} price={price ? formatMoney(price, fmt) : null} />
              </Preview>
              <Preview label={t("mie.previewKds")}>
                <div className="rounded-lg bg-zinc-900 px-3 py-2 text-lg font-bold tracking-wide text-white uppercase">
                  <span className="me-2 tabular-nums">2</span>
                  {show(draft.kitchenName)}
                </div>
              </Preview>
              <Preview label={t("mie.previewReceipt")}>
                <ReceiptLine name={show(draft.receiptName)} price={price ? formatMoney(price, fmt) : ""} rtl={locale === "ar"} />
              </Preview>
              <Preview label={t("mie.previewAggregator")}>
                <div className="border-line flex gap-2 rounded-lg border bg-white p-2 text-zinc-900">
                  <Thumb image={draft.image} emoji={draft.imageEmoji} colour={draft.colour} size="h-12 w-12" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{show(draft.aggregatorName)}</p>
                    <p className="line-clamp-2 text-[0.68rem] text-zinc-500">{tx(draft.description)}</p>
                  </div>
                </div>
              </Preview>
            </div>
          </div>
        ) : null}

        {section === "appearance" ? (
          <div className="space-y-4">
            <Field label={t("mie.image")} hint={t("mie.imageHint")} error={imageError}>
              <div className="flex items-center gap-3">
                <Thumb image={draft.image} emoji={draft.imageEmoji} colour={draft.colour} size="h-20 w-20" />
                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void pickImage(event.target.files?.[0])}
                  />
                  <Button size="sm" icon={<ImagePlus size={12} />} onClick={() => fileRef.current?.click()}>
                    {draft.image ? t("mie.replaceImage") : t("mie.addImage")}
                  </Button>
                  {draft.image ? (
                    <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => set({ image: null })}>
                      {t("common.remove")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Field>
            <Field label={t("mie.emoji")} hint={t("mie.emojiHint")}>
              <Input value={draft.imageEmoji} maxLength={4} onChange={(event) => set({ imageEmoji: event.target.value })} className="w-20 text-center text-xl" />
            </Field>
            <Field label={t("mie.colour")}>
              <div className="flex flex-wrap items-center gap-1.5">
                {PALETTE.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    aria-label={colour}
                    aria-pressed={draft.colour.toLowerCase() === colour}
                    onClick={() => set({ colour })}
                    className={cx("h-7 w-7 rounded-md border-2", draft.colour.toLowerCase() === colour ? "border-fg" : "border-transparent")}
                    style={{ background: colour }}
                  />
                ))}
                <Input dir="ltr" value={draft.colour} onChange={(event) => set({ colour: event.target.value })} className="w-28 font-mono text-xs" />
              </div>
            </Field>
            <Field label={t("menu.sortOrder")} hint={t("mie.sortHint")}>
              <Input dir="ltr" inputMode="numeric" value={draft.sortOrder} onChange={(event) => set({ sortOrder: event.target.value })} className="w-28 font-mono" />
            </Field>
            <Preview label={t("mie.previewPos")}>
              <PosTile name={show(draft.posName)} colour={draft.colour} image={draft.image} emoji={draft.imageEmoji} price={price ? formatMoney(price, fmt) : null} />
            </Preview>
          </div>
        ) : null}

        {section === "details" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("menu.taxClass")} hint={t("mie.taxHint")}>
                <Select value={draft.taxClass} onChange={(event) => set({ taxClass: event.target.value as TaxClassCode })}>
                  {Object.entries(TAX_CLASS).map(([value, entry]) => (
                    <option key={value} value={value}>
                      {tx(entry.label)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("mie.revenueAccount")} hint={t("mie.revenueAccountHint")}>
                <Input dir="ltr" value={draft.revenueAccountCode} maxLength={40} onChange={(event) => set({ revenueAccountCode: event.target.value })} className="font-mono" />
              </Field>
              <Field label={t("mie.plu")} hint={t("mie.pluHint")}>
                <Input dir="ltr" value={draft.barcodePlu} maxLength={32} onChange={(event) => set({ barcodePlu: event.target.value })} className="font-mono" />
              </Field>
            </div>
            <Toggle checked={draft.isOpenPrice} onChange={(isOpenPrice) => set({ isOpenPrice })} label={t("menu.openPrice")} hint={t("mie.openPriceHint")} />
            <Toggle checked={draft.isWeighed} onChange={(isWeighed) => set({ isWeighed })} label={t("menu.weighed")} hint={t("mie.weighedHint")} />
            <Toggle checked={draft.isCombo} onChange={(isCombo) => set({ isCombo })} label={t("nav.combos")} hint={t("mie.comboHint")} />
          </div>
        ) : null}

        {section === "dietary" ? (
          <div className="space-y-4">
            <Field label={t("menu.allergens")} hint={t("mie.allergensHint")}>
              <ChipSet
                options={ALLERGENS.map((row) => ({ value: row.code, label: tx(row.label) }))}
                value={draft.allergens}
                onChange={(allergens) => set({ allergens })}
                tone="warn"
              />
            </Field>
            <Field label={t("mie.dietaryTags")}>
              <ChipSet
                options={DIETARY_TAGS.map((row) => ({ value: row.code, label: tx(row.label) }))}
                value={draft.dietaryTags}
                onChange={(dietaryTags) => set({ dietaryTags })}
                tone="accent"
              />
            </Field>
            {draft.dietaryTags.includes("vegan") && draft.allergens.some((code) => code === "milk" || code === "egg" || code === "fish" || code === "shellfish") ? (
              <Callout tone="warn">{t("mie.veganClash")}</Callout>
            ) : null}
            {draft.dietaryTags.includes("gluten_free") && draft.allergens.includes("gluten") ? (
              <Callout tone="warn">{t("mie.glutenClash")}</Callout>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-fg-subtle mb-1 text-[0.65rem] tracking-wide uppercase">{label}</p>
      {children}
    </div>
  );
}

function Thumb({ image, emoji, colour, size }: { image: string | null; emoji: string; colour: string; size: string }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" className={cx(size, "rounded-lg object-cover")} />
  ) : (
    <span className={cx(size, "grid place-items-center rounded-lg text-2xl")} style={{ background: `${colour}22` }} aria-hidden>
      {emoji || "🍽️"}
    </span>
  );
}

export function PosTile({
  name,
  colour,
  image,
  emoji,
  price,
}: {
  name: string;
  colour: string;
  image: string | null;
  emoji: string;
  price: string | null;
}) {
  return (
    <div className="border-line bg-raised flex h-28 w-28 flex-col overflow-hidden rounded-xl border" style={{ borderTop: `4px solid ${colour}` }}>
      <div className="flex flex-1 items-center justify-center">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-12 w-12 rounded-md object-cover" />
        ) : (
          <span className="text-2xl" aria-hidden>
            {emoji || "🍽️"}
          </span>
        )}
      </div>
      <div className="px-2 pb-1.5">
        <p className="text-fg line-clamp-2 text-xs leading-tight font-semibold">{name}</p>
        {price ? <p className="text-fg-muted font-mono text-[0.65rem]">{price}</p> : null}
      </div>
    </div>
  );
}

function ReceiptLine({ name, price, rtl }: { name: string; price: string; rtl: boolean }) {
  const width = 40;
  const room = Math.max(0, width - price.length - 1);
  const shown = name.length > room ? `${name.slice(0, Math.max(0, room - 1))}…` : name;
  return (
    <pre
      dir={rtl ? "rtl" : "ltr"}
      className="overflow-x-auto rounded-lg border border-dashed border-zinc-300 bg-white px-2 py-2 font-mono text-[0.7rem] text-zinc-900"
    >
      {`1 ${shown}`.padEnd(room + 2, " ")} {price}
      {"\n"}
      {name.length > room ? <span className="text-red-600">{"^".repeat(Math.min(width, name.length))}</span> : null}
    </pre>
  );
}

function ChipSet({
  options,
  value,
  onChange,
  tone,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  tone: "warn" | "accent";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((row) => row !== option.value) : [...value, option.value])}
            className={cx(
              "rounded-lg border px-2.5 py-1 text-xs transition-colors",
              on
                ? tone === "warn"
                  ? "border-warn bg-warn-soft text-warn font-medium"
                  : "border-accent bg-accent-soft text-accent font-medium"
                : "border-line bg-raised text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small badges for the item drawer: dietary tags with their labels. */
export function DietaryBadges({ tags }: { tags: string[] }) {
  const { tx } = useI18n();
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((code) => (
        <Badge key={code} tone="accent">
          {tx(DIETARY_TAGS.find((row) => row.code === code)?.label ?? { en: code, ar: code })}
        </Badge>
      ))}
    </span>
  );
}
