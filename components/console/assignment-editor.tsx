"use client";

/**
 * Role assignments with scope and validity — FR-SEC-002 … FR-SEC-005, FR-SEC-016.
 *
 * An assignment is three answers: which role, where (tenant, a brand, a set
 * of branches, one branch), and for how long. The third is the one that
 * usually goes missing: a manager covering a colleague's leave is given the
 * role "for two weeks" and still has it two years later. So a temporary
 * assignment carries an end date and simply stops counting on it — the
 * state badge shows it counting down — and "End now" is one click.
 *
 * Every change is checked for segregation of duties on the assignments that
 * would be in force, *before* it is saved: blocking pairs (FR-SEC-016) stop
 * the save outright; warnings are named and have to be accepted.
 */

import { useMemo, useState } from "react";
import { z } from "zod";
import { CalendarClock, Pencil, Plus, Trash2, TimerOff } from "lucide-react";

import type { Branch, Brand, Role, RoleAssignment, ScopeLevel, User } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate } from "@/lib/console/format";
import { SCOPE_LEVEL, labelOf } from "@/lib/console/labels";
import {
  assignmentState,
  daysBetween,
  sodFindingsFor,
  todayIso,
  type AssignmentState,
} from "@/lib/console/access";
import { parseAtBoundary } from "@/lib/console/security-policy";
import { useConfirm } from "@/components/console/confirm";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  cx,
} from "@/components/console/ui";

const STATE_TONE: Record<AssignmentState, "good" | "accent" | "warn" | "muted" | "neutral"> = {
  permanent: "neutral",
  active: "accent",
  expiring: "warn",
  scheduled: "muted",
  expired: "muted",
};

