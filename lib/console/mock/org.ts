/**
 * Organisation fixtures — tenants, brands, branches, stock locations,
 * terminals, stations and tables. SRS ch.6 and ch.17.
 */

import type {
  Branch,
  Brand,
  CentralKitchen,
  RestaurantTable,
  Station,
  StationType,
  StockLocation,
  TableState,
  Tenant,
  Terminal,
  TerminalStatus,
  Warehouse,
} from "../types";
import { createRng, chance, int, pick, seqId } from "./rng";
import { minutesAgo } from "./clock";

const rng = createRng(0x1205);

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const tenants: Tenant[] = [
  {
    id: "tnt_0001",
    name: { en: "Levant Hospitality Group", ar: "مجموعة الشام للضيافة" },
    slug: "levant-hospitality",
    state: "active",
    plan: "enterprise",
    countryCode: "EG",
    baseCurrency: "EGP",
    region: "eu-south-1 (EG)",
    brandCount: 4,
    branchCount: 12,
    createdAt: "2024-03-11T08:00:00.000Z",
  },
  {
    id: "tnt_0002",
    name: { en: "Najd Foods", ar: "أطعمة نجد" },
    slug: "najd-foods",
    state: "active",
    plan: "professional",
    countryCode: "SA",
    baseCurrency: "SAR",
    region: "me-central-1 (SA)",
    brandCount: 2,
    branchCount: 7,
    createdAt: "2025-01-22T08:00:00.000Z",
  },
  {
    id: "tnt_0003",
    name: { en: "Gulf Culinary Concepts", ar: "مفاهيم الخليج للطهي" },
    slug: "gulf-culinary",
    state: "trial",
    plan: "starter",
    countryCode: "AE",
    baseCurrency: "AED",
    region: "me-central-1 (AE)",
    brandCount: 1,
    branchCount: 2,
    createdAt: "2026-07-19T08:00:00.000Z",
  },
  {
    id: "tnt_0004",
    name: { en: "Cairo Bakehouse", ar: "مخبز القاهرة" },
    slug: "cairo-bakehouse",
    state: "past_due",
    plan: "starter",
    countryCode: "EG",
    baseCurrency: "EGP",
    region: "eu-south-1 (EG)",
    brandCount: 1,
    branchCount: 3,
    createdAt: "2025-09-04T08:00:00.000Z",
  },
];

/** The tenant the console is signed into. */
export const ACTIVE_TENANT_ID = "tnt_0001";

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export const brands: Brand[] = [
  {
    id: "brd_0001",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Shawarma House", ar: "بيت الشاورما" },
    code: "SWH",
    colour: "#c1553a",
    branchCount: 5,
    active: true,
  },
  {
    id: "brd_0002",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Bella Pasta", ar: "بيلا باستا" },
    code: "BLP",
    colour: "#6b8a45",
    branchCount: 3,
    active: true,
  },
  {
    id: "brd_0003",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Kaif Coffee", ar: "قهوة كيف" },
    code: "KFC",
    colour: "#d98d1f",
    branchCount: 3,
    active: true,
  },
  {
    id: "brd_0004",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Cloud Wings", ar: "كلاود وينجز" },
    code: "CLW",
    colour: "#8a4a63",
    branchCount: 1,
    active: true,
  },
];

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

interface BranchSeed {
  brandIndex: number;
  en: string;
  ar: string;
  code: string;
  seats: number;
  area: number;
  openedAt: string;
  franchise?: boolean;
  address: string;
}

const branchSeeds: BranchSeed[] = [
  { brandIndex: 0, en: "Downtown", ar: "وسط البلد", code: "SWH-DTN", seats: 64, area: 180, openedAt: "2021-04-02", address: "26 Talaat Harb St, Cairo" },
  { brandIndex: 0, en: "Nasr City", ar: "مدينة نصر", code: "SWH-NSR", seats: 48, area: 140, openedAt: "2022-01-18", address: "Abbas El Akkad, Cairo" },
  { brandIndex: 0, en: "Maadi", ar: "المعادي", code: "SWH-MAD", seats: 40, area: 120, openedAt: "2022-11-05", address: "Road 9, Maadi, Cairo" },
  { brandIndex: 0, en: "Alexandria Corniche", ar: "كورنيش الإسكندرية", code: "SWH-ALX", seats: 72, area: 210, openedAt: "2023-06-21", address: "Corniche Rd, Alexandria" },
  { brandIndex: 0, en: "Zamalek", ar: "الزمالك", code: "SWH-ZML", seats: 32, area: 95, openedAt: "2026-02-14", franchise: true, address: "Brazil St, Zamalek, Cairo" },
  { brandIndex: 1, en: "New Cairo", ar: "القاهرة الجديدة", code: "BLP-NCR", seats: 88, area: 240, openedAt: "2021-09-30", address: "90th St, New Cairo" },
  { brandIndex: 1, en: "Sheikh Zayed", ar: "الشيخ زايد", code: "BLP-SHZ", seats: 76, area: 220, openedAt: "2022-05-12", address: "Arkan Plaza, Sheikh Zayed" },
  { brandIndex: 1, en: "Heliopolis", ar: "مصر الجديدة", code: "BLP-HLP", seats: 54, area: 165, openedAt: "2024-03-08", address: "Baghdad St, Heliopolis" },
  { brandIndex: 2, en: "Garden City", ar: "جاردن سيتي", code: "KFC-GDC", seats: 28, area: 78, openedAt: "2023-02-01", address: "Kasr El Aini, Cairo" },
  { brandIndex: 2, en: "Mall of Egypt", ar: "مول مصر", code: "KFC-MOE", seats: 36, area: 92, openedAt: "2023-10-19", address: "Mall of Egypt, 6th October" },
  { brandIndex: 2, en: "Smart Village", ar: "القرية الذكية", code: "KFC-SMV", seats: 22, area: 64, openedAt: "2025-04-27", address: "Smart Village, Giza" },
  { brandIndex: 3, en: "Obour Cloud Kitchen", ar: "مطبخ العبور السحابي", code: "CLW-OBR", seats: 0, area: 110, openedAt: "2024-08-15", address: "Industrial Zone, Obour City" },
];

