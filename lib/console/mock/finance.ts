/**
 * Finance fixtures — cash sessions, expenses and day close. SRS ch.16.
 *
 * Expected cash follows FR-FIN-004 exactly:
 *   float + cash sales + pay-ins − cash refunds − pay-outs − safe drops
 * and variance is counted minus expected (FR-FIN-005).
 */

import type {
  CashSession,
  DayClose,
  DenominationCount,
  Expense,
  Money,
  TaxSummaryRow,
  TenderSummaryRow,
  TenderType,
} from "../types";
import { ACTIVE_TENANT_ID, branches, terminals } from "./org";
import { activeEmployees } from "./workforce";
import { completedOrders, orders } from "./sales";
import { chance, createRng, int, pick, seqId } from "./rng";
import { BUSINESS_DAY, dateAgo, hoursAgo, minutesAgo } from "./clock";

const rng = createRng(0x4f21);
const EGP = (amount: number): Money => ({ amount: Math.round(amount), currency: "EGP" });

/** EGP notes and coins actually in circulation. */
const DENOMINATIONS = [20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 50];

// ---------------------------------------------------------------------------
// Cash sessions — SRS §16.2
// ---------------------------------------------------------------------------

export const cashSessions: CashSession[] = (() => {
  const out: CashSession[] = [];
  let n = 0;

  for (const branch of branches) {
    const branchPos = terminals.filter(
      (t) => t.branchId === branch.id && t.kind === "pos" && t.status !== "revoked",
    );
    const staff = activeEmployees.filter((e) => e.homeBranchId === branch.id);
    if (branchPos.length === 0 || staff.length === 0) continue;

    // Today's open session plus a run of closed ones behind it.
    for (let d = 0; d < 4; d += 1) {
      for (let s = 0; s < Math.min(2, branchPos.length); s += 1) {
        n += 1;
        const terminal = branchPos[s]!;
        const employee = staff[(n + s) % staff.length]!;
        const isToday = d === 0;
        const status: CashSession["status"] = isToday
          ? s === 0
            ? "open"
            : "closing"
          : chance(rng, 0.05)
            ? "force_closed"
            : "closed";

        const openingFloat = pick(rng, [50_000, 100_000, 150_000]);
        const orderCount = int(rng, 24, 130);
        const cashSales = orderCount * int(rng, 4_000, 16_000);
        const cashRefunds = chance(rng, 0.35) ? int(rng, 2_000, 40_000) : 0;
        const payIns = chance(rng, 0.25) ? int(rng, 5_000, 30_000) : 0;
        const payOuts = chance(rng, 0.4) ? int(rng, 3_000, 45_000) : 0;
        const safeDrops = cashSales > 600_000 ? int(rng, 200_000, 500_000) : 0;

        const expected = openingFloat + cashSales + payIns - cashRefunds - payOuts - safeDrops;

        // Most drawers land within a few pounds; a minority do not.
        const drift = chance(rng, 0.7)
          ? int(rng, -300, 300)
          : chance(rng, 0.5)
            ? int(rng, -9_000, -1_500)
            : int(rng, 1_500, 7_000);

        const counted = status === "open" ? null : expected + drift;
        const variance = counted === null ? 0 : counted - expected;

        const denominations: DenominationCount[] =
          counted === null
            ? []
            : (() => {
                let remaining = Math.max(0, counted);
                const rows: DenominationCount[] = [];
                for (const value of DENOMINATIONS) {
                  const count = Math.floor(remaining / value);
                  if (count > 0) {
                    rows.push({ value, count });
                    remaining -= count * value;
                  }
                }
                return rows;
              })();

        out.push({
          id: seqId("csh", n),
          tenantId: ACTIVE_TENANT_ID,
          branchId: branch.id,
          branchName: branch.name,
          drawerId: `drw_${branch.code}_${s + 1}`,
          drawerName: `Drawer ${s + 1}`,
          terminalName: terminal.name,
          employeeId: employee.id,
          employeeName: employee.name,
          status,
          openedAt: isToday ? hoursAgo(int(rng, 3, 8)) : hoursAgo(24 * d + int(rng, 8, 14)),
          closedAt: status === "open" ? null : hoursAgo(24 * d + int(rng, 1, 6)),
          businessDay: isToday ? BUSINESS_DAY : dateAgo(d),
          openingFloat: EGP(openingFloat),
          cashSales: EGP(cashSales),
          cashRefunds: EGP(cashRefunds),
          payIns: EGP(payIns),
          payOuts: EGP(payOuts),
          safeDrops: EGP(safeDrops),
          expectedCash: EGP(expected),
          countedCash: counted === null ? null : EGP(counted),
          variance: EGP(variance),
          // FR-FIN-006 — beyond tolerance needs a reason and an approver.
          varianceApproval:
            Math.abs(variance) > 1_000
              ? status === "open"
                ? "pending"
                : pick(rng, ["approved", "approved", "pending", "rejected"] as const)
              : "not_required",
          denominations,
          orderCount,
        });
      }
    }
  }

  return out.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
})();

