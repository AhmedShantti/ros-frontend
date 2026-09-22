"use client";

/**
 * Menu Management — one workspace for menus, categories, items, prices,
 * availability, combos and customizations.
 *
 * Sits beside the existing `/menu/*` screens (menus, categories, items,
 * modifiers, combos, pricing) rather than replacing them, so the two
 * approaches can be compared. The workspace itself lives in
 * `components/console/menu-management/`; its data layer, in
 * `lib/console/menu-management/`.
 */

import { Gate } from "@/components/console/states";
import MenuManagement from "@/components/console/menu-management/menu-management";

export default function MenuManagementPage() {
  return (
    <Gate permissions={["menu.item.read"]}>
      <MenuManagement />
    </Gate>
  );
}
