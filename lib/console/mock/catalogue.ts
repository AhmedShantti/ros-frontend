/**
 * Catalogue fixtures — categories, menu items, modifiers, combos, price
 * lists and recipes. SRS ch.10.
 *
 * Recipe cost follows BR-MNU-003:
 *
 *   cost(recipe) = Σ lines [ qty_in_base × (1 + wastage%) × cost_per_base ]
 *                  ÷ (yield% / 100)
 *
 * The yield factor divides rather than multiplies. A recipe that loses 18%
 * to trim must cost *more* per usable gram, not less — which is the whole
 * point of the rationale under FR-MNU-044.
 */

import type {
  Combo,
  Localised,
  MenuCategory,
  MenuItem,
  MenuItemVariant,
  Modifier,
  ModifierGroup,
  Money,
  PriceList,
  Recipe,
  RecipeLine,
  StationType,
  TaxClassCode,
  UnitCode,
} from "../types";
import { ACTIVE_TENANT_ID, brands } from "./org";
import { item, stockItems } from "./stock-items";
import { chance, createRng, int, pick, seqId } from "./rng";
import { dateAgo } from "./clock";

const rng = createRng(0x5a1e);

const egp = (major: number): Money => ({ amount: Math.round(major * 100), currency: "EGP" });

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

interface CatSeed { key: string; en: string; ar: string; colour: string }

/**
 * Category colours are what a cashier navigates by during a rush, so they
 * have to be told apart at a glance while still belonging to one palette.
 * These are the warm range — clay, ember, olive, honey, plum — spaced far
 * enough apart in hue to stay distinguishable on the POS grid.
 */
const CAT_SEEDS: CatSeed[] = [
  { key: "shawarma", en: "Shawarma", ar: "شاورما", colour: "#9d4029" },
  { key: "grills", en: "Grills", ar: "مشويات", colour: "#c1553a" },
  { key: "burgers", en: "Burgers", ar: "برجر", colour: "#a85a2e" },
  { key: "pasta", en: "Pasta", ar: "مكرونة", colour: "#8a6a2f" },
  { key: "pizza", en: "Pizza", ar: "بيتزا", colour: "#b23d2c" },
  { key: "salads", en: "Salads", ar: "سلطات", colour: "#6b8a45" },
  { key: "sides", en: "Sides", ar: "أطباق جانبية", colour: "#d98d1f" },
  { key: "hot_drinks", en: "Hot drinks", ar: "مشروبات ساخنة", colour: "#6b4423" },
  { key: "cold_drinks", en: "Cold drinks", ar: "مشروبات باردة", colour: "#4d6f6b" },
  { key: "desserts", en: "Desserts", ar: "حلويات", colour: "#8a4a63" },
  { key: "breakfast", en: "Breakfast", ar: "فطور", colour: "#b58a3c" },
];

export const menuCategories: MenuCategory[] = CAT_SEEDS.map((c, i) => ({
  id: `cat_${c.key}`,
  tenantId: ACTIVE_TENANT_ID,
  name: { en: c.en, ar: c.ar },
  parentId: null,
  sortOrder: i + 1,
  colour: c.colour,
  itemCount: 0,
  active: true,
}));

const categoryIdByKey = new Map(CAT_SEEDS.map((c) => [c.key, `cat_${c.key}`]));

// ---------------------------------------------------------------------------
// Sub-recipes — SRS FR-MNU-040
// ---------------------------------------------------------------------------

interface LineSeed { sku: string; qty: number; unit: UnitCode; wastage?: number }
interface SubRecipeSeed {
  key: string;
  en: string;
  ar: string;
  yieldQty: number;
  yieldUnit: UnitCode;
  yieldPercentage: number;
  prep: number;
  lines: LineSeed[];
}

