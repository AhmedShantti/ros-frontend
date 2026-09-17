/**
 * Client error log — NFR-OBS-001, NFR-OBS-005.
 *
 * What the console captures when something goes wrong in the browser, and
 * how it is kept safe to hand to support:
 *
 *   - NFR-OBS-001: every entry is a structured JSON record carrying tenant,
 *     branch, correlation and causation identifiers. The correlation id is
 *     the browser tab's session; the causation id links an entry to the one
 *     that immediately preceded it in the same burst (an unhandled rejection
 *     that follows a failed request, say), so a chain reads as a chain.
 *   - NFR-OBS-005: nothing reaches the log without passing the redaction
 *     layer. Context is an allowlist — a key not on it is dropped, not
 *     masked — and free text (messages, stacks, a user's own problem report)
 *     is scrubbed of card data, e-mail addresses, phone numbers, bearer
 *     tokens, JWTs, long secrets and credential-looking query parameters.
 *
 * There is no telemetry endpoint on this backend, so the log is a bounded
 * ring buffer on the device, exported as JSON Lines for a support ticket.
 * That is the honest scope: the browser half of the logging pipeline.
 */

import { redactCardData } from "./pci";

export type ClientLogLevel = "error" | "warn" | "info";
export type ClientLogKind = "uncaught_error" | "unhandled_rejection" | "problem_report";

export interface ClientLogEntry {
  id: string;
  at: string;
  level: ClientLogLevel;
  kind: ClientLogKind;
  message: string;
  stack: string | null;
  /** Path only — the query string is never kept. */
  route: string;
  tenantId: string | null;
  branchId: string | null;
  correlationId: string;
  causationId: string | null;
  release: string;
  context: Record<string, string | number | boolean>;
}

const STORAGE_KEY = "ros.telemetry.clientLog";
const MAX_ENTRIES = 200;
/** Entries closer together than this are treated as one causal chain. */
const CHAIN_WINDOW_MS = 5_000;

/**
 * NFR-OBS-005 — the only context keys a log entry may carry. Anything else a
 * caller passes is dropped. Deliberately no free-form "details" key.
 */
export const CONTEXT_ALLOWLIST = [
  "viewportWidth",
  "viewportHeight",
  "dataMode",
  "online",
  "connectivity",
  "locale",
  "source",
  "line",
  "column",
  "httpStatus",
  "errorCode",
  "userAgentFamily",
] as const;

type AllowedKey = (typeof CONTEXT_ALLOWLIST)[number];

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SCRUBBERS: [RegExp, string][] = [
  // JWTs: three base64url segments.
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}\b/g, "[jwt]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, "$1 [token]"],
  // Credential-looking key=value pairs, in query strings or prose.
  [/\b(password|passcode|pin|otp|token|access_token|refresh_token|api[_-]?key|secret|signature|session)\s*[=:]\s*[^\s&"',;]+/gi, "$1=[redacted]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  // Long opaque secrets: hex or base64 runs of 32+ characters.
  [/\b[A-Fa-f0-9]{32,}\b/g, "[secret]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[secret]"],
];

/**
 * Phone numbers: a run with 9–15 digits and optional `+`, spaces or dashes.
 * ISO dates and times are left alone — they are what makes a log readable.
 */
const PHONE_RUN = /(?:\+|00)?\d[\d\s-]{7,17}\d/g;
function scrubPhones(text: string): string {
  return text.replace(PHONE_RUN, (run) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(run.trim())) return run;
    const digits = run.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15 ? "[phone]" : run;
  });
}

/** Free text, scrubbed. Card data first, so a PAN is masked rather than read as a phone number. */
export function redactText(text: string): string {
  let out = redactCardData(text);
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  out = scrubPhones(out);
  return out.length > 2_000 ? `${out.slice(0, 2_000)}…` : out;
}

