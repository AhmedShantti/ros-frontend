"use client";

/**
 * Kitchen Display Setup — KITCHEN-DISPLAY-SETUP-FRONTEND-P0.
 *
 * The manager Console surface for the canonical backend truth Fire and KDS
 * already read: preparation stations, station-routing rules, the branch
 * fallback station, and the two canonical `branch_kds_config` timing
 * settings. This is NOT the KDS operator screen (`/kds`, `kds.operate`) and
 * carries no terminal/device pairing, registration, or heartbeat UI — a
 * station here is a preparation station, not a terminal.
 *
 * Everything is read from one call, `GET .../kitchen-setup`
 * (`services.organisation.getKitchenSetup`) — the same manager-safe,
 * N+1-free composition of already-canonical Organisation data the backend
 * built for exactly this page. Mutations go through the existing canonical
 * station (`createStation`/`updateStation`), routing-rule
 * (`addStationRoutingRule`/`updateStationRoutingRule`/
 * `removeStationRoutingRule`) and KDS-config (`updateKitchenConfig`)
 * endpoints, each followed by a reload from server truth rather than a
 * locally-optimistic edit — a failed write leaves the prior row visible
 * unchanged (FR-SEC-045-adjacent: never show a mutation as if it landed
 * before the server confirms it).
 *
 * Read requires `settings.branch.read`; every mutation control is
 * separately gated on `settings.branch.manage` and hidden (not merely
 * disabled) for a read-only holder, matching `/operations/tables`.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Id, Localised } from "@/lib/console/types";
import type { KitchenSetup, KitchenSetupStation, StationRoutingRule } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatNumber, type FormatOptions } from "@/lib/console/format";
import { Gate, ErrorPanel } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { useConfirm } from "@/components/console/confirm";
import { RecordDrawer, type RecordField } from "@/components/console/record-drawer";
import { DataTable, type Column } from "@/components/console/data-table";
import { Badge, Button, Callout, Field, Select, Toast } from "@/components/console/ui";

export default function KitchenSetupPage() {
  return (
    <Gate permissions={["settings.branch.read", "settings.branch.manage"]}>
      <KitchenSetupScreen />
    </Gate>
  );
}

type SelectorKind = "menuItem" | "category" | "modifier";

function ruleKind(rule: StationRoutingRule): SelectorKind | null {
  if (rule.modifierId) return "modifier";
  if (rule.menuItemId) return "menuItem";
  if (rule.categoryId) return "category";
  return null;
}

function KitchenSetupScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, branch, availableBranches } = useSession();
  const canManage = usePermission("settings.branch.manage");
  const [message, setMessage] = useTransientMessage();

  // Same branch-resolution rule as /operations/tables: never fan a request
  // out across "All branches", never silently default to the first branch —
  // a concrete branch is only ever the Console's own scope, the single
  // authorised branch, or an explicit pick made right here.
  const singleAuthorizedBranch = availableBranches.length === 1 ? availableBranches[0]! : null;
  const contextBranchId = scope.branchId ?? singleAuthorizedBranch?.id ?? null;
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = contextBranchId ?? (pickedBranchId || null);

  const selectedBranch =
    branch ??
    singleAuthorizedBranch ??
    availableBranches.find((b) => b.id === branchId) ??
    null;

  const kitchenSetup = useAsync(
    () => (branchId ? services.organisation.getKitchenSetup(branchId) : Promise.resolve(null)),
    [branchId],
  );

  // `useAsync` keeps the previous value visible while a new fetch is in
  // flight — correct for a slow reload, wrong for a branch switch, where
  // showing branch A's setup under branch B's id would misrepresent whose
  // config is on screen. The response carries its own `branchId`, so a
  // stale one is detected here rather than trusted.
  const setup: KitchenSetup | null =
    kitchenSetup.data && kitchenSetup.data.branchId === branchId ? kitchenSetup.data : null;

  const categories = useAsync(
    () => services.catalogue.categories.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  const items = useAsync(
    () => services.catalogue.items.list({ limit: 500 }).then((page) => page.rows),
    [],
  );
  const modifierGroups = useAsync(
    () => services.catalogue.modifierGroups.list({ limit: 200 }).then((page) => page.rows),
    [],
  );

  const selectorName = (rule: StationRoutingRule): string => {
    if (rule.modifierId) {
      for (const group of modifierGroups.data ?? []) {
        const found = group.modifiers.find((m) => m.id === rule.modifierId);
        if (found) return tx(found.name);
      }
      return rule.modifierId.slice(0, 8);
    }
    if (rule.menuItemId) {
      const found = items.data?.find((i) => i.id === rule.menuItemId);
      return found ? tx(found.name) : rule.menuItemId.slice(0, 8);
    }
    if (rule.categoryId) {
      const found = categories.data?.find((c) => c.id === rule.categoryId);
      return found ? tx(found.name) : rule.categoryId.slice(0, 8);
    }
    return "—";
  };

  const stationName = (stationId: Id | null, stations: KitchenSetupStation[]): string => {
    if (!stationId) return t("kitchenSetup.noFallback");
    return tx(stations.find((s) => s.id === stationId)?.name ?? ({ en: stationId, ar: stationId } as Localised));
  };

  return (
    <>
      <PageHeader
        title={t("kitchenSetup.title")}
        subtitle={t("kitchenSetup.subtitle")}
        spec="FR-KDS-010/011/025/029"
        meta={
          selectedBranch ? (
            <span>
              {t("common.branch")}: {tx(selectedBranch.name)}
            </span>
          ) : null
        }
      />

      <PageBody>
        {!canManage ? <Callout tone="muted">{t("kitchenSetup.readOnly")}</Callout> : null}

        {!contextBranchId && availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={pickedBranchId} onChange={(event) => setPickedBranchId(event.target.value)}>
              <option value="">—</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!branchId ? (
          <Callout tone="muted">{t("kitchenSetup.selectBranch")}</Callout>
        ) : kitchenSetup.loading && !setup ? (
          <Callout tone="muted">{t("state.loading")}</Callout>
        ) : kitchenSetup.error ? (
          <KitchenSetupError error={kitchenSetup.error} onRetry={kitchenSetup.reload} />
        ) : setup ? (
          <>
            <StationsSection
              branchId={branchId}
              stations={setup.stations}
              canManage={canManage}
              t={t}
              tx={tx}
              fmt={fmt}
              setMessage={setMessage}
              reload={kitchenSetup.reload}
            />

            <RoutingSection
              branchId={branchId}
              rules={setup.routingRules}
              stations={setup.stations}
              categories={categories.data ?? []}
              items={items.data ?? []}
              modifierGroups={modifierGroups.data ?? []}
              canManage={canManage}
              t={t}
              tx={tx}
              selectorName={selectorName}
              setMessage={setMessage}
              reload={kitchenSetup.reload}
            />

            <FallbackSection
              branchId={branchId}
              stations={setup.stations}
              fallbackStationId={setup.fallbackStationId}
              canManage={canManage}
              t={t}
              tx={tx}
              stationName={stationName}
              setMessage={setMessage}
              reload={kitchenSetup.reload}
            />

            <KdsSettingsSection
              branchId={branchId}
              recallWindowSeconds={setup.recallWindowSeconds}
              cancelledLineVisibilitySeconds={setup.cancelledLineVisibilitySeconds}
              canManage={canManage}
              t={t}
              setMessage={setMessage}
              reload={kitchenSetup.reload}
            />
          </>
        ) : null}
      </PageBody>

      <Toast message={message} />
    </>
  );
}

/** A refusal is not an outage — 403/404 say so plainly, never a leaked or fabricated setup. */
function KitchenSetupError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  const status = (error as { status?: number }).status;

  if (status === 403) return <Callout tone="bad">{t("kitchenSetup.forbidden")}</Callout>;
  if (status === 404) return <Callout tone="bad">{t("kitchenSetup.notFound")}</Callout>;
  return <ErrorPanel error={error} onRetry={onRetry} />;
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

