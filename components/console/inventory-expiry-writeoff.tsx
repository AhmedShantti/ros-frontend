"use client";

/**
 * Expiry write-off at day close — SRS FR-INV-026.
 *
 * "Automatic write-off of expired batches at day close, configurable per item
 * category, creating waste records with reason expired."
 *
 * The configuration is here: which categories write off automatically, and
 * the reason code the waste records carry. The *automatic* part — running the
 * rule as the business day closes — belongs to the server's day-close job,
 * which does not exist yet, and the panel says so rather than pretending.
 * What it offers instead is the same rule run on demand: a preview of exactly
 * which expired batches the day-close run would write off, and a button that
 * posts those waste records through the real waste endpoint, batch by batch,
 * with each outcome kept in the run log.
 */

import { useMemo, useState } from "react";
import { CalendarX2, PlayCircle } from "lucide-react";

import type { Batch, StockItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ReasonCode } from "@/lib/console/services/types";
import {
  writeOffEnabledFor,
  type ExpiryWriteOffPolicy,
  type ExpiryWriteOffRun,
  type ExpiryWriteOffRunLine,
} from "@/lib/console/services/inventory-controls";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatNumber, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { useConfirm } from "@/components/console/confirm";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Field, Select, Toggle } from "@/components/console/ui";

interface Loaded {
  policy: ExpiryWriteOffPolicy;
  runs: ExpiryWriteOffRun[];
  items: StockItem[];
  reasons: ReasonCode[];
  expired: Batch[];
}

export function ExpiryWriteOffPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const { t } = useI18n();
  const data = useAsync<Loaded>(async () => {
    const [policy, runs, items, reasons, batches] = await Promise.all([
      services.inventoryControls.expiry.policy(),
      services.inventoryControls.expiry.runs(),
      services.inventory.items.list({ limit: 5000 }).then((page) => page.rows),
      services.inventory.reasonCodes().catch(() => [] as ReasonCode[]),
      services.inventory.batches.list({ limit: 5000, filters: { days: "0" } }).then((page) => page.rows),
    ]);
    return { policy, runs, items, reasons, expired: batches.filter((batch) => batch.daysToExpiry < 0 && Number(batch.quantity.value) > 0) };
  }, []);

  return (
    <Section title={t("invx.exp.title")} hint={t("invx.exp.hint")} spec="FR-INV-026">
      <AsyncPanel state={data}>
        {(loaded) => (
          <WriteOffBody
            key={loaded.policy.updatedAt ?? "p"}
            loaded={loaded}
            onChanged={(note) => {
              onChanged(note);
              data.reload();
            }}
          />
        )}
      </AsyncPanel>
    </Section>
  );
}

