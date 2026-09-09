"use client";

/**
 * Recording stock that left without being sold.
 *
 * Two documents, one shape, because the operator's mental model is the same
 * either way — "this much of that, gone, for this reason":
 *
 *   - **Waste** (FR-INV-055 … FR-INV-059). Recordable from anywhere: a stock
 *     screen, the kitchen, the expiry worklist, a POS void. The SRS is
 *     explicit that if it is not capturable at the moment it happens, it
 *     never gets recorded at all — so this drawer is deliberately small
 *     enough to fill in with one hand during service.
 *   - **Manual adjustment** (FR-INV-035). The single most sensitive record
 *     in inventory: the one way a balance can be made to agree with a count
 *     without anything physical happening. It gets a required justification
 *     and, above the threshold, an approval rather than a post.
 *
 * The value preview matters more than it looks. "12 kg" is abstract; "12 kg,
 * 2,760 EGP" is the number that makes someone check the figure before
 * posting it, and the same number is what the approval threshold is measured
 * against.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Camera, X } from "lucide-react";

import type { Id, Quantity, StockItem, StockLocation, UnitCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ReasonCode } from "@/lib/console/services/types";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { QuantityInput, SearchSelect, type SearchOption } from "@/components/console/fields";
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

export type EntryKind = "waste" | "adjustment";

/** Above this value the entry needs a manager rather than a post button. */
const APPROVAL_THRESHOLD_MINOR = 50_000;

/**
 * FR-INV-059 — reason categories that are consumption rather than loss.
 *
 * A staff meal and a burnt steak both leave stock, and reporting them in one
 * number inflates the waste percentage with legitimate consumption until
 * nobody trusts it. Keyed on the reason's *category* rather than its code so
 * a tenant adding "Influencer sample" under `policy` is classified correctly
 * without anyone editing this list.
 */
const CONTROLLED_CATEGORIES = new Set(["policy"]);

/** Reasons that only make sense on a ledger correction, not on waste. */
const ADJUSTMENT_ONLY = new Set(["adjustment", "discrepancy"]);

export interface InventoryEntryDrawerProps {
  kind: EntryKind;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Pre-fill, when opened from a batch row or a POS void. */
  initial?: {
    itemId?: Id;
    locationId?: Id;
    quantity?: Quantity;
    reasonCode?: string;
    notes?: string;
  };
}

