"use client";

/**
 * Recharts wrappers.
 *
 * Three things are handled once here so no page has to think about them:
 *
 *  1. Colour comes from the CSS custom properties in `globals.css`, read back
 *     after mount, so a chart repaints correctly when the theme flips.
 *  2. Charts render only after mount. `ResponsiveContainer` measures the DOM
 *     and would otherwise produce a server/client mismatch.
 *  3. In right-to-left the category axis is reversed and the value axis moves
 *     to the right, so time still runs in the reading direction.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { HourlySalesPoint, MetricSummary, TrendPoint } from "@/lib/console/types";
import { formatNumber, formatPercent } from "@/lib/console/format";
import { useI18n, usePreferences } from "@/lib/console/providers";
import { Card, Skeleton, cx } from "./ui";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface ChartTheme {
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  line: string;
  raised: string;
  sunken: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
  info: string;
  series: string[];
}

/**
 * The server render and the first paint use these, then the effect below
 * reads the real custom properties. They mirror the light values in
 * `globals.css` — keep the two in step.
 */
const LIGHT: ChartTheme = {
  fg: "#2a211a",
  fgMuted: "#6f6053",
  fgSubtle: "#9c8875",
  line: "#e2d5c1",
  raised: "#fffdf9",
  sunken: "#efe6d7",
  accent: "#c1553a",
  good: "#5f7f3d",
  warn: "#a9741a",
  bad: "#a62b31",
  info: "#4d6f6b",
  series: ["#c1553a", "#a9741a", "#4d6f6b", "#5f7f3d", "#a62b31", "#d98d1f"],
};

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Live token values for the current theme. Falls back to light during SSR. */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = usePreferences();
  const [theme, setTheme] = useState<ChartTheme>(LIGHT);

  useEffect(() => {
    const accent = readVar("--c-accent", LIGHT.accent);
    const good = readVar("--c-good", LIGHT.good);
    const warn = readVar("--c-warn", LIGHT.warn);
    const bad = readVar("--c-bad", LIGHT.bad);
    const info = readVar("--c-info", LIGHT.info);
    setTheme({
      fg: readVar("--c-fg", LIGHT.fg),
      fgMuted: readVar("--c-fg-muted", LIGHT.fgMuted),
      fgSubtle: readVar("--c-fg-subtle", LIGHT.fgSubtle),
      line: readVar("--c-line", LIGHT.line),
      raised: readVar("--c-raised", LIGHT.raised),
      sunken: readVar("--c-sunken", LIGHT.sunken),
      accent,
      good,
      warn,
      bad,
      info,
      // A sixth hue so a six-slice donut does not repeat itself; the
      // saffron sits between the accent and the warn without colliding.
      series: [accent, warn, info, good, bad, readVar("--color-saffron", "#d98d1f")],
    });
  }, [resolvedTheme]);

  return theme;
}

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

// ---------------------------------------------------------------------------
// Frame, tooltip, axes
// ---------------------------------------------------------------------------

export function ChartFrame({
  height = 240,
  children,
}: {
  height?: number;
  children: ReactNode;
}) {
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div style={{ height }} className="w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipItem {
  name: string;
  value: number;
  color: string;
}

function toItems(payload: unknown): TooltipItem[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => {
    const item = entry as {
      name?: unknown;
      value?: unknown;
      color?: unknown;
      stroke?: unknown;
      fill?: unknown;
    };
    const colour = [item.color, item.stroke, item.fill].find((c) => typeof c === "string");
    return {
      name: item.name === undefined || item.name === null ? "" : String(item.name),
      value: Number(item.value ?? 0),
      color: typeof colour === "string" ? colour : "currentColor",
    };
  });
}

