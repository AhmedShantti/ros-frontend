"use client";

/**
 * The line table three purchasing documents share.
 *
 * A requisition, a purchase order and a supplier invoice are the same shape:
 * pick an item, say how much, say what it costs, watch a running total. They
 * differ in which columns are editable and what the totals are called, not in
 * structure — so this is one component with switches rather than three
 * near-identical tables that drift apart the first time a tax rule changes.
 *
 * Money is minor units throughout, per ADR-008. Quantities stay decimal
 * strings, because a float kilogram is how 0.3 becomes 0.30000000000000004 in
 * a variance report three screens away.
 */

import { useMemo } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

import type { Id, Localised, Quantity, StockItem, UnitCode } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { MoneyInput, PercentInput, QuantityInput, SearchSelect, type SearchOption } from "@/components/console/fields";
import { Button, Callout, Field, cx } from "@/components/console/ui";

export interface DocumentLine {
  key: string;
  itemId: Id | null;
  itemName: Localised;
  quantity: Quantity;
  /** Minor units. */
  unitPrice: number;
  taxRate: number;
}

let seq = 0;
export const newDocumentLine = (currency: string): DocumentLine => ({
  key: `line_${(seq += 1)}`,
  itemId: null,
  itemName: { en: "", ar: "" },
  quantity: { value: "", unit: "kg" as UnitCode },
  unitPrice: 0,
  taxRate: 0,
});

export function lineNet(line: DocumentLine): number {
  const quantity = Number(line.quantity.value || 0);
  if (!Number.isFinite(quantity)) return 0;
  return Math.round(quantity * line.unitPrice);
}

export function lineTax(line: DocumentLine): number {
  return Math.round(lineNet(line) * (line.taxRate / 100));
}

/**
 * Totals summed from the lines, never computed on the document total.
 *
 * FR-FIN-034 is explicit that tax is computed per line and summed. Doing it
 * the other way round differs by a minor unit or two on most baskets, and
 * that is exactly the discrepancy a fiscal validator rejects.
 */
