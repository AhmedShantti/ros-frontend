"use client";

/**
 * Dashboard staffing panel — headcount from `GET /workforce/employees` and
 * today's attendance from the branch overview. When attendance cannot be
 * read for the scope, those tiles say so rather than show zeros.
 */

import Link from "next/link";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { MetricTile } from "@/components/console/charts";
import { Section, TileGrid } from "@/components/console/page";
import { AsyncPanel, CardSkeleton, Gate } from "@/components/console/states";
import { Callout } from "@/components/console/ui";

export function StaffingPanel() {
  const { t, fmt } = useI18n();
  const { scope } = useSession();
  const state = useAsync(
    () => services.workforce.staffingSummary(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  return (
    <Gate permissions={["hr.employee.view"]} silent>
      <Section title={t("wf.staffing")} hint={t("wf.staffingHint")}>
        <AsyncPanel state={state} skeleton={<CardSkeleton />}>
          {({ headcount, attendance }) => {
            const num = (value: number | undefined) =>
              value === undefined ? "—" : formatNumber(value, fmt);
            return (
              <div className="space-y-3">
                <TileGrid>
                  <MetricTile label={t("wf.headcount")} value={num(headcount.active)} />
                  <MetricTile label={t("wf.onShift")} value={num(attendance?.clockedIn)} />
                  <MetricTile label={t("wf.lateArrivals")} value={num(attendance?.lateArrivals)} />
                  <MetricTile
                    label={t("wf.missingClockOut")}
                    value={num(attendance?.missingClockOut)}
                  />
                </TileGrid>
                {!attendance ? <Callout tone="muted">{t("wf.attendanceUnavailable")}</Callout> : null}
                <div className="text-fg-subtle flex items-center justify-between text-xs">
                  <span>
                    {t("wf.suspendedCount")}: {num(headcount.suspended)}
                  </span>
                  <Link href="/workforce/employees" className="text-accent hover:underline">
                    {t("wf.manageStaff")}
                  </Link>
                </div>
              </div>
            );
          }}
        </AsyncPanel>
      </Section>
    </Gate>
  );
}
