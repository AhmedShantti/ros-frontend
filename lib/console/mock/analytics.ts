/**
 * Analytics fixtures — the dashboard payload, branch ranking, and the
 * costing and profitability tables. SRS ch.13 and ch.19.
 */

import type {
  BranchRankingRow,
  ChannelProfitabilityRow,
  ContributionMarginRow,
  DashboardData,
  FoodCostRow,
  HourlySalesPoint,
  Localised,
  MenuClassification,
  MetricSummary,
  Money,
  TrendPoint,
  VarianceRow,
  WasteAnalysisRow,
} from "../types";
import { branches, brandById } from "./org";
import { menuCategories, menuItems, recipeById } from "./catalogue";
import { stockItems } from "./stock-items";
import { wasteRecords } from "./inventory";
import { attendanceRecords } from "./workforce";
import { dayCloses, expenses } from "./finance";
import { operationalAlerts } from "./platform";
import {
  delayedTickets,
  kitchenTickets,
  openOrders,
  orders,
  todayOrders,
} from "./sales";
import { terminals, tables } from "./org";
import { createRng, float, gaussian, int, pick } from "./rng";
import { BUSINESS_DAY, NOW_ISO, dateAgo, lastNDates } from "./clock";

const rng = createRng(0x6d0c);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

function metric(
  value: number,
  previous: number,
  target: number | null,
  higherIsBetter: boolean,
): MetricSummary {
  const deltaPercent = previous === 0 ? 0 : ((value - previous) / previous) * 100;
  return {
    value,
    previous,
    target,
    deltaPercent: Math.round(deltaPercent * 10) / 10,
    direction: Math.abs(deltaPercent) < 0.25 ? "flat" : deltaPercent > 0 ? "up" : "down",
    higherIsBetter,
  };
}

// ---------------------------------------------------------------------------
// Branch ranking — SRS FR-BRN-010..013
// ---------------------------------------------------------------------------

interface BranchStats {
  branchId: string;
  netSales: number;
  cogs: number;
  labour: number;
  waste: number;
  transactions: number;
  varianceValue: number;
}

const branchStats: BranchStats[] = branches.map((branch, i) => {
  const closes = dayCloses.filter((d) => d.branchId === branch.id);
  const netSales =
    closes.reduce((s, d) => s + d.netSales.amount, 0) || int(rng, 4_000_000, 22_000_000);
  const transactions = closes.reduce((s, d) => s + d.transactionCount, 0) || int(rng, 300, 1600);

  // Food cost centred on 31% with real spread, so ranking means something.
  const foodCostPercent = Math.max(24, Math.min(41, gaussian(rng, 31.4, 3.1)));
  const labourPercent = Math.max(17, Math.min(34, gaussian(rng, 23.8, 2.9)));
  const wastePercent = Math.max(0.4, Math.min(6.5, gaussian(rng, 2.2, 1.1)));

  return {
    branchId: branch.id,
    netSales,
    cogs: netSales * (foodCostPercent / 100),
    labour: netSales * (labourPercent / 100),
    waste: netSales * (wastePercent / 100),
    transactions,
    varianceValue: netSales * (float(rng, 0.2, 2.4, 2) / 100) * (i % 3 === 0 ? 1 : -1),
  };
});

const statsByBranch = new Map(branchStats.map((s) => [s.branchId, s]));

const meanPrime =
  branchStats.reduce((s, b) => s + ((b.cogs + b.labour) / b.netSales) * 100, 0) /
  branchStats.length;

const sdPrime = Math.sqrt(
  branchStats.reduce((s, b) => {
    const prime = ((b.cogs + b.labour) / b.netSales) * 100;
    return s + (prime - meanPrime) ** 2;
  }, 0) / branchStats.length,
);

