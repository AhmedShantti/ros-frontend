"use client";

/**
 * Leave — SRS §14.3, FR-HRM-017.
 *
 * Requests, the manager's decision, and a balance per configured leave type.
 * No leave endpoint exists on the server, so this runs on the browser-local
 * store behind `services.workforceHr`; see that module.
 */

import { Gate } from "@/components/console/states";
import { PageBody, PageHeader } from "@/components/console/page";
import { Callout, Toast } from "@/components/console/ui";
import { LeaveScreenBody } from "@/components/console/workforce-leave";
import { useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";

export default function LeavePage() {
  return (
    <Gate permissions={["hr.employee.view"]}>
      <LeaveScreen />
    </Gate>
  );
}

function LeaveScreen() {
  const { t } = useI18n();
  const [message, setMessage] = useTransientMessage();
  return (
    <>
      <PageHeader title={t("wf.leave.title")} subtitle={t("wf.leave.subtitle")} spec="FR-HRM-017" />
      <PageBody>
        <Callout tone="muted">{t("wf.leave.localNote")}</Callout>
        <LeaveScreenBody onMessage={setMessage} />
      </PageBody>
      <Toast message={message} />
    </>
  );
}
