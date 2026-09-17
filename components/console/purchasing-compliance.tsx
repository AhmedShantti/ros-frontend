"use client";

/**
 * Supplier compliance documents — SRS §12.3, FR-PRC-011.
 *
 * Food safety certificates, trade licences, insurance: each with an expiry
 * date, and an alert that starts `complianceAlertDays` ahead (policy). A
 * renewal is uploaded *in place of* the old document rather than over it, so
 * an inspector asking "was this supplier certified on the day of that
 * delivery?" still gets an answer.
 *
 * Alerting here is on-screen — the register, the supplier drawer and the
 * order form. Emailing someone before a certificate lapses is a scheduled
 * server job that does not exist yet, and the page says so.
 */

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { Id, Supplier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ComplianceDocument, StoredFile } from "@/lib/console/services/purchasing-local";
import { COMPLIANCE_KINDS, complianceState, daysBetween, type ComplianceKind } from "@/lib/console/purchasing-rules";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDate } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { useConfirmDelete } from "@/components/console/confirm";
import { ComplianceBadge, FileCapture, useActor } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Drawer, Field, IconButton, Input, Select, Textarea } from "@/components/console/ui";

export function ComplianceDocumentDrawer({
  open,
  suppliers,
  supplierId,
  replacing,
  onClose,
  onSaved,
}: {
  open: boolean;
  suppliers: Supplier[];
  supplierId?: Id;
  /** A document this one renews. */
  replacing: ComplianceDocument | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [supplier, setSupplier] = useState<Id>("");
  const [kind, setKind] = useState<ComplianceKind>("food_safety");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<StoredFile | null>(null);

  useEffect(() => {
    if (!open) return;
    setSupplier(replacing?.supplierId ?? supplierId ?? "");
    setKind(replacing?.kind ?? "food_safety");
    setTitle(replacing?.title ?? "");
    setReference("");
    setIssuedOn("");
    setExpiresOn("");
    setNotes("");
    setFile(null);
  }, [open, replacing?.id, supplierId]);

  const problems: string[] = [];
  if (!supplier) problems.push(t("pur.needSupplier"));
  if (!title.trim()) problems.push(t("prc.doc.needTitle"));
  if (!expiresOn) problems.push(t("prc.doc.needExpiry"));
  if (issuedOn && expiresOn && issuedOn > expiresOn) problems.push(t("prc.doc.expiresBeforeIssue"));

  async function save() {
    if (problems.length > 0) return;
    await action.run(
      () =>
        services.procurement.addComplianceDocument(
          { supplierId: supplier, kind, title, reference: reference.trim(), issuedOn: issuedOn || null, expiresOn, notes: notes.trim(), file },
          actor,
          replacing?.id ?? null,
        ),
      { onSuccess: () => onSaved(replacing ? t("prc.doc.renewed") : t("prc.doc.added")) },
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={replacing ? t("prc.doc.renew") : t("prc.doc.add")}
      subtitle="FR-PRC-011"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {replacing ? <Callout tone="muted">{t("prc.doc.renewNote").replace("{title}", replacing.title)}</Callout> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select value={supplier} disabled={Boolean(replacing)} onChange={(event) => setSupplier(event.target.value)}>
              <option value="">—</option>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.doc.kind")} required>
            <Select value={kind} onChange={(event) => setKind(event.target.value as ComplianceKind)}>
              {COMPLIANCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`prc.docKind.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("prc.doc.title")} required>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={t("prc.doc.reference")}>
            <Input dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} className="font-mono" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("prc.doc.issuedOn")}>
            <Input type="date" dir="ltr" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
          </Field>
          <Field label={t("prc.doc.expiresOn")} required>
            <Input type="date" dir="ltr" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
          </Field>
        </div>

        <Field label={t("prc.doc.file")} hint={t("prc.doc.fileHint")}>
          <FileCapture value={file} onChange={setFile} label={t("prc.doc.attach")} accept="image/*,application/pdf" camera={false} />
        </Field>

        <Field label={t("common.notes")}>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

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

/** A compact list of one supplier's current documents, for the supplier drawer. */
export function SupplierComplianceList({
  documents,
  alertDays,
  suppliers,
  supplierId,
  onChanged,
}: {
  documents: ComplianceDocument[];
  alertDays: number;
  suppliers: Supplier[];
  supplierId: Id;
  onChanged: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const canManage = usePermission("supplier.manage");
  const confirmDelete = useConfirmDelete();
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [renewing, setRenewing] = useState<ComplianceDocument | null>(null);
  const today = todayIso();

  const current = useMemo(
    () => documents.filter((doc) => doc.supplierId === supplierId && !doc.supersededBy).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)),
    [documents, supplierId],
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">{t("prc.doc.sectionTitle")}</h3>
        {canManage ? (
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
            {t("prc.doc.add")}
          </Button>
        ) : null}
      </div>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {current.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("prc.doc.none")}</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {current.map((doc) => {
            const state = complianceState(doc.expiresOn, today, alertDays);
            const days = daysBetween(today, doc.expiresOn);
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <FileText size={14} aria-hidden className="text-fg-subtle shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm">{doc.title}</p>
                  <p className="text-fg-subtle">
                    {t(`prc.docKind.${doc.kind}` as ConsoleKey)} · {formatDate(doc.expiresOn, fmt)}
                    {state !== "expired" ? ` · ${t("prc.doc.daysLeft").replace("{n}", String(days))}` : ""}
                  </p>
                </div>
                <ComplianceBadge expiresOn={doc.expiresOn} alertDays={alertDays} />
                {doc.file?.dataUrl ? (
                  <a href={doc.file.dataUrl} download={doc.file.name} className="text-fg-muted hover:text-fg inline-flex h-8 w-8 items-center justify-center" aria-label={t("prc.doc.download")} title={t("prc.doc.download")}>
                    <Download size={14} />
                  </a>
                ) : null}
                {canManage ? (
                  <>
                    <IconButton label={t("prc.doc.renew")} icon={<RefreshCw size={14} />} onClick={() => setRenewing(doc)} />
                    <IconButton
                      label={t("common.delete")}
                      icon={<Trash2 size={14} />}
                      onClick={async () => {
                        if (!(await confirmDelete(doc.title))) return;
                        await action.run(() => services.procurement.removeComplianceDocument(doc.id), { onSuccess: () => onChanged(t("prc.doc.deleted")) });
                      }}
                    />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ComplianceDocumentDrawer
        open={adding || Boolean(renewing)}
        suppliers={suppliers}
        supplierId={supplierId}
        replacing={renewing}
        onClose={() => {
          setAdding(false);
          setRenewing(null);
        }}
        onSaved={(message) => {
          setAdding(false);
          setRenewing(null);
          onChanged(message);
        }}
      />
    </section>
  );
}

export function ComplianceSummaryBadges({ documents, alertDays }: { documents: ComplianceDocument[]; alertDays: number }) {
  const { t } = useI18n();
  const today = todayIso();
  const current = documents.filter((doc) => !doc.supersededBy);
  const expired = current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expired").length;
  const expiring = current.filter((doc) => complianceState(doc.expiresOn, today, alertDays) === "expiring").length;
  if (current.length === 0) return <Badge tone="muted">{t("prc.doc.noneShort")}</Badge>;
  if (expired > 0) return <Badge tone="bad" dot>{t("prc.doc.expiredCount").replace("{n}", String(expired))}</Badge>;
  if (expiring > 0) return <Badge tone="warn" dot>{t("prc.doc.expiringCount").replace("{n}", String(expiring))}</Badge>;
  return <Badge tone="good" dot>{t("prc.compliance.valid")}</Badge>;
}
