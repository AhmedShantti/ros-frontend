"use client";

/**
 * The configuration cascade, on screen — SRS §6.4.
 *
 * Three views over one resolver (`lib/console/settings.ts`):
 *
 *   - **Configurator** — pick a level and what it applies to, see every
 *     setting's effective value there and where it comes from, change it,
 *     lock it, hand it back. A setting locked higher up shows the lock and
 *     names the level that holds it (FR-PLT-026).
 *   - **Inspector** — one setting, one place: what each level says, which one
 *     wins, and which were ignored because of a lock (FR-PLT-027). Plus the
 *     same setting across every branch, which is the "why is it different at
 *     Maadi?" question answered in one table.
 *   - **Financial versions** — the effective-dated history of the settings
 *     that change what a receipt means (FR-PLT-028), and the value that was
 *     in force on any past date.
 */

import { useMemo, useState } from "react";
import { History, Lock, RotateCcw, Search as SearchIcon, SlidersHorizontal } from "lucide-react";

import type { Branch, Brand, CountryPack, Currency, Id, Terminal, Tenant } from "@/lib/console/types";
import {
  LEVEL_LABEL,
  SETTING_BY_KEY,
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SETTING_LEVELS,
  WRITABLE_LEVELS,
  contextFor,
  describeValue,
  levelApplies,
  levelIndex,
  resolveSetting,
  todayIso,
  type ResolvedSetting,
  type SettingContext,
  type SettingDefinition,
  type SettingLevel,
  type SettingOverride,
  type SettingValue,
} from "@/lib/console/settings";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { useConfirm } from "@/components/console/confirm";
import { MoneyInput, OriginBadge, PercentInput, SearchSelect } from "@/components/console/fields";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  SpecTag,
  Textarea,
  Toggle,
  cx,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Shared context — everything the three views need to name things
// ---------------------------------------------------------------------------

export interface SettingsWorld {
  tenant: Tenant;
  brands: Brand[];
  branches: Branch[];
  terminals: Terminal[];
  packs: CountryPack[];
  overrides: SettingOverride[];
  reload: () => void;
}

type WritableLevel = SettingOverride["level"];

function useNames(world: SettingsWorld) {
  const { tx } = useI18n();
  return useMemo(() => {
    const brands = new Map(world.brands.map((row) => [row.id, tx(row.name)]));
    const branches = new Map(world.branches.map((row) => [row.id, tx(row.name)]));
    const terminals = new Map(world.terminals.map((row) => [row.id, row.name || row.code]));
    return (level: SettingLevel, id: Id | null): string => {
      if (!id) return "—";
      switch (level) {
        case "tenant":
          return tx(world.tenant.name);
        case "brand":
          return brands.get(id) ?? id;
        case "branch":
          return branches.get(id) ?? id;
        case "terminal":
          return terminals.get(id) ?? id;
        case "country":
          return id;
        default:
          return "—";
      }
    };
  }, [world, tx]);
}

function currencyFor(world: SettingsWorld, branchId: Id | null): Currency {
  const branch = branchId ? world.branches.find((row) => row.id === branchId) : null;
  return branch?.currency ?? world.tenant.baseCurrency;
}

function contextOf(
  world: SettingsWorld,
  target: { brandId: Id | null; branchId: Id | null; terminalId: Id | null },
): SettingContext {
  const branch = target.branchId ? world.branches.find((row) => row.id === target.branchId) : null;
  return {
    countryCode: branch?.countryCode ?? world.tenant.countryCode,
    tenantId: world.tenant.id,
    brandId: target.brandId ?? branch?.brandId ?? null,
    branchId: target.branchId,
    terminalId: target.terminalId,
  };
}

function useDescribe(currency: Currency) {
  const { locale, fmt } = useI18n();
  return (definition: SettingDefinition, value: SettingValue | undefined | null) =>
    describeValue(definition, value ?? undefined, locale, (minor) =>
      formatMoney({ amount: minor, currency }, fmt),
    );
}

