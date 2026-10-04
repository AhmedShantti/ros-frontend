"use client";

/**
 * Employee administration sections shown in the Employees drawer: edit
 * details, set pay, add a branch, suspend/terminate. Each one is a single
 * write against `services.workforce`, and reports back through `onChanged`
 * so the roster and the open drawer can reload.
 */

import { useState } from "react";
import { useAsync } from "@/lib/console/hooks";
import { formatDate, formatMoney } from "@/lib/console/format";
import type { Branch, Employee } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { EMPLOYMENT_TYPE } from "@/lib/console/labels";
import { Button, Callout, Field, Input, Select } from "@/components/console/ui";

type Basis = "hourly" | "monthly_salary" | "per_shift";

const BASIS_KEY = {
  hourly: "wf.basisHourly",
  monthly_salary: "wf.basisMonthly",
  per_shift: "wf.basisPerShift",
} as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line space-y-2 rounded-lg border p-3">
      <h3 className="text-fg text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function EditDetailsSection({
  employee,
  onChanged,
}: {
  employee: Employee;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState(employee.name.en);
  const [position, setPosition] = useState(employee.position.en);
  const [department, setDepartment] = useState(employee.department.en);
  const [phone, setPhone] = useState(employee.phone);
  const [email, setEmail] = useState(employee.email);
  const [employmentType, setEmploymentType] = useState(employee.employmentType);

  async function save() {
    if (!name.trim()) return;
    await action.run(
      () =>
        services.workforce.employees.update(employee.id, {
          name: { en: name.trim(), ar: name.trim() },
          position: { en: position.trim(), ar: position.trim() },
          department: { en: department.trim(), ar: department.trim() },
          phone: phone.trim(),
          email: email.trim(),
          employmentType,
        }),
      { onSuccess: () => onChanged(t("wf.employeeUpdated")) },
    );
  }

  return (
    <Section title={t("wf.editEmployee")}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Field label={t("common.name")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("wf.position")}>
          <Input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t("wf.department")}>
          <Input value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t("usr.phone")}>
          <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
        </Field>
        <Field label={t("auth.email")}>
          <Input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <Field label={t("wf.employmentType")}>
        <Select
          value={employmentType}
          onChange={(e) => setEmploymentType(e.target.value as Employee["employmentType"])}
        >
          {Object.entries(EMPLOYMENT_TYPE).map(([value, entry]) => (
            <option key={value} value={value}>
              {tx(entry.label)}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="secondary" loading={action.pending} disabled={!name.trim()} onClick={save}>
        {t("common.save")}
      </Button>
    </Section>
  );
}

export function CompensationSection({
  employee,
  onChanged,
}: {
  employee: Employee;
  onChanged: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const history = useAsync(
    () => services.workforce.compensationHistory(employee.id).catch(() => []),
    [employee.id, employee.hourlyRate.amount],
  );
  const [basis, setBasis] = useState<Basis>("hourly");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const currency = employee.hourlyRate.currency;
  const valid = /^\d+(\.\d{1,2})?$/.test(amount);

  async function save() {
    if (!valid) return;
    // Exact integer minor units as a string — never a float on the wire.
    const [whole, fraction = ""] = amount.split(".");
    const minor = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
    await action.run(
      () =>
        services.workforce.setEmployeeCompensation(employee.id, {
          basis,
          amountMinorUnits: minor,
          currency,
          ...(effectiveFrom ? { effectiveFrom } : {}),
        }),
      {
        onSuccess: () => {
          setAmount("");
          onChanged(t("wf.paySaved"));
        },
      },
    );
  }

  return (
    <Section title={t("wf.payTitle")}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("wf.payBasis")}>
          <Select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="hourly">{t("wf.basisHourly")}</option>
            <option value="monthly_salary">{t("wf.basisMonthly")}</option>
            <option value="per_shift">{t("wf.basisPerShift")}</option>
          </Select>
        </Field>
        <Field label={`${t("wf.payAmount")} (${currency})`}>
          <Input
            dir="ltr"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </Field>
      </div>
      <Field label={t("wf.payEffectiveFrom")}>
        <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>
      <Button variant="secondary" loading={action.pending} disabled={!valid} onClick={save}>
        {t("common.save")}
      </Button>
      {history.data && history.data.length > 0 ? (
        <div>
          <h4 className="text-fg-subtle mb-1 text-xs font-semibold">{t("wf.payHistory")}</h4>
          <ul className="divide-line divide-y text-xs">
            {history.data.map((version) => (
              <li key={version.id} className="flex justify-between gap-3 py-1.5">
                <span dir="ltr">{formatDate(version.effectiveFrom.slice(0, 10), fmt)}</span>
                <span className="text-fg-subtle">{t(BASIS_KEY[version.basis])}</span>
                <span dir="ltr" className="font-mono">
                  {formatMoney(version.amount, fmt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

export function BranchAccessSection({
  employee,
  branches,
  onChanged,
}: {
  employee: Employee;
  branches: Branch[];
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [branchId, setBranchId] = useState("");
  const available = branches.filter((b) => !employee.permittedBranchIds.includes(b.id));
  const removable = branches.filter(
    (b) => employee.permittedBranchIds.includes(b.id) && b.id !== employee.homeBranchId,
  );

  if (available.length === 0 && removable.length === 0) return null;

  async function add() {
    if (!branchId) return;
    await action.run(() => services.workforce.addEmployeeBranch(employee.id, branchId), {
      onSuccess: () => {
        setBranchId("");
        onChanged(t("wf.branchAdded"));
      },
    });
  }

  async function remove(id: string) {
    await action.run(() => services.workforce.removeEmployeeBranch(employee.id, id), {
      onSuccess: () => onChanged(t("wf.branchRemoved")),
    });
  }

  return (
    <Section title={t("wf.addBranchTitle")}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {removable.length > 0 ? (
        <ul className="space-y-1">
          {removable.map((b) => (
            <li key={b.id} className="flex items-center justify-between text-xs">
              <span>{tx(b.name)}</span>
              <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => remove(b.id)}>
                {t("wf.removeBranch")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {available.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label={t("common.branch")}>
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">—</option>
                {available.map((b) => (
                  <option key={b.id} value={b.id}>
                    {tx(b.name)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="secondary" loading={action.pending} disabled={!branchId} onClick={add}>
            {t("wf.addBranch")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

export function DeactivateSection({
  employee,
  onChanged,
}: {
  employee: Employee;
  onChanged: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [reason, setReason] = useState("");

  if (employee.status === "terminated") return null;

  async function reactivate() {
    if (!reason.trim()) return;
    await action.run(() => services.workforce.reactivateEmployee(employee.id, reason.trim()), {
      onSuccess: () => {
        setReason("");
        onChanged(t("wf.reactivated"));
      },
    });
  }

  async function run(status: "suspended" | "terminated") {
    if (!reason.trim()) return;
    await action.run(
      () => services.workforce.deactivateEmployee(employee.id, { status, reason: reason.trim() }),
      {
        onSuccess: () => {
          setReason("");
          onChanged(t("wf.deactivated"));
        },
      },
    );
  }

  return (
    <Section title={t("wf.deactivateTitle")}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Field label={t("wf.deactivateReason")}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={240} />
      </Field>
      <div className="flex gap-2">
        {employee.status !== "suspended" ? (
          <Button
            variant="secondary"
            loading={action.pending}
            disabled={!reason.trim()}
            onClick={() => run("suspended")}
          >
            {t("wf.suspend")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            loading={action.pending}
            disabled={!reason.trim()}
            onClick={reactivate}
          >
            {t("wf.reactivate")}
          </Button>
        )}
        <Button
          variant="danger"
          loading={action.pending}
          disabled={!reason.trim()}
          onClick={() => run("terminated")}
        >
          {t("wf.terminate")}
        </Button>
      </div>
    </Section>
  );
}
