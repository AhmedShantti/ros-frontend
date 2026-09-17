"use client";

/**
 * Employment type and branch assignment on the employee record —
 * FR-HRM-002, FR-HRM-005.
 *
 * The type is shown with what it *does*: a select that says "Trainee" and
 * nothing else leaves the manager to discover at rostering time that trainees
 * cannot work alone. So the rules the scheduler will apply sit next to the
 * choice.
 *
 * Branches are a home branch plus the branches this person may cover. The
 * roster builder offers covering staff at those branches and the swap check
 * refuses a swap into a branch the person is not assigned to.
 */

import { useEffect, useState } from "react";

import type { Branch, Employee, EmploymentType, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { EMPLOYMENT_TYPE } from "@/lib/console/labels";
import { EMPLOYMENT_RULES } from "@/lib/console/workforce-rules";
import { Badge, Button, Callout, Field, Select, cx } from "@/components/console/ui";

const TYPES: EmploymentType[] = ["full_time", "part_time", "casual", "contractor", "trainee"];

/** FR-HRM-002 — the rules one employment type carries, as a compact list. */
export function EmploymentRulesSummary({ type }: { type: EmploymentType }) {
  const { t } = useI18n();
  const rules = EMPLOYMENT_RULES[type];
  const rows: [string, string][] = [
    [t("wf.rules.maxShift"), `${rules.maxShiftHours} h`],
    [t("wf.rules.maxWeek"), `${rules.maxWeeklyHours} h`],
    [t("wf.rules.minRest"), `${rules.minRestHours} h`],
    [t("wf.rules.maxDays"), String(rules.maxConsecutiveDays)],
    [
      t("wf.rules.overtime"),
      rules.overtimeEligible
        ? t("wf.rules.overtimeAfter").replace("{n}", String(rules.overtimeAfterWeeklyHours))
        : t("wf.rules.noOvertime"),
    ],
    [t("wf.rules.leave"), rules.leaveEntitlementFactor === 0 ? t("wf.rules.noLeave") : `${Math.round(rules.leaveEntitlementFactor * 100)}%`],
  ];
  return (
    <div className="border-line bg-sunken/40 rounded-lg border p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {rules.requiresSupervision ? (
        <p className="text-warn mt-2 text-xs">{t("wf.rules.supervision")}</p>
      ) : null}
    </div>
  );
}

export function EmploymentTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: EmploymentType;
  onChange: (next: EmploymentType) => void;
  disabled?: boolean;
}) {
  const { t, tx } = useI18n();
  return (
    <Field label={t("wf.employmentType")} required hint={t("wf.employmentTypeHint")}>
      <Select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as EmploymentType)}>
        {TYPES.map((type) => (
          <option key={type} value={type}>
            {tx(EMPLOYMENT_TYPE[type].label)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** FR-HRM-005 — home branch plus covering branches, as a checklist. */
export function BranchAssignmentField({
  branches,
  homeBranchId,
  permittedBranchIds,
  onChange,
  lockedIds = [],
}: {
  branches: Branch[];
  homeBranchId: Id;
  permittedBranchIds: Id[];
  onChange: (next: { homeBranchId: Id; permittedBranchIds: Id[] }) => void;
  /** Branches that cannot be unticked (live: the API cannot remove one). */
  lockedIds?: Id[];
}) {
  const { t, tx } = useI18n();
  return (
    <Field label={t("wf.branchAssignment")} hint={t("wf.branchAssignmentHint")}>
      <ul className="border-line divide-line divide-y rounded-lg border">
        {branches.map((branch) => {
          const home = branch.id === homeBranchId;
          const on = home || permittedBranchIds.includes(branch.id);
          const locked = lockedIds.includes(branch.id);
          return (
            <li key={branch.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="accent-accent h-4 w-4"
                checked={on}
                disabled={home || locked}
                aria-label={tx(branch.name)}
                onChange={() =>
                  onChange({
                    homeBranchId,
                    permittedBranchIds: on
                      ? permittedBranchIds.filter((id) => id !== branch.id)
                      : [...permittedBranchIds, branch.id],
                  })
                }
              />
              <span className="text-fg min-w-0 flex-1 truncate text-sm">{tx(branch.name)}</span>
              {home ? (
                <Badge tone="accent">{t("wf.homeBranch")}</Badge>
              ) : (
                <button
                  type="button"
                  className={cx("text-xs underline-offset-2 hover:underline", "text-fg-muted")}
                  onClick={() =>
                    onChange({
                      homeBranchId: branch.id,
                      permittedBranchIds: [...new Set([...permittedBranchIds, homeBranchId])].filter((id) => id !== branch.id),
                    })
                  }
                >
                  {t("wf.makeHome")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Field>
  );
}

/** The editable section in the employee drawer. */
export function EmploymentSection({
  employee,
  branches,
  onSaved,
}: {
  employee: Employee;
  branches: Branch[];
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const live = DATA_MODE === "http";
  const [type, setType] = useState<EmploymentType>(employee.employmentType);
  const [assignment, setAssignment] = useState({
    homeBranchId: employee.homeBranchId,
    permittedBranchIds: employee.permittedBranchIds.filter((id) => id !== employee.homeBranchId),
  });

  useEffect(() => {
    setType(employee.employmentType);
    setAssignment({
      homeBranchId: employee.homeBranchId,
      permittedBranchIds: employee.permittedBranchIds.filter((id) => id !== employee.homeBranchId),
    });
  }, [employee.id, employee.employmentType, employee.homeBranchId, employee.permittedBranchIds]);

  const dirty =
    type !== employee.employmentType ||
    assignment.homeBranchId !== employee.homeBranchId ||
    [...assignment.permittedBranchIds].sort().join() !==
      employee.permittedBranchIds.filter((id) => id !== employee.homeBranchId).sort().join();

  async function save() {
    const home = branches.find((branch) => branch.id === assignment.homeBranchId);
    await action.run(
      () =>
        services.workforceHr.assignEmployment(employee, {
          employmentType: type,
          homeBranchId: assignment.homeBranchId,
          homeBranchName: home?.name ?? employee.homeBranchName,
          permittedBranchIds: assignment.permittedBranchIds,
        }),
      { onSuccess: () => onSaved(t("wf.employmentSaved")) },
    );
  }

  return (
    <section className="border-line space-y-3 rounded-lg border p-3">
      <h3 className="text-fg text-sm font-semibold">{t("wf.employmentSection")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <EmploymentTypeSelect value={type} onChange={setType} />
      <EmploymentRulesSummary type={type} />
      <BranchAssignmentField
        branches={branches}
        homeBranchId={assignment.homeBranchId}
        permittedBranchIds={assignment.permittedBranchIds}
        onChange={setAssignment}
        lockedIds={live ? employee.permittedBranchIds : []}
      />
      {live ? <Callout tone="muted">{t("wf.branchLiveLimit")}</Callout> : null}
      <Button variant="primary" size="sm" disabled={!dirty} loading={action.pending} onClick={save}>
        {t("common.save")}
      </Button>
    </section>
  );
}
