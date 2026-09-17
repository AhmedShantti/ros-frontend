"use client";

/**
 * Password policy feedback — FR-SEC-025.
 *
 * `PasswordChecklist` shows each rule the tenant's policy switches on and
 * whether the candidate meets it. `BreachCheckResult` runs the breached-
 * password check on request and is explicit about which source answered:
 * the k-anonymity range API, or — when that cannot be reached — the small
 * bundled list, which is a much weaker assurance and says so.
 */

import { useState } from "react";
import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import { useI18n } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { LOCAL_LIST_SIZE, checkBreached, type BreachResult } from "@/lib/console/security-breach";
import { passwordRuleResults, type PasswordPolicy } from "@/lib/console/security-policy";
import { Button, cx } from "@/components/console/ui";

export function PasswordChecklist({
  password,
  policy,
  email,
}: {
  password: string;
  policy: PasswordPolicy;
  email?: string | null;
}) {
  const { t } = useI18n();
  const results = passwordRuleResults(password, policy, email);
  return (
    <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2" aria-live="polite">
      {results.map((result) => (
        <li key={result.rule} className={cx("flex items-center gap-1.5", result.ok ? "text-good" : "text-fg-muted")}>
          {result.ok ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
          <span>
            {t(`pwd.check.${result.rule}` as ConsoleKey).replace("{n}", String(policy.minLength))}
            <span className="sr-only">{result.ok ? ` — ${t("pwd.met")}` : ` — ${t("pwd.notMet")}`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BreachMessage({ result }: { result: BreachResult }) {
  const { t, fmt } = useI18n();
  const source =
    result.source === "hibp" ? t("pwd.sourceHibp") : t("pwd.sourceLocal").replace("{n}", String(LOCAL_LIST_SIZE));
  return (
    <p className={cx("flex items-start gap-1.5 text-xs", result.breached ? "text-bad" : "text-good")} role="status">
      {result.breached ? <ShieldAlert size={13} aria-hidden className="mt-px shrink-0" /> : <ShieldCheck size={13} aria-hidden className="mt-px shrink-0" />}
      <span>
        {result.breached
          ? result.count
            ? t("pwd.breachedCount").replace("{n}", formatNumber(result.count, fmt))
            : t("pwd.breached")
          : t("pwd.notBreached")}{" "}
        <span className="text-fg-subtle">{source}</span>
      </span>
    </p>
  );
}

export function BreachCheckResult({ password }: { password: string }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState<{ for: string; result: BreachResult } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = checked && checked.for === password ? checked.result : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        loading={busy}
        disabled={!password}
        onClick={async () => {
          setBusy(true);
          const result = await checkBreached(password);
          setChecked({ for: password, result });
          setBusy(false);
        }}
      >
        {t("pwd.checkBreach")}
      </Button>
      {current ? <BreachMessage result={current} /> : null}
    </div>
  );
}
