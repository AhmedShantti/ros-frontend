/**
 * The allergen catalogue — FR-INV-001, FR-MNU-005.
 *
 * One list, used by the stock item master (where an allergen is declared)
 * and the menu (where it surfaces through the recipe). Codes are stable and
 * match what the seeded catalogue already carries (`egg`, `shellfish`), so a
 * declaration made on either side reads the same on the other.
 *
 * The fourteen regulated in most of the markets ROS ships to, in the order
 * menus conventionally print them.
 */

import type { Localised } from "./types";

export interface AllergenDefinition {
  code: string;
  label: Localised;
}

export const ALLERGENS: AllergenDefinition[] = [
  { code: "gluten", label: { en: "Gluten", ar: "الغلوتين" } },
  { code: "shellfish", label: { en: "Crustaceans", ar: "القشريات" } },
  { code: "egg", label: { en: "Eggs", ar: "البيض" } },
  { code: "fish", label: { en: "Fish", ar: "الأسماك" } },
  { code: "peanuts", label: { en: "Peanuts", ar: "الفول السوداني" } },
  { code: "soy", label: { en: "Soya", ar: "الصويا" } },
  { code: "milk", label: { en: "Milk", ar: "الحليب" } },
  { code: "tree_nuts", label: { en: "Tree nuts", ar: "المكسرات" } },
  { code: "celery", label: { en: "Celery", ar: "الكرفس" } },
  { code: "mustard", label: { en: "Mustard", ar: "الخردل" } },
  { code: "sesame", label: { en: "Sesame", ar: "السمسم" } },
  { code: "sulphites", label: { en: "Sulphites", ar: "الكبريتيت" } },
  { code: "lupin", label: { en: "Lupin", ar: "الترمس" } },
  { code: "molluscs", label: { en: "Molluscs", ar: "الرخويات" } },
];

const BY_CODE = new Map(ALLERGENS.map((row) => [row.code, row]));

/** A label for any code, including one the catalogue does not know. */
export function allergenLabel(code: string): Localised {
  return BY_CODE.get(code)?.label ?? { en: code, ar: code };
}
