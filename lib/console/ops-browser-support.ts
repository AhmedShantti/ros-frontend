/**
 * Browser and viewport support — NFR-PORT-003, NFR-PORT-004.
 *
 * The dashboard supports the two most recent versions of Chrome, Safari,
 * Edge and Firefox (NFR-PORT-003) at viewport widths from 360 to 2560 px
 * (NFR-PORT-004). A browser cannot know what "the two most recent versions"
 * are without asking the network, so support is judged the way it can be
 * judged honestly on the device: by the platform features the console
 * actually relies on, plus the browser family. A missing feature is a
 * concrete, fixable finding ("update your browser"); a version-number guess
 * would not be.
 */

export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari" | "other";

export interface BrowserIdentity {
  family: BrowserFamily;
  version: number | null;
}

export function identifyBrowser(userAgent: string): BrowserIdentity {
  const pick = (pattern: RegExp) => {
    const match = pattern.exec(userAgent);
    return match ? Number(match[1]) : null;
  };
  if (/Edg\//.test(userAgent)) return { family: "edge", version: pick(/Edg\/(\d+)/) };
  if (/Firefox\//.test(userAgent)) return { family: "firefox", version: pick(/Firefox\/(\d+)/) };
  if (/Chrome\//.test(userAgent) && !/OPR\//.test(userAgent)) return { family: "chrome", version: pick(/Chrome\/(\d+)/) };
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return { family: "safari", version: pick(/Version\/(\d+)/) };
  return { family: "other", version: null };
}

export interface FeatureCheck {
  id: string;
  ok: boolean;
}

/** The platform features the console depends on. Run in the browser only. */
export function checkFeatures(): FeatureCheck[] {
  const css = (rule: string) => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(rule);
  return [
    { id: "intl", ok: typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function" && typeof Intl.DateTimeFormat === "function" },
    { id: "structuredClone", ok: typeof structuredClone === "function" },
    { id: "randomUUID", ok: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" },
    { id: "subtleCrypto", ok: typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined" },
    { id: "cssHas", ok: css("selector(:has(*))") },
    { id: "cssLogicalProps", ok: css("margin-inline-start: 1px") },
    { id: "localStorage", ok: (() => {
      try {
        window.localStorage.setItem("ros.support.probe", "1");
        window.localStorage.removeItem("ros.support.probe");
        return true;
      } catch {
        return false;
      }
    })() },
    { id: "arrayAt", ok: typeof Array.prototype.at === "function" },
  ];
}

export const MIN_VIEWPORT = 360;
export const MAX_VIEWPORT = 2560;

export type ViewportFit = "ok" | "narrow" | "wide";

export function viewportFit(width: number): ViewportFit {
  if (width < MIN_VIEWPORT) return "narrow";
  if (width > MAX_VIEWPORT) return "wide";
  return "ok";
}

export interface SupportVerdict {
  browser: BrowserIdentity;
  supportedFamily: boolean;
  missing: string[];
  viewport: ViewportFit;
  width: number;
}

export function supportVerdict(userAgent: string, features: FeatureCheck[], width: number): SupportVerdict {
  const browser = identifyBrowser(userAgent);
  return {
    browser,
    supportedFamily: browser.family !== "other",
    missing: features.filter((feature) => !feature.ok).map((feature) => feature.id),
    viewport: viewportFit(width),
    width,
  };
}