/**
 * FR-SEC-047 — the assignments sent to the service, validated strictly: an
 * unknown field or a malformed date is refused before it leaves the console.
 * FR-SEC-003 — any number of assignments, each with its own scope.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assignmentsSchema = z
  .array(
    z.strictObject({
      roleId: z.string().min(1),
      scopeLevel: z.enum(["tenant", "brand", "branch_set", "branch"]),
      scopeIds: z.array(z.string().min(1)),
      validFrom: isoDate.nullable(),
      validTo: isoDate.nullable(),
    }),
  )
  .max(50);

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return todayIso(date);
}

export function AssignmentsSection({
  user,
  roles,
  onSaved,
}: {
  user: User;
  roles: Role[];
  onSaved: (user: User, message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { can, availableBrands, availableBranches } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const canManage = can("security.user.manage");
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);

  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const today = todayIso();

  const targetName = (level: ScopeLevel, id: string) =>
    level === "brand"
      ? tx(availableBrands.find((row) => row.id === id)?.name) || id
      : tx(availableBranches.find((row) => row.id === id)?.name) || id;

  async function persist(next: RoleAssignment[], message: string) {
    await action.run(
      async () =>
        services.security.users.update(user.id, {
          assignments: parseAtBoundary(assignmentsSchema, next, "Role assignments") as RoleAssignment[],
        }),
      {
        onSuccess: (saved) => onSaved(saved, message),
      },
    );
  }

  async function endNow(index: number) {
    const assignment = user.assignments[index]!;
    const ok = await confirm({
      title: t("asg.endTitle"),
      body: t("asg.endBody").replace("{role}", tx(rolesById.get(assignment.roleId)?.name) || assignment.roleId),
      confirmLabel: t("asg.endNow"),
      tone: "warn",
    });
    if (!ok) return;
    const next = user.assignments.map((row, i) => (i === index ? { ...row, validTo: yesterday() } : row));
    await persist(next, t("asg.ended"));
  }

  async function remove(index: number) {
    const assignment = user.assignments[index]!;
    const ok = await confirm({
      title: t("asg.removeTitle"),
      body: t("asg.removeBody").replace("{role}", tx(rolesById.get(assignment.roleId)?.name) || assignment.roleId),
      confirmLabel: t("common.remove"),
      tone: "danger",
    });
    if (!ok) return;
    await persist(user.assignments.filter((_, i) => i !== index), t("asg.removed"));
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-fg text-sm font-semibold">{t("usr.assignments")}</h3>
        {canManage ? (
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setEditing({ index: null })}>
            {t("asg.add")}
          </Button>
        ) : null}
      </div>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <ul className="divide-line divide-y">
        {user.assignments.map((assignment, index) => {
          const role = rolesById.get(assignment.roleId);
          const state = assignmentState(assignment, today);
          const level = labelOf(SCOPE_LEVEL, assignment.scopeLevel);
          const left = assignment.validTo ? daysBetween(today, assignment.validTo) : null;
          return (
            <li key={`${assignment.roleId}-${index}`} className={cx("py-2.5", state === "expired" && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg text-sm font-medium">{role ? tx(role.name) : assignment.roleId}</span>
                <Badge tone="muted">{tx(level.label)}</Badge>
                <Badge tone={STATE_TONE[state]}>
                  {state === "active" || state === "expiring"
                    ? t("asg.daysLeft").replace("{n}", String(Math.max(0, left ?? 0)))
                    : t(`asg.state.${state}` as never)}
                </Badge>
              </div>
              <p className="text-fg-subtle mt-1 text-xs">
                {assignment.scopeIds.length === 0
                  ? t("usr.scopeAll")
                  : assignment.scopeIds.map((id) => targetName(assignment.scopeLevel, id)).join(" · ")}
              </p>
              {assignment.validFrom || assignment.validTo ? (
                <p className="text-fg-subtle mt-0.5 text-xs">
                  {t("usr.validity")}: {assignment.validFrom ? formatDate(assignment.validFrom, fmt) : "—"} →{" "}
                  {assignment.validTo ? formatDate(assignment.validTo, fmt) : t("asg.noEnd")}
                </p>
              ) : null}
              {canManage ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil size={11} />} onClick={() => setEditing({ index })}>
                    {t("common.edit")}
                  </Button>
                  {state === "active" || state === "expiring" || state === "permanent" ? (
                    <Button size="sm" variant="ghost" icon={<TimerOff size={11} />} onClick={() => void endNow(index)}>
                      {t("asg.endNow")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={<Trash2 size={11} />} onClick={() => void remove(index)}>
                    {t("common.remove")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <AssignmentForm
          user={user}
          roles={roles}
          brands={availableBrands}
          branches={availableBranches}
          index={editing.index}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await persist(next, editing.index === null ? t("asg.added") : t("asg.saved"));
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function AssignmentForm({
  user,
  roles,
  brands,
  branches,
  index,
  onClose,
  onSave,
}: {
  user: User;
  roles: Role[];
  brands: Brand[];
  branches: Branch[];
  index: number | null;
  onClose: () => void;
  onSave: (next: RoleAssignment[]) => Promise<void>;
}) {
  const { t, tx } = useI18n();
  const confirm = useConfirm();
  const existing = index === null ? null : user.assignments[index]!;

  const [roleId, setRoleId] = useState(existing?.roleId ?? roles[0]?.id ?? "");
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>(existing?.scopeLevel ?? "branch");
  const [scopeIds, setScopeIds] = useState<string[]>(existing?.scopeIds ?? []);
  const [temporary, setTemporary] = useState(Boolean(existing?.validTo));
  const [validFrom, setValidFrom] = useState(existing?.validFrom ?? todayIso());
  const [validTo, setValidTo] = useState(existing?.validTo ?? "");
  const [busy, setBusy] = useState(false);

  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const proposed: RoleAssignment = {
    roleId,
    scopeLevel,
    scopeIds: scopeLevel === "tenant" ? [] : scopeIds,
    validFrom: temporary ? validFrom || null : null,
    validTo: temporary ? validTo || null : null,
  };
  const next =
    index === null
      ? [...user.assignments, proposed]
      : user.assignments.map((row, i) => (i === index ? proposed : row));

  // Checked on what will be in force on the assignment's first day.
  const checkDay = temporary && validFrom > todayIso() ? validFrom : todayIso();
  const findings = sodFindingsFor(next, rolesById, checkDay);
  const blocking = findings.filter((finding) => finding.pair.blocking);
  const warnings = findings.filter((finding) => !finding.pair.blocking);

  const problems = [
    !roleId ? t("asg.needRole") : null,
    scopeLevel !== "tenant" && proposed.scopeIds.length === 0 ? t("asg.needScope") : null,
    scopeLevel === "branch" && proposed.scopeIds.length > 1 ? t("asg.oneBranch") : null,
    temporary && !validTo ? t("asg.needEnd") : null,
    temporary && validTo && validFrom && validTo < validFrom ? t("asg.endBeforeStart") : null,
    temporary && validTo && validTo < todayIso() ? t("asg.endInPast") : null,
  ].filter((row): row is string => row !== null);

  async function save() {
    if (warnings.length > 0) {
      const ok = await confirm({
        title: t("asg.sodWarnTitle"),
        body: warnings.map((finding) => tx(finding.pair.risk)).join(" · "),
        confirmLabel: t("asg.saveAnyway"),
        tone: "warn",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  const toggleBranch = (id: string) =>
    setScopeIds((current) =>
      scopeLevel === "branch" ? [id] : current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
    );

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={index === null ? t("asg.add") : t("asg.edit")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={problems.length > 0 || blocking.length > 0} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("common.role")} required>
          <Select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {tx(role.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("asg.scope")} hint={t("asg.scopeHint")}>
          <SegmentedControl<ScopeLevel>
            value={scopeLevel}
            onChange={(level) => {
              setScopeLevel(level);
              setScopeIds([]);
            }}
            options={(["tenant", "brand", "branch_set", "branch"] as ScopeLevel[]).map((level) => ({
              value: level,
              label: tx(labelOf(SCOPE_LEVEL, level).label),
            }))}
          />
        </Field>

        {scopeLevel === "brand" ? (
          <div className="flex flex-wrap gap-1.5">
            {brands.map((brand) => (
              <Chip key={brand.id} on={scopeIds.includes(brand.id)} onClick={() => setScopeIds(scopeIds.includes(brand.id) ? scopeIds.filter((id) => id !== brand.id) : [...scopeIds, brand.id])}>
                {tx(brand.name)}
              </Chip>
            ))}
          </div>
        ) : scopeLevel === "branch" || scopeLevel === "branch_set" ? (
          <div className="flex flex-wrap gap-1.5">
            {branches.map((branch) => (
              <Chip key={branch.id} on={scopeIds.includes(branch.id)} onClick={() => toggleBranch(branch.id)}>
                {tx(branch.name)}
              </Chip>
            ))}
          </div>
        ) : null}

        <Field label={t("asg.duration")}>
          <SegmentedControl<"permanent" | "temporary">
            value={temporary ? "temporary" : "permanent"}
            onChange={(value) => setTemporary(value === "temporary")}
            options={[
              { value: "permanent", label: t("asg.permanent") },
              { value: "temporary", label: t("asg.temporary") },
            ]}
          />
        </Field>

        {temporary ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("asg.from")}>
              <Input type="date" dir="ltr" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
            </Field>
            <Field label={t("asg.to")} required hint={t("asg.toHint")}>
              <Input type="date" dir="ltr" min={validFrom || todayIso()} value={validTo} onChange={(event) => setValidTo(event.target.value)} />
            </Field>
          </div>
        ) : (
          <Callout tone="muted" icon={<CalendarClock size={14} />}>
            {t("asg.permanentNote")}
          </Callout>
        )}

        {problems.length > 0 ? <Callout tone="warn">{problems.join(" ")}</Callout> : null}

        {blocking.length > 0 ? (
          <Callout tone="bad" title={t("asg.sodBlockedTitle")}>
            {blocking.map((finding) => (
              <p key={`${finding.pair.a}-${finding.pair.b}`}>
                {tx(finding.pair.risk)}{" "}
                <span className="font-mono text-[0.68rem]" dir="ltr">
                  ({finding.pair.a} + {finding.pair.b})
                </span>
              </p>
            ))}
          </Callout>
        ) : warnings.length > 0 ? (
          <Callout tone="warn" title={t("asg.sodWarnTitle")}>
            {warnings.map((finding) => tx(finding.pair.risk)).join(" · ")}
          </Callout>
        ) : (
          <Callout tone="good">{t("role.noConflicts")}</Callout>
        )}
      </div>
    </Modal>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
        on ? "border-accent bg-accent-soft text-accent font-medium" : "border-line bg-raised text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