export function documentTotals(lines: DocumentLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + lineNet(line), 0);
  const taxTotal = lines.reduce((sum, line) => sum + lineTax(line), 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

export function DocumentLineEditor({
  lines,
  onChange,
  items,
  currency,
  showPrice = true,
  showTax = true,
  readOnly,
  emptyHint,
}: {
  lines: DocumentLine[];
  onChange: (next: DocumentLine[]) => void;
  items: StockItem[];
  currency: string;
  /** A requisition asks for goods, not prices. */
  showPrice?: boolean;
  showTax?: boolean;
  readOnly?: boolean;
  emptyHint?: string;
}) {
  const { t, tx, fmt } = useI18n();

  const options = useMemo<SearchOption[]>(
    () =>
      items.map((item) => ({
        value: item.id,
        label: tx(item.name),
        hint: `${item.sku} · ${tx(item.category)}`,
      })),
    [items, tx],
  );

  const itemsById = useMemo(() => {
    const map = new Map<Id, StockItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const totals = documentTotals(lines);

  const duplicates = useMemo(() => {
    const seen = new Map<Id, number>();
    for (const line of lines) {
      if (!line.itemId) continue;
      seen.set(line.itemId, (seen.get(line.itemId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [lines]);

  function patch(key: string, part: Partial<DocumentLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...part } : line)));
  }

  function add() {
    onChange([...lines, newDocumentLine(currency)]);
  }

  function duplicate(key: string) {
    const index = lines.findIndex((line) => line.key === key);
    if (index === -1) return;
    const copy = { ...lines[index]!, key: `line_${(seq += 1)}` };
    const next = [...lines];
    next.splice(index + 1, 0, copy);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <div className="border-line rounded-xl border border-dashed px-6 py-8 text-center">
          <p className="text-fg text-sm font-medium">{t("doc.noLines")}</p>
          {emptyHint ? (
            <p className="text-fg-muted mx-auto mt-1 max-w-sm text-xs leading-relaxed">
              {emptyHint}
            </p>
          ) : null}
          {!readOnly ? (
            <Button size="sm" className="mt-3" icon={<Plus size={12} />} onClick={add}>
              {t("doc.addLine")}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => {
            const isDuplicate = line.itemId ? duplicates.has(line.itemId) : false;
            return (
              <li
                key={line.key}
                className={cx(
                  "border-line rounded-lg border p-3",
                  isDuplicate && "border-warn/60 bg-warn-soft/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="text-fg-subtle mt-2.5 w-5 shrink-0 text-center font-mono text-xs tabular-nums">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-3">
                    <Field
                      label={t("inv.item")}
                      required
                      error={isDuplicate ? t("doc.duplicateItem") : undefined}
                    >
                      <SearchSelect
                        options={options}
                        value={line.itemId}
                        disabled={readOnly}
                        aria-label={t("inv.item")}
                        placeholder={t("entry.chooseItem")}
                        onChange={(itemId) => {
                          if (!itemId) {
                            patch(line.key, { itemId: null });
                            return;
                          }
                          const item = itemsById.get(itemId);
                          patch(line.key, {
                            itemId,
                            itemName: item?.name ?? { en: "", ar: "" },
                            quantity: {
                              ...line.quantity,
                              unit: item?.baseUnit ?? line.quantity.unit,
                            },
                            unitPrice: line.unitPrice || (item?.unitCost?.amount ?? 0),
                          });
                        }}
                      />
                    </Field>

                    <div
                      className={cx(
                        "grid gap-3",
                        showPrice && showTax
                          ? "sm:grid-cols-3"
                          : showPrice
                            ? "sm:grid-cols-2"
                            : "",
                      )}
                    >
                      <Field label={t("common.quantity")} required>
                        <QuantityInput
                          value={line.quantity}
                          disabled={readOnly}
                          onChange={(quantity) => patch(line.key, { quantity })}
                          aria-label={t("common.quantity")}
                        />
                      </Field>

                      {showPrice ? (
                        <Field label={t("doc.unitPrice")}>
                          <MoneyInput
                            value={line.unitPrice}
                            currency={currency as never}
                            disabled={readOnly}
                            onChange={(minor) => patch(line.key, { unitPrice: minor ?? 0 })}
                            aria-label={t("doc.unitPrice")}
                          />
                        </Field>
                      ) : null}

                      {showTax ? (
                        <Field label={t("doc.taxRate")}>
                          <PercentInput
                            value={String(line.taxRate)}
                            disabled={readOnly}
                            onChange={(next) => patch(line.key, { taxRate: Number(next) || 0 })}
                            aria-label={t("doc.taxRate")}
                          />
                        </Field>
                      ) : null}
                    </div>

                    {showPrice ? (
                      <div className="text-fg-muted flex justify-between gap-3 text-xs">
                        <span>{t("doc.lineTotal")}</span>
                        <span className="text-fg font-mono tabular-nums">
                          {formatMoney(money(lineNet(line) + lineTax(line), currency as never), fmt)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {!readOnly ? (
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.duplicate")}
                        icon={<Copy size={13} />}
                        onClick={() => duplicate(line.key)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.delete")}
                        icon={<Trash2 size={13} />}
                        onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && lines.length > 0 ? (
        <Button size="sm" icon={<Plus size={12} />} onClick={add}>
          {t("doc.addLine")}
        </Button>
      ) : null}

      {showPrice && lines.length > 0 ? (
        <dl className="border-line space-y-1 rounded-lg border p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t("doc.subtotal")}</dt>
            <dd className="text-fg font-mono tabular-nums">
              {formatMoney(money(totals.subtotal, currency as never), fmt)}
            </dd>
          </div>
          {showTax ? (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t("doc.tax")}</dt>
              <dd className="text-fg font-mono tabular-nums">
                {formatMoney(money(totals.taxTotal, currency as never), fmt)}
              </dd>
            </div>
          ) : null}
          <div className="border-line flex justify-between gap-3 border-t pt-1">
            <dt className="text-fg font-semibold">{t("doc.total")}</dt>
            <dd className="text-fg font-mono font-semibold tabular-nums">
              {formatMoney(money(totals.total, currency as never), fmt)}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
