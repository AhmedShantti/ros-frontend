"use client";

/**
 * Which pack governed a transaction (FR-LOC-021), and whether terminals hold
 * a pack before it takes effect (FR-LOC-024).
 */

import { useMemo, useState } from "react";

import type { IsoDate } from "@/lib/console/types";
import {
  distributionState,
  lifecycle,
  versionInForce,
  type CountryPackVersion,
  type DistributionState,
} from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { countFromInput, formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Callout, DescList, DescRow, Field, Input, SegmentedControl, Select } from "@/components/console/ui";
import { LifecycleBadge, strategyLabel } from "@/components/console/country-pack-versions";

// ---------------------------------------------------------------------------
// Transaction lookup — FR-LOC-021
// ---------------------------------------------------------------------------

export function PackTransactionLookup({ versions, today }: { versions: CountryPackVersion[]; today: IsoDate }) {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const [mode, setMode] = useState<"order" | "manual">("order");
  const [orderId, setOrderId] = useState("");
  const [day, setDay] = useState(today);
  const [code, setCode] = useState(versions[0]?.code ?? "");

  const orders = useAsync(() => services.sales.orders.list({ scope, limit: 100, sort: "-openedAt" }), [scope.tenantId, scope.brandId, scope.branchId]);
  const codes = useMemo(() => [...new Set(versions.map((row) => row.code))].sort(), [versions]);
  const branchById = useMemo(() => new Map(availableBranches.map((row) => [row.id, row])), [availableBranches]);

  const order = orders.data?.rows.find((row) => row.id === orderId) ?? null;
  const branch = order ? branchById.get(order.branchId) : undefined;
  const lookupCode = mode === "order" ? (branch?.countryCode ?? null) : code;
  const lookupDay = mode === "order" ? (order?.businessDay ?? null) : day;
  const inForce = lookupCode && lookupDay ? versionInForce(versions, lookupCode, lookupDay) : null;

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("cpv.lookupNote")}</Callout>
      <SegmentedControl
        value={mode}
        onChange={setMode}
        options={[
          { value: "order", label: t("cpv.lookupByOrder") },
          { value: "manual", label: t("cpv.lookupByDay") },
        ]}
      />

      {mode === "order" ? (
        <AsyncPanel state={orders} isEmpty={(page) => page.rows.length === 0}>
          {(page) => (
            <Field label={t("cpv.order")} hint={t("cpv.orderHint")}>
              <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
                <option value="">—</option>
                {page.rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.orderNumber} · {tx(row.branchName)} · {row.businessDay}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </AsyncPanel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:w-2/3">
          <Field label={t("org.country")}>
            <Select value={code} onChange={(event) => setCode(event.target.value)}>
              {codes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cpv.businessDay")}>
            <Input type="date" dir="ltr" value={day} onChange={(event) => setDay(event.target.value)} />
          </Field>
        </div>
      )}

      {mode === "order" && order && !branch ? <Callout tone="warn">{t("cpv.branchUnknown")}</Callout> : null}

      {lookupCode && lookupDay ? (
        inForce ? (
          <Section
            title={t("cpv.inForceTitle")
              .replace("{version}", `${inForce.code} ${inForce.version}`)
              .replace("{day}", formatDate(lookupDay, fmt))}
            action={<LifecycleBadge state={lifecycle(inForce, versions, today)} />}
          >
            <DescList>
              {order ? (
                <DescRow label={t("cpv.order")}>
                  {order.orderNumber} · {branch ? tx(branch.name) : order.branchId}
                </DescRow>
              ) : null}
              <DescRow label={t("cp.effectiveFrom")}>{formatDate(inForce.effectiveFrom, fmt)}</DescRow>
              <DescRow label={t("cpv.strategy")}>{strategyLabel(inForce.taxEngine, tx)}</DescRow>
              <DescRow label={t("cp.pricingMode")}>
                {inForce.pricingMode === "tax_inclusive" ? t("fin.taxInclusive") : t("fin.taxExclusive")}
              </DescRow>
              <DescRow label={t("cp.rounding")} mono>
                <span dir="ltr">{inForce.roundingMode}</span>
              </DescRow>
              <DescRow label={t("cp.computationLevel")}>
                {inForce.computationLevel === "line" ? t("fin.perLine") : t("fin.perOrder")}
              </DescRow>
              <DescRow label={t("org.currency")} mono>
                <span dir="ltr">
                  {inForce.currency} ({inForce.currencyExponent})
                </span>
              </DescRow>
              {inForce.taxClasses.map((taxClass) => (
                <DescRow key={taxClass.code} label={`${t("cp.taxClasses")} · ${taxClass.code}`} mono>
                  {taxClass.rate === null ? t("cpv.exempt") : formatPercent(taxClass.rate, fmt, taxClass.rate % 1 === 0 ? 0 : 2)}
                </DescRow>
              ))}
              <DescRow label={t("cpv.digest")} mono>
                <span dir="ltr" className="text-xs">
                  {inForce.digest ? `${inForce.digest.slice(0, 16)}…` : inForce.platform ? t("cpv.platformSigned") : "—"}
                </span>
              </DescRow>
            </DescList>
          </Section>
        ) : (
          <Callout tone="warn">
            {t("cpv.noneInForce").replace("{code}", lookupCode).replace("{day}", formatDate(lookupDay, fmt))}
          </Callout>
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribution — FR-LOC-024
// ---------------------------------------------------------------------------

const STATE_TONE: Record<DistributionState, "good" | "accent" | "neutral" | "warn" | "bad"> = {
  active_on_device: "good",
  held_on_device: "accent",
  awaiting_sync: "neutral",
  at_risk: "warn",
  missed: "bad",
};

export function PackDistribution({ versions, today }: { versions: CountryPackVersion[]; today: IsoDate }) {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const [leadDays, setLeadDays] = useState("3");
  const lead = countFromInput(leadDays) ?? 3;

  const candidates = useMemo(
    () =>
      versions
        .filter((row) => row.status === "certified")
        .map((row) => ({ row, state: lifecycle(row, versions, today) }))
        .filter((entry) => entry.state === "scheduled" || entry.state === "active")
        .sort((a, b) => a.row.code.localeCompare(b.row.code) || b.row.effectiveFrom.localeCompare(a.row.effectiveFrom)),
    [versions, today],
  );
  const [versionId, setVersionId] = useState("");
  const chosen = candidates.find((entry) => entry.row.id === versionId) ?? candidates.find((entry) => entry.state === "scheduled") ?? candidates[0];

  const terminals = useAsync(() => services.operations.terminals({ scope, limit: 500 }), [scope.tenantId, scope.brandId, scope.branchId]);
  const branchById = useMemo(() => new Map(availableBranches.map((row) => [row.id, row])), [availableBranches]);

  const rows = useMemo(() => {
    if (!chosen || !terminals.data) return [];
    const now = new Date();
    return terminals.data.rows
      .filter((terminal) => branchById.get(terminal.branchId)?.countryCode === chosen.row.code && terminal.status !== "revoked")
      .map((terminal) => ({ terminal, state: distributionState(chosen.row, terminal.lastSeenAt, now, lead) }));
  }, [chosen, terminals.data, branchById, lead]);

  type Row = (typeof rows)[number];
  const counts = (state: DistributionState) => rows.filter((row) => row.state === state).length;

  const columns: Column<Row>[] = [
    {
      key: "terminal",
      header: t("cpv.terminal"),
      render: ({ terminal }) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{terminal.name}</span>
          <span className="text-fg-subtle font-mono text-xs" dir="ltr">
            {terminal.code} · {terminal.kind}
          </span>
        </span>
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: ({ terminal }) => {
        const branch = branchById.get(terminal.branchId);
        return branch ? tx(branch.name) : terminal.branchId;
      },
    },
    { key: "lastSeen", header: t("cpv.lastSync"), render: ({ terminal }) => formatDateTime(terminal.lastSeenAt, fmt) },
    {
      key: "state",
      header: t("common.status"),
      render: ({ state }) => (
        <Badge tone={STATE_TONE[state]} dot>
          {t(`cpv.dist.${state}` as ConsoleKey)}
        </Badge>
      ),
    },
  ];

  if (candidates.length === 0) return <Callout tone="muted">{t("cpv.noDistributable")}</Callout>;

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("cpv.distributionNote")}</Callout>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label={t("cp.version")}>
          <Select value={chosen?.row.id ?? ""} onChange={(event) => setVersionId(event.target.value)}>
            {candidates.map(({ row, state }) => (
              <option key={row.id} value={row.id}>
                {row.code} {row.version} · {t(`cpv.state.${state}` as ConsoleKey)} · {row.effectiveFrom}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("cpv.leadDays")} hint={t("cpv.leadDaysHint")}>
          <Input dir="ltr" inputMode="numeric" className="w-24 font-mono" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
        </Field>
      </div>

      {chosen ? (
        <p className="text-fg-muted text-xs">
          {t("cpv.publishedAt")
            .replace("{at}", formatDateTime(chosen.row.publishedAt, fmt))
            .replace("{day}", formatDate(chosen.row.effectiveFrom, fmt))}
        </p>
      ) : null}

      <AsyncPanel state={terminals}>
        {() => (
          <>
            <TileGrid columns={4}>
              <MetricTile label={t("cpv.dist.held")} value={formatNumber(counts("held_on_device") + counts("active_on_device"), fmt)} />
              <MetricTile label={t("cpv.dist.awaiting_sync")} value={formatNumber(counts("awaiting_sync"), fmt)} />
              <MetricTile label={t("cpv.dist.at_risk")} value={formatNumber(counts("at_risk"), fmt)} hint={t("cpv.atRiskHint").replace("{n}", String(lead))} />
              <MetricTile label={t("cpv.dist.missed")} value={formatNumber(counts("missed"), fmt)} hint={t("cpv.missedHint")} />
            </TileGrid>
            {counts("at_risk") + counts("missed") > 0 ? (
              <Callout tone="warn">{t("cpv.riskCallout").replace("{n}", String(counts("at_risk") + counts("missed")))}</Callout>
            ) : null}
            <DataTable
              columns={columns}
              rows={[...rows].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))}
              rowKey={({ terminal }) => terminal.id}
              caption={t("cpv.distributionTab")}
              emptyTitle={t("cpv.noTerminals").replace("{code}", chosen?.row.code ?? "")}
              dense
            />
          </>
        )}
      </AsyncPanel>
    </div>
  );
}

const ORDER: DistributionState[] = ["missed", "at_risk", "awaiting_sync", "held_on_device", "active_on_device"];
