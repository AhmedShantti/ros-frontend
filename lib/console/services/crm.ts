"use client";

/**
 * Customers, loyalty and promotions — SRS ch.18.
 *
 * This whole domain runs on `localCollection`, which means the screens above
 * it are complete and exercisable today and the swap to a server is a change
 * to this file rather than to any of them. See `lib/console/local-store.ts`
 * for why that seam is shaped the way it is.
 *
 * Two rules from the chapter are enforced here rather than in the UI,
 * because they are properties of the data and a second screen would
 * otherwise re-implement them differently:
 *
 *   - **The loyalty balance is a ledger** (FR-CRM-020). `points` on the
 *     customer is a projection of `loyaltyEntries`, recomputed on every
 *     write. A mutable balance plus offline redemption is a double-spend
 *     waiting to happen, and a number nobody can explain afterwards.
 *   - **Erasure anonymises, it does not delete** (FR-CRM-009). Tax law
 *     requires the transaction; the person is what has to go. So the
 *     identifying fields are replaced with a token and the financial
 *     aggregates stay put.
 */

import type {
  Coupon,
  Customer,
  CustomerSegment,
  Id,
  Localised,
  LoyaltyEntry,
  LoyaltyProgramme,
  Money,
  Promotion,
} from "../types";
import { localCollection, localDocument, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type CollectionService, type ScopedQuery } from "./types";

const tenantOf = () => getActiveTenantId();

function money(amount: number, currency = "EGP"): Money {
  return { amount, currency: currency as Money["currency"] };
}

// ---------------------------------------------------------------------------
// Seed — a handful of customers so the screens are not empty on first run
// ---------------------------------------------------------------------------

function seedCustomer(
  phone: string,
  en: string,
  ar: string,
  overrides: Partial<Customer> = {},
): Customer {
  const now = Date.now();
  return {
    id: localId("cus"),
    tenantId: tenantOf(),
    phone,
    name: { en, ar },
    email: null,
    dateOfBirth: null,
    preferredLanguage: "ar",
    tags: [],
    addresses: [],
    consent: [
      {
        channel: "sms",
        purpose: "transactional",
        granted: true,
        recordedAt: new Date(now - 86_400_000 * 30).toISOString(),
        source: "pos",
      },
    ],
    blocked: false,
    blockedReason: null,
    createdAt: new Date(now - 86_400_000 * 60).toISOString(),
    anonymisedAt: null,
    totalSpend: money(0),
    orderCount: 0,
    averageOrderValue: money(0),
    firstOrderAt: null,
    lastOrderAt: null,
    favouriteItem: null,
    preferredBranchId: null,
    preferredOrderType: null,
    preferredDayPart: null,
    loyaltyPoints: 0,
    loyaltyTier: null,
    stampCount: 0,
    segment: "new",
    ...overrides,
  };
}

