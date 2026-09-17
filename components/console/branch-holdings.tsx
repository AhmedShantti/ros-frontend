"use client";

/**
 * What a branch holds, and which country pack it trades under —
 * FR-BRN-002, FR-BRN-003.
 *
 * FR-BRN-002 lists what is the branch's own: inventory, cash drawers, staff
 * roster, operating hours, timezone, currency, tax configuration and country
 * pack. `BranchHoldingsPanel` reads each from its real service, scoped to
 * this branch, and says so per tile when one cannot be read rather than
 * showing a zero.
 *
 * FR-BRN-003 lets branches of one tenant trade under different country
 * packs. `BranchCountryPackPanel` changes a branch's country (and with it
 * currency and pack) and, before saving, spells out what changes: currency,
 * tax engine, pricing mode, classes, working week, fiscal provider — and
 * what does not: past sales stay interpreted under the pack they were rung
 * up under (FR-LOC-021).
 */

import { useMemo, useState } from "react";

import type { Branch, CountryCode, Currency } from "@/lib/console/types";
import { diffVersions, versionInForce, type CountryPackVersion } from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, Field, Select, Skeleton } from "@/components/console/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Settle a read into a value or a failure, so one missing service does not blank the panel. */
async function attempt<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work() };
  } catch {
    return { ok: false };
  }
}

function localTime(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", weekday: "short" }).format(new Date());
  } catch {
    return null;
  }
}

function Tile({ label, value, detail, failed }: { label: string; value: string; detail?: string; failed?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="border-line rounded-lg border px-3 py-2.5">
      <p className="text-fg-muted text-xs">{label}</p>
      <p className={failed ? "text-fg-subtle text-sm" : "text-fg font-mono text-base font-semibold tabular-nums"}>
        {failed ? t("brn.hold.unavailable") : value}
      </p>
      {detail && !failed ? <p className="text-fg-subtle mt-0.5 text-[11px] leading-tight">{detail}</p> : null}
    </div>
  );
}

