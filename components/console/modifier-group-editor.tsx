"use client";

/**
 * Modifier group editing — FR-MNU-010 … FR-MNU-013, FR-POS-023.
 *
 *   - `GroupRulesDrawer` — min/max, required, repeat, free quantity, with
 *     the combinations nobody could ever satisfy refused before save.
 *   - `NestingPicker` — "this modifier opens that group", two levels deep at
 *     most (FR-POS-023), with cycles refused.
 *   - `GroupSimulator` — the group as the till will run it: tap to choose,
 *     nested prompts open, the free allowance is applied in order, and it
 *     says whether the line could be added yet.
 *   - `LinkGroupWithOverrides` — attach a group to one item with that
 *     item's own prices and defaults (FR-MNU-010).
 */

import { useMemo, useState } from "react";
import { CornerDownRight, Minus, Plus, RotateCcw } from "lucide-react";

import type { Id, Localised, Modifier, ModifierGroup } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatMoney } from "@/lib/console/format";
import {
  MAX_NESTING,
  canNest,
  evaluateSelection,
  groupProblems,
  type RuleProblem,
} from "@/lib/console/modifier-rules";
import type { ConsoleKey } from "@/locales";
import { LocalisedField, MoneyInput } from "@/components/console/fields";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Card, CardHeader, Drawer, Field, Input, Select, Toggle, cx } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function digits(value: string): number {
  const cleaned = value.replace(/[^\d]/g, "");
  return cleaned === "" ? 0 : Number(cleaned);
}

