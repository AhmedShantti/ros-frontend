"use client";

/**
 * Move a branch into this brand — FR-PLT-004.
 *
 * Only a Tenant Owner may do it, only within the tenant (the branch list is
 * the tenant's own, and the service refuses a tenant change — FR-PLT-003),
 * and never without seeing what it does to the menu and prices first:
 *
 *   - brand-scoped price lists of the old brand stop applying at the branch,
 *     and the new brand's start — both counted from the live price lists;
 *   - menus assigned to the branch stay assigned, and are listed, because a
 *     menu written for the old concept is now being sold under the new one.
 *
 * The move goes to the real `POST /org/branches/{id}/brand` (the server
 * writes its own audit entry), and the console records the before/after in
 * the security event log as well, with the counts the owner was shown.
 */

import { useMemo, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import type { Brand } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useSecurityLog } from "@/lib/console/security-log";
import { useConfirm } from "@/components/console/confirm";
import { ErrorCallout } from "@/components/console/states";
import { Button, Callout, Field, Select } from "@/components/console/ui";

export function BranchReassignIntoBrand({
  brand,
  readOnly,
  onDone,
}: {
  brand: Brand;
  /** FR-PLT-021 — a brand past the plan limit is read-only. */
  readOnly: boolean;
  onDone: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { roleKey, availableBranches, availableBrands, scope } = useSession();
  const record = useSecurityLog();
  const confirm = useConfirm();
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const candidates = availableBranches.filter((branch) => branch.brandId !== brand.id);
  const branch = candidates.find((row) => row.id === branchId) ?? null;
  const fromBrand = availableBrands.find((row) => row.id === branch?.brandId) ?? null;

  const catalogue = useAsync(
    async () => {
      if (!branch) return null;
      const [priceLists, menus] = await Promise.all([
        services.catalogue.priceLists.list({ limit: 500, scope: { ...scope, brandId: null, branchId: null } }).then((page) => page.rows).catch(() => null),
        services.catalogue.menus.list({ limit: 500, scope: { ...scope, brandId: null, branchId: null } }).then((page) => page.rows).catch(() => null),
      ]);
      return { priceLists, menus };
    },
    [branch?.id],
  );

  const impact = useMemo(() => {
    if (!branch || !catalogue.data) return null;
    const lists = catalogue.data.priceLists;
    return {
      losing: lists ? lists.filter((row) => row.scope === "brand" && row.scopeId === branch.brandId).length : null,
      gaining: lists ? lists.filter((row) => row.scope === "brand" && row.scopeId === brand.id).length : null,
      menus: catalogue.data.menus ? catalogue.data.menus.filter((row) => row.branchIds.includes(branch.id)).map((row) => tx(row.name)) : null,
    };
  }, [branch, catalogue.data, brand.id, tx]);

  if (roleKey !== "owner") {
    return <Callout tone="muted">{t("brr.ownerOnly")}</Callout>;
  }
  if (candidates.length === 0) return null;

  async function move() {
    if (!branch) return;
    const ok = await confirm({
      title: t("brr.confirmTitle").replace("{branch}", tx(branch.name)).replace("{brand}", tx(brand.name)),
      body: t("brr.confirmBody"),
      detail: impact ? (
        <ul className="list-disc space-y-0.5 ps-4 text-xs">
          <li>{t("brr.losing").replace("{n}", impact.losing === null ? "?" : String(impact.losing)).replace("{brand}", tx(fromBrand?.name) || "—")}</li>
          <li>{t("brr.gaining").replace("{n}", impact.gaining === null ? "?" : String(impact.gaining)).replace("{brand}", tx(brand.name))}</li>
          <li>{t("brr.menus").replace("{menus}", impact.menus === null ? "?" : impact.menus.join(", ") || t("common.none"))}</li>
        </ul>
      ) : undefined,
      confirmLabel: t("brr.move"),
      tone: "danger",
      typeToConfirm: branch.code,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await services.organisation.reassignBranchBrand(branch.id, brand.id);
      // FR-PLT-004 — the full record: who, which branch, from and to, and
      // the implications they were shown when they confirmed.
      await record({
        kind: "branch.brand_reassigned",
        subjectType: "branch",
        subjectId: branch.id,
        detail: {
          branchCode: branch.code,
          fromBrandId: branch.brandId,
          toBrandId: brand.id,
          priceListsLost: impact?.losing ?? null,
          priceListsGained: impact?.gaining ?? null,
          menusAssigned: impact?.menus?.length ?? null,
        },
      });
      setBranchId("");
      onDone(t("org.brandReassigned"));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-fg text-sm font-semibold">{t("brr.title")}</h3>
      <p className="text-fg-muted text-xs">{t("brr.hint")}</p>
      {readOnly ? <Callout tone="warn">{t("brr.readOnly")}</Callout> : null}
      <Field label={t("nav.branches")}>
        <Select value={branchId} disabled={readOnly} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">{t("brr.pick")}</option>
          {candidates.map((row) => (
            <option key={row.id} value={row.id}>
              {tx(row.name)} · {tx(availableBrands.find((b) => b.id === row.brandId)?.name)}
            </option>
          ))}
        </Select>
      </Field>
      {branch && impact ? (
        <Callout tone="warn" title={t("brr.impactTitle")}>
          <ul className="list-disc space-y-0.5 ps-4">
            <li>{t("brr.losing").replace("{n}", impact.losing === null ? "?" : String(impact.losing)).replace("{brand}", tx(fromBrand?.name) || "—")}</li>
            <li>{t("brr.gaining").replace("{n}", impact.gaining === null ? "?" : String(impact.gaining)).replace("{brand}", tx(brand.name))}</li>
            <li>{t("brr.menus").replace("{menus}", impact.menus === null ? "?" : impact.menus.join(", ") || t("common.none"))}</li>
          </ul>
          {impact.losing === null || impact.menus === null ? <p className="mt-1">{t("brr.impactUnknown")}</p> : null}
        </Callout>
      ) : null}
      <ErrorCallout error={error} />
      <Button variant="danger" icon={<ArrowRightLeft size={13} />} disabled={!branch || readOnly} loading={busy} onClick={() => void move()}>
        {t("brr.move")}
      </Button>
    </section>
  );
}
