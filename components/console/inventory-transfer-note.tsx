"use client";

/**
 * Transfer notes — SRS FR-INV-033.
 *
 * "Transfers SHALL support a printed or digital transfer note with
 * barcode/QR for scanning at receipt."
 *
 * The note travels with the stock. Its QR carries what receiving needs —
 * the dispatch reference, the destination and the dispatched lines (see
 * `encodeTransferNote`) — so the receiving branch scans it and lands in the
 * receive form with the quantities filled in, even though the backend has no
 * transfer index to look the reference up in.
 *
 * Printed from a separate window containing only the notes, so the console
 * chrome never ends up on the driver's paperwork. The same note is shown on
 * screen as the digital version: a phone at the back door can scan it off
 * the dispatcher's tablet.
 */

import { useMemo, useState } from "react";
import { Copy, Printer, ScanLine } from "lucide-react";

import type { Id, Localised, StockItem, StockLocation, Transfer } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime, unitLabel } from "@/lib/console/format";
import { encodeQr, qrSvgPath } from "@/lib/console/qr";
import { decodeTransferNote, encodeTransferNote } from "@/lib/console/inventory-transfers";
import { Button, Callout, Drawer, Field, Input, Modal } from "@/components/console/ui";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function qrFor(transfer: Transfer): { path: string; size: number; payload: string } | null {
  const payload = encodeTransferNote(transfer);
  try {
    return { ...qrSvgPath(encodeQr(payload), 4), payload };
  } catch {
    return null;
  }
}

