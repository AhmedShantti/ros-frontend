"use client";

/**
 * Menu engineering matrix — SRS §13.6, FR-MNU-055, FR-MNU-056, FR-MNU-057.
 *
 * `/costing/margin` shows the classification the costing service returns for
 * the whole scope. This page answers the questions that one cannot: is the
 * lunch Star also a dinner Star (FR-MNU-056)? Is the branch by the university
 * selling a different menu from the one by the offices? And which modifiers
 * are so often chosen they are under-priced, or so rarely chosen they are
 * over-priced (FR-MNU-057)?
 *
 * No endpoint offers those cuts, so the matrix is computed here from order
 * lines (`GET /orders`, walked to the most recent 1,000) and standard recipe
 * costs. The page says how many orders it analysed and whether that was all
 * of them.
 */

import { useMemo, useState } from "react";

import type { Id, Order, OrderLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { BUSINESS_DAY } from "@/lib/console/mock/clock";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { MENU_CLASSIFICATION, MENU_CLASSIFICATION_ACTION, labelOf } from "@/lib/console/labels";
import {
  DEFAULT_DAY_PARTS,
  engineer,
  modifierAttachRates,
  ordersInCut,
  type DayPart,
  type EngineeringRow,
  type ModifierAttachRow,
} from "@/lib/console/menu-engineering";
import { roundToPricePoint, unitOf } from "@/lib/console/menu-pricing";
import { currencyExponent } from "@/lib/console/format";
import { useVariantCosts } from "@/lib/console/menu-price-actions";
import { usePricingSettings } from "@/components/console/menu-price-tools";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Button, Callout, Card, Field, Input, Select, cx } from "@/components/console/ui";
import type { Currency, MenuClassification } from "@/lib/console/types";

export default function MenuEngineeringPage() {
  return (
    <Gate permissions={["costing.margin.view"]}>
      <EngineeringScreen />
    </Gate>
  );
}

