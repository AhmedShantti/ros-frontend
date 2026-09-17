"use client";

/**
 * Tenant lifecycle screens — FR-PLT-003, FR-PLT-021, FR-PLT-022, FR-PLT-023.
 *
 *   TenantStateBanner   mounted in the console shell. When the organisation
 *                       is suspended, restricted, past due or terminating it
 *                       says so on every screen, and switches the service
 *                       layer to read-only (`assertTenantWritable`).
 *   TenantIdentityCard  the tenant id, shown as fixed — no screen offers to
 *                       move a record to another tenant (FR-PLT-003).
 *   PlanUsageCard       the plan's limits against what exists; rows past a
 *                       limit are named and read-only, never deleted.
 *   DataExportCard      a full export: CSV per entity plus a JSON manifest,
 *                       generated from the services, with a request record.
 *   TerminationCard     initiation (type-to-confirm) → 30-day reversible
 *                       countdown → final confirmation; purge no earlier than
 *                       30 days after initiation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertOctagon, Download, FileArchive, Lock, ShieldOff, Undo2 } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import type { TenantState } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useActor } from "@/lib/console/security-log";
import { formatDate, formatDateTime, formatNumber } from "@/lib/console/format";
import { PLAN_LIMITS, overLimitIds, tenantAccess, type TenantAccess } from "@/lib/console/tenant-plan";
import { setTenantReadOnly } from "@/lib/console/services/tenant-context";
import {
  TERMINATION_WINDOW_DAYS,
  activeTermination,
  readLifecycleNow,
  type ExportJob,
} from "@/lib/console/services/tenant-lifecycle";
import { buildTenantExport, exportEntityCount } from "@/lib/console/tenant-export";
import { useConfirm } from "@/components/console/confirm";
import { ClassificationBadge } from "@/components/console/security-sensitive";
import { ErrorCallout } from "@/components/console/states";
import { Badge, Button, Callout, Card, CardHeader, DescList, DescRow, Field, Meter, Select, Textarea, cx } from "@/components/console/ui";

const LIFECYCLE_EVENT = "ros:tenant-lifecycle";

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIFECYCLE_EVENT));
}

// ---------------------------------------------------------------------------
// Effective state
// ---------------------------------------------------------------------------

export interface EffectiveTenantState extends TenantAccess {
  state: TenantState;
  /** True when the state is a demo preview rather than the tenant's own. */
  previewing: boolean;
  terminating: boolean;
}

/** FR-PLT-021 — the organisation's state, including a termination in progress. */
export function useTenantState(): EffectiveTenantState {
  const { tenant } = useSession();
  const [doc, setDoc] = useState<ReturnType<typeof readLifecycleNow>>(null);

  // Read after mount, never during render: the record lives in browser
  // storage, and reading it on the server pass would not match the client.
  useEffect(() => {
    const read = () => setDoc(readLifecycleNow());
    read();
    window.addEventListener(LIFECYCLE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(LIFECYCLE_EVENT, read);
      window.removeEventListener("storage", read);
    };
    // `tenant.id` so a tenant switch re-reads that tenant's lifecycle record.
  }, [tenant.id]);

  return useMemo(() => {
    const previewState = DATA_MODE === "http" ? null : (doc?.previewState ?? null);
    const terminating = Boolean(doc && activeTermination(doc));
    // A termination still inside its reversible window does not freeze the
    // business: the tenant keeps trading until the purge date. Only the
    // tenant's own state (or a demo preview of one) makes it read-only.
    const state: TenantState = previewState ?? tenant.state;
    return { state, previewing: previewState !== null, terminating, ...tenantAccess(state) };
  }, [doc, tenant.state]);
}

