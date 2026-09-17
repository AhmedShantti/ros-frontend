"use client";

/**
 * Sensitive values on screen — FR-SEC-042 (the console's half) and
 * FR-SEC-060.
 *
 * FR-SEC-042 is mostly a server requirement: envelope encryption with
 * per-tenant data keys happens where the data is stored, and nothing here
 * claims it. What a screen owes is the other half — a national id, a bank
 * account or a personal phone number is not painted in clear for whoever
 * glances at the monitor. So a restricted value renders masked, reveals
 * only for a session holding the permission, re-masks itself after thirty
 * seconds, and every reveal is written to the security event log with the
 * field and record it exposed.
 *
 * `ClassificationBadge` puts the FR-SEC-060 class next to the data, so the
 * control a person meets (masked, logged, export needs a permission) is
 * explained by the label beside it.
 */

import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import type { PermissionKey } from "@/lib/console/permissions";
import { useI18n, useSession } from "@/lib/console/providers";
import { useSecurityLog } from "@/lib/console/security-log";
import { CLASS_CONTROLS, type DataClass } from "@/lib/console/security-policy";
import { Badge } from "@/components/console/ui";

const REMASK_MS = 30_000;

export function ClassificationBadge({ cls }: { cls: DataClass }) {
  const { t } = useI18n();
  return (
    <Badge tone={CLASS_CONTROLS[cls].tone} className="uppercase tracking-wide">
      <span title={t(`cls.controls.${cls}` as ConsoleKey)}>{t(`cls.name.${cls}` as ConsoleKey)}</span>
    </Badge>
  );
}

/** Keep enough to recognise the value, never enough to use it. */
export function maskValue(value: string, kind: "email" | "phone" | "generic" = "generic"): string {
  const text = value.trim();
  if (!text) return "";
  if (kind === "email" && text.includes("@")) {
    const [local, domain] = text.split("@");
    return `${(local ?? "").slice(0, 1)}•••@${domain}`;
  }
  const tail = text.replace(/\s/g, "").slice(-(kind === "phone" ? 2 : 4));
  return `••••${tail}`;
}

export function SensitiveValue({
  value,
  field,
  subjectType,
  subjectId,
  cls = "restricted",
  kind = "generic",
  permission,
}: {
  value: string;
  /** What the value is, for the event log — `user.phone`, `employee.iban`. */
  field: string;
  subjectType: string;
  subjectId: string;
  cls?: DataClass;
  kind?: "email" | "phone" | "generic";
  /** Defaults to the class's reveal permission. */
  permission?: PermissionKey;
}) {
  const { t } = useI18n();
  const { can } = useSession();
  const record = useSecurityLog();
  const controls = CLASS_CONTROLS[cls];
  const required = permission ?? controls.permission;
  const allowed = required === null || can(required);
  const [revealed, setRevealed] = useState(!controls.maskByDefault);

  useEffect(() => {
    if (!revealed || !controls.maskByDefault) return;
    const timer = window.setTimeout(() => setRevealed(false), REMASK_MS);
    return () => window.clearTimeout(timer);
  }, [revealed, controls.maskByDefault]);

  if (!value) return <span className="text-fg-subtle">—</span>;
  if (!controls.maskByDefault) return <span dir="ltr">{value}</span>;

  async function reveal() {
    if (!allowed) return;
    setRevealed(true);
    // FR-SEC-042 / FR-SEC-060 — a reveal of restricted data is itself a record.
    if (controls.logged) {
      await record({ kind: "field.revealed", subjectType, subjectId, detail: { field, class: cls } });
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span dir="ltr" className="font-mono text-xs">
        {revealed ? value : maskValue(value, kind)}
      </span>
      {allowed ? (
        <button
          type="button"
          onClick={() => (revealed ? setRevealed(false) : void reveal())}
          className="text-fg-muted hover:text-fg inline-flex items-center rounded p-0.5"
          aria-label={revealed ? t("sens.hide") : t("sens.reveal")}
          title={revealed ? t("sens.hide") : t("sens.revealLogged")}
        >
          {revealed ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
        </button>
      ) : (
        <span className="text-fg-subtle inline-flex" title={t("sens.noPermission")}>
          <Lock size={11} aria-label={t("sens.noPermission")} />
        </span>
      )}
    </span>
  );
}