function TooltipCard({
  active,
  label,
  items,
  format,
}: {
  active?: boolean;
  label?: string;
  items: TooltipItem[];
  format: (value: number) => string;
}) {
  if (!active || items.length === 0) return null;
  return (
    <div className="bg-raised border-line min-w-40 rounded-lg border px-3 py-2 shadow-xl">
      {label ? <p className="text-fg-subtle mb-1.5 text-[0.68rem]">{label}</p> : null}
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex items-center justify-between gap-4">
            <span className="text-fg-muted flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              {item.name}
            </span>
            <span className="text-fg font-mono text-xs tabular-nums">{format(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shared axis styling, so every chart in the console reads the same. */
function axisProps(theme: ChartTheme) {
  return {
    stroke: theme.line,
    tick: { fill: theme.fgSubtle, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  } as const;
}

// ---------------------------------------------------------------------------
// Trend — a value series with an optional comparison line
// ---------------------------------------------------------------------------

export function TrendChart({
  data,
  height = 240,
  valueLabel,
  comparisonLabel,
  format,
  target,
  targetLabel,
}: {
  data: TrendPoint[];
  height?: number;
  valueLabel: string;
  comparisonLabel?: string;
  format?: (value: number) => string;
  target?: number;
  targetLabel?: string;
}) {
  const theme = useChartTheme();
  const { dir, fmt } = useI18n();
  const rtl = dir === "rtl";
  const formatValue = format ?? ((value: number) => formatNumber(value, fmt));
  const hasComparison = data.some((point) => typeof point.comparison === "number");

  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="ros-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.24} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke={theme.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" reversed={rtl} {...axisProps(theme)} />
        <YAxis
          orientation={rtl ? "right" : "left"}
          width={56}
          tickFormatter={(value: number) => formatValue(value)}
          {...axisProps(theme)}
        />
        <Tooltip
          cursor={{ stroke: theme.line }}
          content={(props) => (
            <TooltipCard
              active={props.active}
              label={props.label === undefined ? undefined : String(props.label)}
              items={toItems(props.payload)}
              format={formatValue}
            />
          )}
        />

        {typeof target === "number" ? (
          <ReferenceLine
            y={target}
            stroke={theme.warn}
            strokeDasharray="4 4"
            label={{ value: targetLabel, fill: theme.fgSubtle, fontSize: 10, position: "insideTopLeft" }}
          />
        ) : null}

        <Area
          type="monotone"
          dataKey="value"
          name={valueLabel}
          stroke={theme.accent}
          strokeWidth={2}
          fill="url(#ros-trend-fill)"
          activeDot={{ r: 3, strokeWidth: 0 }}
        />

        {hasComparison ? (
          <Area
            type="monotone"
            dataKey="comparison"
            name={comparisonLabel ?? valueLabel}
            stroke={theme.fgSubtle}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="none"
            dot={false}
          />
        ) : null}
      </AreaChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Hourly — sales bars with a labour overlay
// ---------------------------------------------------------------------------

export function HourlyChart({
  data,
  height = 260,
  salesLabel,
  labourLabel,
  forecastLabel,
  format,
}: {
  data: HourlySalesPoint[];
  height?: number;
  salesLabel: string;
  labourLabel: string;
  forecastLabel?: string;
  format?: (value: number) => string;
}) {
  const theme = useChartTheme();
  const { dir, fmt } = useI18n();
  const rtl = dir === "rtl";
  const formatValue = format ?? ((value: number) => formatNumber(value, fmt));

  return (
    <ChartFrame height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={theme.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="hour" reversed={rtl} interval={1} {...axisProps(theme)} />
        <YAxis
          orientation={rtl ? "right" : "left"}
          width={56}
          tickFormatter={(value: number) => formatValue(value)}
          {...axisProps(theme)}
        />
        <Tooltip
          cursor={{ fill: theme.sunken, opacity: 0.5 }}
          content={(props) => (
            <TooltipCard
              active={props.active}
              label={props.label === undefined ? undefined : String(props.label)}
              items={toItems(props.payload)}
              format={formatValue}
            />
          )}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: theme.fgMuted, paddingTop: 8 }}
        />

        <Bar dataKey="sales" name={salesLabel} fill={theme.accent} radius={[3, 3, 0, 0]} maxBarSize={22} />
        {forecastLabel ? (
          <Line
            type="monotone"
            dataKey="forecast"
            name={forecastLabel}
            stroke={theme.fgSubtle}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="labourCost"
          name={labourLabel}
          stroke={theme.warn}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Category bars — a ranked, horizontal distribution
// ---------------------------------------------------------------------------

export function CategoryBarChart({
  data,
  height = 240,
  valueLabel,
  format,
  colourByIndex,
}: {
  data: TrendPoint[];
  height?: number;
  valueLabel: string;
  format?: (value: number) => string;
  /** Give each bar its own series colour — for mixes rather than rankings. */
  colourByIndex?: boolean;
}) {
  const theme = useChartTheme();
  const { dir, fmt } = useI18n();
  const rtl = dir === "rtl";
  const formatValue = format ?? ((value: number) => formatNumber(value, fmt));

  return (
    <ChartFrame height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 4, left: 12 }}
      >
        <CartesianGrid stroke={theme.line} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          reversed={rtl}
          tickFormatter={(value: number) => formatValue(value)}
          {...axisProps(theme)}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={120}
          orientation={rtl ? "right" : "left"}
          {...axisProps(theme)}
        />
        <Tooltip
          cursor={{ fill: theme.sunken, opacity: 0.5 }}
          content={(props) => (
            <TooltipCard
              active={props.active}
              label={props.label === undefined ? undefined : String(props.label)}
              items={toItems(props.payload)}
              format={formatValue}
            />
          )}
        />
        <Bar dataKey="value" name={valueLabel} radius={[0, 3, 3, 0]} maxBarSize={18}>
          {data.map((point, index) => (
            <Cell
              key={point.label}
              fill={colourByIndex ? theme.series[index % theme.series.length] : theme.accent}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Mix — a donut with the total in the middle
// ---------------------------------------------------------------------------

export function MixDonut({
  data,
  height = 240,
  format,
  centreLabel,
  centreValue,
}: {
  data: TrendPoint[];
  height?: number;
  format?: (value: number) => string;
  centreLabel?: string;
  centreValue?: string;
}) {
  const theme = useChartTheme();
  const { fmt } = useI18n();
  const formatValue = format ?? ((value: number) => formatNumber(value, fmt));

  return (
    <div className="relative">
      <ChartFrame height={height}>
        <PieChart>
          <Tooltip
            content={(props) => (
              <TooltipCard
                active={props.active}
                items={toItems(props.payload)}
                format={formatValue}
              />
            )}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={1.5}
            stroke={theme.raised}
            strokeWidth={2}
          >
            {data.map((point, index) => (
              <Cell key={point.label} fill={theme.series[index % theme.series.length]} />
            ))}
          </Pie>
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, color: theme.fgMuted }}
          />
        </PieChart>
      </ChartFrame>

      {centreValue ? (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
          <p className="text-fg font-mono text-lg tabular-nums">{centreValue}</p>
          {centreLabel ? <p className="text-fg-subtle text-[0.68rem]">{centreLabel}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — trend without axes, for tiles and table cells
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  tone = "accent",
  height = 32,
}: {
  values: number[];
  tone?: "accent" | "good" | "warn" | "bad";
  height?: number;
}) {
  const theme = useChartTheme();
  const { dir } = useI18n();
  const data = values.map((value, index) => ({ index, value }));
  const stroke =
    tone === "good" ? theme.good : tone === "warn" ? theme.warn : tone === "bad" ? theme.bad : theme.accent;

  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <XAxis dataKey="index" hide reversed={dir === "rtl"} />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

/**
 * A headline figure with its movement against the previous period. Direction
 * is not enough to colour it — a rising food-cost percentage is bad — so the
 * tone comes from the metric's own `higherIsBetter`.
 */
export function MetricTile({
  label,
  value,
  metric,
  hint,
  spec,
  footer,
  sparkline,
}: {
  label: string;
  value: string;
  metric?: MetricSummary;
  hint?: string;
  spec?: string;
  footer?: ReactNode;
  sparkline?: number[];
}) {
  const { t, fmt } = useI18n();

  const direction = metric?.direction ?? "flat";
  const good =
    metric && direction !== "flat"
      ? metric.higherIsBetter === (direction === "up")
      : null;

  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-fg-muted text-xs">{label}</p>
          {spec ? (
            <span className="border-line text-fg-subtle rounded border px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wide uppercase">
              {spec}
            </span>
          ) : null}
        </div>

        <p className="text-fg mt-2 font-mono text-xl tabular-nums">{value}</p>

        {metric ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cx(
                "inline-flex items-center gap-1 text-xs font-medium",
                good === null && "text-fg-muted",
                good === true && "text-good",
                good === false && "text-bad",
              )}
            >
              <Arrow size={13} aria-hidden />
              {formatPercent(Math.abs(metric.deltaPercent), fmt, 1)}
            </span>
            <span className="text-fg-subtle text-[0.68rem]">{t("common.vsPrevious")}</span>
          </div>
        ) : hint ? (
          <p className="text-fg-subtle mt-2 text-xs leading-relaxed">{hint}</p>
        ) : null}
      </div>

      {sparkline && sparkline.length > 1 ? (
        <div className="mt-3">
          <Sparkline values={sparkline} tone={good === false ? "bad" : "accent"} />
        </div>
      ) : null}

      {footer ? <div className="text-fg-subtle mt-3 text-xs">{footer}</div> : null}
    </Card>
  );
}