export function GroupRulesDrawer({
  group,
  onClose,
  onSaved,
}: {
  group: ModifierGroup;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState<Localised>(group.name);
  const [min, setMin] = useState(String(group.minSelections));
  const [max, setMax] = useState(String(group.maxSelections));
  const [required, setRequired] = useState(group.required);
  const [allowRepeat, setAllowRepeat] = useState(group.allowRepeat);
  const [freeOn, setFreeOn] = useState(group.freeQuantityThreshold !== null);
  const [free, setFree] = useState(String(group.freeQuantityThreshold ?? 1));

  const rules = {
    minSelections: digits(min),
    maxSelections: digits(max),
    required,
    allowRepeat,
    freeQuantityThreshold: freeOn ? digits(free) : null,
  };
  const problems = groupProblems(rules, group.modifiers.length);
  const noName = !name.en.trim() && !name.ar.trim();

  async function save() {
    await action.run(() => services.catalogue.modifierGroups.update(group.id, { name, ...rules }), {
      onSuccess: () => onSaved(t("mge.saved")),
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("mge.rulesTitle")}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0 || noName} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={80} />
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("mge.min")} hint={t("mge.minHint")}>
            <Input dir="ltr" inputMode="numeric" value={min} onChange={(event) => setMin(event.target.value)} className="font-mono" />
          </Field>
          <Field label={t("mge.max")} hint={t("mge.maxHint")}>
            <Input dir="ltr" inputMode="numeric" value={max} onChange={(event) => setMax(event.target.value)} className="font-mono" />
          </Field>
        </div>
        <Toggle checked={required} onChange={setRequired} label={t("menu.required")} hint={t("mge.requiredHint")} />
        <Toggle checked={allowRepeat} onChange={setAllowRepeat} label={t("menu.allowRepeat")} hint={t("mge.repeatHint")} />
        <Toggle checked={freeOn} onChange={setFreeOn} label={t("menu.freeThreshold")} hint={t("mge.freeHint")} />
        {freeOn ? (
          <Field label={t("mge.freeCount")}>
            <Input dir="ltr" inputMode="numeric" value={free} onChange={(event) => setFree(event.target.value)} className="w-24 font-mono" />
          </Field>
        ) : null}

        {problems.length > 0 ? (
          <Callout tone="warn" title={t("mge.cannotSatisfy")}>
            <ul className="list-disc space-y-0.5 ps-4">
              {problems.map((problem: RuleProblem) => (
                <li key={problem}>{t(`mge.problem.${problem}` as ConsoleKey)}</li>
              ))}
            </ul>
          </Callout>
        ) : (
          <Callout tone="muted">
            {t("mge.summary")
              .replace("{min}", String(rules.minSelections))
              .replace("{max}", String(rules.maxSelections))}
            {rules.freeQuantityThreshold ? ` ${t("mge.summaryFree").replace("{n}", String(rules.freeQuantityThreshold))}` : ""}
          </Callout>
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Nesting — FR-POS-023
// ---------------------------------------------------------------------------

export function NestingPicker({
  parent,
  modifier,
  groups,
  nesting,
  onChanged,
}: {
  parent: ModifierGroup;
  modifier: Modifier;
  groups: ModifierGroup[];
  nesting: Map<Id, Id>;
  onChanged: (message: string) => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const current = nesting.get(modifier.id) ?? "";
  const byId = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function choose(childId: string) {
    setRefusal(null);
    if (childId) {
      const verdict = canNest(parent.id, modifier.id, childId, byId, nesting);
      if (verdict !== "ok") {
        setRefusal(t(`mge.nest.${verdict}` as ConsoleKey).replace("{n}", String(MAX_NESTING)));
        return;
      }
    }
    await action.run(() => services.modifierNesting.set(modifier.id, childId || null), {
      onSuccess: () => onChanged(childId ? t("mge.nested") : t("mge.unnested")),
    });
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <CornerDownRight size={12} className="text-fg-subtle" aria-hidden />
      <span className="text-fg-subtle text-xs">{t("mge.opens")}</span>
      <div className="min-w-44">
        <Select value={current} onChange={(event) => void choose(event.target.value)} className="py-1 text-xs">
          <option value="">{t("mge.opensNothing")}</option>
          {groups
            .filter((group) => group.id !== parent.id)
            .map((group) => (
              <option key={group.id} value={group.id}>
                {tx(group.name)}
              </option>
            ))}
        </Select>
      </div>
      {refusal ? <span className="text-bad text-xs">{refusal}</span> : null}
      {action.error ? <span className="text-bad text-xs">{action.error}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

interface Pick {
  modifierId: Id;
  groupId: Id;
}

export function GroupSimulator({
  group,
  groups,
  nesting,
}: {
  group: ModifierGroup;
  groups: ModifierGroup[];
  nesting: Map<Id, Id>;
}) {
  const { t, fmt } = useI18n();
  const [picks, setPicks] = useState<Pick[]>([]);
  const byId = useMemo(() => new Map(groups.map((row) => [row.id, row])), [groups]);

  // The groups on screen: the top one, then any child opened by a pick, to
  // the depth cap. A child appears once per picked parent modifier.
  const chain: { group: ModifierGroup; depth: number; via: Modifier | null }[] = [{ group, depth: 0, via: null }];
  for (let i = 0; i < chain.length && chain.length < 12; i += 1) {
    const entry = chain[i]!;
    if (entry.depth >= MAX_NESTING) continue;
    for (const modifier of entry.group.modifiers) {
      const childId = nesting.get(modifier.id);
      const child = childId ? byId.get(childId) : undefined;
      if (child && picks.some((pick) => pick.modifierId === modifier.id && pick.groupId === entry.group.id)) {
        chain.push({ group: child, depth: entry.depth + 1, via: modifier });
      }
    }
  }

  const outcomes = chain.map((entry) => {
    const mine = picks.filter((pick) => pick.groupId === entry.group.id);
    return {
      ...entry,
      picks: mine,
      outcome: evaluateSelection(
        entry.group,
        mine.map((pick) => ({ priceMinor: entry.group.modifiers.find((row) => row.id === pick.modifierId)?.priceDelta.amount ?? 0 })),
      ),
    };
  });
  const blocking = outcomes.filter((entry) => entry.group.required && !entry.outcome.satisfied);
  const total = outcomes.reduce((sum, entry) => sum + entry.outcome.charge, 0);
  const currency = group.modifiers[0]?.priceDelta.currency ?? "EGP";

  function tap(owner: ModifierGroup, modifier: Modifier) {
    setPicks((current) => {
      const mine = current.filter((pick) => pick.groupId === owner.id);
      const already = mine.some((pick) => pick.modifierId === modifier.id);
      if (already && !owner.allowRepeat) {
        // Untapping also drops anything the modifier's child group held.
        const child = nesting.get(modifier.id);
        return current.filter(
          (pick) => !(pick.groupId === owner.id && pick.modifierId === modifier.id) && pick.groupId !== child,
        );
      }
      if (mine.length >= owner.maxSelections) return current;
      return [...current, { groupId: owner.id, modifierId: modifier.id }];
    });
  }

  function untapOne(owner: ModifierGroup, modifier: Modifier) {
    setPicks((current) => {
      const index = current.map((pick) => `${pick.groupId}:${pick.modifierId}`).lastIndexOf(`${owner.id}:${modifier.id}`);
      return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
    });
  }

  return (
    <Card>
      <CardHeader
        title={t("mge.simTitle")}
        hint={t("mge.simHint")}
        spec="FR-MNU-011"
        action={
          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setPicks([])}>
            {t("mge.simReset")}
          </Button>
        }
      />
      <div className="space-y-3">
        {outcomes.map((entry) => (
          <SimGroup
            key={`${entry.group.id}-${entry.via?.id ?? "root"}`}
            entry={entry}
            onTap={(modifier) => tap(entry.group, modifier)}
            onUntap={(modifier) => untapOne(entry.group, modifier)}
          />
        ))}
      </div>
      <div className="border-line mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-fg font-mono text-sm tabular-nums">
          {t("mge.simCharge")}: {formatMoney({ amount: total, currency }, fmt)}
        </span>
        {blocking.length > 0 ? (
          <Badge tone="warn">{t("mge.simBlocked").replace("{n}", String(blocking.length))}</Badge>
        ) : (
          <Badge tone="good">{t("mge.simReady")}</Badge>
        )}
      </div>
    </Card>
  );
}

function SimGroup({
  entry,
  onTap,
  onUntap,
}: {
  entry: {
    group: ModifierGroup;
    depth: number;
    via: Modifier | null;
    picks: Pick[];
    outcome: ReturnType<typeof evaluateSelection>;
  };
  onTap: (modifier: Modifier) => void;
  onUntap: (modifier: Modifier) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { group, outcome } = entry;
  return (
    <div className={cx("border-line rounded-lg border p-2.5", entry.depth > 0 && "bg-sunken/40")} style={{ marginInlineStart: entry.depth * 16 }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg text-xs font-semibold">
          {entry.via ? `${tx(entry.via.name)} → ` : ""}
          {tx(group.name)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-fg-muted text-[0.68rem] tabular-nums" dir="ltr">
            {outcome.count} / {group.minSelections}–{group.maxSelections}
          </span>
          {group.required ? (
            <Badge tone={outcome.satisfied ? "good" : "warn"}>{outcome.satisfied ? t("mge.simOk") : t("common.required")}</Badge>
          ) : null}
          {outcome.freeApplied > 0 ? <Badge tone="accent">{t("mge.simFree").replace("{n}", String(outcome.freeApplied))}</Badge> : null}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {group.modifiers.map((modifier) => {
          const times = entry.picks.filter((pick) => pick.modifierId === modifier.id).length;
          const blocked = times === 0 && outcome.atMax;
          return (
            <span key={modifier.id} className="inline-flex items-stretch">
              <button
                type="button"
                disabled={blocked}
                onClick={() => onTap(modifier)}
                className={cx(
                  "min-h-10 rounded-lg border px-2.5 py-1 text-start text-xs transition-colors disabled:opacity-40",
                  times > 0 ? "border-accent bg-accent-soft text-accent font-medium" : "border-line bg-raised text-fg hover:bg-sunken",
                )}
              >
                {tx(modifier.name)}
                {times > 1 ? ` ×${times}` : ""}
                {modifier.priceDelta.amount !== 0 ? (
                  <span className="text-fg-subtle ms-1 font-mono">+{formatMoney(modifier.priceDelta, fmt)}</span>
                ) : null}
              </button>
              {group.allowRepeat && times > 0 ? (
                <button
                  type="button"
                  onClick={() => onUntap(modifier)}
                  aria-label={t("common.remove")}
                  className="border-line text-fg-muted hover:text-fg ms-0.5 rounded-lg border px-1"
                >
                  <Minus size={11} />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-item overrides — FR-MNU-010
// ---------------------------------------------------------------------------

export function LinkGroupWithOverrides({
  itemId,
  onLinked,
}: {
  itemId: Id;
  onLinked: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const groups = useAsync(() => services.catalogue.modifierGroups.list({ limit: 300 }).then((page) => page.rows), []);
  const [groupId, setGroupId] = useState("");
  const [prices, setPrices] = useState<Record<Id, number | null>>({});
  const [defaults, setDefaults] = useState<Id[] | null>(null);

  const group = (groups.data ?? []).find((row) => row.id === groupId) ?? null;
  const effectiveDefaults = defaults ?? group?.modifiers.filter((row) => row.isDefault).map((row) => row.id) ?? [];

  async function link() {
    if (!group) return;
    const priceOverrides = Object.fromEntries(
      Object.entries(prices).filter((entry): entry is [string, number] => entry[1] !== null),
    );
    const groupDefaults = group.modifiers.filter((row) => row.isDefault).map((row) => row.id).sort().join("|");
    const changedDefaults = [...effectiveDefaults].sort().join("|") !== groupDefaults;
    await action.run(
      () =>
        services.catalogue.linkModifierGroup(itemId, group.id, {
          priceOverrides,
          defaultModifierIds: changedDefaults ? effectiveDefaults : undefined,
        }),
      {
        onSuccess: () => {
          setGroupId("");
          setPrices({});
          setDefaults(null);
          onLinked();
        },
      },
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-fg text-sm font-semibold">{t("menu.modifierGroups")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <AsyncPanel state={groups} isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <div className="space-y-3">
            <Field label={t("menu.attachGroup")} hint={t("menu.attachGroupHint")}>
              <Select
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setPrices({});
                  setDefaults(null);
                }}
              >
                <option value="">—</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {tx(row.name)}
                  </option>
                ))}
              </Select>
            </Field>

            {group ? (
              <div className="border-line rounded-lg border">
                <p className="text-fg-muted border-line border-b px-3 py-2 text-xs">{t("mge.overridesHint")}</p>
                <ul className="divide-line divide-y">
                  {group.modifiers.map((modifier) => (
                    <li key={modifier.id} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-center gap-2 px-3 py-2">
                      <span className="text-fg truncate text-sm">{tx(modifier.name)}</span>
                      <MoneyInput
                        value={prices[modifier.id] ?? null}
                        currency={modifier.priceDelta.currency}
                        onChange={(minor) => setPrices((current) => ({ ...current, [modifier.id]: minor }))}
                        aria-label={`${tx(modifier.name)} — ${t("mge.itemPrice")}`}
                      />
                      <label className="text-fg-muted flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={effectiveDefaults.includes(modifier.id)}
                          onChange={(event) =>
                            setDefaults(
                              event.target.checked
                                ? [...effectiveDefaults, modifier.id]
                                : effectiveDefaults.filter((id) => id !== modifier.id),
                            )
                          }
                          className="accent-accent"
                        />
                        {t("menu.default")}
                      </label>
                      <span className="text-fg-subtle col-span-3 -mt-1 text-[0.65rem]">
                        {t("mge.groupPrice").replace("{price}", formatMoney(modifier.priceDelta, fmt))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button icon={<Plus size={13} />} disabled={!group || action.pending} loading={action.pending} onClick={link}>
              {t("mge.attach")}
            </Button>
          </div>
        )}
      </AsyncPanel>
    </section>
  );
}
