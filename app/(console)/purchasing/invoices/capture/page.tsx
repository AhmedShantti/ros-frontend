"use client";

/**
 * Invoice capture with human verification — SRS §12.6, FR-PRC-046.
 *
 * Photograph the supplier's invoice, then verify it field by field beside the
 * photo before it is posted. OCR would be an accelerator here, never an
 * authority: `lib/console/purchasing-ocr.ts` is the seam an engine plugs
 * into, and none is connected in this deployment — the screen says so and the
 * invoice is keyed by hand. Either way nothing posts until a person has ticked
 * every group of fields as checked against the photo, the lines add up to the
 * subtotal, and subtotal plus tax equals the total. The posted invoice then
 * runs the same three-way match as one recorded by hand (FR-PRC-041/042).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, X } from "lucide-react";

import type { GoodsReceipt, Id, SupplierInvoice } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { InvoiceCapture, StoredFile } from "@/lib/console/services/purchasing-local";
import { invoiceExtractor, LOW_CONFIDENCE, type InvoiceExtraction } from "@/lib/console/purchasing-ocr";
import { DEFAULT_POLICY, addDays, evaluateMatch } from "@/lib/console/purchasing-rules";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime, formatMoney, money } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { MoneyInput } from "@/components/console/fields";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { FileCapture, PRC_CURRENCY, useActor, usePolicy, useSupplierList } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Field, IconButton, Input, Select, Toast, cx } from "@/components/console/ui";

type Group = "supplier" | "number" | "date" | "lines" | "totals";
const GROUPS: Group[] = ["supplier", "number", "date", "lines", "totals"];

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPriceMinor: number | null;
  totalMinor: number | null;
}

let lineSeq = 0;
const newLine = (): LineDraft => ({ key: `cl${(lineSeq += 1)}`, description: "", quantity: "1", unitPriceMinor: null, totalMinor: null });

export default function InvoiceCapturePage() {
  return (
    <Gate permissions={["purchase.invoice.record"]}>
      <CaptureScreen />
    </Gate>
  );
}

function CaptureScreen() {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const { policy } = usePolicy();
  const suppliers = useSupplierList();
  const [message, setMessage] = useTransientMessage();
  const extractor = invoiceExtractor();

  const drafts = useAsync(() => services.procurement.captures.all().then((rows) => rows.filter((row) => row.status === "draft")), []);
  const receipts = useAsync(() => services.purchasing.receipts.list({ limit: 200, sort: "-receivedAt" }).then((page) => page.rows).catch(() => [] as GoodsReceipt[]), []);

  const [capture, setCapture] = useState<InvoiceCapture | null>(null);
  const [photo, setPhoto] = useState<StoredFile | null>(null);
  const [extraction, setExtraction] = useState<InvoiceExtraction | null>(null);
  const [supplierId, setSupplierId] = useState<Id>("");
  const [number, setNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [receiptId, setReceiptId] = useState<Id>("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [subtotal, setSubtotal] = useState<number | null>(null);
  const [tax, setTax] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [verified, setVerified] = useState<Record<Group, boolean>>({ supplier: false, number: false, date: false, lines: false, totals: false });

  function reset() {
    setCapture(null);
    setPhoto(null);
    setExtraction(null);
    setSupplierId("");
    setNumber("");
    setInvoiceDate(todayIso());
    setReceiptId("");
    setLines([newLine()]);
    setSubtotal(null);
    setTax(null);
    setTotal(null);
    setVerified({ supplier: false, number: false, date: false, lines: false, totals: false });
  }

  // Any edit to a group un-ticks it: verification is of what is on screen now.
  function touch(group: Group) {
    setVerified((current) => (current[group] ? { ...current, [group]: false } : current));
  }

  async function startCapture(file: StoredFile | null) {
    setPhoto(file);
    if (!file) return;
    await action.run(
      async () => {
        const created = await services.procurement.captures.create({ image: file, createdBy: actor.name, extractor: extractor?.id ?? null });
        setCapture(created);
        // FR-PRC-046 — pre-fill from OCR only where an engine is connected.
        if (extractor && file.dataUrl) {
          const blob = await (await fetch(file.dataUrl)).blob();
          const result = await extractor.extract(blob);
          setExtraction(result);
          if (result.invoiceNumber) setNumber(result.invoiceNumber.value);
          if (result.invoiceDate) setInvoiceDate(result.invoiceDate.value);
          if (result.supplierName) {
            const needle = result.supplierName.value.toLowerCase();
            const match = suppliers.rows.find((row) => [row.legalName.en, row.tradingName.en, row.legalName.ar, row.tradingName.ar].some((name) => name.toLowerCase() === needle));
            if (match) setSupplierId(match.id);
          }
          if (result.lines.length > 0) {
            setLines(
              result.lines.map((line) => ({
                key: `cl${(lineSeq += 1)}`,
                description: line.description.value,
                quantity: line.quantity.value,
                unitPriceMinor: line.unitPriceMinor.value,
                totalMinor: line.totalMinor.value,
              })),
            );
          }
          setSubtotal(result.subtotalMinor?.value ?? null);
          setTax(result.taxMinor?.value ?? null);
          setTotal(result.totalMinor?.value ?? null);
        }
        return created;
      },
    );
  }

  const linesSum = lines.reduce((sum, line) => sum + (line.totalMinor ?? 0), 0);
  const lineProblems = lines.filter(
    (line) =>
      !line.description.trim() ||
      !(Number(line.quantity) > 0) ||
      line.totalMinor === null ||
      (line.unitPriceMinor !== null && Math.abs(Math.round(Number(line.quantity) * line.unitPriceMinor) - line.totalMinor) > 1),
  ).length;
  const tolerances = policy?.tolerances ?? DEFAULT_POLICY.tolerances;
  const linesMatchSubtotal = subtotal !== null && Math.abs(linesSum - subtotal) <= tolerances.totalMinor;
  const totalsAddUp = subtotal !== null && total !== null && Math.abs(subtotal + (tax ?? 0) - total) <= tolerances.totalMinor;
  const receipt = (receipts.data ?? []).find((row) => row.id === receiptId) ?? null;

  const checks = useMemo(
    () =>
      receipt && subtotal !== null && total !== null
        ? evaluateMatch({ receiptValueMinor: receipt.total.amount, orderValueMinor: null, invoiceSubtotalMinor: subtotal, invoiceTaxMinor: tax ?? 0, invoiceTotalMinor: total, tolerances })
        : [],
    [receipt, subtotal, tax, total, tolerances],
  );
  const matched = checks.length > 0 && checks.every((row) => row.ok);

  const problems: string[] = [];
  if (!photo) problems.push(t("prc.cap.needPhoto"));
  if (!supplierId) problems.push(t("pur.needSupplier"));
  if (!number.trim()) problems.push(t("pur.needInvoiceNumber"));
  if (lineProblems > 0) problems.push(t("prc.cap.lineProblems").replace("{n}", String(lineProblems)));
  if (subtotal !== null && !linesMatchSubtotal) problems.push(t("prc.cap.linesMismatch"));
  if (subtotal === null || total === null) problems.push(t("prc.cap.needTotals"));
  else if (!totalsAddUp) problems.push(t("prc.cap.totalsMismatch"));
  if (receipt && receipt.supplierId !== supplierId) problems.push(t("prc.cap.receiptSupplier"));
  const unverified = GROUPS.filter((group) => !verified[group]);

  async function post() {
    if (!capture || problems.length > 0 || unverified.length > 0) return;
    const supplier = suppliers.rows.find((row) => row.id === supplierId);
    const matchSkipped = policy ? !policy.steps.threeWayMatch : false;
    const paymentSkipped = policy ? !policy.steps.paymentApproval : false;
    const status: SupplierInvoice["status"] = matchSkipped
      ? paymentSkipped
        ? "approved_for_payment"
        : "recorded"
      : receipt
        ? matched
          ? paymentSkipped
            ? "approved_for_payment"
            : "matched"
          : "disputed"
        : "recorded";
    await action.run(
      async () => {
        const created = await services.purchasing.invoices.create({
          supplierInvoiceNumber: number.trim(),
          supplierId,
          supplierName: supplier?.tradingName,
          goodsReceiptId: receipt?.id ?? null,
          goodsReceiptRef: receipt?.reference ?? null,
          purchaseOrderRef: receipt?.purchaseOrderRef ?? null,
          status,
          matchResult: receipt && !matchSkipped ? (matched ? "matched" : "disputed") : "unmatched",
          invoiceDate,
          dueDate: addDays(invoiceDate, supplier?.paymentTermsDays ?? 30),
          subtotal: money(subtotal ?? 0, PRC_CURRENCY),
          taxTotal: money(tax ?? 0, PRC_CURRENCY),
          total: money(total ?? 0, PRC_CURRENCY),
        });
        await services.procurement.recordInvoiceReview(
          created,
          { checks: checks.map((row) => ({ check: row.check, drift: row.drift, tolerance: row.tolerance, ok: row.ok })), captureId: capture.id },
          actor,
        );
        await services.procurement.captures.update(capture.id, { status: "posted", invoiceId: created.id, postedAt: new Date().toISOString() });
        return created;
      },
      {
        onSuccess: (created) => {
          setMessage(t("prc.cap.posted").replace("{number}", created.supplierInvoiceNumber));
          reset();
          drafts.reload();
        },
      },
    );
  }

  async function discard(row: InvoiceCapture) {
    const ok = await confirm({ title: t("prc.cap.discardTitle"), body: t("prc.cap.discardBody"), confirmLabel: t("prc.cap.discard"), tone: "danger" });
    if (!ok) return;
    await action.run(() => services.procurement.captures.update(row.id, { status: "discarded" }), {
      onSuccess: () => {
        if (capture?.id === row.id) reset();
        drafts.reload();
      },
    });
  }

  const confidence = (value: { confidence: number } | null | undefined) =>
    value ? (
      <Badge tone={value.confidence < LOW_CONFIDENCE ? "warn" : "muted"}>
        {t("prc.cap.ocrValue").replace("{n}", String(Math.round(value.confidence * 100)))}
      </Badge>
    ) : null;

  const verifyBox = (group: Group) => (
    <label className={cx("flex items-center gap-2 rounded-lg border px-2 py-1 text-xs", verified[group] ? "border-good/40 bg-good-soft text-good" : "border-line text-fg-muted")}>
      <input type="checkbox" checked={verified[group]} onChange={(event) => setVerified((current) => ({ ...current, [group]: event.target.checked }))} />
      {t("prc.cap.checked")}
    </label>
  );

  return (
    <>
      <PageHeader
        title={t("prc.cap.title")}
        subtitle={t("prc.cap.subtitle")}
        spec="FR-PRC-046"
        crumbs={[{ label: t("pur.invoicesTitle"), href: "/purchasing/invoices" }, { label: t("prc.cap.title") }]}
      />
      <PageBody>
        {extractor ? (
          <Callout tone="accent" title={t("prc.cap.ocrOnTitle")}>{t("prc.cap.ocrOnBody").replace("{id}", extractor.id)}</Callout>
        ) : (
          <Callout tone="warn" title={t("prc.cap.ocrOffTitle")}>{t("prc.cap.ocrOffBody")}</Callout>
        )}
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {(drafts.data ?? []).length > 0 && !capture ? (
          <Section title={t("prc.cap.drafts")}>
            <ul className="divide-line divide-y text-sm">
              {(drafts.data ?? []).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="text-fg min-w-0 flex-1">{row.image.name}</span>
                  <span className="text-fg-subtle text-xs">{formatDateTime(row.createdAt, fmt)} · {row.createdBy}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      reset();
                      setCapture(row);
                      setPhoto(row.image);
                    }}
                  >
                    {t("prc.cap.resume")}
                  </Button>
                  <IconButton label={t("prc.cap.discard")} icon={<Trash2 size={14} />} onClick={() => void discard(row)} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("prc.cap.photo")}>
            <FileCapture value={photo} onChange={(file) => (file ? void startCapture(file) : capture ? void discard(capture) : setPhoto(null))} label={t("prc.cap.takePhoto")} />
          </Section>

          <Section title={t("prc.cap.verify")} hint={t("prc.cap.verifyHint")}>
            <div className={cx("space-y-4", !capture && "pointer-events-none opacity-50")} aria-disabled={!capture}>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("pur.supplier")} required>
                    <Select value={supplierId} onChange={(event) => { setSupplierId(event.target.value); touch("supplier"); }}>
                      <option value="">—</option>
                      {suppliers.rows.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.tradingName.en}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {extraction?.supplierName ? <p className="text-fg-subtle mt-1 text-xs">{t("prc.cap.ocrRead").replace("{value}", extraction.supplierName.value)} {confidence(extraction.supplierName)}</p> : null}
                </div>
                {verifyBox("supplier")}
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("pur.invoiceNumber")} required>
                    <Input dir="ltr" value={number} onChange={(event) => { setNumber(event.target.value); touch("number"); }} className="font-mono" />
                  </Field>
                  {confidence(extraction?.invoiceNumber)}
                </div>
                {verifyBox("number")}
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("pur.invoiceDate")} required>
                    <Input type="date" dir="ltr" value={invoiceDate} onChange={(event) => { setInvoiceDate(event.target.value); touch("date"); }} />
                  </Field>
                  {confidence(extraction?.invoiceDate)}
                </div>
                {verifyBox("date")}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-fg text-sm font-semibold">{t("prc.cap.lines")}</h3>
                  {verifyBox("lines")}
                </div>
                <ul className="space-y-2">
                  {lines.map((line) => (
                    <li key={line.key} className="border-line grid gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
                      <Field label={t("prc.cap.description")}>
                        <Input value={line.description} onChange={(event) => { setLines((current) => current.map((row) => (row.key === line.key ? { ...row, description: event.target.value } : row))); touch("lines"); }} />
                      </Field>
                      <Field label={t("common.quantity")}>
                        <Input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => { setLines((current) => current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row))); touch("lines"); }} className="text-end font-mono tabular-nums" />
                      </Field>
                      <Field label={t("doc.unitPrice")}>
                        <MoneyInput value={line.unitPriceMinor} currency={PRC_CURRENCY} onChange={(minor) => { setLines((current) => current.map((row) => (row.key === line.key ? { ...row, unitPriceMinor: minor } : row))); touch("lines"); }} aria-label={t("doc.unitPrice")} />
                      </Field>
                      <Field label={t("common.total")}>
                        <MoneyInput value={line.totalMinor} currency={PRC_CURRENCY} onChange={(minor) => { setLines((current) => current.map((row) => (row.key === line.key ? { ...row, totalMinor: minor } : row))); touch("lines"); }} aria-label={t("common.total")} />
                      </Field>
                      <IconButton label={t("prc.cap.removeLine")} icon={<X size={14} />} disabled={lines.length === 1} onClick={() => { setLines((current) => current.filter((row) => row.key !== line.key)); touch("lines"); }} />
                    </li>
                  ))}
                </ul>
                <Button size="sm" className="mt-2" icon={<Plus size={12} />} onClick={() => { setLines((current) => [...current, newLine()]); touch("lines"); }}>
                  {t("prc.cap.addLine")}
                </Button>
                <p className="text-fg-subtle mt-1 text-xs">{t("prc.cap.linesSum").replace("{amount}", formatMoney(money(linesSum, PRC_CURRENCY), fmt))}</p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-fg text-sm font-semibold">{t("prc.cap.totals")}</h3>
                  {verifyBox("totals")}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label={t("doc.subtotal")} required>
                    <MoneyInput value={subtotal} currency={PRC_CURRENCY} onChange={(minor) => { setSubtotal(minor); touch("totals"); }} aria-label={t("doc.subtotal")} />
                  </Field>
                  <Field label={t("doc.tax")}>
                    <MoneyInput value={tax} currency={PRC_CURRENCY} onChange={(minor) => { setTax(minor); touch("totals"); }} aria-label={t("doc.tax")} />
                  </Field>
                  <Field label={t("prc.inv.printedTotal")} required>
                    <MoneyInput value={total} currency={PRC_CURRENCY} onChange={(minor) => { setTotal(minor); touch("totals"); }} aria-label={t("prc.inv.printedTotal")} />
                  </Field>
                </div>
              </div>

              <Field label={t("pur.againstReceipt")} hint={t("pur.againstReceiptHint")}>
                <Select value={receiptId} onChange={(event) => setReceiptId(event.target.value)}>
                  <option value="">{t("pur.noReceipt")}</option>
                  {(receipts.data ?? []).filter((row) => !supplierId || row.supplierId === supplierId).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.reference} · {row.supplierName.en}
                    </option>
                  ))}
                </Select>
              </Field>

              {checks.length > 0 ? (
                <Callout tone={matched ? "good" : "warn"} title={t("pur.threeWayMatch")}>
                  {checks.map((row) => `${t(`prc.check.${row.check}` as ConsoleKey)}: ${row.ok ? "✓" : "✗"}`).join(" · ")}
                </Callout>
              ) : null}

              {problems.length > 0 ? (
                <ul className="text-bad space-y-0.5 text-xs">
                  {problems.map((problem) => (
                    <li key={problem}>• {problem}</li>
                  ))}
                </ul>
              ) : null}
              {unverified.length > 0 && problems.length === 0 ? (
                <Callout tone="warn">{t("prc.cap.stillUnverified").replace("{groups}", unverified.map((group) => t(`prc.cap.group.${group}` as ConsoleKey)).join(", "))}</Callout>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={action.pending} disabled={!capture || problems.length > 0 || unverified.length > 0} onClick={post}>
                  {t("prc.cap.post")}
                </Button>
                <Link href="/purchasing/invoices">
                  <Button variant="ghost">{t("common.cancel")}</Button>
                </Link>
              </div>
            </div>
          </Section>
        </div>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

