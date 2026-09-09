"use client";

/**
 * Receipts, tickets and the printer — FR-POS-100 … FR-POS-106.
 *
 * The requirement that shapes all of this is FR-POS-106: a printer failure
 * must never block the transaction. So printing is a *queue* with visible
 * state, not a synchronous call — the sale completes, the job waits, the
 * cashier is told, and the retry happens without anybody standing still.
 *
 * The other three:
 *
 *   - **Digital delivery** (FR-POS-103) by SMS, WhatsApp, email or QR, as an
 *     alternative to paper rather than an afterthought to it.
 *   - **Reprints are marked** (FR-POS-104). An unmarked duplicate is a second
 *     receipt for the same sale, which is exactly what a refund fraud needs.
 *   - **The kitchen ticket has its own language** (FR-POS-105). A cook who
 *     cannot read the ticket makes the wrong dish, and the language that
 *     fixes that is frequently neither the guest's nor the console's.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Printer,
  QrCode,
  RotateCw,
  Smartphone,
  X,
} from "lucide-react";

import type { Order } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime } from "@/lib/console/format";
import { localId, nowIso } from "@/lib/console/local-store";
import { normalisePhone } from "@/components/console/customer";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  Select,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// The print queue — FR-POS-106
// ---------------------------------------------------------------------------

export type PrintJobKind = "receipt" | "duplicate" | "pre_bill" | "kitchen" | "report";
export type PrintJobState = "queued" | "printing" | "printed" | "failed";

export interface PrintJob {
  id: string;
  kind: PrintJobKind;
  reference: string;
  target: string;
  state: PrintJobState;
  attempts: number;
  queuedAt: string;
  error: string | null;
}

const KEY = "ros.pos.printQueue";
type Listener = (jobs: PrintJob[]) => void;
const listeners = new Set<Listener>();

function read(): PrintJob[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PrintJob[]) : [];
  } catch {
    return [];
  }
}

function write(jobs: PrintJob[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, 100)));
  } catch {
    // Losing the queue across a reload is survivable; losing the sale is not.
  }
  for (const listener of listeners) listener(jobs);
}

/**
 * Queue a job and drive it to a terminal state.
 *
 * The transition is deliberate rather than instant: a job that flashes from
 * queued to printed gives the cashier nothing to look at, and the whole
 * point of the queue is that a stuck job is visible.
 */
