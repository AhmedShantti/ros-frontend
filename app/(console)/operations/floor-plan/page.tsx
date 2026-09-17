"use client";

/**
 * Floor plan editor — FR-POS-080.
 *
 * Where each table stands, its shape and the room around it. The drawing is
 * browser-local (the API has no field for it); a table's label, area and
 * seats are real and go through the table endpoints. See `FloorEditor`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Table2 } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader } from "@/components/console/page";
import { Field, Select } from "@/components/console/ui";
import { FloorEditor } from "@/components/console/floor-editor";

export default function FloorPlanPage() {
  return (
    <Gate permissions={["settings.branch.manage"]}>
      <FloorPlanScreen />
    </Gate>
  );
}

function FloorPlanScreen() {
  const { t, tx } = useI18n();
  const { branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");

  // Branches resolve after mount; keep an explicit choice, otherwise follow the default.
  useEffect(() => {
    const fallback = branch?.id ?? availableBranches[0]?.id ?? "";
    setBranchId((current) => (current && availableBranches.some((b) => b.id === current) ? current : fallback));
  }, [branch, availableBranches]);

  return (
    <>
      <PageHeader
        title={t("floor.title")}
        subtitle={t("floor.subtitle")}
        spec="FR-POS-080"
        actions={
          <Link
            href="/operations/tables"
            className="border-line bg-raised text-fg-muted hover:bg-sunken hover:text-fg inline-flex min-h-12 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
          >
            <Table2 size={14} aria-hidden />
            {t("nav.tables")}
          </Link>
        }
      />
      <PageBody>
        {availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {branchId ? <FloorEditor key={branchId} branchId={branchId} /> : null}
      </PageBody>
    </>
  );
}