export function TenantStateBanner() {
  const { t } = useI18n();
  const current = useTenantState();

  // The service layer follows the banner: one decision, applied everywhere.
  useEffect(() => {
    setTenantReadOnly(current.readOnly ? current.state : null);
  }, [current.readOnly, current.state]);

  if (!current.readOnly && !current.terminating) return null;

  if (!current.readOnly) {
    return (
      <div role="status" className="border-bad/40 bg-bad-soft text-bad mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs">
        <AlertOctagon size={14} aria-hidden className="shrink-0" />
        <span className="font-semibold">{t("tnt.term.bannerTitle")}</span>
        <span className="text-fg">{t("tnt.term.bannerBody")}</span>
        <Link href="/settings/tenant" className="ms-auto font-medium underline underline-offset-2">
          {t("tnt.manage")}
        </Link>
      </div>
    );
  }

  return (
    <div role="status" className="border-warn/40 bg-warn-soft text-warn mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs">
      <Lock size={14} aria-hidden className="shrink-0" />
      <span className="font-semibold">{t(`tnt.state.${current.state}` as ConsoleKey)}</span>
      <span className="text-fg">{t("tnt.readOnlyBanner")}</span>
      {current.previewing ? <Badge tone="muted">{t("tnt.preview")}</Badge> : null}
      <Link href="/settings/tenant" className="ms-auto font-medium underline underline-offset-2">
        {t("tnt.manage")}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PLT-003 — identity
// ---------------------------------------------------------------------------

export function TenantIdentityCard({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { tenant, can } = useSession();
  const actor = useActor();
  const current = useTenantState();
  const [error, setError] = useState<unknown>(null);

  async function preview(state: TenantState | null) {
    setError(null);
    try {
      await services.tenantLifecycle.setPreviewState(state, actor);
      announce();
      notify(t("secp.saved"));
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <Card>
      <CardHeader title={tx(tenant.name)} hint={t("tnt.identityHint")} spec="FR-PLT-003" />
      <DescList>
        <DescRow label={t("tnt.tenantId")} mono>
          <span className="inline-flex items-center gap-1.5 text-xs" dir="ltr">
            <Lock size={11} aria-label={t("tnt.tenantIdFixed")} /> {tenant.id}
          </span>
        </DescRow>
        <DescRow label={t("tnt.slug")} mono>
          <span dir="ltr">{tenant.slug}</span>
        </DescRow>
        <DescRow label={t("tnt.plan")}>
          <Badge tone="accent">{t(`tnt.plan.${tenant.plan}` as ConsoleKey)}</Badge>
        </DescRow>
        <DescRow label={t("common.status")}>
          <Badge tone={current.readOnly ? "warn" : "good"} dot>
            {t(`tnt.state.${current.state}` as ConsoleKey)}
          </Badge>
        </DescRow>
        <DescRow label={t("tnt.region")}>{tenant.region}</DescRow>
        <DescRow label={t("tnt.created")}>{formatDate(tenant.createdAt, fmt)}</DescRow>
      </DescList>
      <Callout tone="muted" className="mt-3">
        {t("tnt.noTransfer")}
      </Callout>

      {DATA_MODE !== "http" && can("settings.tenant.manage") ? (
        <div className="border-line mt-4 space-y-2 border-t pt-4">
          <Field label={t("tnt.previewLabel")} hint={t("tnt.previewHint")}>
            <Select
              value={current.previewing ? current.state : ""}
              onChange={(event) => void preview((event.target.value || null) as TenantState | null)}
            >
              <option value="">{t("tnt.previewNone")}</option>
              {(["past_due", "restricted", "suspended"] as TenantState[]).map((state) => (
                <option key={state} value={state}>
                  {t(`tnt.state.${state}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorCallout error={error} />
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-PLT-021 — plan usage
// ---------------------------------------------------------------------------

export function PlanUsageCard() {
  const { t, tx, fmt } = useI18n();
  const { tenant } = useSession();
  const limits = PLAN_LIMITS[tenant.plan];
  const usage = useAsync(async () => {
    const [brands, branches, users] = await Promise.all([
      services.organisation.brands.list({ limit: 500 }).catch(() => null),
      services.organisation.branches.list({ limit: 1000 }).catch(() => null),
      services.security.users.list({ limit: 1 }).catch(() => null),
    ]);
    return { brands, branches, users };
  }, [tenant.id]);

  const overBranches = useMemo(
    () =>
      usage.data?.branches
        ? overLimitIds(usage.data.branches.rows, limits.branches, (row) => row.id, (row) => row.openedAt ?? row.id)
        : new Set<string>(),
    [usage.data, limits.branches],
  );
  const overBrands = useMemo(
    () => (usage.data?.brands ? overLimitIds(usage.data.brands.rows, limits.brands, (row) => row.id, (row) => row.id) : new Set<string>()),
    [usage.data, limits.brands],
  );

  const line = (label: string, used: number | null, limit: number) => {
    const finite = Number.isFinite(limit);
    const over = used !== null && finite && used > limit;
    return (
      <div key={label} className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg font-medium">{label}</span>
          <span className={cx("tabular-nums", over ? "text-bad font-semibold" : "text-fg-muted")}>
            {used === null ? "—" : formatNumber(used, fmt)} / {finite ? formatNumber(limit, fmt) : t("tnt.unlimited")}
          </span>
        </div>
        {finite && used !== null ? <Meter value={(Math.min(used, limit) / Math.max(1, limit)) * 100} tone={over ? "bad" : "accent"} /> : null}
      </div>
    );
  };

  const branchNames = (usage.data?.branches?.rows ?? []).filter((row) => overBranches.has(row.id)).map((row) => tx(row.name));
  const brandNames = (usage.data?.brands?.rows ?? []).filter((row) => overBrands.has(row.id)).map((row) => tx(row.name));

  return (
    <Card>
      <CardHeader title={t("tnt.planTitle")} hint={t("tnt.planHint")} spec="FR-PLT-021" />
      <div className="space-y-3">
        {line(t("nav.brands"), usage.data?.brands?.total ?? null, limits.brands)}
        {line(t("nav.branches"), usage.data?.branches?.total ?? null, limits.branches)}
        {line(t("nav.users"), usage.data?.users?.total ?? null, limits.users)}
      </div>
      {brandNames.length + branchNames.length > 0 ? (
        <Callout tone="warn" className="mt-3" title={t("tnt.overLimitTitle")}>
          {t("tnt.overLimitBody").replace("{names}", [...brandNames, ...branchNames].join(", "))}
        </Callout>
      ) : null}
      <Callout tone="muted" className="mt-3">
        {t("tnt.limitsNote")}
      </Callout>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-PLT-022 — data export
// ---------------------------------------------------------------------------

export function DataExportCard({ notify }: { notify: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const { tenant } = useSession();
  const actor = useActor();
  const jobs = useAsync(() => services.tenantLifecycle.read().then((doc) => doc.exports), [tenant.id]);
  const [progress, setProgress] = useState<{ done: number; total: number; entity: string } | null>(null);
  const [downloads, setDownloads] = useState<Record<string, { url: string; filename: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(
    () => () => {
      for (const entry of Object.values(downloads)) URL.revokeObjectURL(entry.url);
    },
    // Revoke on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const run = useCallback(async () => {
    setError(null);
    try {
      const job = await services.tenantLifecycle.startExport(actor);
      jobs.reload();
      const built = await buildTenantExport(tenant, job.id, (done, total, entity) => setProgress({ done, total, entity }));
      const blob = new Blob([built.blob], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      setDownloads((current) => ({ ...current, [job.id]: { url, filename: built.filename } }));
      await services.tenantLifecycle.finishExport(
        job.id,
        { status: built.status, entities: built.entities, sizeBytes: blob.size, filename: built.filename },
        actor,
      );
      notify(t(`tnt.export.${built.status}` as ConsoleKey));
    } catch (caught) {
      setError(caught);
    } finally {
      setProgress(null);
      jobs.reload();
    }
  }, [actor, jobs, notify, t, tenant]);

  return (
    <Card>
      <CardHeader
        title={t("tnt.exportTitle")}
        hint={t("tnt.exportHint").replace("{n}", String(exportEntityCount()))}
        spec="FR-PLT-022"
        action={
          <Button variant="primary" icon={<FileArchive size={13} />} loading={progress !== null} onClick={() => void run()}>
            {t("tnt.exportRequest")}
          </Button>
        }
      />
      {progress ? (
        <div className="mb-3 space-y-1" role="status" aria-live="polite">
          <Meter value={(progress.done / Math.max(1, progress.total)) * 100} tone="accent" />
          <p className="text-fg-muted text-xs">
            {t("tnt.exportProgress")
              .replace("{done}", String(progress.done))
              .replace("{total}", String(progress.total))
              .replace("{entity}", progress.entity)}
          </p>
        </div>
      ) : null}
      <ErrorCallout error={error} />

      {(jobs.data ?? []).length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("tnt.exportNone")}</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {(jobs.data ?? []).map((job: ExportJob) => {
            const download = downloads[job.id];
            const failed = job.entities.filter((row) => row.error);
            return (
              <li key={job.id} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={job.status === "ready" ? "good" : job.status === "partial" ? "warn" : job.status === "failed" ? "bad" : "accent"} dot>
                    {t(`tnt.job.${job.status}` as ConsoleKey)}
                  </Badge>
                  <span className="text-fg tabular-nums">{formatDateTime(job.requestedAt, fmt)}</span>
                  <span className="text-fg-muted">{job.requestedBy}</span>
                  {job.status !== "building" ? (
                    <span className="text-fg-subtle tabular-nums">
                      {t("tnt.jobSummary")
                        .replace("{rows}", formatNumber(job.entities.reduce((sum, row) => sum + row.rows, 0), fmt))
                        .replace("{files}", String(job.entities.length - failed.length))
                        .replace("{kb}", formatNumber(Math.ceil(job.sizeBytes / 1024), fmt))}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">{t("tnt.jobDeadline").replace("{when}", formatDateTime(job.deadlineAt, fmt))}</span>
                  )}
                  <span className="ms-auto flex items-center gap-2">
                    {download ? (
                      <a href={download.url} download={download.filename} className="text-accent inline-flex items-center gap-1 font-medium underline underline-offset-2">
                        <Download size={12} aria-hidden /> {t("tnt.download")}
                      </a>
                    ) : job.status !== "building" ? (
                      <span className="text-fg-subtle">{t("tnt.regenerate")}</span>
                    ) : null}
                    {job.entities.length > 0 ? (
                      <button type="button" className="text-fg-muted underline" aria-expanded={open === job.id} onClick={() => setOpen(open === job.id ? null : job.id)}>
                        {t("tnt.manifest")}
                      </button>
                    ) : null}
                  </span>
                </div>
                {open === job.id ? (
                  <table className="mt-2 w-full">
                    <caption className="sr-only">{t("tnt.manifest")}</caption>
                    <thead className="text-fg-subtle">
                      <tr>
                        <th scope="col" className="py-1 text-start font-medium">{t("tnt.entity")}</th>
                        <th scope="col" className="py-1 text-end font-medium">{t("tnt.rows")}</th>
                        <th scope="col" className="py-1 ps-3 text-start font-medium">{t("aud2.class")}</th>
                        <th scope="col" className="py-1 ps-3 text-start font-medium">SHA-256 / {t("tnt.problem")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {job.entities.map((row) => (
                        <tr key={row.entity}>
                          <td className="py-1 font-mono" dir="ltr">{row.file}</td>
                          <td className="py-1 text-end tabular-nums">{formatNumber(row.rows, fmt)}</td>
                          <td className="py-1 ps-3"><ClassificationBadge cls={row.classification} /></td>
                          <td className={cx("py-1 ps-3 font-mono break-all", row.error ? "text-warn" : "text-fg-subtle")} dir="ltr">
                            {row.error ?? row.sha256?.slice(0, 16)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Callout tone="muted" className="mt-3">
        {t("tnt.exportNote")}
      </Callout>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-PLT-023 — termination
// ---------------------------------------------------------------------------

export function TerminationCard({ notify }: { notify: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const { tenant, roleKey } = useSession();
  const actor = useActor();
  const confirm = useConfirm();
  const doc = useAsync(() => services.tenantLifecycle.read(), [tenant.id]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Termination is the Tenant Owner's decision, and nobody else's.
  const isOwner = roleKey === "owner";
  const active = doc.data ? activeTermination(doc.data) : null;
  const history = (doc.data?.terminations ?? []).filter((row) => row.cancelledAt !== null);

  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      notify(message);
      announce();
      doc.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function initiate() {
    const ok = await confirm({
      title: t("tnt.term.initiateTitle"),
      body: t("tnt.term.initiateBody").replace("{days}", String(TERMINATION_WINDOW_DAYS)),
      confirmLabel: t("tnt.term.initiate"),
      tone: "danger",
      typeToConfirm: tenant.slug,
    });
    if (!ok) return;
    await act(
      () => services.tenantLifecycle.initiateTermination({ reason, confirmation: tenant.slug }, tenant.slug, actor),
      t("tnt.term.initiated"),
    );
    setReason("");
  }

  async function cancel() {
    const ok = await confirm({
      title: t("tnt.term.cancelTitle"),
      body: t("tnt.term.cancelBody"),
      confirmLabel: t("tnt.term.cancel"),
      tone: "warn",
    });
    if (ok) await act(() => services.tenantLifecycle.cancelTermination(actor), t("tnt.term.cancelled"));
  }

  async function finalConfirm() {
    const ok = await confirm({
      title: t("tnt.term.confirmTitle"),
      body: t("tnt.term.confirmBody").replace("{date}", active ? formatDate(active.purgeNotBefore, fmt) : "—"),
      confirmLabel: t("tnt.term.confirm"),
      tone: "danger",
      typeToConfirm: tenant.slug,
    });
    if (ok) await act(() => services.tenantLifecycle.confirmTermination(tenant.slug, tenant.slug, actor), t("tnt.term.confirmed"));
  }

  const daysLeft = active ? Math.max(0, Math.ceil((Date.parse(active.purgeNotBefore) - Date.now()) / 86_400_000)) : 0;

  return (
    <Card className="border-bad/40">
      <CardHeader title={t("tnt.term.title")} hint={t("tnt.term.hint").replace("{days}", String(TERMINATION_WINDOW_DAYS))} spec="FR-PLT-023" />
      {DATA_MODE === "http" ? <Callout tone="warn" className="mb-3">{t("tnt.term.liveNote")}</Callout> : null}
      <ErrorCallout error={error} className="mb-3" />

      {!isOwner ? (
        <Callout tone="muted" icon={<ShieldOff size={14} />}>
          {t("tnt.term.ownerOnly")}
        </Callout>
      ) : active ? (
        <div className="space-y-3">
          <div className="border-bad/40 bg-bad-soft rounded-lg border p-3">
            <p className="text-bad flex items-center gap-2 text-sm font-semibold">
              <AlertOctagon size={15} aria-hidden />
              {active.confirmedAt ? t("tnt.term.confirmedState") : t("tnt.term.pendingState")}
            </p>
            <p className="text-fg mt-1 text-2xl font-semibold tabular-nums">{t("tnt.term.daysLeft").replace("{n}", String(daysLeft))}</p>
            <DescList>
              <DescRow label={t("tnt.term.initiatedAt")}>{formatDateTime(active.initiatedAt, fmt)} · {active.initiatedBy}</DescRow>
              <DescRow label={t("tnt.term.purgeNotBefore")}>{formatDateTime(active.purgeNotBefore, fmt)}</DescRow>
              <DescRow label={t("tnt.term.reason")}>{active.reason}</DescRow>
              {active.confirmedAt ? (
                <DescRow label={t("tnt.term.confirmedAt")}>{formatDateTime(active.confirmedAt, fmt)} · {active.confirmedBy}</DescRow>
              ) : null}
            </DescList>
          </div>
          <p className="text-fg-muted text-xs">{t("tnt.term.exportReminder")}</p>
          <div className="flex flex-wrap gap-2">
            {Date.now() < Date.parse(active.purgeNotBefore) || !active.confirmedAt ? (
              <Button icon={<Undo2 size={13} />} loading={busy} onClick={() => void cancel()}>
                {t("tnt.term.cancel")}
              </Button>
            ) : null}
            {!active.confirmedAt ? (
              <Button variant="danger" loading={busy} onClick={() => void finalConfirm()}>
                {t("tnt.term.confirm")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={t("tnt.term.reason")} hint={t("tnt.term.reasonHint")} required>
            <Textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 10} onClick={() => void initiate()}>
            {t("tnt.term.initiate")}
          </Button>
        </div>
      )}

      {history.length > 0 ? (
        <section className="border-line mt-4 border-t pt-3">
          <h3 className="text-fg-subtle mb-1 text-xs font-semibold">{t("tnt.term.history")}</h3>
          <ul className="space-y-1 text-xs">
            {history.map((row) => (
              <li key={row.id} className="text-fg-muted">
                {t("tnt.term.historyRow")
                  .replace("{start}", formatDate(row.initiatedAt, fmt))
                  .replace("{by}", row.initiatedBy)
                  .replace("{end}", row.cancelledAt ? formatDate(row.cancelledAt, fmt) : "—")
                  .replace("{canceller}", row.cancelledBy ?? "—")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
