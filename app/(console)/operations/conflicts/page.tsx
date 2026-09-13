"use client";

/**
 * Conflict register — SRS §21.7, FR-OFF-040 … FR-OFF-044.
 *
 * What two devices, or a device and the server, did to the same thing while
 * they could not see each other — and could not be settled by rule. Each
 * record shows both versions side by side (FR-OFF-043), and a manager keeps
 * one, keeps the other, or takes field by field. Automatic resolutions are
 * listed too, with the rule that decided them (FR-OFF-044), because "the
 * system chose" is only acceptable when someone can see what it chose.
 *
 * Clock skew (FR-OFF-042) sits on its own tab: a device whose clock runs
 * seven minutes fast is not a conflict yet, but it is the cause of the next
 * one.
 *
 * See `lib/console/services/conflicts.ts` for where the records come from.
 */

import { useMemo, useState } from "react";
import { Clock4, GitMerge } from "lucide-react";

import type { Terminal } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  STRATEGY_LABEL,
  type ConflictRecord,
  type SkewObservation,
} from "@/lib/console/services/conflicts";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/console/format";
import { SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import { DATA_MODE } from "@/lib/api/config";
import { useConnectivityStore } from "@/store/connectivity";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Drawer,
  Field,
  Input,
  Select,
  Tabs,
  Textarea,
  Toast,
  cx,
} from "@/components/console/ui";

type Tab = "open" | "resolved" | "automatic" | "skew";

export default function ConflictsPage() {
  return (
    <Gate permissions={["ops.terminal.view", "ops.live.view", "settings.branch.manage"]}>
      <ConflictsScreen />
    </Gate>
  );
}

