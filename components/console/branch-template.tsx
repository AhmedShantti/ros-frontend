"use client";

/**
 * New branch from an existing one — FR-BRN-008.
 *
 * Opening the tenth branch should not mean re-keying the ninth. This copies
 * what is configuration rather than history: the menus it sells from, its
 * kitchen stations, trading hours, printer routing, the station routing that
 * sends each category to a station, and every setting overridden at branch
 * level.
 *
 * There is no copy endpoint, so the copy is the same sequence of calls a
 * person would make by hand, one after another. That is not atomic, and the
 * screen does not pretend otherwise: every step reports what it did, a step
 * that fails does not stop the ones after it, and the new branch exists from
 * the first step on — so a partial copy is visible and can be finished by
 * hand, never silently half-done.
 *
 * Two things in the SRS list are deliberately not copied. Roles are defined
 * once for the tenant, so the new branch already has them; who holds them
 * there is a decision about people. And stock, orders and cash are history,
 * which a template has no business carrying.
 */

import { useState } from "react";
import { Check, CircleSlash, Copy, X } from "lucide-react";

import type { Branch, Localised, Station } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { overrideAt, todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { EMPTY_LOCALISED, LocalisedField, hasLocalisedText, trimLocalised } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Drawer, Field, Input, Select, Toggle, cx } from "@/components/console/ui";

type Part = "menus" | "stations" | "hours" | "printers" | "routing" | "settings";
const PARTS: Part[] = ["menus", "stations", "hours", "printers", "routing", "settings"];

