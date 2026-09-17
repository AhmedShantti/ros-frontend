"use client";

/**
 * After a receipt is posted — SRS §12.5, FR-PRC-032, FR-PRC-034, FR-PRC-037.
 *
 *   - **Ledger postings** (032): one `purchase_receipt` movement per accepted
 *     line, and a batch record for batch-tracked items where the ledger can
 *     create one. A line that failed is shown with its reason and retried on
 *     its own — never the lines that already landed.
 *   - **Delivery note and scans** (034): the photo taken at the door, and the
 *     codes scanned while receiving.
 *   - **Supplier returns** (037): goods sent back after receipt, as a negative
 *     `purchase_return` movement and an expected credit note, limited to what
 *     is left to return on each line.
 */

import { useMemo, useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";

import type { GoodsReceipt, StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ReceiptPosting, SupplierReturn } from "@/lib/console/services/purchasing-local";
import { decimalCompare, decimalSub, isPositiveDecimal } from "@/lib/console/stock-units";
import { DATA_MODE } from "@/lib/api/config";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatQuantity, money } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import { useActor } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Drawer, Field, Input } from "@/components/console/ui";

export function ReceiptAfterPosting({ receipt, onChanged }: { receipt: GoodsReceipt; onChanged: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const canReturn = usePermission("purchase.receipt.post");
  const action = useAction();
  const posting = useAsync(() => services.procurement.receiptPostings.get(receipt.id), [receipt.id]);
  const returns = useAsync(
    () => services.procurement.supplierReturns.all().then((rows) => rows.filter((row) => row.receiptId === receipt.id)),
    [receipt.id],
  );
  const [returning, setReturning] = useState(false);

  const record: ReceiptPosting | null = posting.data ?? null;
  const failed = record?.legs.filter((leg) => leg.error) ?? [];

  async function retry() {
    await action.run(() => services.procurement.retryReceiptPosting(receipt, { ledger: services.inventory }), {
      onSuccess: (next) => {
        posting.reload();
        onChanged(next.legs.some((leg) => leg.error) ? t("prc.post.stillFailing") : t("prc.post.retried"));
      },
    });
  }

  async function retryReturn(row: SupplierReturn) {
    await action.run(() => services.procurement.retryReturn(row.id, { ledger: services.inventory }), {
      onSuccess: () => {
        returns.reload();
        onChanged(t("prc.post.retried"));
      },
    });
  }

  return (
    <div className="space-y-5">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {/* FR-PRC-032 */}
      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("prc.post.title")}</h3>
        {!record ? (
          <p className="text-fg-subtle text-xs">{t("prc.post.none")}</p>
        ) : (
          <>
            {failed.length > 0 ? (
              <Callout tone="bad" title={t("prc.post.failedTitle").replace("{n}", String(failed.length))} className="mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{t("prc.post.failedBody")}</span>
                  <Button size="sm" icon={<RotateCcw size={12} />} loading={action.pending} onClick={retry}>
                    {t("prc.post.retry")}
                  </Button>
                </div>
              </Callout>
            ) : null}
            {DATA_MODE === "http" && record.legs.some((leg) => leg.batchNumber) ? <Callout tone="warn" className="mb-2">{t("prc.post.noBatchLive")}</Callout> : null}
            <ul className="border-line divide-line divide-y rounded-lg border text-xs">
              {record.legs.map((leg) => (
                <li key={leg.lineId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="text-fg min-w-0 flex-1">{tx(leg.itemName)}</span>
                  <span className="font-mono tabular-nums">{formatQuantity({ value: leg.quantity, unit: leg.unit }, fmt)}</span>
                  {leg.batchNumber ? (
                    <Badge tone={leg.batchId ? "good" : "muted"}>
                      {leg.batchId ? t("prc.post.batchCreated") : t("prc.post.batchNoted")} {leg.batchNumber}
                    </Badge>
                  ) : null}
                  {leg.movementId ? (
                    <Badge tone="good">{t("prc.post.posted")}</Badge>
                  ) : leg.error ? (
                    <span className="text-bad w-full">{leg.error}</span>
                  ) : (
                    <Badge tone="muted">{t("prc.post.nothing")}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* FR-PRC-034 */}
      {record?.deliveryNote || (record?.scans.length ?? 0) > 0 ? (
        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("prc.grn.deliveryNote")}</h3>
          {record?.deliveryNote?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL
            <img src={record.deliveryNote.dataUrl} alt={t("prc.grn.deliveryNote")} className="border-line max-h-80 w-full rounded-lg border object-contain" />
          ) : record?.deliveryNote ? (
            <p className="text-fg-subtle text-xs">{record.deliveryNote.name} — {t("prc.fileNotKept")}</p>
          ) : null}
          {(record?.scans.length ?? 0) > 0 ? (
            <p className="text-fg-subtle mt-2 text-xs">
              {t("prc.post.scans").replace("{n}", String(record!.scans.length))}: <span className="font-mono" dir="ltr">{record!.scans.join(", ")}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* FR-PRC-037 */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-fg text-sm font-semibold">{t("prc.ret.title")}</h3>
          {canReturn && receipt.status === "posted" ? (
            <Button size="sm" icon={<Undo2 size={12} />} onClick={() => setReturning(true)}>
              {t("prc.ret.open")}
            </Button>
          ) : null}
        </div>
        {(returns.data ?? []).length === 0 ? (
          <p className="text-fg-subtle text-xs">{t("prc.ret.none")}</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {(returns.data ?? []).map((row) => {
              const failing = row.lines.filter((line) => line.error);
              return (
                <li key={row.id} className="border-line rounded-lg border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-fg font-mono">{row.reference}</span>
                    <span className="text-fg-subtle">{formatDateTime(row.createdAt, fmt)} · {row.createdBy}</span>
                    <span className="ms-auto font-mono tabular-nums">{formatMoney(money(row.totalMinor, row.currency as "EGP"), fmt)}</span>
                  </div>
                  <ul className="text-fg-muted mt-1 space-y-0.5">
                    {row.lines.map((line) => (
                      <li key={line.lineId}>
                        {tx(line.itemName)} — {formatQuantity({ value: line.returned, unit: line.receiptUnit }, fmt)} · {line.reason}
                        {line.movementId ? "" : line.error ? ` · ${line.error}` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="warn">{t("prc.ret.creditExpected")}</Badge>
                    {failing.length > 0 ? (
                      <Button size="sm" icon={<RotateCcw size={12} />} loading={action.pending} onClick={() => void retryReturn(row)}>
                        {t("prc.post.retry")}
                      </Button>
                    ) : (
                      <Badge tone="good">{t("prc.post.posted")}</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {returning ? (
        <SupplierReturnDrawer
          receipt={receipt}
          onClose={() => setReturning(false)}
          onDone={(message) => {
            setReturning(false);
            returns.reload();
            onChanged(message);
          }}
        />
      ) : null}
    </div>
  );
}

function SupplierReturnDrawer({ receipt, onClose, onDone }: { receipt: GoodsReceipt; onClose: () => void; onDone: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const data = useAsync(
    () =>
      Promise.all([
        services.procurement.returnedQuantities(receipt.id),
        services.inventory.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
      ]),
    [receipt.id],
  );
  const [draft, setDraft] = useState<Record<string, { quantity: string; reason: string }>>({});

  const already = data.data?.[0];
  const rows = useMemo(
    () =>
      receipt.lines.map((line) => {
        const left = decimalSub(line.received.value || "0", already?.get(line.id) ?? "0");
        const entry = draft[line.id] ?? { quantity: "", reason: "" };
        const quantity = entry.quantity.trim();
        const over = quantity !== "" && isPositiveDecimal(quantity) && decimalCompare(quantity, left) > 0;
        const bad = quantity !== "" && !/^\d*\.?\d*$/.test(quantity);
        const needsReason = quantity !== "" && isPositiveDecimal(quantity) && !entry.reason.trim();
        return { line, left, entry, over, bad, needsReason, active: isPositiveDecimal(quantity || "0") };
      }),
    [receipt.lines, already, draft],
  );

  const active = rows.filter((row) => row.active);
  const invalid = rows.some((row) => row.over || row.bad || row.needsReason);
  const total = active.reduce((sum, row) => sum + Math.round(Number(row.entry.quantity) * row.line.unitPrice.amount), 0);

  function set(lineId: string, part: Partial<{ quantity: string; reason: string }>) {
    setDraft((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { quantity: "", reason: "" }), ...part } }));
  }

  async function submit() {
    const ok = await confirm({
      title: t("prc.ret.confirmTitle"),
      body: t("prc.ret.confirmBody").replace("{amount}", formatMoney(money(total, receipt.total.currency), fmt)),
      confirmLabel: t("prc.ret.submit"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      () =>
        services.procurement.createReturn(
          receipt,
          { lines: active.map((row) => ({ lineId: row.line.id, quantity: row.entry.quantity.trim(), reason: row.entry.reason })), items: data.data?.[1] ?? [], actor },
          { ledger: services.inventory },
        ),
      {
        onSuccess: (created) =>
          onDone(
            created.lines.some((line) => line.error)
              ? t("prc.ret.doneWithFailures")
              : t("prc.ret.done").replace("{ref}", created.reference),
          ),
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("prc.ret.drawerTitle").replace("{ref}", receipt.reference)}
      subtitle="FR-PRC-037"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={active.length === 0 || invalid || data.loading} onClick={submit}>
            {t("prc.ret.submit")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("prc.ret.note")}</Callout>
        <ul className="space-y-2">
          {rows.map(({ line, left, entry, over, bad, needsReason }) => (
            <li key={line.id} className="border-line rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-fg min-w-0 flex-1 text-sm">{tx(line.itemName)}</p>
                <span className="text-fg-subtle text-xs">
                  {t("prc.ret.left").replace("{qty}", formatQuantity({ value: left, unit: line.received.unit }, fmt))}
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Field label={t("prc.ret.quantity")} error={over ? t("prc.ret.over") : bad ? t("prc.ret.bad") : undefined}>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!isPositiveDecimal(left)}
                    value={entry.quantity}
                    onChange={(event) => set(line.id, { quantity: event.target.value })}
                    className="text-end font-mono tabular-nums"
                  />
                </Field>
                <Field label={t("prc.reason")} error={needsReason ? t("prc.ret.needReason") : undefined}>
                  <Input value={entry.reason} disabled={!isPositiveDecimal(left)} onChange={(event) => set(line.id, { reason: event.target.value })} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Callout tone="accent">{t("prc.ret.creditNote").replace("{amount}", formatMoney(money(total, receipt.total.currency), fmt))}</Callout>
      </div>
    </Drawer>
  );
}
