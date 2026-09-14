"use client";

/**
 * Stations — FR-KDS-001.
 *
 * A station is what a KDS screen binds to (`GET /kds/stations/{id}/queue`
 * refuses any station a terminal is not bound to). Without at least one
 * station configured for a branch, that branch's KDS has nothing to bind to
 * at all — this page is the one place that gap gets closed.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Station } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import {
  Badge,
  Button,
  Callout,
  Card,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
} from "@/components/console/ui";

export default function StationsPage() {
  return (
    <Gate permissions={["settings.branch.manage"]}>
      <StationsScreen />
    </Gate>
  );
}

export function StationsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessageLocal();

  /**
   * DEMO-OPS-HOTFIX-3 — `branch`/`availableBranches` resolve ASYNCHRONOUSLY
   * (live org-context rehydration, `useLiveOrgContext`): on first mount, or
   * right after a hard reload, both are still empty/null. A plain
   * `useState(branch?.id ?? availableBranches[0]?.id ?? "")` initializer only
   * ever runs ONCE, so a branchId captured before rehydration finished would
   * stay `""` (or a stale id) forever, silently emptying this page's own
   * list — never a stale STATION, but a stale BRANCH SELECTION. This effect
   * re-syncs to the live default whenever the CURRENT selection is no longer
   * a real, visible branch, and otherwise leaves an explicit user choice
   * alone.
   */
  useEffect(() => {
    const defaultBranchId = branch?.id ?? availableBranches[0]?.id ?? "";
    setBranchId((current) => {
      if (current && availableBranches.some((b) => b.id === current)) {
        return current;
      }
      return defaultBranchId;
    });
  }, [branch, availableBranches]);

  const stationScope = useMemo(
    () => ({ ...scope, branchId: branchId || null }),
    [scope, branchId],
  );

  const stationsQuery = useAsync(
    () =>
      branchId
        ? services.operations
            .stations({ scope: stationScope, limit: 200 })
            .then((page) => page.rows)
        : Promise.resolve([] as Station[]),
    [branchId, stationScope],
  );

  const stations = stationsQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={t("stations.title")}
        subtitle={t("stations.subtitle")}
        spec="FR-KDS-001"
      />

      <PageBody>
        {availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <FallbackStationSection
          branchId={branchId}
          stations={stations}
          stationsLoading={stationsQuery.loading}
        />

        <Section
          title={t("stations.listTitle")}
          action={
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              disabled={!branchId}
              onClick={() => setCreating(true)}
            >
              {t("stations.new")}
            </Button>
          }
        >
          {stationsQuery.loading ? (
            <Callout tone="muted">{t("state.loading")}</Callout>
          ) : stations.length === 0 ? (
            <Callout tone="muted">{t("stations.empty")}</Callout>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stations.map((station) => (
                <li key={station.id}>
                  <Card className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-fg text-sm font-semibold">
                        {tx(station.name)}
                      </span>
                      <Badge tone="neutral">{station.type}</Badge>
                    </div>
                    {station.capacityPerHour > 0 ? (
                      <p className="text-fg-subtle text-xs">
                        {t("stations.capacityPerHourPrefix")}
                        {formatNumber(station.capacityPerHour, fmt)}
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>

      {creating ? (
        <NewStationDrawer
          branchId={branchId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setMessage(t("stations.created"));
            stationsQuery.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

/**
 * KDS-BRANCH-FALLBACK-STATION-P0 — kitchen-routing tier 5 (FR-KDS-010): the
 * one station an otherwise-unrouted fired item goes to. Explicit routing
 * rules (line/modifier/menu-item/category) always win over this; it only
 * matters for an item with none of those. Deliberately never defaults to
 * `stations[0]` — the empty "No fallback" option is the honest starting
 * state whenever nothing has been configured yet, matching what the
 * backend itself returns (`fallbackStationId: null`) before anyone sets one.
 */
function FallbackStationSection({
  branchId,
  stations,
  stationsLoading,
}: {
  branchId: string;
  stations: Station[];
  stationsLoading: boolean;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [message, setMessage] = useTransientMessageLocal();

  const configQuery = useAsync(
    () =>
      branchId
        ? services.operations.getBranchKdsConfig(branchId)
        : Promise.resolve({ fallbackStationId: null }),
    [branchId],
  );

  const [selected, setSelected] = useState("");

  // Follows the loaded value, not a one-time initializer: `branchId`
  // switching (or a reload after save) must replace an in-progress
  // selection, never leave the previous branch's choice showing.
  useEffect(() => {
    setSelected(configQuery.data?.fallbackStationId ?? "");
  }, [configQuery.data]);

  const dirty = selected !== (configQuery.data?.fallbackStationId ?? "");

  async function save() {
    if (!branchId) return;
    await action.run(
      () => services.operations.setBranchKdsConfig(branchId, selected || null),
      {
        onSuccess: () => {
          setMessage(t("stations.fallbackSaved"));
          configQuery.reload();
        },
      },
    );
  }

  return (
    <Section title={t("stations.fallbackTitle")} hint={t("stations.fallbackHint")}>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("stations.fallbackLabel")}>
          <Select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={!branchId || configQuery.loading || stationsLoading}
          >
            <option value="">{t("stations.fallbackNone")}</option>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {tx(station.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          loading={action.pending}
          disabled={!branchId || !dirty}
          onClick={save}
        >
          {t("common.save")}
        </Button>
      </div>
      <Toast message={message} />
    </Section>
  );
}

function useTransientMessageLocal() {
  const [message, setMessage] = useState<string | null>(null);
  return [
    message,
    (value: string | null) => {
      setMessage(value);
      if (value) {
        setTimeout(() => setMessage(null), 4000);
      }
    },
  ] as const;
}

function NewStationDrawer({
  branchId,
  onClose,
  onCreated,
}: {
  branchId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [capacityPerHour, setCapacityPerHour] = useState("");

  async function create() {
    if (!name.trim() || !branchId) return;
    await action.run(
      () =>
        services.operations.createStation(branchId, {
          name: { en: name.trim(), ar: name.trim() },
          capacityPerHour: capacityPerHour ? Number(capacityPerHour) : undefined,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("stations.new")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!name.trim()}
            onClick={create}
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
        </Field>

        <Field label={t("stations.capacityPerHourLabel")} hint={t("stations.capacityPerHourHint")}>
          <Input
            dir="ltr"
            inputMode="numeric"
            value={capacityPerHour}
            onChange={(event) => setCapacityPerHour(event.target.value.replace(/[^0-9]/g, ""))}
            maxLength={4}
          />
        </Field>
      </div>
    </Drawer>
  );
}