/** Which permission a write at this level needs. Presentation only (FR-SEC-045). */
function useCanWrite() {
  const { can } = useSession();
  return (level: SettingLevel) =>
    level === "tenant" || level === "brand"
      ? can("settings.tenant.manage")
      : can("settings.branch.manage") || can("settings.tenant.manage");
}

// ---------------------------------------------------------------------------
// One value control per kind
// ---------------------------------------------------------------------------

export function SettingInput({
  definition,
  value,
  onChange,
  currency,
  disabled,
}: {
  definition: SettingDefinition;
  value: SettingValue;
  onChange: (next: SettingValue) => void;
  currency: Currency;
  disabled?: boolean;
}) {
  const { tx } = useI18n();

  switch (definition.kind) {
    case "boolean":
      return (
        <Toggle
          checked={Boolean(value)}
          onChange={onChange}
          label={tx(definition.label)}
          disabled={disabled}
        />
      );
    case "enum":
      return (
        <Select
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={tx(definition.label)}
        >
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {tx(option.label)}
            </option>
          ))}
        </Select>
      );
    case "percent":
      return (
        <PercentInput
          value={String(value)}
          max={definition.max ?? 100}
          disabled={disabled}
          onChange={(next) => onChange(next === "" ? 0 : Number(next))}
          aria-label={tx(definition.label)}
        />
      );
    case "money":
      return (
        <MoneyInput
          value={typeof value === "number" ? value : Number(value)}
          currency={currency}
          disabled={disabled}
          onChange={(minor) => onChange(minor ?? 0)}
          aria-label={tx(definition.label)}
        />
      );
    default:
      return (
        <Input
          inputMode="numeric"
          dir="ltr"
          disabled={disabled}
          value={String(value)}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            onChange(digits === "" ? 0 : Number(digits));
          }}
          aria-label={tx(definition.label)}
          className="font-mono tabular-nums"
        />
      );
  }
}

function outOfRange(definition: SettingDefinition, value: SettingValue): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return true;
  if (definition.min !== undefined && value < definition.min) return true;
  if (definition.max !== undefined && value > definition.max) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

