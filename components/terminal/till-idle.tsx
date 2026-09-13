"use client";

/**
 * FR-SEC-026 on the till — "default 15 minutes on POS".
 *
 * An unattended till with someone's PIN session on it is that person's
 * identity left on the counter. After the period (`sec.posIdleMinutes`,
 * resolved for this terminal's branch and terminal) the cashier is signed
 * off; a minute before, the screen says so and offers to stay. Signing off
 * leaves the drawer open in their name — nothing about the money changes.
 */

import { useEffect } from "react";
import { Clock3 } from "lucide-react";

import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { getTerminalBranchId, getTerminalId } from "@/lib/api/session";
import { SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import { useIdle } from "@/components/console/idle-lock";
import { Button } from "@/components/console/ui";

export function TillIdleSignOff({ onExpire }: { onExpire: () => void }) {
  const { t } = useI18n();
  const { tenant } = useSession();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);
  const minutes = Math.max(
    2,
    Number(
      resolveSetting(SETTING_BY_KEY.get("sec.posIdleMinutes")!, overrides.data ?? [], {
        countryCode: tenant.countryCode,
        tenantId: tenant.id,
        brandId: null,
        branchId: getTerminalBranchId(),
        terminalId: getTerminalId(),
      }).value,
    ) || 15,
  );
  const { phase, secondsLeft, stayActive } = useIdle(minutes, false);

  useEffect(() => {
    if (phase === "locked") onExpire();
  }, [phase, onExpire]);

  if (phase !== "warning") return null;

  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-x-0 bottom-6 z-100 flex justify-center px-4">
      <div className="bg-fg text-surface flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl">
        <Clock3 size={16} aria-hidden />
        <p className="text-sm">{t("idle.tillWarning").replace("{n}", String(secondsLeft))}</p>
        <Button size="sm" variant="primary" onClick={stayActive}>
          {t("idle.stay")}
        </Button>
      </div>
    </div>
  );
}
