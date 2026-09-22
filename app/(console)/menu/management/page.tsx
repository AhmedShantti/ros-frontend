"use client";

/**
 * Menu Management — one workspace for menus, categories and items.
 *
 * Sits beside the existing `/menu/*` screens (menus, categories, items,
 * modifiers, combos, pricing) rather than replacing them, so the two
 * approaches can be compared. Renders one of two, wholly different,
 * implementations depending on `DATA_MODE` — the console's own
 * production/demo switch (`lib/api/config.ts`), never a bespoke env var of
 * this workspace's own:
 *
 *  - `"http"` (a real backend is configured) → `LiveMenuManagement`, which
 *    only offers what `/catalogue/*` actually implements.
 *  - `"mock"` (explicit demo mode, no backend) → the original `MenuManagement`
 *    sandbox, which still simulates the full concept (combos, per-channel/
 *    per-size pricing, a publish/dirty flag) against an empty in-memory
 *    store, since that has always been honestly a demo of the intended
 *    product shape, never a claim about what a live backend does.
 *
 * See `components/console/menu-management/live-menu-management.tsx` for the
 * production implementation and the gaps it reports rather than fakes.
 */

import { Gate } from "@/components/console/states";
import { DATA_MODE } from "@/lib/api/config";
import MenuManagement from "@/components/console/menu-management/menu-management";
import LiveMenuManagement from "@/components/console/menu-management/live-menu-management";

export default function MenuManagementPage() {
  return (
    <Gate permissions={["menu.item.read"]}>
      {DATA_MODE === "http" ? <LiveMenuManagement /> : <MenuManagement />}
    </Gate>
  );
}