export const branchRanking: BranchRankingRow[] = branchStats
  .map((stats) => {
    const branch = branches.find((b) => b.id === stats.branchId)!;
    const brand = brandById.get(branch.brandId)!;
    const foodCostPercent = (stats.cogs / stats.netSales) * 100;
    const labourCostPercent = (stats.labour / stats.netSales) * 100;
    const primeCostPercent = foodCostPercent + labourCostPercent;

    return {
      branchId: branch.id,
      branchName: branch.name,
      brandName: brand.name,
      netSales: EGP(stats.netSales),
      transactionCount: stats.transactions,
      averageOrderValue: EGP(stats.netSales / Math.max(1, stats.transactions)),
      foodCostPercent: Math.round(foodCostPercent * 10) / 10,
      labourCostPercent: Math.round(labourCostPercent * 10) / 10,
      primeCostPercent: Math.round(primeCostPercent * 10) / 10,
      wastePercent: Math.round((stats.waste / stats.netSales) * 1000) / 10,
      varianceValue: EGP(stats.varianceValue),
      rank: 0,
      previousRank: 0,
      outlierSigma:
        sdPrime === 0 ? 0 : Math.round(((primeCostPercent - meanPrime) / sdPrime) * 10) / 10,
    } satisfies BranchRankingRow;
  })
  .sort((a, b) => b.netSales.amount - a.netSales.amount)
  .map((row, i) => ({
    ...row,
    rank: i + 1,
    previousRank: Math.max(1, Math.min(branches.length, i + 1 + pick(rng, [-2, -1, 0, 0, 1, 2]))),
  }));

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const totalNetSales = branchStats.reduce((s, b) => s + b.netSales, 0);
const totalCogs = branchStats.reduce((s, b) => s + b.cogs, 0);
const totalLabour = branchStats.reduce((s, b) => s + b.labour, 0);
const totalWaste = branchStats.reduce((s, b) => s + b.waste, 0);
const totalTransactions = branchStats.reduce((s, b) => s + b.transactions, 0);
const totalExpenses = expenses
  .filter((e) => e.status === "posted" || e.status === "approved")
  .reduce((s, e) => s + e.amount.amount, 0);

const foodCostPct = (totalCogs / totalNetSales) * 100;
const labourPct = (totalLabour / totalNetSales) * 100;

const salesTrend: TrendPoint[] = lastNDates(14).map((date, i) => {
  const weekday = new Date(date).getUTCDay();
  // Thursday and Friday carry the week in this market.
  const weekendLift = weekday === 4 || weekday === 5 ? 1.32 : weekday === 6 ? 1.14 : 1;
  const base = (totalNetSales / 7) * weekendLift * (1 + gaussian(rng, 0, 0.07));
  return {
    label: date,
    value: Math.round(base / 100),
    comparison: Math.round((base * (1 + gaussian(rng, -0.03, 0.06))) / 100),
  };
});

const HOURS = [
  "08", "09", "10", "11", "12", "13", "14", "15",
  "16", "17", "18", "19", "20", "21", "22", "23",
];

// A double-humped service curve: lunch rush, then a bigger dinner rush.
const HOUR_WEIGHTS = [
  0.018, 0.024, 0.032, 0.045, 0.072, 0.104, 0.098, 0.062,
  0.048, 0.052, 0.068, 0.092, 0.114, 0.096, 0.052, 0.023,
];

const dayNetSales = totalNetSales / 7;

const hourly: HourlySalesPoint[] = HOURS.map((hour, i) => {
  const weight = HOUR_WEIGHTS[i]!;
  const sales = dayNetSales * weight * (1 + gaussian(rng, 0, 0.05));
  // Labour is far flatter than sales — which is exactly the point of the
  // overlay in FR-CST-032.
  const labourWeight = 0.045 + weight * 0.35;
  return {
    hour: `${hour}:00`,
    sales: Math.round(sales / 100),
    labourCost: Math.round(((dayNetSales * labourPct) / 100) * labourWeight / 100),
    orders: Math.round((totalTransactions / 7) * weight),
    forecast: Math.round((dayNetSales * weight * (1 + gaussian(rng, 0.02, 0.03))) / 100),
  };
});

const categoryMix: TrendPoint[] = menuCategories
  .map((category, i) => ({
    label: category.name.en,
    value: Math.round((dayNetSales * (0.2 - i * 0.012) * (1 + gaussian(rng, 0, 0.2))) / 100),
  }))
  .filter((p) => p.value > 0)
  .sort((a, b) => b.value - a.value)
  .slice(0, 8);

