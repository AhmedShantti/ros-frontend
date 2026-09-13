"use client";

/**
 * Alert rules, scheduled deliveries and the morning brief — SRS §19.5.
 *
 * The pure policy lives in `lib/console/delivery.ts`; this file is the
 * editing surface for it. The one idea worth knowing before changing
 * anything here: the rule drawer runs the *same* `decideDeliveries` the
 * delivery log does, against a synthetic burst, so a rate limit is never a
 * number someone types and hopes about (FR-RPT-046).
 */

import { useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, RotateCcw, Send, Smartphone, Trash2 } from "lucide-react";

import type { DashboardData, Id, ReportDefinition, Severity } from "@/lib/console/types";
import {
  ALERT_TRIGGERS,
  BRIEF_SECTIONS,
  DELIVERY_CHANNELS,
  TRIGGER_BY_ID,
  decideDeliveries,
  nextRun,
  parseEmails,
  periodRange,
  readingSeconds,
  syntheticBurst,
  triggerOf,
  type AlertEvent,
  type AlertRule,
  type BriefSection,
  type DeliveryChannel,
  type DeliveryOutcome,
  type MorningBriefConfig,
  type ReportSchedule,
  type ScheduleFrequency,
  type SchedulePeriod,
} from "@/lib/console/delivery";
import { ROLE_LIST, type RoleKey } from "@/lib/console/permissions";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { exportRows, type ExportFormat } from "@/lib/console/export";
import { useExportLog } from "@/lib/console/export-log";
import { runReport } from "@/lib/console/reports/engine";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { useConfirm, useConfirmDelete } from "@/components/console/confirm";
import { MoneyInput, PercentInput, SearchSelect } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Drawer,
  Field,
  Input,
  SegmentedControl,
  Select,
  SpecTag,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** A row of on/off chips — channels, roles, branches, brief sections. */