export function InventoryEntryDrawer({
  kind,
  open,
  onClose,
  onSaved,
  initial,
}: InventoryEntryDrawerProps) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const action = useAction();

  const items = useAsync(
    () => services.inventory.items.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  const locations = useAsync<StockLocation[]>(
    () => services.organisation.locations().catch(() => []),
    [],
  );
  const reasons = useAsync<ReasonCode[]>(
    () => services.inventory.reasonCodes().catch(() => []),
    [],
  );

  const [itemId, setItemId] = useState<Id | null>(initial?.itemId ?? null);
  const [locationId, setLocationId] = useState<Id | null>(initial?.locationId ?? null);
  const [quantity, setQuantity] = useState<Quantity>(
    initial?.quantity ?? { value: "", unit: "kg" as UnitCode },
  );
  /** Adjustments can go either way; waste only ever leaves. */
  const [direction, setDirection] = useState<"decrease" | "increase">("decrease");
  const [reasonCode, setReasonCode] = useState(initial?.reasonCode ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [photoName, setPhotoName] = useState<string | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<Id, StockItem>();
    for (const row of items.data ?? []) map.set(row.id, row);
    return map;
  }, [items.data]);

  const itemOptions = useMemo<SearchOption[]>(
    () =>
      (items.data ?? []).map((item) => ({
        value: item.id,
        label: tx(item.name),
        hint: `${item.sku} · ${tx(item.category)}`,
      })),
    [items.data, tx],
  );

  const item = itemId ? itemsById.get(itemId) : undefined;
  const currency = item?.unitCost?.currency ?? "EGP";
  const unitCost = item?.unitCost?.amount ?? 0;
  const parsedQuantity = Number(quantity.value || 0);
  const valueMinor = Number.isFinite(parsedQuantity)
    ? Math.round(Math.abs(parsedQuantity) * unitCost)
    : 0;

  const selectedReason = (reasons.data ?? []).find((row) => row.code === reasonCode);
  const isTrueWaste =
    kind === "waste" && !CONTROLLED_CATEGORIES.has(selectedReason?.category ?? "");
  const needsApproval = valueMinor > APPROVAL_THRESHOLD_MINOR;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!itemId) list.push(t("entry.needItem"));
    if (!locationId) list.push(t("entry.needLocation"));
    if (!quantity.value || parsedQuantity <= 0) list.push(t("entry.needQuantity"));
    if (!reasonCode) list.push(t("entry.needReason"));
    if (kind === "adjustment" && notes.trim().length < 8) list.push(t("entry.needJustification"));
    return list;
  }, [itemId, locationId, quantity.value, parsedQuantity, reasonCode, kind, notes, t]);

  function reset() {
    setItemId(null);
    setQuantity({ value: "", unit: "kg" as UnitCode });
    setReasonCode("");
    setNotes("");
    setPhotoName(null);
    setDirection("decrease");
  }

  async function submit() {
    if (problems.length > 0) return;

    await action.run(
      async () => {
        const signed =
          kind === "adjustment" && direction === "increase"
            ? quantity.value
            : `-${quantity.value}`;

        if (kind === "waste") {
          await services.inventory.waste.create({
            locationId: locationId!,
            itemId: itemId!,
            quantity,
            reasonCode,
            isTrueWaste,
            notes: notes.trim() || null,
            value: money(valueMinor, currency),
          });
        } else {
          await services.inventory.adjustments.create({
            locationId: locationId!,
            itemId: itemId!,
            quantity: { value: signed, unit: quantity.unit },
            reasonCode,
            notes: notes.trim() || null,
            value: money(valueMinor, currency),
          });
        }
      },
      {
        onSuccess: () => {
          onSaved(
            needsApproval
              ? t("entry.submittedForApproval")
              : kind === "waste"
                ? t("entry.wasteRecorded")
                : t("entry.adjustmentPosted"),
          );
          reset();
          onClose();
        },
      },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={kind === "waste" ? t("entry.recordWaste") : t("entry.newAdjustment")}
      subtitle={kind === "waste" ? "FR-INV-055" : "FR-INV-035"}
      footer={
        <div className="flex gap-2">
          <Button
            variant={needsApproval ? "primary" : kind === "waste" ? "danger" : "primary"}
            loading={action.pending}
            disabled={problems.length > 0}
            onClick={() => void submit()}
          >
            {needsApproval
              ? t("entry.submitForApproval")
              : kind === "waste"
                ? t("entry.postWaste")
                : t("entry.postAdjustment")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {kind === "adjustment" ? (
          <Callout tone="warn" icon={<AlertTriangle size={14} />} title={t("entry.adjustmentWhyTitle")}>
            {t("entry.adjustmentWhyBody")}
          </Callout>
        ) : null}

        <Field label={t("inv.item")} required>
          <SearchSelect
            options={itemOptions}
            value={itemId}
            onChange={setItemId}
            aria-label={t("inv.item")}
            placeholder={t("entry.chooseItem")}
            emptyLabel={items.loading ? t("common.loading") : t("common.noResults")}
          />
        </Field>

        <Field label={t("common.location")} required>
          <Select
            value={locationId ?? ""}
            onChange={(event) => setLocationId(event.target.value || null)}
          >
            <option value="">{t("entry.chooseLocation")}</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {tx(location.name)}
              </option>
            ))}
          </Select>
        </Field>

        {kind === "adjustment" ? (
          <Field label={t("entry.direction")} hint={t("entry.directionHint")}>
            <div className="flex gap-1.5">
              {(["decrease", "increase"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={direction === option}
                  onClick={() => setDirection(option)}
                  className={cx(
                    "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                    direction === option
                      ? option === "decrease"
                        ? "border-bad bg-bad-soft text-bad font-medium"
                        : "border-good bg-good/10 text-good font-medium"
                      : "border-line bg-raised text-fg-muted hover:text-fg",
                  )}
                >
                  {option === "decrease" ? t("entry.decrease") : t("entry.increase")}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <Field label={t("common.quantity")} required>
          <QuantityInput
            value={quantity}
            onChange={setQuantity}
            aria-label={t("common.quantity")}
            units={item ? [item.baseUnit, ...(item.baseUnit === "kg" ? (["g"] as UnitCode[]) : [])] : undefined}
          />
        </Field>

        <Field
          label={t("entry.reason")}
          hint={kind === "waste" ? t("entry.reasonWasteHint") : t("entry.reasonAdjustmentHint")}
          required
        >
          <Select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
            <option value="">{t("entry.chooseReason")}</option>
            {(reasons.data ?? [])
              .filter((reason) =>
                kind === "waste"
                  ? !ADJUSTMENT_ONLY.has(reason.category)
                  : ADJUSTMENT_ONLY.has(reason.category) || reason.category === "control",
              )
              .map((reason) => (
                <option key={reason.id} value={reason.code}>
                  {tx(reason.label)}
                </option>
              ))}
          </Select>
        </Field>

        {kind === "waste" && reasonCode ? (
          <div className="flex items-center gap-2">
            <Badge tone={isTrueWaste ? "bad" : "muted"}>
              {isTrueWaste ? t("entry.trueWaste") : t("entry.controlledConsumption")}
            </Badge>
            <span className="text-fg-subtle text-xs">
              {isTrueWaste ? t("entry.trueWasteHint") : t("entry.controlledHint")}
            </span>
          </div>
        ) : null}

        <Field
          label={kind === "adjustment" ? t("entry.justification") : t("common.notes")}
          hint={kind === "adjustment" ? t("entry.justificationHint") : undefined}
          required={kind === "adjustment"}
          error={
            kind === "adjustment" && notes.length > 0 && notes.trim().length < 8
              ? t("entry.justificationTooShort")
              : undefined
          }
        >
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        {kind === "waste" ? (
          <Field label={t("entry.photo")} hint={t("entry.photoHint")}>
            {photoName ? (
              <div className="border-line flex items-center gap-2 rounded-lg border px-3 py-2">
                <Camera size={14} className="text-fg-subtle shrink-0" aria-hidden />
                <span className="text-fg min-w-0 flex-1 truncate text-xs">{photoName}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.clear")}
                  icon={<X size={12} />}
                  onClick={() => setPhotoName(null)}
                />
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label={t("entry.photo")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setPhotoName(file ? file.name : null);
                }}
              />
            )}
          </Field>
        ) : null}

        {/* -- What this costs -------------------------------------------- */}
        <DescList>
          <DescRow label={t("entry.unitCost")} mono>
            {item ? formatMoney(money(unitCost, currency), fmt) : "—"}
          </DescRow>
          <DescRow label={<span className="text-fg font-semibold">{t("entry.value")}</span>} mono>
            <span className={cx("font-semibold", needsApproval ? "text-warn" : "text-fg")}>
              {formatMoney(money(valueMinor, currency), fmt)}
            </span>
          </DescRow>
        </DescList>

        {needsApproval ? (
          <Callout tone="warn" title={t("entry.approvalTitle")}>
            {t("entry.approvalBody").replace(
              "{threshold}",
              formatMoney(money(APPROVAL_THRESHOLD_MINOR, currency), fmt),
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
