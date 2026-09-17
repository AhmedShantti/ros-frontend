"use client";

/**
 * Leave requests, approval and balances — FR-HRM-017.
 *
 * A balance is computed, never stored: entitlement for the year (scaled by
 * employment type, FR-HRM-002, and pro-rated from the hire date), plus what
 * carried over, less what was approved. Pending requests are shown beside
 * the remaining figure rather than taken from it. A stored balance that is
 * edited by hand is the number nobody can explain in December.
 *
 * Paid leave cannot be overdrawn — the form refuses it. Approval warns when
 * the person is rostered on a day they would be away, because approving the
 * leave does not remove the shift and somebody has to cover it.
 */

import { useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import type { Employee, EmploymentType, Id, ScheduledShift } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatNumber } from "@/lib/console/format";
import { EMPLOYMENT_TYPE, type Tone } from "@/lib/console/labels";
import {
  isBlocking,
  leaveBalance,
  leaveDays,
  validateLeaveRequest,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/console/workforce-rules";
import { useConfirm } from "@/components/console/confirm";
import { ExportButton } from "@/components/console/export-button";
import { EMPTY_LOCALISED, LocalisedField } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

const STATUS_TONE: Record<LeaveStatus, Tone> = {
  pending: "warn",
  approved: "good",
  rejected: "bad",
  cancelled: "muted",
};

const TYPES: EmploymentType[] = ["full_time", "part_time", "casual", "contractor", "trainee"];

interface LeaveData {
  types: LeaveType[];
  requests: LeaveRequest[];
  employees: Employee[];
}

export function useLeaveData(reloadKey: number) {
  return useAsync<LeaveData>(async () => {
    const [types, requests, employees] = await Promise.all([
      services.workforceHr.leave.types(),
      services.workforceHr.leave.requests.all(),
      services.workforce.employees
        .list({ limit: 500 })
        .then((page) => page.rows)
        .catch(() => [] as Employee[]),
    ]);
    return {
      types,
      requests: [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      employees,
    };
  }, [reloadKey]);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function LeaveRequestsPanel({
  data,
  onChanged,
}: {
  data: LeaveData;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canDecide = usePermission("hr.schedule.manage");
  const action = useAction(onChanged);
  const confirm = useConfirm();
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<LeaveRequest | null>(null);

  const rows = data.requests.filter((row) => status === "all" || row.status === status);
  const typeName = (id: Id) => tx(data.types.find((type) => type.id === id)?.name) || id;

  async function cancel(request: LeaveRequest) {
    const ok = await confirm({
      title: t("wf.leave.cancelTitle"),
      body: t("wf.leave.cancelBody"),
      confirmLabel: t("wf.leave.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.workforceHr.leave.cancel(request.id), {
      onSuccess: () => onChanged(t("wf.leave.cancelled")),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("common.status")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value as LeaveStatus | "all")}>
            <option value="all">{t("common.all")}</option>
            {(["pending", "approved", "rejected", "cancelled"] as LeaveStatus[]).map((value) => (
              <option key={value} value={value}>
                {t(`wf.leave.status.${value}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
          {t("wf.leave.new")}
        </Button>
      </div>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      {rows.length === 0 ? (
        <Callout tone="muted">{t("wf.leave.none")}</Callout>
      ) : (
        <ul className="space-y-2">
          {rows.map((request) => (
            <li key={request.id} className="border-line rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-fg text-sm font-medium">
                    {tx(request.employeeName)} · {typeName(request.typeId)}
                  </p>
                  <p className="text-fg-muted mt-0.5 text-xs">
                    {formatDate(request.startDate, fmt)} – {formatDate(request.endDate, fmt)} ·{" "}
                    {t("wf.leave.days").replace("{n}", formatNumber(request.days, fmt, 1))}
                  </p>
                  {request.note ? <p className="text-fg-subtle mt-1 text-xs">{request.note}</p> : null}
                  {request.decidedAt && request.status !== "cancelled" ? (
                    <p className="text-fg-subtle mt-1 text-xs">
                      {t("wf.swap.decisionBy")
                        .replace("{who}", request.decidedBy ?? "—")
                        .replace("{when}", formatDateTime(request.decidedAt, fmt))}
                      {request.decisionNote ? `: ${request.decisionNote}` : ""}
                    </p>
                  ) : null}
                </div>
                <Badge tone={STATUS_TONE[request.status]} dot>
                  {t(`wf.leave.status.${request.status}` as never)}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {request.status === "pending" && canDecide ? (
                  <Button size="sm" variant="primary" onClick={() => setDeciding(request)}>
                    {t("wf.leave.review")}
                  </Button>
                ) : null}
                {request.status === "pending" || request.status === "approved" ? (
                  <Button size="sm" variant="ghost" loading={action.pending} onClick={() => void cancel(request)}>
                    {t("wf.leave.cancel")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <LeaveRequestDrawer
          data={data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged(t("wf.leave.submitted"));
          }}
        />
      ) : null}
      {deciding ? (
        <LeaveDecisionDrawer
          request={deciding}
          data={data}
          onClose={() => setDeciding(null)}
          onDecided={(message) => {
            setDeciding(null);
            onChanged(message);
          }}
        />
      ) : null}
    </div>
  );
}

function BalanceLine({ type, employee, requests, year }: { type: LeaveType; employee: Employee; requests: LeaveRequest[]; year: number }) {
  const { t, fmt } = useI18n();
  const balance = leaveBalance(
    type,
    employee,
    requests.filter((request) => request.employeeId === employee.id),
    year,
  );
  if (balance.remaining === null) return <span className="text-fg-subtle">{t("wf.leave.noBalanceKept")}</span>;
  return (
    <span className="font-mono tabular-nums">
      {t("wf.leave.balanceLine")
        .replace("{remaining}", formatNumber(balance.remaining, fmt, 1))
        .replace("{entitlement}", formatNumber(balance.entitlement! + balance.carriedOver, fmt, 1))
        .replace("{pending}", formatNumber(balance.pending, fmt, 1))}
    </span>
  );
}

function LeaveRequestDrawer({
  data,
  onClose,
  onCreated,
}: {
  data: LeaveData;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const activeTypes = data.types.filter((type) => type.active);
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState(activeTypes[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [note, setNote] = useState("");

  const employee = data.employees.find((row) => row.id === employeeId);
  const type = data.types.find((row) => row.id === typeId);
  const days = leaveDays(startDate, endDate, halfDay);
  const draft = { id: "", employeeId, typeId, startDate, endDate, halfDay, note };
  const problems = employeeId && typeId ? validateLeaveRequest(draft, type, employee, data.requests) : [];
  const blocked = !employeeId || !typeId || !startDate || !endDate || problems.some(isBlocking);

  async function submit() {
    if (blocked || !employee) return;
    await action.run(
      () =>
        services.workforceHr.leave.requests.create({
          employeeId,
          employeeName: employee.name,
          branchId: employee.homeBranchId,
          typeId,
          startDate,
          endDate,
          halfDay: halfDay && startDate === endDate,
          days,
          note: note.trim(),
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.leave.new")}
      subtitle="FR-HRM-017"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={blocked} onClick={submit}>
            {t("wf.leave.submit")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field label={t("wf.employee")} required>
          <Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">—</option>
            {data.employees
              .filter((row) => row.status === "active" || row.status === "on_leave")
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)} · {tx(EMPLOYMENT_TYPE[row.employmentType].label)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("wf.leave.type")} required>
          <Select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            {activeTypes.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>
        {employee && type ? (
          <p className="text-fg-muted text-xs">
            <BalanceLine type={type} employee={employee} requests={data.requests} year={Number((startDate || new Date().toISOString()).slice(0, 4))} />
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("wf.leave.from")} required>
            <Input type="date" dir="ltr" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={t("wf.leave.to")} required>
            <Input type="date" dir="ltr" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
        </div>
        <Toggle
          checked={halfDay}
          onChange={setHalfDay}
          disabled={Boolean(startDate) && startDate !== endDate}
          label={t("wf.leave.halfDay")}
          hint={t("wf.leave.halfDayHint")}
        />
        <Field label={t("wf.leave.note")} required={type?.requiresNote} hint={type?.requiresNote ? t("wf.leave.noteRequired") : undefined}>
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <DescList>
          <DescRow label={t("wf.leave.daysRequested")} mono>
            {days}
          </DescRow>
        </DescList>
        {problems.length > 0 ? (
          <ul className="space-y-0.5 text-xs">
            {problems.map((key) => (
              <li key={key} className={cx(isBlocking(key) ? "text-bad" : "text-warn")}>
                • {t(key as never)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

function LeaveDecisionDrawer({
  request,
  data,
  onClose,
  onDecided,
}: {
  request: LeaveRequest;
  data: LeaveData;
  onClose: () => void;
  onDecided: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const [note, setNote] = useState("");
  const employee = data.employees.find((row) => row.id === request.employeeId);
  const type = data.types.find((row) => row.id === request.typeId);

  const clashes = useAsync<ScheduledShift[] | null>(
    () =>
      services.workforce.shifts
        .list({ limit: 1000 })
        .then((page) =>
          page.rows.filter(
            (shift) =>
              shift.employeeId === request.employeeId &&
              shift.date >= request.startDate &&
              shift.date <= request.endDate,
          ),
        )
        .catch(() => null),
    [request.id],
  );

  async function decide(status: "approved" | "rejected") {
    if (status === "rejected" && !note.trim()) return;
    await action.run(
      () => services.workforceHr.leave.decide(request.id, status, session?.user.name.en ?? "", note.trim() || null),
      { onSuccess: () => onDecided(status === "approved" ? t("wf.leave.approved") : t("wf.leave.rejected")) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t("wf.leave.review")} · ${tx(request.employeeName)}`}
      subtitle="FR-HRM-017"
      footer={
        <div className="flex gap-2">
          <Button variant="primary" icon={<Check size={13} />} loading={action.pending} onClick={() => void decide("approved")}>
            {t("common.approve")}
          </Button>
          <Button variant="danger" icon={<X size={13} />} loading={action.pending} disabled={!note.trim()} onClick={() => void decide("rejected")}>
            {t("common.reject")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <DescList>
          <DescRow label={t("wf.leave.type")}>{tx(type?.name) || request.typeId}</DescRow>
          <DescRow label={t("wf.leave.from")}>{formatDate(request.startDate, fmt)}</DescRow>
          <DescRow label={t("wf.leave.to")}>{formatDate(request.endDate, fmt)}</DescRow>
          <DescRow label={t("wf.leave.daysRequested")} mono>
            {request.days}
          </DescRow>
          {employee && type ? (
            <DescRow label={t("wf.leave.balance")}>
              <BalanceLine type={type} employee={employee} requests={data.requests} year={Number(request.startDate.slice(0, 4))} />
            </DescRow>
          ) : null}
        </DescList>
        {request.note ? <Callout tone="muted">{request.note}</Callout> : null}
        {clashes.data && clashes.data.length > 0 ? (
          <Callout tone="warn" title={t("wf.leave.rosteredTitle")}>
            <ul className="space-y-0.5">
              {clashes.data.map((shift) => (
                <li key={shift.id}>
                  • {formatDate(shift.date, fmt)} {shift.startTime}–{shift.endTime}
                </li>
              ))}
            </ul>
            <p className="mt-1">{t("wf.leave.rosteredBody")}</p>
          </Callout>
        ) : null}
        <Field label={t("wf.swap.decisionNote")} hint={t("wf.leave.rejectNeedsNote")}>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export function LeaveBalancesPanel({ data }: { data: LeaveData }) {
  const { t, tx, fmt } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const types = data.types.filter((type) => type.active && type.annualDays !== null);

  const rows = useMemo(
    () =>
      data.employees
        .filter((row) => row.status !== "terminated")
        .map((employee) => ({
          employee,
          balances: types.map((type) => leaveBalance(type, employee, data.requests.filter((r) => r.employeeId === employee.id), year)),
        })),
    [data, types, year],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("wf.leave.year")}>
          <Select value={String(year)} onChange={(event) => setYear(Number(event.target.value))}>
            {[year - 1, year, year + 1].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <ExportButton
          filename={`leave-balances-${year}`}
          title={t("wf.leave.balancesTitle")}
          permission="hr.payroll.export"
          rows={rows.flatMap((row) => row.balances.map((balance) => ({ employee: row.employee, balance })))}
          columns={[
            { key: "code", header: t("wf.employeeCode"), value: (row) => row.employee.code },
            { key: "name", header: t("wf.employee"), value: (row) => tx(row.employee.name) },
            { key: "type", header: t("wf.leave.type"), value: (row) => tx(data.types.find((type) => type.id === row.balance.typeId)?.name) },
            { key: "entitlement", header: t("wf.leave.entitlement"), value: (row) => row.balance.entitlement ?? "" },
            { key: "carried", header: t("wf.leave.carried"), value: (row) => row.balance.carriedOver },
            { key: "taken", header: t("wf.leave.taken"), value: (row) => row.balance.taken },
            { key: "pending", header: t("wf.leave.pending"), value: (row) => row.balance.pending },
            { key: "remaining", header: t("wf.leave.remaining"), value: (row) => row.balance.remaining ?? "" },
          ]}
        />
      </div>
      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-xs">
          <caption className="sr-only">{t("wf.leave.balancesTitle")}</caption>
          <thead>
            <tr className="bg-sunken border-line border-b">
              <th scope="col" className="text-fg-muted px-3 py-2 text-start font-medium">
                {t("wf.employee")}
              </th>
              {types.map((type) => (
                <th key={type.id} scope="col" className="text-fg-muted px-3 py-2 text-end font-medium">
                  {tx(type.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((row) => (
              <tr key={row.employee.id}>
                <th scope="row" className="px-3 py-2 text-start font-normal">
                  <span className="text-fg block">{tx(row.employee.name)}</span>
                  <span className="text-fg-subtle block">{tx(EMPLOYMENT_TYPE[row.employee.employmentType].label)}</span>
                </th>
                {row.balances.map((balance) => (
                  <td key={balance.typeId} className="px-3 py-2 text-end font-mono tabular-nums">
                    <span className={cx("text-fg", (balance.remaining ?? 0) < 0 && "text-bad")}>
                      {formatNumber(balance.remaining ?? 0, fmt, 1)}
                    </span>
                    <span className="text-fg-subtle"> / {formatNumber((balance.entitlement ?? 0) + balance.carriedOver, fmt, 1)}</span>
                    {balance.pending > 0 ? (
                      <span className="text-warn block">
                        {t("wf.leave.pendingShort").replace("{n}", formatNumber(balance.pending, fmt, 1))}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export function LeaveTypesPanel({ data, onChanged }: { data: LeaveData; onChanged: (message: string) => void }) {
  const { t, tx } = useI18n();
  const canManage = usePermission("hr.employee.manage");
  const action = useAction();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<LeaveType[]>(data.types);
  const [dirty, setDirty] = useState(false);

  function patch(id: Id, part: Partial<LeaveType>) {
    setDraft((current) => current.map((row) => (row.id === id ? { ...row, ...part } : row)));
    setDirty(true);
  }

  async function remove(type: LeaveType) {
    const used = data.requests.some((request) => request.typeId === type.id);
    const ok = await confirm({
      title: t("wf.leave.removeType"),
      body: used ? t("wf.leave.removeTypeUsed") : t("wf.leave.removeTypeBody").replace("{name}", tx(type.name)),
      confirmLabel: used ? t("wf.leave.deactivate") : t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    if (used) patch(type.id, { active: false });
    else {
      setDraft((current) => current.filter((row) => row.id !== type.id));
      setDirty(true);
    }
  }

  const invalid = draft.some((row) => !row.name.en.trim() && !row.name.ar.trim());

  return (
    <div className="space-y-3">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <ul className="space-y-3">
        {draft.map((type) => (
          <li key={type.id} className="border-line space-y-3 rounded-lg border p-3">
            <LocalisedField label={t("wf.leave.typeName")} required value={type.name} onChange={(name) => patch(type.id, { name })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("wf.leave.annualDays")} hint={t("wf.leave.annualDaysHint")}>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  disabled={!canManage}
                  value={type.annualDays === null ? "" : String(type.annualDays)}
                  onChange={(event) =>
                    patch(type.id, { annualDays: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })
                  }
                  className="text-end font-mono tabular-nums"
                />
              </Field>
              <Field label={t("wf.leave.carryOver")}>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  disabled={!canManage}
                  value={String(type.carryOverMaxDays)}
                  onChange={(event) => patch(type.id, { carryOverMaxDays: Math.max(0, Number(event.target.value) || 0) })}
                  className="text-end font-mono tabular-nums"
                />
              </Field>
            </div>
            <Field label={t("wf.leave.eligible")}>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((employment) => {
                  const on = type.eligibleTypes.includes(employment);
                  return (
                    <label key={employment} className="border-line flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={on}
                        disabled={!canManage}
                        onChange={() =>
                          patch(type.id, {
                            eligibleTypes: on
                              ? type.eligibleTypes.filter((value) => value !== employment)
                              : [...type.eligibleTypes, employment],
                          })
                        }
                      />
                      {tx(EMPLOYMENT_TYPE[employment].label)}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Toggle checked={type.paid} disabled={!canManage} onChange={(paid) => patch(type.id, { paid })} label={t("wf.leave.paid")} />
            <Toggle
              checked={type.requiresNote}
              disabled={!canManage}
              onChange={(requiresNote) => patch(type.id, { requiresNote })}
              label={t("wf.leave.requiresNote")}
            />
            <Toggle checked={type.active} disabled={!canManage} onChange={(active) => patch(type.id, { active })} label={t("common.active")} />
            {canManage ? (
              <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void remove(type)}>
                {t("common.delete")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Plus size={13} />}
            onClick={() => {
              setDraft((current) => [
                ...current,
                {
                  id: `leave_${Date.now().toString(36)}`,
                  name: { ...EMPTY_LOCALISED },
                  paid: true,
                  annualDays: 0,
                  carryOverMaxDays: 0,
                  eligibleTypes: ["full_time"],
                  requiresNote: false,
                  active: true,
                },
              ]);
              setDirty(true);
            }}
          >
            {t("wf.leave.addType")}
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || invalid}
            loading={action.pending}
            onClick={() =>
              void action.run(() => services.workforceHr.leave.saveTypes(draft), {
                onSuccess: () => {
                  setDirty(false);
                  onChanged(t("wf.leave.typesSaved"));
                },
              })
            }
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LeaveScreenBody({ onMessage }: { onMessage: (message: string) => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const state = useLeaveData(reloadKey);
  const { t } = useI18n();
  const [tab, setTab] = useState<"requests" | "balances" | "types">("requests");
  const changed = (message: string) => {
    onMessage(message);
    setReloadKey((n) => n + 1);
  };
  return (
    <AsyncPanel state={state}>
      {(data) => (
        <div className="space-y-4">
          <div role="tablist" className="border-line flex gap-1 border-b">
            {(["requests", "balances", "types"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cx(
                  "border-b-2 px-3 py-2 text-sm",
                  tab === value ? "border-accent text-fg font-medium" : "text-fg-muted border-transparent",
                )}
              >
                {t(`wf.leave.tab.${value}` as never)}
                {value === "requests" ? (
                  <span className="bg-sunken text-fg-muted ms-2 rounded-full px-1.5 py-0.5 text-[0.65rem]">
                    {data.requests.filter((row) => row.status === "pending").length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {tab === "requests" ? <LeaveRequestsPanel data={data} onChanged={changed} /> : null}
          {tab === "balances" ? <LeaveBalancesPanel data={data} /> : null}
          {tab === "types" ? <LeaveTypesPanel data={data} onChanged={changed} /> : null}
        </div>
      )}
    </AsyncPanel>
  );
}
