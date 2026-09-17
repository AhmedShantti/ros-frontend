"use client";

/**
 * The menu side of the POS.
 *
 * Speed is the requirement here (NFR-USA-001): a three-line order in six
 * interactions. That rules out a modal per item, so an item with no required
 * modifier group goes straight onto the order on one tap, and only items
 * that genuinely need a choice open the options sheet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Ban, ImageIcon, Minus, Plus, Search, Star, Type, X } from "lucide-react";
import type {
  Id,
  MenuItem,
  MenuItemVariant,
  ModifierGroup,
  ModifierPriceRule,
  Money,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { withProfile } from "@/lib/console/services/menu-profiles";
import { useAsync } from "@/lib/console/hooks";
import { menuCategories } from "@/lib/console/mock/catalogue";
import { formatMoney, formatNumber } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import {
  matchesSearch,
  modifierGroupsForItem,
  resolveModifierDelta,
  unsatisfiedGroups,
  type ModifierPriceContext,
} from "@/lib/console/live/engine";
import { isOverridden, menuItemsForBranch, remainingSellable } from "@/lib/console/live/reducer";
import { limitFor, soldOn } from "@/lib/console/menu-availability";
import { activeEmployees } from "@/lib/console/mock/workforce";
import {
  FavouritesStrip,
  LookupBar,
  MiscItemSheet,
  OpenPriceSheet,
  PluPad,
  WeighedSheet,
  findByBarcode,
  useBarcodeScanner,
  useFavourites,
} from "@/components/terminal/pos-lookup";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  cx,
} from "@/components/console/ui";

interface Props {
  orderId: Id | null;
  course: number;
  /** FR-POS-004 — the seat new lines go to; null is shared by the table. */
  seat?: number | null;
  onAdded?: () => void;
}