function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() =>
              onChange(on ? value.filter((row) => row !== option.value) : [...value, option.value])
            }
            className={cx(
              "rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
              on
                ? "border-accent bg-accent-soft text-accent font-medium"
                : "border-line bg-raised text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EmailsField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const { t } = useI18n();
  const parsed = parseEmails(value);
  return (
    <Field
      label={label}
      hint={t("dlv.emailsHint")}
      error={parsed.invalid.length > 0 ? t("dlv.emailsInvalid").replace("{list}", parsed.invalid.join(", ")) : null}
    >
      <Textarea rows={2} dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

const SEVERITY_TONE: Record<Severity, "bad" | "warn" | "accent" | "neutral" | "muted"> = {
  critical: "bad",
  high: "bad",
  medium: "warn",
  low: "accent",
  info: "muted",
};

const OUTCOME_TONE: Record<DeliveryOutcome, "good" | "neutral" | "accent" | "warn" | "muted"> = {
  delivered: "good",
  deduplicated: "neutral",
  digested: "accent",
  rate_limited: "warn",
  quiet_hours: "muted",
  out_of_scope: "muted",
  disabled: "muted",
  no_rule: "muted",
};

const OUTCOME_SWATCH: Record<DeliveryOutcome, string> = {
  delivered: "bg-good",
  deduplicated: "bg-fg-subtle",
  digested: "bg-accent",
  rate_limited: "bg-warn",
  quiet_hours: "bg-line-strong",
  out_of_scope: "bg-line",
  disabled: "bg-line",
  no_rule: "bg-line",
};

function useRoleOptions() {
  const { tx } = useI18n();
  return useMemo(
    () => ROLE_LIST.filter((role) => role.key !== "platform_admin").map((role) => ({ value: role.key, label: tx(role.name) })),
    [tx],
  );
}

function useBranchOptions() {
  const { tx } = useI18n();
  const { availableBranches } = useSession();
  return useMemo(
    () => availableBranches.map((branch) => ({ value: branch.id, label: tx(branch.name) })),
    [availableBranches, tx],
  );
}

function recipientsSummary(
  roles: RoleKey[],
  emails: string[],
  roleName: (key: RoleKey) => string,
): string {
  return [...roles.map(roleName), ...emails].join(", ") || "—";
}

function useRoleName() {
  const { tx } = useI18n();
  return (key: RoleKey) => {
    const role = ROLE_LIST.find((row) => row.key === key);
    return role ? tx(role.name) : key;
  };
}

// ---------------------------------------------------------------------------
// Alert rules — FR-RPT-045, FR-RPT-046
// ---------------------------------------------------------------------------

export function AlertRulesPanel({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { scope, canAny, tenant } = useSession();
  const roleName = useRoleName();
  const canEdit = canAny(["settings.branch.manage", "settings.tenant.manage"]);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const toggle = useAction(notify);

  const rules = useAsync(() => services.delivery.rules.all(), []);

  // The operational alerts the dashboard is already raising, run through the
  // policy as it stands — "what would people have received?"
  const dashboard = useAsync<DashboardData | null>(
    () => services.dashboard.get(scope).catch(() => null),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const ordered = useMemo(
    () =>
      [...(rules.data ?? [])].sort(
        (a, b) =>
          ALERT_TRIGGERS.findIndex((row) => row.trigger === a.trigger) -
          ALERT_TRIGGERS.findIndex((row) => row.trigger === b.trigger),
      ),
    [rules.data],
  );

  function thresholdText(rule: AlertRule): string {
    const definition = TRIGGER_BY_ID.get(rule.trigger)!;
    if (rule.threshold === null) return tx(definition.when);
    switch (definition.thresholdKind) {
      case "money":
        return `> ${formatMoney({ amount: rule.threshold, currency: tenant.baseCurrency }, fmt)}`;
      case "percent":
        return `> ${formatPercent(rule.threshold, fmt, 0)}`;
      case "minutes":
        return `> ${formatNumber(rule.threshold, fmt)} ${t("set.minutes")}`;
      case "count":
        return `> ${formatNumber(rule.threshold, fmt)}`;
      case "hour":
        return `${String(rule.threshold).padStart(2, "0")}:00`;
      default:
        return tx(definition.when);
    }
  }

  const columns: Column<AlertRule>[] = [
    {
      key: "trigger",
      header: t("dlv.trigger"),
      render: (rule) => {
        const definition = TRIGGER_BY_ID.get(rule.trigger)!;
        return <CellStack primary={tx(definition.label)} secondary={thresholdText(rule)} />;
      },
    },
    {
      key: "severity",
      header: t("dlv.severity"),
      render: (rule) => <Badge tone={SEVERITY_TONE[rule.severity]}>{t(`dlv.sev.${rule.severity}` as ConsoleKey)}</Badge>,
    },
    {
      key: "channels",
      header: t("dlv.channels"),
      secondary: true,
      render: (rule) => (
        <span className="text-fg-muted text-xs">
          {rule.channels.map((id) => tx(DELIVERY_CHANNELS.find((row) => row.id === id)!.label)).join(" · ")}
        </span>
      ),
    },
    {
      key: "recipients",
      header: t("dlv.recipients"),
      secondary: true,
      render: (rule) => (
        <span className="text-fg-muted line-clamp-2 text-xs">
          {recipientsSummary(rule.recipientRoles, rule.recipientEmails, roleName)}
        </span>
      ),
    },
    {
      key: "limit",
      header: t("dlv.rateLimit"),
      render: (rule) => (
        <span className="text-fg-muted text-xs tabular-nums">
          {t("dlv.limitSummary")
            .replace("{max}", String(rule.rateLimit.max))
            .replace("{period}", periodLabel(rule.rateLimit.periodMinutes, t))}
        </span>
      ),
    },
    {
      key: "enabled",
      header: t("dlv.enabled"),
      render: (rule) => (
        // The row opens the editor on click; the switch must not.
        <span onClick={(event) => event.stopPropagation()} className="block w-28">
          <Toggle
            checked={rule.enabled}
            disabled={!canEdit || toggle.pending}
            label={rule.enabled ? t("dlv.on") : t("dlv.off")}
            onChange={(next) =>
              void toggle.run(() => services.delivery.rules.update(rule.id, { enabled: next }), {
                onSuccess: () => rules.reload(),
              })
            }
          />
        </span>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "end",
      render: (rule) => (
        <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(rule)}>
          {canEdit ? t("common.edit") : t("common.view")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Callout tone="accent" title={t("dlv.fatigueTitle")}>
        {t("dlv.fatigueBody")}
      </Callout>
      {!canEdit ? <Callout tone="warn">{t("dlv.rulesReadOnly")}</Callout> : null}
      {toggle.error ? <Callout tone="bad">{toggle.error}</Callout> : null}

      <AsyncPanel state={rules}>
        {() => (
          <DataTable
            columns={columns}
            rows={ordered}
            rowKey={(rule) => rule.id}
            onRowClick={setEditing}
            caption={t("dlv.rulesTitle")}
          />
        )}
      </AsyncPanel>

      <DeliveryLog rules={rules.data ?? []} alerts={dashboard.data?.alerts ?? null} loading={dashboard.loading} />

      {editing ? (
        <RuleDrawer
          key={editing.id}
          rule={editing}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            rules.reload();
            notify(message);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function periodLabel(minutes: number, t: (key: ConsoleKey) => string): string {
  if (minutes % 1440 === 0) return t("dlv.perDay");
  if (minutes % 60 === 0) {
    return minutes === 60 ? t("dlv.perHour") : t("dlv.perHours").replace("{n}", String(minutes / 60));
  }
  return t("dlv.perMinutes").replace("{n}", String(minutes));
}

const PERIOD_OPTIONS = [15, 30, 60, 180, 720, 1440];

function RuleDrawer({
  rule,
  readOnly,
  onClose,
  onSaved,
}: {
  rule: AlertRule;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { session, tenant, availableBranches } = useSession();
  const action = useAction();
  const confirm = useConfirm();
  const roleOptions = useRoleOptions();
  const branchOptions = useBranchOptions();
  const definition = TRIGGER_BY_ID.get(rule.trigger)!;

  const [draft, setDraft] = useState<AlertRule>(rule);
  const [emails, setEmails] = useState(rule.recipientEmails.join(", "));
  const [burst, setBurst] = useState(40);

  const parsedEmails = parseEmails(emails);
  const candidate: AlertRule = { ...draft, recipientEmails: parsedEmails.valid };
  const set = (patch: Partial<AlertRule>) => setDraft((current) => ({ ...current, ...patch }));

  const problems = [
    candidate.channels.length === 0 ? t("dlv.needChannel") : null,
    candidate.recipientRoles.length === 0 && candidate.recipientEmails.length === 0 ? t("dlv.needRecipient") : null,
    parsedEmails.invalid.length > 0 ? t("dlv.fixEmails") : null,
    candidate.rateLimit.max < 1 ? t("dlv.needLimit") : null,
  ].filter((row): row is string => row !== null);

  // FR-RPT-046, tested before it is saved: forty of this alert in an hour,
  // spread across the first three branches so dedupe and the limit can be
  // told apart.
  const burstBranches = (candidate.branchIds.length > 0 ? candidate.branchIds : availableBranches.map((row) => row.id)).slice(0, 3);
  const decisions = decideDeliveries(
    syntheticBurst(rule.trigger, burst, 60, burstBranches, burstStart()),
    [{ ...candidate, quietHours: null }],
  );
  const counts = decisions.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {});

  async function save() {
    await action.run(
      () =>
        services.delivery.rules.update(rule.id, {
          ...candidate,
          updatedBy: session?.user.email ?? null,
        }),
      { onSuccess: () => onSaved(t("dlv.ruleSaved")) },
    );
  }

  async function restore() {
    const ok = await confirm({
      title: t("dlv.restoreTitle"),
      body: t("dlv.restoreBody"),
      confirmLabel: t("dlv.restore"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(() => services.delivery.rules.restoreDefault(rule.id), {
      onSuccess: () => onSaved(t("dlv.restored")),
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(definition.label)}
      subtitle={
        <span className="flex items-center gap-2">
          {tx(definition.when)} <SpecTag id={definition.spec} />
        </span>
      }
      footer={
        readOnly ? (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <div className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={restore}>
              {t("dlv.restore")}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )
      }
    >
      <fieldset disabled={readOnly} className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {problems.length > 0 && !readOnly ? <Callout tone="warn">{problems.join(" ")}</Callout> : null}

        <Toggle checked={draft.enabled} onChange={(next) => set({ enabled: next })} label={t("dlv.enabled")} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dlv.severity")}>
            <Select value={draft.severity} onChange={(event) => set({ severity: event.target.value as Severity })}>
              {(["critical", "high", "medium", "low", "info"] as Severity[]).map((severity) => (
                <option key={severity} value={severity}>
                  {t(`dlv.sev.${severity}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>

          {definition.thresholdKind !== "none" && definition.thresholdLabel ? (
            <Field label={tx(definition.thresholdLabel)}>
              {definition.thresholdKind === "money" ? (
                <MoneyInput
                  value={draft.threshold}
                  currency={tenant.baseCurrency}
                  onChange={(minor) => set({ threshold: minor ?? 0 })}
                />
              ) : definition.thresholdKind === "percent" ? (
                <PercentInput
                  value={String(draft.threshold ?? "")}
                  onChange={(next) => set({ threshold: next === "" ? 0 : Number(next) })}
                />
              ) : definition.thresholdKind === "hour" ? (
                <Select
                  value={String(draft.threshold ?? 7)}
                  onChange={(event) => set({ threshold: Number(event.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={String(hour)}>
                      {`${String(hour).padStart(2, "0")}:00`}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  value={String(draft.threshold ?? "")}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "");
                    set({ threshold: digits === "" ? 0 : Number(digits) });
                  }}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
          ) : null}
        </div>

        <Field label={t("dlv.channels")}>
          <ChipGroup<DeliveryChannel>
            label={t("dlv.channels")}
            options={DELIVERY_CHANNELS.map((row) => ({ value: row.id, label: tx(row.label) }))}
            value={draft.channels}
            onChange={(next) => set({ channels: next })}
          />
        </Field>

        <Field label={t("dlv.recipientRoles")}>
          <ChipGroup<RoleKey>
            label={t("dlv.recipientRoles")}
            options={roleOptions}
            value={draft.recipientRoles}
            onChange={(next) => set({ recipientRoles: next })}
          />
        </Field>

        <EmailsField label={t("dlv.recipientEmails")} value={emails} onChange={setEmails} />

        <Field label={t("dlv.branches")} hint={t("dlv.branchesHint")}>
          <ChipGroup<Id>
            label={t("dlv.branches")}
            options={branchOptions}
            value={draft.branchIds}
            onChange={(next) => set({ branchIds: next })}
          />
        </Field>

        <Card>
          <CardHeader title={t("dlv.policyTitle")} hint={t("dlv.policyHint")} spec="FR-RPT-046" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("dlv.maxPerPeriod")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={String(draft.rateLimit.max)}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^\d]/g, "");
                  set({ rateLimit: { ...draft.rateLimit, max: digits === "" ? 0 : Number(digits) } });
                }}
                className="font-mono tabular-nums"
              />
            </Field>
            <Field label={t("dlv.period")}>
              <Select
                value={String(draft.rateLimit.periodMinutes)}
                onChange={(event) =>
                  set({ rateLimit: { ...draft.rateLimit, periodMinutes: Number(event.target.value) } })
                }
              >
                {PERIOD_OPTIONS.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {periodLabel(minutes, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dlv.dedupe")} hint={t("dlv.dedupeHint")}>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={String(draft.dedupeMinutes)}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^\d]/g, "");
                  set({ dedupeMinutes: digits === "" ? 0 : Number(digits) });
                }}
                className="font-mono tabular-nums"
              />
            </Field>
          </div>
          <Toggle
            checked={draft.digestOverflow}
            onChange={(next) => set({ digestOverflow: next })}
            label={t("dlv.digestOverflow")}
            hint={t("dlv.digestOverflowHint")}
          />
          <Toggle
            checked={draft.quietHours !== null}
            onChange={(next) => set({ quietHours: next ? { from: "23:00", to: "07:00" } : null })}
            label={t("dlv.quietHours")}
            hint={t("dlv.quietHoursHint")}
          />
          {draft.quietHours ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("range.from")}>
                <Input
                  type="time"
                  dir="ltr"
                  value={draft.quietHours.from}
                  onChange={(event) => set({ quietHours: { ...draft.quietHours!, from: event.target.value } })}
                />
              </Field>
              <Field label={t("range.to")}>
                <Input
                  type="time"
                  dir="ltr"
                  value={draft.quietHours.to}
                  onChange={(event) => set({ quietHours: { ...draft.quietHours!, to: event.target.value } })}
                />
              </Field>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title={t("dlv.testTitle")} hint={t("dlv.testHint").replace("{n}", String(burst))} />
          <input
            type="range"
            min={5}
            max={80}
            step={5}
            value={burst}
            onChange={(event) => setBurst(Number(event.target.value))}
            aria-label={t("dlv.burstSize")}
            className="accent-accent w-full"
          />
          <div className="mt-3 flex flex-wrap gap-1" aria-hidden>
            {decisions.map((row) => (
              <span
                key={row.event.id}
                title={t(`dlv.outcome.${row.outcome}` as ConsoleKey)}
                className={cx("h-3 w-3 rounded-sm", OUTCOME_SWATCH[row.outcome])}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["delivered", "deduplicated", "digested", "rate_limited"] as DeliveryOutcome[]).map((outcome) =>
              counts[outcome] ? (
                <Badge key={outcome} tone={OUTCOME_TONE[outcome]} dot>
                  {t(`dlv.outcome.${outcome}` as ConsoleKey)}: {counts[outcome]}
                </Badge>
              ) : null,
            )}
          </div>
          <p className="text-fg-subtle mt-2 text-xs">
            {t("dlv.testVerdict")
              .replace("{delivered}", String(counts.delivered ?? 0))
              .replace("{n}", String(burst))}
          </p>
        </Card>
      </fieldset>
    </Drawer>
  );
}

/** Midday today — a burst that starts here never straddles midnight. */
function burstStart(): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
}

function DeliveryLog({
  rules,
  alerts,
  loading,
}: {
  rules: AlertRule[];
  alerts: DashboardData["alerts"] | null;
  loading: boolean;
}) {
  const { t, tx, fmt } = useI18n();

  const decisions = useMemo(() => {
    if (!alerts) return [];
    const events: AlertEvent[] = [];
    const unmapped: AlertEvent[] = [];
    for (const alert of alerts) {
      const trigger = triggerOf(alert.kind);
      const event: AlertEvent = {
        id: alert.id,
        trigger: (trigger ?? alert.kind) as AlertEvent["trigger"],
        severity: alert.severity,
        branchId: alert.branchId,
        raisedAt: alert.raisedAt,
        title: alert.title,
      };
      (trigger ? events : unmapped).push(event);
    }
    return [
      ...decideDeliveries(events, rules),
      ...unmapped.map((event) => ({ event, outcome: "no_rule" as DeliveryOutcome, mergedInto: null })),
    ].sort((a, b) => b.event.raisedAt.localeCompare(a.event.raisedAt));
  }, [alerts, rules]);

  const columns: Column<(typeof decisions)[number]>[] = [
    {
      key: "when",
      header: t("audit.occurred"),
      render: (row) => (
        <CellStack primary={formatRelative(row.event.raisedAt, fmt)} secondary={formatDateTime(row.event.raisedAt, fmt)} />
      ),
    },
    { key: "alert", header: t("dlv.trigger"), render: (row) => tx(row.event.title) },
    {
      key: "severity",
      header: t("dlv.severity"),
      render: (row) => <Badge tone={SEVERITY_TONE[row.event.severity]}>{t(`dlv.sev.${row.event.severity}` as ConsoleKey)}</Badge>,
    },
    {
      key: "outcome",
      header: t("dlv.outcome"),
      render: (row) => (
        <Badge tone={OUTCOME_TONE[row.outcome]} dot>
          {t(`dlv.outcome.${row.outcome}` as ConsoleKey)}
        </Badge>
      ),
    },
  ];

  return (
    <Card padded={false}>
      <div className="px-5 pt-4">
        <CardHeader title={t("dlv.logTitle")} hint={t("dlv.logHint")} />
      </div>
      <DataTable
        columns={columns}
        rows={decisions}
        rowKey={(row) => row.event.id}
        loading={loading}
        caption={t("dlv.logTitle")}
        emptyTitle={t("dlv.logEmpty")}
        dense
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Scheduled report delivery — FR-RPT-040
// ---------------------------------------------------------------------------

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function SchedulesPanel({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt, locale } = useI18n();
  const { can, scope, session } = useSession();
  const roleName = useRoleName();
  const confirmDelete = useConfirmDelete();
  const log = useExportLog();
  const action = useAction(notify);
  const canEdit = can("report.export");

  const schedules = useAsync(() => services.delivery.schedules.list({ limit: 200, sort: "name" }), []);
  const catalogue = useAsync<ReportDefinition[]>(() => services.platform.reports(), []);
  const [editing, setEditing] = useState<ReportSchedule | "new" | null>(null);

  const reportName = (id: string) => {
    const report = catalogue.data?.find((row) => row.id === id);
    return report ? tx(report.name) : id;
  };

  function cadence(row: ReportSchedule): string {
    if (row.frequency === "daily") return t("dlv.cadenceDaily").replace("{time}", row.time);
    if (row.frequency === "weekly") {
      return t("dlv.cadenceWeekly")
        .replace("{day}", weekdayName(row.weekday, locale))
        .replace("{time}", row.time);
    }
    return t("dlv.cadenceMonthly").replace("{day}", String(row.monthDay)).replace("{time}", row.time);
  }

  /**
   * "Send now" produces exactly the file the schedule would send and runs
   * it through the export log (FR-RPT-044). It lands in this browser's
   * downloads: the backend has no mail transport to hand it to.
   */
  async function sendNow(row: ReportSchedule) {
    await action.run(
      async () => {
        const range = periodRange(row.period);
        const result = await runReport(row.reportId, {
          from: range.from,
          to: range.to,
          scope: { ...scope, branchId: row.branchIds.length === 1 ? row.branchIds[0]! : scope.branchId },
          groupBy: "",
          compare: false,
          locale,
        });
        if (result.unavailable) {
          throw new Error(t("dlv.reportUnavailable").replace("{report}", reportName(row.reportId)));
        }
        const title = `${row.name} — ${range.from} → ${range.to}`;
        const outcome = exportRows(row.format, {
          filename: row.name.replace(/\s+/g, "-").toLowerCase() || row.reportId,
          title,
          subtitle: reportName(row.reportId),
          rows: result.rows,
          columns: [
            { key: "label", header: t("rep.col.group"), value: (entry) => entry.label },
            ...result.columns.map((column) => ({
              key: column.key,
              header: t(column.header as never),
              value: (entry: (typeof result.rows)[number]) => {
                const value = entry.values[column.key];
                if (column.currency && typeof value === "number") return value / 100;
                return value ?? "";
              },
            })),
          ],
        });
        log.record({
          title,
          format: row.format,
          rowCount: outcome.rowCount,
          filters: `${t("dlv.scheduledDelivery")} · ${recipientsSummary(row.recipientRoles, row.recipientEmails, roleName)}`,
          requestedBy: session?.user.email ?? null,
        });
        return services.delivery.schedules.markSent(row.id);
      },
      { onSuccess: () => schedules.reload(), success: t("dlv.sent") },
    );
  }

  async function remove(row: ReportSchedule) {
    if (!(await confirmDelete(row.name))) return;
    await action.run(() => services.delivery.schedules.remove(row.id), {
      onSuccess: () => schedules.reload(),
      success: t("dlv.scheduleDeleted"),
    });
  }

  const columns: Column<ReportSchedule>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (row) => <CellStack primary={row.name} secondary={reportName(row.reportId)} />,
    },
    { key: "cadence", header: t("dlv.cadence"), render: (row) => cadence(row) },
    {
      key: "format",
      header: t("dlv.format"),
      render: (row) => <Badge tone="neutral">{row.format.toUpperCase()}</Badge>,
    },
    {
      key: "recipients",
      header: t("dlv.recipients"),
      secondary: true,
      render: (row) => (
        <span className="text-fg-muted line-clamp-2 text-xs">
          {recipientsSummary(row.recipientRoles, row.recipientEmails, roleName)}
        </span>
      ),
    },
    {
      key: "next",
      header: t("dlv.nextRun"),
      render: (row) =>
        row.active ? (
          <CellStack
            primary={formatDateTime(nextRun(row).toISOString(), fmt)}
            secondary={row.lastSentAt ? `${t("dlv.lastSent")} ${formatRelative(row.lastSentAt, fmt)}` : undefined}
          />
        ) : (
          <Badge tone="muted">{t("dlv.paused")}</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={<Send size={12} />} disabled={!canEdit} onClick={() => void sendNow(row)}>
            {t("dlv.sendNow")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} disabled={!canEdit} onClick={() => setEditing(row)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} disabled={!canEdit} onClick={() => void remove(row)}>
            {t("common.delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Callout tone="muted" title={t("dlv.transportTitle")}>
        {t("dlv.transportBody")}
      </Callout>
      {!canEdit ? <Callout tone="warn">{t("dlv.schedulesReadOnly")}</Callout> : null}
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus size={14} />} disabled={!canEdit} onClick={() => setEditing("new")}>
          {t("dlv.newSchedule")}
        </Button>
      </div>

      <AsyncPanel state={schedules}>
        {(page) => (
          <DataTable
            columns={columns}
            rows={page.rows}
            rowKey={(row) => row.id}
            caption={t("dlv.schedulesTitle")}
            emptyTitle={t("dlv.noSchedules")}
            emptyBody={t("dlv.noSchedulesBody")}
            emptyAction={
              canEdit ? (
                <Button size="sm" icon={<CalendarClock size={12} />} onClick={() => setEditing("new")}>
                  {t("dlv.newSchedule")}
                </Button>
              ) : undefined
            }
          />
        )}
      </AsyncPanel>

      {editing ? (
        <ScheduleDrawer
          key={editing === "new" ? "new" : editing.id}
          schedule={editing === "new" ? null : editing}
          reports={catalogue.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            schedules.reload();
            notify(message);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function weekdayName(day: number, locale: "en" | "ar"): string {
  // 2023-01-01 was a Sunday, which lines the index up with `getDay()`.
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", { weekday: "long" }).format(
    new Date(2023, 0, 1 + day),
  );
}

function ScheduleDrawer({
  schedule,
  reports,
  onClose,
  onSaved,
}: {
  schedule: ReportSchedule | null;
  reports: ReportDefinition[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t, tx, locale, fmt } = useI18n();
  const { canAny, session } = useSession();
  const action = useAction();
  const roleOptions = useRoleOptions();
  const branchOptions = useBranchOptions();

  const runnable = reports.filter((report) => canAny([report.requiredPermission]));

  const [reportId, setReportId] = useState(schedule?.reportId ?? runnable[0]?.id ?? "");
  const [name, setName] = useState(schedule?.name ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency ?? "daily");
  const [time, setTime] = useState(schedule?.time ?? "07:00");
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 0);
  const [monthDay, setMonthDay] = useState(schedule?.monthDay ?? 1);
  const [period, setPeriod] = useState<SchedulePeriod>(schedule?.period ?? "previous_day");
  const [format, setFormat] = useState<ExportFormat>(schedule?.format ?? "pdf");
  const [channels, setChannels] = useState<("email" | "push")[]>(schedule?.channels ?? ["email"]);
  const [emails, setEmails] = useState(schedule?.recipientEmails.join(", ") ?? "");
  const [roles, setRoles] = useState<RoleKey[]>(schedule?.recipientRoles ?? []);
  const [branchIds, setBranchIds] = useState<Id[]>(schedule?.branchIds ?? []);
  const [active, setActive] = useState(schedule?.active ?? true);

  const parsed = parseEmails(emails);
  const effectiveName = name.trim() || (reportId ? tx(reports.find((row) => row.id === reportId)?.name) : "");

  const problems = [
    !reportId ? t("dlv.needReport") : null,
    channels.length === 0 ? t("dlv.needChannel") : null,
    parsed.valid.length === 0 && roles.length === 0 ? t("dlv.needRecipient") : null,
    parsed.invalid.length > 0 ? t("dlv.fixEmails") : null,
  ].filter((row): row is string => row !== null);

  const preview: ReportSchedule = {
    id: schedule?.id ?? "preview",
    reportId,
    name: effectiveName,
    frequency,
    time,
    weekday,
    monthDay,
    period,
    format,
    channels,
    recipientEmails: parsed.valid,
    recipientRoles: roles,
    branchIds,
    active,
    createdAt: schedule?.createdAt ?? new Date().toISOString(),
    createdBy: schedule?.createdBy ?? null,
    lastSentAt: schedule?.lastSentAt ?? null,
  };
  const next = nextRun(preview);
  const covers = periodRange(period, next);

  async function save() {
    const body: Partial<ReportSchedule> = { ...preview };
    delete body.id;
    delete body.createdAt;
    delete body.lastSentAt;
    await action.run(
      () =>
        schedule
          ? services.delivery.schedules.update(schedule.id, body)
          : services.delivery.schedules.create({ ...body, createdBy: session?.user.email ?? null }),
      { onSuccess: () => onSaved(t("dlv.scheduleSaved")) },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={schedule ? schedule.name : t("dlv.newSchedule")}
      subtitle={<SpecTag id="FR-RPT-040" />}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
            {schedule ? t("common.save") : t("common.create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("dlv.report")} required>
          <SearchSelect
            value={reportId || null}
            onChange={(value) => setReportId(value ?? "")}
            options={runnable.map((report) => ({ value: report.id, label: tx(report.name), hint: report.specRef }))}
            aria-label={t("dlv.report")}
          />
        </Field>

        <Field label={t("common.name")} hint={t("dlv.nameHint")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={effectiveName} maxLength={80} />
        </Field>

        <Field label={t("dlv.frequency")}>
          <SegmentedControl<ScheduleFrequency>
            value={frequency}
            onChange={setFrequency}
            options={[
              { value: "daily", label: t("dlv.daily") },
              { value: "weekly", label: t("dlv.weekly") },
              { value: "monthly", label: t("dlv.monthly") },
            ]}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dlv.time")}>
            <Input type="time" dir="ltr" value={time} onChange={(event) => setTime(event.target.value || "07:00")} />
          </Field>
          {frequency === "weekly" ? (
            <Field label={t("dlv.weekday")}>
              <Select value={String(weekday)} onChange={(event) => setWeekday(Number(event.target.value))}>
                {WEEKDAYS.map((day) => (
                  <option key={day} value={String(day)}>
                    {weekdayName(day, locale)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : frequency === "monthly" ? (
            <Field label={t("dlv.monthDay")} hint={t("dlv.monthDayHint")}>
              <Select value={String(monthDay)} onChange={(event) => setMonthDay(Number(event.target.value))}>
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={String(day)}>
                    {day}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        <Field label={t("dlv.period")}>
          <Select value={period} onChange={(event) => setPeriod(event.target.value as SchedulePeriod)}>
            {(["previous_day", "previous_week", "previous_month", "month_to_date"] as SchedulePeriod[]).map((value) => (
              <option key={value} value={value}>
                {t(`dlv.periodOpt.${value}` as ConsoleKey)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("dlv.format")}>
          <SegmentedControl<ExportFormat>
            value={format}
            onChange={setFormat}
            options={[
              { value: "pdf", label: "PDF" },
              { value: "xlsx", label: "XLSX" },
              { value: "csv", label: "CSV" },
            ]}
          />
        </Field>

        <Field label={t("dlv.channels")}>
          <ChipGroup<"email" | "push">
            label={t("dlv.channels")}
            options={[
              { value: "email", label: t("dlv.channel.email") },
              { value: "push", label: t("dlv.channel.push") },
            ]}
            value={channels}
            onChange={setChannels}
          />
        </Field>

        <EmailsField label={t("dlv.recipientEmails")} value={emails} onChange={setEmails} />

        <Field label={t("dlv.recipientRoles")}>
          <ChipGroup<RoleKey> label={t("dlv.recipientRoles")} options={roleOptions} value={roles} onChange={setRoles} />
        </Field>

        <Field label={t("dlv.branches")} hint={t("dlv.branchesHint")}>
          <ChipGroup<Id> label={t("dlv.branches")} options={branchOptions} value={branchIds} onChange={setBranchIds} />
        </Field>

        <Toggle checked={active} onChange={setActive} label={t("dlv.active")} />

        {problems.length > 0 ? <Callout tone="warn">{problems.join(" ")}</Callout> : null}

        <Callout tone="accent" icon={<CalendarClock size={14} />} title={t("dlv.previewTitle")}>
          {t("dlv.previewBody")
            .replace("{when}", formatDateTime(next.toISOString(), fmt))
            .replace("{from}", covers.from)
            .replace("{to}", covers.to)
            .replace("{format}", format.toUpperCase())}
        </Callout>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Morning brief — FR-RPT-041
// ---------------------------------------------------------------------------

export function MorningBriefPanel({ notify }: { notify: (message: string) => void }) {
  const brief = useAsync(() => services.delivery.brief.read(), []);
  return (
    <AsyncPanel state={brief}>
      {(config) => <MorningBriefEditor key={config.updatedAt ?? "default"} initial={config} notify={notify} onSaved={brief.reload} />}
    </AsyncPanel>
  );
}

function MorningBriefEditor({
  initial,
  notify,
  onSaved,
}: {
  initial: MorningBriefConfig;
  notify: (message: string) => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const { scope, canAny, session } = useSession();
  const action = useAction(notify);
  const roleOptions = useRoleOptions();
  const branchOptions = useBranchOptions();
  const canEdit = canAny(["settings.branch.manage", "settings.tenant.manage"]);

  const [draft, setDraft] = useState<MorningBriefConfig>(initial);
  const [emails, setEmails] = useState(initial.recipientEmails.join(", "));
  const set = (patch: Partial<MorningBriefConfig>) => setDraft((current) => ({ ...current, ...patch }));
  const parsed = parseEmails(emails);

  const dashboard = useAsync<DashboardData | null>(
    () => services.dashboard.get(scope).catch(() => null),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  async function save() {
    await action.run(
      () =>
        services.delivery.brief.save({
          ...draft,
          recipientEmails: parsed.valid,
          updatedBy: session?.user.email ?? null,
        }),
      { onSuccess: onSaved, success: t("dlv.briefSaved") },
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader title={t("dlv.briefTitle")} hint={t("dlv.briefHint")} spec="FR-RPT-041" />
        <fieldset disabled={!canEdit} className="space-y-5">
          {!canEdit ? <Callout tone="warn">{t("dlv.rulesReadOnly")}</Callout> : null}
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

          <Toggle checked={draft.enabled} onChange={(next) => set({ enabled: next })} label={t("dlv.briefEnabled")} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dlv.time")}>
              <Input type="time" dir="ltr" value={draft.time} onChange={(event) => set({ time: event.target.value || "07:30" })} />
            </Field>
            <Field label={t("dlv.channels")}>
              <ChipGroup<"push" | "email">
                label={t("dlv.channels")}
                options={[
                  { value: "push", label: t("dlv.channel.push") },
                  { value: "email", label: t("dlv.channel.email") },
                ]}
                value={draft.channels}
                onChange={(next) => set({ channels: next })}
              />
            </Field>
          </div>

          <Field label={t("dlv.briefSections")} hint={t("dlv.briefSectionsHint")}>
            <ChipGroup<BriefSection>
              label={t("dlv.briefSections")}
              options={BRIEF_SECTIONS.map((row) => ({ value: row.id, label: tx(row.label) }))}
              value={draft.sections}
              onChange={(next) => set({ sections: next })}
            />
          </Field>

          <Field label={t("dlv.recipientRoles")}>
            <ChipGroup<RoleKey>
              label={t("dlv.recipientRoles")}
              options={roleOptions}
              value={draft.recipientRoles}
              onChange={(next) => set({ recipientRoles: next })}
            />
          </Field>

          <EmailsField label={t("dlv.recipientEmails")} value={emails} onChange={setEmails} />

          <Field label={t("dlv.branches")} hint={t("dlv.branchesHint")}>
            <ChipGroup<Id>
              label={t("dlv.branches")}
              options={branchOptions}
              value={draft.branchIds}
              onChange={(next) => set({ branchIds: next })}
            />
          </Field>

          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={action.pending}
              disabled={parsed.invalid.length > 0}
              onClick={save}
            >
              {t("common.save")}
            </Button>
          </div>
        </fieldset>
      </Card>

      <BriefPreview config={draft} data={dashboard.data} loading={dashboard.loading} />
    </div>
  );
}

function BriefPreview({
  config,
  data,
  loading,
}: {
  config: MorningBriefConfig;
  data: DashboardData | null;
  loading: boolean;
}) {
  const { t, tx, fmt } = useI18n();

  const lines = useMemo(() => {
    if (!data) return [] as { id: BriefSection; text: string; tone: "good" | "bad" | "neutral" }[];
    const delta = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value, fmt, 1)}%`;
    const tone = (metric: { direction: string; higherIsBetter: boolean }) =>
      metric.direction === "flat"
        ? ("neutral" as const)
        : (metric.direction === "up") === metric.higherIsBetter
          ? ("good" as const)
          : ("bad" as const);

    const ranked = [...data.branchRanking].sort((a, b) => a.rank - b.rank);
    const openAlerts = data.alerts.filter((alert) => !alert.acknowledged);
    const bySeverity = (severity: Severity) => openAlerts.filter((alert) => alert.severity === severity).length;

    const out: { id: BriefSection; text: string; tone: "good" | "bad" | "neutral" }[] = [];
    for (const section of config.sections) {
      switch (section) {
        case "sales":
          out.push({
            id: section,
            text: t("dlv.brief.sales")
              .replace("{value}", formatMoney({ amount: data.netSales.value, currency: data.currency }, fmt, true))
              .replace("{delta}", delta(data.netSales.deltaPercent)),
            tone: tone(data.netSales),
          });
          break;
        case "transactions":
          out.push({
            id: section,
            text: t("dlv.brief.transactions")
              .replace("{value}", formatNumber(data.transactions.value, fmt))
              .replace("{delta}", delta(data.transactions.deltaPercent)),
            tone: tone(data.transactions),
          });
          break;
        case "average_order":
          out.push({
            id: section,
            text: t("dlv.brief.aov")
              .replace("{value}", formatMoney({ amount: data.averageOrderValue.value, currency: data.currency }, fmt))
              .replace("{delta}", delta(data.averageOrderValue.deltaPercent)),
            tone: tone(data.averageOrderValue),
          });
          break;
        case "food_cost":
          out.push(
            data.foodCostPercent
              ? {
                  id: section,
                  text: t("dlv.brief.foodCost")
                    .replace("{value}", formatPercent(data.foodCostPercent.value, fmt))
                    .replace("{delta}", delta(data.foodCostPercent.deltaPercent)),
                  tone: tone(data.foodCostPercent),
                }
              : { id: section, text: t("dlv.brief.foodCostNone"), tone: "neutral" },
          );
          break;
        case "waste":
          out.push(
            data.wastePercent
              ? {
                  id: section,
                  text: t("dlv.brief.waste").replace("{value}", formatPercent(data.wastePercent.value, fmt)),
                  tone: tone(data.wastePercent),
                }
              : { id: section, text: t("dlv.brief.wasteNone"), tone: "neutral" },
          );
          break;
        case "best_branch":
          if (ranked[0]) {
            out.push({
              id: section,
              text: t("dlv.brief.best")
                .replace("{branch}", tx(ranked[0].branchName))
                .replace("{value}", formatMoney(ranked[0].netSales, fmt, true)),
              tone: "good",
            });
          }
          break;
        case "worst_branch":
          if (ranked.length > 1) {
            const worst = ranked[ranked.length - 1]!;
            out.push({
              id: section,
              text: t("dlv.brief.worst")
                .replace("{branch}", tx(worst.branchName))
                .replace("{value}", formatMoney(worst.netSales, fmt, true)),
              tone: "bad",
            });
          }
          break;
        case "alerts":
          out.push({
            id: section,
            text:
              openAlerts.length === 0
                ? t("dlv.brief.noAlerts")
                : t("dlv.brief.alerts")
                    .replace("{critical}", String(bySeverity("critical") + bySeverity("high")))
                    .replace("{other}", String(openAlerts.length - bySeverity("critical") - bySeverity("high"))),
            tone: bySeverity("critical") + bySeverity("high") > 0 ? "bad" : "neutral",
          });
          break;
        case "live":
          out.push({
            id: section,
            text: t("dlv.brief.live")
              .replace("{offline}", String(data.live.offlineTerminals))
              .replace("{backlog}", formatNumber(data.live.syncBacklog, fmt)),
            tone: data.live.offlineTerminals > 0 ? "bad" : "neutral",
          });
          break;
      }
    }
    return out;
  }, [config.sections, data, fmt, t, tx]);

  const seconds = readingSeconds(lines.map((line) => line.text));

  return (
    <div className="space-y-3">
      <div className="text-fg-muted flex items-center gap-2 text-xs">
        <Smartphone size={13} aria-hidden /> {t("dlv.briefPreview")}
      </div>
      <div className="border-line bg-sunken mx-auto w-full max-w-[20rem] rounded-[2rem] border-4 p-3 shadow-lg">
        <div className="bg-raised min-h-[26rem] rounded-[1.4rem] p-4">
          <p className="text-fg-subtle text-[0.65rem] tracking-wide uppercase">
            {config.time} · {t("dlv.briefHeading")}
          </p>
          <p className="text-fg mt-1 text-sm font-semibold">
            {data ? t("dlv.briefFor").replace("{day}", data.businessDay) : t("dlv.briefHeading")}
          </p>
          {!config.enabled ? (
            <p className="text-fg-subtle mt-6 text-center text-xs">{t("dlv.briefOff")}</p>
          ) : loading && !data ? (
            <p className="text-fg-subtle mt-6 text-center text-xs">{t("state.loadingData")}</p>
          ) : !data ? (
            <p className="text-fg-subtle mt-6 text-center text-xs">{t("dlv.briefNoData")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lines.map((line) => (
                <li key={line.id} className="flex items-start gap-2 text-[0.8rem] leading-snug">
                  <span
                    aria-hidden
                    className={cx(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      line.tone === "good" ? "bg-good" : line.tone === "bad" ? "bg-bad" : "bg-fg-subtle",
                    )}
                  />
                  <span className="text-fg">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {config.enabled && data ? (
        <Badge tone={seconds <= 30 ? "good" : "warn"} className="mx-auto flex w-fit">
          {t("dlv.readingTime").replace("{n}", String(seconds))}
        </Badge>
      ) : null}
      {seconds > 30 ? <Callout tone="warn">{t("dlv.tooLong")}</Callout> : null}
    </div>
  );
}