export const branches: Branch[] = branchSeeds.map((seed, i) => ({
  id: seqId("brn", i + 1),
  tenantId: ACTIVE_TENANT_ID,
  brandId: brands[seed.brandIndex]!.id,
  name: { en: seed.en, ar: seed.ar },
  code: seed.code,
  countryCode: "EG",
  currency: "EGP",
  timezone: "Africa/Cairo",
  businessDayBoundary: "04:00",
  seats: seed.seats,
  areaSqm: seed.area,
  openedAt: seed.openedAt,
  active: true,
  isFranchise: seed.franchise ?? false,
  address: seed.address,
}));

export const branchById = new Map(branches.map((b) => [b.id, b]));
export const brandById = new Map(brands.map((b) => [b.id, b]));

// ---------------------------------------------------------------------------
// Warehouses and central kitchens
// ---------------------------------------------------------------------------

export const warehouses: Warehouse[] = [
  {
    id: "whs_0001",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Cairo Central Store", ar: "مخزن القاهرة المركزي" },
    code: "WH-CAI",
    attachedBranchId: null,
    countryCode: "EG",
    active: true,
  },
  {
    id: "whs_0002",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Alexandria Dry Store", ar: "مخزن الإسكندرية الجاف" },
    code: "WH-ALX",
    attachedBranchId: "brn_0004",
    countryCode: "EG",
    active: true,
  },
];

export const centralKitchens: CentralKitchen[] = [
  {
    id: "ckn_0001",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Obour Production Facility", ar: "منشأة العبور للإنتاج" },
    code: "CK-OBR",
    countryCode: "EG",
    servesBranchIds: branches.slice(0, 8).map((b) => b.id),
    active: true,
  },
];

/** Every location that can hold stock — SRS BR-PLT-001. */
export const stockLocations: StockLocation[] = [
  ...branches.map<StockLocation>((b) => ({
    id: b.id,
    kind: "branch",
    name: b.name,
    code: b.code,
  })),
  ...warehouses.map<StockLocation>((w) => ({
    id: w.id,
    kind: "warehouse",
    name: w.name,
    code: w.code,
  })),
  ...centralKitchens.map<StockLocation>((c) => ({
    id: c.id,
    kind: "central_kitchen",
    name: c.name,
    code: c.code,
  })),
];

export const locationById = new Map(stockLocations.map((l) => [l.id, l]));

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

const APP_VERSIONS = ["4.2.1", "4.2.1", "4.2.0", "4.1.8"];

export const terminals: Terminal[] = (() => {
  const out: Terminal[] = [];
  let n = 0;
  for (const branch of branches) {
    const posCount = branch.seats > 60 ? 3 : branch.seats > 30 ? 2 : 1;
    const kdsCount = branch.code.startsWith("KFC") ? 1 : 2;

    for (let i = 0; i < posCount; i += 1) {
      n += 1;
      const status: TerminalStatus = chance(rng, 0.88)
        ? "online"
        : chance(rng, 0.6)
          ? "degraded"
          : "offline";
      out.push({
        id: seqId("trm", n),
        tenantId: ACTIVE_TENANT_ID,
        branchId: branch.id,
        name: `${branch.code} POS ${i + 1}`,
        code: `${branch.code}-P${i + 1}`,
        kind: "pos",
        status,
        appVersion: pick(rng, APP_VERSIONS),
        lastSeenAt: minutesAgo(status === "online" ? int(rng, 0, 2) : int(rng, 18, 240)),
        queuedOperations: status === "online" ? int(rng, 0, 12) : int(rng, 40, 620),
        batteryPercent: chance(rng, 0.5) ? int(rng, 22, 100) : null,
        ipAddress: `10.${20 + branches.indexOf(branch)}.4.${10 + i}`,
      });
    }

    for (let i = 0; i < kdsCount; i += 1) {
      n += 1;
      const status: TerminalStatus = chance(rng, 0.92) ? "online" : "offline";
      out.push({
        id: seqId("trm", n),
        tenantId: ACTIVE_TENANT_ID,
        branchId: branch.id,
        name: `${branch.code} KDS ${i + 1}`,
        code: `${branch.code}-K${i + 1}`,
        kind: "kds",
        status,
        appVersion: pick(rng, APP_VERSIONS),
        lastSeenAt: minutesAgo(status === "online" ? int(rng, 0, 2) : int(rng, 30, 180)),
        queuedOperations: status === "online" ? int(rng, 0, 4) : int(rng, 12, 90),
        batteryPercent: null,
        ipAddress: `10.${20 + branches.indexOf(branch)}.5.${10 + i}`,
      });
    }
  }
  // One revoked device, so the terminal screen has the full state range.
  out.push({
    id: seqId("trm", n + 1),
    tenantId: ACTIVE_TENANT_ID,
    branchId: branches[2]!.id,
    name: "SWH-MAD POS 2 (retired)",
    code: "SWH-MAD-P2",
    kind: "pos",
    status: "revoked",
    appVersion: "3.9.4",
    lastSeenAt: minutesAgo(14_400),
    queuedOperations: 0,
    batteryPercent: null,
    ipAddress: "10.22.4.11",
  });
  return out;
})();

