/**
 * Stock item master — SRS §11.2.
 *
 * Costs are minor units per *base* unit, so a 92 EGP/kg chicken breast is
 * stored as 9.2 piastres per gram. Keeping everything in the base unit is
 * what makes recipe expansion arithmetic rather than unit gymnastics.
 */

import type { CostingMethod, StockItem, StorageRequirement, UnitCode } from "../types";
import { ACTIVE_TENANT_ID } from "./org";
import { seqId } from "./rng";

interface Seed {
  sku: string;
  en: string;
  ar: string;
  catEn: string;
  catAr: string;
  base: UnitCode;
  purchase: UnitCode;
  conversion: number;
  /** Minor units per base unit. */
  cost: number;
  storage: StorageRequirement;
  costing?: CostingMethod;
  batch?: boolean;
  expiry?: boolean;
  shelfLife?: number;
  allergens?: string[];
}

const SEEDS: Seed[] = [
  // Proteins
  { sku: "PRO-001", en: "Chicken breast", ar: "صدور دجاج", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 9.2, storage: "chilled", costing: "fifo", batch: true, expiry: true, shelfLife: 4 },
  { sku: "PRO-002", en: "Chicken shawarma strips", ar: "شرائح شاورما دجاج", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 11.4, storage: "chilled", batch: true, expiry: true, shelfLife: 3 },
  { sku: "PRO-003", en: "Beef striploin", ar: "ستربلوين بقري", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 42.5, storage: "chilled", costing: "fifo", batch: true, expiry: true, shelfLife: 5 },
  { sku: "PRO-004", en: "Beef mince 20%", ar: "لحم مفروم ٢٠٪", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 28.0, storage: "chilled", batch: true, expiry: true, shelfLife: 3 },
  { sku: "PRO-005", en: "Lamb shawarma", ar: "شاورما لحم", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 38.6, storage: "chilled", batch: true, expiry: true, shelfLife: 3 },
  { sku: "PRO-006", en: "Salmon fillet", ar: "فيليه سلمون", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 64.0, storage: "chilled", costing: "fifo", batch: true, expiry: true, shelfLife: 2, allergens: ["fish"] },
  { sku: "PRO-007", en: "Prawns 21/25", ar: "جمبري ٢١/٢٥", catEn: "Proteins", catAr: "البروتينات", base: "g", purchase: "kg", conversion: 1000, cost: 48.0, storage: "frozen", batch: true, expiry: true, shelfLife: 90, allergens: ["shellfish"] },
  { sku: "PRO-008", en: "Halloumi", ar: "حلومي", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 24.5, storage: "chilled", batch: true, expiry: true, shelfLife: 21, allergens: ["milk"] },

  // Dairy
  { sku: "DRY-001", en: "Cheddar slices", ar: "شرائح شيدر", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 18.4, storage: "chilled", batch: true, expiry: true, shelfLife: 30, allergens: ["milk"] },
  { sku: "DRY-002", en: "Mozzarella", ar: "موتزاريلا", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 16.8, storage: "chilled", batch: true, expiry: true, shelfLife: 21, allergens: ["milk"] },
  { sku: "DRY-003", en: "Parmesan", ar: "بارTRENDOW", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 52.0, storage: "chilled", batch: true, expiry: true, shelfLife: 60, allergens: ["milk"] },
  { sku: "DRY-004", en: "Fresh milk", ar: "حليب طازج", catEn: "Dairy", catAr: "الألبان", base: "ml", purchase: "l", conversion: 1000, cost: 3.4, storage: "chilled", batch: true, expiry: true, shelfLife: 7, allergens: ["milk"] },
  { sku: "DRY-005", en: "Cooking cream 35%", ar: "كريمة طهي ٣٥٪", catEn: "Dairy", catAr: "الألبان", base: "ml", purchase: "l", conversion: 1000, cost: 8.9, storage: "chilled", batch: true, expiry: true, shelfLife: 14, allergens: ["milk"] },
  { sku: "DRY-006", en: "Butter unsalted", ar: "زبدة غير مملحة", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 22.0, storage: "chilled", batch: true, expiry: true, shelfLife: 45, allergens: ["milk"] },
  { sku: "DRY-007", en: "Labneh", ar: "لبنة", catEn: "Dairy", catAr: "الألبان", base: "g", purchase: "kg", conversion: 1000, cost: 14.2, storage: "chilled", batch: true, expiry: true, shelfLife: 12, allergens: ["milk"] },
  { sku: "DRY-008", en: "Tahini", ar: "طحينة", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 12.6, storage: "ambient", allergens: ["sesame"] },

  // Produce
  { sku: "PRD-001", en: "Tomato", ar: "طماطم", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 2.1, storage: "chilled", expiry: true, shelfLife: 7 },
  { sku: "PRD-002", en: "Onion", ar: "بصل", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 1.4, storage: "ambient", expiry: true, shelfLife: 21 },
  { sku: "PRD-003", en: "Iceberg lettuce", ar: "خس أيسبرغ", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 3.2, storage: "chilled", expiry: true, shelfLife: 5 },
  { sku: "PRD-004", en: "Cucumber", ar: "خيار", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 1.9, storage: "chilled", expiry: true, shelfLife: 7 },
  { sku: "PRD-005", en: "Potato", ar: "بطاطس", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 1.6, storage: "ambient", expiry: true, shelfLife: 30 },
  { sku: "PRD-006", en: "Garlic", ar: "ثوم", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 6.8, storage: "ambient", expiry: true, shelfLife: 45 },
  { sku: "PRD-007", en: "Parsley", ar: "بقدونس", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 4.5, storage: "chilled", expiry: true, shelfLife: 4 },
  { sku: "PRD-008", en: "Rocket leaves", ar: "جرجير", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 7.2, storage: "chilled", expiry: true, shelfLife: 3 },
  { sku: "PRD-009", en: "Bell pepper", ar: "فلفل رومي", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 4.1, storage: "chilled", expiry: true, shelfLife: 10 },
  { sku: "PRD-010", en: "Mushroom", ar: "مشروم", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 9.4, storage: "chilled", expiry: true, shelfLife: 5 },
  { sku: "PRD-011", en: "Lemon", ar: "ليمون", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 3.8, storage: "ambient", expiry: true, shelfLife: 14 },
  { sku: "PRD-012", en: "Basil", ar: "ريحان", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 11.0, storage: "chilled", expiry: true, shelfLife: 3 },

  // Bakery and dry
  { sku: "BAK-001", en: "Burger bun", ar: "خبز برجر", catEn: "Bakery", catAr: "المخبوزات", base: "pc", purchase: "pack", conversion: 12, cost: 320, storage: "ambient", expiry: true, shelfLife: 4, allergens: ["gluten", "sesame"] },
  { sku: "BAK-002", en: "Arabic bread", ar: "خبز عربي", catEn: "Bakery", catAr: "المخبوزات", base: "pc", purchase: "pack", conversion: 20, cost: 110, storage: "ambient", expiry: true, shelfLife: 3, allergens: ["gluten"] },
  { sku: "BAK-003", en: "Saj bread", ar: "خبز صاج", catEn: "Bakery", catAr: "المخبوزات", base: "pc", purchase: "pack", conversion: 20, cost: 145, storage: "ambient", expiry: true, shelfLife: 3, allergens: ["gluten"] },
  { sku: "BAK-004", en: "Croissant frozen", ar: "كرواسون مجمد", catEn: "Bakery", catAr: "المخبوزات", base: "pc", purchase: "case", conversion: 60, cost: 640, storage: "frozen", batch: true, expiry: true, shelfLife: 180, allergens: ["gluten", "milk", "egg"] },
  { sku: "DRG-001", en: "Penne pasta", ar: "معكرونة بيني", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 4.6, storage: "ambient", allergens: ["gluten"] },
  { sku: "DRG-002", en: "Spaghetti", ar: "سباجيتي", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 4.4, storage: "ambient", allergens: ["gluten"] },
  { sku: "DRG-003", en: "Basmati rice", ar: "أرز بسمتي", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 5.8, storage: "ambient" },
  { sku: "DRG-004", en: "Plain flour", ar: "دقيق فاخر", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 2.2, storage: "ambient", allergens: ["gluten"] },
  { sku: "DRG-005", en: "Caster sugar", ar: "سكر ناعم", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 2.9, storage: "ambient" },
  { sku: "DRG-006", en: "Sunflower oil", ar: "زيت دوار الشمس", catEn: "Pantry", catAr: "المؤن", base: "ml", purchase: "l", conversion: 1000, cost: 5.1, storage: "ambient" },
  { sku: "DRG-007", en: "Olive oil extra virgin", ar: "زيت زيتون بكر", catEn: "Pantry", catAr: "المؤن", base: "ml", purchase: "l", conversion: 1000, cost: 21.0, storage: "ambient" },
  { sku: "DRG-008", en: "Tomato passata", ar: "صلصة طماطم مصفاة", catEn: "Pantry", catAr: "المؤن", base: "ml", purchase: "l", conversion: 1000, cost: 6.2, storage: "ambient", batch: true, expiry: true, shelfLife: 365 },
  { sku: "DRG-009", en: "Salt", ar: "ملح", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 0.4, storage: "ambient" },
  { sku: "DRG-010", en: "Black pepper ground", ar: "فلفل أسود مطحون", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 34.0, storage: "ambient" },
  { sku: "DRG-011", en: "Shawarma spice mix", ar: "خلطة بهارات شاورما", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 28.5, storage: "ambient" },
  { sku: "DRG-012", en: "Saffron threads", ar: "خيوط زعفران", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "g", conversion: 1, cost: 980, storage: "ambient" },
  { sku: "DRG-013", en: "Sesame seeds", ar: "بذور سمسم", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 8.4, storage: "ambient", allergens: ["sesame"] },
  { sku: "DRG-014", en: "Chickpeas dried", ar: "حمص جاف", catEn: "Dry goods", catAr: "المواد الجافة", base: "g", purchase: "kg", conversion: 1000, cost: 3.6, storage: "ambient" },
  { sku: "DRG-015", en: "Mayonnaise", ar: "مايونيز", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 11.2, storage: "chilled", expiry: true, shelfLife: 60, allergens: ["egg"] },
  { sku: "DRG-016", en: "Ketchup", ar: "كاتشب", catEn: "Pantry", catAr: "المؤن", base: "g", purchase: "kg", conversion: 1000, cost: 6.4, storage: "ambient" },

  // Coffee and beverages
  { sku: "BEV-001", en: "Espresso beans", ar: "حبوب إسبريسو", catEn: "Coffee", catAr: "القهوة", base: "g", purchase: "kg", conversion: 1000, cost: 46.0, storage: "ambient", batch: true, expiry: true, shelfLife: 120 },
  { sku: "BEV-002", en: "Filter coffee beans", ar: "حبوب قهوة مرشحة", catEn: "Coffee", catAr: "القهوة", base: "g", purchase: "kg", conversion: 1000, cost: 39.0, storage: "ambient", batch: true, expiry: true, shelfLife: 120 },
  { sku: "BEV-003", en: "Chocolate powder", ar: "مسحوق شوكولاتة", catEn: "Coffee", catAr: "القهوة", base: "g", purchase: "kg", conversion: 1000, cost: 24.0, storage: "ambient", allergens: ["milk"] },
  { sku: "BEV-004", en: "Vanilla syrup", ar: "شراب فانيليا", catEn: "Coffee", catAr: "القهوة", base: "ml", purchase: "l", conversion: 1000, cost: 13.5, storage: "ambient" },
  { sku: "BEV-005", en: "Soft drink can 330ml", ar: "مشروب غازي ٣٣٠ مل", catEn: "Beverages", catAr: "المشروبات", base: "pc", purchase: "case", conversion: 24, cost: 950, storage: "ambient", expiry: true, shelfLife: 270 },
  { sku: "BEV-006", en: "Mineral water 600ml", ar: "مياه معدنية ٦٠٠ مل", catEn: "Beverages", catAr: "المشروبات", base: "pc", purchase: "case", conversion: 12, cost: 420, storage: "ambient", expiry: true, shelfLife: 365 },
  { sku: "BEV-007", en: "Fresh orange", ar: "برتقال طازج", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 3.4, storage: "chilled", expiry: true, shelfLife: 12 },
  { sku: "BEV-008", en: "Mint leaves", ar: "أوراق نعناع", catEn: "Produce", catAr: "الخضروات", base: "g", purchase: "kg", conversion: 1000, cost: 8.0, storage: "chilled", expiry: true, shelfLife: 4 },

  // Packaging and disposables
  { sku: "PKG-001", en: "Takeaway box medium", ar: "علبة تيك أواي وسط", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "case", conversion: 500, cost: 185, storage: "ambient" },
  { sku: "PKG-002", en: "Paper bag", ar: "كيس ورقي", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "pack", conversion: 250, cost: 95, storage: "ambient" },
  { sku: "PKG-003", en: "Coffee cup 12oz", ar: "كوب قهوة ١٢ أونصة", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "case", conversion: 1000, cost: 145, storage: "ambient" },
  { sku: "PKG-004", en: "Cup lid", ar: "غطاء كوب", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "case", conversion: 1000, cost: 62, storage: "ambient" },
  { sku: "PKG-005", en: "Cutlery set", ar: "طقم أدوات مائدة", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "case", conversion: 500, cost: 78, storage: "ambient" },
  { sku: "PKG-006", en: "Foil wrap sheet", ar: "ورق ألومنيوم", catEn: "Packaging", catAr: "التغليف", base: "pc", purchase: "pack", conversion: 500, cost: 46, storage: "ambient" },
];

export const stockItems: StockItem[] = SEEDS.map((s, i) => ({
  id: seqId("itm", i + 1),
  tenantId: ACTIVE_TENANT_ID,
  sku: s.sku,
  name: { en: s.en, ar: s.ar },
  category: { en: s.catEn, ar: s.catAr },
  baseUnit: s.base,
  purchaseUnit: s.purchase,
  purchaseConversion: s.conversion,
  costingMethod: s.costing ?? "weighted_average",
  batchTracked: s.batch ?? false,
  expiryTracked: s.expiry ?? false,
  storage: s.storage,
  shelfLifeDays: s.shelfLife ?? null,
  defaultSupplierId: null,
  allergens: s.allergens ?? [],
  unitCost: { amount: s.cost, currency: "EGP" },
  active: true,
}));

export const stockItemById = new Map(stockItems.map((i) => [i.id, i]));
export const stockItemBySku = new Map(stockItems.map((i) => [i.sku, i]));

/** Look an item up by SKU during fixture construction. */
export function item(sku: string): StockItem {
  const found = stockItemBySku.get(sku);
  if (!found) throw new Error(`Unknown stock item SKU in fixtures: ${sku}`);
  return found;
}
