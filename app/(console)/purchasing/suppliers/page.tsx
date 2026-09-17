"use client";

/**
 * Suppliers — SRS §12.3, FR-PRC-009.
 *
 * The master data half of this screen is unremarkable: terms, lead time,
 * delivery days. The scorecard is the part that earns its place.
 *
 * Price stability is the metric restaurants usually discover too late. A
 * supplier can hold a perfect on-time record and still cost more every month
 * through quiet unit-price drift, and because each individual delivery looks
 * fine, nothing raises it. Tracking it as a score makes the drift visible
 * while the contract is still negotiable.
 *
 * The drawer also carries what the supplier master has no field for: their
 * compliance documents with expiry alerting (FR-PRC-011), settlement terms
 * and ordering channels (FR-PRC-021, FR-PRC-045), and a link to their account
 * statement (FR-PRC-044).
 *
 * Quality rejection is inverted — low is good — so it is coloured against the
 * opposite scale from the other four. Reading all five with the same "higher
 * is better" instinct is exactly the mistake this note exists to prevent.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ScrollText, ShieldAlert, Tags } from "lucide-react";
import type { Supplier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ComplianceDocument } from "@/lib/console/services/purchasing-local";
import { complianceState } from "@/lib/console/purchasing-rules";
import { todayIso } from "@/lib/console/settings";
import { useAction } from "@/lib/console/actions";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { SupplierDrawer as SupplierFormDrawer } from "@/components/console/purchasing-forms";
import { ComplianceSummaryBadges, SupplierComplianceList } from "@/components/console/purchasing-compliance";
import { usePolicy } from "@/components/console/purchasing-shared";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  DescList,
  DescRow,
  Drawer,
  Meter,
  Toast,
  cx,
} from "@/components/console/ui";

/** Colour a rate against a target; `invert` for metrics where low is good. */
function rateTone(value: number, good: number, warn: number, invert = false) {
  if (invert) {
    if (value <= good) return "good" as const;
    if (value <= warn) return "warn" as const;
    return "bad" as const;
  }
  if (value >= good) return "good" as const;
  if (value >= warn) return "warn" as const;
  return "bad" as const;
}

export default function SuppliersPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <SuppliersScreen />
    </Gate>
  );
}

function SuppliersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Supplier | null>(null);
  const canManage = usePermission("supplier.manage");
  const [message, setMessage] = useTransientMessage();
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);


  const collection = useCollection<Supplier>(
    (query) => services.purchasing.suppliers.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  // FR-PRC-011 — compliance documents, alerted ahead of expiry per policy.
  const { policy } = usePolicy();
  const alertDays = policy?.complianceAlertDays ?? 30;
  const docs = useAsync(() => services.procurement.complianceDocs.all(), []);
  const docsBySupplier = useMemo(() => {
    const map = new Map<string, ComplianceDocument[]>();
    for (const doc of docs.data ?? []) map.set(doc.supplierId, [...(map.get(doc.supplierId) ?? []), doc]);
    return map;
  }, [docs.data]);
  const complianceAlerts = useMemo(() => {
    const today = todayIso();
    const current = (docs.data ?? []).filter((doc) => !doc.supersededBy);
    return {
      expired: current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expired").length,
      expiring: current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expiring").length,
    };
  }, [docs.data, alertDays]);

  const totals = useMemo(() => {
    const rows = collection.rows;
    const onTime = rows.map((row) => row.scorecard.onTimeDeliveryRate);
    return {
      outstanding: rows.reduce((sum, row) => sum + row.outstandingBalance.amount, 0),
      averageOnTime:
        onTime.length > 0 ? onTime.reduce((s, v) => s + v, 0) / onTime.length : 0,
      underperforming: rows.filter((row) => row.scorecard.onTimeDeliveryRate < 90).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.outstandingBalance.currency ?? "EGP";

  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        key: "name",
        header: t("pur.supplier"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.tradingName)}
            secondary={<span className="font-mono">{row.code}</span>}
          />
        ),
      },
      {
        key: "contact",
        header: t("pur.contact"),
        secondary: true,
        render: (row) => (
          <CellStack primary={row.contactName} secondary={<span dir="ltr">{row.phone}</span>} />
        ),
      },
      {
        key: "terms",
        header: t("pur.terms"),
        numeric: true,
        secondary: true,
        render: (row) => (
          <span dir="ltr">
            {t("pur.netDays")}
            {formatNumber(row.paymentTermsDays, fmt)}
          </span>
        ),
      },
      {
        key: "leadTimeDays",
        header: t("pur.leadTime"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span>
            {formatNumber(row.leadTimeDays, fmt)} {t("inv.days")}
          </span>
        ),
      },
      {
        key: "onTime",
        header: t("pur.onTime"),
        sortable: true,
        numeric: true,
        render: (row) => {
          const rate = row.scorecard.onTimeDeliveryRate;
          const tone = rateTone(rate, 95, 88);
          return (
            <span
              className={cx(
                tone === "good" && "text-good",
                tone === "warn" && "text-warn",
                tone === "bad" && "text-bad",
              )}
            >
              {formatPercent(rate, fmt, 1)}
            </span>
          );
        },
      },
      {
        key: "priceStability",
        header: t("pur.priceStability"),
        numeric: true,
        secondary: true,
        render: (row) => formatPercent(row.scorecard.priceStability, fmt, 1),
      },
      {
        key: "outstanding",
        header: t("pur.outstanding"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.outstandingBalance, fmt),
      },
      {
        key: "compliance",
        header: t("prc.doc.sectionTitle"),
        secondary: true,
        render: (row) => <ComplianceSummaryBadges documents={docsBySupplier.get(row.id) ?? []} alertDays={alertDays} />,
      },
      {
        key: "active",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={row.active ? "good" : "muted"} dot>
            {row.active ? t("common.active") : t("common.inactive")}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt, docsBySupplier, alertDays],
  );

  return (
    <>
      <PageHeader
        title={t("pur.suppliersTitle")}
        subtitle={t("pur.suppliersSubtitle")}
        spec="FR-PRC-009"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setCreatingSupplier(true)}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        {complianceAlerts.expired + complianceAlerts.expiring > 0 ? (
          <Callout
            tone={complianceAlerts.expired > 0 ? "bad" : "warn"}
            icon={<ShieldAlert size={14} />}
            title={t("prc.doc.alertTitle")}
          >
            {t("prc.doc.alertBody")
              .replace("{expired}", String(complianceAlerts.expired))
              .replace("{expiring}", String(complianceAlerts.expiring))}{" "}
            <Link href="/purchasing/compliance" className="font-medium underline">
              {t("prc.doc.openRegister")}
            </Link>
          </Callout>
        ) : null}

        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.outstanding")}
            value={formatMoney({ amount: totals.outstanding, currency }, fmt, true)}
          />
          <MetricTile
            label={t("pur.onTime")}
            value={formatPercent(totals.averageOnTime, fmt, 1)}
          />
          <MetricTile
            label={t("pur.underperforming")}
            value={formatNumber(totals.underperforming, fmt)}
            hint={t("pur.underperformingHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("pur.supplierSearchPlaceholder")}
          filters={[
            {
              key: "active",
              label: t("common.status"),
              options: [
                { value: "true", label: t("common.active") },
                { value: "false", label: t("common.inactive") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("pur.suppliersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <SupplierDrawer
        supplier={selected}
        canManage={canManage}
        documents={docs.data ?? []}
        alertDays={alertDays}
        suppliers={collection.rows}
        onChanged={(note) => {
          setMessage(note);
          docs.reload();
        }}
        onEdit={(supplier) => {
          setSelected(null);
          setEditing(supplier);
        }}
        onClose={() => setSelected(null)}
      />
      <SupplierFormDrawer
        supplier={editing}
        open={creatingSupplier || Boolean(editing)}
        onClose={() => {
          setCreatingSupplier(false);
          setEditing(null);
        }}
        onSaved={(note) => {
          setCreatingSupplier(false);
          setEditing(null);
          setMessage(note);
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SupplierDrawer({
  supplier,
  canManage,
  documents,
  alertDays,
  suppliers,
  onChanged,
  onEdit,
  onClose,
}: {
  supplier: Supplier | null;
  canManage: boolean;
  documents: ComplianceDocument[];
  alertDays: number;
  suppliers: Supplier[];
  onChanged: (message: string) => void;
  onEdit: (supplier: Supplier) => void;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!supplier) return null;

  const card = supplier.scorecard;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(supplier.tradingName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {supplier.code}
        </span>
      }
      footer={
        canManage ? (
          <Button variant="primary" onClick={() => onEdit(supplier)}>
            {t("common.edit")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.name")}>{tx(supplier.legalName)}</DescRow>
          <DescRow label={t("pur.contact")}>{supplier.contactName}</DescRow>
          <DescRow label={t("usr.phone")} mono>
            <span dir="ltr">{supplier.phone}</span>
          </DescRow>
          <DescRow label={t("auth.email")}>
            <span dir="ltr">{supplier.email}</span>
          </DescRow>
          <DescRow label={t("pur.taxRegistration")} mono>
            <span dir="ltr">{supplier.taxRegistration || "—"}</span>
          </DescRow>
          <DescRow label={t("pur.terms")} mono>
            <span dir="ltr">
              {t("pur.netDays")}
              {formatNumber(supplier.paymentTermsDays, fmt)}
            </span>
          </DescRow>
          <DescRow label={t("pur.leadTime")} mono>
            {formatNumber(supplier.leadTimeDays, fmt)} {t("inv.days")}
          </DescRow>
          <DescRow label={t("pur.minOrder")} mono>
            {formatMoney(supplier.minimumOrderValue, fmt)}
          </DescRow>
          <DescRow label={t("pur.outstanding")} mono>
            {formatMoney(supplier.outstandingBalance, fmt)}
          </DescRow>
        </DescList>

        {supplier.deliveryDays.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("pur.deliveryDays")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {supplier.deliveryDays.map((day) => (
                <Badge key={day} tone="neutral">
                  {day}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/* FR-PRC-044 / FR-PRC-006 */}
          <Link href={`/purchasing/statements?supplier=${supplier.id}`}>
            <Button size="sm" icon={<ScrollText size={12} />}>
              {t("prc.stmt.open")}
            </Button>
          </Link>
          <Link href="/purchasing/sourcing">
            <Button size="sm" icon={<Tags size={12} />}>
              {t("prc.sourcing.tabPrices")}
            </Button>
          </Link>
        </div>

        <SupplierComplianceList
          documents={documents}
          alertDays={alertDays}
          suppliers={suppliers}
          supplierId={supplier.id}
          onChanged={onChanged}
        />

        <SupplierTermsSection supplier={supplier} canManage={canManage} onSaved={onChanged} />

        <section>
          <h3 className="text-fg mb-3 text-sm font-semibold">{t("pur.scorecard")}</h3>
          <div className="space-y-3">
            <ScoreRow
              label={t("pur.onTime")}
              value={card.onTimeDeliveryRate}
              tone={rateTone(card.onTimeDeliveryRate, 95, 88)}
            />
            <ScoreRow
              label={t("pur.fillRate")}
              value={card.fillRate}
              tone={rateTone(card.fillRate, 96, 90)}
            />
            <ScoreRow
              label={t("pur.priceStability")}
              value={card.priceStability}
              tone={rateTone(card.priceStability, 95, 88)}
            />
            <ScoreRow
              label={t("pur.invoiceAccuracy")}
              value={card.invoiceAccuracy}
              tone={rateTone(card.invoiceAccuracy, 97, 92)}
            />
            <ScoreRow
              label={t("pur.qualityRejection")}
              value={card.qualityRejectionRate}
              tone={rateTone(card.qualityRejectionRate, 1, 3, true)}
              lowerIsBetter
            />
          </div>

          <DescList>
            <DescRow label={t("pur.avgLeadTime")} mono>
              {formatNumber(card.averageLeadTimeDays, fmt, 1)} {t("inv.days")}
            </DescRow>
          </DescList>
        </section>
      </div>
    </Drawer>
  );
}

function ScoreRow({
  label,
  value,
  tone,
  lowerIsBetter,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";
  lowerIsBetter?: boolean;
}) {
  const { t, fmt } = useI18n();

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-fg-muted flex items-center gap-1.5 text-xs">
          {label}
          {lowerIsBetter ? (
            <span className="text-fg-subtle text-[0.65rem]">{t("pur.lowerIsBetter")}</span>
          ) : null}
        </span>
        <span className="text-fg font-mono text-sm tabular-nums">
          {formatPercent(value, fmt, 1)}
        </span>
      </div>
      <Meter value={lowerIsBetter ? Math.min(100, value * 10) : value} tone={tone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-021 / FR-PRC-045 — ordering channels and settlement terms
// ---------------------------------------------------------------------------

function SupplierTermsSection({
  supplier,
  canManage,
  onSaved,
}: {
  supplier: Supplier;
  canManage: boolean;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const terms = useAsync(() => services.procurement.supplierTerms.get(supplier.id), [supplier.id]);
  const [discount, setDiscount] = useState("0");
  const [days, setDays] = useState("0");
  const [orderEmail, setOrderEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  useEffect(() => {
    setDiscount(String(terms.data?.earlyDiscountPercent ?? 0));
    setDays(String(terms.data?.earlyDiscountDays ?? 0));
    setOrderEmail(terms.data?.orderEmail || supplier.email);
    setWhatsapp(terms.data?.whatsapp || supplier.phone);
  }, [terms.data, supplier.email, supplier.phone]);

  const discountValue = Number(discount);
  const daysValue = Number(days);
  // A discount needs a window, and the window cannot outlast the payment terms.
  const invalid =
    !(discountValue >= 0 && discountValue < 100) ||
    !(Number.isInteger(daysValue) && daysValue >= 0) ||
    (discountValue > 0 && daysValue === 0) ||
    daysValue > supplier.paymentTermsDays;

  async function save() {
    if (invalid) return;
    await action.run(
      () =>
        services.procurement.saveSupplierTerms(supplier.id, {
          earlyDiscountPercent: discountValue,
          earlyDiscountDays: daysValue,
          orderEmail: orderEmail.trim(),
          whatsapp: whatsapp.trim(),
        }),
      {
        onSuccess: () => {
          terms.reload();
          onSaved(t("prc.terms.saved"));
        },
      },
    );
  }

  return (
    <section>
      <h3 className="text-fg mb-1 text-sm font-semibold">{t("prc.terms.title")}</h3>
      <p className="text-fg-subtle mb-2 text-xs">{t("prc.terms.hint")}</p>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("prc.terms.discount")}>
          <Input dir="ltr" inputMode="decimal" disabled={!canManage} value={discount} onChange={(event) => setDiscount(event.target.value)} className="text-end font-mono tabular-nums" />
        </Field>
        <Field
          label={t("prc.terms.discountDays")}
          error={invalid ? t("prc.terms.invalid").replace("{n}", String(supplier.paymentTermsDays)) : undefined}
        >
          <Input dir="ltr" inputMode="numeric" disabled={!canManage} value={days} onChange={(event) => setDays(event.target.value)} className="text-end font-mono tabular-nums" />
        </Field>
        <Field label={t("prc.terms.orderEmail")}>
          <Input dir="ltr" inputMode="email" disabled={!canManage} value={orderEmail} onChange={(event) => setOrderEmail(event.target.value)} />
        </Field>
        <Field label={t("prc.terms.whatsapp")} hint={t("prc.terms.whatsappHint")}>
          <Input dir="ltr" inputMode="tel" disabled={!canManage} value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
        </Field>
      </div>
      {canManage ? (
        <div className="mt-2">
          <Button size="sm" loading={action.pending} disabled={invalid} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