// ---------------------------------------------------------------------------
// Stations — SRS FR-KDS-001
// ---------------------------------------------------------------------------

const STATION_LIBRARY: { type: StationType; en: string; ar: string; colour: string }[] = [
  { type: "grill", en: "Grill", ar: "الشواية", colour: "#c1553a" },
  { type: "fryer", en: "Fryer", ar: "المقلاة", colour: "#d98d1f" },
  { type: "cold", en: "Cold line", ar: "الخط البارد", colour: "#4d6f6b" },
  { type: "hot_line", en: "Hot line", ar: "الخط الساخن", colour: "#b23d2c" },
  { type: "beverage", en: "Beverage", ar: "المشروبات", colour: "#5f8a86" },
  { type: "barista", en: "Barista", ar: "الباريستا", colour: "#6b4423" },
  { type: "dessert", en: "Dessert", ar: "الحلويات", colour: "#8a4a63" },
  { type: "bakery", en: "Bakery", ar: "المخبز", colour: "#b58a3c" },
  { type: "shawarma", en: "Shawarma", ar: "الشاورما", colour: "#9d4029" },
  { type: "packaging", en: "Packaging", ar: "التغليف", colour: "#756454" },
  { type: "pass", en: "Pass", ar: "التسليم", colour: "#6b8a45" },
];

const STATIONS_BY_BRAND: Record<string, StationType[]> = {
  SWH: ["shawarma", "grill", "fryer", "cold", "packaging", "pass"],
  BLP: ["hot_line", "grill", "cold", "dessert", "packaging", "pass"],
  KFC: ["barista", "bakery", "cold", "pass"],
  CLW: ["fryer", "grill", "packaging", "pass"],
};

export const stations: Station[] = (() => {
  const out: Station[] = [];
  let n = 0;
  for (const branch of branches) {
    const brand = brandById.get(branch.brandId)!;
    for (const type of STATIONS_BY_BRAND[brand.code] ?? ["hot_line", "pass"]) {
      const lib = STATION_LIBRARY.find((s) => s.type === type)!;
      n += 1;
      out.push({
        id: seqId("stn", n),
        branchId: branch.id,
        name: { en: lib.en, ar: lib.ar },
        type: lib.type,
        colour: lib.colour,
        capacityPerHour: int(rng, 40, 130),
        active: true,
      });
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Tables — SRS FR-POS-081
// ---------------------------------------------------------------------------

const TABLE_STATES: TableState[] = [
  "available",
  "available",
  "seated",
  "ordered",
  "ordered",
  "food_served",
  "bill_requested",
  "payment_in_progress",
  "needs_cleaning",
];

const AREAS = [
  { en: "Main hall", ar: "الصالة الرئيسية" },
  { en: "Terrace", ar: "التراس" },
  { en: "Family section", ar: "قسم العائلات" },
  { en: "Mezzanine", ar: "الميزانين" },
];

export const tables: RestaurantTable[] = (() => {
  const out: RestaurantTable[] = [];
  let n = 0;
  for (const branch of branches) {
    if (branch.seats === 0) continue;
    const count = Math.max(4, Math.round(branch.seats / 4));
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const area = AREAS[i % (branch.seats > 60 ? 3 : 2)]!;
      const state = pick(rng, TABLE_STATES);
      const occupied = state !== "available" && state !== "needs_cleaning";
      out.push({
        id: seqId("tbl", n),
        branchId: branch.id,
        area,
        label: `T${String(i + 1).padStart(2, "0")}`,
        capacity: pick(rng, [2, 2, 4, 4, 4, 6, 8]),
        state,
        seatedAt: occupied ? minutesAgo(int(rng, 4, 95)) : null,
        orderId: null,
        serverId: null,
      });
    }
  }
  return out;
})();
