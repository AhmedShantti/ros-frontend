"use client";

/**
 * Franchise — SRS §17.7, FR-BRN-035 … FR-BRN-037.
 *
 * Agreements set what a franchisee may change and what they owe; royalties
 * turn net sales into statements; compliance shows the franchisor where a
 * franchised branch has drifted from the brand. See the three tab components
 * for the detail of each.
 */

import { useState } from "react";

import { useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { PageBody, PageHeader } from "@/components/console/page";
import { Gate } from "@/components/console/states";
import { Tabs, Toast } from "@/components/console/ui";
import { FranchiseAgreementsTab } from "@/components/console/franchise-agreements";
import { FranchiseRoyaltiesTab } from "@/components/console/franchise-royalties";
import { FranchiseComplianceTab } from "@/components/console/franchise-compliance";

type Tab = "agreements" | "royalties" | "compliance";

export default function FranchisePage() {
  return (
    <Gate permissions={["org.manage", "report.view.financial"]}>
      <FranchiseScreen />
    </Gate>
  );
}

function FranchiseScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("agreements");
  const [message, setMessage] = useTransientMessage();

  return (
    <>
      <PageHeader
        title={t("frn.title")}
        subtitle={t("frn.subtitle")}
        spec={tab === "agreements" ? "FR-BRN-035" : tab === "royalties" ? "FR-BRN-036" : "FR-BRN-037"}
      />
      <PageBody>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          label={t("frn.title")}
          options={[
            { value: "agreements", label: t("frn.tab.agreements") },
            { value: "royalties", label: t("frn.tab.royalties") },
            { value: "compliance", label: t("frn.tab.compliance") },
          ]}
        />
        {tab === "agreements" ? <FranchiseAgreementsTab notify={setMessage} /> : null}
        {tab === "royalties" ? <FranchiseRoyaltiesTab notify={setMessage} /> : null}
        {tab === "compliance" ? <FranchiseComplianceTab notify={setMessage} /> : null}
      </PageBody>
      <Toast message={message} />
    </>
  );
}