interface StepResult {
  key: Part | "branch";
  status: "done" | "failed" | "skipped";
  count: number;
  detail: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BranchTemplateDrawer({
  open,
  branches,
  onClose,
  onCreated,
}: {
  open: boolean;
  branches: Branch[];
  onClose: () => void;
  onCreated: (branch: Branch) => void;
}) {
  const { t, tx } = useI18n();
  const { scope, session } = useSession();
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState<Localised>(EMPTY_LOCALISED);
  const [code, setCode] = useState("");
  const [parts, setParts] = useState<Set<Part>>(new Set(PARTS));
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = branches.find((row) => row.id === sourceId) ?? null;

  // What the source actually has, so the choice is made against real counts.
  const preview = useAsync(async () => {
    if (!sourceId) return null;
    const soft = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
    const [menus, stations, hours, printers, routing, overrides] = await Promise.all([
      soft(services.catalogue.resolveBranchMenus(sourceId).then((row) => row.menus), []),
      soft(
        services.operations
          .stations({ limit: 500, scope: { ...scope, branchId: sourceId } })
          .then((page) => page.rows.filter((row) => row.branchId === sourceId)),
        [] as Station[],
      ),
      soft(services.organisation.operatingHours(sourceId), []),
      soft(services.organisation.printRouting(sourceId), []),
      soft(services.organisation.stationRoutingRules(sourceId), []),
      soft(services.settings.overrides(), []),
    ]);
    const today = todayIso();
    const keys = [...new Set(overrides.filter((row) => row.level === "branch" && row.targetId === sourceId).map((row) => row.key))];
    const settings = keys
      .map((key) => overrideAt(overrides, key, "branch", sourceId, today))
      .filter((row): row is NonNullable<typeof row> => row !== null && row.value !== null);
    return { menus, stations, hours, printers, routing, settings };
  }, [sourceId, scope.tenantId]);

  const counts: Record<Part, number> | null = preview.data
    ? {
        menus: preview.data.menus.length,
        stations: preview.data.stations.length,
        hours: preview.data.hours.length,
        printers: preview.data.printers.length,
        routing: preview.data.routing.length,
        settings: preview.data.settings.length,
      }
    : null;

  function reset() {
    setSourceId("");
    setName(EMPTY_LOCALISED);
    setCode("");
    setParts(new Set(PARTS));
    setResults(null);
    setError(null);
  }

  function close() {
    if (running) return;
    reset();
    onClose();
  }

  function toggle(part: Part, on: boolean) {
    setParts((current) => {
      const next = new Set(current);
      if (on) next.add(part);
      else next.delete(part);
      // Station routing points at stations; without the stations it has nothing to point at.
      if (part === "stations" && !on) next.delete("routing");
      return next;
    });
  }

  async function run() {
    if (!source || !preview.data) return;
    if (!hasLocalisedText(name) || !code.trim()) {
      setError(t("tpl.needNameCode"));
      return;
    }
    setError(null);
    setRunning(true);
    const log: StepResult[] = [];
    const push = (row: StepResult) => {
      log.push(row);
      setResults([...log]);
    };

    let created: Branch;
    try {
      created = await services.organisation.branches.create({
        name: trimLocalised(name),
        code: code.trim(),
        brandId: source.brandId,
        countryCode: source.countryCode,
        currency: source.currency,
        timezone: source.timezone,
      });
      push({ key: "branch", status: "done", count: 1, detail: null });
    } catch (cause) {
      push({ key: "branch", status: "failed", count: 0, detail: errorText(cause) });
      setRunning(false);
      return;
    }

    const data = preview.data;
    const stationMap = new Map<string, string>();

    // Each step keeps going past a single failed row and reports the tally.
    async function step<T>(key: Part, rows: T[], each: (row: T) => Promise<unknown>) {
      if (!parts.has(key)) {
        push({ key, status: "skipped", count: 0, detail: null });
        return;
      }
      let done = 0;
      const failures: string[] = [];
      for (const row of rows) {
        try {
          await each(row);
          done += 1;
        } catch (cause) {
          failures.push(errorText(cause));
        }
      }
      push({
        key,
        status: failures.length === 0 ? "done" : "failed",
        count: done,
        detail: failures.length ? `${failures.length}/${rows.length}: ${[...new Set(failures)].join(" · ")}` : null,
      });
    }

    await step("menus", data.menus, (menu) => services.catalogue.assignMenuToBranch(menu.id, created.id));
    await step("stations", data.stations, async (station) => {
      const copy = await services.operations.createStation(created.id, {
        name: station.name,
        type: station.type,
        colour: station.colour,
        capacityPerHour: station.capacityPerHour,
      });
      stationMap.set(station.id, copy.id);
    });
    await step("hours", data.hours, (row) =>
      services.organisation.addOperatingHours(created.id, {
        dayOfWeek: row.dayOfWeek,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
        businessDayCutover: row.businessDayCutover,
      }),
    );
    await step("printers", data.printers, (row) =>
      services.organisation.addPrintRouting(created.id, {
        documentType: row.documentType as "receipt" | "kitchen_ticket" | "bar_ticket",
        printerTarget: row.printerTarget,
        stationId: row.stationId ? stationMap.get(row.stationId) : undefined,
      }),
    );
    await step("routing", data.routing, (row) => {
      const stationId = stationMap.get(row.stationId);
      if (!stationId) return Promise.reject(new Error(t("tpl.stationNotCopied")));
      return services.organisation.addStationRoutingRule(created.id, {
        stationId,
        categoryId: row.categoryId ?? undefined,
        menuItemId: row.menuItemId ?? undefined,
        modifierId: row.modifierId ?? undefined,
        priority: row.priority,
      });
    });
    await step("settings", data.settings, (row) =>
      services.settings.set({
        key: row.key,
        level: "branch",
        targetId: created.id,
        value: row.value,
        locked: row.locked,
        effectiveFrom: row.effectiveFrom ? todayIso() : null,
        note: t("tpl.settingNote").replace("{branch}", tx(source.name)),
        createdBy: session?.user.email ?? null,
        context: {
          countryCode: created.countryCode,
          tenantId: scope.tenantId,
          brandId: created.brandId,
          branchId: created.id,
          terminalId: null,
        },
      }),
    );

    setRunning(false);
    onCreated(created);
  }

  const finished = results !== null && !running;

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t("tpl.title")}
      subtitle={t("tpl.subtitle")}
      footer={
        <div className="flex justify-end gap-2">
          {finished ? (
            <>
              {/* Nothing exists yet when the branch itself failed — let them fix the form. */}
              {results[0]?.status === "failed" ? (
                <Button variant="ghost" onClick={() => setResults(null)}>
                  {t("common.back")}
                </Button>
              ) : null}
              <Button variant="primary" onClick={close}>
                {t("common.close")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={running}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                icon={<Copy size={14} />}
                onClick={run}
                loading={running}
                disabled={!source || !preview.data || running}
              >
                {t("tpl.create")}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {results ? (
          <ResultList results={results} running={running} />
        ) : (
          <>
            <Field label={t("tpl.source")} required>
              <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                <option value="">{t("tpl.chooseSource")}</option>
                {branches.map((row) => (
                  <option key={row.id} value={row.id}>
                    {tx(row.name)} · {row.code}
                  </option>
                ))}
              </Select>
            </Field>

            <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={120} />
            <Field label={t("common.code")} required>
              <Input dir="ltr" value={code} maxLength={12} onChange={(event) => setCode(event.target.value)} className="font-mono" />
            </Field>

            {source ? (
              <Callout tone="muted">
                {t("tpl.inherits")
                  .replace("{country}", source.countryCode)
                  .replace("{currency}", source.currency)
                  .replace("{timezone}", source.timezone)}
              </Callout>
            ) : null}

            {sourceId ? (
              <AsyncPanel state={preview}>
                {() => (
                  <section className="space-y-2">
                    <h3 className="text-fg text-sm font-semibold">{t("tpl.copyWhat")}</h3>
                    {PARTS.map((part) => (
                      <Toggle
                        key={part}
                        checked={parts.has(part)}
                        disabled={(counts?.[part] ?? 0) === 0 || (part === "routing" && !parts.has("stations"))}
                        onChange={(on) => toggle(part, on)}
                        label={`${t(`tpl.part.${part}` as ConsoleKey)} (${counts?.[part] ?? 0})`}
                        hint={t(`tpl.partHint.${part}` as ConsoleKey)}
                      />
                    ))}
                  </section>
                )}
              </AsyncPanel>
            ) : null}

            <Callout tone="muted">{t("tpl.notCopied")}</Callout>
            {error ? <Callout tone="bad">{error}</Callout> : null}
          </>
        )}
      </div>
    </Drawer>
  );
}

function ResultList({ results, running }: { results: StepResult[]; running: boolean }) {
  const { t } = useI18n();
  const failed = results.some((row) => row.status === "failed");
  return (
    <div className="space-y-3">
      <ul className="border-line divide-line divide-y rounded-lg border">
        {results.map((row) => (
          <li key={row.key} className="flex items-start gap-2 px-3 py-2 text-sm">
            <span className={cx("mt-0.5", row.status === "done" ? "text-good" : row.status === "failed" ? "text-bad" : "text-fg-subtle")}>
              {row.status === "done" ? <Check size={14} /> : row.status === "failed" ? <X size={14} /> : <CircleSlash size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-fg">{t(row.key === "branch" ? "tpl.step.branch" : (`tpl.part.${row.key}` as ConsoleKey))}</span>
              {row.detail ? <span className="text-bad block text-xs">{row.detail}</span> : null}
            </span>
            <Badge tone={row.status === "done" ? "good" : row.status === "failed" ? "bad" : "muted"}>
              {row.status === "skipped" ? t("tpl.skipped") : String(row.count)}
            </Badge>
          </li>
        ))}
      </ul>
      {running ? <p className="text-fg-muted text-xs">{t("tpl.running")}</p> : null}
      {!running && failed ? <Callout tone="warn">{t("tpl.partial")}</Callout> : null}
      {!running && !failed ? <Callout tone="good">{t("tpl.allDone")}</Callout> : null}
    </div>
  );
}
