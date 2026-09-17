"use client";

/**
 * Waste analysis and anomaly review — SRS FR-INV-060, FR-INV-061.
 *
 * FR-INV-060: waste sliced by item, reason, employee, station, shift,
 * day-part and branch, each against the period before it. The slices are
 * computed in the browser from the waste records (`groupWaste`), so every
 * dimension reads the same rows. Shift and day-part are bands of the time a
 * record was made, and the screen says so.
 *
 * FR-INV-061: statistical baselines over the same records
 * (`detectWasteAnomalies`) — an employee writing off a high-value item far
 * more than their peers, concentrated in one shift band, or an item's waste
 * spiking against its own trailing weeks. A flag is a prompt to look, never a
 * finding: only `governance.view_anomalies` sees them (as for every other
 * anomaly, FR-CST-041), each shows its working, and closing one needs a
 * written conclusion kept in the append-only review history
 * (`services.anomalyReviews`, local).
 */

import { useMemo, useState } from "react";
import { Settings2, ShieldQuestion } from "lucide-react";

import type { Id, WasteRecord } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { AnomalyReview, ReviewStatus } from "@/lib/console/services/anomaly-reviews";
import type { DetectionSettings } from "@/lib/console/services/inventory-controls";
import {
  dailyTrend,
  detectWasteAnomalies,
  groupWaste,
  previousPeriod,
  type WasteAnomaly,
  type WasteDimension,
  type WasteGroupRow,
} from "@/lib/console/inventory-waste";
import { useAsync, useStations, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, DeltaCell, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile, TrendChart } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, Input, SegmentedControl, Textarea, Toast, Toggle } from "@/components/console/ui";

type Days = "7" | "30" | "90";
const DIMENSIONS: WasteDimension[] = ["item", "reason", "employee", "station", "shift", "day_part", "branch"];

export default function WasteAnalysisPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <AnalysisScreen />
    </Gate>
  );
}

