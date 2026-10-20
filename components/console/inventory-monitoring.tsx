"use client";
import { useState } from "react";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { useAction } from "@/lib/console/actions";
import { Button, Callout, Field, Input, Select } from "@/components/console/ui";

export function InventoryMonitoringPanel() {
  const { scope } = useSession();
  return <MonitoringData key={`${scope.tenantId}:${scope.branchId}`} />;
}
function MonitoringData() {
  const { t } = useI18n();
  const { scope } = useSession();
  const state = useAsync(
    () => services.inventory.monitoring(),
    [scope.tenantId, scope.branchId],
  );
  if (!state.data)
    return <Callout tone="warn">{t("inv.monitoringUnavailable")}</Callout>;
  const data = state.data;
  const findingLabels: Record<string,string> = {
    'inventory.low_stock': t('inv.monitoringLow'), 'inventory.negative_stock': t('inv.monitoringNegative'),
    'inventory.expiry': t('inv.monitoringExpiry'), 'inventory.stock_zero': t('inv.monitoringZero'),
    'inventory.ledger_projection_divergence': t('inv.monitoringReconciliation'),
  };
  const active = data.findings.filter((f) => f.status === "active");
  const resolved = data.findings.filter((f) => f.status === "resolved");
  const verified = [
    "inventory.stock_monitoring",
    "inventory.daily_reconciliation",
  ].every((type) =>
    data.jobs.some((j) => j.jobType === type && j.state === "succeeded"),
  );
  return (
    <section className="space-y-2" aria-label={t("inv.monitoringTitle")}>
      <Callout tone="warn">{t("inv.monitoringDelivery")}</Callout>
      <p className="text-xs">{t("inv.monitoringTenantScope")}</p>
      {!data.schedulerEnabled ? (
        <Callout tone="warn">{t("inv.monitoringDisabled")}</Callout>
      ) : null}
      {!verified ? (
        <Callout tone="warn">{t("inv.monitoringUnverified")}</Callout>
      ) : null}
      {["inventory.stock_monitoring", "inventory.daily_reconciliation"].map(type => {
        const latest = data.jobs.find(job => job.jobType === type);
        return <p key={type} className="text-xs">{type === "inventory.stock_monitoring" ? t("inv.monitoringExpiry") : t("inv.monitoringReconciliation")}: {latest ? `${t(("inv.job." + latest.state) as never)} · ${latest.scheduledFor}` : t("inv.job.notRun")}</p>;
      })}
      <p className="text-sm">
        {t("inv.monitoringActive")}: {active.length} ·{" "}
        {t("inv.monitoringResolved")}: {resolved.length}
      </p>
      {active.map((f) => (
        <Callout key={f.id} tone="warn" title={findingLabels[f.code] ?? t("inv.monitoringTitle")}>
          {f.lastObservedAt}
        </Callout>
      ))}
      {data.jobs
        .filter(
          (j) =>
            j.state === "failed" || (j.state === "pending" && j.attempt > 0),
        )
        .map((j) => (
          <Callout
            key={`${j.jobType}:${j.occurrenceKey}`}
            tone="bad"
            title={t("inv.monitoringFailure")}
          >
            {j.jobType} · {j.outcomeCode} · {j.occurrenceKey}
          </Callout>
        ))}
    </section>
  );
}

export function CategoryExpiryHorizons({ onSaved }: { onSaved: () => void }) {
  const canConfigure = usePermission("inventory.adjust");
  const { scope } = useSession();
  return canConfigure ? (
    <CategoryExpiryEditor key={scope.tenantId} onSaved={onSaved} />
  ) : null;
}
function CategoryExpiryEditor({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const { scope } = useSession();
  const categories = useAsync(
    () => services.inventory.expiryCategories(),
    [scope.tenantId],
  );
  const action = useAction();
  const [id, setId] = useState("");
  const [value, setValue] = useState("7,3,1");
  const parts = value.split(",").map((v) => v.trim());
  const horizons = parts.map(Number);
  const valid =
    !!id &&
    parts.length > 0 &&
    parts.length <= 12 &&
    parts.every((p) => /^\d+$/.test(p)) &&
    horizons.every((h) => h <= 3650) &&
    new Set(horizons).size === horizons.length;
  if (!categories.data) return null;
  return (
    <section className="flex flex-wrap items-end gap-3">
      <Field label={t("inv.expiryCategory")}>
        <Select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setValue(
              (
                categories.data?.find((c) => c.id === e.target.value)
                  ?.expiryAlertHorizons ?? [7, 3, 1]
              ).join(","),
            );
          }}
        >
          <option value="">—</option>
          {categories.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("inv.expiryHorizons")}>
        <Input
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button
        disabled={!valid}
        loading={action.pending}
        onClick={() =>
          action.run(
            () => services.inventory.setCategoryExpiryHorizons(id, horizons),
            { onSuccess: onSaved },
          )
        }
      >
        {t("inv.expirySave")}
      </Button>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
    </section>
  );
}