const wasteByReasonMap = new Map<string, number>();
for (const record of wasteRecords) {
  wasteByReasonMap.set(
    record.reasonName.en,
    (wasteByReasonMap.get(record.reasonName.en) ?? 0) + record.value.amount,
  );
}

const wasteByReason: TrendPoint[] = [...wasteByReasonMap.entries()]
  .map(([label, value]) => ({ label, value: Math.round(value / 100) }))
  .sort((a, b) => b.value - a.value)
  .slice(0, 8);

const grossSales = totalNetSales * 1.09;
const discounts = totalNetSales * 0.045;
const refunds = totalNetSales * 0.018;
const grossProfit = totalNetSales - totalCogs;

const occupiedTables = tables.filter(
  (t) => t.state !== "available" && t.state !== "needs_cleaning",
).length;

const activeTerminals = terminals.filter((t) => t.status === "online").length;
const offlineTerminals = terminals.filter((t) => t.status === "offline").length;

export const dashboard: DashboardData = {
  businessDay: BUSINESS_DAY,
  generatedAt: NOW_ISO,
  currency: "EGP",
  netSales: metric(totalNetSales, totalNetSales * 0.94, totalNetSales * 1.05, true),
  transactions: metric(totalTransactions, Math.round(totalTransactions * 0.97), null, true),
  averageOrderValue: metric(
    totalNetSales / totalTransactions,
    (totalNetSales * 0.94) / (totalTransactions * 0.97),
    null,
    true,
  ),
  foodCostPercent: metric(
    Math.round(foodCostPct * 10) / 10,
    Math.round((foodCostPct - 0.8) * 10) / 10,
    31,
    false,
  ),
  labourCostPercent: metric(
    Math.round(labourPct * 10) / 10,
    Math.round((labourPct + 0.4) * 10) / 10,
    22,
    false,
  ),
  primeCostPercent: metric(
    Math.round((foodCostPct + labourPct) * 10) / 10,
    Math.round((foodCostPct + labourPct - 0.4) * 10) / 10,
    // §13.5 — above ~65% is a warning, above 70% the business cannot cover rent.
    65,
    false,
  ),
  wastePercent: metric(
    Math.round((totalWaste / totalNetSales) * 1000) / 10,
    Math.round((totalWaste / totalNetSales) * 1000) / 10 + 0.3,
    2,
    false,
  ),
  grossProfit: metric(grossProfit, grossProfit * 0.93, null, true),
  salesTrend,
  hourly,
  categoryMix,
  branchRanking,
  wasteByReason,
  profitability: {
    grossSales: EGP(grossSales),
    discounts: EGP(discounts),
    refunds: EGP(refunds),
    netSales: EGP(totalNetSales),
    cogs: EGP(totalCogs),
    grossProfit: EGP(grossProfit),
    labourCost: EGP(totalLabour),
    contributionAfterLabour: EGP(grossProfit - totalLabour),
    operatingExpenses: EGP(totalExpenses),
    operatingProfit: EGP(grossProfit - totalLabour - totalExpenses),
  },
  alerts: operationalAlerts,
  live: {
    openOrders: openOrders.length,
    tablesOccupied: occupiedTables,
    tablesTotal: tables.length,
    kitchenQueueDepth: kitchenTickets.filter((t) => t.state !== "bumped").length,
    averageWaitSeconds:
      kitchenTickets.length === 0
        ? 0
        : Math.round(
            kitchenTickets.reduce((s, t) => s + t.elapsedSeconds, 0) / kitchenTickets.length,
          ),
    activeTerminals,
    totalTerminals: terminals.length,
    offlineTerminals,
    staffOnShift: attendanceRecords.filter((a) => a.date === BUSINESS_DAY && !a.clockOut).length,
    delayedTickets: delayedTickets.length,
    syncBacklog: terminals.reduce((s, t) => s + t.queuedOperations, 0),
  },
};

// ---------------------------------------------------------------------------
// Food cost — SRS FR-CST-003/004
// ---------------------------------------------------------------------------