export const openCashSessions = cashSessions.filter(
  (s) => s.status === "open" || s.status === "closing",
);

export const varianceSessions = cashSessions.filter(
  (s) => Math.abs(s.variance.amount) > 1_000,
);

// ---------------------------------------------------------------------------
// Expenses — SRS §16.4
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  { en: "Rent", ar: "الإيجار", recurring: true, min: 900_000, max: 4_500_000 },
  { en: "Electricity", ar: "الكهرباء", recurring: true, min: 180_000, max: 900_000 },
  { en: "Water", ar: "المياه", recurring: true, min: 25_000, max: 120_000 },
  { en: "Gas", ar: "الغاز", recurring: true, min: 60_000, max: 340_000 },
  { en: "Internet and telephony", ar: "الإنترنت والهاتف", recurring: true, min: 30_000, max: 90_000 },
  { en: "Equipment maintenance", ar: "صيانة المعدات", recurring: false, min: 40_000, max: 620_000 },
  { en: "Cleaning supplies", ar: "مستلزمات النظافة", recurring: false, min: 15_000, max: 180_000 },
  { en: "Marketing", ar: "التسويق", recurring: false, min: 50_000, max: 1_200_000 },
  { en: "Staff transport", ar: "انتقالات الموظفين", recurring: false, min: 12_000, max: 140_000 },
  { en: "Licences and permits", ar: "الرخص والتصاريح", recurring: false, min: 80_000, max: 700_000 },
];

const PAYMENT_METHODS: Expense["paymentMethod"][] = [
  "petty_cash", "petty_cash", "bank_transfer", "bank_transfer", "card", "on_account",
];

export const expenses: Expense[] = (() => {
  const out: Expense[] = [];
  for (let i = 1; i <= 74; i += 1) {
    const branch = branches[i % branches.length]!;
    const category = EXPENSE_CATEGORIES[(i * 3) % EXPENSE_CATEGORIES.length]!;
    const amount = int(rng, category.min, category.max);
    // FR-FIN-017 — above the threshold, approval is required before posting.
    const needsApproval = amount > 500_000;

    out.push({
      id: seqId("exp", i),
      tenantId: ACTIVE_TENANT_ID,
      branchId: branch.id,
      branchName: branch.name,
      reference: `EXP-${String(3300 + i)}`,
      category: { en: category.en, ar: category.ar },
      description: {
        en: `${category.en} — ${branch.name.en}`,
        ar: `${category.ar} — ${branch.name.ar}`,
      },
      amount: EGP(amount),
      paymentMethod: pick(rng, PAYMENT_METHODS),
      supplierName: chance(rng, 0.4) ? { en: "Utility provider", ar: "مزوّد الخدمة" } : null,
      incurredOn: dateAgo(int(rng, 0, 45)),
      status: needsApproval
        ? pick(rng, ["pending_approval", "approved", "posted", "rejected"] as const)
        : pick(rng, ["posted", "posted", "approved", "draft"] as const),
      recurring: category.recurring,
      hasAttachment: chance(rng, 0.65),
      createdBy: pick(rng, [
        { en: "Amal Saeed", ar: "أمل سعيد" },
        { en: "Nadia Halim", ar: "نادية حليم" },
      ]),
    });
  }
  return out.sort((a, b) => (a.incurredOn < b.incurredOn ? 1 : -1));
})();

// ---------------------------------------------------------------------------
// Day close and Z reports — SRS §16.5
// ---------------------------------------------------------------------------

const TENDERS: TenderType[] = [
  "cash", "card", "wallet", "voucher", "loyalty_points", "aggregator_settled",
];