/** FR-BRN-002 — the branch's own inventory, drawers, roster, hours, clock, currency, tax and pack. */
export function BranchHoldingsPanel({ branch }: { branch: Branch }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branchScope = { ...scope, branchId: branch.id };

  const data = useAsync(async () => {
    const [warehouses, drawers, sessions, shifts, employees, hours, packs] = await Promise.all([
      attempt(() => services.organisation.warehouses.list({ limit: 500 })),
      attempt(() => services.treasury.listDrawers(branch.id)),
      attempt(() => services.finance.cashSessions.list({ scope: branchScope, limit: 200 })),
      attempt(() => services.workforce.shifts.list({ scope: branchScope, limit: 500 })),
      attempt(() => services.workforce.employees.list({ scope: branchScope, limit: 500 })),
      attempt(() => services.organisation.operatingHours(branch.id)),
      attempt(() => services.localisation.packVersions.all()),
    ]);
    // The branch's stock location: its attached branch warehouse live, the branch id in the demo.
    const locationId =
      (warehouses.ok ? warehouses.value.rows.find((row) => row.attachedBranchId === branch.id && row.warehouseType === "branch")?.id : undefined) ??
      branch.id;
    const levels = await attempt(() => services.inventory.levels.list({ scope: branchScope, filters: { locationId }, limit: 1000 }));
    return { drawers, sessions, shifts, employees, hours, packs, levels };
  }, [branch.id]);

  const clock = localTime(branch.timezone);

  if (data.loading && !data.data) return <Skeleton className="h-40" />;
  const ready = data.data;
  if (!ready) return data.error ? <Callout tone="bad">{data.error.message}</Callout> : null;

  const levels = ready.levels.ok ? ready.levels.value.rows : [];
  const stockValue = levels.reduce((sum, row) => sum + (row.value.currency === branch.currency ? row.value.amount : 0), 0);
  const belowReorder = levels.filter((row) => Number(row.onHand.value) <= row.reorderPoint).length;

  const drawers = ready.drawers.ok ? ready.drawers.value : [];
  const openSessions = ready.sessions.ok ? ready.sessions.value.rows.filter((row) => row.status === "open" || row.status === "closing") : [];

  const weekStart = today();
  const weekEnd = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  const shifts = ready.shifts.ok ? ready.shifts.value.rows.filter((row) => row.date >= weekStart && row.date <= weekEnd) : [];
  const rostered = new Set(shifts.map((row) => row.employeeId));

  const hours = ready.hours.ok ? ready.hours.value : [];
  const openDays = new Set(hours.map((row) => row.dayOfWeek)).size;

  const pack = ready.packs.ok ? versionInForce(ready.packs.value, branch.countryCode, today()) : null;

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("brn.hold.title")}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t("brn.hold.inventory")}
          value={formatMoney({ amount: stockValue, currency: branch.currency }, fmt, true)}
          detail={t("brn.hold.inventoryDetail").replace("{items}", formatNumber(levels.length, fmt)).replace("{low}", formatNumber(belowReorder, fmt))}
          failed={!ready.levels.ok}
        />
        <Tile
          label={t("brn.hold.drawers")}
          value={formatNumber(drawers.filter((row) => row.isActive).length, fmt)}
          detail={t("brn.hold.drawersDetail").replace("{open}", formatNumber(openSessions.length, fmt))}
          failed={!ready.drawers.ok}
        />
        <Tile
          label={t("brn.hold.roster")}
          value={formatNumber(shifts.length, fmt)}
          detail={t("brn.hold.rosterDetail")
            .replace("{people}", formatNumber(rostered.size, fmt))
            .replace("{staff}", ready.employees.ok ? formatNumber(ready.employees.value.total, fmt) : "—")}
          failed={!ready.shifts.ok}
        />
        <Tile
          label={t("org.operatingHours")}
          value={t("brn.hold.daysOpen").replace("{n}", formatNumber(openDays, fmt))}
          detail={t("brn.hold.cutover").replace("{time}", branch.businessDayBoundary)}
          failed={!ready.hours.ok}
        />
        <Tile label={t("org.timezone")} value={branch.timezone} detail={clock ? t("brn.hold.localNow").replace("{time}", clock) : undefined} />
        <Tile label={t("org.currency")} value={branch.currency} />
        <Tile
          label={t("brn.hold.tax")}
          value={pack ? (pack.pricingMode === "tax_inclusive" ? t("fin.taxInclusive") : t("fin.taxExclusive")) : "—"}
          detail={
            pack
              ? pack.taxClasses.map((row) => `${row.code} ${row.rate === null ? "—" : formatPercent(row.rate, fmt, 0)}`).join(" · ")
              : t("brn.cons.noPack")
          }
          failed={!ready.packs.ok}
        />
        <Tile
          label={t("brn.cons.pack")}
          value={`${branch.countryCode}${pack ? ` v${pack.version}` : ""}`}
          detail={pack ? `${tx(pack.name)} · ${pack.taxEngine}` : t("brn.cons.noPack")}
          failed={!ready.packs.ok}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** FR-BRN-003 — which country pack a branch trades under, and what changing it changes. */
