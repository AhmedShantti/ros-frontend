"use client";

/**
 * Country pack version history — FR-LOC-021.
 *
 * Every certified version is kept, with the date it took effect, so a sale is
 * always re-read under the pack in force on its business day. The drawer
 * re-runs validation on read — a certified version is history, but history
 * that no longer validates is worth saying out loud — and shows what changed
 * between consecutive versions of the same country.
 */

import { useMemo, useState } from "react";
import { CopyPlus, Pencil, Trash2, Ban } from "lucide-react";

import type { CountryPack, IsoDate } from "@/lib/console/types";
import {
  STRATEGY_BY_ID,
  diffVersions,
  lifecycle,
  validatePack,
  type CountryPackVersion,
  type LifecycleState,
} from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, Select, cx } from "@/components/console/ui";
import { OrderTypeRateMatrix, RoundingConsistency } from "@/components/console/finance-tax";

const DISPLAY_CURRENCIES = new Set(["EGP", "SAR", "AED"]);

/**
 * The finance panels read the platform `CountryPack` shape. An authored
 * version maps onto it only when its currency is one the console can format;
 * otherwise those panels are left out rather than fed a guess.
 */
function asCountryPack(version: CountryPackVersion, all: CountryPackVersion[], today: IsoDate): CountryPack | null {
  if (!DISPLAY_CURRENCIES.has(version.currency)) return null;
  const state = lifecycle(version, all, today);
  return {
    code: version.code as CountryPack["code"],
    name: version.name,
    version: version.version,
    effectiveFrom: version.effectiveFrom,
    status: state === "void" ? "superseded" : state,
    signed: version.status === "certified",
    currency: version.currency as CountryPack["currency"],
    currencyExponent: version.currencyExponent,
    taxEngine: version.taxEngine,
    pricingMode: version.pricingMode,
    roundingMode: version.roundingMode,
    computationLevel: version.computationLevel,
    taxClasses: version.taxClasses.map((row) => ({ code: row.code as CountryPack["taxClasses"][number]["code"], rate: row.rate, label: row.label })),
    fiscalProvider: version.fiscalProvider,
    fiscalMode: version.fiscalMode,
    weekStart: version.weekStart,
    weekend: version.weekend,
    standardWeeklyHours: version.standardWeeklyHours,
    overtimeMultiplier: version.overtimeMultiplier,
    dataRetentionYears: version.dataRetentionYears,
    branchCount: 0,
    conformancePassed: Boolean(version.conformance?.passed),
  };
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "muted";

export const LIFECYCLE_TONE: Record<LifecycleState, Tone> = {
  draft: "neutral",
  scheduled: "accent",
  active: "good",
  superseded: "muted",
  void: "bad",
};

export function LifecycleBadge({ state }: { state: LifecycleState }) {
  const { t } = useI18n();
  return (
    <Badge tone={LIFECYCLE_TONE[state]} dot>
      {t(`cpv.state.${state}` as ConsoleKey)}
    </Badge>
  );
}

export function strategyLabel(id: string, tx: (value: { en: string; ar: string }) => string): string {
  const strategy = STRATEGY_BY_ID.get(id);
  return strategy ? tx(strategy.label) : id;
}

export function PackVersionsTab({
  versions,
  today,
  onChanged,
  onEdit,
}: {
  versions: CountryPackVersion[];
  today: IsoDate;
  onChanged: (message: string) => void;
  onEdit: (id: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const codes = useMemo(() => [...new Set(versions.map((row) => row.code))].sort(), [versions]);

  const rows = useMemo(
    () =>
      versions
        .map((row) => ({ row, state: lifecycle(row, versions, today) }))
        .filter((entry) => (!country || entry.row.code === country) && (!state || entry.state === state))
        .sort((a, b) =>
          a.row.code !== b.row.code ? a.row.code.localeCompare(b.row.code) : b.row.effectiveFrom.localeCompare(a.row.effectiveFrom),
        ),
    [versions, today, country, state],
  );

  type Row = (typeof rows)[number];

  const columns: Column<Row>[] = [
    {
      key: "country",
      header: t("org.country"),
      render: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{tx(row.name) || row.code}</span>
          <span className="text-fg-subtle font-mono text-xs" dir="ltr">
            {row.code} · {row.currency}
          </span>
        </span>
      ),
    },
    {
      key: "version",
      header: t("cp.version"),
      render: ({ row }) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.version}
        </span>
      ),
    },
    { key: "state", header: t("common.status"), render: (entry) => <LifecycleBadge state={entry.state} /> },
    { key: "effectiveFrom", header: t("cp.effectiveFrom"), render: ({ row }) => formatDate(row.effectiveFrom, fmt) },
    { key: "strategy", header: t("cpv.strategy"), secondary: true, render: ({ row }) => strategyLabel(row.taxEngine, tx) },
    {
      key: "digest",
      header: t("cpv.digest"),
      secondary: true,
      render: ({ row }) =>
        row.digest ? (
          <span className="font-mono text-xs" dir="ltr" title={row.digest}>
            {row.digest.slice(0, 12)}…
          </span>
        ) : row.platform && row.status === "certified" ? (
          <Badge tone="muted">{t("cpv.platformSigned")}</Badge>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "certified",
      header: t("cpv.certified"),
      secondary: true,
      render: ({ row }) =>
        row.certifiedAt ? (
          <span className="flex flex-col text-xs">
            <span>{row.certifiedBy ?? "—"}</span>
            <span className="text-fg-subtle">{formatDateTime(row.certifiedAt, fmt)}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  const selected = versions.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:w-2/3">
        <Field label={t("org.country")}>
          <Select value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.status")}>
          <Select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {(["draft", "scheduled", "active", "superseded", "void"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`cpv.state.${value}` as ConsoleKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={({ row }) => row.id}
        caption={t("cpv.versionsTab")}
        onRowClick={({ row }) => setSelectedId(row.id)}
        activeRowKey={selectedId}
        emptyTitle={t("cpv.noVersions")}
        dense
      />

      {selected ? (
        <VersionDrawer
          version={selected}
          versions={versions}
          today={today}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          onEdit={(id) => {
            setSelectedId(null);
            onEdit(id);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function VersionDrawer({
  version,
  versions,
  today,
  onClose,
  onChanged,
  onEdit,
}: {
  version: CountryPackVersion;
  versions: CountryPackVersion[];
  today: IsoDate;
  onClose: () => void;
  onChanged: (message: string) => void;
  onEdit: (id: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const confirm = useConfirm();
  const state = lifecycle(version, versions, today);
  const problems = validatePack(version, versions);
  const strategy = STRATEGY_BY_ID.get(version.taxEngine);
  const by = session ? tx(session.user.name) : null;
  const financePack = useMemo(() => asCountryPack(version, versions, today), [version, versions, today]);

  // History for this country, oldest first, each diffed against its predecessor.
  const history = useMemo(() => {
    const ordered = versions
      .filter((row) => row.code === version.code && row.status !== "draft")
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.certifiedAt ?? "").localeCompare(b.certifiedAt ?? ""));
    return ordered.map((row, index) => ({ row, diff: index > 0 ? diffVersions(ordered[index - 1]!, row) : [] })).reverse();
  }, [versions, version.code]);

  async function branch() {
    await action.run(() => services.localisation.packVersions.branchFrom(version.id, by), {
      onSuccess: (created) => {
        onChanged(t("cpv.branched").replace("{version}", created.version));
        onEdit(created.id);
      },
    });
  }

  async function voidIt() {
    const ok = await confirm({
      title: t("cpv.voidTitle").replace("{version}", `${version.code} ${version.version}`),
      body: t("cpv.voidBody"),
      confirmLabel: t("cpv.void"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.localisation.packVersions.voidVersion(version.id), {
      onSuccess: () => onChanged(t("cpv.voided")),
    });
  }

  async function remove() {
    const ok = await confirm({
      title: t("common.confirmDelete").replace("{name}", `${version.code} ${version.version}`),
      body: t("cpv.deleteDraftBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.localisation.packVersions.remove(version.id), {
      onSuccess: () => {
        onChanged(t("cpv.deleted"));
        onClose();
      },
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${tx(version.name) || version.code} · ${version.version}`}
      subtitle={
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs" dir="ltr">
            {version.code}
          </span>
          <LifecycleBadge state={state} />
        </span>
      }
      footer={
        <>
          {version.status === "draft" ? (
            <>
              <Button variant="danger" icon={<Trash2 size={14} />} onClick={remove} disabled={action.pending}>
                {t("common.delete")}
              </Button>
              <Button variant="primary" icon={<Pencil size={14} />} onClick={() => onEdit(version.id)}>
                {t("common.edit")}
              </Button>
            </>
          ) : (
            <>
              {state === "scheduled" ? (
                <Button variant="danger" icon={<Ban size={14} />} onClick={voidIt} disabled={action.pending}>
                  {t("cpv.void")}
                </Button>
              ) : null}
              {version.status === "certified" ? (
                <Button variant="primary" icon={<CopyPlus size={14} />} onClick={branch} loading={action.pending}>
                  {t("cpv.branchFrom")}
                </Button>
              ) : null}
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {version.status !== "draft" ? <Callout tone="muted">{t("cpv.readOnlyNote")}</Callout> : null}

        <DescList>
          <DescRow label={t("cp.effectiveFrom")}>{formatDate(version.effectiveFrom, fmt)}</DescRow>
          <DescRow label={t("cpv.strategy")}>{strategy ? tx(strategy.label) : version.taxEngine}</DescRow>
          <DescRow label={t("cpv.digest")} mono>
            <span dir="ltr" className="break-all text-xs">
              {version.digest ?? (version.platform && version.status === "certified" ? t("cpv.platformSigned") : "—")}
            </span>
          </DescRow>
          <DescRow label={t("cpv.certified")}>
            {version.certifiedAt ? `${version.certifiedBy ?? "—"} · ${formatDateTime(version.certifiedAt, fmt)}` : "—"}
          </DescRow>
          <DescRow label={t("cpv.hijri")}>{version.hijriCalendar ? t("common.yes") : t("common.no")}</DescRow>
          <DescRow label={t("cpv.changeNote")}>{version.changeNote || "—"}</DescRow>
        </DescList>

        <ProblemList problems={problems} certified={version.status === "certified"} />

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fin.taxTitle")}</h3>
          <DescList>
            <DescRow label={t("cp.pricingMode")}>
              {version.pricingMode === "tax_inclusive" ? t("fin.taxInclusive") : t("fin.taxExclusive")}
            </DescRow>
            <DescRow label={t("cp.computationLevel")}>
              {version.computationLevel === "line" ? t("fin.perLine") : t("fin.perOrder")}
            </DescRow>
            <DescRow label={t("cp.rounding")} mono>
              <span dir="ltr">{version.roundingMode}</span>
            </DescRow>
            <DescRow label={t("org.currency")} mono>
              <span dir="ltr">
                {version.currency} ({version.currencyExponent})
              </span>
            </DescRow>
            {Object.entries(version.taxParams).map(([key, value]) => (
              <DescRow key={key} label={key} mono>
                {formatNumber(value, fmt, 2)}
              </DescRow>
            ))}
            <DescRow label={t("cp.fiscal")}>
              {version.fiscalProvider ? (
                <span dir="ltr">
                  {version.fiscalProvider}
                  {version.fiscalMode ? ` · ${version.fiscalMode}` : ""}
                </span>
              ) : (
                t("common.none")
              )}
            </DescRow>
          </DescList>
          <ul className="divide-line mt-2 divide-y">
            {version.taxClasses.map((taxClass) => (
              <li key={taxClass.code} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{taxClass.code}</Badge>
                  <span className="text-fg-subtle text-xs">{tx(taxClass.label)}</span>
                </span>
                <span className="font-mono tabular-nums">
                  {taxClass.rate === null ? t("cpv.exempt") : formatPercent(taxClass.rate, fmt, taxClass.rate % 1 === 0 ? 0 : 2)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {financePack ? (
          <>
            {/* FR-FIN-033 — order-type-dependent rates, read from this pack's data. */}
            <section>
              <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.orderTypeRates")}</h3>
              <OrderTypeRateMatrix pack={financePack} />
            </section>

            {/* FR-FIN-035 — the pack's rounding mode and point, checked across surfaces. */}
            <section>
              <h3 className="text-fg mb-2 text-sm font-semibold">{t("fnc.roundingConsistency")}</h3>
              <RoundingConsistency pack={financePack} />
            </section>
          </>
        ) : null}

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("nav.workforce")}</h3>
          <DescList>
            <DescRow label={t("cp.weekStart")}>{version.weekStart}</DescRow>
            <DescRow label={t("cp.weekend")}>{version.weekend.join(", ")}</DescRow>
            <DescRow label={t("cp.weeklyHours")} mono>
              {formatNumber(version.standardWeeklyHours, fmt)}
            </DescRow>
            <DescRow label={t("cp.overtimeMultiplier")} mono>
              <span dir="ltr">×{formatNumber(version.overtimeMultiplier, fmt, 2)}</span>
            </DescRow>
            <DescRow label={t("cp.retention")} mono>
              {formatNumber(version.dataRetentionYears, fmt)} {t("cp.years")}
            </DescRow>
          </DescList>
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("cp.conformance")}</h3>
          <ConformanceTable version={version} />
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("cpv.history").replace("{code}", version.code)}</h3>
          {history.length === 0 ? (
            <p className="text-fg-muted text-sm">{t("cpv.noHistory")}</p>
          ) : (
            <ol className="border-line space-y-4 border-s ps-4">
              {history.map(({ row, diff }) => (
                <li key={row.id} className={cx("relative", row.id === version.id && "font-medium")}>
                  <span aria-hidden className="bg-accent absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono" dir="ltr">
                      {row.version}
                    </span>
                    <LifecycleBadge state={lifecycle(row, versions, today)} />
                    <span className="text-fg-subtle text-xs">{formatDate(row.effectiveFrom, fmt)}</span>
                  </div>
                  {row.changeNote ? <p className="text-fg-muted mt-0.5 text-xs">{row.changeNote}</p> : null}
                  {diff.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {diff.map((change) => (
                        <li key={change.field} className="text-fg-muted" dir="ltr">
                          <span className="font-mono">{change.field}</span>: <span className="line-through">{change.before}</span> →{" "}
                          <span className="text-fg">{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

export function ProblemList({
  problems,
  certified,
}: {
  problems: ReturnType<typeof validatePack>;
  certified?: boolean;
}) {
  const { t } = useI18n();
  const errors = problems.filter((row) => row.severity === "error");
  const warnings = problems.filter((row) => row.severity === "warning");
  if (problems.length === 0) return <Callout tone="good">{t("cpv.valid")}</Callout>;
  return (
    <Callout
      tone={errors.length > 0 ? "bad" : "warn"}
      title={t("cpv.problemsTitle").replace("{errors}", String(errors.length)).replace("{warnings}", String(warnings.length))}
    >
      {certified && errors.length > 0 ? <p className="mb-1">{t("cpv.certifiedProblemsNote")}</p> : null}
      <ul className="space-y-0.5">
        {[...errors, ...warnings].map((problem, index) => (
          <li key={`${problem.field}-${index}`}>
            <span className="font-mono" dir="ltr">
              {problem.field}
            </span>{" "}
            — {problem.message}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

export function ConformanceTable({ version }: { version: CountryPackVersion }) {
  const { t, fmt } = useI18n();
  const result = version.conformance;
  if (!result) return <p className="text-fg-muted text-sm">{t("cpv.notRun")}</p>;
  const failed = result.cases.filter((row) => !row.passed).length;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <Badge tone={result.passed ? "good" : "bad"}>{result.passed ? t("cp.conformancePassed") : t("cp.conformanceFailed")}</Badge>{" "}
        <span className="text-fg-subtle text-xs">
          {t("cpv.casesSummary")
            .replace("{n}", String(result.cases.length))
            .replace("{failed}", String(failed))
            .replace("{at}", formatDateTime(result.ranAt, fmt))}
        </span>
      </p>
      <div className="border-line max-h-72 overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-sunken text-fg-muted sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-start">{t("cpv.case")}</th>
              <th className="px-2 py-1.5 text-start">{t("cpv.expected")}</th>
              <th className="px-2 py-1.5 text-start">{t("cpv.actual")}</th>
              <th className="px-2 py-1.5 text-start">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {[...result.cases].sort((a, b) => Number(a.passed) - Number(b.passed)).map((row) => (
              <tr key={row.id}>
                <td className="px-2 py-1.5" dir="ltr">
                  <span className="text-fg-subtle font-mono">{row.id}</span> {row.title}
                </td>
                <td className="px-2 py-1.5 font-mono" dir="ltr">
                  {row.expected}
                </td>
                <td className="px-2 py-1.5 font-mono" dir="ltr">
                  {row.actual}
                </td>
                <td className="px-2 py-1.5">
                  <Badge tone={row.passed ? "good" : "bad"}>{row.passed ? t("cpv.pass") : t("cpv.fail")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
