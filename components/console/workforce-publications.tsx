"use client";

/**
 * Schedule publication and acknowledgement — FR-HRM-015.
 *
 * Publishing a roster is an event with an audience: these people, these
 * shifts, this week. Each publication keeps who has acknowledged it, when,
 * and how — at the till's clock panel, or recorded by a manager who was told
 * in person. The unacknowledged list is the useful one; it is who to chase
 * before Saturday.
 *
 * The mobile push the SRS asks for needs a notification service. This
 * console has none, so every publication says the push is awaiting the
 * server — it is never shown as sent.
 */

import { useMemo, useState } from "react";
import { BellOff, Check, Send } from "lucide-react";

import type { Branch, Id, ScheduledShift } from "@/lib/console/types";
import type { SchedulePublication } from "@/lib/console/services/workforce-hr";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import { AsyncPanel } from "@/components/console/states";
import { recordPublication, weekStartFor } from "@/components/console/workforce-forms";
import { Badge, Button, Callout, Meter, cx } from "@/components/console/ui";

/**
 * Publish the draft shifts on screen, one publication per branch and week.
 * The shifts move to `published` first; the publication is only recorded for
 * the ones that did.
 */
export function PublishDraftsButton({
  drafts,
  onDone,
}: {
  drafts: ScheduledShift[];
  onDone: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction(onDone);
  const confirm = useConfirm();

  async function publish() {
    const ok = await confirm({
      title: t("wf.pub.publishDraftsTitle"),
      body: t("wf.pub.publishDraftsBody").replace("{n}", String(drafts.length)),
      confirmLabel: t("wf.publish"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      async () => {
        const groups = new Map<string, ScheduledShift[]>();
        for (const shift of drafts) {
          const key = `${shift.branchId}::${weekStartFor(shift.date)}`;
          groups.set(key, [...(groups.get(key) ?? []), shift]);
        }
        for (const [key, shifts] of groups) {
          const [branchId, weekStart] = key.split("::") as [Id, string];
          const done: ScheduledShift[] = [];
          for (const shift of shifts) {
            await services.workforce.shifts.update(shift.id, { status: "published" });
            done.push(shift);
          }
          await recordPublication({
            branchId,
            weekStart,
            shifts: done.map((shift) => ({ id: shift.id, employeeId: shift.employeeId })),
            names: new Map(done.map((shift) => [shift.employeeId, shift.employeeName])),
            by: session?.user.name.en ?? "",
          });
        }
      },
      { onSuccess: () => onDone(t("wf.schedulePublished")) },
    );
  }

  if (drafts.length === 0) return null;
  return (
    <Button icon={<Send size={13} />} loading={action.pending} onClick={() => void publish()}>
      {t("wf.pub.publishDrafts").replace("{n}", formatNumber(drafts.length, fmt))}
    </Button>
  );
}

export function PublicationsPanel({ branches, reloadKey }: { branches: Branch[]; reloadKey: number }) {
  const { t } = useI18n();
  const state = useAsync(
    () =>
      services.workforceHr.publications
        .all()
        .then((rows) => [...rows].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))),
    [reloadKey],
  );

  return (
    <div className="space-y-3">
      <Callout tone="warn" icon={<BellOff size={14} />} title={t("wf.pub.pushTitle")}>
        {t("wf.pub.pushBody")}
      </Callout>
      <AsyncPanel
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("wf.pub.none")}</Callout>}
      >
        {(rows) => (
          <ul className="space-y-3">
            {rows.map((row) => (
              <PublicationCard key={row.id} publication={row} branches={branches} onChanged={state.reload} />
            ))}
          </ul>
        )}
      </AsyncPanel>
    </div>
  );
}

function PublicationCard({
  publication,
  branches,
  onChanged,
}: {
  publication: SchedulePublication;
  branches: Branch[];
  onChanged: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const canManage = usePermission("hr.schedule.manage");
  const confirm = useConfirm();
  const action = useAction();
  const [open, setOpen] = useState(false);

  const acknowledged = new Map(publication.acknowledgements.map((ack) => [ack.employeeId, ack]));
  const share = publication.employeeIds.length
    ? (acknowledged.size / publication.employeeIds.length) * 100
    : 0;
  const branch = branches.find((row) => row.id === publication.branchId);

  const pending = useMemo(
    () => publication.employeeIds.filter((id) => !acknowledged.has(id)),
    [publication, acknowledged],
  );

  async function recordFor(employeeId: Id) {
    const name = tx(publication.employeeNames[employeeId]) || employeeId;
    const ok = await confirm({
      title: t("wf.pub.recordTitle"),
      body: t("wf.pub.recordBody").replace("{name}", name),
      confirmLabel: t("wf.pub.record"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      () =>
        services.workforceHr.publications.acknowledge(
          publication.id,
          employeeId,
          "manager",
          session?.user.name.en ?? null,
        ),
      { onSuccess: onChanged },
    );
  }

  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg text-sm font-semibold">
            {t("wf.pub.week").replace("{week}", publication.weekStart)} · {branch ? tx(branch.name) : publication.branchId}
          </p>
          <p className="text-fg-subtle mt-0.5 text-xs">
            {t("wf.pub.publishedBy")
              .replace("{when}", formatDateTime(publication.publishedAt, fmt))
              .replace("{who}", publication.publishedBy || "—")}
            {" · "}
            {t("wf.pub.shifts").replace("{n}", String(publication.shiftIds.length))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="warn">{t("wf.pub.pushAwaiting")}</Badge>
          <Badge tone={pending.length === 0 ? "good" : "neutral"}>
            {t("wf.pub.ackCount")
              .replace("{n}", String(acknowledged.size))
              .replace("{total}", String(publication.employeeIds.length))}
          </Badge>
        </div>
      </div>
      <Meter className="mt-2" value={share} tone={pending.length === 0 ? "good" : "accent"} />
      <button type="button" className="text-accent mt-2 text-xs underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
        {open ? t("wf.pub.hide") : t("wf.pub.show")}
      </button>
      {open ? (
        <ul className="divide-line mt-2 divide-y text-xs">
          {action.error ? <li className="text-bad py-1">{action.error}</li> : null}
          {publication.employeeIds.map((employeeId) => {
            const ack = acknowledged.get(employeeId);
            return (
              <li key={employeeId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className={cx("text-fg", !ack && "font-medium")}>
                  {tx(publication.employeeNames[employeeId]) || employeeId}
                </span>
                {ack ? (
                  <span className="text-fg-muted flex items-center gap-1.5">
                    <Check size={12} className="text-good" aria-hidden />
                    {formatDateTime(ack.at, fmt)} · {t(`wf.pub.via.${ack.via}` as never)}
                    {ack.recordedBy ? ` · ${ack.recordedBy}` : ""}
                  </span>
                ) : canManage ? (
                  <Button size="sm" variant="ghost" loading={action.pending} onClick={() => void recordFor(employeeId)}>
                    {t("wf.pub.record")}
                  </Button>
                ) : (
                  <Badge tone="warn">{t("wf.pub.notYet")}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
