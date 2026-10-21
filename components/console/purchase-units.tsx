"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PurchaseUnit, StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { unitLabel } from "@/lib/console/format";
import { ErrorPanel } from "@/components/console/states";
import { Button, Callout, Drawer, Field, Input } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Purchase units — FR-INV-003
//
// A stock item's own item-specific purchase units (e.g. "Case 12", "Case
// 24"), each with an independent conversion factor to its base unit — a
// real COLLECTION read from `services.inventory.listPurchaseUnits`, not the
// fake single base-unit-times-one stand-in. Supplier-neutral units can be
// used for any supplier; Receiving and Stock Items share this editor.
// ---------------------------------------------------------------------------

/** Decimal(20,6) text, validated as text only — never parsed through
 *  `Number()`, which could round a value past double precision. */
const CONVERSION_FACTOR_PATTERN = /^\d{1,14}(\.\d{1,6})?$/;

function isZeroConversionText(text: string): boolean {
  return /^0+(\.0*)?$/.test(text);
}

type ConversionFactorError = "required" | "invalid" | "notPositive";

function conversionFactorErrorKey(raw: string): ConversionFactorError | null {
  const text = raw.trim();
  if (!text) return "required";
  if (!CONVERSION_FACTOR_PATTERN.test(text)) return "invalid";
  if (isZeroConversionText(text)) return "notPositive";
  return null;
}

/** "12.000000" -> "12", "1.500000" -> "1.5" — trims trailing zeros without
 *  ever parsing the Decimal(20,6) string as a number. */
function trimConversionFactor(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

export function PurchaseUnitsSection({
  item,
  onMessage,
  onChanged,
}: {
  item: StockItem;
  onMessage: (message: string) => void;
  onChanged?: () => void;
}) {
  const { t, fmt } = useI18n();
  const { canAny } = useSession();
  const [formOpen, setFormOpen] = useState<"create" | PurchaseUnit | null>(null);
  const canMutate = canAny(["inventory.adjust"]);

  const query = useAsync(() => services.inventory.listPurchaseUnits(item.id), [item.id]);
  const rows = query.data ?? [];
  const baseUnitLabel = unitLabel(item.baseUnit, fmt.locale);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-fg text-sm font-semibold">{t("inv.purchaseUnits")}</h3>
        {canMutate ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setFormOpen("create")}
          >
            {t("inv.addPurchaseUnit")}
          </Button>
        ) : null}
      </div>

      {query.loading ? (
        <Callout tone="muted">{t("state.loading")}</Callout>
      ) : query.error ? (
        <ErrorPanel error={query.error} onRetry={query.reload} compact />
      ) : rows.length === 0 ? (
        <Callout tone="muted">{t("inv.noPurchaseUnitsConfigured")}</Callout>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <PurchaseUnitRow
              key={row.id}
              item={item}
              row={row}
              baseUnitLabel={baseUnitLabel}
              canMutate={canMutate}
              onEdit={() => setFormOpen(row)}
              onDeleted={() => {
                onMessage(t("inv.purchaseUnitDeleted"));
                query.reload();
                onChanged?.();
              }}
            />
          ))}
        </ul>
      )}

      {formOpen ? (
        <PurchaseUnitFormDrawer
          item={item}
          existing={formOpen === "create" ? null : formOpen}
          onClose={() => setFormOpen(null)}
          onDone={(wasCreate) => {
            setFormOpen(null);
            onMessage(wasCreate ? t("inv.purchaseUnitCreated") : t("inv.purchaseUnitUpdated"));
            query.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}

function PurchaseUnitRow({
  item,
  row,
  baseUnitLabel,
  canMutate,
  onEdit,
  onDeleted,
}: {
  item: StockItem;
  row: PurchaseUnit;
  baseUnitLabel: string;
  canMutate: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [conflict, setConflict] = useState(false);

  async function remove() {
    setConflict(false);
    await action.run(() => services.inventory.deletePurchaseUnit(item.id, row.id), {
      onSuccess: onDeleted,
      onError: (error) => setConflict(error.status === 409),
    });
  }

  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-fg text-sm font-medium">{row.name}</p>
          <p className="text-fg-muted font-mono text-xs" dir="ltr">
            1 {row.name} = {trimConversionFactor(row.conversionFactorToBase)} {baseUnitLabel}
          </p>
        </div>
        {canMutate ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              loading={action.pending}
              onClick={() => void remove()}
            >
              {t("common.delete")}
            </Button>
          </div>
        ) : null}
      </div>
      {action.error ? (
        <Callout tone="bad" className="mt-2" title={conflict ? t("inv.purchaseUnitInUse") : undefined}>
          {action.error}
        </Callout>
      ) : null}
    </li>
  );
}

function PurchaseUnitFormDrawer({
  item,
  existing,
  onClose,
  onDone,
}: {
  item: StockItem;
  existing: PurchaseUnit | null;
  onClose: () => void;
  onDone: (wasCreate: boolean) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState(existing?.name ?? "");
  const [conversionFactorToBase, setConversionFactorToBase] = useState(
    existing ? trimConversionFactor(existing.conversionFactorToBase) : "",
  );
  const [touched, setTouched] = useState(false);

  const conversionErrorKey = conversionFactorErrorKey(conversionFactorToBase);
  const conversionErrorMessage =
    conversionErrorKey &&
    t(
      (conversionErrorKey === "required"
        ? "inv.purchaseUnitConversionRequired"
        : conversionErrorKey === "notPositive"
          ? "inv.purchaseUnitConversionPositive"
          : "inv.purchaseUnitConversionInvalid") as never,
    );
  const valid = name.trim() !== "" && conversionErrorKey === null;

  async function submit() {
    setTouched(true);
    if (!valid || action.pending) return;
    const input = { name: name.trim(), conversionFactorToBase: conversionFactorToBase.trim() };
    await action.run(
      () =>
        existing
          ? services.inventory.updatePurchaseUnit(item.id, existing.id, input)
          : services.inventory.createPurchaseUnit(item.id, input),
      { onSuccess: () => onDone(!existing) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={existing ? t("inv.editPurchaseUnit") : t("inv.addPurchaseUnit")}
      footer={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            loading={action.pending}
            disabled={!valid || action.pending}
            onClick={() => void submit()}
          >
            {existing ? t("common.save") : t("common.create")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("common.name")} required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder={t("inv.purchaseUnitNamePlaceholder")}
          />
        </Field>

        <Field
          label={t("inv.purchaseUnitConversion")}
          required
          hint={`${t("inv.purchaseUnitConversionHint")} (${t("inv.baseUnit")}: ${item.baseUnit})`}
          error={touched ? (conversionErrorMessage ?? undefined) : undefined}
        >
          <Input
            dir="ltr"
            value={conversionFactorToBase}
            onChange={(event) => setConversionFactorToBase(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