export function BranchCountryPackPanel({
  branch,
  canManage,
  onChanged,
}: {
  branch: Branch;
  canManage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const [target, setTarget] = useState<string>(branch.countryCode);

  const data = useAsync(async () => {
    const [packs, sessions] = await Promise.all([
      services.localisation.packVersions.all(),
      services.finance.cashSessions.list({ scope: { ...scope, branchId: branch.id }, limit: 200 }).catch(() => null),
    ]);
    return { packs, sessions };
  }, [branch.id]);

  const packs = data.data?.packs ?? [];
  const day = today();
  const current = versionInForce(packs, branch.countryCode, day);
  const countries = useMemo(() => {
    const codes = [...new Set(packs.filter((row) => row.status === "certified").map((row) => row.code))].sort();
    return codes.map((code) => ({ code, pack: versionInForce(packs, code, day) ?? packs.find((row) => row.code === code && row.status === "certified")! }));
  }, [packs, day]);
  const next = countries.find((row) => row.code === target)?.pack ?? null;
  const changes = current && next && next.code !== current.code ? diffVersions(current, next) : [];
  const openSessions = data.data?.sessions ? data.data.sessions.rows.filter((row) => row.status === "open" || row.status === "closing").length : null;
  const currencySupported = next ? (["EGP", "SAR", "AED"] as string[]).includes(next.currency) : true;
  const blocked = target === branch.countryCode || !next || openSessions === null || openSessions > 0 || !currencySupported;

  async function apply(pack: CountryPackVersion) {
    const ok = await confirm({
      title: t("brn.pack.confirmTitle").replace("{branch}", tx(branch.name)).replace("{country}", pack.code),
      body: t("brn.pack.confirmBody").replace("{currency}", pack.currency).replace("{version}", pack.version),
      confirmLabel: t("brn.pack.apply"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(
      () =>
        services.organisation.branches.update(branch.id, {
          countryCode: pack.code as CountryCode,
          currency: pack.currency as Currency,
        }),
      { onSuccess: () => onChanged(t("brn.pack.changed")) },
    );
  }

  return (
    <section>
      <h3 className="text-fg mb-2 text-sm font-semibold">{t("brn.pack.title")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <p className="text-fg-muted mb-2 text-xs">
        {current
          ? t("brn.pack.current").replace("{name}", tx(current.name)).replace("{version}", current.version).replace("{date}", current.effectiveFrom)
          : t("brn.cons.noPack")}
      </p>
      {canManage ? (
        <div className="space-y-3">
          <Field label={t("org.country")} hint={t("brn.pack.hint")}>
            <Select value={target} onChange={(event) => setTarget(event.target.value)} disabled={data.loading || action.pending}>
              {!countries.some((row) => row.code === branch.countryCode) ? (
                <option value={branch.countryCode}>{branch.countryCode}</option>
              ) : null}
              {countries.map((row) => (
                <option key={row.code} value={row.code}>
                  {tx(row.pack.name)} ({row.code} · {row.pack.currency} · v{row.pack.version})
                </option>
              ))}
            </Select>
          </Field>

          {target !== branch.countryCode && next ? (
            <div className="space-y-2">
              <p className="text-fg text-xs font-medium">{t("brn.pack.consequences")}</p>
              <ul className="border-line divide-line divide-y rounded-lg border text-xs">
                <li className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-fg-muted">{t("org.currency")}</span>
                  <span className="font-mono" dir="ltr">
                    {branch.currency} → {next.currency}
                  </span>
                </li>
                {changes.map((row) => (
                  <li key={row.field} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-fg-muted font-mono">{row.field}</span>
                    <span className="max-w-[60%] truncate text-end font-mono" dir="ltr" title={`${row.before} → ${row.after}`}>
                      {row.before} → {row.after}
                    </span>
                  </li>
                ))}
              </ul>
              <Callout tone="warn">{t("brn.pack.priceListsWarning")}</Callout>
              <Callout tone="muted">{t("brn.pack.historyKept")}</Callout>
              {!currencySupported ? <Callout tone="bad">{t("brn.pack.currencyUnsupported").replace("{currency}", next.currency)}</Callout> : null}
              {openSessions === null ? (
                <Callout tone="bad">{t("brn.pack.sessionsUnknown")}</Callout>
              ) : openSessions > 0 ? (
                <Callout tone="bad">{t("brn.pack.sessionsOpen").replace("{n}", String(openSessions))}</Callout>
              ) : (
                <Badge tone="good">{t("brn.pack.noOpenSessions")}</Badge>
              )}
              <div className="flex justify-end">
                <Button variant="primary" disabled={blocked} loading={action.pending} onClick={() => next && apply(next)}>
                  {t("brn.pack.apply")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