function WriteOffBody({ loaded, onChanged }: { loaded: Loaded; onChanged: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { session, tenant } = useSession();
  const canConfigure = usePermission("inventory.adjust");
  const canRecord = usePermission("inventory.waste.record");
  const confirm = useConfirm();
  const action = useAction();
  const [policy, setPolicy] = useState(loaded.policy);
  const dirty = JSON.stringify(policy) !== JSON.stringify(loaded.policy);

  const itemById = useMemo(() => new Map(loaded.items.map((item) => [item.id, item])), [loaded.items]);
  const categories = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of loaded.items) names.set(item.category.en || "—", tx(item.category) || "—");
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [loaded.items, tx]);

  const categoryOf = (batch: Batch) => itemById.get(batch.itemId)?.category.en || "—";
  const due = loaded.expired.filter((batch) => writeOffEnabledFor(policy, categoryOf(batch)));
  const dueValue = due.reduce((sum, batch) => sum + batch.value.amount, 0);
  const reasonKnown = loaded.reasons.length === 0 || loaded.reasons.some((row) => row.code === policy.reasonCode);

  async function save() {
    await action.run(() => services.inventoryControls.expiry.savePolicy({ ...policy, updatedBy: session?.user.email ?? null }), {
      onSuccess: () => onChanged(t("invx.exp.saved")),
    });
  }

  async function run() {
    const ok = await confirm({
      title: t("invx.exp.runTitle"),
      body: t("invx.exp.runBody")
        .replace("{n}", String(due.length))
        .replace("{value}", formatMoney(money(dueValue, tenant.baseCurrency), fmt)),
      confirmLabel: t("invx.exp.runConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(async () => {
      const lines: ExpiryWriteOffRunLine[] = [];
      for (const batch of due) {
        const base = {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          itemId: batch.itemId,
          itemName: batch.itemName,
          locationId: batch.locationId,
          locationName: batch.locationName,
          quantity: batch.quantity.value,
          unit: batch.quantity.unit,
          valueMinor: batch.value.amount,
        };
        try {
          await services.inventory.waste.create({
            locationId: batch.locationId,
            itemId: batch.itemId,
            quantity: batch.quantity,
            reasonCode: policy.reasonCode,
            isTrueWaste: true,
            value: batch.value,
            recordedAt: new Date().toISOString(),
            notes: t("invx.exp.note").replace("{batch}", batch.batchNumber).replace("{date}", batch.expiryDate),
          });
          lines.push({ ...base, outcome: "posted", message: null });
        } catch (caught) {
          lines.push({ ...base, outcome: "failed", message: caught instanceof Error ? caught.message : String(caught) });
        }
      }
      await services.inventoryControls.expiry.recordRun({
        businessDay: new Date().toISOString().slice(0, 10),
        ranAt: new Date().toISOString(),
        ranBy: session?.user.email ?? null,
        lines,
      });
      const failed = lines.filter((line) => line.outcome === "failed").length;
      onChanged(
        failed > 0
          ? t("invx.exp.ranWithFailures").replace("{ok}", String(lines.length - failed)).replace("{failed}", String(failed))
          : t("invx.exp.ran").replace("{n}", String(lines.length)),
      );
    });
  }

  const columns: Column<Batch>[] = [
    { key: "item", header: t("inv.item"), render: (row) => <CellStack primary={tx(row.itemName)} secondary={<span className="font-mono">{row.batchNumber}</span>} /> },
    { key: "location", header: t("common.location"), secondary: true, render: (row) => tx(row.locationName) },
    { key: "expired", header: t("inv.expiryDate"), render: (row) => formatDate(row.expiryDate, fmt) },
    { key: "qty", header: t("common.quantity"), numeric: true, render: (row) => <span dir="ltr" className="font-mono">{row.quantity.value} {row.quantity.unit}</span> },
    { key: "value", header: t("common.value"), numeric: true, render: (row) => formatMoney(row.value, fmt) },
  ];

  const lastRun = [...loaded.runs].sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0];

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <Callout tone="warn" icon={<CalendarX2 size={14} />} title={t("invx.exp.serverTitle")}>
        {t("invx.exp.serverBody")}
      </Callout>

      <fieldset disabled={!canConfigure} className="space-y-3">
        <Toggle
          checked={policy.defaultEnabled}
          onChange={(defaultEnabled) => setPolicy({ ...policy, defaultEnabled })}
          label={t("invx.exp.default")}
          hint={t("invx.exp.defaultHint")}
        />
        <div className="grid gap-x-6 sm:grid-cols-2">
          {categories.map(([key, label]) => (
            <Toggle
              key={key}
              checked={writeOffEnabledFor(policy, key)}
              onChange={(next) => setPolicy({ ...policy, categories: { ...policy.categories, [key]: next } })}
              label={label}
            />
          ))}
        </div>
        <Field label={t("invx.exp.reason")} hint={t("invx.exp.reasonHint")} error={reasonKnown ? undefined : t("invx.exp.reasonMissing")}>
          <Select value={policy.reasonCode} onChange={(event) => setPolicy({ ...policy, reasonCode: event.target.value })}>
            {loaded.reasons.length === 0 ? <option value={policy.reasonCode}>{policy.reasonCode}</option> : null}
            {loaded.reasons.map((reason) => (
              <option key={reason.id} value={reason.code}>
                {tx(reason.label)}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      {canConfigure ? (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={!dirty} loading={action.pending} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-fg text-sm font-medium">
            {t("invx.exp.preview")
              .replace("{n}", formatNumber(due.length, fmt))
              .replace("{value}", formatMoney(money(dueValue, tenant.baseCurrency), fmt))}
          </p>
          {dirty ? <p className="text-warn text-xs">{t("invx.exp.previewUnsaved")}</p> : null}
          {lastRun ? (
            <p className="text-fg-subtle text-xs">
              {t("invx.exp.lastRun")
                .replace("{at}", formatDateTime(lastRun.ranAt, fmt))
                .replace("{by}", lastRun.ranBy ?? "—")
                .replace("{n}", String(lastRun.lines.filter((line) => line.outcome === "posted").length))}
            </p>
          ) : null}
        </div>
        {canRecord ? (
          <Button variant="danger" size="sm" icon={<PlayCircle size={12} />} disabled={due.length === 0 || dirty || !reasonKnown} loading={action.pending} onClick={() => void run()}>
            {t("invx.exp.runNow")}
          </Button>
        ) : null}
      </div>

      <DataTable columns={columns} rows={due} rowKey={(row) => row.id} caption={t("invx.exp.title")} emptyTitle={t("invx.exp.nothing")} dense />

      {lastRun && lastRun.lines.some((line) => line.outcome !== "posted") ? (
        <Callout tone="bad" title={t("invx.exp.failuresTitle")}>
          <ul className="list-disc ps-4">
            {lastRun.lines
              .filter((line) => line.outcome !== "posted")
              .map((line) => (
                <li key={line.batchId}>
                  {line.batchNumber} · {tx(line.itemName)}: {line.message ?? t(`invx.exp.outcome.${line.outcome}` as ConsoleKey)}
                </li>
              ))}
          </ul>
        </Callout>
      ) : null}
      {lastRun ? (
        <p className="text-fg-subtle text-xs">
          <Badge tone="muted">{t("invx.exp.runs").replace("{n}", String(loaded.runs.length))}</Badge>
        </p>
      ) : null}
    </div>
  );
}
