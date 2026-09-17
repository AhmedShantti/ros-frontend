"use client";

/**
 * The workforce settings, resolved through the configuration cascade for a
 * branch (and, on a till, its terminal) — FR-HRM-023, FR-HRM-026, FR-HRM-027.
 *
 * One hook so the till's clock panel and the console's attendance screen
 * read the same effective value; `resolveSetting` does the walking.
 */

import { services } from "./services";
import { useAsync } from "./hooks";
import { useSession } from "./providers";
import { SETTING_BY_KEY, resolveSetting } from "./settings";
import type { BreakPolicy } from "./workforce-rules";

export interface WorkforceSettings {
  earlyClockInMinutes: number;
  clockInPhoto: boolean;
  breakPolicy: BreakPolicy;
  loading: boolean;
}

export function useWorkforceSettings(context: { branchId: string | null; terminalId?: string | null }): WorkforceSettings {
  const { tenant } = useSession();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);
  const rows = overrides.data ?? [];

  const value = (key: string) =>
    resolveSetting(SETTING_BY_KEY.get(key)!, rows, {
      countryCode: tenant.countryCode,
      tenantId: tenant.id,
      brandId: null,
      branchId: context.branchId,
      terminalId: context.terminalId ?? null,
    }).value;

  return {
    earlyClockInMinutes: Math.max(0, Number(value("hr.earlyClockInMinutes")) || 0),
    clockInPhoto: value("hr.clockInPhoto") === true,
    breakPolicy: {
      paidRestMinutes: Math.max(0, Number(value("hr.paidRestMinutes")) || 0),
      mealBreakPaid: value("hr.mealBreakPaid") === true,
    },
    loading: overrides.loading,
  };
}