function AnalysisScreen() {
  const { t } = useI18n();
  const { scope } = useSession();
  const [message, setMessage] = useTransientMessage();
  const data = useAsync(async () => {
    const [page, settings] = await Promise.all([
      services.inventory.waste.list({ scope, limit: 5000, sort: "-recordedAt" }),
      services.inventoryControls.detection.settings(),
    ]);
    return { records: page.rows, settings };
  }, [scope.tenantId, scope.brandId, scope.branchId]);

  return (
    <>
      <PageHeader
        title={t("invx.wa.title")}
        subtitle={t("invx.wa.subtitle")}
        spec="FR-INV-060"
        crumbs={[{ label: t("inv.wasteTitle"), href: "/inventory/waste" }, { label: t("invx.wa.title") }]}
      />
      <PageBody>
        <AsyncPanel state={data}>
          {(loaded) => (
            <AnalysisBody
              records={loaded.records}
              settings={loaded.settings}
              onChanged={(note) => {
                setMessage(note);
                data.reload();
              }}
              onExported={setMessage}
            />
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function AnalysisBody({
  records,
  settings,
  onChanged,
  onExported,
}: {
  records: WasteRecord[];
  settings: DetectionSettings;
  onChanged: (message: string) => void;
  onExported: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { scope, tenant } = useSession();
  const stations = useStations(scope);
  const canSeeAnomalies = usePermission("governance.view_anomalies");
  const [days, setDays] = useState<Days>("30");
  const [dimension, setDimension] = useState<WasteDimension>("item");
  const [trueOnly, setTrueOnly] = useState(true);

  // The period ends at the latest record, so a quiet week does not read as zero waste.
  const latest = records.reduce((max, row) => (row.recordedAt > max ? row.recordedAt : max), "");
  const end = latest ? new Date(new Date(latest).getTime() + 1) : new Date();
  const period = useMemo(() => ({ from: new Date(end.getTime() - Number(days) * 86_400_000), to: end }), [end.getTime(), days]); // eslint-disable-line react-hooks/exhaustive-deps
  const prior = previousPeriod(period.from, period.to);

  const rows = useMemo(() => groupWaste(records, dimension, period, { trueWasteOnly: trueOnly }), [records, dimension, period, trueOnly]);
  const trend = useMemo(() => dailyTrend(records, period, { trueWasteOnly: trueOnly }), [records, period, trueOnly]);
  const currency = records[0]?.value.currency ?? tenant.baseCurrency;
  const total = rows.reduce((sum, row) => sum + row.valueMinor, 0);
  const previousTotal = rows.reduce((sum, row) => sum + row.previousValueMinor, 0);
  const count = rows.reduce((sum, row) => sum + row.records, 0);
  const headersOnly = records.length > 0 && records.every((row) => !row.itemId);

  const stationName = (id: string) => tx(stations.find((row) => row.id === id)?.name) || null;
  const labelFor = (row: WasteGroupRow): string => {
    if (row.key === "—") return t("invx.wa.notRecorded");
    if (dimension === "shift") return t(`invx.wa.shift.${row.key}` as ConsoleKey);
    if (dimension === "day_part") return t(`invx.wa.dayPart.${row.key}` as ConsoleKey);
    if (dimension === "station") return stationName(row.key) ?? row.key;
    return tx(row.label) || row.key;
  };

  const columns: Column<WasteGroupRow>[] = [
    { key: "label", header: t(`invx.wa.dim.${dimension}` as ConsoleKey), render: (row) => <CellStack primary={labelFor(row)} /> },
    { key: "records", header: t("invx.wa.records"), numeric: true, secondary: true, render: (row) => formatNumber(row.records, fmt) },
    { key: "value", header: t("common.value"), numeric: true, render: (row) => formatMoney(money(row.valueMinor, currency), fmt) },
    { key: "share", header: "%", numeric: true, secondary: true, render: (row) => formatPercent(row.share, fmt, 1) },
    { key: "previous", header: t("invx.wa.previous"), numeric: true, secondary: true, render: (row) => formatMoney(money(row.previousValueMinor, currency), fmt) },
    {
      key: "change",
      header: t("invx.wa.change"),
      numeric: true,
      render: (row) =>
        row.changePercent === null ? (
          <span className="text-fg-subtle">{row.valueMinor > 0 ? t("invx.wa.new") : "—"}</span>
        ) : (
          // More waste is worse, so an increase reads as bad.
          <DeltaCell value={-row.changePercent}>
            {row.changePercent > 0 ? "+" : ""}
            {formatPercent(row.changePercent, fmt, 0)}
          </DeltaCell>
        ),
    },
  ];

  return (
    <>
      {headersOnly ? <Callout tone="warn">{t("invx.wa.headersOnly")}</Callout> : null}

      <Toolbar
        actions={
          <ExportButton
            filename={`waste-by-${dimension}`}
            title={`${t("invx.wa.title")} — ${t(`invx.wa.dim.${dimension}` as ConsoleKey)}`}
            filterSummary={`${formatDate(period.from.toISOString(), fmt)} – ${formatDate(period.to.toISOString(), fmt)}`}
            rows={rows}
            onExported={onExported}
            columns={[
              { key: "label", header: t(`invx.wa.dim.${dimension}` as ConsoleKey), value: (row) => labelFor(row) },
              { key: "records", header: t("invx.wa.records"), value: (row) => row.records },
              { key: "value", header: t("common.value"), value: (row) => (row.valueMinor / 100).toFixed(2) },
              { key: "previous", header: t("invx.wa.previous"), value: (row) => (row.previousValueMinor / 100).toFixed(2) },
              { key: "change", header: t("invx.wa.change"), value: (row) => (row.changePercent === null ? "" : row.changePercent.toFixed(1)) },
            ]}
          />
        }
      >
        <SegmentedControl<Days>
          label={t("invx.wa.period")}
          value={days}
          onChange={setDays}
          options={[
            { value: "7", label: t("invx.wa.days").replace("{n}", "7") },
            { value: "30", label: t("invx.wa.days").replace("{n}", "30") },
            { value: "90", label: t("invx.wa.days").replace("{n}", "90") },
          ]}
        />
        <Toggle checked={trueOnly} onChange={setTrueOnly} label={t("invx.wa.trueOnly")} />
      </Toolbar>

      <SegmentedControl<WasteDimension>
        label={t("common.grouping")}
        value={dimension}
        onChange={setDimension}
        options={DIMENSIONS.map((value) => ({ value, label: t(`invx.wa.dim.${value}` as ConsoleKey) }))}
      />

      <TileGrid columns={4}>
        <MetricTile label={t("invx.wa.thisPeriod")} value={formatMoney(money(total, currency), fmt, true)} spec="FR-INV-060" />
        <MetricTile
          label={t("invx.wa.previousPeriod")}
          value={formatMoney(money(previousTotal, currency), fmt, true)}
          hint={`${formatDate(prior.from.toISOString(), fmt)} – ${formatDate(prior.to.toISOString(), fmt)}`}
        />
        <MetricTile
          label={t("invx.wa.change")}
          value={previousTotal > 0 ? `${total >= previousTotal ? "+" : ""}${formatPercent(((total - previousTotal) / previousTotal) * 100, fmt, 0)}` : "—"}
        />
        <MetricTile label={t("invx.wa.records")} value={formatNumber(count, fmt)} />
      </TileGrid>

      {dimension === "shift" || dimension === "day_part" ? <Callout tone="muted">{t("invx.wa.bandsNote")}</Callout> : null}

      <Section title={t("invx.wa.trendTitle")} padded={false}>
        <div className="px-5 pb-5">
          <TrendChart
            data={trend.map((row) => ({ label: row.date.slice(5), value: row.valueMinor, comparison: row.previousMinor }))}
            valueLabel={t("invx.wa.thisPeriod")}
            comparisonLabel={t("invx.wa.previousPeriod")}
            format={(value) => formatMoney(money(value, currency), fmt, true)}
            height={200}
          />
        </div>
      </Section>

      <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} caption={t("invx.wa.title")} emptyTitle={t("invx.wa.empty")} dense />

      {canSeeAnomalies ? (
        <AnomalySection records={records} settings={settings} stationName={stationName} onChanged={onChanged} />
      ) : (
        <Callout tone="muted" icon={<ShieldQuestion size={14} />}>
          {t("invx.wa.anomaliesRestricted")}
        </Callout>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

const STATUS_TONE: Record<ReviewStatus, "bad" | "warn" | "muted" | "accent"> = {
  open: "bad",
  reviewing: "warn",
  dismissed: "muted",
  confirmed: "accent",
};

function AnomalySection({
  records,
  settings,
  stationName,
  onChanged,
}: {
  records: WasteRecord[];
  settings: DetectionSettings;
  stationName: (id: Id) => string | null;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { tenant } = useSession();
  const [selected, setSelected] = useState<WasteAnomaly | null>(null);
  const [editing, setEditing] = useState(false);
  const reviews = useAsync(() => services.anomalyReviews.all(), []);
  const anomalies = useMemo(() => detectWasteAnomalies(records, settings.waste), [records, settings.waste]);
  const reviewOf = (id: string): AnomalyReview | undefined => (reviews.data ?? []).find((row) => row.flagId === id);
  const currency = records[0]?.value.currency ?? tenant.baseCurrency;

  const columns: Column<WasteAnomaly>[] = [
    {
      key: "pattern",
      header: t("invx.wa.pattern"),
      render: (row) => (
        <CellStack
          primary={t(`invx.wa.kind.${row.kind}` as ConsoleKey)}
          secondary={`${tx(row.itemName)} · ${tx(row.locationName)}`}
        />
      ),
    },
    {
      key: "subject",
      header: t("invx.wa.subject"),
      render: (row) =>
        row.employeeName ? (
          <CellStack primary={tx(row.employeeName)} secondary={row.shiftBand ? t(`invx.wa.shift.${row.shiftBand}` as ConsoleKey) : undefined} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "value", header: t("common.value"), numeric: true, render: (row) => formatMoney(money(row.valueMinor, currency), fmt) },
    { key: "z", header: t("invx.wa.deviation"), numeric: true, render: (row) => <span className="font-mono">{formatNumber(row.z, fmt, 1)}σ</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const status = reviewOf(row.id)?.status ?? "open";
        return (
          <Badge tone={STATUS_TONE[status]} dot>
            {t(`invx.wa.status.${status}` as ConsoleKey)}
          </Badge>
        );
      },
    },
  ];

  return (
    <Section
      title={t("invx.wa.anomaliesTitle")}
      hint={t("invx.wa.anomaliesHint")}
      spec="FR-INV-061"
      padded={false}
      action={
        <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={() => setEditing(true)}>
          {t("invx.wa.policy")}
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={anomalies}
        rowKey={(row) => row.id}
        caption={t("invx.wa.anomaliesTitle")}
        onRowClick={setSelected}
        emptyTitle={t("invx.wa.noAnomalies")}
        emptyBody={t("invx.wa.noAnomaliesBody")}
        dense
      />
      {selected ? (
        <AnomalyDrawer
          anomaly={selected}
          records={records.filter((row) => selected.recordIds.includes(row.id))}
          review={reviewOf(selected.id)}
          currency={currency}
          stationName={stationName}
          onClose={() => setSelected(null)}
          onReviewed={(note) => {
            setSelected(null);
            reviews.reload();
            onChanged(note);
          }}
        />
      ) : null}
      {editing ? (
        <DetectionPolicyDrawer
          settings={settings}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged(t("invx.wa.policySaved"));
          }}
        />
      ) : null}
    </Section>
  );
}

function AnomalyDrawer({
  anomaly,
  records,
  review,
  currency,
  stationName,
  onClose,
  onReviewed,
}: {
  anomaly: WasteAnomaly;
  records: WasteRecord[];
  review: AnomalyReview | undefined;
  currency: WasteRecord["value"]["currency"];
  stationName: (id: Id) => string | null;
  onClose: () => void;
  onReviewed: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const [note, setNote] = useState("");
  const status = review?.status ?? "open";
  const closed = status === "dismissed" || status === "confirmed";

  const record = (next: ReviewStatus) =>
    void action.run(() => services.anomalyReviews.record(anomaly.id, { status: next, note, by: session?.user.email ?? null }), {
      onSuccess: () => onReviewed(t(`invx.wa.reviewed.${next}` as ConsoleKey)),
    });

  return (
    <Drawer
      open
      onClose={onClose}
      title={t(`invx.wa.kind.${anomaly.kind}` as ConsoleKey)}
      subtitle={`${tx(anomaly.itemName)} · ${tx(anomaly.locationName)}`}
      footer={
        closed ? null : (
          <div className="flex flex-wrap gap-2">
            {status === "open" ? (
              <Button loading={action.pending} onClick={() => record("reviewing")}>
                {t("invx.wa.startReview")}
              </Button>
            ) : null}
            <Button variant="ghost" loading={action.pending} disabled={note.trim().length < 10} onClick={() => record("dismissed")}>
              {t("invx.wa.dismiss")}
            </Button>
            <Button variant="danger" loading={action.pending} disabled={note.trim().length < 10} onClick={() => record("confirmed")}>
              {t("invx.wa.confirm")}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("invx.wa.notAccusation")}</Callout>

        <DescList>
          <DescRow label={t("invx.wa.observed")} mono>
            {formatMoney(money(anomaly.valueMinor, currency), fmt)} · {t("invx.wa.recordsN").replace("{n}", String(anomaly.records))}
          </DescRow>
          <DescRow label={anomaly.kind === "employee_item_pattern" ? t("invx.wa.peerBaseline") : t("invx.wa.ownBaseline")} mono>
            {formatMoney(money(anomaly.baselineMeanMinor, currency), fmt)} ± {formatMoney(money(anomaly.baselineStdevMinor, currency), fmt)}
          </DescRow>
          <DescRow label={t("invx.wa.deviation")} mono>
            {formatNumber(anomaly.z, fmt, 1)}σ
          </DescRow>
          {anomaly.concentration !== null && anomaly.shiftBand ? (
            <DescRow label={t("invx.wa.concentration")}>
              {t("invx.wa.concentrationText")
                .replace("{p}", formatPercent(anomaly.concentration * 100, fmt, 0))
                .replace("{band}", t(`invx.wa.shift.${anomaly.shiftBand}` as ConsoleKey))}
            </DescRow>
          ) : null}
          {anomaly.employeeName ? <DescRow label={t("invx.wa.dim.employee")}>{tx(anomaly.employeeName)}</DescRow> : null}
          <DescRow label={t("invx.wa.window")}>
            {formatDateTime(anomaly.firstAt, fmt)} – {formatDateTime(anomaly.lastAt, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("invx.wa.evidence")}</h3>
          <DataTable
            columns={[
              { key: "at", header: t("common.time"), render: (row) => formatDateTime(row.recordedAt, fmt) },
              { key: "qty", header: t("common.quantity"), numeric: true, render: (row) => <span dir="ltr" className="font-mono">{row.quantity.value} {row.quantity.unit}</span> },
              { key: "reason", header: t("inv.reason"), render: (row) => tx(row.reasonName) },
              { key: "station", header: t("invx.wa.dim.station"), secondary: true, render: (row) => (row.stationId ? (stationName(row.stationId) ?? row.stationId) : "—") },
              { key: "value", header: t("common.value"), numeric: true, render: (row) => formatMoney(row.value, fmt) },
            ]}
            rows={records}
            rowKey={(row) => row.id}
            caption={t("invx.wa.evidence")}
            dense
          />
        </section>

        {!closed ? (
          <Field label={t("invx.wa.finding")} hint={t("invx.wa.findingHint")} required>
            <Textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}

        {review && review.history.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("invx.req.history")}</h3>
            <ol className="border-line space-y-2 border-s ps-3">
              {review.history.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="text-xs">
                  <p className="text-fg">
                    {t(`invx.wa.status.${entry.status}` as ConsoleKey)} · {entry.by ?? "—"}
                  </p>
                  <p className="text-fg-subtle">{formatDateTime(entry.at, fmt)}</p>
                  {entry.note ? <p className="text-fg-muted mt-0.5">{entry.note}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function DetectionPolicyDrawer({ settings, onClose, onSaved }: { settings: DetectionSettings; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { session, tenant } = useSession();
  const canEdit = usePermission("inventory.waste.approve");
  const action = useAction();
  const w = settings.waste;
  const [draft, setDraft] = useState({
    sigma: String(w.sigma),
    minRecords: String(w.minRecords),
    concentration: String(Math.round(w.shiftConcentration * 100)),
    minValue: String(w.minValueMinor / 100),
    minPeers: String(w.minPeers),
  });
  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const next = {
    sigma: Number(draft.sigma),
    minRecords: Number(draft.minRecords),
    shiftConcentration: Number(draft.concentration) / 100,
    minValueMinor: Math.round(Number(draft.minValue) * 100),
    minPeers: Number(draft.minPeers),
  };
  const valid = next.sigma > 0 && Number.isInteger(next.minRecords) && next.minRecords > 0 && next.shiftConcentration > 0 && next.shiftConcentration <= 1 && next.minValueMinor >= 0 && Number.isInteger(next.minPeers) && next.minPeers >= 2;

  const field = (key: keyof typeof draft, label: ConsoleKey, hint: ConsoleKey) => (
    <Field label={t(label)} hint={t(hint).replace("{currency}", tenant.baseCurrency)}>
      <Input dir="ltr" inputMode="decimal" value={draft[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.wa.policy")}
      subtitle="FR-INV-061"
      footer={
        canEdit ? (
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={action.pending}
              disabled={!valid}
              onClick={() => void action.run(() => services.inventoryControls.detection.saveSettings({ ...settings, waste: next, updatedBy: session?.user.email ?? null }), { onSuccess: onSaved })}
            >
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!canEdit ? <Callout tone="muted">{t("invx.common.readOnly")}</Callout> : null}
        <fieldset disabled={!canEdit} className="space-y-4">
          {field("sigma", "invx.wa.pSigma", "invx.wa.pSigmaHint")}
          {field("minRecords", "invx.wa.pRecords", "invx.wa.pRecordsHint")}
          {field("concentration", "invx.wa.pConcentration", "invx.wa.pConcentrationHint")}
          {field("minValue", "invx.wa.pValue", "invx.wa.pValueHint")}
          {field("minPeers", "invx.wa.pPeers", "invx.wa.pPeersHint")}
        </fieldset>
        {!valid ? <p className="text-bad text-xs">{t("invx.wa.pInvalid")}</p> : null}
      </div>
    </Drawer>
  );
}