function seedCustomers(): Customer[] {
  const day = 86_400_000;
  const now = Date.now();
  return [
    seedCustomer("+201001234567", "Nour Hassan", "نور حسن", {
      email: "nour@example.com",
      totalSpend: money(486_50),
      orderCount: 23,
      averageOrderValue: money(2115),
      firstOrderAt: new Date(now - day * 210).toISOString(),
      lastOrderAt: new Date(now - day * 3).toISOString(),
      favouriteItem: { en: "Chicken shawarma", ar: "شاورما دجاج" },
      loyaltyPoints: 486,
      loyaltyTier: "gold",
      segment: "champion",
      tags: ["regular"],
    }),
    seedCustomer("+201119876543", "Omar Fathy", "عمر فتحي", {
      totalSpend: money(129_00),
      orderCount: 7,
      averageOrderValue: money(1842),
      firstOrderAt: new Date(now - day * 150).toISOString(),
      lastOrderAt: new Date(now - day * 62).toISOString(),
      loyaltyPoints: 129,
      loyaltyTier: "silver",
      segment: "at_risk",
    }),
    seedCustomer("+201225550101", "Layla Mansour", "ليلى منصور", {
      totalSpend: money(52_00),
      orderCount: 2,
      averageOrderValue: money(2600),
      firstOrderAt: new Date(now - day * 12).toISOString(),
      lastOrderAt: new Date(now - day * 5).toISOString(),
      loyaltyPoints: 52,
      segment: "new",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const customersStore = localCollection<Customer>(
  {
    name: "customers",
    idOf: (row) => row.id,
    seed: seedCustomers,
    search: (row) => [row.name, row.phone, row.email, ...row.tags],
    filters: {
      segment: (row) => row.segment,
      blocked: (row) => String(row.blocked),
      tier: (row) => row.loyaltyTier ?? "",
      tag: (row) => row.tags[0] ?? "",
    },
    sorters: {
      name: (row) => row.name.en,
      totalSpend: (row) => row.totalSpend.amount,
      orderCount: (row) => row.orderCount,
      lastOrderAt: (row) => row.lastOrderAt ?? "",
      createdAt: (row) => row.createdAt,
      loyaltyPoints: (row) => row.loyaltyPoints,
    },
    factory: (input, id) => {
      const phone = String(input.phone ?? "").trim();
      if (!phone) {
        throw new ServiceError("VALIDATION", "A phone number is required.", 400);
      }
      return {
        ...seedCustomer(phone, input.name?.en ?? "", input.name?.ar ?? ""),
        ...input,
        id,
        tenantId: tenantOf(),
        phone,
        createdAt: nowIso(),
      } as Customer;
    },
    guardRemove: (row) =>
      row.orderCount > 0
        ? "This customer has order history. Use erase rather than delete, so the financial record survives."
        : null,
  },
  tenantOf,
);

const loyaltyStore = localCollection<LoyaltyEntry>(
  {
    name: "loyalty-entries",
    idOf: (row) => row.id,
    filters: { customerId: (row) => row.customerId, kind: (row) => row.kind },
    sorters: { occurredAt: (row) => row.occurredAt },
  },
  tenantOf,
);

const promotionsStore = localCollection<Promotion>(
  {
    name: "promotions",
    idOf: (row) => row.id,
    search: (row) => [row.name, row.description],
    filters: {
      active: (row) => String(row.active),
      kind: (row) => row.kind,
      effect: (row) => row.effect.type,
    },
    sorters: {
      name: (row) => row.name.en,
      priority: (row) => row.priority,
      redemptions: (row) => row.redemptions,
      startsOn: (row) => row.startsOn ?? "",
    },
    factory: (input, id) => ({
      id,
      tenantId: tenantOf(),
      name: input.name ?? { en: "", ar: "" },
      description: input.description ?? { en: "", ar: "" },
      kind: input.kind ?? "promotion",
      conditions: {
        startsAt: null,
        endsAt: null,
        daysOfWeek: [],
        branchIds: [],
        orderTypes: [],
        channels: [],
        minimumOrderMinor: null,
        itemIds: [],
        categoryIds: [],
        stockItemIds: [],
        minimumQuantity: null,
        customerTags: [],
        customerTiers: [],
        firstOrderOnly: false,
        nthOrder: null,
        requiresCoupon: false,
        ...input.conditions,
      },
      effect: {
        type: "percent_off_order",
        value: 10,
        targetItemId: null,
        buyQuantity: null,
        getQuantity: null,
        ...input.effect,
      },
      usage: {
        totalRedemptions: null,
        perCustomer: null,
        perDay: null,
        ...input.usage,
      },
      stackable: input.stackable ?? false,
      priority: input.priority ?? 100,
      active: input.active ?? false,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      createdAt: nowIso(),
      redemptions: 0,
      discountCost: money(0),
      attributedRevenue: money(0),
    }),
  },
  tenantOf,
);

const couponsStore = localCollection<Coupon>(
  {
    name: "coupons",
    idOf: (row) => row.id,
    search: (row) => [row.code],
    filters: { promotionId: (row) => row.promotionId, active: (row) => String(row.active) },
    sorters: { code: (row) => row.code, createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      tenantId: tenantOf(),
      promotionId: input.promotionId ?? "",
      code: input.code ?? generateCode(),
      singleUse: input.singleUse ?? true,
      redeemedCount: 0,
      maxRedemptions: input.maxRedemptions ?? null,
      customerId: input.customerId ?? null,
      expiresOn: input.expiresOn ?? null,
      active: input.active ?? true,
      createdAt: nowIso(),
    }),
  },
  tenantOf,
);

const DEFAULT_PROGRAMME: LoyaltyProgramme = {
  enabled: true,
  model: "points",
  earnRatePerUnit: 1,
  redeemValueMinor: 1,
  expiryMonths: 12,
  excludeDiscountedLines: true,
  excludeTax: true,
  offlineRedemptionCapMinor: 20_000,
  stampsRequired: 10,
  stampItemIds: [],
  tiers: [
    { id: "bronze", name: { en: "Bronze", ar: "برونزي" }, thresholdPoints: 0, benefits: { en: "Earn 1 point per unit spent.", ar: "نقطة لكل وحدة إنفاق." }, colour: "#b45309" },
    { id: "silver", name: { en: "Silver", ar: "فضي" }, thresholdPoints: 100, benefits: { en: "Priority service and a birthday reward.", ar: "خدمة ذات أولوية ومكافأة عيد ميلاد." }, colour: "#64748b" },
    { id: "gold", name: { en: "Gold", ar: "ذهبي" }, thresholdPoints: 400, benefits: { en: "Free delivery and double points at weekends.", ar: "توصيل مجاني ونقاط مضاعفة في عطلة نهاية الأسبوع." }, colour: "#ca8a04" },
  ],
};

const programmeDoc = localDocument<LoyaltyProgramme>(
  "loyalty-programme",
  () => DEFAULT_PROGRAMME,
  tenantOf,
);

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Segmentation — FR-CRM-035, FR-CRM-036
// ---------------------------------------------------------------------------

/**
 * RFM, computed against this customer's own history rather than a global
 * threshold.
 *
 * FR-CRM-036 is explicit about the churn signal: someone who orders weekly
 * and has not been seen for a month is at risk; someone who orders twice a
 * year and has not been seen for a month is simply between visits. A fixed
 * "60 days" threshold calls the second one churned and is wrong about most
 * of the book.
 */
export function segmentOf(customer: Customer, now = Date.now()): CustomerSegment {
  if (!customer.lastOrderAt || customer.orderCount === 0) return "unclassified";

  const daysSince = (now - Date.parse(customer.lastOrderAt)) / 86_400_000;
  const lifespanDays = customer.firstOrderAt
    ? Math.max(1, (Date.parse(customer.lastOrderAt) - Date.parse(customer.firstOrderAt)) / 86_400_000)
    : 1;
  const meanInterval = lifespanDays / Math.max(1, customer.orderCount - 1);

  const overdue = daysSince / Math.max(1, meanInterval);
  const highValue = customer.totalSpend.amount >= 30_000;
  const frequent = customer.orderCount >= 10;

  if (customer.orderCount <= 2 && daysSince < 45) return "new";
  if (overdue > 4) return "hibernating";
  if (overdue > 2) return "at_risk";
  if (frequent && highValue) return "champion";
  if (frequent || highValue) return "loyal";
  return "new";
}

/** How overdue this customer is against their own rhythm, 0–1+. */
export function churnRiskOf(customer: Customer, now = Date.now()): number | null {
  if (!customer.lastOrderAt || !customer.firstOrderAt || customer.orderCount < 2) return null;
  const daysSince = (now - Date.parse(customer.lastOrderAt)) / 86_400_000;
  const lifespanDays = Math.max(
    1,
    (Date.parse(customer.lastOrderAt) - Date.parse(customer.firstOrderAt)) / 86_400_000,
  );
  const meanInterval = lifespanDays / (customer.orderCount - 1);
  return Math.min(2, daysSince / Math.max(1, meanInterval)) / 2;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface CrmService {
  customers: CollectionService<Customer> & {
    /** FR-CRM-002 — the till looks a customer up by phone, not by id. */
    findByPhone(phone: string): Promise<Customer | null>;
    /** FR-CRM-003 — phone plus name, and nothing else, in under 15 seconds. */
    quickCreate(input: { phone: string; name: string }): Promise<Customer>;
    /** FR-CRM-007 — block or unblock, with a reason on the record. */
    setBlocked(id: Id, blocked: boolean, reason: string | null): Promise<Customer>;
    /** FR-CRM-009 — anonymise, keeping the transactional history intact. */
    erase(id: Id): Promise<Customer>;
    /** FR-CRM-009 — everything held about one person, for a subject request. */
    exportOne(id: Id): Promise<{ customer: Customer; loyalty: LoyaltyEntry[] }>;
  };

  loyalty: {
    programme(): Promise<LoyaltyProgramme>;
    saveProgramme(next: LoyaltyProgramme): Promise<LoyaltyProgramme>;
    ledger(customerId: Id): Promise<LoyaltyEntry[]>;
    /** Append to the ledger and re-project the balance. */
    post(input: {
      customerId: Id;
      kind: LoyaltyEntry["kind"];
      points: number;
      reason: string;
      orderId?: Id | null;
      offlineCapture?: boolean;
    }): Promise<LoyaltyEntry>;
  };

  promotions: CollectionService<Promotion>;

  coupons: CollectionService<Coupon> & {
    /** FR-CRM-028 — bulk generation, each code tracked separately. */
    generate(promotionId: Id, count: number, options?: { singleUse?: boolean; expiresOn?: string }): Promise<Coupon[]>;
    /** Look a code up at the till. */
    findByCode(code: string): Promise<Coupon | null>;
  };

  /** FR-CRM-035 — segment counts and value, for the analytics screen. */
  segments(): Promise<
    { segment: CustomerSegment; count: number; value: Money; customers: Customer[] }[]
  >;
}

export const crmService: CrmService = {
  customers: {
    ...customersStore,

    async list(query: ScopedQuery = {}) {
      const page = await customersStore.list(query);
      // Segment is derived, never stored, so it cannot drift out of date
      // while the customer keeps shopping.
      return { ...page, rows: page.rows.map((row) => ({ ...row, segment: segmentOf(row) })) };
    },

    async get(id: Id) {
      const row = await customersStore.get(id);
      return row ? { ...row, segment: segmentOf(row) } : null;
    },

    async findByPhone(phone: string) {
      const normalised = phone.replace(/[^\d+]/g, "");
      const all = await customersStore.all();
      return all.find((row) => row.phone.replace(/[^\d+]/g, "") === normalised) ?? null;
    },

    async quickCreate(input) {
      const existing = await crmService.customers.findByPhone(input.phone);
      if (existing) {
        throw new ServiceError(
          "CONFLICT",
          "A customer already uses that phone number.",
          409,
          existing.id,
        );
      }
      const name: Localised = { en: input.name, ar: input.name };
      return customersStore.create({ phone: input.phone, name });
    },

    async setBlocked(id, blocked, reason) {
      return customersStore.update(id, {
        blocked,
        blockedReason: blocked ? reason : null,
      });
    },

    async erase(id) {
      const row = await customersStore.get(id);
      if (!row) throw new ServiceError("NOT_FOUND", "That customer no longer exists.", 404);

      // The order history stays; the person does not. Replacing rather than
      // deleting is what keeps the financial record referentially intact,
      // which tax law requires and an erasure request does not override.
      const token = `erased-${row.id.slice(-6)}`;
      return customersStore.update(id, {
        phone: token,
        name: { en: token, ar: token },
        email: null,
        dateOfBirth: null,
        addresses: [],
        consent: [],
        tags: [],
        anonymisedAt: nowIso(),
      });
    },

    async exportOne(id) {
      const customer = await customersStore.get(id);
      if (!customer) throw new ServiceError("NOT_FOUND", "That customer no longer exists.", 404);
      const loyalty = await crmService.loyalty.ledger(id);
      return { customer, loyalty };
    },
  },

  loyalty: {
    async programme() {
      return programmeDoc.read();
    },

    async saveProgramme(next) {
      programmeDoc.write(next);
      return next;
    },

    async ledger(customerId) {
      const all = await loyaltyStore.all();
      return all
        .filter((row) => row.customerId === customerId)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async post(input) {
      const ledger = await crmService.loyalty.ledger(input.customerId);
      const balance = ledger[0]?.balanceAfter ?? 0;
      const delta =
        input.kind === "redeem" || input.kind === "expire"
          ? -Math.abs(input.points)
          : input.points;
      const balanceAfter = balance + delta;

      if (balanceAfter < 0) {
        throw new ServiceError(
          "CONFLICT",
          "That would take the balance below zero.",
          409,
          `Balance is ${balance} points.`,
        );
      }

      const entry = await loyaltyStore.create({
        customerId: input.customerId,
        kind: input.kind,
        points: delta,
        balanceAfter,
        orderId: input.orderId ?? null,
        reason: input.reason,
        occurredAt: nowIso(),
        offlineCapture: input.offlineCapture ?? false,
      } as Partial<LoyaltyEntry>);

      // The customer's `loyaltyPoints` is a projection of the ledger, so it
      // is written from the ledger and never incremented independently.
      const programme = programmeDoc.read();
      const tier = [...programme.tiers]
        .sort((a, b) => b.thresholdPoints - a.thresholdPoints)
        .find((candidate) => balanceAfter >= candidate.thresholdPoints);

      await customersStore.update(input.customerId, {
        loyaltyPoints: balanceAfter,
        loyaltyTier: tier?.id ?? null,
      });

      return { ...entry, points: delta, balanceAfter };
    },
  },

  promotions: promotionsStore,

  coupons: {
    ...couponsStore,

    async generate(promotionId, count, options) {
      const made: Coupon[] = [];
      const capped = Math.min(Math.max(1, count), 500);
      for (let i = 0; i < capped; i += 1) {
        made.push(
          await couponsStore.create({
            promotionId,
            code: generateCode(),
            singleUse: options?.singleUse ?? true,
            expiresOn: options?.expiresOn ?? null,
          }),
        );
      }
      return made;
    },

    async findByCode(code) {
      const all = await couponsStore.all();
      const needle = code.trim().toUpperCase();
      return all.find((row) => row.code.toUpperCase() === needle) ?? null;
    },
  },

  async segments() {
    const all = await customersStore.all();
    const buckets = new Map<CustomerSegment, Customer[]>();

    for (const row of all) {
      const segment = segmentOf(row);
      buckets.set(segment, [...(buckets.get(segment) ?? []), { ...row, segment }]);
    }

    const order: CustomerSegment[] = [
      "champion",
      "loyal",
      "at_risk",
      "hibernating",
      "new",
      "unclassified",
    ];

    return order.map((segment) => {
      const customers = buckets.get(segment) ?? [];
      return {
        segment,
        count: customers.length,
        value: money(customers.reduce((sum, row) => sum + row.totalSpend.amount, 0)),
        customers,
      };
    });
  },
};

/** Loyalty entries for a fresh browser, so the ledger is not blank. */
export function seedLoyaltyFor(customers: Customer[]): void {
  const existing = loyaltyStore.peek();
  if (existing.length > 0) return;

  const entries: LoyaltyEntry[] = [];
  for (const customer of customers) {
    if (customer.loyaltyPoints <= 0) continue;
    entries.push({
      id: localId("loy"),
      customerId: customer.id,
      kind: "earn",
      points: customer.loyaltyPoints,
      balanceAfter: customer.loyaltyPoints,
      orderId: null,
      reason: "Historic balance carried in",
      occurredAt: customer.lastOrderAt ?? nowIso(),
      offlineCapture: false,
    });
  }
  if (entries.length > 0) void loyaltyStore.replace(entries);
}
