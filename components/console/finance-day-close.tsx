"use client";

/**
 * Day-close automation and trigger checklist — FR-FIN-025, FR-FIN-026.
 *
 * Configuration per branch, and per day a checklist of what the close is
 * configured to trigger. Execution is the server's: nothing in a browser runs
 * at the business-day boundary, and the day-close API returns no trigger
 * status. So every outcome here reads "not reported by the backend" — the
 * screen never marks a fiscal finalisation or an export as done on its own
 * say-so.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, MinusCircle } from "lucide-react";

import type { Branch, DayClose, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  DAY_CLOSE_TRIGGERS,
  defaultAutomation,
  nextBoundary,
  type DayCloseAutomation,
  type DayCloseTrigger,
} from "@/lib/console/services/finance-day-close-config";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, Drawer, Toggle } from "@/components/console/ui";

export function useDayCloseAutomation() {
  const state = useAsync(() => services.dayCloseConfig.all(), []);
  const byBranch = useMemo(
    () => new Map<Id, DayCloseAutomation>((state.data ?? []).map((row) => [row.branchId, row])),
    [state.data],
  );
  return {
    get: (branchId: Id) => byBranch.get(branchId) ?? defaultAutomation(branchId),
    configured: (branchId: Id) => byBranch.has(branchId),
    reload: state.reload,
    loading: state.loading,
  };
}

// ---------------------------------------------------------------------------

export function DayCloseAutomationSection({
  branches,
  automation,
}: {
  branches: Branch[];
  automation: ReturnType<typeof useDayCloseAutomation>;
}) {
  const { t, tx, fmt } = useI18n();
  const canEdit = usePermission("settings.branch.manage");
  const [editing, setEditing] = useState<Branch | null>(null);

  const columns: Column<Branch>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => tx(row.name) },
    {
      key: "boundary",
      header: t("fnc.boundary"),
      render: (row) => <span className="font-mono text-xs" dir="ltr">{row.businessDayBoundary}</span>,
    },
    {
      key: "auto",
      header: t("fnc.autoClose"),
      render: (row) =>
        automation.get(row.id).autoClose ? (
          <Badge tone="accent">{t("fnc.autoOn")}</Badge>
        ) : (
          <Badge tone="muted">{t("fnc.manualOnly")}</Badge>
        ),
    },
    {
      key: "next",
      header: t("fnc.nextScheduled"),
      secondary: true,
      render: (row) =>
        automation.get(row.id).autoClose ? formatDateTime(nextBoundary(row.businessDayBoundary).toISOString(), fmt) : "—",
    },
    {
      key: "triggers",
      header: t("fnc.triggers"),
      render: (row) => {
        const config = automation.get(row.id);
        const on = DAY_CLOSE_TRIGGERS.filter((trigger) => config.triggers[trigger]).length;
        return `${formatNumber(on, fmt)} / ${formatNumber(DAY_CLOSE_TRIGGERS.length, fmt)}`;
      },
    },
    {
      key: "edit",
      header: "",
      render: (row) =>
        canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
            {t("common.edit")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Section title={t("fnc.automationTitle")} hint={t("fnc.automationHint")} spec="FR-FIN-025">
      <Callout tone="muted">{t("fnc.serverExecutes")}</Callout>
      <div className="mt-3">
        <DataTable columns={columns} rows={branches} rowKey={(row) => row.id} caption={t("fnc.automationTitle")} dense />
      </div>
      {editing ? (
        <AutomationDrawer
          branch={editing}
          initial={automation.get(editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            automation.reload();
            setEditing(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function AutomationDrawer({
  branch,
  initial,
  onClose,
  onSaved,
}: {
  branch: Branch;
  initial: DayCloseAutomation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    // Turning off force-close with auto-close on means the automatic close
    // will be refused whenever a drawer is still open — worth a pause.
    if (draft.autoClose && !draft.forceCloseOpenSessions) {
      const ok = await confirm({
        title: t("fnc.noForceCloseTitle"),
        body: t("fnc.noForceCloseBody"),
        tone: "warn",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await services.dayCloseConfig.save({
        branchId: branch.id,
        autoClose: draft.autoClose,
        forceCloseOpenSessions: draft.forceCloseOpenSessions,
        triggers: draft.triggers,
        updatedBy: session?.user.email ?? null,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const setTrigger = (trigger: DayCloseTrigger, value: boolean) =>
    setDraft((current) => ({ ...current, triggers: { ...current.triggers, [trigger]: value } }));

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(branch.name)}
      subtitle={t("fnc.automationTitle")}
      footer={
        <Button variant="primary" loading={busy} disabled={busy} onClick={save}>
          {t("fnc.saveAutomation")}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <Toggle
          checked={draft.autoClose}
          onChange={(autoClose) => setDraft((current) => ({ ...current, autoClose }))}
          label={t("fnc.autoClose")}
          hint={t("fnc.autoCloseHint")
            .replace("{boundary}", branch.businessDayBoundary)
            .replace("{next}", formatDateTime(nextBoundary(branch.businessDayBoundary).toISOString(), fmt))}
        />
        <Toggle
          checked={draft.forceCloseOpenSessions}
          disabled={!draft.autoClose}
          onChange={(forceCloseOpenSessions) => setDraft((current) => ({ ...current, forceCloseOpenSessions }))}
          label={t("fnc.forceClose")}
          hint={t("fnc.forceCloseHint")}
        />
        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("fnc.triggers")}</h3>
          <p className="text-fg-subtle mb-2 text-xs">{t("fnc.triggersHint")}</p>
          {DAY_CLOSE_TRIGGERS.map((trigger) => (
            <Toggle
              key={trigger}
              checked={draft.triggers[trigger]}
              onChange={(value) => setTrigger(trigger, value)}
              label={t(`fnc.trigger.${trigger}` as ConsoleKey)}
              hint={t(`fnc.trigger.${trigger}Hint` as ConsoleKey)}
            />
          ))}
        </section>
        <Callout tone="muted">{t("fnc.localConfigNote")}</Callout>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/** FR-FIN-026 — per day, what the close is configured to trigger and what is known. */