export function PosMenu({ orderId, course, seat = null, onAdded }: Props) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();

  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [chosen, setChosen] = useState<MenuItem | null>(null);
  const [eightySix, setEightySix] = useState<MenuItem | null>(null);

  // FR-POS-011/014/015/016 — the paths to an item that are not a tile tap.
  const [pluOpen, setPluOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [openPriceFor, setOpenPriceFor] = useState<MenuItem | null>(null);
  const [weighing, setWeighing] = useState<{ item: MenuItem; variant: MenuItemVariant } | null>(
    null,
  );
  const [scanState, setScanState] = useState<{ code: string; found: boolean } | null>(null);
  const favourites = useFavourites();

  // FR-POS-022 — a modifier may be free for dine-in and charged for delivery.
  // The rules ride on every add; the reducer resolves them against the
  // context the line is actually priced in, which includes the price list it
  // lands on. Read once per mount: a price rule changes in the console, not
  // between two taps on the same screen.
  const priceRules = useModifierPriceRules();

  // NFR-USA-004 — picture mode, and the item images it shows.
  const [pictures, setPictures] = usePictureMode();
  const profiles = useAsync(() => (pictures ? services.menuProfiles.all() : Promise.resolve([])), [pictures]);
  const imageOf = useMemo(() => {
    const byId = new Map((profiles.data ?? []).map((row) => [row.itemId, row]));
    return (item: MenuItem) => withProfile(item, byId.get(item.id)).imageUrl ?? null;
  }, [profiles.data]);


  const items = useMemo(() => menuItemsForBranch(state.branchId), [state.branchId]);

  /*
    FR-MNU-035 — "only 20 specials today". The limit is authored in the
    console; the till counts today's portions from its own orders, so the
    count drops the moment a line is added, not when the console next looks.
    A limit that cannot be read is treated as no limit rather than blocking
    the menu.
  */
  const dailyLimits = useAsync(
    () => services.menuAvailability.limits.list({ limit: 1000 }).then((page) => page.rows).catch(() => []),
    [state.branchId],
  );
  const soldToday = useMemo(
    () => soldOn(Object.values(state.orders), state.businessDay, state.branchId),
    [state.orders, state.businessDay, state.branchId],
  );
  const limitLeft = useCallback(
    (itemId: string): number | null => {
      const limit = limitFor(dailyLimits.data ?? [], itemId, state.branchId);
      if (!limit || !limit.active) return null;
      return Math.max(0, limit.limit - (soldToday.get(itemId) ?? 0));
    },
    [dailyLimits.data, soldToday, state.branchId],
  );

  /** Every price on this pane is denominated in the branch's own currency. */
  const currency = items[0]?.variants[0]?.basePrice.currency ?? "EGP";

  const categories = useMemo(() => {
    const present = new Set(items.map((i) => i.categoryId));
    return menuCategories.filter((c) => present.has(c.id));
  }, [items]);

  /** NFR-USA-004 — a category is recognised by the picture of its first item. */
  const categoryEmoji = useMemo(() => {
    const map = new Map<Id, string>();
    for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (!map.has(item.categoryId) && item.imageEmoji) map.set(item.categoryId, item.imageEmoji);
    }
    return map;
  }, [items]);

  /** NFR-USA-004 — how many of each item are already on the order, shown as a count on the picture. */
  const onOrder = useMemo(() => {
    const counts = new Map<Id, number>();
    const order = orderId ? state.orders[orderId] : null;
    for (const line of order?.lines ?? []) {
      if (line.state === "voided") continue;
      counts.set(line.menuItemId, (counts.get(line.menuItemId) ?? 0) + line.quantity);
    }
    return counts;
  }, [orderId, state.orders]);

  const visible = useMemo(() => {
    return items
      .filter((i) => categoryId === "all" || i.categoryId === categoryId)
      .filter((i) => matchesSearch(i, term))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [items, categoryId, term]);

  function add(item: MenuItem) {
    if (!orderId) return;

    // FR-POS-015 — the price is decided at the counter, within bounds.
    if (item.isOpenPrice) {
      setOpenPriceFor(item);
      return;
    }

    // FR-POS-014 — sold by weight, so the quantity is not a stepper.
    if (item.isWeighed) {
      setWeighing({ item, variant: item.variants[0]! });
      return;
    }

    const groups = modifierGroupsForItem(item);
    const needsChoice = groups.some((g) => g.required) || item.variants.length > 1;
    if (needsChoice) {
      setChosen(item);
      return;
    }
    dispatch({
      type: "LINE_ADD",
      orderId,
      menuItemId: item.id,
      variantId: item.variants[0]!.id,
      quantity: 1,
      modifierIds: groups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).map((m) => m.id)),
      priceRules,
      course,
      seatNumber: seat ?? null,
      notes: null,
    });
    onAdded?.();
  }


  /**
   * Put a line on the order with an explicit quantity.
   *
   * The tile path always adds one; a weighed item adds 0.42 of something and
   * an open-price item adds however many the guest is buying, so both need a
   * way in that does not go through the stepper.
   */
  const addWithQuantity = useCallback(
    (item: MenuItem, variantId: Id, quantity: number, notes: string | null = null) => {
      if (!orderId) return;
      const groups = modifierGroupsForItem(item);
      dispatch({
        type: "LINE_ADD",
        orderId,
        menuItemId: item.id,
        variantId,
        quantity,
        modifierIds: groups.flatMap((g) =>
          g.modifiers.filter((m) => m.isDefault).map((m) => m.id),
        ),
        priceRules,
        course,
        seatNumber: seat ?? null,
        notes,
      });
      onAdded?.();
    },
    [orderId, dispatch, course, seat, onAdded, priceRules],
  );

  /**
   * FR-POS-011 — a scan resolves straight to a line.
   *
   * A miss is reported rather than swallowed: an unknown barcode usually
   * means the item was never given one, and silence sends the cashier
   * hunting through the menu for something that will not be there either.
   */
  const onScan = useCallback(
    (code: string) => {
      const hit = findByBarcode(items, code);
      setScanState({ code, found: Boolean(hit) });
      window.setTimeout(() => setScanState(null), 2500);
      if (!hit || !orderId) return;
      if (hit.item.isWeighed) {
        setWeighing(hit);
        return;
      }
      addWithQuantity(hit.item, hit.variant.id, 1);
    },
    [items, orderId, addWithQuantity],
  );

  useBarcodeScanner(onScan, Boolean(orderId));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-52 flex-1">
          <Search
            aria-hidden
            size={15}
            className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3"
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("pos.searchItems")}
            aria-label={t("pos.searchItems")}
            className="ps-9"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setTerm("")}
              aria-label={t("common.close")}
              className="text-fg-subtle hover:text-fg absolute top-1/2 -translate-y-1/2 end-2"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <LookupBar
          scanState={scanState}
          onPlu={() => setPluOpen(true)}
          onMisc={() => setMiscOpen(true)}
        />
        {/* NFR-USA-004 — pictures or words, remembered per terminal. */}
        <button
          type="button"
          onClick={() => setPictures(!pictures)}
          aria-pressed={pictures}
          aria-label={pictures ? t("picture.showWords") : t("picture.showPictures")}
          title={pictures ? t("picture.showWords") : t("picture.showPictures")}
          className={cx(
            "inline-flex min-h-12 min-w-12 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
            pictures ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-fg-muted hover:text-fg",
          )}
        >
          {pictures ? <Type size={18} aria-hidden /> : <ImageIcon size={18} aria-hidden />}
          <span className="hidden lg:inline">{pictures ? t("picture.words") : t("picture.pictures")}</span>
        </button>
      </div>

      <FavouritesStrip items={items} favouriteIds={favourites.ids} onPick={add} />

      <div className="border-line flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2">
        <CategoryChip
          active={categoryId === "all"}
          onClick={() => setCategoryId("all")}
          colour="var(--c-accent)"
          pictures={pictures}
          label={t("pos.allCategories")}
          emoji="🍽️"
        >
          {t("pos.allCategories")}
        </CategoryChip>
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            active={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            colour={c.colour}
            pictures={pictures}
            label={tx(c.name)}
            emoji={categoryEmoji.get(c.id) ?? "•"}
          >
            {tx(c.name)}
          </CategoryChip>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <p className="text-fg-subtle p-6 text-center text-sm">{t("pos.noItems")}</p>
        ) : (
          // Column counts are tuned against the space left after the bill
          // column, not against the viewport: at 768px the grid only has about
          // 450px to work with, and three columns there gives 140px tiles that
          // truncate every item name. Two until `lg` keeps them readable.
          <div
            data-coach="menu"
            className={cx(
              "grid gap-2",
              pictures
                ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
            )}
          >
            {visible.map((item) => {
              const off = state.unavailable[item.id];
              // FR-MNU-031 — a manager may have let this one through for the
              // order in hand, which does not lift the 86 for anyone else.
              const cleared = Boolean(off) && isOverridden(state, orderId, item.id);
              const stockLeft = remainingSellable(state, item.variants[0]?.recipeId ?? null);
              const capLeft = limitLeft(item.id);
              // FR-MNU-033 — remaining sellable is the tighter of stock and the day's limit.
              const left = stockLeft === null ? capLeft : capLeft === null ? stockLeft : Math.min(stockLeft, capLeft);
              if (pictures) {
                return (
                  <PictureTile
                    key={item.id}
                    item={item}
                    image={imageOf(item)}
                    count={onOrder.get(item.id) ?? 0}
                    unavailable={Boolean(off) && !cleared}
                    soldOut={left === 0}
                    disabled={!orderId}
                    onPick={() => (off && !cleared ? setEightySix(item) : add(item))}
                    onLongPress={() => setEightySix(item)}
                  />
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!orderId || (Boolean(off) && !cleared) || capLeft === 0}
                  onClick={() => (off && !cleared ? setEightySix(item) : add(item))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEightySix(item);
                  }}
                  className={cx(
                    "border-line bg-raised group relative flex min-h-24 flex-col items-start gap-1 rounded-xl border p-2.5 text-start transition-colors",
                    off
                      ? "opacity-55"
                      : "hover:border-accent hover:bg-accent-soft/40 disabled:opacity-50",
                  )}
                  style={{ borderInlineStartWidth: 3, borderInlineStartColor: item.colour }}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span aria-hidden className="text-xl leading-none">
                      {item.imageEmoji}
                    </span>
                    <span className="text-fg-muted text-xs font-medium tabular-nums">
                      {formatMoney(item.variants[0]!.basePrice, fmt, true)}
                    </span>
                  </span>
                  <span className="text-fg line-clamp-2 text-sm leading-snug font-medium">
                    {tx(item.name)}
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-1">
                    {off ? (
                      <Badge tone="bad">{t("pos.eightySixed")}</Badge>
                    ) : left !== null && left <= 8 ? (
                      <Badge tone={left === 0 ? "bad" : "warn"}>
                        {t("pos.remaining").replace("{n}", formatNumber(left, fmt))}
                      </Badge>
                    ) : item.variants.length > 1 ? (
                      <span className="text-fg-subtle text-[0.68rem]">
                        {item.variants.length} {t("pos.variant").toLowerCase()}
                      </span>
                    ) : null}
                  </span>

                  {/*
                    Pinning is a long-press on a touch till and a click here.
                    It sits inside the tile rather than in a menu because the
                    strip is only useful if building it costs nothing.
                  */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={
                      favourites.has(item.id)
                        ? t("pos.removeFavourite")
                        : t("pos.addFavourite")
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      favourites.toggle(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        favourites.toggle(item.id);
                      }
                    }}
                    className={cx(
                      "absolute top-1.5 end-1.5 rounded p-0.5",
                      favourites.has(item.id)
                        ? "text-warn"
                        : "text-fg-subtle/0 group-hover:text-fg-subtle",
                    )}
                  >
                    <Star size={12} aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {chosen ? (
        <ItemSheet
          item={chosen}
          orderId={orderId}
          course={course}
          seat={seat}
          priceRules={priceRules}
          pictures={pictures}
          image={imageOf(chosen)}
          onClose={() => setChosen(null)}
          onAdded={onAdded}
        />
      ) : null}

      {eightySix ? (
        <EightySixSheet
          item={eightySix}
          orderId={orderId}
          onClose={() => setEightySix(null)}
        />
      ) : null}

      {pluOpen ? (
        <PluPad
          items={items}
          onClose={() => setPluOpen(false)}
          onPick={(item, variant) => {
            if (item.isWeighed) setWeighing({ item, variant });
            else addWithQuantity(item, variant.id, 1);
          }}
        />
      ) : null}

      {miscOpen ? (
        <MiscItemSheet
          currency={currency}
          categories={categories.map((category) => ({
            id: category.id,
            name: tx(category.name),
          }))}
          onClose={() => setMiscOpen(false)}
          onConfirm={({ description, priceMinor, quantity }) => {
            // A misc line has no menu item behind it, so it borrows the
            // first item's identity for the ticket and carries its real
            // description and price in the note and the override.
            const anchorItem = items[0];
            if (!anchorItem || !orderId) return;
            addWithQuantity(
              anchorItem,
              anchorItem.variants[0]!.id,
              quantity,
              `${description} · ${priceMinor / 100}`,
            );
          }}
        />
      ) : null}

      {openPriceFor ? (
        <OpenPriceSheet
          item={openPriceFor}
          currency={currency}
          maxMinor={500_00}
          onClose={() => setOpenPriceFor(null)}
          onConfirm={(priceMinor, quantity) => {
            addWithQuantity(
              openPriceFor,
              openPriceFor.variants[0]!.id,
              quantity,
              `${t("pos.openPrice")}: ${priceMinor / 100}`,
            );
          }}
        />
      ) : null}

      {weighing ? (
        <WeighedSheet
          item={weighing.item}
          variant={weighing.variant}
          currency={currency}
          onClose={() => setWeighing(null)}
          onConfirm={(quantity) =>
            addWithQuantity(weighing.item, weighing.variant.id, quantity)
          }
        />
      ) : null}
    </div>
  );
}

function CategoryChip({
  active,
  colour,
  onClick,
  children,
  pictures = false,
  label,
  emoji,
}: {
  active: boolean;
  colour: string;
  onClick: () => void;
  children: React.ReactNode;
  pictures?: boolean;
  label?: string;
  emoji?: string;
}) {
  // NFR-USA-004 — in picture mode a category is a coloured picture, not a word.
  if (pictures) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cx(
          "grid h-14 w-14 shrink-0 place-items-center rounded-xl border-4 text-2xl transition-transform",
          active ? "scale-105 shadow-md" : "opacity-80",
        )}
        style={{ background: active ? colour : "var(--c-raised, transparent)", borderColor: colour }}
      >
        <span aria-hidden>{emoji}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active ? "text-white" : "border-line bg-raised text-fg-muted hover:text-fg",
      )}
      style={active ? { background: colour, borderColor: colour } : undefined}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Picture mode — NFR-USA-004