export function TransferNoteModal({ transfers, onClose }: { transfers: Transfer[]; onClose: () => void }) {
  const { t, tx, fmt, locale, dir } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const notes = useMemo(() => transfers.map((transfer) => ({ transfer, qr: qrFor(transfer) })), [transfers]);

  function print() {
    const popup = window.open("", "_blank", "width=800,height=900");
    if (!popup) {
      setMessage(t("invx.note.popupBlocked"));
      return;
    }
    const body = notes
      .map(({ transfer, qr }) => {
        const lines = transfer.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(tx(line.itemName) || line.itemId)}</td><td class="num">${escapeHtml(line.dispatched.value)} ${escapeHtml(unitLabel(line.dispatched.unit, locale))}</td><td class="box"></td></tr>`,
          )
          .join("");
        const code = qr
          ? `<svg viewBox="0 0 ${qr.size} ${qr.size}" width="150" height="150" shape-rendering="crispEdges"><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${qr.path}" fill="#000"/></svg>`
          : `<p>${escapeHtml(t("invx.note.qrTooLong"))}</p>`;
        return `<section class="note">
  <header><div><h1>${escapeHtml(t("invx.note.title"))}</h1><p class="ref">${escapeHtml(transfer.reference)}</p>
  <p>${escapeHtml(tx(transfer.fromLocationName))} → ${escapeHtml(tx(transfer.toLocationName))}</p>
  <p>${escapeHtml(t("inv.dispatched"))}: ${escapeHtml(transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt, fmt) : "—")}</p></div>${code}</header>
  <table><thead><tr><th>${escapeHtml(t("inv.item"))}</th><th class="num">${escapeHtml(t("inv.dispatched"))}</th><th>${escapeHtml(t("inv.received"))}</th></tr></thead><tbody>${lines}</tbody></table>
  <footer><div>${escapeHtml(t("invx.note.dispatchedBy"))}</div><div>${escapeHtml(t("invx.note.receivedBy"))}</div></footer>
  <p class="hint">${escapeHtml(t("invx.note.scanHint"))}</p>
</section>`;
      })
      .join("");
    popup.document.write(`<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(t("invx.note.title"))}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#000;margin:24px}
.note{page-break-after:always;border:1px solid #000;padding:16px;margin-bottom:24px}
header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
h1{font-size:18px;margin:0 0 4px}.ref{font:700 22px ui-monospace,monospace;margin:0 0 6px;direction:ltr}
p{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
th,td{border-bottom:1px solid #999;padding:6px;text-align:start}.num{text-align:end;direction:ltr}.box{width:120px}
footer{display:flex;gap:24px;margin-top:32px}footer div{flex:1;border-top:1px solid #000;padding-top:4px;font-size:12px}
.hint{color:#555;font-size:11px;margin-top:12px}
</style></head><body>${body}<script>window.onload=function(){window.print()}</script></body></html>`);
    popup.document.close();
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(notes.map(({ transfer }) => encodeTransferNote(transfer)).join("\n"));
      setMessage(t("invx.note.copied"));
    } catch {
      setMessage(t("invx.note.copyFailed"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("invx.note.title")}
      footer={
        <>
          <Button variant="ghost" icon={<Copy size={14} />} onClick={() => void copyCodes()}>
            {t("invx.note.copyCode")}
          </Button>
          <Button variant="primary" icon={<Printer size={14} />} onClick={print}>
            {t("invx.note.print")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {message ? <Callout tone="muted">{message}</Callout> : null}
        <p className="text-fg-muted text-xs">{t("invx.note.intro")}</p>
        {notes.map(({ transfer, qr }) => (
          <article key={transfer.id} className="border-line rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-fg font-mono text-lg font-semibold" dir="ltr">
                  {transfer.reference}
                </p>
                <p className="text-fg text-sm">
                  {tx(transfer.fromLocationName)} → {tx(transfer.toLocationName)}
                </p>
                <p className="text-fg-subtle text-xs">
                  {transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt, fmt) : "—"}
                </p>
                <ul className="text-fg-muted mt-2 space-y-0.5 text-xs">
                  {transfer.lines.map((line) => (
                    <li key={line.id || line.itemId}>
                      {tx(line.itemName) || line.itemId} ·{" "}
                      <span dir="ltr" className="font-mono">
                        {line.dispatched.value} {unitLabel(line.dispatched.unit, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {qr ? (
                <svg
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  className="h-36 w-36 shrink-0 rounded bg-white"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={`${t("invx.note.qrLabel")} ${transfer.reference}`}
                >
                  <rect width={qr.size} height={qr.size} fill="#fff" />
                  <path d={qr.path} fill="#000" />
                </svg>
              ) : (
                <Callout tone="warn">{t("invx.note.qrTooLong")}</Callout>
              )}
            </div>
            {qr && decodeTransferNote(qr.payload)?.truncated ? (
              <p className="text-warn mt-2 text-xs">{t("invx.note.truncated")}</p>
            ) : null}
          </article>
        ))}
      </div>
    </Modal>
  );
}

/**
 * FR-INV-033 — scan a transfer note at the back door.
 *
 * A 2D scanner types the QR's text and presses Enter, like any keyboard
 * wedge; typing the reference works too. The transfer is looked up first
 * (the demo registry has an index; the backend does not), and when it cannot
 * be found the note's own payload is enough to receive against.
 */
export function ScanTransferNoteDrawer({
  open,
  onClose,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  onResolved: (transfer: Transfer) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [text, setText] = useState("");

  const items = useAsync(
    () => services.inventory.items.list({ limit: 2000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
    [open],
  );
  const locations = useAsync(() => services.organisation.locations().catch(() => [] as StockLocation[]), [open]);

  if (!open) return null;

  async function resolve() {
    const code = text.trim();
    if (!code) return;
    await action.run(
      async () => {
        const payload = decodeTransferNote(code);
        const byId = payload ? await services.inventory.transfers.get(payload.transferId).catch(() => null) : null;
        if (byId) return byId;

        // A typed reference: only an index can answer that.
        if (!payload) {
          const page = await services.inventory.transfers.list({ search: code, limit: 5 });
          const match = page.rows.find((row) => row.reference.toLowerCase() === code.toLowerCase());
          if (match) return match;
          throw new Error(t("invx.note.notFound").replace("{code}", code));
        }

        // Build the transfer from the note itself.
        const itemById = new Map((items.data ?? []).map((item) => [item.id, item]));
        const nameOfLocation = (id: Id): Localised =>
          (locations.data ?? []).find((row) => row.id === id)?.name ?? { en: id, ar: id };
        const transfer: Transfer = {
          id: payload.transferId,
          tenantId: "",
          reference: payload.reference,
          fromLocationId: "",
          fromLocationName: { en: "—", ar: "—" },
          toLocationId: payload.toLocationId,
          toLocationName: nameOfLocation(payload.toLocationId),
          status: "dispatched",
          dispatchedAt: null,
          receivedAt: null,
          requestedBy: { en: "", ar: "" },
          lines: payload.lines.map((line, index) => {
            const item = itemById.get(line.itemId);
            return {
              id: `${payload.transferId}_${index}`,
              itemId: line.itemId,
              itemName: item?.name ?? { en: line.itemId, ar: line.itemId },
              dispatched: { value: line.quantity, unit: item?.baseUnit ?? "pc" },
              received: null,
              discrepancy: 0,
              unitCost: item?.unitCost ?? { amount: 0, currency: "EGP" },
            };
          }),
          totalValue: { amount: 0, currency: "EGP" },
        };
        if (transfer.lines.length === 0) throw new Error(t("invx.note.noLines"));
        return transfer;
      },
      {
        onSuccess: (transfer) => {
          setText("");
          onResolved(transfer);
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.note.scanTitle")}
      subtitle="FR-INV-033"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!text.trim()} onClick={() => void resolve()}>
            {t("invx.note.find")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted" icon={<ScanLine size={14} />}>
          {t("invx.note.scanBody")}
        </Callout>
        <Field label={t("invx.note.scanField")} hint={t("invx.note.scanFieldHint")}>
          <Input
            dir="ltr"
            className="font-mono"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void resolve();
              }
            }}
            data-autofocus
          />
        </Field>
      </div>
    </Drawer>
  );
}
