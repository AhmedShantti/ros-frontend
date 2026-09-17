"use client";

/**
 * Data subject requests — FR-SEC-062.
 *
 * The tenant-level register of access, rectification and erasure requests:
 * received through which channel, identity checked, what was done, and
 * whether it was done inside the 30-day window. The actions themselves are
 * the customer module's (`services.crm.customers.exportOne` / `.erase`,
 * FR-CRM-009) — the register drives them for the linked customer and keeps
 * the evidence. Erasure is anonymisation: orders and payments stay, as the
 * financial record requires.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Eraser, Plus, UserPen } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import type { Customer } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useActor, useSecurityLog } from "@/lib/console/security-log";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import {
  DSR_CHANNELS,
  DSR_RESPONSE_DAYS,
  DSR_STATUSES,
  DSR_TYPES,
  allowedNext,
  isOverdue,
  type DataSubjectRequest,
  type DsrChannel,
  type DsrStatus,
  type DsrType,
} from "@/lib/console/services/security-dsr";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { MetricTile } from "@/components/console/charts";
import { PageBody, PageHeader, TileGrid, Toolbar } from "@/components/console/page";
import { ErrorCallout, ErrorPanel, Gate } from "@/components/console/states";
import { SearchSelect } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { ClassificationBadge, SensitiveValue } from "@/components/console/security-sensitive";
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
  Toggle,
} from "@/components/console/ui";

export default function PrivacyRequestsPage() {
  return (
    <Gate permissions={["crm.customer.erase", "crm.customer.export", "audit.view", "settings.tenant.manage"]}>
      <PrivacyScreen />
    </Gate>
  );
}

const STATUS_TONE: Record<DsrStatus, "neutral" | "accent" | "warn" | "good" | "bad"> = {
  received: "neutral",
  verifying: "accent",
  in_progress: "warn",
  completed: "good",
  rejected: "bad",
};

function PrivacyScreen() {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useTransientMessage();
  const [status, setStatus] = useState<DsrStatus | "">("");
  const [type, setType] = useState<DsrType | "">("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const requests = useAsync(
    () => services.dataSubjectRequests.requests.list({ limit: 1000, sort: "-receivedAt" }).then((page) => page.rows),
    [],
  );
  const all = requests.data ?? [];
  const rows = all.filter((row) => (!status || row.status === status) && (!type || row.type === type));
  const selected = all.find((row) => row.id === selectedId) ?? null;

  const totals = useMemo(() => {
    const open = all.filter((row) => row.status !== "completed" && row.status !== "rejected");
    return { open: open.length, overdue: open.filter((row) => isOverdue(row)).length, done: all.length - open.length };
  }, [all]);

  const columns: Column<DataSubjectRequest>[] = [
    {
      key: "reference",
      header: t("dsr.reference"),
      render: (row) => <CellStack primary={<span className="font-mono">{row.reference}</span>} secondary={t(`dsr.channel.${row.channel}` as ConsoleKey)} />,
    },
    { key: "type", header: t("dsr.type"), render: (row) => <Badge tone="accent">{t(`dsr.type.${row.type}` as ConsoleKey)}</Badge> },
    { key: "subject", header: t("dsr.subject"), render: (row) => row.subjectName },
    { key: "received", header: t("dsr.received"), render: (row) => formatDate(row.receivedAt, fmt) },
    {
      key: "due",
      header: t("dsr.due"),
      render: (row) =>
        row.status === "completed" || row.status === "rejected" ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className={isOverdue(row) ? "text-bad font-semibold" : undefined}>
            {isOverdue(row) ? t("dsr.overdue") : formatRelative(row.dueAt, fmt)}
          </span>
        ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {t(`dsr.status.${row.status}` as ConsoleKey)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("dsr.title")}
        subtitle={t("dsr.subtitle").replace("{days}", String(DSR_RESPONSE_DAYS))}
        spec="FR-SEC-062"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("dsr.new")}
          </Button>
        }
      />
      <PageBody>
        <TileGrid columns={3}>
          <MetricTile label={t("dsr.open")} value={formatNumber(totals.open, fmt)} />
          <MetricTile label={t("dsr.overdue")} value={formatNumber(totals.overdue, fmt)} />
          <MetricTile label={t("dsr.closed")} value={formatNumber(totals.done, fmt)} />
        </TileGrid>

        <Toolbar>
          <div className="min-w-40">
            <Select aria-label={t("common.status")} value={status} onChange={(event) => setStatus(event.target.value as DsrStatus | "")}>
              <option value="">{t("dsr.anyStatus")}</option>
              {DSR_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`dsr.status.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-40">
            <Select aria-label={t("dsr.type")} value={type} onChange={(event) => setType(event.target.value as DsrType | "")}>
              <option value="">{t("dsr.anyType")}</option>
              {DSR_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`dsr.type.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </div>
          <ClassificationBadge cls="restricted" />
        </Toolbar>

        {requests.error ? <ErrorPanel error={requests.error} onRetry={requests.reload} /> : null}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={requests.loading && !requests.data}
          onRowClick={(row) => setSelectedId(row.id)}
          activeRowKey={selectedId}
          filtered={Boolean(status || type)}
          onClearFilters={() => {
            setStatus("");
            setType("");
          }}
          caption={t("dsr.title")}
          emptyTitle={t("dsr.empty")}
          emptyBody={t("dsr.emptyBody")}
        />

        <Callout tone="muted">{t("dsr.deviceNote")}</Callout>
      </PageBody>

      {creating ? (
        <NewRequest
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setCreating(false);
            requests.reload();
            setSelectedId(row.id);
            setMessage(t("dsr.created"));
          }}
        />
      ) : null}

      {selected ? (
        <RequestDrawer
          request={selected}
          onClose={() => setSelectedId(null)}
          onChanged={(note) => {
            requests.reload();
            setMessage(note);
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function useCustomerOptions() {
  const { tx } = useI18n();
  const customers = useAsync(
    () => services.crm.customers.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as Customer[]),
    [],
  );
  return {
    customers: customers.data ?? [],
    options: (customers.data ?? []).map((row) => ({ value: row.id, label: tx(row.name), hint: row.phone })),
  };
}

function NewRequest({ onClose, onCreated }: { onClose: () => void; onCreated: (row: DataSubjectRequest) => void }) {
  const { t } = useI18n();
  const actor = useActor();
  const { customers, options } = useCustomerOptions();
  const [type, setType] = useState<DsrType>("access");
  const [channel, setChannel] = useState<DsrChannel>("email");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [subjectContact, setSubjectContact] = useState("");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function link(id: string | null) {
    setCustomerId(id);
    const customer = customers.find((row) => row.id === id);
    if (customer) {
      if (!subjectName) setSubjectName(customer.name.en || customer.name.ar);
      if (!subjectContact) setSubjectContact(customer.email ?? customer.phone);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // FR-SEC-047 — the service parses this with a strict schema.
      const row = await services.dataSubjectRequests.create(
        { type, channel, customerId, subjectName, subjectContact, receivedAt: `${receivedAt}T12:00:00.000Z`, details },
        actor,
      );
      onCreated(row);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("dsr.new")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={subjectName.trim().length < 2 || subjectContact.trim().length < 3} onClick={() => void submit()}>
            {t("dsr.log")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dsr.type")} required>
          <Select value={type} onChange={(event) => setType(event.target.value as DsrType)}>
            {DSR_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`dsr.type.${value}` as ConsoleKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dsr.channel")} required>
          <Select value={channel} onChange={(event) => setChannel(event.target.value as DsrChannel)}>
            {DSR_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {t(`dsr.channel.${value}` as ConsoleKey)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("dsr.customer")} hint={t("dsr.customerHint")}>
            <SearchSelect options={options} value={customerId} onChange={link} placeholder={t("dsr.noCustomer")} aria-label={t("dsr.customer")} allowClear />
          </Field>
        </div>
        <Field label={t("dsr.subject")} required>
          <Input value={subjectName} maxLength={120} onChange={(event) => setSubjectName(event.target.value)} />
        </Field>
        <Field label={t("dsr.contact")} required>
          <Input dir="ltr" value={subjectContact} maxLength={160} onChange={(event) => setSubjectContact(event.target.value)} />
        </Field>
        <Field label={t("dsr.received")} hint={t("dsr.receivedHint").replace("{days}", String(DSR_RESPONSE_DAYS))} required>
          <Input type="date" dir="ltr" value={receivedAt} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setReceivedAt(event.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("dsr.details")}>
            <Textarea rows={3} maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} />
          </Field>
        </div>
      </div>
      <ErrorCallout error={error} className="mt-3" />
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function RequestDrawer({
  request,
  onClose,
  onChanged,
}: {
  request: DataSubjectRequest;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { can } = useSession();
  const actor = useActor();
  const record = useSecurityLog();
  const confirm = useConfirm();
  const { customers } = useCustomerOptions();
  const customer = customers.find((row) => row.id === request.customerId) ?? null;
  const next = allowedNext(request.status);
  const [target, setTarget] = useState<DsrStatus | "">(next[0] ?? "");
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(request.identityVerified);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const closed = next.length === 0;

  async function advance() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await services.dataSubjectRequests.advance(request.id, { status: target, note, identityVerified: verified }, actor);
      setNote("");
      onChanged(t("dsr.updated"));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  /** Access — the linked customer's data, as a file for the requester. */
  async function exportData() {
    if (!customer) return;
    setError(null);
    try {
      const bundle = await services.crm.customers.exportOne(customer.id);
      const blob = new Blob([JSON.stringify({ request: request.reference, generatedAt: new Date().toISOString(), ...bundle }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${request.reference}-subject-data.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      await record({
        kind: "dsr.updated",
        subjectType: "data_subject_request",
        subjectId: request.id,
        detail: { reference: request.reference, action: "subject_data_exported", customerId: customer.id, class: "restricted" },
      });
      onChanged(t("dsr.exported"));
    } catch (caught) {
      setError(caught);
    }
  }

  /** Erasure — anonymise the linked customer; orders and payments remain. */
  async function erase() {
    if (!customer) return;
    const ok = await confirm({
      title: t("crm.eraseTitle"),
      body: t("crm.eraseBody"),
      confirmLabel: t("crm.erase"),
      tone: "danger",
      typeToConfirm: request.reference,
    });
    if (!ok) return;
    setError(null);
    try {
      await services.crm.customers.erase(customer.id);
      await record({
        kind: "dsr.updated",
        subjectType: "data_subject_request",
        subjectId: request.id,
        detail: { reference: request.reference, action: "customer_anonymised", customerId: customer.id },
      });
      onChanged(t("crm.erased"));
    } catch (caught) {
      setError(caught);
    }
  }

  const canWork = request.identityVerified && (request.status === "in_progress");

  return (
    <Drawer
      open
      onClose={onClose}
      title={request.reference}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{t(`dsr.type.${request.type}` as ConsoleKey)}</Badge>
          <Badge tone={STATUS_TONE[request.status]} dot>
            {t(`dsr.status.${request.status}` as ConsoleKey)}
          </Badge>
          {isOverdue(request) ? <Badge tone="bad">{t("dsr.overdue")}</Badge> : null}
        </span>
      }
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("dsr.subject")}>{request.subjectName}</DescRow>
          <DescRow label={t("dsr.contact")}>
            {/* FR-SEC-042 / FR-SEC-060 — restricted personal data, masked until revealed. */}
            <SensitiveValue
              value={request.subjectContact}
              field="dsr.subject_contact"
              subjectType="data_subject_request"
              subjectId={request.id}
              kind={request.subjectContact.includes("@") ? "email" : "phone"}
              permission="crm.customer.export"
            />
          </DescRow>
          <DescRow label={t("dsr.channel")}>{t(`dsr.channel.${request.channel}` as ConsoleKey)}</DescRow>
          <DescRow label={t("dsr.received")}>{formatDateTime(request.receivedAt, fmt)}</DescRow>
          <DescRow label={t("dsr.due")}>{formatDateTime(request.dueAt, fmt)}</DescRow>
          <DescRow label={t("dsr.identity")}>
            <Badge tone={request.identityVerified ? "good" : "warn"}>{request.identityVerified ? t("dsr.verified") : t("dsr.unverified")}</Badge>
          </DescRow>
          <DescRow label={t("dsr.customer")}>
            {customer ? (
              <span className="flex flex-wrap items-center gap-2">
                {tx(customer.name)}
                {customer.anonymisedAt ? <Badge tone="muted">{t("dsr.anonymised")}</Badge> : null}
              </span>
            ) : (
              <span className="text-fg-subtle">{t("dsr.noCustomer")}</span>
            )}
          </DescRow>
        </DescList>

        {request.details ? <p className="text-fg-muted text-sm whitespace-pre-line">{request.details}</p> : null}

        <ErrorCallout error={error} />

        {customer && !closed ? (
          <section className="space-y-2">
            <h3 className="text-fg text-sm font-semibold">{t("dsr.actions")}</h3>
            {!canWork ? <Callout tone="muted">{t("dsr.actionsLocked")}</Callout> : null}
            <div className="flex flex-wrap gap-2">
              {request.type === "access" ? (
                <Button icon={<Download size={13} />} disabled={!canWork || !can("crm.customer.export")} onClick={() => void exportData()}>
                  {t("dsr.exportData")}
                </Button>
              ) : null}
              {request.type === "erasure" ? (
                <Button variant="danger" icon={<Eraser size={13} />} disabled={!canWork || !can("crm.customer.erase") || Boolean(customer.anonymisedAt)} onClick={() => void erase()}>
                  {t("crm.erase")}
                </Button>
              ) : null}
              {request.type === "rectification" ? (
                <Link href="/customers" className="border-line text-fg hover:bg-sunken inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm">
                  <UserPen size={13} aria-hidden /> {t("dsr.openCustomers")}
                </Link>
              ) : null}
            </div>
            {request.type === "erasure" ? <p className="text-fg-subtle text-xs">{t("dsr.erasureNote")}</p> : null}
          </section>
        ) : null}

        {!closed ? (
          <section className="border-line space-y-3 border-t pt-4">
            <h3 className="text-fg text-sm font-semibold">{t("dsr.progress")}</h3>
            <Toggle checked={verified} onChange={setVerified} disabled={request.identityVerified} label={t("dsr.identityCheck")} hint={t("dsr.identityHint")} />
            <Field label={t("dsr.moveTo")}>
              <Select value={target} onChange={(event) => setTarget(event.target.value as DsrStatus)}>
                {next.map((value) => (
                  <option key={value} value={value}>
                    {t(`dsr.status.${value}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dsr.note")} hint={target === "completed" || target === "rejected" ? t("dsr.noteRequired") : undefined}>
              <Textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <Button variant="primary" loading={busy} disabled={!target} onClick={() => void advance()}>
              {t("dsr.update")}
            </Button>
          </section>
        ) : (
          <Callout tone="muted">{t("dsr.closedNote")}</Callout>
        )}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("dsr.history")}</h3>
          <ol className="border-line space-y-2 border-s ps-4">
            {request.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[entry.status]}>{t(`dsr.status.${entry.status}` as ConsoleKey)}</Badge>
                  <span className="text-fg-muted">{entry.by}</span>
                  <span className="text-fg-subtle tabular-nums">{formatDateTime(entry.at, fmt)}</span>
                </span>
                {entry.note ? <span className="text-fg-muted mt-0.5 block whitespace-pre-line">{entry.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  );
}
