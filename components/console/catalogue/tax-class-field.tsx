"use client";

/**
 * FR-MNU-004 / DEMO-TAX-CLASS-BACKEND-P0 — `MenuItem.taxClassId` names an
 * ACTIVE `fiscal.tax_classes` row this tenant holds, discovered through
 * `GET /catalogue/branches/{branchId}/tax-classes` — the one endpoint that
 * enumerates valid ids, resolved against whichever country pack is
 * currently effective for a branch. Never a Country Pack's own
 * `taxClasses[]` codes (`CountryPack` describes rate configuration, not a
 * tenant's provisioned identities — those carry no `id` at all), and never
 * a hardcoded "Standard" or a fabricated list. With no active branch there
 * is nothing to resolve a pack from, so this does not fetch.
 *
 * Shared between `/menu/items` and the Menu Management workspace — both
 * read the same real registry, so it lives once, here.
 */

import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { Callout, Field, Select } from "@/components/console/ui";

export function useTaxClasses(branchId: string | null) {
  const result = useAsync(
    () => (branchId ? services.catalogue.listTaxClassesForBranch(branchId) : Promise.resolve(null)),
    [branchId],
  );
  return {
    loading: branchId !== null && result.loading,
    noBranch: branchId === null,
    taxClasses: result.data ?? [],
  };
}

/** Resolves a persisted `taxClassId` against the branch's registry, honestly. */
export function useTaxClassLabel(taxClassId: string | null, branchId: string | null) {
  const { t, tx } = useI18n();
  const { loading, taxClasses } = useTaxClasses(branchId);
  if (!taxClassId) return { text: t("menu.taxClassNotConfigured"), tone: "bad" as const };
  if (loading) return { text: taxClassId, tone: "muted" as const };
  const definition = taxClasses.find((tc) => tc.id === taxClassId);
  return definition
    ? { text: tx(definition.names) || definition.code, tone: "good" as const }
    : { text: taxClassId, tone: "muted" as const };
}

export function TaxClassField({
  branchId,
  value,
  disabled,
  onChange,
}: {
  branchId: string | null;
  value: string;
  disabled?: boolean;
  onChange: (taxClassId: string) => void;
}) {
  const { t, tx } = useI18n();
  const { loading, noBranch, taxClasses } = useTaxClasses(branchId);

  if (noBranch) {
    return (
      <Field label={t("menu.taxClass")}>
        <Callout tone="muted">{t("menu.taxClassNoBranch")}</Callout>
      </Field>
    );
  }

  if (!loading && taxClasses.length === 0) {
    return (
      <Field label={t("menu.taxClass")}>
        <Callout tone="muted">{t("menu.taxClassUnavailable")}</Callout>
      </Field>
    );
  }

  return (
    <Field label={t("menu.taxClass")} hint={t("menu.taxClassHint")}>
      <Select
        value={value}
        disabled={disabled || loading}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("menu.taxClassPlaceholder")}</option>
        {taxClasses.map((taxClass) => (
          <option key={taxClass.id} value={taxClass.id}>
            {tx(taxClass.names) || taxClass.code}
          </option>
        ))}
      </Select>
    </Field>
  );
}