// ---------------------------------------------------------------------------

const PICTURE_MODE_KEY = "ros.pos.pictureMode";
const PICTURE_MODE_EVENT = "ros:picture-mode";

/**
 * NFR-USA-004 — whether this terminal shows the menu as pictures.
 *
 * A per-terminal setting rather than a per-user one: the till at the
 * juice counter staffed by people who do not read the configured language is
 * the till that needs it, whoever signs on to it. Read after mount so the
 * server render and the first client paint agree.
 */
export function usePictureMode(): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setOn(window.localStorage.getItem(PICTURE_MODE_KEY) === "1");
      } catch {
        setOn(false);
      }
    };
    read();
    window.addEventListener(PICTURE_MODE_EVENT, read);
    return () => window.removeEventListener(PICTURE_MODE_EVENT, read);
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) window.localStorage.setItem(PICTURE_MODE_KEY, "1");
      else window.localStorage.removeItem(PICTURE_MODE_KEY);
      window.dispatchEvent(new Event(PICTURE_MODE_EVENT));
    } catch {
      // Blocked storage: the mode holds for this tab only.
    }
  }, []);
  return [on, set];
}

function ItemPicture({ item, image, className }: { item: MenuItem; image: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center overflow-hidden rounded-xl leading-none", className)}
      style={{ background: `${item.colour}33` }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL thumbnail; nothing for next/image to optimise
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{item.imageEmoji}</span>
      )}
    </span>
  );
}

