"use client";

/**
 * The loading, failure and provenance states shared by every screen built on
 * the whole movement ledger (`useLedger`). Reading it is one request per
 * item, so progress is shown as a count rather than a spinner, and items
 * whose ledger could not be read are named — a report that silently drops
 * them would look complete and not be.
 */

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import type { LedgerState } from "@/lib/console/inventory-ledger";
import { useI18n } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { ErrorPanel } from "@/components/console/states";
import { Button, Callout, Card, Meter } from "@/components/console/ui";

export function LedgerGate({ state, children }: { state: LedgerState; children: (ledger: NonNullable<LedgerState["ledger"]>) => ReactNode }) {
  const { t, fmt } = useI18n();

  if (state.error) return <ErrorPanel error={state.error} onRetry={state.reload} />;

  if (state.loading || !state.ledger) {
    const { done, total } = state.progress;
    return (
      <Card>
        <p className="text-fg text-sm font-medium">{t("invx.ledger.reading")}</p>
        <p className="text-fg-subtle mt-1 text-xs">
          {t("invx.ledger.progress")
            .replace("{done}", formatNumber(done, fmt))
            .replace("{total}", formatNumber(total, fmt))}
        </p>
        <Meter className="mt-3" value={total === 0 ? 5 : (done / total) * 100} />
      </Card>
    );
  }

  const ledger = state.ledger;
  return (
    <>
      {ledger.failures.length > 0 ? (
        <Callout tone="warn" title={t("invx.ledger.partialTitle").replace("{n}", String(ledger.failures.length))}>
          <p>{t("invx.ledger.partialBody")}</p>
          <ul className="mt-1 list-disc ps-4">
            {ledger.failures.slice(0, 5).map((failure) => {
              const item = state.items.find((row) => row.id === failure.itemId);
              return (
                <li key={failure.itemId}>
                  {item?.sku ?? failure.itemId}: {failure.message}
                </li>
              );
            })}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" icon={<RefreshCw size={12} />} onClick={state.reload}>
            {t("common.refresh")}
          </Button>
        </Callout>
      ) : null}
      {children(ledger)}
    </>
  );
}
