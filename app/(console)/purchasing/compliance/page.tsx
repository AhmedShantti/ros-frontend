"use client";

/**
 * Supplier compliance register — SRS §12.3, FR-PRC-011.
 *
 * Every current certificate, licence and policy across all suppliers, the
 * expired and expiring ones first, because that is the order they need
 * dealing with. Renewed documents are kept but hidden unless asked for.
 */

import { useMemo, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";

import { services } from "@/lib/console/services";
import type { ComplianceDocument } from "@/lib/console/services/purchasing-local";
import { COMPLIANCE_KINDS, complianceState, daysBetween, type ComplianceState } from "@/lib/console/purchasing-rules";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDate, formatNumber } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { Gate } from "@/components/console/states";
import { ComplianceDocumentDrawer } from "@/components/console/purchasing-compliance";
import { ComplianceBadge, usePolicy, useSupplierList } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Field, IconButton, Select, Toast, Toggle } from "@/components/console/ui";

const STATE_ORDER: Record<ComplianceState, number> = { expired: 0, expiring: 1, valid: 2 };

export default function CompliancePage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <ComplianceScreen />
    </Gate>
  );
}

function ComplianceScreen() {
  const { t, tx, fmt } = useI18n();
  const canManage = usePermission("supplier.manage");
  const { policy } = usePolicy();
  const suppliers = useSupplierList();
  const docs = useAsync(() => services.procurement.complianceDocs.all(), []);
  const [message, setMessage] = useTransientMessage();
  const [adding, setAdding] = useState(false);
  const [renewing, setRenewing] = useState<ComplianceDocument | null>(null);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const alertDays = policy?.complianceAlertDays ?? 30;
  const today = todayIso();
  const supplierName = useMemo(() => new Map(suppliers.rows.map((row) => [row.id, row.tradingName])), [suppliers.rows]);

  const all = docs.data ?? [];
  const current = all.filter((doc) => !doc.supersededBy);
  const counts = {
    expired: current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expired").length,
    expiring: current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expiring").length,
    uncovered: suppliers.rows.filter((row) => row.active && !current.some((doc) => doc.supplierId === row.id)).length,
  };

  const rows = (showHistory ? all : current)
    .filter((doc) => !supplierFilter || doc.supplierId === supplierFilter)
    .filter((doc) => !kindFilter || doc.kind === kindFilter)
    .filter((doc) => !stateFilter || complianceState(doc.expiresOn, today, alertDays) === stateFilter)
    .sort(
      (a, b) =>
        STATE_ORDER[complianceState(a.expiresOn, today, alertDays)] - STATE_ORDER[complianceState(b.expiresOn, today, alertDays)] ||
        a.expiresOn.localeCompare(b.expiresOn),
    );

  const columns: Column<ComplianceDocument>[] = [
    {
      key: "title",
      header: t("prc.doc.title"),
      render: (row) => (
        <CellStack
          primary={row.title}
          secondary={
            <>
              {t(`prc.docKind.${row.kind}` as ConsoleKey)}
              {row.reference ? <span className="font-mono"> · {row.reference}</span> : null}
            </>
          }
        />
      ),
    },
    { key: "supplier", header: t("pur.supplier"), render: (row) => tx(supplierName.get(row.supplierId) ?? { en: "—", ar: "—" }) },
    { key: "issued", header: t("prc.doc.issuedOn"), secondary: true, render: (row) => (row.issuedOn ? formatDate(row.issuedOn, fmt) : "—") },
    {
      key: "expires",
      header: t("prc.doc.expiresOn"),
      render: (row) => (
        <CellStack
          primary={formatDate(row.expiresOn, fmt)}
          secondary={
            daysBetween(today, row.expiresOn) >= 0
              ? t("prc.doc.daysLeft").replace("{n}", String(daysBetween(today, row.expiresOn)))
              : t("prc.doc.daysAgo").replace("{n}", String(-daysBetween(today, row.expiresOn)))
          }
        />
      ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (row) => (row.supersededBy ? <Badge tone="muted">{t("prc.doc.superseded")}</Badge> : <ComplianceBadge expiresOn={row.expiresOn} alertDays={alertDays} />),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      align: "end",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.file?.dataUrl ? (
            <a href={row.file.dataUrl} download={row.file.name} aria-label={t("prc.doc.download")} title={t("prc.doc.download")} className="text-fg-muted hover:text-fg inline-flex h-8 w-8 items-center justify-center">
              <Download size={14} />
            </a>
          ) : null}
          {canManage && !row.supersededBy ? <IconButton label={t("prc.doc.renew")} icon={<RefreshCw size={14} />} onClick={() => setRenewing(row)} /> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("prc.doc.registerTitle")}
        subtitle={t("prc.doc.registerSubtitle")}
        spec="FR-PRC-011"
        actions={
          <div className="flex gap-2">
            <ExportButton
              filename="supplier-compliance"
              title={t("prc.doc.registerTitle")}
              rows={rows}
              columns={[
                { key: "supplier", header: t("pur.supplier"), value: (row) => tx(supplierName.get(row.supplierId) ?? { en: "", ar: "" }) },
                { key: "kind", header: t("prc.doc.kind"), value: (row) => t(`prc.docKind.${row.kind}` as ConsoleKey) },
                { key: "title", header: t("prc.doc.title"), value: (row) => row.title },
                { key: "reference", header: t("prc.doc.reference"), value: (row) => row.reference },
                { key: "issued", header: t("prc.doc.issuedOn"), value: (row) => row.issuedOn ?? "" },
                { key: "expires", header: t("prc.doc.expiresOn"), value: (row) => row.expiresOn },
                { key: "state", header: t("common.status"), value: (row) => t(`prc.compliance.${complianceState(row.expiresOn, today, alertDays)}` as ConsoleKey) },
              ]}
            />
            {canManage ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                {t("prc.doc.add")}
              </Button>
            ) : null}
          </div>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("prc.doc.alertNote").replace("{n}", String(alertDays))}</Callout>

        <TileGrid columns={3}>
          <MetricTile label={t("prc.compliance.expired")} value={formatNumber(counts.expired, fmt)} spec="FR-PRC-011" />
          <MetricTile label={t("prc.compliance.expiring")} value={formatNumber(counts.expiring, fmt)} />
          <MetricTile label={t("prc.doc.uncovered")} value={formatNumber(counts.uncovered, fmt)} hint={t("prc.doc.uncoveredHint")} />
        </TileGrid>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t("pur.supplier")}>
            <Select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {suppliers.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.doc.kind")}>
            <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {COMPLIANCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`prc.docKind.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.status")}>
            <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["expired", "expiring", "valid"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`prc.compliance.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="self-end">
            <Toggle checked={showHistory} onChange={setShowHistory} label={t("prc.doc.showHistory")} />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={docs.loading}
          error={docs.error}
          onRetry={docs.reload}
          caption={t("prc.doc.registerTitle")}
          emptyTitle={t("prc.doc.emptyTitle")}
          emptyBody={t("prc.doc.emptyBody")}
          filtered={Boolean(supplierFilter || kindFilter || stateFilter)}
          onClearFilters={() => {
            setSupplierFilter("");
            setKindFilter("");
            setStateFilter("");
          }}
          dense
        />
      </PageBody>

      <ComplianceDocumentDrawer
        open={adding || Boolean(renewing)}
        suppliers={suppliers.rows}
        replacing={renewing}
        onClose={() => {
          setAdding(false);
          setRenewing(null);
        }}
        onSaved={(note) => {
          setAdding(false);
          setRenewing(null);
          setMessage(note);
          docs.reload();
        }}
      />
      <Toast message={message} />
    </>
  );
}
