"use client";

/**
 * Menu Management — one workspace for menus, categories and items.
 *
 * `LiveMenuManagement` IS the Menu Management product, unconditionally —
 * `DATA_MODE` (`lib/api/config.ts`) only ever chooses which `services`
 * implementation it talks to (`http.ts` against a real backend, `mock.ts`'s
 * in-memory canonical model when none is configured); it never chooses which
 * UI renders. A plain `npm run dev` with no `NEXT_PUBLIC_API_URL` therefore
 * still shows the real workspace, backed by the in-memory canonical service
 * layer, not a separate sandbox — so a local visual review can never
 * silently diverge from what production renders.
 *
 * The earlier `MenuManagement` sandbox (`./menu-management.tsx`) simulated
 * concepts the real backend does not have (per-channel/per-size pricing, a
 * three-way hidden/unavailable/available status, duplicate, hard delete) and
 * is kept only as inert reference code — nothing routes to it any more.
 */

import { Gate } from "@/components/console/states";
import LiveMenuManagement from "@/components/console/menu-management/live-menu-management";

export default function MenuManagementPage() {
  return (
    <Gate permissions={["menu.item.read"]}>
      <LiveMenuManagement />
    </Gate>
  );
}
