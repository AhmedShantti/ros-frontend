"use client";

/**
 * The menu side of the POS.
 *
 * Speed is the requirement here (NFR-USA-001): a three-line order in six
 * interactions. That rules out a modal per item, so an item with no required
 * modifier group goes straight onto the order on one tap, and only items
 * that genuinely need a choice open the options sheet.
 */

import { useMemo, useState } from "react";
import { Ban, Search, X } from "lucide-react";
import type { Id, MenuItem, ModifierGroup } from "@/lib/console/types";
import { menuCategories } from "@/lib/console/mock/catalogue";
import { formatMoney, formatNumber } from "@/lib/console/format";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import {
  matchesSearch,
  modifierGroupsForItem,
  unsatisfiedGroups,
} from "@/lib/console/live/engine";
import { menuItemsForBranch, remainingSellable } from "@/lib/console/live/reducer";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  SegmentedControl,
  cx,
} from "@/components/console/ui";

interface Props {
  orderId: Id | null;
  course: number;
  onAdded?: () => void;
}

export function PosMenu({ orderId, course, onAdded }: Props) {
  const { t, tx, fmt } = useI18n();
  const { state, dispatch } = useLive();

  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [chosen, setChosen] = useState<MenuItem | null>(null);
  const [eightySix, setEightySix] = useState<MenuItem | null>(null);

  const items = useMemo(() => menuItemsForBranch(state.branchId), [state.branchId]);

  const categories = useMemo(() => {
    const present = new Set(items.map((i) => i.categoryId));
    return menuCategories.filter((c) => present.has(c.id));
  }, [items]);

  const visible = useMemo(() => {
    return items
      .filter((i) => categoryId === "all" || i.categoryId === categoryId)
      .filter((i) => matchesSearch(i, term))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [items, categoryId, term]);

  function add(item: MenuItem) {
    if (!orderId) return;
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
      course,
      seatNumber: null,
      notes: null,
    });
    onAdded?.();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        <span className="text-fg-subtle hidden text-xs lg:block">{t("pos.searchNote")}</span>
      </div>

      <div className="border-line flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2">
        <CategoryChip
          active={categoryId === "all"}
          onClick={() => setCategoryId("all")}
          colour="var(--c-accent)"
        >
          {t("pos.allCategories")}
        </CategoryChip>
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            active={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            colour={c.colour}
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
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visible.map((item) => {
              const off = state.unavailable[item.id];
              const left = remainingSellable(state, item.variants[0]?.recipeId ?? null);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!orderId || Boolean(off)}
                  onClick={() => add(item)}
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
          onClose={() => setChosen(null)}
          onAdded={onAdded}
        />
      ) : null}

      {eightySix ? (
        <EightySixSheet item={eightySix} onClose={() => setEightySix(null)} />
      ) : null}
    </div>
  );
}

function CategoryChip({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
  onClose,
  onAdded,
}: {
  item: MenuItem;
  orderId: Id | null;
  course: number;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { dispatch } = useLive();

  const groups = useMemo(() => modifierGroupsForItem(item), [item]);
  const [variantId, setVariantId] = useState(item.variants[0]!.id);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<Id>>(
    () => new Set(groups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).map((m) => m.id))),
  );

  const missing = unsatisfiedGroups(groups, selected);
  const variant = item.variants.find((v) => v.id === variantId)!;

  const extra = groups
    .flatMap((g) => g.modifiers)
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.priceDelta.amount, 0);

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
                course,
                seatNumber: null,
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
                    className={cx(
                      "rounded-lg border px-3 py-2 text-sm transition-colors",
                      on
                        ? "border-accent bg-accent-soft text-accent font-medium"
                        : "border-line bg-raised text-fg-muted hover:text-fg",
                      m.kind === "removal" && on && "border-bad/40 bg-bad-soft text-bad",
                    )}
                  >
                    <span aria-hidden className="me-1 font-mono text-xs">
                      {m.kind === "removal" ? "−" : m.kind === "addition" ? "+" : "⇄"}
                    </span>
                    {tx(m.name)}
                    {m.priceDelta.amount !== 0 ? (
                      <span className="text-fg-subtle ms-1.5 text-xs tabular-nums">
                        {m.priceDelta.amount > 0 ? "+" : ""}
                        {formatMoney(m.priceDelta, fmt, true)}
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

function EightySixSheet({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const { t, tx } = useI18n();
  const { state, dispatch } = useLive();
  const current = state.unavailable[item.id];
  const [reason, setReason] = useState(EIGHTY_SIX_REASONS[0]!.en);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("pos.eightySix")} · ${tx(item.name)}`}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {current ? (
            <Button
              variant="primary"
              onClick={() => {
                dispatch({ type: "ITEM_86", menuItemId: item.id, reason: null });
                onClose();
              }}
            >
              {t("pos.restore")}
            </Button>
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
        <Callout tone="bad" title={t("pos.eightySixed")}>
          {current}
        </Callout>
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