function foodCostRow(
  key: string,
  label: Localised,
  netSales: number,
  cogs: number,
  target: number,
): FoodCostRow {
  const pct = (cogs / netSales) * 100;
  return {
    key,
    label,
    netSales: EGP(netSales),
    cogs: EGP(cogs),
    foodCostPercent: Math.round(pct * 10) / 10,
    targetPercent: target,
    variancePoints: Math.round((pct - target) * 10) / 10,
  };
}

export const foodCostByBranch: FoodCostRow[] = branchStats.map((stats) => {
  const branch = branches.find((b) => b.id === stats.branchId)!;
  return foodCostRow(branch.id, branch.name, stats.netSales, stats.cogs, 31);
});

export const foodCostByCategory: FoodCostRow[] = menuCategories.map((category, i) => {
  const share = 0.19 - i * 0.011;
  const netSales = totalNetSales * Math.max(0.02, share);
  // Proteins run hot; drinks run cold. That spread is the whole diagnosis.
  const targetByCategory = category.name.en === "Hot drinks" || category.name.en === "Cold drinks" ? 21 : 33;
  const actual = targetByCategory + gaussian(rng, 1.4, 3.2);
  return foodCostRow(
    category.id,
    category.name,
    netSales,
    netSales * (actual / 100),
    targetByCategory,
  );
});

export const foodCostByBrand: FoodCostRow[] = [...brandById.values()].map((brand) => {
  const brandBranches = branches.filter((b) => b.brandId === brand.id);
  const stats = brandBranches
    .map((b) => statsByBranch.get(b.id)!)
    .filter(Boolean);
  const netSales = stats.reduce((s, b) => s + b.netSales, 0) || 1;
  const cogs = stats.reduce((s, b) => s + b.cogs, 0);
  return foodCostRow(brand.id, brand.name, netSales, cogs, 31);
});

// ---------------------------------------------------------------------------
// Theoretical vs actual — SRS FR-CST-010..015
// ---------------------------------------------------------------------------

const VARIANCE_HYPOTHESES: { test: (row: Omit<VarianceRow, "hypothesis">) => boolean; text: Localised }[] = [
  {
    test: (r) => r.unexplainedQty > 0 && r.variancePercent > 12,
    text: {
      en: "Variance concentrated in one shift pattern — portion control or unrecorded consumption.",
      ar: "الفروقات متركزة في نمط وردية واحد — ضبط الحصص أو استهلاك غير مسجل.",
    },
  },
  {
    test: (r) => r.unexplainedQty > 0 && r.varianceValue.amount > 150_000,
    text: {
      en: "High variance on a high-value item only. Warrants a targeted count at shift handover.",
      ar: "فروقات مرتفعة على صنف عالي القيمة فقط. يستدعي جردًا موجهًا عند تسليم الوردية.",
    },
  },
  {
    test: (r) => r.variancePercent > 4 && r.variancePercent <= 12,
    text: {
      en: "Consistent positive variance across shifts — the recipe likely understates the actual portion.",
      ar: "فروقات موجبة ثابتة عبر الورديات — الوصفة على الأرجح تقلّل الحصة الفعلية.",
    },
  },
  {
    test: (r) => r.variancePercent < -4,
    text: {
      en: "Used less than theoretical. Under-portioning, or a goods receipt that was never entered.",
      ar: "استهلاك أقل من النظري. تقليل الحصص، أو استلام بضائع لم يُسجَّل.",
    },
  },
];

export const varianceRows: VarianceRow[] = stockItems
  .filter((_, i) => i % 2 === 0)
  .map((stockItem) => {
    const theoretical = int(rng, 40, 2_400);
    const drift = gaussian(rng, 0.028, 0.055);
    const actual = Math.max(0, Math.round(theoretical * (1 + drift)));
    const varianceQty = actual - theoretical;
    const recordedWaste = Math.max(0, Math.round(varianceQty * float(rng, 0.05, 0.7, 2)));
    const unexplained = varianceQty - recordedWaste;

    const base = {
      itemId: stockItem.id,
      itemName: stockItem.name,
      sku: stockItem.sku,
      category: stockItem.category,
      unit: stockItem.baseUnit,
      theoreticalUsage: theoretical,
      actualUsage: actual,
      varianceQty,
      recordedWasteQty: recordedWaste,
      unexplainedQty: unexplained,
      varianceValue: EGP(varianceQty * stockItem.unitCost.amount),
      variancePercent:
        theoretical === 0 ? 0 : Math.round((varianceQty / theoretical) * 1000) / 10,
    };

    return {
      ...base,
      hypothesis: VARIANCE_HYPOTHESES.find((h) => h.test(base))?.text ?? null,
    } satisfies VarianceRow;
  })
  // FR-CST-014 — sorted by value descending, so the beef appears above the flour.
  .sort((a, b) => Math.abs(b.varianceValue.amount) - Math.abs(a.varianceValue.amount));

