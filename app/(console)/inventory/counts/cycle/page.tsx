"use client";

/**
 * Cycle counting — SRS FR-INV-048.
 *
 * A rolling schedule instead of a full count: class A items (the top of the
 * value curve, or anything whose counts keep disagreeing) are counted weekly,
 * B monthly, C quarterly — by default, and the tenant can change all three.
 * Each day the items that have fallen due are put on one sheet, capped so the
 * count fits in a shift; what does not fit rolls to tomorrow.
 *
 * The classification is computed here from the location's current stock
 * value and its posted count history (`classifyForCycle`) every time the
 * page is drawn. The policy and any pinned classes are kept on this device
 * (`services.inventoryControls.cycle`). Starting today's count opens a real
 * `item_list` count session (`POST /inventory/counts`).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Pin, PinOff, Settings2 } from "lucide-react";

import type { CountSession, Id, StockLevel, StockLocation } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { CycleSettings } from "@/lib/console/services/inventory-controls";
import { annualWorkload, classifyForCycle, dueToday, type CycleClass, type CyclePolicy, type CycleRow } from "@/lib/console/inventory-cycle";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatPercent, money } from "@/lib/console/format";
import { DATA_MODE } from "@/lib/api/config";
import type { ConsoleKey } from "@/locales";
import { useConfirm } from "@/components/console/confirm";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { CountSheetButton } from "@/components/console/inventory-count-sheet";
import { Badge, Button, Callout, Drawer, Field, Input, Toast, Toggle } from "@/components/console/ui";

export default function CycleCountPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <CycleScreen />
    </Gate>
  );
}

const CLASS_TONE: Record<CycleClass, "bad" | "warn" | "muted"> = { A: "bad", B: "warn", C: "muted" };

interface Loaded {
  locations: StockLocation[];
  settings: CycleSettings;
}

function CycleScreen() {
  const { t } = useI18n();
  const { scope } = useSession();
  const [message, setMessage] = useTransientMessage();
  const base = useAsync<Loaded>(async () => {
    const [locations, settings] = await Promise.all([
      services.organisation.locations(),
      services.inventoryControls.cycle.settings(),
    ]);
    return { locations, settings };
  }, []);
  const [locationId, setLocationId] = useState<Id>(scope.branchId ?? "");

  useEffect(() => {
    if (!locationId && base.data?.locations[0]) setLocationId(base.data.locations[0].id);
  }, [base.data, locationId]);

  return (
    <>
      <PageHeader
        title={t("invx.cyc.title")}
        subtitle={t("invx.cyc.subtitle")}
        spec="FR-INV-048"
        crumbs={[{ label: t("inv.countsTitle"), href: "/inventory/counts" }, { label: t("invx.cyc.title") }]}
      />
      <PageBody>
        <AsyncPanel state={base}>
          {(loaded) =>
            locationId ? (
              <CycleBody
                key={`${locationId}-${loaded.settings.updatedAt ?? ""}`}
                locations={loaded.locations}
                settings={loaded.settings}
                locationId={locationId}
                onLocation={setLocationId}
                onChanged={(note) => {
                  setMessage(note);
                  base.reload();
                }}
              />
            ) : null
          }
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function CycleBody({
  locations,
  settings,
  locationId,
  onLocation,
  onChanged,
}: {
  locations: StockLocation[];
  settings: CycleSettings;
  locationId: Id;
  onLocation: (id: Id) => void;
  onChanged: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session, tenant } = useSession();
  const router = useRouter();
  const canCount = usePermission("inventory.count.perform");
  const canConfigure = usePermission("inventory.item.manage");
  const confirm = useConfirm();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [classFilter, setClassFilter] = useState("all");

  const data = useAsync(async () => {
    const [levels, sessions, starts] = await Promise.all([
      services.inventory.levels.list({ limit: 5000, filters: { locationId } }).then((page) => page.rows),
      services.inventory.counts.list({ limit: 500, filters: { locationId } }).then((page) => page.rows).catch(() => [] as CountSession[]),
      services.inventoryControls.cycle.starts(),
    ]);
    // The counts list carries no lines for posted sessions in some sources;
    // read the posted ones in full for their variance history.
    const posted = await Promise.all(
      sessions
        .filter((row) => row.status === "posted" && row.lines.length === 0)
        .slice(0, 30)
        .map((row) => services.inventory.counts.get(row.id).catch(() => null)),
    );
    const full = sessions.map((row) => posted.find((read) => read?.id === row.id) ?? row);
    return { levels: levels.filter((level: StockLevel) => level.locationId === locationId), sessions: full, starts: starts.filter((row) => row.locationId === locationId) };
  }, [locationId]);

  const rows = useMemo(
    () =>
      data.data
        ? classifyForCycle({
            levels: data.data.levels,
            locationId,
            sessions: data.data.sessions,
            policy: settings.policy,
            pins: settings.pins[locationId] ?? {},
            today: new Date(),
          })
        : [],
    [data.data, locationId, settings],
  );
  const due = useMemo(() => dueToday(rows, settings.policy), [rows, settings.policy]);
  const workload = annualWorkload(rows, settings.policy);
  const overdue = rows.filter((row) => row.daysUntilDue < 0).length;
  const location = locations.find((row) => row.id === locationId);
  const visible = classFilter === "all" ? rows : classFilter === "due" ? due : rows.filter((row) => row.cycleClass === classFilter);

  async function pin(row: CycleRow, value: CycleClass | null) {
    const forLocation = { ...(settings.pins[locationId] ?? {}) };
    if (value) forLocation[row.itemId] = value;
    else delete forLocation[row.itemId];
    await action.run(
      () =>
        services.inventoryControls.cycle.saveSettings({
          ...settings,
          pins: { ...settings.pins, [locationId]: forLocation },
          updatedBy: session?.user.email ?? null,
        }),
      { onSuccess: () => onChanged(value ? t("invx.cyc.pinned") : t("invx.cyc.unpinned")) },
    );
  }

  async function startToday() {
    const ok = await confirm({
      title: t("invx.cyc.startTitle"),
      body: t("invx.cyc.startBody").replace("{n}", String(due.length)).replace("{location}", tx(location?.name)),
      confirmLabel: t("invx.cyc.start"),
      tone: "neutral",
    });
    if (!ok) return;
    await action.run(
      async () => {
        const created = await services.inventory.counts.create({
          locationId,
          locationName: location?.name,
          mode: "blind",
          scopeType: "item_list",
          itemIds: due.map((row) => row.itemId),
        });
        await services.inventoryControls.cycle.recordStart({
          sessionId: created.id,
          reference: created.reference || created.id,
          locationId,
          itemIds: due.map((row) => row.itemId),
          startedAt: new Date().toISOString(),
          startedBy: session?.user.email ?? null,
        });
        return created;
      },
      {
        onSuccess: (created) => {
          const query = new URLSearchParams({ open: created.id, location: locationId, mode: created.mode, reference: created.reference || "" });
          router.push(`/inventory/counts?${query.toString()}`);
        },
      },
    );
  }

  const columns: Column<CycleRow>[] = [
    { key: "item", header: t("inv.item"), render: (row) => <CellStack primary={tx(row.itemName)} secondary={<span className="font-mono">{row.sku}</span>} /> },
    {
      key: "class",
      header: t("invx.cyc.class"),
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={CLASS_TONE[row.cycleClass]}>{row.cycleClass}</Badge>
          <span className="text-fg-subtle text-xs">{t(`invx.cyc.reason.${row.reason}` as ConsoleKey)}</span>
        </span>
      ),
    },
    { key: "value", header: t("common.value"), numeric: true, render: (row) => formatMoney(money(row.valueMinor, tenant.baseCurrency), fmt) },
    {
      key: "variance",
      header: t("invx.cyc.variance"),
      numeric: true,
      secondary: true,
      render: (row) =>
        row.historicalVariance === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span title={t("invx.cyc.countsSeen").replace("{n}", String(row.countsSeen))}>{formatPercent(row.historicalVariance, fmt, 1)}</span>
        ),
    },
    { key: "last", header: t("invx.cyc.lastCounted"), secondary: true, render: (row) => (row.lastCountedAt ? formatDate(row.lastCountedAt, fmt) : t("invx.cyc.never")) },
    {
      key: "due",
      header: t("invx.cyc.due"),
      render: (row) =>
        row.daysUntilDue < 0 ? (
          <Badge tone="bad">{t("invx.cyc.overdueBy").replace("{n}", String(-row.daysUntilDue))}</Badge>
        ) : row.daysUntilDue === 0 ? (
          <Badge tone="warn">{t("invx.cyc.today")}</Badge>
        ) : (
          formatDate(row.dueOn, fmt)
        ),
    },
    {
      key: "pin",
      header: t("invx.cyc.pin"),
      render: (row) =>
        canConfigure ? (
          <span className="flex gap-1" onClick={(event) => event.stopPropagation()}>
            {(["A", "B", "C"] as CycleClass[]).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={row.pinnedClass === value ? "primary" : "ghost"}
                aria-label={t("invx.cyc.pinTo").replace("{c}", value)}
                icon={row.pinnedClass === value ? <Pin size={10} /> : undefined}
                onClick={() => void pin(row, row.pinnedClass === value ? null : value)}
              >
                {value}
              </Button>
            ))}
            {row.pinnedClass ? (
              <Button size="sm" variant="ghost" icon={<PinOff size={10} />} aria-label={t("invx.cyc.unpin")} onClick={() => void pin(row, null)} />
            ) : null}
          </span>
        ) : row.pinnedClass ? (
          <Pin size={12} aria-label={t("invx.cyc.pinTo").replace("{c}", row.pinnedClass)} />
        ) : null,
    },
  ];

  return (
    <>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {DATA_MODE === "http" ? <Callout tone="warn">{t("invx.cyc.liveHistory")}</Callout> : null}

      <Toolbar
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={() => setEditing(true)}>
              {t("invx.cyc.policy")}
            </Button>
            <Link href="/inventory/counts/storage" className="text-accent text-xs hover:underline">
              {t("invx.sto.title")}
            </Link>
          </>
        }
      >
        <FilterSelect
          filter={{ key: "location", label: t("common.location"), allLabel: t("invx.cyc.chooseLocation"), options: locations.map((row) => ({ value: row.id, label: tx(row.name) })) }}
          value={locationId}
          onChange={(value) => value !== "all" && onLocation(value)}
        />
        <FilterSelect
          filter={{
            key: "class",
            label: t("invx.cyc.class"),
            options: [
              { value: "due", label: t("invx.cyc.dueToday") },
              { value: "A", label: "A" },
              { value: "B", label: "B" },
              { value: "C", label: "C" },
            ],
          }}
          value={classFilter}
          onChange={setClassFilter}
        />
      </Toolbar>

      <AsyncPanel state={data}>
        {(loaded) => (
          <>
            <TileGrid columns={4}>
              <MetricTile label={t("invx.cyc.dueToday")} value={formatNumber(due.length, fmt)} spec="FR-INV-048" hint={t("invx.cyc.dueTodayHint").replace("{n}", String(settings.policy.maxLinesPerCount))} />
              <MetricTile label={t("invx.cyc.overdue")} value={formatNumber(overdue, fmt)} />
              <MetricTile
                label={t("invx.cyc.classes")}
                value={`${rows.filter((r) => r.cycleClass === "A").length} / ${rows.filter((r) => r.cycleClass === "B").length} / ${rows.filter((r) => r.cycleClass === "C").length}`}
                hint={t("invx.cyc.classesHint")}
              />
              <MetricTile
                label={t("invx.cyc.workload")}
                value={formatNumber(workload.A + workload.B + workload.C, fmt)}
                hint={t("invx.cyc.workloadHint").replace("{a}", String(workload.A)).replace("{b}", String(workload.B)).replace("{c}", String(workload.C))}
              />
            </TileGrid>

            <Section
              title={t("invx.cyc.todayTitle")}
              hint={t("invx.cyc.todayHint")}
              action={
                <span className="flex flex-wrap items-center gap-2">
                  <CountSheetButton
                    title={t("invx.cyc.sheetTitle")}
                    reference={formatDate(new Date().toISOString(), fmt)}
                    locationId={locationId}
                    locationName={tx(location?.name)}
                    blind
                    lines={due.map((row) => {
                      const level = loaded.levels.find((l) => l.itemId === row.itemId);
                      return { itemId: row.itemId, itemName: row.itemName, sku: row.sku, unit: level?.onHand.unit ?? "", expected: null };
                    })}
                  />
                  {canCount ? (
                    <Button size="sm" variant="primary" icon={<ClipboardList size={12} />} loading={action.pending} disabled={due.length === 0} onClick={() => void startToday()}>
                      {t("invx.cyc.start")}
                    </Button>
                  ) : null}
                </span>
              }
            >
              {due.length === 0 ? (
                <p className="text-fg-muted text-sm">{t("invx.cyc.nothingDue")}</p>
              ) : (
                <p className="text-fg-muted text-sm">
                  {t("invx.cyc.dueSummary")
                    .replace("{a}", String(due.filter((r) => r.cycleClass === "A").length))
                    .replace("{b}", String(due.filter((r) => r.cycleClass === "B").length))
                    .replace("{c}", String(due.filter((r) => r.cycleClass === "C").length))}
                </p>
              )}
              {loaded.starts.length > 0 ? (
                <p className="text-fg-subtle mt-2 text-xs">
                  {t("invx.cyc.lastStarted")
                    .replace("{ref}", [...loaded.starts].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!.reference)
                    .replace("{at}", formatDate([...loaded.starts].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!.startedAt, fmt))}
                </p>
              ) : null}
            </Section>

            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(row) => row.itemId}
              caption={t("invx.cyc.title")}
              emptyTitle={t("invx.cyc.emptyTitle")}
              emptyBody={t("invx.cyc.emptyBody")}
              dense
            />
          </>
        )}
      </AsyncPanel>

      {editing ? (
        <PolicyDrawer
          settings={settings}
          canEdit={canConfigure}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged(t("invx.cyc.policySaved"));
          }}
        />
      ) : null}
    </>
  );
}

function PolicyDrawer({ settings, canEdit, onClose, onSaved }: { settings: CycleSettings; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const p = settings.policy;
  const [draft, setDraft] = useState({
    aValueShare: String(p.aValueShare),
    bValueShare: String(p.bValueShare),
    highVariancePercent: String(p.highVariancePercent),
    A: String(p.frequencyDays.A),
    B: String(p.frequencyDays.B),
    C: String(p.frequencyDays.C),
    maxLinesPerCount: String(p.maxLinesPerCount),
  });
  const [useVariance, setUseVariance] = useState(p.highVariancePercent < 1000);
  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const policy: CyclePolicy = {
    aValueShare: Number(draft.aValueShare),
    bValueShare: Number(draft.bValueShare),
    highVariancePercent: useVariance ? Number(draft.highVariancePercent) : 1000,
    frequencyDays: { A: Number(draft.A), B: Number(draft.B), C: Number(draft.C) },
    maxLinesPerCount: Number(draft.maxLinesPerCount),
  };
  const problems: string[] = [];
  if (!(policy.aValueShare > 0 && policy.aValueShare < policy.bValueShare && policy.bValueShare < 100)) problems.push(t("invx.cyc.badShares"));
  if (![policy.frequencyDays.A, policy.frequencyDays.B, policy.frequencyDays.C].every((n) => Number.isInteger(n) && n > 0)) problems.push(t("invx.cyc.badFrequency"));
  else if (!(policy.frequencyDays.A <= policy.frequencyDays.B && policy.frequencyDays.B <= policy.frequencyDays.C)) problems.push(t("invx.cyc.badOrder"));
  if (!(Number.isInteger(policy.maxLinesPerCount) && policy.maxLinesPerCount > 0)) problems.push(t("invx.cyc.badLines"));
  if (useVariance && !(policy.highVariancePercent >= 0)) problems.push(t("invx.cyc.badVariance"));

  const field = (key: keyof typeof draft, label: ConsoleKey, hint?: ConsoleKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <Input dir="ltr" inputMode="decimal" value={draft[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("invx.cyc.policy")}
      subtitle="FR-INV-048"
      footer={
        canEdit ? (
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={action.pending}
              disabled={problems.length > 0}
              onClick={() => void action.run(() => services.inventoryControls.cycle.saveSettings({ ...settings, policy, updatedBy: session?.user.email ?? null }), { onSuccess: onSaved })}
            >
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!canEdit ? <Callout tone="muted">{t("invx.common.readOnly")}</Callout> : null}
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("aValueShare", "invx.cyc.aShare", "invx.cyc.aShareHint")}
            {field("bValueShare", "invx.cyc.bShare", "invx.cyc.bShareHint")}
          </div>
          <Toggle checked={useVariance} onChange={setUseVariance} label={t("invx.cyc.useVariance")} hint={t("invx.cyc.useVarianceHint")} />
          {useVariance ? field("highVariancePercent", "invx.cyc.variancePct") : null}
          <div className="grid gap-4 sm:grid-cols-3">
            {field("A", "invx.cyc.everyA")}
            {field("B", "invx.cyc.everyB")}
            {field("C", "invx.cyc.everyC")}
          </div>
          {field("maxLinesPerCount", "invx.cyc.maxLines", "invx.cyc.maxLinesHint")}
        </fieldset>
        {problems.length > 0 ? (
          <ul className="text-fg-subtle space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}
