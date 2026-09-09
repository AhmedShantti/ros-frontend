"use client";

/**
 * The four ways to reach an item that are not tapping a tile —
 * FR-POS-011, FR-POS-014, FR-POS-015, FR-POS-016.
 *
 * The tile grid is the demo path. In a real service the fast paths are a
 * scanner, a PLU code and a favourites strip, and the two awkward paths are
 * an item whose price is decided at the counter and an item that is not on
 * the menu at all. All five live here so the menu pane stays about browsing.
 *
 * ## Why the scanner is a keystroke listener
 *
 * Retail barcode scanners are keyboard devices: they type the code far
 * faster than a person can and finish with Enter. So detection is by
 * *timing*, not by hardware — anything arriving faster than ~35ms per
 * character in an unbroken run ending in Enter is a scan, and anything
 * slower is a person typing. That means it works with any scanner, needs no
 * driver, and never fights the search box for focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Delete, Scale, Search, Star, Tag } from "lucide-react";

import type { Id, MenuItem, MenuItemVariant, TaxClassCode } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, minorFromInput, money } from "@/lib/console/format";
import { MoneyInput } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  Select,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Barcode — FR-POS-011
// ---------------------------------------------------------------------------

/** Characters arriving faster than this are a machine, not a person. */
const SCAN_MAX_GAP_MS = 35;
const SCAN_MIN_LENGTH = 4;