export const dayCloses: DayClose[] = (() => {
  const out: DayClose[] = [];
  let zCounter = 1840;

  for (let d = 0; d <= 6; d += 1) {
    const businessDay = d === 0 ? BUSINESS_DAY : dateAgo(d);

    for (const branch of branches) {
      const dayOrders = orders.filter(
        (o) => o.branchId === branch.id && o.businessDay === businessDay,
      );
      const settled = dayOrders.filter((o) => o.state === "completed");

      const grossSales = settled.reduce((s, o) => s + o.subtotal.amount, 0) || int(rng, 400_000, 3_200_000);
      const discounts = settled.reduce((s, o) => s + o.discountTotal.amount, 0);
      const refunds = int(rng, 0, Math.round(grossSales * 0.03));
      const taxTotal = settled.reduce((s, o) => s + o.taxTotal.amount, 0) || Math.round(grossSales * 0.1228);
      const netSales = grossSales - discounts - refunds;
      const count = settled.length || int(rng, 40, 260);

      const blocking =
        d === 0
          ? openCashSessions
              .filter((s) => s.branchId === branch.id)
              .map((s) => `${s.drawerName} · ${s.employeeName.en}`)
          : [];

      const status: DayClose["status"] =
        d === 0 ? (blocking.length > 0 ? "blocked" : "open") : "closed";

      // Tender split, weighted the way a MENA branch actually settles.
      const weights = [0.42, 0.34, 0.08, 0.03, 0.02, 0.11];
      const tenders: TenderSummaryRow[] = TENDERS.map((tender, ti) => ({
        tender,
        count: Math.round(count * weights[ti]!),
        amount: EGP(Math.round(netSales * weights[ti]!)),
      }));

      const taxRows: TaxSummaryRow[] = [
        { taxClass: "standard", rate: 14, netAmount: EGP(Math.round(netSales * 0.86)), taxAmount: EGP(taxTotal), grossAmount: EGP(netSales) },
        { taxClass: "zero", rate: 0, netAmount: EGP(Math.round(netSales * 0.03)), taxAmount: EGP(0), grossAmount: EGP(Math.round(netSales * 0.03)) },
      ];

      if (status === "closed") zCounter += 1;

      out.push({
        id: `dcl_${branch.code}_${businessDay}`,
        tenantId: ACTIVE_TENANT_ID,
        branchId: branch.id,
        branchName: branch.name,
        businessDay,
        status,
        zReportNumber: status === "closed" ? zCounter : null,
        closedAt: status === "closed" ? hoursAgo(24 * d + 2) : null,
        closedBy: status === "closed" ? { en: "Amal Saeed", ar: "أمل سعيد" } : null,
        blockingSessions: blocking,
        grossSales: EGP(grossSales),
        discounts: EGP(discounts),
        refunds: EGP(refunds),
        netSales: EGP(netSales),
        taxTotal: EGP(taxTotal),
        transactionCount: count,
        averageOrderValue: EGP(count > 0 ? netSales / count : 0),
        voidCount: int(rng, 0, 14),
        compValue: EGP(int(rng, 0, 60_000)),
        cashVariance: EGP(int(rng, -6_000, 3_000)),
        tenders,
        taxRows,
      });
    }
  }

  return out;
})();

export const todayDayCloses = dayCloses.filter((d) => d.businessDay === BUSINESS_DAY);

/** Tender totals across the whole tenant for the anchor day. */
export const paymentSummary: TenderSummaryRow[] = TENDERS.map((tender) => {
  const rows = todayDayCloses.flatMap((d) => d.tenders.filter((t) => t.tender === tender));
  return {
    tender,
    count: rows.reduce((s, r) => s + r.count, 0),
    amount: EGP(rows.reduce((s, r) => s + r.amount.amount, 0)),
  };
});

export const taxSummary: TaxSummaryRow[] = (() => {
  const classes: TaxSummaryRow["taxClass"][] = ["standard", "reduced", "zero", "exempt"];
  const rates: Record<string, number> = { standard: 14, reduced: 5, zero: 0, exempt: 0 };
  const shares: Record<string, number> = { standard: 0.86, reduced: 0.06, zero: 0.05, exempt: 0.03 };

  const totalNet = todayDayCloses.reduce((s, d) => s + d.netSales.amount, 0);

  return classes.map((taxClass) => {
    const net = Math.round(totalNet * shares[taxClass]!);
    const tax = Math.round(net * (rates[taxClass]! / 100));
    return {
      taxClass,
      rate: rates[taxClass]!,
      netAmount: EGP(net),
      taxAmount: EGP(tax),
      grossAmount: EGP(net + tax),
    };
  });
})();

void completedOrders;
void minutesAgo;
