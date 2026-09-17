"use client";

/**
 * Franchise agreements — FR-BRN-035.
 *
 * One agreement per franchised branch: who the franchisee is, the royalty
 * terms (FR-BRN-036 reads them), the configuration domains the brand keeps
 * (enforced wherever `useFranchiseLock` / `franchiseLockFor` is asked), and
 * the suppliers the franchisee must buy from (FR-BRN-037 checks them).
 */

import { useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";

import type { Branch, Id } from "@/lib/console/types";
import {
  agreementInForce,
  agreementProblem,
  DEFAULT_LOCKS,
  FRANCHISE_DOMAINS,
  type FranchiseAgreement,
} from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatPercent, numberFromInput } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { AsyncPanel } from "@/components/console/states";
import { MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { todayIso } from "@/components/console/franchise-lock";
import { Badge, Button, Callout, Drawer, Field, Input, Select, Toggle } from "@/components/console/ui";

export function FranchiseAgreementsTab({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const canManage = usePermission("org.manage");
  const confirm = useConfirm();
  const action = useAction();
  const [editing, setEditing] = useState<{ agreement: FranchiseAgreement | null; branchId: Id } | null>(null);
  const agreements = useAsync(() => services.branchNetwork.franchiseAgreements.all(), []);

  const branchById = useMemo(() => new Map(availableBranches.map((b) => [b.id, b])), [availableBranches]);

  type Row = { branch: Branch; agreement: FranchiseAgreement | null };

  const columns: Column<Row>[] = [
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <CellStack primary={tx(row.branch.name)} secondary={<span className="font-mono">{row.branch.code}</span>} />,
    },
    { key: "franchisee", header: t("frn.franchisee"), render: (row) => row.agreement?.franchiseeName ?? <Badge tone="warn">{t("frn.noAgreement")}</Badge> },
    {
      key: "royalty",
      header: t("frn.royalty"),
      numeric: true,
      render: (row) => (row.agreement ? `${formatPercent(row.agreement.royaltyPercent, fmt, 2)} + ${formatPercent(row.agreement.marketingFundPercent, fmt, 2)}` : "—"),
    },
    {
      key: "minimum",
      header: t("frn.minimumFee"),
      numeric: true,
      secondary: true,
      render: (row) => (row.agreement ? formatMoney({ amount: row.agreement.minimumMonthlyFeeMinor, currency: row.branch.currency }, fmt) : "—"),
    },
    {
      key: "locks",
      header: t("frn.lockedDomains"),
      render: (row) =>
        row.agreement ? (
          <span className="flex flex-wrap gap-1">
            {row.agreement.lockedDomains.map((domain) => (
              <Badge key={domain} tone="accent">
                <Lock size={10} aria-hidden />
                {t(`frn.domain.${domain}` as ConsoleKey)}
              </Badge>
            ))}
          </span>
        ) : null,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) =>
        row.agreement ? (
          <Badge tone={agreementInForce(row.agreement, todayIso()) ? "good" : "muted"} dot>
            {agreementInForce(row.agreement, todayIso()) ? t("frn.inForce") : t("frn.notInForce")}
          </Badge>
        ) : null,
    },
  ];

  async function remove(agreement: FranchiseAgreement) {
    const branch = branchById.get(agreement.branchId);
    const ok = await confirm({
      title: t("frn.deleteTitle"),
      body: t("frn.deleteBody").replace("{franchisee}", agreement.franchiseeName).replace("{branch}", branch ? tx(branch.name) : agreement.branchId),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.branchNetwork.franchiseAgreements.remove(agreement.id), {
      onSuccess: () => {
        setEditing(null);
        agreements.reload();
        notify(t("frn.deleted"));
      },
    });
  }

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("frn.agreementsNote")}</Callout>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <AsyncPanel state={agreements}>
        {(rows) => {
          const tableRows: Row[] = availableBranches
            .filter((branch) => branch.isFranchise || rows.some((row) => row.branchId === branch.id))
            .map((branch) => ({ branch, agreement: rows.find((row) => row.branchId === branch.id) ?? null }));
          const unlisted = availableBranches.filter((branch) => !tableRows.some((row) => row.branch.id === branch.id));
          return (
            <>
              {canManage && unlisted.length > 0 ? (
                <AddForBranch branches={unlisted} onPick={(branchId) => setEditing({ agreement: null, branchId })} />
              ) : null}
              <DataTable
                columns={columns}
                rows={tableRows}
                rowKey={(row) => row.branch.id}
                caption={t("frn.agreementsTitle")}
                onRowClick={canManage ? (row) => setEditing({ agreement: row.agreement, branchId: row.branch.id }) : undefined}
                emptyTitle={t("frn.noFranchiseBranches")}
                dense
              />
            </>
          );
        }}
      </AsyncPanel>
      {editing ? (
        <AgreementDrawer
          branch={branchById.get(editing.branchId) ?? null}
          agreement={editing.agreement}
          onClose={() => setEditing(null)}
          onRemove={remove}
          onSaved={() => {
            setEditing(null);
            agreements.reload();
            notify(t("frn.saved"));
          }}
        />
      ) : null}
    </div>
  );
}

function AddForBranch({ branches, onPick }: { branches: Branch[]; onPick: (branchId: Id) => void }) {
  const { t, tx } = useI18n();
  const [branchId, setBranchId] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-60">
        <Field label={t("frn.addForBranch")} hint={t("frn.addForBranchHint")}>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">—</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button variant="secondary" icon={<Plus size={14} />} disabled={!branchId} onClick={() => onPick(branchId)}>
        {t("common.add")}
      </Button>
    </div>
  );
}

