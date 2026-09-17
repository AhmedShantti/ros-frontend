"use client";

/**
 * Organisation lifecycle — SRS §6: FR-PLT-003, FR-PLT-021, FR-PLT-022,
 * FR-PLT-023.
 *
 * Identity (the fixed tenant id), plan usage and the read-only state it can
 * produce, a full data export, and two-step termination. Readable with
 * tenant settings or audit access; termination is the owner's alone.
 */

import { useI18n } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { PageBody, PageHeader } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import {
  DataExportCard,
  PlanUsageCard,
  TenantIdentityCard,
  TerminationCard,
} from "@/components/console/tenant-lifecycle";
import { Toast } from "@/components/console/ui";

export default function TenantLifecyclePage() {
  return (
    <Gate permissions={["settings.tenant.manage", "platform.tenant.manage"]}>
      <TenantScreen />
    </Gate>
  );
}

function TenantScreen() {
  const { t } = useI18n();
  const [message, setMessage] = useTransientMessage();

  return (
    <>
      <PageHeader
        title={t("tnt.title")}
        subtitle={t("tnt.subtitle")}
        spec="§6"
        crumbs={[{ label: t("nav.settings"), href: "/settings" }, { label: t("tnt.title") }]}
      />
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-2">
          <TenantIdentityCard notify={setMessage} />
          <PlanUsageCard />
        </div>
        <DataExportCard notify={setMessage} />
        <TerminationCard notify={setMessage} />
      </PageBody>
      <Toast message={message} />
    </>
  );
}
