"use client";

/**
 * Transfer requests — SRS FR-BRN-016.
 *
 * A branch asks; the source approves (in full, cut, or not at all) and
 * dispatches. The request and the decision are kept by
 * `services.transferRequests` (browser-local — the backend has no request
 * document); the dispatch is the real `POST /inventory/transfers`, one per
 * approved line because the API moves one item per transfer, and each
 * transfer's reference is written back onto its line.
 *
 * Segregation: the person who raised a request cannot approve or reject it.
 * A cut or a rejection needs a written reason, because "the cream did not
 * come" is the conversation this record exists to settle.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Send, X } from "lucide-react";

import type { Id, IsoDate, Localised, StockItem, StockLevel, StockLocation, Transfer } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  MIN_DECISION_NOTE,
  type TransferRequest,
  type TransferRequestStatus,
} from "@/lib/console/services/inventory-transfer-requests";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatNumber, unitLabel } from "@/lib/console/format";
import { decimalCompare, isPositiveDecimal } from "@/lib/console/stock-units";
import type { ConsoleKey } from "@/locales";
import { useConfirm } from "@/components/console/confirm";
import { SearchSelect } from "@/components/console/fields";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar } from "@/components/console/page";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  Toast,
} from "@/components/console/ui";

const STATUS_TONE: Record<TransferRequestStatus, "warn" | "accent" | "good" | "bad" | "muted"> = {
  requested: "warn",
  approved: "accent",
  partially_approved: "accent",
  rejected: "bad",
  dispatched: "good",
  cancelled: "muted",
};

const STATUSES: TransferRequestStatus[] = ["requested", "approved", "partially_approved", "rejected", "dispatched", "cancelled"];

export interface RequestPrefill {
  fromLocationId: Id;
  toLocationId: Id;
  itemId: Id;
  quantity: string;
  note: string;
  suggestionId: string;
}

export function TransferRequestsPanel({
  creating,
  onCreatingChange,
  prefill,
  onDispatched,
}: {
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
  prefill: RequestPrefill | null;
  /** The real transfers a dispatch created — the page opens their note. */
  onDispatched: (transfers: Transfer[]) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<TransferRequest | null>(null);
  const [message, setMessage] = useTransientMessage();

  const locations = useAsync(() => services.organisation.locations().catch(() => [] as StockLocation[]), []);

  const collection = useCollection<TransferRequest>((query) => services.transferRequests.list(query), {
    initialSort: "-requestedAt",
    pageSize: 25,
  });

  // Scope: a branch sees requests it raised and requests made of it.
  const rows = useMemo(
    () =>
      scope.branchId
        ? collection.rows.filter((row) => row.toLocationId === scope.branchId || row.fromLocationId === scope.branchId)
        : collection.rows,
    [collection.rows, scope.branchId],
  );

  const columns = useMemo<Column<TransferRequest>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.requestedByName) || row.requestedBy || undefined}
          />
        ),
      },
      {
        key: "route",
        header: t("invx.req.route"),
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-fg">{tx(row.toLocationName)}</span>
            <span className="text-fg-subtle text-xs">{t("invx.req.asks")}</span>
            <span className="text-fg">{tx(row.fromLocationName)}</span>
          </span>
        ),
      },
      {
        key: "lines",
        header: t("invx.req.lines"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lines.length, fmt),
      },
      {
        key: "neededBy",
        header: t("invx.req.neededBy"),
        sortable: true,
        render: (row) => formatDate(row.neededBy, fmt),
      },
      {
        key: "requestedAt",
        header: t("common.created"),
        sortable: true,
        secondary: true,
        render: (row) => formatDateTime(row.requestedAt, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => (
          <Badge tone={STATUS_TONE[row.status]} dot>
            {t(`invx.req.status.${row.status}` as ConsoleKey)}
          </Badge>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("invx.req.localNote")}</Callout>

      <CollectionToolbar
        collection={collection}
        filters={[
          {
            key: "status",
            label: t("common.status"),
            options: STATUSES.map((value) => ({ value, label: t(`invx.req.status.${value}` as ConsoleKey) })),
          },
          {
            key: "toLocationId",
            label: t("invx.req.requester"),
            options: (locations.data ?? []).map((row) => ({ value: row.id, label: tx(row.name) })),
          },
          {
            key: "fromLocationId",
            label: t("invx.req.source"),
            options: (locations.data ?? []).map((row) => ({ value: row.id, label: tx(row.name) })),
          },
        ]}
      />

      <CollectionTable
        collection={{ ...collection, rows }}
        columns={columns}
        rowKey={(row) => row.id}
        caption={t("invx.req.title")}
        onRowClick={setSelected}
        activeRowKey={selected?.id ?? null}
        dense
      />

      {creating ? (
        <NewRequestDrawer
          prefill={prefill}
          onClose={() => onCreatingChange(false)}
          onCreated={(created) => {
            onCreatingChange(false);
            setMessage(t("invx.req.created"));
            collection.reload();
            setSelected(created);
          }}
        />
      ) : null}

      {selected ? (
        <RequestDrawer
          key={selected.id}
          request={selected}
          onClose={() => setSelected(null)}
          onChanged={(next, note) => {
            setSelected(next);
            setMessage(note);
            collection.reload();
          }}
          onDispatched={onDispatched}
        />
      ) : null}

      <Toast message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DraftLine {
  key: string;
  itemId: Id | null;
  quantity: string;
}

function todayPlus(days: number): IsoDate {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function NewRequestDrawer({
  prefill,
  onClose,
  onCreated,
}: {
  prefill: RequestPrefill | null;
  onClose: () => void;
  onCreated: (request: TransferRequest) => void;
}) {
  const { t, tx, locale } = useI18n();
  const { scope, session } = useSession();
  const action = useAction();

  const locations = useAsync(() => services.organisation.locations().catch(() => [] as StockLocation[]), []);
  const items = useAsync(
    () => services.inventory.items.list({ limit: 2000 }).then((page) => page.rows).catch(() => [] as StockItem[]),
    [],
  );
  const levels = useAsync(
    () => services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows).catch(() => [] as StockLevel[]),
    [],
  );

  const [toLocationId, setTo] = useState<Id>(prefill?.toLocationId ?? scope.branchId ?? "");
  const [fromLocationId, setFrom] = useState<Id>(prefill?.fromLocationId ?? "");
  const [neededBy, setNeededBy] = useState<IsoDate>(todayPlus(1));
  const [note, setNote] = useState(prefill?.note ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => [
    { key: "l0", itemId: prefill?.itemId ?? null, quantity: prefill?.quantity ?? "" },
  ]);

  useEffect(() => {
    const rows = locations.data;
    if (!rows || rows.length === 0) return;
    if (!toLocationId) setTo(rows[0]!.id);
    if (!fromLocationId) setFrom(rows.find((row) => row.kind !== "branch")?.id ?? rows[1]?.id ?? rows[0]!.id);
  }, [locations.data, toLocationId, fromLocationId]);

  const itemById = useMemo(() => new Map((items.data ?? []).map((item) => [item.id, item])), [items.data]);
  const onHandAt = (locationId: Id, itemId: Id | null) =>
    itemId ? (levels.data ?? []).find((row) => row.locationId === locationId && row.itemId === itemId) : undefined;

  const problems: string[] = [];
  if (!toLocationId || !fromLocationId) problems.push(t("invx.req.needLocations"));
  if (toLocationId && toLocationId === fromLocationId) problems.push(t("inv.sameLocation"));
  if (!neededBy) problems.push(t("invx.req.needDate"));
  const filled = lines.filter((line) => line.itemId);
  if (filled.length === 0) problems.push(t("invx.req.needLine"));
  if (filled.some((line) => !isPositiveDecimal(line.quantity))) problems.push(t("invx.req.needQuantity"));
  if (new Set(filled.map((line) => line.itemId)).size !== filled.length) problems.push(t("invx.req.duplicateItem"));

  const nameOf = (id: Id): Localised => (locations.data ?? []).find((row) => row.id === id)?.name ?? { en: id, ar: id };

  async function submit() {
    if (problems.length > 0) return;
    await action.run(
      () =>
        services.transferRequests.create({
          fromLocationId,
          fromLocationName: nameOf(fromLocationId),
          toLocationId,
          toLocationName: nameOf(toLocationId),
          neededBy,
          note,
          lines: filled.map((line) => {
            const item = itemById.get(line.itemId!);
            return {
              itemId: line.itemId!,
              itemName: item?.name ?? { en: line.itemId!, ar: line.itemId! },
              unit: item?.baseUnit ?? "pc",
              requested: line.quantity.trim(),
            };
          }),
          by: session?.user.email ?? null,
          byName: session?.user.name ?? null,
          suggestionId: prefill?.suggestionId ?? null,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.req.new")}
      subtitle="FR-BRN-016"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={() => void submit()}>
            {t("invx.req.send")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {prefill ? <Callout tone="accent">{t("invx.req.fromSuggestion")}</Callout> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("invx.req.requester")} required>
            <Select value={toLocationId} onChange={(event) => setTo(event.target.value)}>
              <option value="">—</option>
              {(locations.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("invx.req.source")}
            required
            error={toLocationId && toLocationId === fromLocationId ? t("inv.sameLocation") : undefined}
          >
            <Select value={fromLocationId} onChange={(event) => setFrom(event.target.value)}>
              <option value="">—</option>
              {(locations.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("invx.req.neededBy")} required>
            <Input type="date" dir="ltr" value={neededBy} min={todayPlus(0)} onChange={(event) => setNeededBy(event.target.value)} />
          </Field>
        </div>

        <section className="space-y-2">
          <h3 className="text-fg text-sm font-semibold">{t("invx.req.lines")}</h3>
          {lines.map((line) => {
            const item = line.itemId ? itemById.get(line.itemId) : undefined;
            const atSource = onHandAt(fromLocationId, line.itemId);
            const atRequester = onHandAt(toLocationId, line.itemId);
            return (
              <div key={line.key} className="border-line space-y-2 rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchSelect
                      value={line.itemId}
                      onChange={(itemId) =>
                        setLines((current) => current.map((row) => (row.key === line.key ? { ...row, itemId } : row)))
                      }
                      options={(items.data ?? []).map((row) => ({ value: row.id, label: tx(row.name), hint: row.sku }))}
                      placeholder={t("inv.item")}
                      aria-label={t("inv.item")}
                    />
                  </div>
                  <div className="w-32">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      value={line.quantity}
                      placeholder={item ? unitLabel(item.baseUnit, locale) : t("inv.quantity")}
                      aria-label={t("inv.quantity")}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)),
                        )
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.remove")}
                    icon={<X size={12} />}
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  />
                </div>
                {line.itemId ? (
                  <p className="text-fg-subtle text-xs">
                    {t("invx.req.onHandAt")
                      .replace("{source}", atSource ? atSource.onHand.value : "—")
                      .replace("{mine}", atRequester ? atRequester.onHand.value : "—")
                      .replace("{unit}", item ? unitLabel(item.baseUnit, locale) : "")}
                  </p>
                ) : null}
              </div>
            );
          })}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => setLines((current) => [...current, { key: `l${Date.now()}`, itemId: null, quantity: "" }])}
          >
            {t("invx.req.addLine")}
          </Button>
        </section>

        <Field label={t("common.notes")} hint={t("invx.req.noteHint")}>
          <Textarea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
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

// ---------------------------------------------------------------------------

function RequestDrawer({
  request,
  onClose,
  onChanged,
  onDispatched,
}: {
  request: TransferRequest;
  onClose: () => void;
  onChanged: (next: TransferRequest, message: string) => void;
  onDispatched: (transfers: Transfer[]) => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const canTransfer = usePermission("inventory.transfer.create");
  const action = useAction();
  const me = session?.user.email ?? null;
  const mine = Boolean(me && request.requestedBy === me);

  const [approved, setApproved] = useState<Record<Id, string>>(() =>
    Object.fromEntries(request.lines.map((line) => [line.id, line.approved ?? line.requested])),
  );
  const [decisionNote, setDecisionNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [dispatchErrors, setDispatchErrors] = useState<Record<Id, string>>({});

  const levels = useAsync(
    () =>
      services.inventory.levels
        .list({ limit: 5000, filters: { locationId: request.fromLocationId } })
        .then((page) => page.rows)
        .catch(() => [] as StockLevel[]),
    [request.fromLocationId],
  );

  const deciding = request.status === "requested" && canTransfer && !mine;
  const cut = request.lines.some((line) => {
    const value = approved[line.id] ?? line.requested;
    return /^\d*\.?\d+$/.test(value.trim()) && decimalCompare(value.trim(), line.requested) < 0;
  });
  const invalid = request.lines.some((line) => {
    const value = (approved[line.id] ?? "").trim();
    return !/^\d*\.?\d+$/.test(value) || decimalCompare(value, line.requested) > 0;
  });
  const nothing = request.lines.every((line) => Number(approved[line.id] ?? 0) <= 0);
  const noteShort = cut && decisionNote.trim().length < MIN_DECISION_NOTE;

  async function approve() {
    await action.run(
      () => services.transferRequests.decide(request.id, { approved, note: decisionNote, by: me }),
      { onSuccess: (next) => onChanged(next, t("invx.req.approvedToast")) },
    );
  }

  async function reject() {
    await action.run(() => services.transferRequests.reject(request.id, { note: decisionNote, by: me }), {
      onSuccess: (next) => {
        setRejecting(false);
        onChanged(next, t("invx.req.rejectedToast"));
      },
    });
  }

  async function cancel() {
    const ok = await confirm({
      title: t("invx.req.cancelTitle"),
      body: t("invx.req.cancelBody").replace("{ref}", request.reference),
      confirmLabel: t("invx.req.cancelConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.transferRequests.cancel(request.id, { note: "", by: me }), {
      onSuccess: (next) => onChanged(next, t("invx.req.cancelledToast")),
    });
  }

  /**
   * One real dispatch per approved line not yet sent. A line that fails
   * keeps its error and can be retried; the ones that went are recorded.
   */
  async function dispatch() {
    const pending = request.lines.filter((line) => line.approved && Number(line.approved) > 0 && !line.transferId);
    const ok = await confirm({
      title: t("invx.req.dispatchTitle"),
      body: t("invx.req.dispatchBody")
        .replace("{n}", String(pending.length))
        .replace("{from}", tx(request.fromLocationName))
        .replace("{to}", tx(request.toLocationName)),
      confirmLabel: t("inv.dispatch"),
      tone: "warn",
    });
    if (!ok) return;

    await action.run(async () => {
      const sent: { lineId: Id; transferId: Id; transferReference: string }[] = [];
      const created: Transfer[] = [];
      const errors: Record<Id, string> = {};
      const byItem = new Map((levels.data ?? []).map((row) => [row.itemId, row]));
      for (const line of pending) {
        try {
          const transfer = await services.inventory.transfers.create({
            fromLocationId: request.fromLocationId,
            fromLocationName: request.fromLocationName,
            toLocationId: request.toLocationId,
            toLocationName: request.toLocationName,
            lines: [
              {
                id: "",
                itemId: line.itemId,
                itemName: line.itemName,
                dispatched: { value: line.approved!, unit: line.unit as never },
                received: null,
                discrepancy: 0,
                unitCost: byItem.get(line.itemId)?.unitCost ?? { amount: 0, currency: "EGP" },
              },
            ],
          });
          created.push({
            ...transfer,
            reference: transfer.reference || request.reference,
            lines: transfer.lines.length > 0 ? transfer.lines : [],
          });
          sent.push({ lineId: line.id, transferId: transfer.id, transferReference: transfer.reference || transfer.id });
        } catch (caught) {
          errors[line.id] = caught instanceof Error ? caught.message : String(caught);
        }
      }
      setDispatchErrors(errors);
      let next = request;
      if (sent.length > 0) {
        next = await services.transferRequests.recordDispatch(request.id, { lines: sent, by: me });
        onDispatched(created);
      }
      onChanged(next, sent.length > 0 ? t("invx.req.dispatchedToast").replace("{n}", String(sent.length)) : t("invx.req.dispatchFailed"));
    });
  }

  const onHandOf = (itemId: Id) => (levels.data ?? []).find((row) => row.itemId === itemId);

  const lineColumns: Column<TransferRequest["lines"][number]>[] = [
    {
      key: "item",
      header: t("inv.item"),
      render: (line) => (
        <CellStack
          primary={tx(line.itemName)}
          secondary={
            dispatchErrors[line.id] ? (
              <span className="text-bad">{dispatchErrors[line.id]}</span>
            ) : line.transferReference ? (
              <span className="font-mono">{line.transferReference}</span>
            ) : undefined
          }
        />
      ),
    },
    {
      key: "requested",
      header: t("invx.req.requested"),
      numeric: true,
      render: (line) => (
        <span dir="ltr" className="font-mono">
          {line.requested} {unitLabel(line.unit as never, locale)}
        </span>
      ),
    },
    {
      key: "source",
      header: t("invx.req.sourceOnHand"),
      numeric: true,
      secondary: true,
      render: (line) => {
        const level = onHandOf(line.itemId);
        if (!level) return <span className="text-fg-subtle">—</span>;
        const short = decimalCompare(level.onHand.value, approved[line.id] || line.requested) < 0;
        return (
          <span dir="ltr" className={short ? "text-warn font-mono" : "font-mono"}>
            {level.onHand.value}
          </span>
        );
      },
    },
    {
      key: "approved",
      header: t("invx.req.approved"),
      numeric: true,
      render: (line) =>
        deciding ? (
          <Input
            dir="ltr"
            inputMode="decimal"
            className="w-24 text-end font-mono"
            value={approved[line.id] ?? ""}
            aria-label={`${t("invx.req.approved")} ${tx(line.itemName)}`}
            onChange={(event) => setApproved((current) => ({ ...current, [line.id]: event.target.value }))}
          />
        ) : line.approved !== null ? (
          <span dir="ltr" className="font-mono">
            {line.approved}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  const readyToDispatch =
    (request.status === "approved" || request.status === "partially_approved") &&
    request.lines.some((line) => line.approved && Number(line.approved) > 0 && !line.transferId);

  return (
    <Drawer
      open
      onClose={onClose}
      title={request.reference}
      subtitle={
        <span className="flex items-center gap-1.5">
          {tx(request.fromLocationName)}
          <ArrowRight size={11} className="rtl:rotate-180" aria-hidden />
          {tx(request.toLocationName)}
        </span>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          {deciding ? (
            <>
              <Button variant="danger" onClick={() => setRejecting(true)} disabled={action.pending}>
                {t("common.reject")}
              </Button>
              <Button
                variant="primary"
                loading={action.pending}
                disabled={invalid || nothing || noteShort}
                onClick={() => void approve()}
              >
                {cut ? t("invx.req.approveCut") : t("common.approve")}
              </Button>
            </>
          ) : null}
          {request.status === "requested" && mine ? (
            <Button variant="ghost" onClick={() => void cancel()} disabled={action.pending}>
              {t("invx.req.cancelConfirm")}
            </Button>
          ) : null}
          {readyToDispatch && canTransfer ? (
            <Button variant="primary" icon={<Send size={14} />} loading={action.pending} onClick={() => void dispatch()}>
              {t("inv.dispatch")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {request.status === "requested" && mine ? <Callout tone="muted">{t("invx.req.ownRequest")}</Callout> : null}
        {request.status === "requested" && !canTransfer ? <Callout tone="muted">{t("invx.req.noPermission")}</Callout> : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={STATUS_TONE[request.status]} dot>
              {t(`invx.req.status.${request.status}` as ConsoleKey)}
            </Badge>
          </DescRow>
          <DescRow label={t("invx.req.requester")}>{tx(request.toLocationName)}</DescRow>
          <DescRow label={t("invx.req.source")}>{tx(request.fromLocationName)}</DescRow>
          <DescRow label={t("invx.req.neededBy")}>{formatDate(request.neededBy, fmt)}</DescRow>
          <DescRow label={t("invx.req.raisedBy")}>
            {tx(request.requestedByName) || request.requestedBy || "—"} · {formatDateTime(request.requestedAt, fmt)}
          </DescRow>
          {request.decidedAt ? (
            <DescRow label={t("invx.req.decidedBy")}>
              {request.decidedBy ?? "—"} · {formatDateTime(request.decidedAt, fmt)}
            </DescRow>
          ) : null}
          {request.note ? <DescRow label={t("common.notes")}>{request.note}</DescRow> : null}
          {request.decisionNote ? <DescRow label={t("invx.req.decisionNote")}>{request.decisionNote}</DescRow> : null}
        </DescList>

        <DataTable columns={lineColumns} rows={request.lines} rowKey={(line) => line.id} caption={t("invx.req.lines")} dense />

        {deciding ? (
          <Field
            label={t("invx.req.decisionNote")}
            hint={cut ? t("invx.req.cutNoteHint").replace("{n}", String(MIN_DECISION_NOTE)) : t("invx.req.decisionNoteHint")}
            required={cut}
            error={noteShort && decisionNote.length > 0 ? t("invx.req.noteTooShort") : undefined}
          >
            <Textarea rows={2} value={decisionNote} maxLength={500} onChange={(event) => setDecisionNote(event.target.value)} />
          </Field>
        ) : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("invx.req.history")}</h3>
          <ol className="border-line space-y-2 border-s ps-3">
            {request.history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="text-xs">
                <p className="text-fg">
                  {t(`invx.req.status.${event.action}` as ConsoleKey)} · {event.by ?? "—"}
                </p>
                <p className="text-fg-subtle">{formatDateTime(event.at, fmt)}</p>
                {event.note ? <p className="text-fg-muted mt-0.5">{event.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {rejecting ? (
        <Modal
          open
          onClose={() => setRejecting(false)}
          title={t("invx.req.rejectTitle").replace("{ref}", request.reference)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={action.pending}
                disabled={decisionNote.trim().length < MIN_DECISION_NOTE}
                onClick={() => void reject()}
              >
                {t("common.reject")}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
            <Field
              label={t("invx.req.decisionNote")}
              hint={t("invx.req.cutNoteHint").replace("{n}", String(MIN_DECISION_NOTE))}
              required
            >
              <Textarea rows={3} value={decisionNote} maxLength={500} onChange={(event) => setDecisionNote(event.target.value)} data-autofocus />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Drawer>
  );
}