function AgreementDrawer({
  branch,
  agreement,
  onClose,
  onSaved,
  onRemove,
}: {
  branch: Branch | null;
  agreement: FranchiseAgreement | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove: (agreement: FranchiseAgreement) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const suppliers = useAsync(() => services.purchasing.suppliers.list({ limit: 500 }).then((page) => page.rows), []);
  const [form, setForm] = useState(() => ({
    franchiseeName: agreement?.franchiseeName ?? "",
    franchiseeTaxId: agreement?.franchiseeTaxId ?? "",
    contactEmail: agreement?.contactEmail ?? "",
    royalty: String(agreement?.royaltyPercent ?? 6),
    marketing: String(agreement?.marketingFundPercent ?? 2),
    minimum: agreement?.minimumMonthlyFeeMinor ?? 0 as number | null,
    lockedDomains: agreement?.lockedDomains ?? DEFAULT_LOCKS,
    mandatedSupplierIds: agreement?.mandatedSupplierIds ?? [],
    startsOn: agreement?.startsOn ?? todayIso(),
    endsOn: agreement?.endsOn ?? "",
    active: agreement?.active ?? true,
  }));
  if (!branch) return null;

  const candidate: FranchiseAgreement = {
    id: branch.id,
    branchId: branch.id,
    franchiseeName: form.franchiseeName.trim(),
    franchiseeTaxId: form.franchiseeTaxId.trim(),
    contactEmail: form.contactEmail.trim(),
    royaltyPercent: numberFromInput(form.royalty) ?? Number.NaN,
    marketingFundPercent: numberFromInput(form.marketing) ?? Number.NaN,
    minimumMonthlyFeeMinor: form.minimum ?? -1,
    lockedDomains: form.lockedDomains,
    mandatedSupplierIds: form.mandatedSupplierIds,
    startsOn: form.startsOn,
    endsOn: form.endsOn || null,
    active: form.active,
    updatedAt: new Date().toISOString(),
  };
  const problem = agreementProblem(candidate);

  const toggle = <T extends string>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((entry) => entry !== value));

  return (
    <Drawer
      open
      onClose={onClose}
      title={agreement ? agreement.franchiseeName : t("frn.newAgreement")}
      subtitle={tx(branch.name)}
      footer={
        <>
          {agreement ? (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => onRemove(agreement)} className="me-auto">
              {t("common.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={Boolean(problem)}
            onClick={() => action.run(() => services.branchNetwork.franchiseAgreements.put(candidate), { onSuccess: onSaved })}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!branch.isFranchise ? <Callout tone="warn">{t("frn.notFlagged")}</Callout> : null}
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {problem ? <Callout tone="warn">{problem}</Callout> : null}
        <Field label={t("frn.franchisee")} required>
          <Input value={form.franchiseeName} onChange={(event) => setForm({ ...form, franchiseeName: event.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("frn.taxId")}>
            <Input dir="ltr" value={form.franchiseeTaxId} onChange={(event) => setForm({ ...form, franchiseeTaxId: event.target.value })} />
          </Field>
          <Field label={t("frn.email")}>
            <Input dir="ltr" type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} />
          </Field>
          <Field label={t("frn.royaltyPercent")} hint={t("frn.royaltyHint")}>
            <Input dir="ltr" inputMode="decimal" className="font-mono" value={form.royalty} onChange={(event) => setForm({ ...form, royalty: event.target.value })} />
          </Field>
          <Field label={t("frn.marketingPercent")}>
            <Input dir="ltr" inputMode="decimal" className="font-mono" value={form.marketing} onChange={(event) => setForm({ ...form, marketing: event.target.value })} />
          </Field>
          <Field label={t("frn.minimumFee")} hint={t("frn.minimumFeeHint")}>
            <MoneyInput value={form.minimum} onChange={(minimum) => setForm({ ...form, minimum })} currency={branch.currency} min={0} />
          </Field>
          <div />
          <Field label={t("frn.startsOn")} required>
            <Input type="date" dir="ltr" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
          </Field>
          <Field label={t("frn.endsOn")}>
            <Input type="date" dir="ltr" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
          </Field>
        </div>
        <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label={t("common.active")} />

        <fieldset>
          <legend className="text-fg mb-1 text-sm font-semibold">{t("frn.lockedDomains")}</legend>
          <p className="text-fg-subtle mb-2 text-xs">{t("frn.lockedDomainsHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FRANCHISE_DOMAINS.map((domain) => (
              <label key={domain} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.lockedDomains.includes(domain)}
                  onChange={(event) => setForm({ ...form, lockedDomains: toggle(form.lockedDomains, domain, event.target.checked) })}
                />
                {t(`frn.domain.${domain}` as ConsoleKey)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-fg mb-1 text-sm font-semibold">{t("frn.mandatedSuppliers")}</legend>
          <p className="text-fg-subtle mb-2 text-xs">{t("frn.mandatedSuppliersHint")}</p>
          <AsyncPanel state={suppliers} isEmpty={(rows) => rows.length === 0} empty={<p className="text-fg-muted text-sm">{t("frn.noSuppliers")}</p>}>
            {(rows) => (
              <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                {rows.map((supplier) => (
                  <label key={supplier.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.mandatedSupplierIds.includes(supplier.id)}
                      onChange={(event) => setForm({ ...form, mandatedSupplierIds: toggle(form.mandatedSupplierIds, supplier.id, event.target.checked) })}
                    />
                    {tx(supplier.tradingName)}
                  </label>
                ))}
              </div>
            )}
          </AsyncPanel>
        </fieldset>
        {agreement ? (
          <p className="text-fg-subtle text-xs">
            {t("frn.updated")} {formatDate(agreement.updatedAt, fmt)}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