/** Path without query or fragment, with id-like segments generalised. */
export function redactRoute(href: string): string {
  let path = href;
  try {
    path = new URL(href, "http://local").pathname;
  } catch {
    path = href.split(/[?#]/)[0] ?? "";
  }
  return path
    .split("/")
    .map((segment) => (/\d{3,}|^[0-9a-f-]{16,}$|^[a-z]{2,6}_[\w]{8,}$/i.test(segment) ? ":id" : segment))
    .join("/");
}

/** NFR-OBS-005 — context through the allowlist; values scrubbed too. */
export function redactContext(context: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of CONTEXT_ALLOWLIST) {
    const value = context[key as AllowedKey];
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = redactText(value).slice(0, 200);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let sessionCorrelation: string | null = null;

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** One correlation id per tab, kept for the life of the tab. */
export function correlationId(): string {
  if (sessionCorrelation) return sessionCorrelation;
  try {
    const stored = window.sessionStorage.getItem(`${STORAGE_KEY}.correlation`);
    if (stored) return (sessionCorrelation = stored);
    sessionCorrelation = newId("corr");
    window.sessionStorage.setItem(`${STORAGE_KEY}.correlation`, sessionCorrelation);
  } catch {
    sessionCorrelation = sessionCorrelation ?? newId("corr");
  }
  return sessionCorrelation;
}

export function readClientLog(): ClientLogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ClientLogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeClientLog(entries: ClientLogEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent(CLIENT_LOG_EVENT));
  } catch {
    /* a full or blocked store must never throw from inside an error handler */
  }
}

export const CLIENT_LOG_EVENT = "ros:client-log";

export function clearClientLog(): void {
  writeClientLog([]);
}

export interface LogScope {
  tenantId: string | null;
  branchId: string | null;
  release: string;
}

/** Records one entry through the redaction layer. Newest first. */
export function recordClientLog(
  input: { level: ClientLogLevel; kind: ClientLogKind; message: string; stack?: string | null; context?: Record<string, unknown> },
  scope: LogScope,
): ClientLogEntry {
  const existing = readClientLog();
  const previous = existing[0];
  const now = Date.now();
  const entry: ClientLogEntry = {
    id: newId("log"),
    at: new Date(now).toISOString(),
    level: input.level,
    kind: input.kind,
    message: redactText(input.message || "(no message)"),
    stack: input.stack ? redactText(input.stack) : null,
    route: typeof window !== "undefined" ? redactRoute(window.location.href) : "",
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    correlationId: correlationId(),
    causationId:
      previous && previous.correlationId === correlationId() && now - Date.parse(previous.at) <= CHAIN_WINDOW_MS
        ? previous.id
        : null,
    release: scope.release,
    context: redactContext(input.context ?? {}),
  };
  writeClientLog([entry, ...existing]);
  return entry;
}

/** JSON Lines — one structured record per line, the format log shippers ingest. */
export function toJsonLines(entries: ClientLogEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

function uaFamily(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/**
 * Installs the global listeners. Returns the uninstaller.
 *
 * `scope` is a getter because the session resolves after the listeners go
 * in, and an error raised later must carry the scope in force then.
 */
export function installClientErrorCapture(scope: () => LogScope): () => void {
  if (typeof window === "undefined") return () => {};

  const common = () => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    online: navigator.onLine,
    userAgentFamily: uaFamily(),
  });

  const onError = (event: ErrorEvent) => {
    recordClientLog(
      {
        level: "error",
        kind: "uncaught_error",
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack ?? null : null,
        context: { ...common(), source: redactRoute(event.filename ?? ""), line: event.lineno, column: event.colno },
      },
      scope(),
    );
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: unknown; stack?: unknown; code?: unknown; status?: unknown } | undefined;
    recordClientLog(
      {
        level: "error",
        kind: "unhandled_rejection",
        message: typeof reason?.message === "string" ? reason.message : String(event.reason),
        stack: typeof reason?.stack === "string" ? reason.stack : null,
        context: {
          ...common(),
          errorCode: typeof reason?.code === "string" ? reason.code : undefined,
          httpStatus: typeof reason?.status === "number" ? reason.status : undefined,
        },
      },
      scope(),
    );
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
