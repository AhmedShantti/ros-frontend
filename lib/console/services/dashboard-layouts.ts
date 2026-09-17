"use client";

/**
 * Dashboard layouts — FR-RPT-034.
 *
 * Two kinds of row in one collection: a user's own arrangement, and the
 * tenant's default for a role. The backend has no layout endpoint, so both
 * live in the browser-local store behind this interface under either data
 * mode; a server implementation replaces this file and nothing else.
 */

import type { IsoDateTime } from "../types";
import type { RoleKey } from "../permissions";
import { localCollection, nowIso } from "../local-store";
import { sanitise, type WidgetId } from "../reports/dashboard-layout";
import { getActiveTenantId } from "./tenant-context";

export interface StoredDashboardLayout {
  /** `user:<userKey>` or `role:<roleKey>`. */
  id: string;
  kind: "user" | "role_default";
  ownerKey: string;
  roleKey: RoleKey;
  widgets: WidgetId[];
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface DashboardLayoutService {
  getUserLayout(userKey: string): Promise<StoredDashboardLayout | null>;
  saveUserLayout(userKey: string, roleKey: RoleKey, widgets: WidgetId[]): Promise<StoredDashboardLayout>;
  /** Back to whatever the role default resolves to. */
  clearUserLayout(userKey: string): Promise<void>;
  getRoleDefault(roleKey: RoleKey): Promise<StoredDashboardLayout | null>;
  listRoleDefaults(): Promise<StoredDashboardLayout[]>;
  saveRoleDefault(roleKey: RoleKey, widgets: WidgetId[], by: string): Promise<StoredDashboardLayout>;
  clearRoleDefault(roleKey: RoleKey): Promise<void>;
}

const store = localCollection<StoredDashboardLayout>(
  { name: "dashboardLayouts", idOf: (row) => row.id },
  getActiveTenantId,
);

async function upsert(row: StoredDashboardLayout): Promise<StoredDashboardLayout> {
  const rows = await store.all();
  const next = [row, ...rows.filter((entry) => entry.id !== row.id)];
  await store.replace(next);
  return row;
}

async function drop(id: string): Promise<void> {
  const rows = await store.all();
  await store.replace(rows.filter((entry) => entry.id !== id));
}

export const dashboardLayoutService: DashboardLayoutService = {
  async getUserLayout(userKey) {
    return (await store.get(`user:${userKey}`)) ?? null;
  },
  saveUserLayout(userKey, roleKey, widgets) {
    return upsert({
      id: `user:${userKey}`,
      kind: "user",
      ownerKey: userKey,
      roleKey,
      widgets: sanitise(widgets),
      updatedAt: nowIso(),
      updatedBy: userKey,
    });
  },
  clearUserLayout(userKey) {
    return drop(`user:${userKey}`);
  },
  async getRoleDefault(roleKey) {
    return (await store.get(`role:${roleKey}`)) ?? null;
  },
  async listRoleDefaults() {
    return (await store.all()).filter((row) => row.kind === "role_default");
  },
  saveRoleDefault(roleKey, widgets, by) {
    return upsert({
      id: `role:${roleKey}`,
      kind: "role_default",
      ownerKey: roleKey,
      roleKey,
      widgets: sanitise(widgets),
      updatedAt: nowIso(),
      updatedBy: by,
    });
  },
  clearRoleDefault(roleKey) {
    return drop(`role:${roleKey}`);
  },
};