export function SettingEditDialog({
  open,
  onClose,
  onSaved,
  definition,
  level,
  targetId,
  targetName,
  context,
  resolved,
  world,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  definition: SettingDefinition;
  level: WritableLevel;
  targetId: Id;
  targetName: string;
  context: SettingContext;
  resolved: ResolvedSetting;
  world: SettingsWorld;
  currency: Currency;
}) {
  const { t, tx } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const own = resolved.chain.find((entry) => entry.level === level);

  const [value, setValue] = useState<SettingValue>(own?.value ?? resolved.value);
  const [locked, setLocked] = useState(own?.locked ?? false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [handBack, setHandBack] = useState(false);
  const [note, setNote] = useState("");

  const invalid = !handBack && outOfRange(definition, value);
  const pastDate = definition.financial && effectiveFrom < todayIso();
  const noteMissing = definition.financial && note.trim().length === 0;

  async function submit() {
    await action.run(
      () =>
        services.settings.set({
          key: definition.key,
          level,
          targetId,
          value: handBack ? null : value,
          locked,
          effectiveFrom: definition.financial ? effectiveFrom : null,
          note,
          createdBy: session?.user.email ?? null,
          context,
          packs: world.packs,
        }),
      {
        onSuccess: () => {
          world.reload();
          onSaved(t("cfg.saved"));
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx(definition.label)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={invalid || pastDate || noteMissing}
            onClick={submit}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-fg-muted flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="accent">{tx(LEVEL_LABEL[level])}</Badge>
          <span>{targetName}</span>
          <SpecTag id={definition.spec} />
          {definition.financial ? <Badge tone="warn">{t("cfg.versioned")}</Badge> : null}
        </div>

        <p className="text-fg-muted text-xs leading-relaxed">{tx(definition.hint)}</p>

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {handBack ? (
          <Callout tone="muted">{t("cfg.handBackNote")}</Callout>
        ) : definition.kind === "boolean" ? (
          <SettingInput definition={definition} value={value} onChange={setValue} currency={currency} />
        ) : (
          <Field
            label={t("cfg.valueHere")}
            error={invalid ? t("cfg.outOfRange") : null}
            hint={
              definition.min !== undefined || definition.max !== undefined
                ? t("cfg.range")
                    .replace("{min}", String(definition.min ?? "—"))
                    .replace("{max}", String(definition.max ?? "—"))
                : undefined
            }
          >
            <SettingInput definition={definition} value={value} onChange={setValue} currency={currency} />
          </Field>
        )}

        {!handBack ? (
          <Toggle
            checked={locked}
            onChange={setLocked}
            label={t("cfg.lock")}
            hint={t("cfg.lockHint")}
            disabled={level === "terminal"}
          />
        ) : null}

        {definition.financial ? (
          <>
            <Field
              label={t("cfg.effectiveFrom")}
              hint={t("cfg.effectiveHint")}
              error={pastDate ? t("cfg.pastDate") : null}
              required
            >
              <Input
                type="date"
                dir="ltr"
                min={todayIso()}
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </Field>
            {own?.override ? (
              <Toggle checked={handBack} onChange={setHandBack} label={t("cfg.handBack")} />
            ) : null}
          </>
        ) : null}

        <Field
          label={t("cfg.note")}
          required={definition.financial}
          hint={definition.financial ? t("cfg.noteFinancial") : undefined}
        >
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Configurator
// ---------------------------------------------------------------------------

export function SettingsConfigurator({
  world,
  notify,
}: {
  world: SettingsWorld;
  notify: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const clearAction = useAction(notify);
  const nameOf = useNames(world);

  const [level, setLevel] = useState<WritableLevel>("tenant");
  const [brandId, setBrandId] = useState<Id | null>(world.brands[0]?.id ?? null);
  const [branchId, setBranchId] = useState<Id | null>(world.branches[0]?.id ?? null);
  const [terminalId, setTerminalId] = useState<Id | null>(null);
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const branchTerminals = world.terminals.filter((row) => row.branchId === branchId);
  const effectiveTerminal =
    terminalId && branchTerminals.some((row) => row.id === terminalId)
      ? terminalId
      : (branchTerminals[0]?.id ?? null);

  const targetId: Id | null =
    level === "tenant"
      ? world.tenant.id
      : level === "brand"
        ? brandId
        : level === "branch"
          ? branchId
          : effectiveTerminal;

  const context = contextFor(
    level,
    contextOf(world, {
      brandId: level === "brand" ? brandId : null,
      branchId,
      terminalId: effectiveTerminal,
    }),
  );
  const currency = currencyFor(world, level === "branch" || level === "terminal" ? branchId : null);
  const describe = useDescribe(currency);
  const writable = canWrite(level);

  const needle = term.trim().toLowerCase();
  const rows = SETTING_DEFINITIONS.filter(
    (definition) =>
      !needle ||
      definition.label.en.toLowerCase().includes(needle) ||
      definition.label.ar.includes(term.trim()) ||
      definition.key.toLowerCase().includes(needle),
  ).map((definition) => resolveSetting(definition, world.overrides, context, { packs: world.packs }));

  const setHere = rows.filter((row) =>
    row.chain.some((entry) => entry.level === level && entry.override && entry.value !== undefined),
  ).length;

  const editingResolved = editing ? rows.find((row) => row.definition.key === editing) : null;

  async function reset(resolved: ResolvedSetting) {
    if (!targetId) return;
    const ok = await confirm({
      title: t("cfg.resetTitle").replace("{name}", tx(resolved.definition.label)),
      body: resolved.definition.financial ? t("cfg.resetFinancialBody") : t("cfg.resetBody"),
      confirmLabel: t("cfg.reset"),
      tone: "warn",
    });
    if (!ok) return;
    await clearAction.run(() => services.settings.clear(resolved.definition.key, level, targetId), {
      onSuccess: () => world.reload(),
      success: t("cfg.cleared"),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("cfg.level")}>
            <SegmentedControl
              value={level}
              onChange={(next) => setLevel(next as WritableLevel)}
              options={WRITABLE_LEVELS.map((row) => ({ value: row, label: tx(LEVEL_LABEL[row]) }))}
            />
          </Field>

          {level === "brand" ? (
            <div className="min-w-48">
              <Field label={t("cfg.target")}>
                <Select value={brandId ?? ""} onChange={(event) => setBrandId(event.target.value || null)}>
                  {world.brands.map((row) => (
                    <option key={row.id} value={row.id}>
                      {tx(row.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}

          {level === "branch" || level === "terminal" ? (
            <div className="min-w-48">
              <Field label={t("common.branch")}>
                <Select value={branchId ?? ""} onChange={(event) => setBranchId(event.target.value || null)}>
                  {world.branches.map((row) => (
                    <option key={row.id} value={row.id}>
                      {tx(row.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}

          {level === "terminal" ? (
            <div className="min-w-48">
              <Field label={t("cfg.terminal")}>
                {branchTerminals.length > 0 ? (
                  <Select
                    value={effectiveTerminal ?? ""}
                    onChange={(event) => setTerminalId(event.target.value || null)}
                  >
                    {branchTerminals.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name || row.code}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-fg-subtle py-2 text-xs">{t("cfg.noTerminals")}</p>
                )}
              </Field>
            </div>
          ) : null}

          <div className="relative min-w-52 flex-1">
            <SearchIcon
              size={14}
              aria-hidden
              className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3"
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("cfg.search")}
              aria-label={t("cfg.search")}
              className="ps-9"
            />
          </div>
        </div>

        <div className="text-fg-muted mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span>
            {t("cfg.editingAt")
              .replace("{level}", tx(LEVEL_LABEL[level]))
              .replace("{target}", nameOf(level, targetId))}
          </span>
          <Badge tone={setHere > 0 ? "accent" : "muted"}>
            {t("cfg.setHereCount").replace("{n}", String(setHere))}
          </Badge>
          {!writable ? <Badge tone="warn">{t("cfg.readOnly")}</Badge> : null}
        </div>
      </Card>

      {world.packs.length === 0 ? <Callout tone="muted">{t("cfg.countryUnavailable")}</Callout> : null}
      {!writable ? (
        <Callout tone="warn">
          {level === "tenant" || level === "brand" ? t("cfg.needTenant") : t("cfg.needBranch")}
        </Callout>
      ) : null}
      {clearAction.error ? <Callout tone="bad">{clearAction.error}</Callout> : null}

      {SETTING_GROUPS.map((group) => {
        const members = rows.filter((row) => row.definition.group === group.id);
        if (members.length === 0) return null;
        return (
          <Card key={group.id} padded={false}>
            <div className="px-5 pt-4">
              <CardHeader title={tx(group.label)} />
            </div>
            <ul className="divide-line divide-y">
              {members.map((resolved) => (
                <SettingRow
                  key={resolved.definition.key}
                  resolved={resolved}
                  level={level}
                  writable={writable && Boolean(targetId)}
                  describe={describe}
                  world={world}
                  targetId={targetId}
                  onEdit={() => setEditing(resolved.definition.key)}
                  onReset={() => void reset(resolved)}
                />
              ))}
            </ul>
          </Card>
        );
      })}

      {editingResolved && targetId ? (
        <SettingEditDialog
          open
          onClose={() => setEditing(null)}
          onSaved={notify}
          definition={editingResolved.definition}
          level={level}
          targetId={targetId}
          targetName={nameOf(level, targetId)}
          context={context}
          resolved={editingResolved}
          world={world}
          currency={currency}
        />
      ) : null}
    </div>
  );
}

function SettingRow({
  resolved,
  level,
  writable,
  describe,
  world,
  targetId,
  onEdit,
  onReset,
}: {
  resolved: ResolvedSetting;
  level: WritableLevel;
  writable: boolean;
  describe: (definition: SettingDefinition, value: SettingValue | undefined | null) => string;
  world: SettingsWorld;
  targetId: Id | null;
  onEdit: () => void;
  onReset: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { definition } = resolved;
  const own = resolved.chain.find((entry) => entry.level === level)!;
  const applies = levelApplies(definition, level);
  const lockedAbove =
    resolved.lockedAt !== null && levelIndex(resolved.lockedAt) < levelIndex(level)
      ? resolved.lockedAt
      : null;
  const ownsValue = Boolean(own.override) && own.value !== undefined && !lockedAbove;

  // Financial versions not yet in force at this level — "from 1 Oct: 12%".
  const today = todayIso();
  const scheduled = definition.financial && targetId
    ? world.overrides
        .filter(
          (row) =>
            row.key === definition.key &&
            row.level === level &&
            row.targetId === targetId &&
            (row.effectiveFrom ?? "") > today,
        )
        .sort((a, b) => (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? ""))
    : [];

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-3.5">
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg text-sm font-medium">{tx(definition.label)}</span>
          <SpecTag id={definition.spec} />
          {definition.financial ? <Badge tone="warn">{t("cfg.versioned")}</Badge> : null}
        </div>
        <p className="text-fg-subtle mt-1 max-w-2xl text-xs leading-relaxed">{tx(definition.hint)}</p>
        {scheduled.map((row) => (
          <p key={row.id} className="text-accent mt-1 text-xs">
            {t("cfg.scheduledFrom")
              .replace("{date}", formatDate(row.effectiveFrom, fmt))
              .replace(
                "{value}",
                row.value === null ? t("cfg.inherits") : describe(definition, row.value),
              )}
          </p>
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-fg font-mono text-sm tabular-nums">{describe(definition, resolved.value)}</span>
        {!applies ? (
          <Badge tone="muted">
            {t("cfg.notApplicable").replace("{level}", tx(LEVEL_LABEL[definition.lowestLevel]))}
          </Badge>
        ) : lockedAbove ? (
          <OriginBadge origin="locked" source={tx(LEVEL_LABEL[lockedAbove])} />
        ) : ownsValue ? (
          <span className="flex items-center gap-1.5">
            {own.locked ? (
              <Badge tone="warn">
                <Lock size={10} aria-hidden /> {t("cfg.lockedHere")}
              </Badge>
            ) : null}
            <OriginBadge origin="own" />
          </span>
        ) : (
          <OriginBadge origin="inherited" source={tx(LEVEL_LABEL[resolved.suppliedBy])} />
        )}

        {applies && !lockedAbove && writable ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={12} />} onClick={onEdit}>
              {ownsValue ? t("cfg.change") : t("cfg.override")}
            </Button>
            {own.override ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={onReset}>
                {t("cfg.reset")}
              </Button>
            ) : null}
          </div>
        ) : lockedAbove ? (
          <p className="text-fg-subtle max-w-56 text-end text-[0.68rem] leading-snug">
            {t("cfg.lockedAbove").replace("{level}", tx(LEVEL_LABEL[lockedAbove]))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inspector — FR-PLT-027
// ---------------------------------------------------------------------------

export function SettingsInspector({ world }: { world: SettingsWorld }) {
  const { t, tx } = useI18n();
  const nameOf = useNames(world);

  const [key, setKey] = useState<string>(SETTING_DEFINITIONS[0]!.key);
  const [branchId, setBranchId] = useState<Id | null>(world.branches[0]?.id ?? null);
  const [terminalId, setTerminalId] = useState<Id | null>(null);
  const [asAt, setAsAt] = useState(todayIso());

  const definition = SETTING_BY_KEY.get(key)!;
  const currency = currencyFor(world, branchId);
  const describe = useDescribe(currency);

  const branchTerminals = world.terminals.filter((row) => row.branchId === branchId);
  const context = contextOf(world, {
    brandId: null,
    branchId,
    terminalId: terminalId && branchTerminals.some((row) => row.id === terminalId) ? terminalId : null,
  });
  const resolved = resolveSetting(definition, world.overrides, context, { packs: world.packs, asAt });

  const tenantValue = resolveSetting(
    definition,
    world.overrides,
    contextFor("tenant", context),
    { packs: world.packs, asAt },
  ).value;

  const acrossBranches = world.branches.map((branch) => ({
    branch,
    resolved: resolveSetting(
      definition,
      world.overrides,
      contextOf(world, { brandId: null, branchId: branch.id, terminalId: null }),
      { packs: world.packs, asAt },
    ),
  }));

  const chainColumns: Column<(typeof resolved.chain)[number]>[] = [
    {
      key: "level",
      header: t("cfg.level"),
      render: (entry) => (
        <span className={cx("text-sm", entry.supplies ? "text-fg font-semibold" : "text-fg-muted")}>
          {tx(LEVEL_LABEL[entry.level])}
        </span>
      ),
    },
    {
      key: "target",
      header: t("cfg.target"),
      render: (entry) =>
        entry.level === "platform" ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          nameOf(entry.level, entry.targetId)
        ),
    },
    {
      key: "value",
      header: t("cfg.valueAtLevel"),
      render: (entry) => (
        <span className={cx("font-mono tabular-nums", entry.blockedBy && "line-through opacity-60")}>
          {describe(definition, entry.value)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (entry) =>
        entry.notApplicable ? (
          <Badge tone="muted">
            {t("cfg.notApplicable").replace("{level}", tx(LEVEL_LABEL[definition.lowestLevel]))}
          </Badge>
        ) : entry.supplies ? (
          <Badge tone="good" dot>
            {entry.locked ? t("cfg.suppliesLocked") : t("cfg.supplies")}
          </Badge>
        ) : entry.blockedBy ? (
          <Badge tone="warn">
            {t("cfg.blockedBy").replace("{level}", tx(LEVEL_LABEL[entry.blockedBy]))}
          </Badge>
        ) : entry.value === undefined ? (
          <span className="text-fg-subtle text-xs">{t("cfg.notSet")}</span>
        ) : (
          <span className="text-fg-subtle text-xs">{t("cfg.overriddenBelow")}</span>
        ),
    },
  ];

  const branchColumns: Column<(typeof acrossBranches)[number]>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => tx(row.branch.name) },
    {
      key: "value",
      header: t("cfg.effective"),
      render: (row) => (
        <span className="font-mono tabular-nums">
          {describe(definition, row.resolved.value)}
          {row.resolved.value !== tenantValue ? (
            <Badge tone="accent" className="ms-2">
              {t("cfg.differs")}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "source",
      header: t("cfg.suppliedBy"),
      render: (row) => tx(LEVEL_LABEL[row.resolved.suppliedBy]),
    },
    {
      key: "lock",
      header: t("cfg.lockedAtCol"),
      render: (row) =>
        row.resolved.lockedAt ? (
          <Badge tone="warn">
            <Lock size={10} aria-hidden /> {tx(LEVEL_LABEL[row.resolved.lockedAt])}
          </Badge>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("cfg.inspectorTitle")} hint={t("cfg.inspectorHint")} spec="FR-PLT-027" />
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Field label={t("cfg.setting")}>
              <SearchSelect
                value={key}
                onChange={(next) => next && setKey(next)}
                options={SETTING_DEFINITIONS.map((row) => ({
                  value: row.key,
                  label: tx(row.label),
                  hint: `${tx(SETTING_GROUPS.find((group) => group.id === row.group)!.label)} · ${row.key}`,
                }))}
                aria-label={t("cfg.setting")}
              />
            </Field>
          </div>
          <Field label={t("common.branch")}>
            <Select value={branchId ?? ""} onChange={(event) => setBranchId(event.target.value || null)}>
              {world.branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cfg.terminal")}>
            <Select value={terminalId ?? ""} onChange={(event) => setTerminalId(event.target.value || null)}>
              <option value="">{t("cfg.anyTerminal")}</option>
              {branchTerminals.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name || row.code}
                </option>
              ))}
            </Select>
          </Field>
          {definition.financial ? (
            <Field label={t("cfg.asAt")} hint={t("cfg.asAtHint")}>
              <Input type="date" dir="ltr" value={asAt} onChange={(event) => setAsAt(event.target.value || todayIso())} />
            </Field>
          ) : null}
        </div>
      </Card>

      <Callout tone="accent" title={t("cfg.answer")}>
        {t("cfg.answerBody")
          .replace("{value}", describe(definition, resolved.value))
          .replace("{level}", tx(LEVEL_LABEL[resolved.suppliedBy]))
          .replace(
            "{target}",
            resolved.suppliedBy === "platform"
              ? "—"
              : nameOf(resolved.suppliedBy, resolved.chain.find((entry) => entry.supplies)?.targetId ?? null),
          )}
        {resolved.lockedAt ? ` ${t("cfg.answerLocked").replace("{level}", tx(LEVEL_LABEL[resolved.lockedAt]))}` : ""}
      </Callout>

      <DataTable
        columns={chainColumns}
        rows={resolved.chain}
        rowKey={(entry) => entry.level}
        caption={t("cfg.inspectorTitle")}
        dense
      />

      <Card padded={false}>
        <div className="px-5 pt-4">
          <CardHeader title={t("cfg.acrossBranches")} hint={t("cfg.acrossBranchesHint")} />
        </div>
        <DataTable
          columns={branchColumns}
          rows={acrossBranches}
          rowKey={(row) => row.branch.id}
          caption={t("cfg.acrossBranches")}
          emptyTitle={t("cfg.noBranches")}
          dense
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial versions — FR-PLT-028
// ---------------------------------------------------------------------------

const FINANCIAL = SETTING_DEFINITIONS.filter((row) => row.financial);

type VersionState = "in_force" | "scheduled" | "superseded" | "inherits";

export function FinancialHistory({
  world,
  notify,
}: {
  world: SettingsWorld;
  notify: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const nameOf = useNames(world);
  const confirm = useConfirm();
  const canWrite = useCanWrite();
  const withdraw = useAction(notify);

  const [key, setKey] = useState<string>(FINANCIAL[0]!.key);
  const [branchId, setBranchId] = useState<Id | null>(world.branches[0]?.id ?? null);
  const [onDate, setOnDate] = useState(todayIso());

  const definition = SETTING_BY_KEY.get(key)!;
  const currency = currencyFor(world, branchId);
  const describe = useDescribe(currency);
  const today = todayIso();

  const versions = world.overrides
    .filter((row) => row.key === key)
    .sort(
      (a, b) =>
        (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") ||
        b.createdAt.localeCompare(a.createdAt),
    );

  /** The version in force today in each level/target slot. */
  const inForceIds = new Set<string>();
  for (const row of versions) {
    const slot = `${row.level}:${row.targetId}`;
    if ((row.effectiveFrom ?? "") <= today && !inForceIds.has(slot)) {
      inForceIds.add(slot);
      inForceIds.add(row.id);
    }
  }

  const stateOf = (row: SettingOverride): VersionState =>
    (row.effectiveFrom ?? "") > today
      ? "scheduled"
      : inForceIds.has(row.id)
        ? row.value === null
          ? "inherits"
          : "in_force"
        : "superseded";

  const context = contextOf(world, { brandId: null, branchId, terminalId: null });
  const onThatDate = resolveSetting(definition, world.overrides, context, {
    packs: world.packs,
    asAt: onDate,
  });
  const todayValue = resolveSetting(definition, world.overrides, context, { packs: world.packs });

  async function withdrawVersion(row: SettingOverride) {
    const ok = await confirm({
      title: t("cfg.withdrawTitle"),
      body: t("cfg.withdrawBody").replace("{date}", formatDate(row.effectiveFrom, fmt)),
      confirmLabel: t("cfg.withdraw"),
      tone: "danger",
    });
    if (!ok) return;
    await withdraw.run(() => services.settings.clear(row.key, row.level, row.targetId), {
      onSuccess: () => world.reload(),
      success: t("cfg.withdrawn"),
    });
  }

  const STATE_TONE: Record<VersionState, "good" | "accent" | "muted" | "neutral"> = {
    in_force: "good",
    scheduled: "accent",
    superseded: "muted",
    inherits: "neutral",
  };

  const columns: Column<SettingOverride>[] = [
    {
      key: "effectiveFrom",
      header: t("cfg.effectiveFrom"),
      render: (row) => <span className="font-mono text-xs tabular-nums">{formatDate(row.effectiveFrom, fmt)}</span>,
    },
    {
      key: "where",
      header: t("cfg.target"),
      render: (row) => (
        <span>
          <Badge tone="neutral">{tx(LEVEL_LABEL[row.level])}</Badge>{" "}
          <span className="text-fg-muted text-xs">{nameOf(row.level, row.targetId)}</span>
        </span>
      ),
    },
    {
      key: "value",
      header: t("cfg.valueAtLevel"),
      render: (row) =>
        row.value === null ? (
          <span className="text-fg-subtle italic">{t("cfg.inherits")}</span>
        ) : (
          <span className="font-mono tabular-nums">
            {describe(definition, row.value)}
            {row.locked ? <Lock size={11} className="text-warn ms-1.5 inline" aria-label={t("cfg.lockedHere")} /> : null}
          </span>
        ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (row) => <Badge tone={STATE_TONE[stateOf(row)]}>{t(`cfg.state.${stateOf(row)}` as ConsoleKey)}</Badge>,
    },
    {
      key: "note",
      header: t("cfg.note"),
      secondary: true,
      render: (row) => (
        <span className="text-fg-muted text-xs">
          {row.note ?? "—"}
          <span className="text-fg-subtle block">
            {row.createdBy ?? ""} · {formatDateTime(row.createdAt, fmt)}
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) =>
        stateOf(row) === "scheduled" && canWrite(row.level) ? (
          <Button size="sm" variant="ghost" onClick={() => void withdrawVersion(row)}>
            {t("cfg.withdraw")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("cfg.historyTitle")} hint={t("cfg.historyHint")} spec="FR-PLT-028" />
        <SegmentedControl
          value={key}
          onChange={setKey}
          options={FINANCIAL.map((row) => ({ value: row.key, label: tx(row.label) }))}
          label={t("cfg.setting")}
        />
      </Card>

      {withdraw.error ? <Callout tone="bad">{withdraw.error}</Callout> : null}

      <DataTable
        columns={columns}
        rows={versions}
        rowKey={(row) => row.id}
        caption={t("cfg.historyTitle")}
        emptyTitle={t("cfg.noHistory")}
        emptyBody={t("cfg.noHistoryBody")}
        dense
      />

      <Card>
        <CardHeader title={t("cfg.valueOn")} hint={t("cfg.valueOnHint")} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("common.branch")}>
            <Select value={branchId ?? ""} onChange={(event) => setBranchId(event.target.value || null)}>
              {world.branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cfg.onDate")}>
            <Input type="date" dir="ltr" value={onDate} onChange={(event) => setOnDate(event.target.value || todayIso())} />
          </Field>
          <div className="border-line bg-sunken/50 rounded-lg border p-3">
            <p className="text-fg-subtle text-[0.68rem] tracking-wide uppercase">{t("cfg.inForceThen")}</p>
            <p className="text-fg mt-1 font-mono text-lg tabular-nums">{describe(definition, onThatDate.value)}</p>
            <p className="text-fg-muted text-xs">
              {tx(LEVEL_LABEL[onThatDate.suppliedBy])}
              {onThatDate.value !== todayValue.value ? (
                <span className="text-warn ms-1.5">
                  · {t("cfg.differsFromToday").replace("{value}", describe(definition, todayValue.value))}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <p className="text-fg-subtle mt-3 flex items-start gap-1.5 text-xs leading-relaxed">
          <History size={12} className="mt-0.5 shrink-0" aria-hidden />
          {t("cfg.historicalNote")}
        </p>
      </Card>
    </div>
  );
}

/** All six levels in order — for a legend on the page. */
export function CascadeLegend() {
  const { tx } = useI18n();
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {SETTING_LEVELS.map((level, index) => (
        <li key={level} className="flex items-center gap-1.5">
          {index > 0 ? <span className="text-fg-subtle" aria-hidden>→</span> : null}
          <Badge tone={WRITABLE_LEVELS.includes(level) ? "accent" : "muted"}>{tx(LEVEL_LABEL[level])}</Badge>
        </li>
      ))}
    </ol>
  );
}
