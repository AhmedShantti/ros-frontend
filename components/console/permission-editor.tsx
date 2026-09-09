"use client";

/**
 * The permission selector — FR-SEC-011, FR-SEC-012, FR-SEC-015, FR-SEC-016.
 *
 * A checkbox tree rather than a list of what a role already has, because the
 * question this screen exists to answer is "what *could* this role do", and
 * a view that renders only granted permissions cannot answer it. Every group
 * shows its full catalogue with a count, so an empty group is visibly empty
 * rather than absent.
 *
 * Two SRS rules are enforced at selection time rather than on save:
 *
 *   - Sensitive permissions carry a marker (FR-SEC-012). Not a colour alone —
 *     a word, because colour is not information for everyone reading it.
 *   - Segregation-of-duties pairs surface the moment both halves are ticked
 *     (FR-SEC-015), and the four blocking pairs cannot be ticked together at
 *     all (FR-SEC-016). Warning after the fact, on a save, means the
 *     conflict is discovered by whoever inherits the role.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";

import {
  PERMISSION_GROUPS,
  SOD_PAIRS,
  permissionsInGroup,
  type PermissionGroup,
  type PermissionKey,
  type SodPair,
} from "@/lib/console/permissions";
import { useI18n } from "@/lib/console/providers";
import { Badge, Button, Callout, cx } from "@/components/console/ui";

export interface SodFinding {
  pair: SodPair;
  blocking: boolean;
}

/** Every incompatible pair fully present in `granted`. */
export function sodFindings(granted: Set<string>): SodFinding[] {
  return SOD_PAIRS.filter((pair) => granted.has(pair.a) && granted.has(pair.b)).map((pair) => ({
    pair,
    blocking: pair.blocking,
  }));
}

/**
 * Which permissions would create a *blocking* conflict if added now.
 *
 * Used to disable the checkbox rather than let it be ticked and then
 * refused — the SRS blocks these four outright, and a control that lets you
 * make the mistake before telling you is a worse control.
 */
export function blockedBy(granted: Set<string>): Map<string, SodPair> {
  const blocked = new Map<string, SodPair>();
  for (const pair of SOD_PAIRS) {
    if (!pair.blocking) continue;
    if (granted.has(pair.a) && !granted.has(pair.b)) blocked.set(pair.b, pair);
    if (granted.has(pair.b) && !granted.has(pair.a)) blocked.set(pair.a, pair);
  }
  return blocked;
}

export function PermissionEditor({
  granted,
  onChange,
  readOnly,
}: {
  granted: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}) {
  const { t, tx } = useI18n();
  const [openGroups, setOpenGroups] = useState<Set<PermissionGroup>>(
    () => new Set<PermissionGroup>(["sales"]),
  );
  const [filter, setFilter] = useState<"all" | "granted" | "sensitive">("all");

  const blocked = useMemo(() => blockedBy(granted), [granted]);
  const findings = useMemo(() => sodFindings(granted), [granted]);

  function toggle(key: string) {
    if (readOnly) return;
    const next = new Set(granted);
    if (next.has(key)) next.delete(key);
    else if (!blocked.has(key)) next.add(key);
    onChange(next);
  }

  function toggleGroup(group: PermissionGroup, on: boolean) {
    if (readOnly) return;
    const next = new Set(granted);
    for (const permission of permissionsInGroup(group)) {
      if (on) {
        if (!blocked.has(permission.key)) next.add(permission.key);
      } else {
        next.delete(permission.key);
      }
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "granted", "sensitive"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={cx(
                "rounded-lg border px-2.5 py-1 text-xs",
                filter === option
                  ? "border-accent bg-accent-soft text-accent font-medium"
                  : "border-line bg-raised text-fg-muted",
              )}
            >
              {t(`perm.filter.${option}` as never)}
            </button>
          ))}
        </div>
        <span className="text-fg-subtle font-mono text-xs tabular-nums">
          {granted.size} {t("perm.granted")}
        </span>
      </div>

      {findings.length > 0 ? (
        <Callout
          tone={findings.some((finding) => finding.blocking) ? "bad" : "warn"}
          icon={<ShieldAlert size={14} />}
          title={t("perm.sodTitle")}
        >
          <ul className="mt-1 space-y-1">
            {findings.map(({ pair, blocking }) => (
              <li key={`${pair.a}|${pair.b}`}>
                <span className="font-mono text-[0.68rem]" dir="ltr">
                  {pair.a} + {pair.b}
                </span>
                <br />
                {tx(pair.risk)}{" "}
                {blocking ? <Badge tone="bad">{t("perm.blocking")}</Badge> : null}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="space-y-2">
        {PERMISSION_GROUPS.map((group) => {
          const permissions = permissionsInGroup(group);
          const visible = permissions.filter((permission) => {
            if (filter === "granted") return granted.has(permission.key);
            if (filter === "sensitive") return permission.sensitive;
            return true;
          });
          if (visible.length === 0) return null;

          const held = permissions.filter((permission) => granted.has(permission.key)).length;
          const expanded = openGroups.has(group);
          const allOn = held === permissions.length;

          return (
            <div key={group} className="border-line overflow-hidden rounded-lg border">
              <div className="bg-sunken flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpenGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  className="text-fg flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs font-semibold capitalize"
                >
                  {expanded ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                  {t(`perm.group.${group}` as never)}
                </button>

                <span className="text-fg-subtle shrink-0 font-mono text-[0.68rem] tabular-nums">
                  {held} / {permissions.length}
                </span>

                {!readOnly ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleGroup(group, !allOn)}
                  >
                    {allOn ? t("perm.none") : t("perm.all")}
                  </Button>
                ) : null}
              </div>

              {expanded ? (
                <ul className="divide-line divide-y">
                  {visible.map((permission) => {
                    const on = granted.has(permission.key);
                    const block = blocked.get(permission.key);
                    return (
                      <li key={permission.key} className="px-3 py-2">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={readOnly || Boolean(block)}
                            onChange={() => toggle(permission.key)}
                            className="accent-accent mt-0.5 h-4 w-4 shrink-0 disabled:opacity-40"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-fg text-sm">{tx(permission.label)}</span>
                              <code
                                className="text-fg-subtle font-mono text-[0.65rem]"
                                dir="ltr"
                              >
                                {permission.key}
                              </code>
                              {permission.sensitive ? (
                                <Badge tone="warn">{t("role.sensitive")}</Badge>
                              ) : null}
                            </span>
                            <span className="text-fg-muted mt-0.5 block text-xs leading-relaxed">
                              {tx(permission.description)}
                            </span>
                            {block ? (
                              <span className="text-bad mt-1 flex items-start gap-1 text-xs">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
                                {t("perm.blockedBecause").replace("{risk}", tx(block.risk))}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