function ConflictsScreen() {
  const { t, tx, fmt } = useI18n();
  const [tab, setTab] = useState<Tab>("open");
  const [selected, setSelected] = useState<ConflictRecord | null>(null);
  const [message, setMessage] = useTransientMessage();

  const records = useAsync(() => services.conflicts.list(), []);
  const rows = records.data ?? [];

  const counts = {
    open: rows.filter((row) => row.status === "open").length,
    resolved: rows.filter((row) => row.status === "resolved" && !row.automatic).length,
    automatic: rows.filter((row) => row.automatic).length,
  };

  const visible = rows.filter((row) =>
    tab === "open"
      ? row.status === "open"
      : tab === "resolved"
        ? row.status === "resolved" && !row.automatic
        : row.automatic,
  );

  const columns: Column<ConflictRecord>[] = [
    {
      key: "detectedAt",
      header: t("cfx.detected"),
      render: (row) => (
        <CellStack primary={formatRelative(row.detectedAt, fmt)} secondary={formatDateTime(row.detectedAt, fmt)} />
      ),
    },
    {
      key: "label",
      header: t("cfx.what"),
      render: (row) => <CellStack primary={row.label} secondary={<span className="font-mono">{row.entityType}</span>} />,
    },
    { key: "device", header: t("cfx.device"), render: (row) => row.deviceName },
    {
      key: "strategy",
      header: t("cfx.strategy"),
      secondary: true,
      render: (row) => <span className="text-fg-muted text-xs">{tx(STRATEGY_LABEL[row.strategy])}</span>,
    },
    {
      key: "reason",
      header: t("cfx.reason"),
      render: (row) =>
        row.automatic ? (
          <span className="text-fg-muted line-clamp-2 text-xs">{row.appliedRule}</span>
        ) : (
          <span className="text-fg-muted line-clamp-2 text-xs">{row.reasonDetail ?? row.reasonCode ?? "—"}</span>
        ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) =>
        row.status === "open" ? (
          <Badge tone="bad" dot>
            {t("cfx.open")}
          </Badge>
        ) : (
          <Badge tone={row.automatic ? "muted" : "good"}>{t(`cfx.res.${row.resolution ?? "kept_server"}` as never)}</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t("cfx.title")} subtitle={t("cfx.subtitle")} spec="FR-OFF-043" />

      <PageBody>
        <Callout tone="muted">{DATA_MODE === "http" ? t("cfx.sourceLive") : t("cfx.sourceDemo")}</Callout>

        <TileGrid columns={3}>
          <MetricTile label={t("cfx.openCount")} value={formatNumber(counts.open, fmt)} />
          <MetricTile label={t("cfx.resolvedCount")} value={formatNumber(counts.resolved, fmt)} />
          <MetricTile label={t("cfx.automaticCount")} value={formatNumber(counts.automatic, fmt)} />
        </TileGrid>

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          label={t("cfx.title")}
          options={[
            { value: "open", label: t("cfx.tabOpen"), count: counts.open },
            { value: "resolved", label: t("cfx.tabResolved"), count: counts.resolved },
            { value: "automatic", label: t("cfx.tabAutomatic"), count: counts.automatic },
            { value: "skew", label: t("cfx.tabSkew") },
          ]}
        />

        {tab === "skew" ? (
          <SkewPanel notify={setMessage} />
        ) : (
          <AsyncPanel state={records}>
            {() => (
              <DataTable
                columns={columns}
                rows={visible}
                rowKey={(row) => row.id}
                onRowClick={setSelected}
                activeRowKey={selected?.id ?? null}
                caption={t("cfx.title")}
                emptyTitle={tab === "open" ? t("cfx.noneOpen") : t("cfx.none")}
                emptyBody={tab === "open" ? t("cfx.noneOpenBody") : undefined}
              />
            )}
          </AsyncPanel>
        )}
      </PageBody>

      {selected ? (
        <ResolveDrawer
          record={selected}
          onClose={() => setSelected(null)}
          onResolved={() => {
            setSelected(null);
            records.reload();
            setMessage(t("cfx.resolvedToast"));
          }}
        />
      ) : null}

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Both versions, side by side — FR-OFF-043
// ---------------------------------------------------------------------------

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ResolveDrawer({
  record,
  onClose,
  onResolved,
}: {
  record: ConflictRecord;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { canAny, session } = useSession();
  const action = useAction();
  const resolveQueued = useConnectivityStore((s) => s.resolveConflict);
  const canResolve = canAny(["ops.terminal.manage", "settings.branch.manage"]);
  const open = record.status === "open";

  const fields = useMemo(() => {
    const keys = new Set([...Object.keys(record.device), ...Object.keys(record.server ?? {})]);
    return [...keys].map((key) => {
      const device = record.device[key];
      const server = record.server ? record.server[key] : undefined;
      return { key, device, server, differs: show(device) !== show(server) };
    });
  }, [record]);

  const mergeable = record.server !== null && (record.strategy === "crdt_lines" || record.strategy === "lww_hlc");
  const [choice, setChoice] = useState<"kept_device" | "kept_server" | "merged">("kept_server");
  const [picks, setPicks] = useState<Record<string, "device" | "server">>(() =>
    Object.fromEntries(fields.filter((field) => field.differs).map((field) => [field.key, "server"])),
  );
  const [note, setNote] = useState("");

  async function resolve() {
    const merged =
      choice === "merged"
        ? Object.fromEntries(
            fields.map((field) => [field.key, picks[field.key] === "device" ? field.device : (field.server ?? field.device)]),
          )
        : null;
    await action.run(
      async () => {
        const saved = await services.conflicts.resolve(record.id, {
          resolution: choice,
          merged,
          note,
          by: session?.user.email ?? null,
        });
        // A register entry that mirrors the till's queue settles the queue too:
        // keeping the device's version re-sends it, keeping the server's drops it.
        if (record.queueId) resolveQueued(record.queueId, choice === "kept_server" ? "server" : "local");
        return saved;
      },
      { onSuccess: onResolved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={record.label}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{record.entityType}</span>
          <Badge tone="neutral">{tx(STRATEGY_LABEL[record.strategy])}</Badge>
        </span>
      }
      footer={
        open && canResolve ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<GitMerge size={14} />} loading={action.pending} disabled={note.trim().length < 5} onClick={resolve}>
              {t("cfx.resolve")}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {record.reasonDetail ? <Callout tone={open ? "warn" : "muted"}>{record.reasonDetail}</Callout> : null}
        {record.automatic && record.appliedRule ? (
          <Callout tone="muted" title={t("cfx.appliedRule")}>
            {record.appliedRule}
          </Callout>
        ) : null}
        {open && !canResolve ? <Callout tone="muted">{t("cfx.cannotResolve")}</Callout> : null}

        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-sunken/60">
              <tr>
                <th className="text-fg-muted px-3 py-2 text-start text-xs font-medium">{t("cfx.field")}</th>
                <th className="text-fg-muted px-3 py-2 text-start text-xs font-medium">
                  {t("cfx.deviceVersion")}
                  <span className="text-fg-subtle block font-normal">
                    {record.deviceName} · {formatDateTime(record.deviceAt, fmt)}
                  </span>
                </th>
                <th className="text-fg-muted px-3 py-2 text-start text-xs font-medium">
                  {t("cfx.serverVersion")}
                  <span className="text-fg-subtle block font-normal">{formatDateTime(record.serverAt, fmt)}</span>
                </th>
                {open && choice === "merged" ? <th className="text-fg-muted px-3 py-2 text-xs font-medium">{t("cfx.take")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {fields.map((field) => (
                <tr key={field.key} className={cx(field.differs && "bg-warn-soft/40")}>
                  <td className="text-fg-muted px-3 py-2 font-mono text-xs">{field.key}</td>
                  <td className={cx("px-3 py-2 break-all", field.differs && "font-semibold")}>{show(field.device)}</td>
                  <td className={cx("px-3 py-2 break-all", field.differs && "font-semibold")}>
                    {record.server ? show(field.server) : <span className="text-fg-subtle italic">{t("cfx.noServerCopy")}</span>}
                  </td>
                  {open && choice === "merged" ? (
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {field.differs ? (
                        <span className="flex gap-2">
                          {(["device", "server"] as const).map((side) => (
                            <label key={side} className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`pick-${field.key}`}
                                checked={picks[field.key] === side}
                                onChange={() => setPicks((current) => ({ ...current, [field.key]: side }))}
                                className="accent-accent"
                              />
                              {side === "device" ? t("cfx.deviceShort") : t("cfx.serverShort")}
                            </label>
                          ))}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">{t("cfx.same")}</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open && canResolve ? (
          <fieldset className="space-y-3">
            <legend className="text-fg mb-2 text-sm font-semibold">{t("cfx.decision")}</legend>
            {(
              [
                ["kept_server", t("cfx.keepServer"), t("cfx.keepServerHint")],
                ["kept_device", t("cfx.keepDevice"), record.queueId ? t("cfx.keepDeviceQueueHint") : t("cfx.keepDeviceHint")],
                ...(mergeable ? [["merged", t("cfx.merge"), t("cfx.mergeHint")] as const] : []),
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cx(
                  "flex cursor-pointer gap-3 rounded-lg border p-3",
                  choice === value ? "border-accent bg-accent-soft/40" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="decision"
                  checked={choice === value}
                  onChange={() => setChoice(value as typeof choice)}
                  className="accent-accent mt-1"
                />
                <span>
                  <span className="text-fg block text-sm font-medium">{label}</span>
                  <span className="text-fg-muted block text-xs">{hint}</span>
                </span>
              </label>
            ))}
            <Field label={t("cfx.note")} hint={t("cfx.noteHint")} required>
              <Textarea rows={2} value={note} maxLength={400} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </fieldset>
        ) : !open ? (
          <Card>
            <CardHeader title={t("cfx.outcome")} />
            <p className="text-fg text-sm">{t(`cfx.res.${record.resolution ?? "kept_server"}` as never)}</p>
            <p className="text-fg-muted mt-1 text-xs">
              {record.resolvedBy ?? "—"} · {formatDateTime(record.resolvedAt, fmt)}
            </p>
            {record.note ? <p className="text-fg-muted mt-2 text-sm italic">“{record.note}”</p> : null}
            {record.merged ? (
              <pre className="bg-sunken border-line mt-3 overflow-x-auto rounded-lg border p-2 text-xs">{JSON.stringify(record.merged, null, 2)}</pre>
            ) : null}
          </Card>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Clock skew — FR-OFF-042
// ---------------------------------------------------------------------------

function SkewPanel({ notify }: { notify: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const { tenant, scope } = useSession();
  const action = useAction(notify);
  const data = useAsync(
    async () => {
      const [observations, overrides] = await Promise.all([
        services.conflicts.skew(),
        services.settings.overrides().catch(() => []),
      ]);
      return { observations, overrides };
    },
    [],
  );
  const terminals = useAsync<Terminal[]>(
    () =>
      services.operations
        .terminals({ scope, limit: 200 })
        .then((page) => page.rows)
        .catch(() => []),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const [deviceId, setDeviceId] = useState("");
  const [minutes, setMinutes] = useState("7");

  const threshold = Number(
    resolveSetting(SETTING_BY_KEY.get("sync.clockSkewMinutes")!, data.data?.overrides ?? [], {
      countryCode: tenant.countryCode,
      tenantId: tenant.id,
      brandId: null,
      branchId: null,
      terminalId: null,
    }).value,
  );

  const columns: Column<SkewObservation>[] = [
    { key: "device", header: t("cfx.device"), render: (row) => <CellStack primary={row.deviceName} secondary={<span className="font-mono">{row.deviceId}</span>} /> },
    {
      key: "skew",
      header: t("skew.offset"),
      numeric: true,
      render: (row) => {
        const value = row.skewMs / 60_000;
        return (
          <span className={cx("font-mono tabular-nums", Math.abs(value) > threshold && "text-bad font-semibold")}>
            {value > 0 ? "+" : ""}
            {formatNumber(value, fmt, 1)} {t("set.minutes")}
          </span>
        );
      },
    },
    {
      key: "state",
      header: t("common.status"),
      render: (row) =>
        Math.abs(row.skewMs / 60_000) > threshold ? <Badge tone="bad">{t("skew.over")}</Badge> : <Badge tone="good">{t("skew.within")}</Badge>,
    },
    { key: "observedAt", header: t("cfx.detected"), render: (row) => formatDateTime(row.observedAt, fmt) },
    { key: "source", header: t("skew.source"), render: (row) => <Badge tone="muted">{t(`skew.src.${row.source}` as never)}</Badge> },
  ];

  const mins = Number(minutes);

  return (
    <div className="space-y-4">
      <Callout tone="accent" icon={<Clock4 size={14} />} title={t("skew.title")}>
        {t("skew.body").replace("{n}", String(threshold))}
      </Callout>

      <AsyncPanel state={data}>
        {(ready) => (
          <DataTable
            columns={columns}
            rows={ready.observations}
            rowKey={(row) => row.id}
            caption={t("skew.title")}
            emptyTitle={t("skew.none")}
            emptyBody={t("skew.noneBody")}
            dense
          />
        )}
      </AsyncPanel>

      {DATA_MODE === "http" ? null : (
        <Card>
          <CardHeader title={t("skew.simulateTitle")} hint={t("skew.simulateHint")} />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
            <Field label={t("cfx.device")}>
              <Select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                <option value="">—</option>
                {(terminals.data ?? []).map((terminal) => (
                  <option key={terminal.id} value={terminal.id}>
                    {terminal.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("skew.offsetMinutes")}>
              <Input dir="ltr" inputMode="decimal" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            </Field>
            <Button
              disabled={!deviceId || !Number.isFinite(mins)}
              loading={action.pending}
              onClick={() => {
                const terminal = (terminals.data ?? []).find((row) => row.id === deviceId);
                void action.run(
                  () =>
                    services.conflicts.recordSkew({
                      deviceId,
                      deviceName: terminal?.name ?? deviceId,
                      skewMs: Math.round(mins * 60_000),
                      source: "simulated",
                    }),
                  { onSuccess: () => data.reload(), success: t("skew.recorded") },
                );
              }}
            >
              {t("skew.record")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
