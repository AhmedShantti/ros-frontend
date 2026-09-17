"use client";

/**
 * Kitchen display setup — FR-KDS-011, 023, 029, 031, 044, 045.
 *
 * Everything a kitchen screen needs to be told that the backend has no field
 * for: which order each station sorts in, how much a station can clear in
 * fifteen minutes, how long each item should take, which items are made at
 * more than one station, how long a cancelled line stays struck through,
 * whether screens start in picture mode, and which events make a sound.
 *
 * It is kept in this browser through `services.kdsSetup` and said so on the
 * page. Both kitchen displays read it, and the simulator's till routes lines
 * by it the moment a course is fired.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Save } from "lucide-react";
import type { Id, MenuItem, OrderType, Station, StationType } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { ORDER_TYPE, STATION_TYPE } from "@/lib/console/labels";
import { formatElapsed, formatNumber } from "@/lib/console/format";
import {
  DEFAULT_KDS_SETUP,
  KDS_SORT_MODES,
  stationSetupOf,
  type KdsAlertSetup,
  type KdsSetup,
  type KdsSortMode,
} from "@/lib/console/live/kds";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { useConfirm } from "@/components/console/confirm";
import { SORT_LABEL } from "@/components/terminal/kds-parts";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Select, Toast, Toggle, cx } from "@/components/console/ui";

export default function KdsSetupPage() {
  return (
    <Gate permissions={["kds.station.manage", "settings.branch.manage"]}>
      <KdsSetupScreen />
    </Gate>
  );
}

const STATION_TYPES = (Object.keys(STATION_TYPE) as StationType[]).filter((type) => type !== "pass");

const CANCELLED_WINDOWS: { value: string; seconds: number | null }[] = [
  { value: "30", seconds: 30 },
  { value: "60", seconds: 60 },
  { value: "120", seconds: 120 },
  { value: "300", seconds: 300 },
  { value: "keep", seconds: null },
];

/** "4:30" → 270; "" → null; anything unreadable → undefined. */
function parseDuration(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  const match = /^(\d{1,3})(?::([0-5]?\d))?$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return seconds > 0 ? seconds : undefined;
}