const SUB_RECIPE_SEEDS: SubRecipeSeed[] = [
  {
    key: "toum",
    en: "Garlic sauce (toum)",
    ar: "صلصة الثوم",
    yieldQty: 1000, yieldUnit: "g", yieldPercentage: 96, prep: 900,
    lines: [
      { sku: "PRD-006", qty: 180, unit: "g", wastage: 12 },
      { sku: "DRG-006", qty: 700, unit: "ml" },
      { sku: "PRD-011", qty: 90, unit: "g", wastage: 55 },
      { sku: "DRG-009", qty: 14, unit: "g" },
    ],
  },
  {
    key: "tahini",
    en: "Tahini sauce",
    ar: "صلصة الطحينة",
    yieldQty: 1000, yieldUnit: "g", yieldPercentage: 98, prep: 420,
    lines: [
      { sku: "DRY-008", qty: 520, unit: "g" },
      { sku: "PRD-011", qty: 120, unit: "g", wastage: 55 },
      { sku: "PRD-006", qty: 25, unit: "g", wastage: 12 },
      { sku: "DRG-009", qty: 10, unit: "g" },
    ],
  },
  {
    key: "napoli",
    en: "Napoli sauce",
    ar: "صلصة نابولي",
    yieldQty: 2000, yieldUnit: "ml", yieldPercentage: 82, prep: 2700,
    lines: [
      { sku: "DRG-008", qty: 1800, unit: "ml" },
      { sku: "PRD-002", qty: 240, unit: "g", wastage: 15 },
      { sku: "PRD-006", qty: 40, unit: "g", wastage: 12 },
      { sku: "DRG-007", qty: 90, unit: "ml" },
      { sku: "PRD-012", qty: 20, unit: "g", wastage: 30 },
      { sku: "DRG-009", qty: 18, unit: "g" },
    ],
  },
  {
    key: "hummus",
    en: "Hummus base",
    ar: "أساس الحمص",
    yieldQty: 1500, yieldUnit: "g", yieldPercentage: 92, prep: 3600,
    lines: [
      { sku: "DRG-014", qty: 500, unit: "g", wastage: 4 },
      { sku: "DRY-008", qty: 220, unit: "g" },
      { sku: "PRD-011", qty: 110, unit: "g", wastage: 55 },
      { sku: "PRD-006", qty: 30, unit: "g", wastage: 12 },
      { sku: "DRG-007", qty: 60, unit: "ml" },
    ],
  },
  {
    key: "burger_patty",
    en: "House beef patty 140g",
    ar: "قرص لحم البيت ١٤٠ جم",
    yieldQty: 10, yieldUnit: "pc", yieldPercentage: 88, prep: 1200,
    lines: [
      { sku: "PRO-004", qty: 1500, unit: "g", wastage: 3 },
      { sku: "PRD-002", qty: 90, unit: "g", wastage: 15 },
      { sku: "DRG-009", qty: 18, unit: "g" },
      { sku: "DRG-010", qty: 6, unit: "g" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

type BrandCode = "SWH" | "BLP" | "KFC" | "CLW";

interface VariantSeed { en: string; ar: string; price: number }

interface MenuSeed {
  brand: BrandCode;
  cat: string;
  en: string;
  ar: string;
  kitchenEn: string;
  kitchenAr: string;
  emoji: string;
  station: StationType;
  prep: number;
  tax?: TaxClassCode;
  variants: VariantSeed[];
  /** Recipe for the *first* variant; other variants scale from it. */
  recipe?: (LineSeed | { sub: string; qty: number; unit: UnitCode })[];
  allergens?: string[];
  /** Deliberately left without a recipe — BR-MNU-012. */
  incomplete?: boolean;
}

const MENU_SEEDS: MenuSeed[] = [
  // ---- Shawarma House ----
  {
    brand: "SWH", cat: "shawarma", en: "Chicken shawarma sandwich", ar: "ساندويتش شاورما دجاج",
    kitchenEn: "CHK SHAW SW", kitchenAr: "شاورما دجاج", emoji: "🌯", station: "shawarma", prep: 180,
    variants: [{ en: "Regular", ar: "عادي", price: 45 }, { en: "Large", ar: "كبير", price: 62 }],
    recipe: [
      { sku: "PRO-002", qty: 140, unit: "g", wastage: 6 },
      { sku: "BAK-003", qty: 1, unit: "pc" },
      { sub: "toum", qty: 25, unit: "g" },
      { sku: "PRD-001", qty: 30, unit: "g", wastage: 8 },
      { sku: "PRD-005", qty: 45, unit: "g", wastage: 18 },
      { sku: "PKG-006", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten"],
  },
  {
    brand: "SWH", cat: "shawarma", en: "Lamb shawarma sandwich", ar: "ساندويتش شاورما لحم",
    kitchenEn: "LMB SHAW SW", kitchenAr: "شاورما لحم", emoji: "🥙", station: "shawarma", prep: 190,
    variants: [{ en: "Regular", ar: "عادي", price: 68 }, { en: "Large", ar: "كبير", price: 89 }],
    recipe: [
      { sku: "PRO-005", qty: 135, unit: "g", wastage: 7 },
      { sku: "BAK-003", qty: 1, unit: "pc" },
      { sub: "tahini", qty: 28, unit: "g" },
      { sku: "PRD-002", qty: 25, unit: "g", wastage: 15 },
      { sku: "PRD-007", qty: 8, unit: "g", wastage: 25 },
      { sku: "PKG-006", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten", "sesame"],
  },
  {
    brand: "SWH", cat: "shawarma", en: "Shawarma plate", ar: "طبق شاورما",
    kitchenEn: "SHAW PLATE", kitchenAr: "طبق شاورما", emoji: "🍽️", station: "shawarma", prep: 240,
    variants: [{ en: "Chicken", ar: "دجاج", price: 95 }, { en: "Lamb", ar: "لحم", price: 128 }],
    recipe: [
      { sku: "PRO-002", qty: 220, unit: "g", wastage: 6 },
      { sku: "DRG-003", qty: 180, unit: "g", wastage: 2 },
      { sub: "toum", qty: 40, unit: "g" },
      { sku: "PRD-001", qty: 60, unit: "g", wastage: 8 },
      { sku: "BAK-002", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten"],
  },
  {
    brand: "SWH", cat: "grills", en: "Mixed grill", ar: "مشاوي مشكلة",
    kitchenEn: "MIX GRILL", kitchenAr: "مشكل", emoji: "🍖", station: "grill", prep: 720,
    variants: [{ en: "For one", ar: "لشخص", price: 210 }, { en: "For two", ar: "لشخصين", price: 385 }],
    recipe: [
      { sku: "PRO-001", qty: 180, unit: "g", wastage: 12 },
      { sku: "PRO-003", qty: 150, unit: "g", wastage: 14 },
      { sku: "PRO-004", qty: 120, unit: "g", wastage: 5 },
      { sku: "DRG-003", qty: 200, unit: "g", wastage: 2 },
      { sku: "PRD-009", qty: 60, unit: "g", wastage: 20 },
      { sub: "toum", qty: 45, unit: "g" },
    ],
  },
  {
    brand: "SWH", cat: "grills", en: "Grilled chicken quarter", ar: "ربع دجاجة مشوية",
    kitchenEn: "GRL CHK QTR", kitchenAr: "ربع دجاج", emoji: "🍗", station: "grill", prep: 900,
    variants: [{ en: "Standard", ar: "عادي", price: 118 }],
    recipe: [
      { sku: "PRO-001", qty: 320, unit: "g", wastage: 16 },
      { sku: "DRG-011", qty: 8, unit: "g" },
      { sku: "DRG-006", qty: 15, unit: "ml" },
      { sku: "DRG-003", qty: 150, unit: "g", wastage: 2 },
    ],
  },
  {
    brand: "SWH", cat: "sides", en: "French fries", ar: "بطاطس مقلية",
    kitchenEn: "FRIES", kitchenAr: "بطاطس", emoji: "🍟", station: "fryer", prep: 210,
    variants: [{ en: "Regular", ar: "عادي", price: 28 }, { en: "Large", ar: "كبير", price: 40 }],
    recipe: [
      { sku: "PRD-005", qty: 220, unit: "g", wastage: 18 },
      { sku: "DRG-006", qty: 22, unit: "ml" },
      { sku: "DRG-009", qty: 3, unit: "g" },
      { sku: "PKG-001", qty: 1, unit: "pc" },
    ],
  },
  {
    brand: "SWH", cat: "sides", en: "Hummus", ar: "حمص",
    kitchenEn: "HUMMUS", kitchenAr: "حمص", emoji: "🫓", station: "cold", prep: 90,
    variants: [{ en: "Portion", ar: "طبق", price: 34 }],
    recipe: [
      { sub: "hummus", qty: 160, unit: "g" },
      { sku: "DRG-007", qty: 12, unit: "ml" },
      { sku: "BAK-002", qty: 1, unit: "pc" },
    ],
    allergens: ["sesame", "gluten"],
  },
  {
    brand: "SWH", cat: "salads", en: "Fattoush", ar: "فتوش",
    kitchenEn: "FATTOUSH", kitchenAr: "فتوش", emoji: "🥗", station: "cold", prep: 150,
    variants: [{ en: "Portion", ar: "طبق", price: 42 }],
    recipe: [
      { sku: "PRD-003", qty: 90, unit: "g", wastage: 22 },
      { sku: "PRD-001", qty: 70, unit: "g", wastage: 8 },
      { sku: "PRD-004", qty: 60, unit: "g", wastage: 10 },
      { sku: "PRD-007", qty: 15, unit: "g", wastage: 25 },
      { sku: "BAK-002", qty: 1, unit: "pc" },
      { sku: "DRG-007", qty: 18, unit: "ml" },
      { sku: "PRD-011", qty: 20, unit: "g", wastage: 55 },
    ],
    allergens: ["gluten"],
  },

  // ---- Bella Pasta ----
  {
    brand: "BLP", cat: "pasta", en: "Penne arrabbiata", ar: "بيني أرابياتا",
    kitchenEn: "PENNE ARR", kitchenAr: "بيني أرابياتا", emoji: "🍝", station: "hot_line", prep: 480,
    variants: [{ en: "Standard", ar: "عادي", price: 135 }],
    recipe: [
      { sku: "DRG-001", qty: 120, unit: "g" },
      { sub: "napoli", qty: 180, unit: "ml" },
      { sku: "DRG-007", qty: 15, unit: "ml" },
      { sku: "DRY-003", qty: 18, unit: "g" },
      { sku: "PRD-012", qty: 4, unit: "g", wastage: 30 },
    ],
    allergens: ["gluten", "milk"],
  },
  {
    brand: "BLP", cat: "pasta", en: "Spaghetti carbonara", ar: "سباجيتي كاربونارا",
    kitchenEn: "SPAG CARB", kitchenAr: "كاربونارا", emoji: "🍝", station: "hot_line", prep: 540,
    variants: [{ en: "Standard", ar: "عادي", price: 158 }],
    recipe: [
      { sku: "DRG-002", qty: 130, unit: "g" },
      { sku: "DRY-005", qty: 120, unit: "ml" },
      { sku: "DRY-003", qty: 30, unit: "g" },
      { sku: "DRY-006", qty: 20, unit: "g" },
      { sku: "DRG-010", qty: 2, unit: "g" },
    ],
    allergens: ["gluten", "milk", "egg"],
  },
  {
    brand: "BLP", cat: "pasta", en: "Prawn linguine", ar: "لينجويني بالجمبري",
    kitchenEn: "PRWN LING", kitchenAr: "لينجويني جمبري", emoji: "🍤", station: "hot_line", prep: 600,
    variants: [{ en: "Standard", ar: "عادي", price: 225 }],
    recipe: [
      { sku: "DRG-002", qty: 130, unit: "g" },
      { sku: "PRO-007", qty: 110, unit: "g", wastage: 18 },
      { sku: "DRG-007", qty: 25, unit: "ml" },
      { sku: "PRD-006", qty: 12, unit: "g", wastage: 12 },
      { sku: "PRD-011", qty: 25, unit: "g", wastage: 55 },
      { sku: "PRD-007", qty: 6, unit: "g", wastage: 25 },
    ],
    allergens: ["gluten", "shellfish"],
  },
  {
    brand: "BLP", cat: "pizza", en: "Margherita", ar: "مارجريتا",
    kitchenEn: "PIZ MARG", kitchenAr: "مارجريتا", emoji: "🍕", station: "hot_line", prep: 480,
    variants: [{ en: "Medium", ar: "وسط", price: 140 }, { en: "Large", ar: "كبير", price: 195 }],
    recipe: [
      { sku: "DRG-004", qty: 230, unit: "g", wastage: 4 },
      { sub: "napoli", qty: 110, unit: "ml" },
      { sku: "DRY-002", qty: 130, unit: "g" },
      { sku: "PRD-012", qty: 5, unit: "g", wastage: 30 },
      { sku: "DRG-007", qty: 12, unit: "ml" },
    ],
    allergens: ["gluten", "milk"],
  },
  {
    brand: "BLP", cat: "pizza", en: "Pepperoni", ar: "بيبروني",
    kitchenEn: "PIZ PEP", kitchenAr: "بيبروني", emoji: "🍕", station: "hot_line", prep: 500,
    variants: [{ en: "Medium", ar: "وسط", price: 168 }, { en: "Large", ar: "كبير", price: 232 }],
    recipe: [
      { sku: "DRG-004", qty: 230, unit: "g", wastage: 4 },
      { sub: "napoli", qty: 110, unit: "ml" },
      { sku: "DRY-002", qty: 140, unit: "g" },
      { sku: "PRO-004", qty: 70, unit: "g", wastage: 5 },
    ],
    allergens: ["gluten", "milk"],
  },
  {
    brand: "BLP", cat: "salads", en: "Caesar salad", ar: "سلطة سيزر",
    kitchenEn: "CAESAR", kitchenAr: "سيزر", emoji: "🥗", station: "cold", prep: 210,
    variants: [{ en: "Starter", ar: "مقبلات", price: 88 }, { en: "With chicken", ar: "مع دجاج", price: 132 }],
    recipe: [
      { sku: "PRD-003", qty: 140, unit: "g", wastage: 22 },
      { sku: "DRY-003", qty: 22, unit: "g" },
      { sku: "DRG-015", qty: 45, unit: "g" },
      { sku: "PRD-006", qty: 5, unit: "g", wastage: 12 },
      { sku: "PRD-011", qty: 15, unit: "g", wastage: 55 },
    ],
    allergens: ["milk", "egg"],
  },
  {
    brand: "BLP", cat: "salads", en: "Rocket and parmesan", ar: "جرجير وبارTRENDOW",
    kitchenEn: "ROCKET PARM", kitchenAr: "جرجير بارTRENDOW", emoji: "🥬", station: "cold", prep: 120,
    variants: [{ en: "Portion", ar: "طبق", price: 76 }],
    recipe: [
      { sku: "PRD-008", qty: 90, unit: "g", wastage: 18 },
      { sku: "DRY-003", qty: 25, unit: "g" },
      { sku: "DRG-007", qty: 20, unit: "ml" },
      { sku: "PRD-011", qty: 18, unit: "g", wastage: 55 },
    ],
    allergens: ["milk"],
  },
  {
    brand: "BLP", cat: "grills", en: "Grilled salmon", ar: "سلمون مشوي",
    kitchenEn: "GRL SALMON", kitchenAr: "سلمون", emoji: "🐟", station: "grill", prep: 660,
    variants: [{ en: "Standard", ar: "عادي", price: 320 }],
    recipe: [
      { sku: "PRO-006", qty: 190, unit: "g", wastage: 9 },
      { sku: "DRG-007", qty: 18, unit: "ml" },
      { sku: "PRD-011", qty: 22, unit: "g", wastage: 55 },
      { sku: "PRD-009", qty: 80, unit: "g", wastage: 20 },
      { sku: "DRY-006", qty: 15, unit: "g" },
    ],
    allergens: ["fish", "milk"],
  },
  {
    brand: "BLP", cat: "desserts", en: "Tiramisu", ar: "تيراميسو",
    kitchenEn: "TIRAMISU", kitchenAr: "تيراميسو", emoji: "🍰", station: "dessert", prep: 90,
    variants: [{ en: "Slice", ar: "قطعة", price: 82 }],
    incomplete: true,
    allergens: ["gluten", "milk", "egg"],
  },

  // ---- Kaif Coffee ----
  {
    brand: "KFC", cat: "hot_drinks", en: "Espresso", ar: "إسبريسو",
    kitchenEn: "ESP", kitchenAr: "إسبريسو", emoji: "☕", station: "barista", prep: 45,
    variants: [{ en: "Single", ar: "مفرد", price: 32 }, { en: "Double", ar: "مزدوج", price: 42 }],
    recipe: [
      { sku: "BEV-001", qty: 9, unit: "g" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
  },
  {
    brand: "KFC", cat: "hot_drinks", en: "Flat white", ar: "فلات وايت",
    kitchenEn: "FLAT WHT", kitchenAr: "فلات وايت", emoji: "☕", station: "barista", prep: 75,
    variants: [{ en: "Regular", ar: "عادي", price: 58 }],
    recipe: [
      { sku: "BEV-001", qty: 18, unit: "g" },
      { sku: "DRY-004", qty: 150, unit: "ml" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
    allergens: ["milk"],
  },
  {
    brand: "KFC", cat: "hot_drinks", en: "Cappuccino", ar: "كابتشينو",
    kitchenEn: "CAPP", kitchenAr: "كابتشينو", emoji: "☕", station: "barista", prep: 80,
    variants: [{ en: "Regular", ar: "عادي", price: 55 }, { en: "Large", ar: "كبير", price: 68 }],
    recipe: [
      { sku: "BEV-001", qty: 18, unit: "g" },
      { sku: "DRY-004", qty: 180, unit: "ml" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
    allergens: ["milk"],
  },
  {
    brand: "KFC", cat: "hot_drinks", en: "Hot chocolate", ar: "شوكولاتة ساخنة",
    kitchenEn: "HOT CHOC", kitchenAr: "شوكولاتة", emoji: "🍫", station: "barista", prep: 90,
    variants: [{ en: "Regular", ar: "عادي", price: 62 }],
    recipe: [
      { sku: "BEV-003", qty: 32, unit: "g" },
      { sku: "DRY-004", qty: 220, unit: "ml" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
    allergens: ["milk"],
  },
  {
    brand: "KFC", cat: "cold_drinks", en: "Iced latte", ar: "لاتيه مثلج",
    kitchenEn: "ICED LAT", kitchenAr: "لاتيه مثلج", emoji: "🧋", station: "barista", prep: 70,
    variants: [{ en: "Regular", ar: "عادي", price: 64 }],
    recipe: [
      { sku: "BEV-001", qty: 18, unit: "g" },
      { sku: "DRY-004", qty: 170, unit: "ml" },
      { sku: "BEV-004", qty: 12, unit: "ml" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
    allergens: ["milk"],
  },
  {
    brand: "KFC", cat: "cold_drinks", en: "Fresh orange juice", ar: "عصير برتقال طازج",
    kitchenEn: "FRESH OJ", kitchenAr: "عصير برتقال", emoji: "🍊", station: "cold", prep: 120,
    variants: [{ en: "Regular", ar: "عادي", price: 55 }],
    recipe: [
      { sku: "BEV-007", qty: 420, unit: "g", wastage: 48 },
      { sku: "PKG-003", qty: 1, unit: "pc" },
      { sku: "PKG-004", qty: 1, unit: "pc" },
    ],
  },
  {
    brand: "KFC", cat: "cold_drinks", en: "Mint lemonade", ar: "ليمون بالنعناع",
    kitchenEn: "MINT LEM", kitchenAr: "ليمون نعناع", emoji: "🍹", station: "cold", prep: 130,
    variants: [{ en: "Regular", ar: "عادي", price: 48 }],
    recipe: [
      { sku: "PRD-011", qty: 130, unit: "g", wastage: 55 },
      { sku: "BEV-008", qty: 12, unit: "g", wastage: 30 },
      { sku: "DRG-005", qty: 35, unit: "g" },
      { sku: "PKG-003", qty: 1, unit: "pc" },
    ],
  },
  {
    brand: "KFC", cat: "cold_drinks", en: "Soft drink", ar: "مشروب غازي",
    kitchenEn: "SOFT DRK", kitchenAr: "غازي", emoji: "🥤", station: "beverage", prep: 20,
    variants: [{ en: "Can 330ml", ar: "علبة ٣٣٠ مل", price: 20 }],
    recipe: [{ sku: "BEV-005", qty: 1, unit: "pc" }],
  },
  {
    brand: "KFC", cat: "cold_drinks", en: "Mineral water", ar: "مياه معدنية",
    kitchenEn: "WATER", kitchenAr: "مياه", emoji: "💧", station: "beverage", prep: 15,
    variants: [{ en: "600ml", ar: "٦٠٠ مل", price: 12 }],
    recipe: [{ sku: "BEV-006", qty: 1, unit: "pc" }],
  },
  {
    brand: "KFC", cat: "breakfast", en: "Butter croissant", ar: "كرواسون بالزبدة",
    kitchenEn: "CROISSANT", kitchenAr: "كرواسون", emoji: "🥐", station: "bakery", prep: 900,
    variants: [{ en: "Each", ar: "قطعة", price: 45 }],
    recipe: [
      { sku: "BAK-004", qty: 1, unit: "pc" },
      { sku: "DRY-006", qty: 6, unit: "g" },
      { sku: "PKG-002", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten", "milk", "egg"],
  },
  {
    brand: "KFC", cat: "breakfast", en: "Labneh and zaatar plate", ar: "طبق لبنة وزعتر",
    kitchenEn: "LABNEH PLT", kitchenAr: "لبنة", emoji: "🫒", station: "cold", prep: 180,
    variants: [{ en: "Portion", ar: "طبق", price: 68 }],
    recipe: [
      { sku: "DRY-007", qty: 120, unit: "g" },
      { sku: "DRG-007", qty: 20, unit: "ml" },
      { sku: "PRD-001", qty: 50, unit: "g", wastage: 8 },
      { sku: "PRD-004", qty: 50, unit: "g", wastage: 10 },
      { sku: "BAK-002", qty: 1, unit: "pc" },
    ],
    allergens: ["milk", "gluten"],
  },
  {
    brand: "KFC", cat: "desserts", en: "Basbousa", ar: "بسبوسة",
    kitchenEn: "BASBOUSA", kitchenAr: "بسبوسة", emoji: "🍮", station: "bakery", prep: 60,
    variants: [{ en: "Slice", ar: "قطعة", price: 38 }],
    incomplete: true,
    allergens: ["gluten", "milk"],
  },

  // ---- Cloud Wings (delivery-only) ----
  {
    brand: "CLW", cat: "burgers", en: "Classic cheeseburger", ar: "تشيز برجر كلاسيك",
    kitchenEn: "CLSC CHZ", kitchenAr: "تشيز برجر", emoji: "🍔", station: "grill", prep: 420,
    variants: [{ en: "Single", ar: "مفرد", price: 125 }, { en: "Double", ar: "مزدوج", price: 178 }],
    recipe: [
      { sub: "burger_patty", qty: 1, unit: "pc" },
      { sku: "BAK-001", qty: 1, unit: "pc" },
      { sku: "DRY-001", qty: 22, unit: "g" },
      { sku: "PRD-003", qty: 20, unit: "g", wastage: 22 },
      { sku: "PRD-001", qty: 25, unit: "g", wastage: 8 },
      { sku: "DRG-015", qty: 18, unit: "g" },
      { sku: "PKG-001", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten", "milk", "egg", "sesame"],
  },
  {
    brand: "CLW", cat: "burgers", en: "Crispy chicken burger", ar: "برجر دجاج مقرمش",
    kitchenEn: "CRSP CHK", kitchenAr: "برجر دجاج", emoji: "🍔", station: "fryer", prep: 480,
    variants: [{ en: "Single", ar: "مفرد", price: 118 }],
    recipe: [
      { sku: "PRO-001", qty: 150, unit: "g", wastage: 12 },
      { sku: "DRG-004", qty: 45, unit: "g", wastage: 8 },
      { sku: "BAK-001", qty: 1, unit: "pc" },
      { sku: "DRG-006", qty: 30, unit: "ml" },
      { sku: "DRG-015", qty: 20, unit: "g" },
      { sku: "PRD-003", qty: 20, unit: "g", wastage: 22 },
      { sku: "PKG-001", qty: 1, unit: "pc" },
    ],
    allergens: ["gluten", "egg"],
  },
  {
    brand: "CLW", cat: "sides", en: "Buffalo wings", ar: "أجنحة بافلو",
    kitchenEn: "BUFF WINGS", kitchenAr: "بافلو وينجز", emoji: "🍗", station: "fryer", prep: 540,
    variants: [{ en: "6 pieces", ar: "٦ قطع", price: 95 }, { en: "12 pieces", ar: "١٢ قطعة", price: 165 }],
    recipe: [
      { sku: "PRO-001", qty: 320, unit: "g", wastage: 15 },
      { sku: "DRG-006", qty: 40, unit: "ml" },
      { sku: "DRG-016", qty: 35, unit: "g" },
      { sku: "DRG-010", qty: 3, unit: "g" },
      { sku: "PKG-001", qty: 1, unit: "pc" },
    ],
  },
  {
    brand: "CLW", cat: "sides", en: "Loaded fries", ar: "بطاطس محمّلة",
    kitchenEn: "LOAD FRIES", kitchenAr: "بطاطس محملة", emoji: "🍟", station: "fryer", prep: 300,
    variants: [{ en: "Portion", ar: "طبق", price: 68 }],
    recipe: [
      { sku: "PRD-005", qty: 240, unit: "g", wastage: 18 },
      { sku: "DRG-006", qty: 25, unit: "ml" },
      { sku: "DRY-001", qty: 35, unit: "g" },
      { sku: "PRO-004", qty: 45, unit: "g", wastage: 5 },
      { sku: "PKG-001", qty: 1, unit: "pc" },
    ],
    allergens: ["milk"],
  },
];

// ---------------------------------------------------------------------------
// Build menu items
// ---------------------------------------------------------------------------

const brandByCode = new Map(brands.map((b) => [b.code, b]));

export const menuItems: MenuItem[] = MENU_SEEDS.map((seed, i) => {
  const variants: MenuItemVariant[] = seed.variants.map((v, vi) => ({
    id: `${seqId("mit", i + 1)}_v${vi + 1}`,
    name: { en: v.en, ar: v.ar },
    basePrice: egp(v.price),
    barcode: chance(rng, 0.35) ? `62${String(100000 + i * 7 + vi).padStart(8, "0")}` : null,
    recipeId: seed.incomplete ? null : `rcp_${seqId("m", i + 1)}_${vi + 1}`,
    available: true,
  }));

  const unavailable = chance(rng, 0.08);

  return {
    id: seqId("mit", i + 1),
    tenantId: ACTIVE_TENANT_ID,
    categoryId: categoryIdByKey.get(seed.cat)!,
    name: { en: seed.en, ar: seed.ar },
    kitchenName: { en: seed.kitchenEn, ar: seed.kitchenAr },
    receiptName: { en: seed.en, ar: seed.ar },
    description: {
      en: `${seed.en} — prepared to the ${brandByCode.get(seed.brand)?.name.en ?? ""} standard.`,
      ar: `${seed.ar} — محضّر وفق معيار ${brandByCode.get(seed.brand)?.name.ar ?? ""}.`,
    },
    taxClass: seed.tax ?? "standard",
    stationType: seed.station,
    prepTimeSeconds: seed.prep,
    variants,
    allergens: seed.allergens ?? [],
    isCombo: false,
    isOpenPrice: false,
    isWeighed: false,
    available: !unavailable,
    unavailableReason: unavailable ? "Out of a key ingredient" : null,
    remainingSellable: unavailable ? 0 : int(rng, 4, 180),
    sortOrder: i + 1,
    colour: CAT_SEEDS.find((c) => c.key === seed.cat)?.colour ?? "#c1553a",
    imageEmoji: seed.emoji,
  };
});

export const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

/** Which brand each menu item belongs to — used by the brand scope filter. */
export const menuItemBrandCode = new Map<string, BrandCode>(
  menuItems.map((m, i) => [m.id, MENU_SEEDS[i]!.brand]),
);

// Fill in category counts now that items exist.
for (const cat of menuCategories) {
  cat.itemCount = menuItems.filter((m) => m.categoryId === cat.id).length;
}

// ---------------------------------------------------------------------------
// Recipes — sub-recipes first, so menu recipes can price them
// ---------------------------------------------------------------------------

interface BuiltLine {
  line: RecipeLine;
  costMinor: number;
}

function buildStockLine(
  seq: number,
  seed: LineSeed,
): BuiltLine {
  const stock = item(seed.sku);
  const wastage = seed.wastage ?? 0;
  const effective = seed.qty * (1 + wastage / 100);
  const costMinor = effective * stock.unitCost.amount;
  return {
    costMinor,
    line: {
      id: `rl_${seed.sku}_${seq}`,
      sequence: seq,
      componentType: "stock_item",
      componentId: stock.id,
      componentName: stock.name,
      quantity: { value: seed.qty.toFixed(6), unit: seed.unit },
      wastagePercentage: wastage,
      isOptional: false,
      unitCost: { amount: Math.round(stock.unitCost.amount * 100) / 100, currency: "EGP" },
      lineCost: { amount: Math.round(costMinor), currency: "EGP" },
    },
  };
}

/** Cost of one base unit of a sub-recipe's output. */
const subRecipeUnitCost = new Map<string, number>();
const subRecipeIdByKey = new Map<string, string>();

export const subRecipes: Recipe[] = SUB_RECIPE_SEEDS.map((seed, i) => {
  const built = seed.lines.map((l, li) => buildStockLine(li + 1, l));
  const raw = built.reduce((sum, b) => sum + b.costMinor, 0);
  const total = raw / (seed.yieldPercentage / 100);
  const perUnit = total / seed.yieldQty;

  const id = `rcp_sub_${i + 1}`;
  subRecipeUnitCost.set(seed.key, perUnit);
  subRecipeIdByKey.set(seed.key, id);

  return {
    id,
    tenantId: ACTIVE_TENANT_ID,
    name: { en: seed.en, ar: seed.ar },
    recipeType: "sub_recipe",
    targetId: null,
    targetName: null,
    version: int(rng, 1, 4),
    status: "published",
    yieldQuantity: { value: seed.yieldQty.toFixed(6), unit: seed.yieldUnit },
    yieldPercentage: seed.yieldPercentage,
    prepTimeSeconds: seed.prep,
    lines: built.map((b) => b.line),
    computedCost: { amount: Math.round(total), currency: "EGP" },
    costPerPortion: { amount: Math.round(perUnit * 100) / 100, currency: "EGP" },
    sellingPrice: null,
    costComputedAt: dateAgo(int(rng, 0, 6)),
    effectiveFrom: dateAgo(int(rng, 30, 300)),
    complete: true,
    instructions: {
      en: `Batch preparation for ${seed.en}. Hold chilled; label with production and expiry dates.`,
      ar: `تحضير دفعة من ${seed.ar}. يُحفظ مبردًا مع لصق تاريخ الإنتاج والانتهاء.`,
    },
  };
});

export const menuRecipes: Recipe[] = (() => {
  const out: Recipe[] = [];

  MENU_SEEDS.forEach((seed, i) => {
    if (seed.incomplete || !seed.recipe) return;
    const menuItem = menuItems[i]!;

    seed.variants.forEach((variantSeed, vi) => {
      // Larger variants scale the recipe rather than duplicating it.
      const scale = vi === 0 ? 1 : 1 + 0.42 * vi;
      const built: BuiltLine[] = [];
      let seq = 0;

      for (const comp of seed.recipe!) {
        seq += 1;
        if ("sub" in comp) {
          const perUnit = subRecipeUnitCost.get(comp.sub)!;
          const subSeed = SUB_RECIPE_SEEDS.find((s) => s.key === comp.sub)!;
          const qty = comp.qty * scale;
          const costMinor = qty * perUnit;
          built.push({
            costMinor,
            line: {
              id: `rl_sub_${comp.sub}_${seq}`,
              sequence: seq,
              componentType: "sub_recipe",
              componentId: subRecipeIdByKey.get(comp.sub)!,
              componentName: { en: subSeed.en, ar: subSeed.ar },
              quantity: { value: qty.toFixed(6), unit: comp.unit },
              wastagePercentage: 0,
              isOptional: false,
              unitCost: { amount: Math.round(perUnit * 100) / 100, currency: "EGP" },
              lineCost: { amount: Math.round(costMinor), currency: "EGP" },
            },
          });
        } else {
          built.push(buildStockLine(seq, { ...comp, qty: comp.qty * scale }));
        }
      }

      const total = built.reduce((sum, b) => sum + b.costMinor, 0);
      const variant = menuItem.variants[vi]!;

      out.push({
        id: variant.recipeId!,
        tenantId: ACTIVE_TENANT_ID,
        name: {
          en: `${seed.en} — ${variantSeed.en}`,
          ar: `${seed.ar} — ${variantSeed.ar}`,
        },
        recipeType: "menu_item",
        targetId: variant.id,
        targetName: menuItem.name,
        version: int(rng, 1, 6),
        status: "published",
        yieldQuantity: { value: "1.000000", unit: "pc" },
        yieldPercentage: 100,
        prepTimeSeconds: seed.prep,
        lines: built.map((b) => b.line),
        computedCost: { amount: Math.round(total), currency: "EGP" },
        costPerPortion: { amount: Math.round(total), currency: "EGP" },
        sellingPrice: variant.basePrice,
        costComputedAt: dateAgo(int(rng, 0, 5)),
        effectiveFrom: dateAgo(int(rng, 20, 400)),
        complete: true,
        instructions: {
          en: `Assemble ${seed.en} (${variantSeed.en}) to spec. Target ticket time ${Math.round(seed.prep / 60)} minutes.`,
          ar: `حضّر ${seed.ar} (${variantSeed.ar}) وفق المواصفة. زمن التذكرة المستهدف ${Math.round(seed.prep / 60)} دقيقة.`,
        },
      });
    });
  });

  return out;
})();

/** Menu recipes plus sub-recipes, plus two drafts so the status filter has range. */
export const recipes: Recipe[] = (() => {
  const all = [...menuRecipes, ...subRecipes];
  const draftSource = menuRecipes[0];
  if (draftSource) {
    all.push({
      ...draftSource,
      id: "rcp_draft_1",
      name: { en: `${draftSource.name.en} (v${draftSource.version + 1} draft)`, ar: `${draftSource.name.ar} (مسودة)` },
      version: draftSource.version + 1,
      status: "draft",
      complete: false,
      effectiveFrom: dateAgo(0),
    });
  }
  const superseded = menuRecipes[3];
  if (superseded) {
    all.push({
      ...superseded,
      id: "rcp_superseded_1",
      name: { en: `${superseded.name.en} (v${superseded.version - 1})`, ar: `${superseded.name.ar} (نسخة سابقة)` },
      version: Math.max(1, superseded.version - 1),
      status: "superseded",
      effectiveFrom: dateAgo(220),
    });
  }
  return all;
})();

export const recipeById = new Map(recipes.map((r) => [r.id, r]));

/** Menu items with no published recipe — the FR-MNU report on completeness. */
export const incompleteRecipeItems = menuItems.filter((m) =>
  m.variants.some((v) => !v.recipeId),
);

// ---------------------------------------------------------------------------
// Modifier groups — SRS §10.3
// ---------------------------------------------------------------------------

function mod(
  id: string,
  en: string,
  ar: string,
  kind: Modifier["kind"],
  price: number,
  delta: Modifier["recipeDelta"] = [],
  isDefault = false,
): Modifier {
  return {
    id,
    name: { en, ar },
    kind,
    priceDelta: egp(price),
    recipeDelta: delta,
    isDefault,
  };
}

const cheddar = item("DRY-001");
const onion = item("PRD-002");
const chickenFillet = item("PRO-001");
const beefMince = item("PRO-004");
const milk = item("DRY-004");

export const modifierGroups: ModifierGroup[] = [
  {
    id: "mgp_0001",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Extras", ar: "إضافات" },
    minSelections: 0,
    maxSelections: 4,
    required: false,
    allowRepeat: true,
    freeQuantityThreshold: null,
    attachedItemCount: 12,
    modifiers: [
      mod("mdf_0001", "Extra cheese", "جبنة إضافية", "addition", 10, [
        { componentId: cheddar.id, componentName: cheddar.name, operation: "add", quantity: { value: "20.000000", unit: "g" } },
      ]),
      mod("mdf_0002", "Extra sauce", "صلصة إضافية", "addition", 6),
      mod("mdf_0003", "Extra patty", "قرص لحم إضافي", "addition", 45, [
        { componentId: beefMince.id, componentName: beefMince.name, operation: "add", quantity: { value: "150.000000", unit: "g" } },
      ]),
      mod("mdf_0004", "Extra shot", "جرعة إضافية", "addition", 12),
    ],
  },
  {
    id: "mgp_0002",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Remove", ar: "بدون" },
    minSelections: 0,
    maxSelections: 5,
    required: false,
    allowRepeat: false,
    freeQuantityThreshold: null,
    attachedItemCount: 18,
    modifiers: [
      // FR-POS-024 — a "no onion" burger must not deplete onion.
      mod("mdf_0010", "No onion", "بدون بصل", "removal", 0, [
        { componentId: onion.id, componentName: onion.name, operation: "remove_all" },
      ]),
      mod("mdf_0011", "No cheese", "بدون جبنة", "removal", 0, [
        { componentId: cheddar.id, componentName: cheddar.name, operation: "remove_all" },
      ]),
      mod("mdf_0012", "No pickles", "بدون مخلل", "removal", 0),
      mod("mdf_0013", "No ice", "بدون ثلج", "removal", 0),
    ],
  },
  {
    id: "mgp_0003",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Protein choice", ar: "اختيار البروتين" },
    minSelections: 1,
    maxSelections: 1,
    required: true,
    allowRepeat: false,
    freeQuantityThreshold: null,
    attachedItemCount: 6,
    modifiers: [
      mod("mdf_0020", "Beef", "لحم", "substitution", 0, [], true),
      mod("mdf_0021", "Chicken instead of beef", "دجاج بدل اللحم", "substitution", -30, [
        { componentId: beefMince.id, componentName: beefMince.name, operation: "remove_all" },
        { componentId: chickenFillet.id, componentName: chickenFillet.name, operation: "add", quantity: { value: "130.000000", unit: "g" } },
      ]),
    ],
  },
  {
    id: "mgp_0004",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Milk choice", ar: "اختيار الحليب" },
    minSelections: 1,
    maxSelections: 1,
    required: true,
    allowRepeat: false,
    freeQuantityThreshold: null,
    attachedItemCount: 8,
    modifiers: [
      mod("mdf_0030", "Full fat", "كامل الدسم", "substitution", 0, [], true),
      mod("mdf_0031", "Skimmed", "خالي الدسم", "substitution", 0),
      mod("mdf_0032", "Oat milk", "حليب الشوفان", "substitution", 15, [
        { componentId: milk.id, componentName: milk.name, operation: "remove_all" },
      ]),
    ],
  },
  {
    id: "mgp_0005",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Spice level", ar: "درجة الحرارة" },
    minSelections: 1,
    maxSelections: 1,
    required: true,
    allowRepeat: false,
    freeQuantityThreshold: null,
    attachedItemCount: 9,
    modifiers: [
      mod("mdf_0040", "Mild", "خفيف", "addition", 0, [], true),
      mod("mdf_0041", "Medium", "وسط", "addition", 0),
      mod("mdf_0042", "Hot", "حار", "addition", 0),
      mod("mdf_0043", "Extra hot", "حار جدًا", "addition", 0),
    ],
  },
  {
    id: "mgp_0006",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Side choice", ar: "اختيار الطبق الجانبي" },
    minSelections: 1,
    maxSelections: 2,
    required: true,
    allowRepeat: false,
    freeQuantityThreshold: 1,
    attachedItemCount: 5,
    modifiers: [
      mod("mdf_0050", "Fries", "بطاطس", "addition", 0, [], true),
      mod("mdf_0051", "Side salad", "سلطة جانبية", "addition", 0),
      mod("mdf_0052", "Rice", "أرز", "addition", 8),
    ],
  },
];

// ---------------------------------------------------------------------------
// Combos — SRS §8.2.4
// ---------------------------------------------------------------------------

function slotOptions(ids: string[]) {
  return ids
    .map((id) => menuItemById.get(id))
    .filter((m): m is MenuItem => Boolean(m));
}

export const combos: Combo[] = (() => {
  const shawarmaIds = menuItems.filter((m) => m.categoryId === "cat_shawarma").map((m) => m.id);
  const sideIds = menuItems.filter((m) => m.categoryId === "cat_sides").map((m) => m.id);
  const drinkIds = menuItems.filter((m) => m.categoryId === "cat_cold_drinks").map((m) => m.id);
  const burgerIds = menuItems.filter((m) => m.categoryId === "cat_burgers").map((m) => m.id);
  const pastaIds = menuItems.filter((m) => m.categoryId === "cat_pasta").map((m) => m.id);
  const saladIds = menuItems.filter((m) => m.categoryId === "cat_salads").map((m) => m.id);
  const dessertIds = menuItems.filter((m) => m.categoryId === "cat_desserts").map((m) => m.id);

  const makeSlot = (
    id: string,
    en: string,
    ar: string,
    ids: string[],
    priceDelta = 0,
  ): Combo["slots"][number] => {
    const options = slotOptions(ids);
    return {
      id,
      name: { en, ar },
      optionItemIds: options.map((o) => o.id),
      optionNames: options.map((o) => o.name),
      priceDelta: egp(priceDelta),
    };
  };

  return [
    {
      id: "cmb_0001",
      tenantId: ACTIVE_TENANT_ID,
      name: { en: "Shawarma meal", ar: "وجبة شاورما" },
      price: egp(89),
      pricingStrategy: "fixed",
      slots: [
        makeSlot("slt_0001", "Sandwich", "ساندويتش", shawarmaIds),
        makeSlot("slt_0002", "Side", "طبق جانبي", sideIds),
        makeSlot("slt_0003", "Drink", "مشروب", drinkIds),
      ],
      active: true,
    },
    {
      id: "cmb_0002",
      tenantId: ACTIVE_TENANT_ID,
      name: { en: "Burger combo", ar: "كومبو برجر" },
      price: egp(175),
      pricingStrategy: "sum_minus_discount",
      slots: [
        makeSlot("slt_0010", "Burger", "برجر", burgerIds),
        makeSlot("slt_0011", "Side", "طبق جانبي", sideIds),
        makeSlot("slt_0012", "Drink", "مشروب", drinkIds),
      ],
      active: true,
    },
    {
      id: "cmb_0003",
      tenantId: ACTIVE_TENANT_ID,
      name: { en: "Pasta lunch", ar: "غداء المكرونة" },
      price: egp(185),
      pricingStrategy: "fixed",
      slots: [
        makeSlot("slt_0020", "Pasta", "مكرونة", pastaIds),
        makeSlot("slt_0021", "Salad", "سلطة", saladIds),
        makeSlot("slt_0022", "Drink", "مشروب", drinkIds),
      ],
      active: true,
    },
    {
      id: "cmb_0004",
      tenantId: ACTIVE_TENANT_ID,
      name: { en: "Coffee and pastry", ar: "قهوة ومعجنات" },
      price: egp(88),
      pricingStrategy: "component_override",
      slots: [
        makeSlot("slt_0030", "Coffee", "قهوة", menuItems.filter((m) => m.categoryId === "cat_hot_drinks").map((m) => m.id)),
        makeSlot("slt_0031", "Pastry", "معجنات", [...dessertIds, ...menuItems.filter((m) => m.categoryId === "cat_breakfast").map((m) => m.id)]),
      ],
      active: false,
    },
  ];
})();

// ---------------------------------------------------------------------------
// Price lists — SRS §10.4
// ---------------------------------------------------------------------------

function entriesFor(count: number, uplift: number): PriceList["entries"] {
  return menuItems.slice(0, count).flatMap((m) =>
    m.variants.slice(0, 1).map((v) => ({
      menuItemId: m.id,
      variantId: v.id,
      itemName: { en: `${m.name.en} — ${v.name.en}`, ar: `${m.name.ar} — ${v.name.ar}` } as Localised,
      price: { amount: Math.round(v.basePrice.amount * uplift), currency: "EGP" as const },
      previousPrice: uplift === 1 ? null : v.basePrice,
    })),
  );
}

export const priceLists: PriceList[] = [
  {
    id: "prl_0001",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Base price list", ar: "قائمة الأسعار الأساسية" },
    scope: "tenant",
    scopeId: null,
    orderTypes: ["dine_in", "takeaway", "pickup", "drive_thru"],
    priority: 10,
    validFrom: dateAgo(400),
    validTo: null,
    recurrence: null,
    entryCount: menuItems.length,
    entries: entriesFor(menuItems.length, 1),
    active: true,
  },
  {
    id: "prl_0002",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Delivery pricing", ar: "تسعير التوصيل" },
    scope: "tenant",
    scopeId: null,
    orderTypes: ["delivery", "aggregator"],
    priority: 30,
    validFrom: dateAgo(240),
    validTo: null,
    recurrence: null,
    entryCount: menuItems.length,
    entries: entriesFor(menuItems.length, 1.18),
    active: true,
  },
  {
    id: "prl_0003",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Happy hour — Kaif", ar: "ساعة العرض — كيف" },
    scope: "brand",
    scopeId: brands[2]!.id,
    orderTypes: ["dine_in", "takeaway"],
    priority: 50,
    validFrom: dateAgo(60),
    validTo: null,
    recurrence: "Sun–Thu 15:00–18:00",
    entryCount: 8,
    entries: entriesFor(8, 0.75),
    active: true,
  },
  {
    id: "prl_0004",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Ramadan iftar menu", ar: "قائمة إفطار رمضان" },
    scope: "tenant",
    scopeId: null,
    orderTypes: ["dine_in", "delivery"],
    priority: 60,
    validFrom: "2027-02-08",
    validTo: "2027-03-09",
    recurrence: "Daily from sunset",
    entryCount: 14,
    entries: entriesFor(14, 1.05),
    active: false,
  },
  {
    id: "prl_0005",
    tenantId: ACTIVE_TENANT_ID,
    name: { en: "Zamalek franchise list", ar: "قائمة امتياز الزمالك" },
    scope: "branch",
    scopeId: "brn_0005",
    orderTypes: ["dine_in", "takeaway", "delivery"],
    priority: 40,
    validFrom: dateAgo(120),
    validTo: null,
    recurrence: null,
    entryCount: 10,
    entries: entriesFor(10, 1.12),
    active: true,
  },
];

/** A representative item for fixtures that need "some menu item". */
export function anyMenuItem(seed: number): MenuItem {
  return menuItems[seed % menuItems.length]!;
}

export const salesMixWeights = menuItems.map((_, i) =>
  Math.max(1, Math.round(60 - i * 1.1 + (i % 5) * 9)),
);

/** Stock items actually consumed by at least one recipe. */
export const consumedStockItemIds = new Set(
  recipes.flatMap((r) =>
    r.lines.filter((l) => l.componentType === "stock_item").map((l) => l.componentId),
  ),
);

export const unusedStockItems = stockItems.filter((s) => !consumedStockItemIds.has(s.id));

void pick;
