"use client";

/**
 * Alerts and delivery — SRS §19.5, FR-RPT-040, FR-RPT-041, FR-RPT-045, FR-RPT-046.
 *
 * "Reports arrive; they are not fetched" (§19.1). This is where a manager
 * decides what arrives, when, and — just as important — what does not:
 * the rate limits and dedupe windows that keep alerting usable. See
 * `lib/console/delivery.ts` for the policy itself.
 */

import { useState } from "react";

import { useI18n } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { PageBody, PageHeader } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import { AlertRulesPanel, MorningBriefPanel, SchedulesPanel } from "@/components/console/delivery-editor";
import { Tabs, Toast } from "@/components/console/ui";

type Tab = "alerts" | "schedules" | "brief";

export default function DeliveryPage() {
  return (
    <Gate
      permissions={[
        "report.export",
        "settings.branch.manage",
        "settings.tenant.manage",
        "report.view.sales",
        "report.view.financial",
      ]}
    >
      <DeliveryScreen />
    </Gate>
  );
}

function DeliveryScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("alerts");
  const [message, setMessage] = useTransientMessage();

  return (
    <>
      <PageHeader
        title={t("dlv.title")}
        subtitle={t("dlv.subtitle")}
        spec="§19.5"
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
      />

      <PageBody>
        <Tabs
          value={tab}
          onChange={setTab}
          label={t("dlv.title")}
          options={[
            { value: "alerts", label: t("dlv.tabAlerts") },
            { value: "schedules", label: t("dlv.tabSchedules") },
            { value: "brief", label: t("dlv.tabBrief") },
          ]}
        />

        {tab === "alerts" ? (
          <AlertRulesPanel notify={setMessage} />
        ) : tab === "schedules" ? (
          <SchedulesPanel notify={setMessage} />
        ) : (
          <MorningBriefPanel notify={setMessage} />
        )}
      </PageBody>

      <Toast message={message} />
    </>
  );
}