export function usePrintQueue() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  useEffect(() => {
    setJobs(read());
    const listener: Listener = (next) => setJobs(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const settle = useCallback((id: string, state: PrintJobState, error: string | null) => {
    const current = read();
    const index = current.findIndex((job) => job.id === id);
    if (index === -1) return;
    current[index] = { ...current[index]!, state, error, attempts: current[index]!.attempts + 1 };
    write(current);
  }, []);

  const enqueue = useCallback(
    (input: { kind: PrintJobKind; reference: string; target: string }) => {
      const job: PrintJob = {
        id: localId("job"),
        ...input,
        state: "queued",
        attempts: 0,
        queuedAt: nowIso(),
        error: null,
      };
      write([job, ...read()]);

      window.setTimeout(() => {
        const current = read();
        const index = current.findIndex((entry) => entry.id === job.id);
        if (index === -1) return;
        current[index] = { ...current[index]!, state: "printing" };
        write(current);

        window.setTimeout(() => settle(job.id, "printed", null), 900);
      }, 250);

      return job;
    },
    [settle],
  );

  const retry = useCallback(
    (id: string) => {
      const current = read();
      const index = current.findIndex((job) => job.id === id);
      if (index === -1) return;
      current[index] = { ...current[index]!, state: "printing", error: null };
      write(current);
      window.setTimeout(() => settle(id, "printed", null), 900);
    },
    [settle],
  );

  const dismiss = useCallback((id: string) => {
    write(read().filter((job) => job.id !== id));
  }, []);

  const clear = useCallback(() => write([]), []);

  const pending = jobs.filter((job) => job.state === "queued" || job.state === "printing").length;
  const failed = jobs.filter((job) => job.state === "failed").length;

  return { jobs, enqueue, retry, dismiss, clear, pending, failed };
}

export function PrintQueueChip({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { pending, failed } = usePrintQueue();

  if (pending === 0 && failed === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs",
        failed > 0 ? "text-bad" : "text-fg-subtle",
      )}
      title={t("print.queueTitle")}
    >
      {failed > 0 ? (
        <AlertTriangle size={13} aria-hidden />
      ) : (
        <Printer size={13} aria-hidden />
      )}
      {failed > 0
        ? t("print.failedCount").replace("{n}", String(failed))
        : t("print.pendingCount").replace("{n}", String(pending))}
    </button>
  );
}

export function PrintQueueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const queue = usePrintQueue();

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("print.queueTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          {queue.jobs.length > 0 ? (
            <Button variant="ghost" onClick={queue.clear}>
              {t("print.clearFinished")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <Callout tone="muted">{t("print.queueNote")}</Callout>

        {queue.jobs.length === 0 ? (
          <p className="text-fg-subtle py-6 text-center text-sm">{t("print.queueEmpty")}</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {queue.jobs.map((job) => (
              <li key={job.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="shrink-0">
                  {job.state === "printed" ? (
                    <Check size={13} className="text-good" aria-hidden />
                  ) : job.state === "failed" ? (
                    <AlertTriangle size={13} className="text-bad" aria-hidden />
                  ) : (
                    <Loader2 size={13} className="text-accent animate-spin" aria-hidden />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate">
                    {t(`print.kind.${job.kind}` as never)} · {job.reference}
                  </span>
                  <span className="text-fg-subtle block truncate">
                    {job.target} · {formatDateTime(job.queuedAt, fmt)}
                  </span>
                </span>

                <Badge
                  tone={
                    job.state === "printed" ? "good" : job.state === "failed" ? "bad" : "accent"
                  }
                >
                  {t(`print.state.${job.state}` as never)}
                </Badge>

                {job.state === "failed" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCw size={12} />}
                    onClick={() => queue.retry(job.id)}
                  >
                    {t("print.retry")}
                  </Button>
                ) : null}

                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.close")}
                  icon={<X size={12} />}
                  onClick={() => queue.dismiss(job.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Digital delivery — FR-POS-103
// ---------------------------------------------------------------------------

type Channel = "sms" | "whatsapp" | "email" | "qr";

/**
 * Hand the receipt over without paper.
 *
 * The QR option is the one worth keeping even when the others are switched
 * off: it needs no address, no consent and no network on the guest's side
 * beyond a camera, and it is the only channel that works for a walk-in whose
 * details you do not have and should not ask for.
 */
export function ReceiptDeliverySheet({
  order,
  onClose,
  onSent,
}: {
  order: Order;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const { t } = useI18n();
  const [channel, setChannel] = useState<Channel>("qr");
  const [address, setAddress] = useState("");
  const [sending, setSending] = useState(false);

  const normalised =
    channel === "sms" || channel === "whatsapp" ? normalisePhone(address) : address.trim();

  const valid =
    channel === "qr" ||
    (channel === "email"
      ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)
      : normalised.length >= 8);

  const CHANNELS: { id: Channel; icon: typeof Mail }[] = [
    { id: "qr", icon: QrCode },
    { id: "sms", icon: MessageSquare },
    { id: "whatsapp", icon: Smartphone },
    { id: "email", icon: Mail },
  ];

  async function send() {
    if (!valid) return;
    setSending(true);
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    setSending(false);
    onSent(
      channel === "qr"
        ? t("print.qrShown")
        : t("print.sent").replace("{channel}", t(`print.channel.${channel}` as never)),
    );
    if (channel !== "qr") onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("print.deliverTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button variant="primary" disabled={!valid} loading={sending} onClick={send}>
            {channel === "qr" ? t("print.showQr") : t("print.send")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("print.deliverNote")}</Callout>

        <Field label={t("print.channel")}>
          <div className="grid grid-cols-2 gap-1.5">
            {CHANNELS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={channel === id}
                onClick={() => setChannel(id)}
                className={cx(
                  "flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                  channel === id
                    ? "border-accent bg-accent-soft text-accent font-medium"
                    : "border-line bg-raised text-fg-muted",
                )}
              >
                <Icon size={15} aria-hidden />
                {t(`print.channel.${id}` as never)}
              </button>
            ))}
          </div>
        </Field>

        {channel === "qr" ? (
          <div className="border-line flex flex-col items-center gap-3 rounded-xl border p-6">
            {/*
              A real QR carries a signed URL to the hosted receipt. Rendering
              the module grid from the order number keeps the affordance and
              the layout honest without inventing a link that resolves to
              nothing.
            */}
            <QrPlaceholder seed={order.orderNumber} />
            <p className="text-fg-muted text-center text-xs leading-relaxed">
              {t("print.qrHint")}
            </p>
          </div>
        ) : (
          <Field
            label={
              channel === "email" ? t("print.emailAddress") : t("print.phoneNumber")
            }
            hint={
              normalised && normalised !== address
                ? `${t("crm.storedAs")} ${normalised}`
                : undefined
            }
            required
          >
            <Input
              data-autofocus
              dir="ltr"
              inputMode={channel === "email" ? "email" : "tel"}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
        )}

        {channel !== "qr" ? (
          <Callout tone="warn">{t("print.consentNote")}</Callout>
        ) : null}
      </div>
    </Modal>
  );
}

/** A deterministic module grid — the shape of a QR, not a working one. */
function QrPlaceholder({ seed }: { seed: string }) {
  const size = 21;
  const cells: boolean[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < size * size; i += 1) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    cells.push((hash >>> 16) % 3 === 0);
  }

  // The three finder patterns, so it reads as a QR at a glance.
  const finder = (row: number, col: number) =>
    (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);

  return (
    <div
      aria-hidden
      className="grid gap-px bg-white p-3"
      style={{ gridTemplateColumns: `repeat(${size}, 6px)` }}
    >
      {cells.map((on, index) => {
        const row = Math.floor(index / size);
        const col = index % size;
        const isFinder = finder(row, col);
        const ring =
          isFinder &&
          (row % 7 === 0 || row % 7 === 6 || col % 7 === 0 || col % 7 === 6 ||
            (row % 7 >= 2 && row % 7 <= 4 && col % 7 >= 2 && col % 7 <= 4));
        return (
          <span
            key={index}
            className={cx("h-1.5 w-1.5", (isFinder ? ring : on) ? "bg-black" : "bg-white")}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kitchen ticket language — FR-POS-105
// ---------------------------------------------------------------------------

export const TICKET_LANGUAGES = ["ar", "en", "ur", "bn", "tl", "hi", "fr", "tr"] as const;
export type TicketLanguage = (typeof TICKET_LANGUAGES)[number];

const TICKET_LANGUAGE_KEY = "ros.pos.ticketLanguage";

/**
 * The kitchen's own language, independent of the console and the receipt.
 *
 * Kitchen staff in Gulf restaurants frequently read Urdu, Bengali or Tagalog
 * more fluently than Arabic or English. This is not a nicety: a cook who
 * cannot read the ticket produces the wrong dish.
 */
export function useTicketLanguage(): [TicketLanguage, (next: TicketLanguage) => void] {
  const [language, setLanguage] = useState<TicketLanguage>("ar");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TICKET_LANGUAGE_KEY);
      if (stored && (TICKET_LANGUAGES as readonly string[]).includes(stored)) {
        setLanguage(stored as TicketLanguage);
      }
    } catch {
      // Falls back to the tenant default.
    }
  }, []);

  const set = useCallback((next: TicketLanguage) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(TICKET_LANGUAGE_KEY, next);
    } catch {
      // Not persisting is survivable.
    }
  }, []);

  return [language, set];
}

export function TicketLanguagePicker({
  value,
  onChange,
}: {
  value: TicketLanguage;
  onChange: (next: TicketLanguage) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={t("print.ticketLanguage")} hint={t("print.ticketLanguageHint")}>
      <Select value={value} onChange={(event) => onChange(event.target.value as TicketLanguage)}>
        {TICKET_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {t(`lang.${code}` as never)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