/**
 * One item, identifiable without reading: its picture on its category's
 * colour, a count badge that grows with every tap, and a crossed-out overlay
 * when it cannot be sold. The name is still there as the button's accessible
 * name and a small caption, for whoever can read it.
 */
function PictureTile({
  item,
  image,
  count,
  unavailable,
  soldOut,
  disabled,
  onPick,
  onLongPress,
}: {
  item: MenuItem;
  image: string | null;
  count: number;
  unavailable: boolean;
  soldOut: boolean;
  disabled: boolean;
  onPick: () => void;
  onLongPress: () => void;
}) {
  const { tx, t } = useI18n();
  const blocked = unavailable || soldOut;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      onContextMenu={(event) => {
        event.preventDefault();
        onLongPress();
      }}
      aria-label={`${tx(item.name)}${count > 0 ? ` · ${count}` : ""}${blocked ? ` · ${t("pos.eightySixed")}` : ""}`}
      className={cx(
        "relative flex aspect-square min-h-28 flex-col items-stretch overflow-hidden rounded-2xl border-4 p-1.5 transition-transform active:scale-95 disabled:opacity-50",
        blocked ? "border-bad/60" : "hover:scale-[1.02]",
      )}
      style={{ borderColor: blocked ? undefined : item.colour }}
    >
      <ItemPicture item={item} image={image} className="w-full flex-1 text-6xl" />
      <span className="text-fg-muted mt-1 line-clamp-1 text-center text-[0.7rem]">{tx(item.name)}</span>
      {count > 0 ? (
        <span
          aria-hidden
          className="bg-accent text-accent-fg absolute top-1 end-1 grid h-9 min-w-9 place-items-center rounded-full px-1.5 text-lg font-bold tabular-nums shadow"
        >
          {count}
        </span>
      ) : null}
      {blocked ? (
        <span aria-hidden className="bg-black/35 absolute inset-0 grid place-items-center">
          <Ban size={64} strokeWidth={2.5} className="text-bad drop-shadow" />
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modifier prices by context — FR-POS-022
// ---------------------------------------------------------------------------

/**
 * The per-context modifier prices in force, or none.
 *
 * Read once and handed to the reducer on every add. An empty list is the
 * right answer while the read is in flight and if it fails: with no rules
 * every modifier charges its own delta, which is what the till did before
 * this existed, so a service that is slow or down cannot stop anyone selling.
 */
function useModifierPriceRules(): ModifierPriceRule[] {
  const rules = useAsync(() => services.modifierPricing.all(), []);
  return rules.data ?? EMPTY_RULES;
}

/** Stable identity — a fresh `[]` each render would re-run every dependent. */
const EMPTY_RULES: ModifierPriceRule[] = [];

// ---------------------------------------------------------------------------
// Variant + modifier sheet — FR-POS-013, FR-POS-020, FR-POS-021
// ---------------------------------------------------------------------------

const NOTE_CHIPS = [
  { en: "No ice", ar: "بدون ثلج" },
  { en: "Well done", ar: "استواء تام" },
  { en: "Separate packaging", ar: "تغليف منفصل" },
  { en: "Serve last", ar: "يُقدَّم أخيرًا" },
];

function ItemSheet({
  item,
  orderId,
  course,
  seat,
  priceRules,
  pictures = false,
  image = null,
  onClose,
  onAdded,
}: {
  item: MenuItem;
  orderId: Id | null;
  course: number;
  seat: number | null;
  /** FR-POS-022 — so the sheet quotes what the line will be charged. */
  priceRules: ModifierPriceRule[];
  /** NFR-USA-004 — larger, picture-first choices. */
  pictures?: boolean;
  image?: string | null;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();

  const groups = useMemo(() => modifierGroupsForItem(item), [item]);
  const [variantId, setVariantId] = useState(item.variants[0]!.id);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<Id>>(
    () => new Set(groups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).map((m) => m.id))),
  );

  const missing = unsatisfiedGroups(groups, selected);
  const variant = item.variants.find((v) => v.id === variantId)!;

  /*
    FR-POS-022 — the sheet prices a modifier the way the line will.

    The price list is left out of the preview's context, the same way this
    pane already quotes an item's base price rather than its resolved one:
    the list that will price the line is only known once it is on the order.
    Order type and branch — the dimensions the requirement's own example
    turns on — are both exact here.
  */
  const priceContext: ModifierPriceContext = {
    orderType: (orderId ? state.orders[orderId]?.orderType : null) ?? "dine_in",
    branchId: state.branchId,
    priceListId: null,
  };
  const deltaOf = (modifier: { id: Id; priceDelta: Money }) =>
    resolveModifierDelta(modifier, priceRules, priceContext).priceDelta;

  const extra = groups
    .flatMap((g) => g.modifiers)
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + deltaOf(m).amount, 0);

  function toggle(group: ModifierGroup, modifierId: Id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modifierId)) {
        next.delete(modifierId);
        return next;
      }
      // A single-choice group swaps rather than stacks.
      if (group.maxSelections === 1) {
        for (const m of group.modifiers) next.delete(m.id);
      } else {
        const count = group.modifiers.filter((m) => next.has(m.id)).length;
        if (count >= group.maxSelections) return current;
      }
      next.add(modifierId);
      return next;
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={tx(item.name)}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!orderId || missing.length > 0}
            onClick={() => {
              if (!orderId) return;
              dispatch({
                type: "LINE_ADD",
                orderId,
                menuItemId: item.id,
                variantId,
                quantity,
                modifierIds: [...selected],
                priceRules,
                course,
                seatNumber: seat ?? null,
                notes: notes.trim() || null,
              });
              onAdded?.();
              onClose();
            }}
          >
            {t("pos.addToOrder")} ·{" "}
            {formatMoney(
              { amount: (variant.basePrice.amount + extra) * quantity, currency: variant.basePrice.currency },
              fmt,
            )}
          </Button>
        </>
      }
    >
      {missing.length > 0 ? (
        <div className="mb-4">
          <Callout tone="warn" title={t("pos.required")}>
            {missing.map((g) => tx(g.name)).join(" · ")} — FR-POS-020
          </Callout>
        </div>
      ) : null}

      {pictures ? (
        <div className="mb-4 flex items-center gap-3">
          <ItemPicture item={item} image={image} className="h-24 w-24 text-5xl" />
        </div>
      ) : null}

      {item.variants.length > 1 ? (
        <div className="mb-4">
          <Field label={t("pos.variant")}>
            <div className="flex flex-wrap gap-1.5">
              {item.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariantId(v.id)}
                  className={cx(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    v.id === variantId
                      ? "border-accent bg-accent-soft text-accent font-medium"
                      : "border-line bg-raised text-fg-muted hover:text-fg",
                  )}
                >
                  {tx(v.name)}
                  <span className="text-fg-subtle ms-2 text-xs tabular-nums">
                    {formatMoney(v.basePrice, fmt, true)}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>
      ) : null}

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.id}>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-fg text-xs font-semibold">{tx(group.name)}</h3>
              {group.required ? <Badge tone="accent">{t("pos.required")}</Badge> : null}
              <span className="text-fg-subtle text-xs">
                {group.maxSelections === 1
                  ? ""
                  : t("pos.chooseUpTo").replace("{n}", String(group.maxSelections))}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.modifiers.map((m) => {
                const on = selected.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(group, m.id)}
                    aria-pressed={on}
                    className={cx(
                      "rounded-lg border px-3 py-2 text-sm transition-colors",
                      pictures && "inline-flex min-h-14 items-center gap-2 border-2 text-base",
                      on
                        ? "border-accent bg-accent-soft text-accent font-medium"
                        : "border-line bg-raised text-fg-muted hover:text-fg",
                      m.kind === "removal" && on && "border-bad/40 bg-bad-soft text-bad",
                    )}
                  >
                    {pictures ? (
                      // NFR-USA-004 — add, remove and swap are told apart by shape and colour, not by reading.
                      <span
                        aria-hidden
                        className={cx(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-white",
                          m.kind === "removal" ? "bg-bad" : m.kind === "addition" ? "bg-good" : "bg-accent",
                        )}
                      >
                        {m.kind === "removal" ? (
                          <Minus size={20} strokeWidth={3} />
                        ) : m.kind === "addition" ? (
                          <Plus size={20} strokeWidth={3} />
                        ) : (
                          <ArrowLeftRight size={18} strokeWidth={3} />
                        )}
                      </span>
                    ) : (
                      <span aria-hidden className="me-1 font-mono text-xs">
                        {m.kind === "removal" ? "−" : m.kind === "addition" ? "+" : "⇄"}
                      </span>
                    )}
                    {on && pictures ? <span className="sr-only">✓</span> : null}
                    {tx(m.name)}
                    {deltaOf(m).amount !== 0 ? (
                      <span className="text-fg-subtle ms-1.5 text-xs tabular-nums">
                        {deltaOf(m).amount > 0 ? "+" : ""}
                        {formatMoney(deltaOf(m), fmt, true)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-line mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
        <Field label={t("pos.quantity")}>
          <div className="flex items-center gap-2">
            <Button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</Button>
            <span className="text-fg w-10 text-center text-lg font-semibold tabular-nums">
              {quantity}
            </span>
            <Button onClick={() => setQuantity((q) => Math.min(99, q + 1))}>+</Button>
          </div>
        </Field>
        <Field label={t("pos.lineNote")} hint={t("pos.noteChips")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {NOTE_CHIPS.map((chip) => (
              <button
                key={chip.en}
                type="button"
                onClick={() => setNotes(tx(chip))}
                className="border-line text-fg-muted hover:text-fg rounded-full border px-2 py-0.5 text-xs"
              >
                {tx(chip)}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 86 an item — FR-MNU-030
// ---------------------------------------------------------------------------

const EIGHTY_SIX_REASONS = [
  { en: "Out of a key ingredient", ar: "نفاد مكوّن أساسي" },
  { en: "Equipment down", ar: "عطل في المعدات" },
  { en: "Quality below standard", ar: "الجودة دون المعيار" },
  { en: "Sold out for today", ar: "نفدت الكمية اليوم" },
];

function EightySixSheet({
  item,
  orderId,
  onClose,
}: {
  item: MenuItem;
  orderId: Id | null;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const current = state.unavailable[item.id];
  const [reason, setReason] = useState(EIGHTY_SIX_REASONS[0]!.en);
  const [approver, setApprover] = useState("");

  /**
   * FR-MNU-031 — the override needs a named approver, the same way a
   * discount over the threshold does. Anyone who can authorise one can
   * authorise this.
   */
  const managers = useMemo(
    () => activeEmployees.filter((e) => /manager|supervisor|head/i.test(e.position.en)),
    [],
  );
  const cleared = isOverridden(state, orderId, item.id);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.eightySix")} · ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {current ? (
            <>
              {orderId && !cleared ? (
                <Button
                  variant="primary"
                  disabled={!approver}
                  onClick={() => {
                    dispatch({
                      type: "ITEM_86_OVERRIDE",
                      orderId,
                      menuItemId: item.id,
                      approvedBy: approver,
                    });
                    onClose();
                  }}
                >
                  {t("pos.overrideOnce")}
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  dispatch({ type: "ITEM_86", menuItemId: item.id, reason: null });
                  onClose();
                }}
              >
                {t("pos.restore")}
              </Button>
            </>
          ) : (
            <Button
              variant="danger"
              icon={<Ban size={14} />}
              onClick={() => {
                dispatch({ type: "ITEM_86", menuItemId: item.id, reason });
                onClose();
              }}
            >
              {t("pos.eightySix")}
            </Button>
          )}
        </>
      }
    >
      {current ? (
        <div className="space-y-4">
          <Callout tone="bad" title={t("pos.eightySixed")}>
            {current}
          </Callout>

          {cleared ? (
            <Callout tone="good" title={t("pos.overrideActive")}>
              {t("pos.overrideActiveNote")}
            </Callout>
          ) : orderId ? (
            <Field label={t("pos.overrideApprover")} hint={t("pos.overrideNote")}>
              <Select value={approver} onChange={(e) => setApprover(e.target.value)}>
                <option value="">{t("pos.overrideChoose")}</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {tx(m.name)} {tx(m.position)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : (
        <Field label={t("pos.eightySixReason")}>
          <SegmentedControl
            value={reason}
            onChange={setReason}
            options={EIGHTY_SIX_REASONS.map((r) => ({ value: r.en, label: tx(r) }))}
          />
        </Field>
      )}
    </Modal>
  );
}