function StationsSection({
  branchId,
  stations,
  canManage,
  t,
  tx,
  fmt,
  setMessage,
  reload,
}: {
  branchId: Id;
  stations: KitchenSetupStation[];
  canManage: boolean;
  t: (key: never) => string;
  tx: (value: Localised) => string;
  fmt: FormatOptions;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KitchenSetupStation | null>(null);

  const fields = (station?: KitchenSetupStation): RecordField[] => [
    {
      name: "name",
      label: t("kitchenSetup.stationName" as never),
      required: true,
      maxLength: 64,
      initial: station ? tx(station.name) : "",
    },
    {
      name: "colour",
      label: t("kitchenSetup.stationColour" as never),
      hint: t("kitchenSetup.stationColourHint" as never),
      maxLength: 9,
      ltr: true,
      initial: station?.displayColour ?? "",
    },
    {
      name: "capacityPerHour",
      label: t("kitchenSetup.stationCapacity" as never),
      hint: t("kitchenSetup.stationCapacityHint" as never),
      kind: "number",
      min: 0,
      initial: station?.capacityPerHour ? String(station.capacityPerHour) : "",
    },
  ];

  return (
    <Section
      title={t("kitchenSetup.stationsTitle" as never)}
      hint={t("kitchenSetup.stationsHint" as never)}
      action={
        canManage ? (
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("kitchenSetup.addStation" as never)}
          </Button>
        ) : null
      }
    >
      {stations.length === 0 ? (
        <Callout tone="muted">{t("kitchenSetup.stationsEmpty" as never)}</Callout>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((station) => (
            <li key={station.id}>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => canManage && setEditing(station)}
                className="bg-raised border-line w-full space-y-1 rounded-xl border p-4 text-start shadow-2xs disabled:cursor-default"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="border-line size-3 shrink-0 rounded-full border"
                    style={station.displayColour ? { background: station.displayColour } : undefined}
                  />
                  <span className="text-fg text-sm font-semibold">{tx(station.name)}</span>
                </div>
                {station.capacityPerHour !== null && station.capacityPerHour > 0 ? (
                  <p className="text-fg-subtle text-xs">
                    {t("kitchenSetup.stationCapacityPrefix" as never)}
                    {formatNumber(station.capacityPerHour, fmt)}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <RecordDrawer
        open={creating}
        title={t("kitchenSetup.addStation" as never)}
        fields={fields()}
        onClose={() => setCreating(false)}
        onSubmit={(values) =>
          services.operations.createStation(branchId, {
            name: { en: values.name.trim(), ar: values.name.trim() },
            colour: values.colour.trim() || undefined,
            capacityPerHour: values.capacityPerHour ? Number(values.capacityPerHour) : undefined,
          })
        }
        onDone={() => {
          setCreating(false);
          setMessage(t("kitchenSetup.stationCreated" as never));
          reload();
        }}
      />

      <RecordDrawer
        open={editing !== null}
        title={editing ? tx(editing.name) : ""}
        submitLabel={t("common.save" as never)}
        fields={editing ? fields(editing) : []}
        onClose={() => setEditing(null)}
        onSubmit={(values) =>
          services.operations.updateStation(editing!.id, {
            name: { en: values.name.trim(), ar: values.name.trim() },
            colour: values.colour.trim() || undefined,
            capacityPerHour: values.capacityPerHour ? Number(values.capacityPerHour) : undefined,
          })
        }
        onDone={() => {
          setEditing(null);
          setMessage(t("kitchenSetup.stationUpdated" as never));
          reload();
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

interface CatalogueOption {
  id: Id;
  name: Localised;
}

function RoutingSection({
  branchId,
  rules,
  stations,
  categories,
  items,
  modifierGroups,
  canManage,
  t,
  tx,
  selectorName,
  setMessage,
  reload,
}: {
  branchId: Id;
  rules: StationRoutingRule[];
  stations: KitchenSetupStation[];
  categories: CatalogueOption[];
  items: CatalogueOption[];
  modifierGroups: { id: Id; name: Localised; modifiers: { id: Id; name: Localised }[] }[];
  canManage: boolean;
  t: (key: never) => string;
  tx: (value: Localised) => string;
  selectorName: (rule: StationRoutingRule) => string;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const [creating, setCreating] = useState(false);

  const modifierOptions = useMemo(
    () =>
      modifierGroups.flatMap((group) =>
        group.modifiers.map((modifier) => ({
          value: modifier.id,
          label: `${tx(group.name)} — ${tx(modifier.name)}`,
        })),
      ),
    [modifierGroups, tx],
  );

  const tierLabel = (kind: SelectorKind | null): string => {
    if (kind === "modifier") return t("kitchenSetup.modifier" as never);
    if (kind === "menuItem") return t("kitchenSetup.menuItem" as never);
    if (kind === "category") return t("kitchenSetup.category" as never);
    return "—";
  };

  const columns: Column<StationRoutingRule>[] = [
    {
      key: "kind",
      header: t("kitchenSetup.selectorType" as never),
      render: (rule) => <Badge tone="neutral">{tierLabel(ruleKind(rule))}</Badge>,
    },
    {
      key: "selector",
      header: t("kitchenSetup.selectorType" as never),
      render: (rule) => <span className="text-fg text-sm">{selectorName(rule)}</span>,
    },
    {
      key: "priority",
      header: t("kitchenSetup.routingPriority" as never),
      numeric: true,
      render: (rule) => <span className="text-fg-subtle text-xs tabular-nums">{rule.priority}</span>,
    },
    {
      key: "destination",
      header: t("kitchenSetup.destinationStation" as never),
      render: (rule) =>
        canManage ? (
          <RuleDestinationCell
            branchId={branchId}
            rule={rule}
            stations={stations}
            t={t}
            tx={tx}
            setMessage={setMessage}
            reload={reload}
          />
        ) : (
          <span className="text-fg text-sm">
            {tx(stations.find((s) => s.id === rule.stationId)?.name ?? { en: "—", ar: "—" })}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (rule) =>
        canManage ? (
          <RuleRemoveButton branchId={branchId} rule={rule} t={t} setMessage={setMessage} reload={reload} />
        ) : null,
    },
  ];

  const createFields: RecordField[] = [
    {
      name: "kind",
      label: t("kitchenSetup.selectorType" as never),
      kind: "select",
      required: true,
      initial: "category",
      options: [
        { value: "category", label: t("kitchenSetup.category" as never) },
        { value: "menuItem", label: t("kitchenSetup.menuItem" as never) },
        { value: "modifier", label: t("kitchenSetup.modifier" as never) },
      ],
    },
    {
      name: "categoryId",
      label: t("kitchenSetup.category" as never),
      kind: "select",
      required: true,
      visibleWhen: (all) => all.kind === "category",
      options: categories.map((c) => ({ value: c.id, label: tx(c.name) })),
    },
    {
      name: "menuItemId",
      label: t("kitchenSetup.menuItem" as never),
      kind: "search",
      required: true,
      visibleWhen: (all) => all.kind === "menuItem",
      searchOptions: items.map((i) => ({ value: i.id, label: tx(i.name) })),
    },
    {
      name: "modifierId",
      label: t("kitchenSetup.modifier" as never),
      kind: "select",
      required: true,
      visibleWhen: (all) => all.kind === "modifier",
      options: modifierOptions,
    },
    {
      name: "stationId",
      label: t("kitchenSetup.destinationStation" as never),
      kind: "select",
      required: true,
      options: stations.map((s) => ({ value: s.id, label: tx(s.name) })),
    },
    {
      name: "priority",
      label: t("kitchenSetup.routingPriority" as never),
      kind: "number",
    },
  ];

  return (
    <Section
      title={t("kitchenSetup.routingTitle" as never)}
      hint={t("kitchenSetup.routingHint" as never)}
      action={
        canManage ? (
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("kitchenSetup.addRoutingRule" as never)}
          </Button>
        ) : null
      }
    >
      <Callout tone="muted">
        <p className="font-medium">{t("kitchenSetup.precedenceTitle" as never)}</p>
        <p>{t("kitchenSetup.precedenceExplain" as never)}</p>
        <ol className="mt-2 list-inside list-decimal space-y-0.5">
          <li>{t("kitchenSetup.precedenceLineOverride" as never)}</li>
          <li>{t("kitchenSetup.precedenceModifier" as never)}</li>
          <li>{t("kitchenSetup.precedenceMenuItem" as never)}</li>
          <li>{t("kitchenSetup.precedenceCategory" as never)}</li>
          <li>{t("kitchenSetup.precedenceFallback" as never)}</li>
        </ol>
      </Callout>

      {rules.length === 0 ? (
        <Callout tone="muted">{t("kitchenSetup.routingEmpty" as never)}</Callout>
      ) : (
        <DataTable
          columns={columns}
          rows={rules}
          rowKey={(rule) => rule.id}
          caption={t("kitchenSetup.routingTitle" as never)}
          dense
        />
      )}

      <RecordDrawer
        open={creating}
        title={t("kitchenSetup.addRoutingRule" as never)}
        note={t("kitchenSetup.selectSelector" as never)}
        fields={createFields}
        onClose={() => setCreating(false)}
        onSubmit={(values) => {
          const base = {
            stationId: values.stationId,
            priority: values.priority ? Number(values.priority) : undefined,
          };
          if (values.kind === "category") {
            return services.organisation.addStationRoutingRule(branchId, {
              ...base,
              categoryId: values.categoryId,
            });
          }
          if (values.kind === "menuItem") {
            return services.organisation.addStationRoutingRule(branchId, {
              ...base,
              menuItemId: values.menuItemId,
            });
          }
          return services.organisation.addStationRoutingRule(branchId, {
            ...base,
            modifierId: values.modifierId,
          });
        }}
        onDone={() => {
          setCreating(false);
          setMessage(t("kitchenSetup.ruleCreated" as never));
          reload();
        }}
      />
    </Section>
  );
}

function RuleDestinationCell({
  branchId,
  rule,
  stations,
  t,
  tx,
  setMessage,
  reload,
}: {
  branchId: Id;
  rule: StationRoutingRule;
  stations: KitchenSetupStation[];
  t: (key: never) => string;
  tx: (value: Localised) => string;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const action = useAction();

  async function change(stationId: string) {
    if (!stationId || stationId === rule.stationId) return;
    await action.run(() => services.organisation.updateStationRoutingRule(branchId, rule.id, stationId), {
      onSuccess: () => {
        setMessage(t("kitchenSetup.ruleUpdated" as never));
        reload();
      },
      onError: (error) => setMessage(error.message),
    });
  }

  return (
    <Select
      aria-label={t("kitchenSetup.changeStation" as never)}
      value={rule.stationId}
      disabled={action.pending}
      onChange={(event) => void change(event.target.value)}
    >
      {stations.map((station) => (
        <option key={station.id} value={station.id}>
          {tx(station.name)}
        </option>
      ))}
    </Select>
  );
}

function RuleRemoveButton({
  branchId,
  rule,
  t,
  setMessage,
  reload,
}: {
  branchId: Id;
  rule: StationRoutingRule;
  t: (key: never) => string;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const action = useAction();
  const confirm = useConfirm();

  async function remove() {
    const ok = await confirm({
      title: t("kitchenSetup.removeRuleConfirmTitle" as never),
      body: (
        <>
          <p>{t("kitchenSetup.removeRuleConfirmBody" as never)}</p>
          <p className="mt-1 font-medium">{t("kitchenSetup.futureOrdersOnly" as never)}</p>
        </>
      ),
      tone: "danger",
      confirmLabel: t("kitchenSetup.removeRoutingRule" as never),
    });
    if (!ok) return;
    await action.run(() => services.organisation.removeStationRoutingRule(branchId, rule.id), {
      onSuccess: () => {
        setMessage(t("kitchenSetup.ruleRemoved" as never));
        reload();
      },
      onError: (error) => setMessage(error.message),
    });
  }

  return (
    <Button
      variant="ghost"
      icon={<Trash2 size={14} />}
      loading={action.pending}
      onClick={() => void remove()}
      aria-label={t("kitchenSetup.removeRoutingRule" as never)}
    >
      {t("kitchenSetup.removeRoutingRule" as never)}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Fallback station
// ---------------------------------------------------------------------------

function FallbackSection({
  branchId,
  stations,
  fallbackStationId,
  canManage,
  t,
  tx,
  stationName,
  setMessage,
  reload,
}: {
  branchId: Id;
  stations: KitchenSetupStation[];
  fallbackStationId: Id | null;
  canManage: boolean;
  t: (key: never) => string;
  tx: (value: Localised) => string;
  stationName: (stationId: Id | null, stations: KitchenSetupStation[]) => string;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const action = useAction();
  const [selected, setSelected] = useState(fallbackStationId ?? "");

  // Follows the loaded value rather than a one-time initializer, so a
  // reload after save (or a branch switch) replaces an in-progress
  // selection instead of leaving the previous branch's choice on screen.
  useEffect(() => {
    setSelected(fallbackStationId ?? "");
  }, [fallbackStationId]);

  const dirty = selected !== (fallbackStationId ?? "");

  async function save() {
    await action.run(
      () => services.organisation.updateKitchenConfig(branchId, { fallbackStationId: selected || null }),
      {
        onSuccess: () => {
          setMessage(t("kitchenSetup.fallbackSaved" as never));
          reload();
        },
      },
    );
  }

  return (
    <Section title={t("kitchenSetup.fallbackTitle" as never)} hint={t("kitchenSetup.fallbackHint" as never)}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("kitchenSetup.fallbackTitle" as never)}>
            <Select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={action.pending}>
              <option value="">{t("kitchenSetup.noFallback" as never)}</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {tx(station.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" loading={action.pending} disabled={!dirty} onClick={() => void save()}>
            {t("common.save" as never)}
          </Button>
        </div>
      ) : (
        <p className="text-fg text-sm">{stationName(fallbackStationId, stations)}</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// KDS settings
// ---------------------------------------------------------------------------

function KdsSettingsSection({
  branchId,
  recallWindowSeconds,
  cancelledLineVisibilitySeconds,
  canManage,
  t,
  setMessage,
  reload,
}: {
  branchId: Id;
  recallWindowSeconds: number;
  cancelledLineVisibilitySeconds: number | null;
  canManage: boolean;
  t: (key: never) => string;
  setMessage: (value: string | null) => void;
  reload: () => void;
}) {
  const action = useAction();
  const [recallMinutes, setRecallMinutes] = useState(() => String(Math.round(recallWindowSeconds / 60)));
  const [cancelledMinutes, setCancelledMinutes] = useState(() =>
    cancelledLineVisibilitySeconds === null ? "" : String(Math.round(cancelledLineVisibilitySeconds / 60)),
  );

  useEffect(() => {
    setRecallMinutes(String(Math.round(recallWindowSeconds / 60)));
    setCancelledMinutes(
      cancelledLineVisibilitySeconds === null ? "" : String(Math.round(cancelledLineVisibilitySeconds / 60)),
    );
  }, [recallWindowSeconds, cancelledLineVisibilitySeconds]);

  const recallDigits = recallMinutes.trim();
  const recallSeconds = /^\d+$/.test(recallDigits) ? Number(recallDigits) * 60 : null;
  const recallValid = recallSeconds !== null && recallSeconds > 0;

  const cancelledDigits = cancelledMinutes.trim();
  const cancelledSeconds =
    cancelledDigits === "" ? null : /^\d+$/.test(cancelledDigits) ? Number(cancelledDigits) * 60 : undefined;
  const cancelledValid = cancelledSeconds !== undefined;

  const dirty =
    recallSeconds !== recallWindowSeconds || cancelledSeconds !== cancelledLineVisibilitySeconds;

  async function save() {
    if (!recallValid || !cancelledValid) return;
    await action.run(
      () =>
        services.organisation.updateKitchenConfig(branchId, {
          recallWindowSeconds: recallSeconds!,
          cancelledLineVisibilitySeconds: cancelledSeconds ?? null,
        }),
      {
        onSuccess: () => {
          setMessage(t("kitchenSetup.settingsSaved" as never));
          reload();
        },
      },
    );
  }

  return (
    <Section title={t("kitchenSetup.kdsSettingsTitle" as never)} hint={t("kitchenSetup.kdsSettingsHint" as never)}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {canManage ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("kitchenSetup.recallWindow" as never)}
            hint={t("kitchenSetup.recallWindowHint" as never)}
            error={recallDigits !== "" && !recallValid ? t("kitchenSetup.invalidMinutes" as never) : null}
          >
            <input
              dir="ltr"
              inputMode="numeric"
              value={recallMinutes}
              onChange={(event) => setRecallMinutes(event.target.value.replace(/[^0-9]/g, ""))}
              maxLength={5}
              className="border-line bg-raised text-fg focus:border-accent w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </Field>
          <Field
            label={t("kitchenSetup.cancelledLineVisibility" as never)}
            hint={t("kitchenSetup.cancelledLineVisibilityHint" as never)}
            error={cancelledValid ? null : t("kitchenSetup.invalidMinutes" as never)}
          >
            <input
              dir="ltr"
              inputMode="numeric"
              placeholder={t("kitchenSetup.notConfigured" as never)}
              value={cancelledMinutes}
              onChange={(event) => setCancelledMinutes(event.target.value.replace(/[^0-9]/g, ""))}
              maxLength={5}
              className="border-line bg-raised text-fg focus:border-accent w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </Field>
          <div>
            <Button
              variant="primary"
              loading={action.pending}
              disabled={!dirty || !recallValid || !cancelledValid}
              onClick={() => void save()}
            >
              {t("common.save" as never)}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-fg-subtle text-xs">{t("kitchenSetup.recallWindow" as never)}</dt>
            <dd className="text-fg text-sm">{Math.round(recallWindowSeconds / 60)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-xs">{t("kitchenSetup.cancelledLineVisibility" as never)}</dt>
            <dd className="text-fg text-sm">
              {cancelledLineVisibilitySeconds === null
                ? t("kitchenSetup.notConfigured" as never)
                : Math.round(cancelledLineVisibilitySeconds / 60)}
            </dd>
          </div>
        </dl>
      )}
    </Section>
  );
}
