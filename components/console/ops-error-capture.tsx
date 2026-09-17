"use client";

/**
 * Console-wide observability hooks: the client error capture (NFR-OBS-001,
 * NFR-OBS-005) and the unsupported-browser notice (NFR-PORT-003/004).
 *
 * Mounted once in the console layout. Renders nothing unless this browser
 * is missing a platform feature the console needs, is not one of the
 * supported families, or the window is narrower than the supported minimum —
 * and then only a dismissible notice that says what to do about it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { installClientErrorCapture, type LogScope } from "@/lib/console/ops-telemetry";
import { CURRENT_RELEASE } from "@/lib/console/ops-release-notes";
import { checkFeatures, supportVerdict, type SupportVerdict } from "@/lib/console/ops-browser-support";

const DISMISS_KEY = "ros.support.dismissed";

export function OpsErrorCapture() {
  const { t } = useI18n();
  const { scope } = useSession();
  const scopeRef = useRef<LogScope>({ tenantId: scope.tenantId, branchId: scope.branchId, release: CURRENT_RELEASE });
  scopeRef.current = { tenantId: scope.tenantId, branchId: scope.branchId, release: CURRENT_RELEASE };

  useEffect(() => installClientErrorCapture(() => scopeRef.current), []);

  const [verdict, setVerdict] = useState<SupportVerdict | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const evaluate = () => setVerdict(supportVerdict(navigator.userAgent, checkFeatures(), window.innerWidth));
    evaluate();
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, []);

  if (!verdict || dismissed) return null;
  const problem = verdict.missing.length > 0 || !verdict.supportedFamily || verdict.viewport === "narrow";
  if (!problem) return null;

  return (
    <div role="status" className="bg-warn-soft border-warn/40 text-fg fixed start-4 bottom-4 z-90 max-w-sm rounded-xl border p-3 text-xs shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{t("health.supportBannerTitle")}</p>
          <p className="text-fg-muted leading-relaxed">
            {verdict.missing.length > 0 || !verdict.supportedFamily ? t("health.supportBannerBrowser") : t("health.supportBannerNarrow")}
          </p>
          <Link href="/operations/health" className="text-accent font-medium">
            {t("health.supportBannerMore")}
          </Link>
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => {
            setDismissed(true);
            try {
              window.sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
          className="text-fg-muted hover:text-fg focus-visible:ring-accent inline-flex h-7 w-7 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
        >
          <X size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