/**
 * Listen for a barcode anywhere on the page.
 *
 * Deliberately document-level and deliberately not focus-stealing: a cashier
 * mid-way through typing a note should be able to scan without the code
 * landing in the note, and a scan should work whether or not anything is
 * focused.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef("");
  const lastAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (event: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastAt.current;
      lastAt.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length >= SCAN_MIN_LENGTH) {
          // Only swallow the Enter when we are confident this was a scan;
          // otherwise a form submit two components up stops working.
          event.preventDefault();
          onScan(code);
        }
        return;
      }

      if (event.key.length !== 1) return;

      // A slow keystroke restarts the buffer: that is a human typing.
      if (gap > SCAN_MAX_GAP_MS) buffer.current = "";
      buffer.current += event.key;
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onScan, enabled]);
}

/** Resolve a scanned code to an item and the variant that carries it. */
export function findByBarcode(
  items: MenuItem[],
  code: string,
): { item: MenuItem; variant: MenuItemVariant } | null {
  const needle = code.trim();
  for (const item of items) {
    for (const variant of item.variants) {
      if (variant.barcode && variant.barcode === needle) return { item, variant };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PLU pad — FR-POS-011
// ---------------------------------------------------------------------------

/**
 * A numeric pad that resolves a short code to an item.
 *
 * PLU codes exist because reaching a specific item through a menu tree
 * during a rush is slower than typing four digits, and because greengrocers
 * have used them for forty years and staff already know them.
 */
export function PluPad({
  items,
  onPick,
  onClose,
}: {
  items: MenuItem[];
  onPick: (item: MenuItem, variant: MenuItemVariant) => void;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [code, setCode] = useState("");

  /** The PLU is the numeric tail of the barcode, or the item's own code. */
  const matches = useMemo(() => {
    if (!code) return [];
    return items
      .flatMap((item) =>
        item.variants.map((variant) => ({ item, variant })),
      )
      .filter(({ variant }) => (variant.barcode ?? "").endsWith(code))
      .slice(0, 6);
  }, [items, code]);

  const exact = matches.length === 1 ? matches[0] : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.pluTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!exact}
            onClick={() => {
              if (exact) {
                onPick(exact.item, exact.variant);
                onClose();
              }
            }}
          >
            {t("pos.addToOrder")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("pos.pluHint")}</Callout>

        <div
          className="border-line bg-sunken rounded-lg border px-4 py-3 text-center font-mono text-2xl tabular-nums"
          aria-live="polite"
        >
          {code || "—"}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, index) =>
            key === "" ? (
              <span key={`gap_${index}`} />
            ) : (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setCode((current) =>
                    key === "⌫" ? current.slice(0, -1) : (current + key).slice(0, 8),
                  )
                }
                aria-label={key === "⌫" ? t("pos.backspace") : key}
                // NFR-USA-002 — 48dp minimum with real separation.
                className="border-line bg-raised text-fg hover:bg-sunken flex h-14 items-center justify-center rounded-xl border text-xl font-medium tabular-nums"
              >
                {key === "⌫" ? <Delete size={18} aria-hidden /> : key}
              </button>
            ),
          )}
        </div>

        {code.length > 0 ? (
          matches.length === 0 ? (
            <Callout tone="warn">{t("pos.pluNoMatch")}</Callout>
          ) : (
            <ul className="border-line divide-line divide-y rounded-lg border">
              {matches.map(({ item, variant }) => (
                <li key={variant.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(item, variant);
                      onClose();
                    }}
                    className="hover:bg-sunken flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start"
                  >
                    <span className="min-w-0">
                      <span className="text-fg block truncate text-sm">{tx(item.name)}</span>
                      <span className="text-fg-subtle block font-mono text-xs" dir="ltr">
                        {variant.barcode}
                      </span>
                    </span>
                    <span className="text-fg-muted shrink-0 font-mono text-sm tabular-nums">
                      {formatMoney(variant.basePrice, fmt, true)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Favourites / quick keys — FR-POS-011
// ---------------------------------------------------------------------------

const FAVOURITES_KEY = "ros.pos.favourites";

/**
 * The handful of items that make up most of the trade.
 *
 * Stored per browser rather than per tenant because a favourites strip is a
 * property of the till in front of you — the counter terminal and the
 * drive-through window sell different things.
 */
export function useFavourites(): {
  ids: Id[];
  toggle: (id: Id) => void;
  has: (id: Id) => boolean;
} {
  const [ids, setIds] = useState<Id[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVOURITES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setIds(parsed as Id[]);
    } catch {
      // Storage unavailable; the strip simply starts empty.
    }
  }, []);

  const toggle = useCallback((id: Id) => {
    setIds((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id].slice(0, 12);
      try {
        window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      } catch {
        // Not persisting is survivable; losing the tap is not.
      }
      return next;
    });
  }, []);

  const has = useCallback((id: Id) => ids.includes(id), [ids]);

  return { ids, toggle, has };
}

export function FavouritesStrip({
  items,
  favouriteIds,
  onPick,
}: {
  items: MenuItem[];
  favouriteIds: Id[];
  onPick: (item: MenuItem) => void;
}) {
  const { t, tx, fmt } = useI18n();

  const favourites = favouriteIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is MenuItem => Boolean(item));

  if (favourites.length === 0) return null;

  return (
    <div className="border-line flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 py-2">
      <Star size={13} className="text-warn shrink-0" aria-hidden />
      <span className="text-fg-subtle shrink-0 text-[0.68rem] font-semibold tracking-wide uppercase">
        {t("pos.favourites")}
      </span>
      {favourites.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item)}
          className="border-line bg-raised hover:border-accent flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{ borderInlineStartWidth: 3, borderInlineStartColor: item.colour }}
        >
          <span aria-hidden>{item.imageEmoji}</span>
          <span className="text-fg text-xs font-medium">{tx(item.name)}</span>
          <span className="text-fg-subtle font-mono text-[0.65rem] tabular-nums">
            {formatMoney(item.variants[0]!.basePrice, fmt, true)}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open price — FR-POS-015
// ---------------------------------------------------------------------------

/**
 * An item whose price is decided at the counter, bounded and permission-gated.
 *
 * The bounds are the control. An open-price item with no ceiling is a way to
 * ring up any amount at all, and the audit trail afterwards says only that
 * somebody sold "Miscellaneous" for 4,000.
 */
export function OpenPriceSheet({
  item,
  currency,
  minMinor = 0,
  maxMinor,
  onConfirm,
  onClose,
}: {
  item: MenuItem;
  currency: string;
  minMinor?: number;
  maxMinor?: number;
  onConfirm: (priceMinor: number, quantity: number) => void;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [price, setPrice] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  const belowMin = price !== null && price < minMinor;
  const aboveMax = price !== null && maxMinor !== undefined && price > maxMinor;
  const valid = price !== null && price > 0 && !belowMin && !aboveMax;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.openPrice")} · ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (valid) {
                onConfirm(price, quantity);
                onClose();
              }
            }}
          >
            {t("pos.addToOrder")} ·{" "}
            {formatMoney(money((price ?? 0) * quantity, currency as never), fmt)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="warn" title={t("pos.openPriceTitle")}>
          {t("pos.openPriceBody")}
        </Callout>

        <Field
          label={t("pos.priceEach")}
          hint={
            maxMinor !== undefined
              ? t("pos.priceBounds")
                  .replace("{min}", formatMoney(money(minMinor, currency as never), fmt))
                  .replace("{max}", formatMoney(money(maxMinor, currency as never), fmt))
              : undefined
          }
          required
          error={
            belowMin
              ? t("pos.priceTooLow")
              : aboveMax
                ? t("pos.priceTooHigh")
                : undefined
          }
        >
          <MoneyInput
            value={price}
            currency={currency as never}
            onChange={setPrice}
            autoFocus
            aria-label={t("pos.priceEach")}
          />
        </Field>

        <Field label={t("pos.quantity")}>
          <div className="flex items-center gap-2">
            <Button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</Button>
            <span className="text-fg w-10 text-center text-lg font-semibold tabular-nums">
              {quantity}
            </span>
            <Button onClick={() => setQuantity((q) => Math.min(99, q + 1))}>+</Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Miscellaneous item — FR-POS-016
// ---------------------------------------------------------------------------

const TAX_CLASSES: TaxClassCode[] = ["standard", "reduced", "zero", "exempt"];

/**
 * Something that is not on the menu.
 *
 * It still has to land in a revenue category and a tax class, because a sale
 * with neither is a sale the tax return cannot account for and the P&L
 * cannot attribute.
 */
export function MiscItemSheet({
  currency,
  categories,
  onConfirm,
  onClose,
}: {
  currency: string;
  categories: { id: Id; name: string }[];
  onConfirm: (input: {
    description: string;
    priceMinor: number;
    quantity: number;
    categoryId: Id;
    taxClass: TaxClassCode;
  }) => void;
  onClose: () => void;
}) {
  const { t, fmt } = useI18n();
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [taxClass, setTaxClass] = useState<TaxClassCode>("standard");

  const valid = description.trim().length > 0 && price !== null && price > 0 && Boolean(categoryId);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.miscTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onConfirm({
                description: description.trim(),
                priceMinor: price!,
                quantity,
                categoryId,
                taxClass,
              });
              onClose();
            }}
          >
            {t("pos.addToOrder")} ·{" "}
            {formatMoney(money((price ?? 0) * quantity, currency as never), fmt)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("pos.miscBody")}</Callout>

        <Field label={t("pos.miscDescription")} required>
          <Input
            data-autofocus
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("pos.miscPlaceholder")}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pos.priceEach")} required>
            <MoneyInput
              value={price}
              currency={currency as never}
              onChange={setPrice}
              aria-label={t("pos.priceEach")}
            />
          </Field>
          <Field label={t("pos.quantity")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={String(quantity)}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
              className="text-end font-mono tabular-nums"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pos.revenueCategory")} hint={t("pos.revenueCategoryHint")} required>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pos.taxClass")} hint={t("pos.taxClassHint")}>
            <Select
              value={taxClass}
              onChange={(event) => setTaxClass(event.target.value as TaxClassCode)}
            >
              {TAX_CLASSES.map((code) => (
                <option key={code} value={code}>
                  {t(`onb.tax${code[0]!.toUpperCase()}${code.slice(1)}` as never)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Weighed item — FR-POS-014
// ---------------------------------------------------------------------------

/**
 * A fractional quantity, entered or read from a scale.
 *
 * The scale button is present and honest about its state: when nothing is
 * connected it says so rather than pretending to read zero, because a
 * silently-zero scale sells a kilogram of saffron for nothing.
 */
export function WeighedSheet({
  item,
  variant,
  currency,
  onConfirm,
  onClose,
}: {
  item: MenuItem;
  variant: MenuItemVariant;
  currency: string;
  onConfirm: (quantity: number) => void;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [weight, setWeight] = useState("");
  const [scaleState, setScaleState] = useState<"idle" | "reading" | "unavailable">("idle");

  const parsed = Number(weight);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const total = valid ? Math.round(parsed * variant.basePrice.amount) : 0;

  function readScale() {
    setScaleState("reading");
    // No scale is bound to the browser, and saying so is the honest answer.
    // A fabricated reading here would be a fabricated sale.
    window.setTimeout(() => setScaleState("unavailable"), 700);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.weighTitle")} · ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (valid) {
                onConfirm(parsed);
                onClose();
              }
            }}
          >
            {t("pos.addToOrder")} · {formatMoney(money(total, currency as never), fmt)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t("pos.weight")}
          hint={t("pos.pricePerUnit").replace(
            "{price}",
            formatMoney(variant.basePrice, fmt),
          )}
          required
        >
          <div className="flex gap-2">
            <Input
              data-autofocus
              dir="ltr"
              inputMode="decimal"
              value={weight}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "" || /^\d*\.?\d*$/.test(next)) setWeight(next);
              }}
              className="text-end font-mono text-xl tabular-nums"
            />
            <Button icon={<Scale size={14} />} onClick={readScale} loading={scaleState === "reading"}>
              {t("pos.readScale")}
            </Button>
          </div>
        </Field>

        {scaleState === "unavailable" ? (
          <Callout tone="warn">{t("pos.noScale")}</Callout>
        ) : null}

        <div className="border-line rounded-lg border p-3 text-center">
          <p className="text-fg-muted text-xs">{t("pos.lineTotal")}</p>
          <p className="text-fg mt-1 font-mono text-2xl tabular-nums">
            {formatMoney(money(total, currency as never), fmt)}
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The toolbar that hosts all of it
// ---------------------------------------------------------------------------

export function LookupBar({
  onPlu,
  onMisc,
  scanState,
}: {
  onPlu: () => void;
  onMisc: () => void;
  /** Feedback from the last scan, so a miss is visible. */
  scanState: { code: string; found: boolean } | null;
}) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" variant="ghost" icon={<Tag size={13} />} onClick={onPlu}>
        {t("pos.plu")}
      </Button>
      <Button size="sm" variant="ghost" icon={<Search size={13} />} onClick={onMisc}>
        {t("pos.misc")}
      </Button>
      <span
        aria-live="polite"
        className={cx(
          "flex items-center gap-1 text-[0.68rem]",
          scanState ? (scanState.found ? "text-good" : "text-bad") : "text-fg-subtle",
        )}
      >
        <Barcode size={13} aria-hidden />
        {scanState
          ? scanState.found
            ? t("pos.scanned")
            : t("pos.scanUnknown").replace("{code}", scanState.code)
          : t("pos.scanReady")}
      </span>
    </div>
  );
}