export function DayCloseChecklist({ day, automation }: { day: DayClose; automation: DayCloseAutomation }) {
  const { t, fmt } = useI18n();
  const closed = day.status === "closed";

  return (
    <section>
      <h3 className="text-fg mb-1 text-sm font-semibold">{t("fnc.checklistTitle")}</h3>
      <p className="text-fg-subtle mb-2 text-xs">{t("fnc.checklistHint")}</p>

      {automation.autoClose && day.blockingSessions.length > 0 && !closed ? (
        // FR-FIN-025 — what the boundary will do to these drawers.
        <Callout tone="warn" title={t("fnc.willForceClose")}>
          {automation.forceCloseOpenSessions
            ? t("fnc.willForceCloseBody").replace("{n}", formatNumber(day.blockingSessions.length, fmt))
            : t("fnc.autoCloseWillBeRefused")}
        </Callout>
      ) : null}

      <ul className="divide-line mt-2 divide-y">
        {DAY_CLOSE_TRIGGERS.map((trigger) => {
          const enabled = automation.triggers[trigger];
          return (
            <li key={trigger} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="flex items-start gap-2">
                {!enabled ? (
                  <MinusCircle size={14} className="text-fg-subtle mt-0.5" aria-hidden />
                ) : closed ? (
                  <CircleDashed size={14} className="text-warn mt-0.5" aria-hidden />
                ) : (
                  <CheckCircle2 size={14} className="text-fg-subtle mt-0.5" aria-hidden />
                )}
                <span>{t(`fnc.trigger.${trigger}` as ConsoleKey)}</span>
              </span>
              {!enabled ? (
                <Badge tone="muted">{t("fnc.notConfigured")}</Badge>
              ) : closed ? (
                <Badge tone="warn">
                  <AlertTriangle size={11} aria-hidden />
                  {t("fnc.notReported")}
                </Badge>
              ) : (
                <Badge tone="neutral">{t("fnc.pendingClose")}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