function KdsSetupScreen() {
  const { t, tx, fmt } = useI18n();
  const { branch, availableBranches } = useSession();
  const confirm = useConfirm();

  const stored = useAsync(() => services.kdsSetup.get(), []);
  const [draft, setDraft] = useState<KdsSetup | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (stored.data && draft === null) setDraft(stored.data);
  }, [stored.data, draft]);

  useEffect(() => {
    const fallback = branch?.id ?? availableBranches[0]?.id ?? "";
    setBranchId((current) => (current && availableBranches.some((b) => b.id === current) ? current : fallback));
  }, [branch, availableBranches]);

  const stations = useAsync(
    () =>
      branchId
        ? services.operations
            .stations({ scope: { tenantId: "", brandId: null, branchId }, limit: 200 })
            .then((page) => page.rows.filter((s) => s.type !== "pass"))
            .catch(() => [] as Station[])
        : Promise.resolve([] as Station[]),
    [branchId],
  );

  const items = useAsync(
    () =>
      services.catalogue.items
        .list({ limit: 500 })
        .then((page) => page.rows)
        .catch(() => [] as MenuItem[]),
    [],
  );

  const dirty = useMemo(
    () => draft !== null && stored.data !== null && JSON.stringify(draft) !== JSON.stringify(stored.data),
    [draft, stored.data],
  );

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (items.data ?? [])
      .filter((item) => !needle || `${item.name.en} ${item.name.ar}`.toLowerCase().includes(needle))
      .slice(0, 80);
  }, [items.data, search]);

  if (!draft) {
    return (
      <>
        <PageHeader title={t("kdsSetup.title")} spec="FR-KDS-023" />
        <PageBody>
          <Callout tone="muted">{t("state.loading")}</Callout>
        </PageBody>
      </>
    );
  }

  const patch = (next: Partial<KdsSetup>) => setDraft({ ...draft, ...next });

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await services.kdsSetup.save(draft);
      setDraft(saved);
      stored.reload();
      setMessage(t("kdsSetup.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("kdsSetup.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    const ok = await confirm({
      title: t("kdsSetup.resetTitle"),
      body: t("kdsSetup.resetBody"),
      tone: "danger",
      confirmLabel: t("kdsSetup.reset"),
    });
    if (!ok) return;
    try {
      const fresh = await services.kdsSetup.reset();
      setDraft(fresh);
      stored.reload();
      setMessage(t("kdsSetup.resetDone"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("kdsSetup.saveFailed"));
    }
  }

  // -- FR-KDS-023 order-type ranking ------------------------------------------
  const allTypes = Object.keys(ORDER_TYPE) as OrderType[];
  const ranking = [...draft.orderTypePriority, ...allTypes.filter((type) => !draft.orderTypePriority.includes(type))];
  const move = (index: number, delta: number) => {
    const next = [...ranking];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patch({ orderTypePriority: next });
  };

  const setStation = (stationId: Id, part: Partial<ReturnType<typeof stationSetupOf>>) =>
    patch({ stations: { ...draft.stations, [stationId]: { ...stationSetupOf(draft, stationId), ...part } } });

  const itemSetup = (itemId: Id) => draft.items[itemId] ?? { targetSeconds: null, alsoStationTypes: [] };
  const setItem = (itemId: Id, part: Partial<ReturnType<typeof itemSetup>>) => {
    const next = { ...itemSetup(itemId), ...part };
    const items = { ...draft.items };
    if (next.targetSeconds === null && next.alsoStationTypes.length === 0) delete items[itemId];
    else items[itemId] = next;
    patch({ items });
  };

  const setAlert = (key: keyof KdsAlertSetup, value: boolean) => patch({ alerts: { ...draft.alerts, [key]: value } });

  return (
    <>
      <PageHeader
        title={t("kdsSetup.title")}
        subtitle={t("kdsSetup.subtitle")}
        spec="FR-KDS-023"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? <Badge tone="warn">{t("kdsSetup.unsaved")}</Badge> : null}
            <Button className="min-h-12" icon={<RotateCcw size={14} />} onClick={() => void resetAll()}>
              {t("kdsSetup.reset")}
            </Button>
            <Button
              className="min-h-12"
              variant="primary"
              icon={<Save size={14} />}
              loading={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              {t("common.save")}
            </Button>
          </div>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("kdsSetup.storageNote")}</Callout>

        <Section title={t("kdsSetup.stationsTitle")}>
          <Card>
            <CardHeader title={t("kdsSetup.stationsTitle")} hint={t("kdsSetup.stationsHint")} spec="FR-KDS-023 · FR-KDS-045" />
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
            {(stations.data ?? []).length === 0 ? (
              <Callout tone="muted">{stations.loading ? t("state.loading") : t("stations.empty")}</Callout>
            ) : (
              <ul className="divide-line mt-2 divide-y">
                {(stations.data ?? []).map((station) => {
                  const current = stationSetupOf(draft, station.id);
                  const auto = Math.floor(Math.max(0, station.capacityPerHour) / 4);
                  return (
                    <li key={station.id} className="grid gap-3 py-3 md:grid-cols-[1fr_16rem_12rem] md:items-end">
                      <div className="flex items-center gap-2">
                        <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: station.colour }} />
                        <span className="text-fg text-sm font-semibold">{tx(station.name)}</span>
                        <Badge tone="muted">{tx(STATION_TYPE[station.type].label)}</Badge>
                      </div>
                      <Field label={t("kds.sortBy")}>
                        <Select
                          value={current.sort}
                          onChange={(event) => setStation(station.id, { sort: event.target.value as KdsSortMode })}
                        >
                          {KDS_SORT_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {t(SORT_LABEL[mode])}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label={t("kdsSetup.capacity15")}
                        hint={
                          auto > 0
                            ? t("kdsSetup.capacityAuto").replace("{n}", formatNumber(auto, fmt))
                            : t("kdsSetup.capacityNone")
                        }
                      >
                        <Input
                          dir="ltr"
                          inputMode="numeric"
                          placeholder={auto > 0 ? String(auto) : "—"}
                          value={current.capacityPer15 === null ? "" : String(current.capacityPer15)}
                          onChange={(event) => {
                            const digits = event.target.value.replace(/[^0-9]/g, "");
                            setStation(station.id, { capacityPer15: digits ? Number(digits) : null });
                          }}
                          maxLength={4}
                        />
                      </Field>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={t("kdsSetup.priorityTitle")} hint={t("kdsSetup.priorityHint")} spec="FR-KDS-023" />
            <ol className="space-y-1.5">
              {ranking.map((type, index) => (
                <li key={type} className="border-line flex min-h-12 items-center gap-2 rounded-lg border px-3">
                  <span className="text-fg-subtle w-6 text-sm tabular-nums">{index + 1}</span>
                  <span className="text-fg flex-1 text-sm font-medium">{tx(ORDER_TYPE[type].label)}</span>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={t("kdsSetup.moveUp")}
                    className="hover:bg-sunken grid h-12 w-12 place-items-center rounded-lg disabled:opacity-30"
                  >
                    <ArrowUp size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === ranking.length - 1}
                    aria-label={t("kdsSetup.moveDown")}
                    className="hover:bg-sunken grid h-12 w-12 place-items-center rounded-lg disabled:opacity-30"
                  >
                    <ArrowDown size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        </Section>

        <Section title={t("kdsSetup.itemsTitle")}>
          <Card>
            <CardHeader title={t("kdsSetup.itemsTitle")} hint={t("kdsSetup.itemsHint")} spec="FR-KDS-044 · FR-KDS-011" />
            <Field label={t("common.search")}>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} />
            </Field>
            {items.loading && !items.data ? (
              <Callout tone="muted">{t("state.loading")}</Callout>
            ) : (
              <ul className="divide-line mt-2 divide-y">
                {visibleItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    setup={itemSetup(item.id)}
                    onTarget={(seconds) => setItem(item.id, { targetSeconds: seconds })}
                    onToggleStation={(type) => {
                      const current = itemSetup(item.id).alsoStationTypes;
                      setItem(item.id, {
                        alsoStationTypes: current.includes(type)
                          ? current.filter((existing) => existing !== type)
                          : [...current, type],
                      });
                    }}
                  />
                ))}
              </ul>
            )}
            {(items.data ?? []).length > visibleItems.length ? (
              <p className="text-fg-subtle mt-2 text-xs">{t("kdsSetup.itemsLimited")}</p>
            ) : null}
          </Card>
        </Section>

        <Section title={t("kdsSetup.displayTitle")}>
          <Card>
            <CardHeader title={t("kdsSetup.displayTitle")} spec="FR-KDS-011 · FR-KDS-029 · FR-KDS-031" />
            <Toggle
              checked={draft.packagingForOffPremise}
              onChange={(next) => patch({ packagingForOffPremise: next })}
              label={t("kdsSetup.packaging")}
              hint={t("kdsSetup.packagingHint")}
            />
            <Toggle
              checked={draft.iconMode}
              onChange={(next) => patch({ iconMode: next })}
              label={t("kdsSetup.iconMode")}
              hint={t("kdsSetup.iconModeHint")}
            />
            <Field label={t("kdsSetup.cancelledWindow")} hint={t("kdsSetup.cancelledWindowHint")}>
              <Select
                value={draft.cancelledLineSeconds === null ? "keep" : String(draft.cancelledLineSeconds)}
                onChange={(event) =>
                  patch({
                    cancelledLineSeconds:
                      CANCELLED_WINDOWS.find((option) => option.value === event.target.value)?.seconds ?? null,
                  })
                }
              >
                {CANCELLED_WINDOWS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.seconds === null ? t("kdsSetup.keepUntilCleared") : formatElapsed(option.seconds)}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          <Card>
            <CardHeader title={t("kdsSetup.alertsTitle")} hint={t("kdsSetup.alertsHint")} />
            <Toggle checked={draft.alerts.newTicket} onChange={(v) => setAlert("newTicket", v)} label={t("kdsSetup.alertNew")} />
            <Toggle
              checked={draft.alerts.amendment}
              onChange={(v) => setAlert("amendment", v)}
              label={t("kdsSetup.alertAmendment")}
            />
            <Toggle
              checked={draft.alerts.cancellation}
              onChange={(v) => setAlert("cancellation", v)}
              label={t("kdsSetup.alertCancel")}
            />
            <Toggle checked={draft.alerts.overdue} onChange={(v) => setAlert("overdue", v)} label={t("kdsSetup.alertOverdue")} />
            <Toggle
              checked={draft.alerts.capacity}
              onChange={(v) => setAlert("capacity", v)}
              label={t("kdsSetup.alertCapacity")}
            />
          </Card>
        </Section>

        {JSON.stringify(draft) === JSON.stringify({ ...DEFAULT_KDS_SETUP, updatedAt: draft.updatedAt }) ? (
          <p className="text-fg-subtle text-xs">{t("kdsSetup.defaults")}</p>
        ) : null}
      </PageBody>

      <Toast message={message} />
    </>
  );
}

function ItemRow({
  item,
  setup,
  onTarget,
  onToggleStation,
}: {
  item: MenuItem;
  setup: { targetSeconds: number | null; alsoStationTypes: StationType[] };
  onTarget: (seconds: number | null) => void;
  onToggleStation: (type: StationType) => void;
}) {
  const { t, tx } = useI18n();
  const [text, setText] = useState(setup.targetSeconds ? formatElapsed(setup.targetSeconds) : "");
  const parsed = parseDuration(text);

  return (
    <li className="grid gap-3 py-3 lg:grid-cols-[14rem_11rem_1fr] lg:items-start">
      <div className="min-w-0">
        <p className="text-fg truncate text-sm font-semibold">{tx(item.name)}</p>
        <p className="text-fg-subtle text-xs">
          {t("kdsSetup.primaryStation").replace("{station}", tx(STATION_TYPE[item.stationType].label))}
        </p>
      </div>
      <Field
        label={t("kdsSetup.target")}
        hint={t("kdsSetup.targetDefault").replace("{time}", formatElapsed(item.prepTimeSeconds || 300))}
        error={parsed === undefined ? t("kdsSetup.targetInvalid") : undefined}
      >
        <Input
          dir="ltr"
          value={text}
          placeholder={formatElapsed(item.prepTimeSeconds || 300)}
          onChange={(event) => {
            setText(event.target.value);
            const next = parseDuration(event.target.value);
            if (next !== undefined) onTarget(next);
          }}
          maxLength={6}
        />
      </Field>
      <div>
        <p className="text-fg-muted mb-1 text-xs font-medium">{t("kdsSetup.alsoAt")}</p>
        <div className="flex flex-wrap gap-1.5">
          {STATION_TYPES.filter((type) => type !== item.stationType).map((type) => {
            const on = setup.alsoStationTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleStation(type)}
                className={cx(
                  "min-h-12 rounded-lg border px-3 text-xs font-medium",
                  on ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:text-fg",
                )}
              >
                {tx(STATION_TYPE[type].label)}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}