function anchorDay(): string {
  if (DATA_MODE !== "http") return BUSINESS_DAY;
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

const QUADRANTS: MenuClassification[] = ["star", "plough_horse", "puzzle", "dog"];

function EngineeringScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const costs = useVariantCosts();
  const [settings] = usePricingSettings();

  const today = anchorDay();
  const [from, setFrom] = useState(shiftDay(today, -29));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<Id | "">(scope.branchId ?? "");
  const [dayParts, setDayParts] = useState<DayPart[]>(DEFAULT_DAY_PARTS);
  const [dayPartId, setDayPartId] = useState("");
  const [factor, setFactor] = useState("0.7");
  const [high, setHigh] = useState("40");
  const [low, setLow] = useState("5");
  const [step, setStep] = useState("10");

  const orders = useAsync(
    () => services.sales.orders.list({ limit: 1000, scope }),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const loaded: Order[] = orders.data?.rows ?? [];
  const truncated = (orders.data?.total ?? 0) > loaded.length;
  const oldestLoaded = loaded.reduce<string | null>((min, order) => (!min || order.businessDay < min ? order.businessDay : min), null);

  const dayPart = dayParts.find((part) => part.id === dayPartId) ?? null;

  const cut = useMemo(
    // FR-MNU-056: per branch, per day-part, per date range.
    () => ordersInCut(loaded, { from, to, branchId: branchId || null, dayPart }),
    [loaded, from, to, branchId, dayPart],
  );

  const costOf = useMemo(() => {
    return (line: OrderLine): number | null => {
      const standard = costs.costOf(line.variantId, line.menuItemId, null);
      if (standard !== null) return standard;
      // Fallback: the cost captured with the sale (per unit, per the Order contract).
      return line.unitCostSnapshot.amount > 0 ? line.unitCostSnapshot.amount : null;
    };
  }, [costs]);

  const result = useMemo(
    // FR-MNU-055: popularity vs contribution margin classification.
    () => engineer(cut, { popularityFactor: Number(factor), costOf }),
    [cut, factor, costOf],
  );

  const attach = useMemo(
    () =>
      modifierAttachRates(cut, {
        high: Number(high) / 100,
        low: Number(low) / 100,
        step: Number(step) / 100,
        minimumEligible: 10,
      }),
    [cut, high, low, step],
  );

  const currency = result.currency as Currency;
  const money = (amount: number | null) => (amount === null ? "—" : formatMoney({ amount: Math.round(amount), currency }, fmt));
  const unit = unitOf(currencyExponent(currency));

  const byQuadrant = useMemo(() => {
    const groups: Record<MenuClassification, EngineeringRow[]> = { star: [], plough_horse: [], puzzle: [], dog: [] };
    for (const row of result.rows) if (row.classification !== "unclassified") groups[row.classification].push(row);
    return groups;
  }, [result.rows]);
  const unclassified = result.rows.filter((row) => row.classification === "unclassified");

  const itemColumns: Column<EngineeringRow>[] = [
    { key: "name", header: t("menu.itemName"), render: (row) => tx(row.name) },
    { key: "units", header: t("cost.unitsSold"), numeric: true, render: (row) => formatNumber(row.units, fmt) },
    { key: "mix", header: t("mne.mix"), numeric: true, render: (row) => formatPercent(row.mixShare * 100, fmt, 1) },
    { key: "price", header: t("mne.unitPrice"), numeric: true, secondary: true, render: (row) => money(row.unitPrice) },
    { key: "cost", header: t("mne.unitCost"), numeric: true, secondary: true, render: (row) => money(row.unitCost) },
    { key: "margin", header: t("mne.unitMargin"), numeric: true, render: (row) => money(row.unitMargin) },
    { key: "total", header: t("cost.totalContribution"), numeric: true, render: (row) => money(row.totalMargin) },
    {
      key: "class",
      header: t("cost.classification"),
      render: (row) =>
        row.classification === "unclassified" ? (
          <Badge tone="muted">{t("mne.unclassified")}</Badge>
        ) : (
          <Badge tone={labelOf(MENU_CLASSIFICATION, row.classification).tone}>
            {tx(labelOf(MENU_CLASSIFICATION, row.classification).label)}
          </Badge>
        ),
    },
  ];

  const modifierColumns: Column<ModifierAttachRow>[] = [
    { key: "name", header: t("mne.modifier"), render: (row) => tx(row.name) },
    { key: "attached", header: t("mne.attached"), numeric: true, render: (row) => formatNumber(row.attached, fmt) },
    { key: "eligible", header: t("mne.eligible"), numeric: true, secondary: true, render: (row) => formatNumber(row.eligible, fmt) },
    {
      key: "rate",
      header: t("mne.attachRate"),
      numeric: true,
      render: (row) => (
        <span className={cx(row.suggestion === "raise" || row.suggestion === "introduce_charge" ? "text-warn" : row.suggestion === "lower" || row.suggestion === "review" ? "text-accent" : "")}>
          {formatPercent(row.rate * 100, fmt, 1)}
        </span>
      ),
    },
    { key: "delta", header: t("mne.averageCharge"), numeric: true, render: (row) => money(row.averageDelta) },
    {
      key: "suggestion",
      header: t("mne.suggestion"),
      render: (row) => {
        const suggested =
          row.suggestedDelta === null ? null : roundToPricePoint(row.suggestedDelta, settings.pricePoint, unit);
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={row.suggestion === "hold" ? "muted" : row.suggestion === "raise" || row.suggestion === "introduce_charge" ? "warn" : "accent"}>
              {t(`mne.suggest.${row.suggestion}` as never)}
            </Badge>
            {suggested !== null ? <span className="font-mono text-xs">→ {money(suggested)}</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title={t("mne.title")} subtitle={t("mne.subtitle")} spec="FR-MNU-055" />

      <PageBody>
        <Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t("mnp.list.branch")}>
              <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">{t("mna.allBranches")}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {tx(branch.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("mne.dayPart")}>
              <Select value={dayPartId} onChange={(event) => setDayPartId(event.target.value)}>
                <option value="">{t("mne.allDay")}</option>
                {dayParts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {tx(part.label)} ({part.start}–{part.end})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("range.from")}>
              <Input type="date" dir="ltr" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label={t("range.to")}>
              <Input type="date" dir="ltr" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Field label={t("mne.popularityRule")} hint={t("mne.popularityRuleHint")}>
              <Select value={factor} onChange={(event) => setFactor(event.target.value)}>
                <option value="0.7">{t("mne.rule70")}</option>
                <option value="1">{t("mne.rule100")}</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                size="sm"
                variant={from === shiftDay(today, -(days - 1)) && to === today ? "primary" : "secondary"}
                onClick={() => {
                  setFrom(shiftDay(today, -(days - 1)));
                  setTo(today);
                }}
              >
                {t("mne.lastDays").replace("{count}", formatNumber(days, fmt))}
              </Button>
            ))}
          </div>

          {dayPartId ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {dayParts
                .filter((part) => part.id === dayPartId)
                .map((part) => (
                  <div key={part.id} className="flex items-end gap-2">
                    <Field label={t("mnp.list.start")}>
                      <Input
                        type="time"
                        dir="ltr"
                        value={part.start}
                        onChange={(event) => setDayParts(dayParts.map((row) => (row.id === part.id ? { ...row, start: event.target.value } : row)))}
                      />
                    </Field>
                    <Field label={t("mnp.list.end")}>
                      <Input
                        type="time"
                        dir="ltr"
                        value={part.end}
                        onChange={(event) => setDayParts(dayParts.map((row) => (row.id === part.id ? { ...row, end: event.target.value } : row)))}
                      />
                    </Field>
                  </div>
                ))}
            </div>
          ) : null}
        </Card>

        <AsyncPanel state={orders}>
          {() => (
            <>
              <Callout tone={truncated ? "warn" : "muted"}>
                {(truncated ? t("mne.truncated") : t("mne.analysed"))
                  .replace("{orders}", formatNumber(cut.length, fmt))
                  .replace("{loaded}", formatNumber(loaded.length, fmt))
                  .replace("{oldest}", oldestLoaded ?? "—")}{" "}
                {t("mne.method")}
              </Callout>

              <TileGrid columns={4}>
                <MetricTile label={t("mne.ordersInCut")} value={formatNumber(result.orders, fmt)} />
                <MetricTile label={t("cost.unitsSold")} value={formatNumber(result.units, fmt)} />
                <MetricTile label={t("mne.avgMargin")} value={money(result.averageUnitMargin)} spec="FR-MNU-055" />
                <MetricTile
                  label={t("mne.popularThreshold")}
                  value={formatPercent(result.popularityThreshold * 100, fmt, 1)}
                  spec="FR-MNU-056"
                />
              </TileGrid>

              {result.rows.length === 0 ? (
                <Callout tone="muted">{t("mne.empty")}</Callout>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {QUADRANTS.map((quadrant) => {
                      const label = labelOf(MENU_CLASSIFICATION, quadrant);
                      const rows = byQuadrant[quadrant];
                      return (
                        <Card key={quadrant}>
                          <div className="flex items-center gap-2">
                            <Badge tone={label.tone}>{tx(label.label)}</Badge>
                            <span className="text-fg-muted text-xs">{formatNumber(rows.length, fmt)}</span>
                            <span className="text-fg-subtle ms-auto text-xs">{t(`mne.axis.${quadrant}` as never)}</span>
                          </div>
                          <p className="text-fg-subtle mt-1 text-xs">{tx(MENU_CLASSIFICATION_ACTION[quadrant])}</p>
                          <ul className="mt-2 space-y-1">
                            {rows.slice(0, 8).map((row) => (
                              <li key={row.menuItemId} className="flex items-center gap-2 text-xs">
                                <span className="text-fg min-w-0 flex-1 truncate">{tx(row.name)}</span>
                                <span className="text-fg-subtle font-mono">{formatNumber(row.units, fmt)}</span>
                                <span className="font-mono">{money(row.unitMargin)}</span>
                              </li>
                            ))}
                            {rows.length > 8 ? (
                              <li className="text-fg-subtle text-xs">+{formatNumber(rows.length - 8, fmt)}</li>
                            ) : null}
                          </ul>
                        </Card>
                      );
                    })}
                  </div>

                  {unclassified.length > 0 ? (
                    <Callout tone="warn">
                      {t("mne.unclassifiedNote").replace("{count}", formatNumber(unclassified.length, fmt))}
                    </Callout>
                  ) : null}

                  <Section
                    title={t("mne.itemsTitle")}
                    action={
                      <ExportButton
                        filename="menu-engineering"
                        title={t("mne.title")}
                        filterSummary={`${from} → ${to} · ${branchId || "all"} · ${dayPart ? dayPart.id : "all-day"}`}
                        rows={result.rows}
                        columns={[
                          { key: "item", header: "item", value: (row) => tx(row.name) },
                          { key: "units", header: "units", value: (row) => row.units },
                          { key: "mix", header: "mix_share", value: (row) => row.mixShare.toFixed(4) },
                          { key: "unit_price", header: "unit_price_minor", value: (row) => Math.round(row.unitPrice) },
                          { key: "unit_cost", header: "unit_cost_minor", value: (row) => (row.unitCost === null ? null : Math.round(row.unitCost)) },
                          { key: "unit_margin", header: "unit_margin_minor", value: (row) => (row.unitMargin === null ? null : Math.round(row.unitMargin)) },
                          { key: "total", header: "total_margin_minor", value: (row) => (row.totalMargin === null ? null : Math.round(row.totalMargin)) },
                          { key: "class", header: "classification", value: (row) => row.classification },
                        ]}
                      />
                    }
                  >
                    <DataTable columns={itemColumns} rows={result.rows} rowKey={(row) => row.menuItemId} caption={t("mne.itemsTitle")} dense />
                  </Section>
                </>
              )}

              {/* FR-MNU-057: modifier attachment rates and price suggestions */}
              <Section title={t("mne.modifiersTitle")} hint={t("mne.modifiersHint")} spec="FR-MNU-057">
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <Field label={t("mne.highThreshold")} hint={t("mne.highThresholdHint")}>
                    <Input dir="ltr" inputMode="decimal" value={high} onChange={(event) => setHigh(event.target.value)} />
                  </Field>
                  <Field label={t("mne.lowThreshold")} hint={t("mne.lowThresholdHint")}>
                    <Input dir="ltr" inputMode="decimal" value={low} onChange={(event) => setLow(event.target.value)} />
                  </Field>
                  <Field label={t("mne.step")} hint={t("mne.stepHint")}>
                    <Input dir="ltr" inputMode="decimal" value={step} onChange={(event) => setStep(event.target.value)} />
                  </Field>
                </div>
                {attach.lines > 0 && attach.linesWithModifiers === 0 ? (
                  <Callout tone="warn">{DATA_MODE === "http" ? t("mne.noModifiersLive") : t("mne.noModifiers")}</Callout>
                ) : attach.rows.length === 0 ? (
                  <Callout tone="muted">{t("mne.empty")}</Callout>
                ) : (
                  <>
                    <DataTable columns={modifierColumns} rows={attach.rows} rowKey={(row) => row.key} caption={t("mne.modifiersTitle")} dense />
                    <p className="text-fg-subtle mt-2 text-xs leading-relaxed">{t("mne.eligibleNote")}</p>
                  </>
                )}
              </Section>
            </>
          )}
        </AsyncPanel>
      </PageBody>
    </>
  );
}