// ---------------------------------------------------------------------------
// Waste analysis — SRS FR-CST-020..023
// ---------------------------------------------------------------------------

function groupWaste(
  keyOf: (r: (typeof wasteRecords)[number]) => { key: string; label: Localised; trueWaste: boolean },
): WasteAnalysisRow[] {
  const map = new Map<string, WasteAnalysisRow>();
  for (const record of wasteRecords) {
    const { key, label, trueWaste } = keyOf(record);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += Number(record.quantity.value);
      existing.value = EGP(existing.value.amount + record.value.amount);
      existing.recordCount += 1;
    } else {
      map.set(key, {
        key,
        label,
        quantity: Number(record.quantity.value),
        value: EGP(record.value.amount),
        percentOfCogs: 0,
        recordCount: 1,
        isTrueWaste: trueWaste,
      });
    }
  }
  const rows = [...map.values()];
  for (const row of rows) {
    row.quantity = Math.round(row.quantity * 100) / 100;
    row.percentOfCogs = Math.round((row.value.amount / totalCogs) * 10_000) / 100;
  }
  return rows.sort((a, b) => b.value.amount - a.value.amount);
}

export const wasteByReasonRows = groupWaste((r) => ({
  key: r.reasonCode,
  label: r.reasonName,
  trueWaste: r.isTrueWaste,
}));

export const wasteByItemRows = groupWaste((r) => ({
  key: r.itemId,
  label: r.itemName,
  trueWaste: r.isTrueWaste,
})).slice(0, 30);

export const wasteByLocationRows = groupWaste((r) => ({
  key: r.locationId,
  label: r.locationName,
  trueWaste: r.isTrueWaste,
}));

export const wasteByEmployeeRows = groupWaste((r) => ({
  key: r.recordedBy,
  label: r.recordedByName,
  trueWaste: r.isTrueWaste,
})).slice(0, 20);

/** FR-CST-023 — waste reframed as the sales needed to recover it. */
export const wasteTotals = (() => {
  const trueWaste = wasteRecords
    .filter((r) => r.isTrueWaste)
    .reduce((s, r) => s + r.value.amount, 0);
  const controlled = wasteRecords
    .filter((r) => !r.isTrueWaste)
    .reduce((s, r) => s + r.value.amount, 0);
  const averageMarginPercent = 100 - foodCostPct;
  return {
    trueWaste: EGP(trueWaste),
    controlledConsumption: EGP(controlled),
    percentOfCogs: Math.round((trueWaste / totalCogs) * 1000) / 10,
    percentOfNetSales: Math.round((trueWaste / totalNetSales) * 1000) / 10,
    revenueRequiredToOffset: EGP(trueWaste / (averageMarginPercent / 100)),
  };
})();

// ---------------------------------------------------------------------------
// Contribution margin and menu engineering — SRS FR-CST-005, FR-MNU-055
// ---------------------------------------------------------------------------

