"use client";

/**
 * Suggested transfers — SRS FR-BRN-017.
 *
 * "Where one location holds excess stock approaching expiry and another
 * location shows a shortage of the same item." Computed in the browser by
 * `suggestTransfers` from two real reads — batches near expiry and stock
 * levels — so the suggestion is only as current as those, and the screen says
 * when they were read. Nothing moves until someone acts: a suggestion becomes
 * a transfer request to the destination's manager, or, for a user who can
 * dispatch, a transfer straight away.
 */

import { useMemo, useState } from "react";
import { ArrowRight, RefreshCw, Send, Settings2 } from "lucide-react";

import type { Batch, StockLevel } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { suggestTransfers, type TransferSuggestion } from "@/lib/console/inventory-transfers";
import type { DetectionSettings } from "@/lib/console/services/inventory-controls";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, unitLabel } from "@/lib/console/format";
import { MoneyInput } from "@/components/console/fields";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Drawer, Field, Input, Toast } from "@/components/console/ui";
import type { RequestPrefill } from "@/components/console/inventory-transfer-requests";

interface SuggestionData {
  batches: Batch[];
  levels: StockLevel[];
  settings: DetectionSettings;
  openSuggestionIds: Set<string>;
  readAt: string;
}

export function TransferSuggestionsPanel({
  onRequest,
  onDispatch,
}: {
  onRequest: (prefill: RequestPrefill) => void;
  onDispatch: (suggestion: TransferSuggestion) => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { scope, tenant } = useSession();
  const canDispatch = usePermission("inventory.transfer.create");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const data = useAsync<SuggestionData>(async () => {
    const [settings, requests] = await Promise.all([
      services.inventoryControls.detection.settings(),
      services.transferRequests.all(),
    ]);
    const [batches, levels] = await Promise.all([
      services.inventory.batches
        .list({ limit: 5000, filters: { days: String(settings.transfers.horizonDays) } })
        .then((page) => page.rows),
      services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows),
    ]);
    const openSuggestionIds = new Set(
      requests
        .filter((row) => row.suggestionId && (row.status === "requested" || row.status === "approved" || row.status === "partially_approved"))
        .map((row) => row.suggestionId!),
    );
    return { batches, levels, settings, openSuggestionIds, readAt: new Date().toISOString() };
  }, []);

  const suggestions = useMemo(() => {
    if (!data.data) return [];
    const all = suggestTransfers(data.data.batches, data.data.levels, data.data.settings.transfers);
    return scope.branchId
      ? all.filter((row) => row.fromLocationId === scope.branchId || row.toLocationId === scope.branchId)
      : all;
  }, [data.data, scope.branchId]);

  const currency = tenant.baseCurrency;

  const columns = useMemo<Column<TransferSuggestion>[]>(
    () => [
      {
        key: "item",
        header: t("inv.item"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={
              <span className="flex items-center gap-1">
                {tx(row.fromLocationName)}
                <ArrowRight size={10} className="rtl:rotate-180" aria-hidden />
                {tx(row.toLocationName)}
              </span>
            }
          />
        ),
      },
      {
        key: "expires",
        header: t("invx.sug.expiresIn"),
        numeric: true,
        render: (row) => (
          <Badge tone={row.expiresInDays <= 2 ? "bad" : "warn"}>
            {t("invx.sug.days").replace("{n}", formatNumber(row.expiresInDays, fmt))}
          </Badge>
        ),
      },
      {
        key: "why",
        header: t("invx.sug.why"),
        secondary: true,
        render: (row) => (
          <span className="text-fg-muted text-xs">
            {t("invx.sug.whyText")
              .replace("{excess}", formatNumber(row.excess, fmt, 2))
              .replace("{shortage}", formatNumber(row.shortage, fmt, 2))
              .replace("{canUse}", formatNumber(row.destinationCanUse, fmt, 2))
              .replaceAll("{unit}", unitLabel(row.unit as never, locale))}
            {!row.usageKnown ? (
              <Badge tone="muted" className="ms-1">
                {t("invx.sug.usageAssumed")}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: "quantity",
        header: t("inv.quantity"),
        numeric: true,
        render: (row) => (
          <span dir="ltr" className="font-mono">
            {formatNumber(row.quantity, fmt, 2)} {unitLabel(row.unit as never, locale)}
          </span>
        ),
      },
      {
        key: "value",
        header: t("invx.sug.valueSaved"),
        numeric: true,
        render: (row) => formatMoney({ amount: row.valueMinor, currency }, fmt),
      },
      {
        key: "actions",
        header: t("common.actions"),
        render: (row) =>
          data.data?.openSuggestionIds.has(row.id) ? (
            <Badge tone="accent">{t("invx.sug.requested")}</Badge>
          ) : (
            <span className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onRequest({
                    fromLocationId: row.fromLocationId,
                    toLocationId: row.toLocationId,
                    itemId: row.itemId,
                    quantity: String(row.quantity),
                    note: t("invx.sug.requestNote")
                      .replace("{item}", tx(row.itemName))
                      .replace("{days}", String(row.expiresInDays)),
                    suggestionId: row.id,
                  })
                }
              >
                {t("invx.sug.request")}
              </Button>
              {canDispatch ? (
                <Button size="sm" variant="secondary" icon={<Send size={11} />} onClick={() => onDispatch(row)}>
                  {t("inv.dispatch")}
                </Button>
              ) : null}
            </span>
          ),
      },
    ],
    [t, tx, fmt, locale, currency, canDispatch, data.data, onRequest, onDispatch],
  );

  const totalValue = suggestions.reduce((sum, row) => sum + row.valueMinor, 0);

  return (
    <div className="space-y-4">
      <Callout tone="muted">{t("invx.sug.intro")}</Callout>

      <AsyncPanel state={data}>
        {(loaded) => (
          <>
            <TileGrid columns={3}>
              <MetricTile label={t("invx.sug.count")} value={formatNumber(suggestions.length, fmt)} spec="FR-BRN-017" />
              <MetricTile label={t("invx.sug.valueSaved")} value={formatMoney({ amount: totalValue, currency }, fmt, true)} />
              <MetricTile
                label={t("invx.sug.horizon")}
                value={t("invx.sug.days").replace("{n}", formatNumber(loaded.settings.transfers.horizonDays, fmt))}
                hint={t("invx.sug.transitHint").replace("{n}", String(loaded.settings.transfers.transitDays))}
              />
            </TileGrid>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-fg-subtle text-xs">
                {t("invx.sug.readAt").replace("{at}", formatDateTime(loaded.readAt, fmt))}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={() => setEditing(true)}>
                  {t("invx.sug.policy")}
                </Button>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={data.reload}>
                  {t("common.refresh")}
                </Button>
              </span>
            </div>

            <DataTable
              columns={columns}
              rows={suggestions}
              rowKey={(row) => row.id}
              caption={t("invx.sug.title")}
              emptyTitle={t("invx.sug.emptyTitle")}
              emptyBody={t("invx.sug.emptyBody")}
              dense
            />

            {editing ? (
              <PolicyDrawer
                settings={loaded.settings}
                onClose={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  setMessage(t("invx.sug.policySaved"));
                  data.reload();
                }}
              />
            ) : null}
          </>
        )}
      </AsyncPanel>

      <Toast message={message} />
    </div>
  );
}

function PolicyDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: DetectionSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { session, tenant } = useSession();
  const canEdit = usePermission("inventory.adjust");
  const action = useAction();
  const [horizon, setHorizon] = useState(String(settings.transfers.horizonDays));
  const [transit, setTransit] = useState(String(settings.transfers.transitDays));
  const [minValue, setMinValue] = useState<number | null>(settings.transfers.minValueMinor);

  const valid = Number(horizon) > 0 && Number(transit) >= 0 && Number.isInteger(Number(horizon)) && Number.isInteger(Number(transit));

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.sug.policy")}
      subtitle="FR-BRN-017"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!valid || !canEdit}
            onClick={() =>
              void action.run(
                () =>
                  services.inventoryControls.detection.saveSettings({
                    ...settings,
                    transfers: {
                      horizonDays: Number(horizon),
                      transitDays: Number(transit),
                      minValueMinor: minValue ?? 0,
                    },
                    updatedBy: session?.user.email ?? null,
                  }),
                { onSuccess: onSaved },
              )
            }
          >
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!canEdit ? <Callout tone="muted">{t("invx.common.readOnly")}</Callout> : null}
        <Field label={t("invx.sug.horizon")} hint={t("invx.sug.horizonHint")}>
          <Input dir="ltr" inputMode="numeric" value={horizon} onChange={(event) => setHorizon(event.target.value)} />
        </Field>
        <Field label={t("invx.sug.transit")} hint={t("invx.sug.transitFieldHint")}>
          <Input dir="ltr" inputMode="numeric" value={transit} onChange={(event) => setTransit(event.target.value)} />
        </Field>
        <Field label={t("invx.sug.minValue")} hint={t("invx.sug.minValueHint")}>
          <MoneyInput value={minValue} currency={tenant.baseCurrency} onChange={setMinValue} />
        </Field>
      </div>
    </Drawer>
  );
}
