"use client";

/**
 * Security settings — SRS §15: FR-SEC-025, FR-SEC-034/035, FR-SEC-052,
 * FR-SEC-053, FR-SEC-060, and the security event log.
 *
 * Tenant-level controls, gated on `settings.tenant.manage` to change and
 * readable by auditors (`audit.view`). Every card states what the console
 * can enforce itself and what waits on the server.
 */

import { useState } from "react";

import { useI18n, useSession } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { PageBody, PageHeader } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import {
  ApprovalPolicyCard,
  ClassificationRegister,
  IpAllowListCard,
  PasswordPolicyCard,
  SecurityIntro,
  SiemCard,
} from "@/components/console/security-policies";
import { SecurityEventLog } from "@/components/console/security-event-log";
import { Tabs, Toast } from "@/components/console/ui";

type Tab = "access" | "network" | "siem" | "classification" | "events";

export default function SecuritySettingsPage() {
  return (
    <Gate permissions={["settings.tenant.manage", "audit.view"]}>
      <SecurityScreen />
    </Gate>
  );
}

function SecurityScreen() {
  const { t } = useI18n();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("access");
  const [message, setMessage] = useTransientMessage();
  const canEdit = can("settings.tenant.manage");

  return (
    <>
      <PageHeader
        title={t("secp.title")}
        subtitle={t("secp.subtitle")}
        spec="§15"
        crumbs={[{ label: t("nav.settings"), href: "/settings" }, { label: t("secp.title") }]}
      />
      <PageBody>
        <SecurityIntro>{canEdit ? t("secp.intro") : t("secp.readOnly")}</SecurityIntro>
        <Tabs
          value={tab}
          onChange={setTab}
          label={t("secp.title")}
          options={[
            { value: "access", label: t("secp.tab.access") },
            { value: "network", label: t("secp.tab.network") },
            { value: "siem", label: t("secp.tab.siem") },
            { value: "classification", label: t("secp.tab.classification") },
            { value: "events", label: t("secp.tab.events") },
          ]}
        />
        {tab === "access" ? (
          <>
            <PasswordPolicyCard notify={setMessage} canEdit={canEdit} />
            <ApprovalPolicyCard notify={setMessage} canEdit={canEdit} />
          </>
        ) : tab === "network" ? (
          <IpAllowListCard notify={setMessage} canEdit={canEdit} />
        ) : tab === "siem" ? (
          <SiemCard notify={setMessage} canEdit={canEdit} />
        ) : tab === "classification" ? (
          <ClassificationRegister />
        ) : (
          <SecurityEventLog
            title={t("sev.title")}
            hint={t("sev.hint")}
            spec="FR-SEC-053"
            canExport={can("audit.view")}
          />
        )}
      </PageBody>
      <Toast message={message} />
    </>
  );
}