export const contributionMargin: ContributionMarginRow[] = (() => {
  const rows = menuItems.map((menuItem, i) => {
    const variant = menuItem.variants[0]!;
    const recipe = variant.recipeId ? recipeById.get(variant.recipeId) : undefined;
    const category = menuCategories.find((c) => c.id === menuItem.categoryId)!;

    const sellingExTax = Math.round(variant.basePrice.amount / 1.14);
    const directCost = recipe?.computedCost.amount ?? Math.round(sellingExTax * 0.34);
    const margin = sellingExTax - directCost;
    const unitsSold = Math.max(8, Math.round(600 - i * 11 + gaussian(rng, 0, 90)));

    return {
      itemId: menuItem.id,
      itemName: menuItem.name,
      category: category.name,
      unitsSold,
      sellingPrice: EGP(sellingExTax),
      directCost: EGP(directCost),
      contributionMargin: EGP(margin),
      contributionMarginPercent:
        sellingExTax === 0 ? 0 : Math.round((margin / sellingExTax) * 1000) / 10,
      totalContribution: EGP(margin * unitsSold),
      classification: "dog" as MenuClassification,
    };
  });

  // Boston matrix: popularity and margin, each against the menu average.
  const avgUnits = rows.reduce((s, r) => s + r.unitsSold, 0) / rows.length;
  const avgMargin =
    rows.reduce((s, r) => s + r.contributionMargin.amount, 0) / rows.length;

  for (const row of rows) {
    const popular = row.unitsSold >= avgUnits;
    const profitable = row.contributionMargin.amount >= avgMargin;
    row.classification = popular
      ? profitable ? "star" : "plough_horse"
      : profitable ? "puzzle" : "dog";
  }

  return rows.sort((a, b) => b.totalContribution.amount - a.totalContribution.amount);
})();

// ---------------------------------------------------------------------------
// Channel profitability — SRS FR-CST-007
// ---------------------------------------------------------------------------

/** Aggregator commission is the number that turns a good margin bad. */
const CHANNEL_COMMISSION: Record<string, number> = {
  pos: 0,
  kiosk: 0,
  qr: 0,
  phone: 0,
  api: 0.02,
  aggregator: 0.25,
};

const CHANNEL_PACKAGING: Record<string, number> = {
  pos: 0.004,
  kiosk: 0.008,
  qr: 0.006,
  phone: 0.022,
  api: 0.022,
  aggregator: 0.031,
};

export const channelProfitability: ChannelProfitabilityRow[] = (() => {
  const channels = ["pos", "kiosk", "qr", "phone", "api", "aggregator"] as const;
  return channels
    .map((channel) => {
      const channelOrders = orders.filter(
        (o) => o.channel === channel && o.state === "completed",
      );
      const revenue =
        channelOrders.reduce((s, o) => s + o.subtotal.amount, 0) || int(rng, 200_000, 900_000);
      const cogs =
        channelOrders.reduce((s, o) => s + o.cogsTotal.amount, 0) || Math.round(revenue * 0.33);
      const commission = Math.round(revenue * CHANNEL_COMMISSION[channel]!);
      const packaging = Math.round(revenue * CHANNEL_PACKAGING[channel]!);
      const net = revenue - cogs - commission - packaging;

      return {
        channel,
        revenue: EGP(revenue),
        cogs: EGP(cogs),
        commission: EGP(commission),
        packaging: EGP(packaging),
        netContribution: EGP(net),
        marginPercent: revenue === 0 ? 0 : Math.round((net / revenue) * 1000) / 10,
      } satisfies ChannelProfitabilityRow;
    })
    .sort((a, b) => b.revenue.amount - a.revenue.amount);
})();

// ---------------------------------------------------------------------------
// Per-branch profitability — SRS FR-CST-035
// ---------------------------------------------------------------------------

export const branchProfitability = branches.map((branch) => {
  const stats = statsByBranch.get(branch.id)!;
  const branchExpenses = expenses
    .filter((e) => e.branchId === branch.id && e.status !== "rejected" && e.status !== "draft")
    .reduce((s, e) => s + e.amount.amount, 0);
  const gross = stats.netSales - stats.cogs;

  return {
    branchId: branch.id,
    branchName: branch.name,
    grossSales: EGP(stats.netSales * 1.09),
    discounts: EGP(stats.netSales * 0.045),
    refunds: EGP(stats.netSales * 0.018),
    netSales: EGP(stats.netSales),
    cogs: EGP(stats.cogs),
    grossProfit: EGP(gross),
    labourCost: EGP(stats.labour),
    contributionAfterLabour: EGP(gross - stats.labour),
    operatingExpenses: EGP(branchExpenses),
    operatingProfit: EGP(gross - stats.labour - branchExpenses),
    seats: branch.seats,
    areaSqm: branch.areaSqm,
  };
});

void todayOrders;
void dateAgo;
