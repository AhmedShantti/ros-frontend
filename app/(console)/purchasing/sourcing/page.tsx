"use client";

/**
 * Sourcing — SRS §12.3, FR-PRC-006, FR-PRC-007, FR-PRC-010.
 *
 * Price lists, the preference ranking per item, and approved suppliers per
 * category. The order form reads all three while an order is raised (see
 * `OrderSourcingChecks`), so what is set here is what a requester is held to.
 */

import { useState } from "react";

import { useI18n } from "@/lib/console/providers";
import { PageBody, PageHeader } from "@/components/console/page";
import { ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { useStockItemList, useSupplierList } from "@/components/console/purchasing-shared";
import { ApprovedSuppliersTab, PriceListTab, SupplierRankingTab } from "@/components/console/purchasing-sourcing";
import { Callout, Tabs } from "@/components/console/ui";

type Tab = "prices" | "ranking" | "approved";

export default function SourcingPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <SourcingScreen />
    </Gate>
  );
}

function SourcingScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("prices");
  const suppliers = useSupplierList();
  const items = useStockItemList();

  return (
    <>
      <PageHeader title={t("prc.sourcing.title")} subtitle={t("prc.sourcing.subtitle")} spec="FR-PRC-006" />
      <PageBody>
        <Callout tone="muted">{t("prc.localNote")}</Callout>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          label={t("prc.sourcing.title")}
          options={[
            { value: "prices", label: t("prc.sourcing.tabPrices") },
            { value: "ranking", label: t("prc.sourcing.tabRanking") },
            { value: "approved", label: t("prc.sourcing.tabApproved") },
          ]}
        />
        {suppliers.error ? (
          <ErrorPanel error={suppliers.error} onRetry={suppliers.reload} />
        ) : suppliers.loading || items.loading ? (
          <LoadingPanel />
        ) : tab === "prices" ? (
          <PriceListTab suppliers={suppliers.rows} items={items.rows} />
        ) : tab === "ranking" ? (
          <SupplierRankingTab suppliers={suppliers.rows} items={items.rows} />
        ) : (
          <ApprovedSuppliersTab suppliers={suppliers.rows} items={items.rows} />
        )}
      </PageBody>
    </>
  );
}
