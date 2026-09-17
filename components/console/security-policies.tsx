"use client";

/**
 * Tenant security policy editors — FR-SEC-025, FR-SEC-034, FR-SEC-035,
 * FR-SEC-052, FR-SEC-053, FR-SEC-060.
 *
 * Each card reads and writes `services.securitySettings`, which validates
 * with strict schemas (FR-SEC-047) and logs every accepted change. Each card
 * also says, in its own words, what the console can and cannot enforce: the
 * API has none of these endpoints, so a saved allow-list blocks nobody until
 * the server reads it, and the copy does not pretend otherwise.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Globe, Plus, RadioTower, ShieldCheck, Trash2 } from "lucide-react";

import type { ConsoleKey } from "@/locales";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { useActor } from "@/lib/console/security-log";
import { formatDateTime } from "@/lib/console/format";
import { ROLE_DEFINITIONS } from "@/lib/console/permissions";
import {
  CLASS_CONTROLS,
  DATA_CLASSES,
  ESCALATION_LADDER,
  OFFLINE_POLICIES,
  PASSWORD_MIN_FLOOR,
  SIEM_CATEGORIES,
  SIEM_FORMATS,
  cidrContains,
  cidrTooBroad,
  parseCidr,
  parseIp,
  type ApprovalPolicy,
  type DataClass,
  type IpAllowEntry,
  type IpAllowList,
  type PasswordPolicy,
  type SiemConfig,
  type SiemFormat,
} from "@/lib/console/security-policy";
import { formatSiemEvent } from "@/lib/console/security-siem";
import type { SecurityEvent } from "@/lib/console/services/security-events";
import { PasswordChecklist, BreachCheckResult } from "@/components/console/security-password";
import { ClassificationBadge } from "@/components/console/security-sensitive";
import { useConfirm } from "@/components/console/confirm";
import { AsyncPanel, ErrorCallout } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  SegmentedControl,
  Select,
  Toggle,
} from "@/components/console/ui";

// ---------------------------------------------------------------------------
// Shared save plumbing
// ---------------------------------------------------------------------------

function useSave(notify: (message: string) => void) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(work: () => Promise<T>, onDone?: (value: T) => void): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const value = await work();
      onDone?.(value);
      notify(t("secp.saved"));
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

function Stamp({ at, by }: { at: string | null; by: string | null }) {
  const { t, fmt } = useI18n();
  if (!at) return <p className="text-fg-subtle text-xs">{t("secp.neverSaved")}</p>;
  return (
    <p className="text-fg-subtle text-xs">
      {t("secp.lastSaved").replace("{when}", formatDateTime(at, fmt)).replace("{who}", by ?? "—")}
    </p>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text);
  const invalid = text.trim() === "" || !Number.isInteger(parsed) || parsed < min || parsed > max;
  return (
    <Field label={label} hint={hint} error={invalid ? `${min}–${max}` : null}>
      <Input
        inputMode="numeric"
        dir="ltr"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (Number.isInteger(next)) onChange(next);
        }}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-025 — password policy
// ---------------------------------------------------------------------------

export function PasswordPolicyCard({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const actor = useActor();
  const state = useAsync(() => services.securitySettings.passwordPolicy(), []);
  const [draft, setDraft] = useState<PasswordPolicy | null>(null);
  const [sample, setSample] = useState("");
  const save = useSave(notify);

  useEffect(() => {
    if (state.data) setDraft(state.data.value);
  }, [state.data]);

  const patch = (part: Partial<PasswordPolicy>) => setDraft((current) => (current ? { ...current, ...part } : current));

  return (
    <Card>
      <CardHeader title={t("pwd.title")} hint={t("pwd.hint")} spec="FR-SEC-025" />
      <AsyncPanel state={state}>
        {(stored) =>
          draft ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField
                  label={t("pwd.minLength")}
                  hint={t("pwd.minLengthHint").replace("{n}", String(PASSWORD_MIN_FLOOR))}
                  value={draft.minLength}
                  min={PASSWORD_MIN_FLOOR}
                  max={128}
                  disabled={!canEdit}
                  onChange={(minLength) => patch({ minLength })}
                />
                <NumberField
                  label={t("pwd.history")}
                  hint={t("pwd.historyHint")}
                  value={draft.historyCount}
                  min={0}
                  max={24}
                  disabled={!canEdit}
                  onChange={(historyCount) => patch({ historyCount })}
                />
                <NumberField
                  label={t("pwd.maxAge")}
                  hint={t("pwd.maxAgeHint")}
                  value={draft.maxAgeDays}
                  min={0}
                  max={730}
                  disabled={!canEdit}
                  onChange={(maxAgeDays) => patch({ maxAgeDays })}
                />
              </div>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Toggle checked={draft.requireLower} disabled={!canEdit} onChange={(requireLower) => patch({ requireLower })} label={t("pwd.rule.lower")} />
                <Toggle checked={draft.requireUpper} disabled={!canEdit} onChange={(requireUpper) => patch({ requireUpper })} label={t("pwd.rule.upper")} />
                <Toggle checked={draft.requireDigit} disabled={!canEdit} onChange={(requireDigit) => patch({ requireDigit })} label={t("pwd.rule.digit")} />
                <Toggle checked={draft.requireSymbol} disabled={!canEdit} onChange={(requireSymbol) => patch({ requireSymbol })} label={t("pwd.rule.symbol")} />
                <Toggle checked={draft.rejectEmailName} disabled={!canEdit} onChange={(rejectEmailName) => patch({ rejectEmailName })} label={t("pwd.rule.emailName")} />
                {/* SHALL in the SRS — shown, and locked on. */}
                <Toggle checked disabled onChange={() => undefined} label={t("pwd.breachCheck")} hint={t("pwd.breachCheckHint")} />
              </div>

              <div className="border-line rounded-lg border p-3">
                <Field label={t("pwd.tryIt")} hint={t("pwd.tryItHint")}>
                  <Input type="password" autoComplete="off" value={sample} onChange={(event) => setSample(event.target.value)} />
                </Field>
                {sample ? (
                  <div className="mt-2 space-y-2">
                    <PasswordChecklist password={sample} policy={draft} />
                    <BreachCheckResult password={sample} />
                  </div>
                ) : null}
              </div>

              <Callout tone="muted">{t("pwd.enforcementNote")}</Callout>
              <ErrorCallout error={save.error} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stamp at={stored.updatedAt} by={stored.updatedBy} />
                {canEdit ? (
                  <Button
                    variant="primary"
                    loading={save.pending}
                    onClick={() => void save.run(() => services.securitySettings.savePasswordPolicy(draft, actor), state.reload)}
                  >
                    {t("common.save")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      </AsyncPanel>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-052 — IP allow-list
// ---------------------------------------------------------------------------

const IP_LOOKUP = "https://api.ipify.org?format=json";

export function IpAllowListCard({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const { tenant } = useSession();
  const actor = useActor();
  const confirm = useConfirm();
  const state = useAsync(() => services.securitySettings.ipAllowList(), []);
  const [draft, setDraft] = useState<IpAllowList | null>(null);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [myIp, setMyIp] = useState("");
  const [lookup, setLookup] = useState<"idle" | "busy" | "failed">("idle");
  const save = useSave(notify);

  const enterprise = tenant.plan === "enterprise";

  useEffect(() => {
    if (state.data) setDraft(state.data.value);
  }, [state.data]);

  const parsed = cidr.trim() ? parseCidr(cidr) : null;
  const problem = parsed && !parsed.ok ? parsed : null;
  const broad = parsed?.ok ? cidrTooBroad(cidr) : false;
  const duplicate = parsed?.ok ? Boolean(draft?.entries.some((entry) => entry.cidr === parsed.canonical)) : false;

  const myIpValid = myIp.trim() ? parseIp(myIp) !== null : false;
  const coversMe = draft && myIpValid ? draft.entries.some((entry) => cidrContains(entry.cidr, myIp.trim())) : null;

  async function detect() {
    setLookup("busy");
    try {
      const response = await fetch(IP_LOOKUP, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      const body = (await response.json()) as { ip?: string };
      if (!body.ip || !parseIp(body.ip)) throw new Error("no address");
      setMyIp(body.ip);
      setLookup("idle");
    } catch {
      setLookup("failed");
    }
  }

  function add() {
    if (!draft || !parsed?.ok || duplicate || !label.trim()) return;
    const entry: IpAllowEntry = {
      id: `ip_${Date.now().toString(36)}`,
      cidr: parsed.canonical,
      label: label.trim(),
      addedAt: new Date().toISOString(),
      addedBy: actor.actorName,
    };
    setDraft({ ...draft, entries: [...draft.entries, entry] });
    setCidr("");
    setLabel("");
  }

  async function submit() {
    if (!draft) return;
    const enabling = draft.dashboardEnabled;
    // The lockout warning: switching the dashboard list on from an address
    // it does not cover would end this session's access at the next request.
    if (enabling && coversMe === false) {
      const ok = await confirm({
        title: t("ipl.lockoutTitle"),
        body: t("ipl.lockoutBody").replace("{ip}", myIp.trim()),
        confirmLabel: t("ipl.lockoutConfirm"),
        tone: "danger",
        typeToConfirm: myIp.trim(),
      });
      if (!ok) return;
    } else if (enabling && coversMe === null) {
      const ok = await confirm({
        title: t("ipl.unknownTitle"),
        body: t("ipl.unknownBody"),
        confirmLabel: t("common.save"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await save.run(() => services.securitySettings.saveIpAllowList(draft, actor), state.reload);
  }

  return (
    <Card>
      <CardHeader title={t("ipl.title")} hint={t("ipl.hint")} spec="FR-SEC-052" />
      <AsyncPanel state={state}>
        {(stored) =>
          draft ? (
            <div className="space-y-4">
              {!enterprise ? <Callout tone="warn">{t("ipl.enterpriseOnly")}</Callout> : null}
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Toggle
                  checked={draft.dashboardEnabled}
                  disabled={!canEdit || !enterprise}
                  onChange={(dashboardEnabled) => setDraft({ ...draft, dashboardEnabled })}
                  label={t("ipl.dashboard")}
                  hint={t("ipl.dashboardHint")}
                />
                <Toggle
                  checked={draft.apiEnabled}
                  disabled={!canEdit}
                  onChange={(apiEnabled) => setDraft({ ...draft, apiEnabled })}
                  label={t("ipl.api")}
                  hint={t("ipl.apiHint")}
                />
              </div>

              <div className="border-line rounded-lg border p-3">
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                  <Field label={t("ipl.myAddress")} hint={t("ipl.myAddressHint")}>
                    <Input dir="ltr" value={myIp} onChange={(event) => setMyIp(event.target.value)} className="font-mono" placeholder="203.0.113.7" />
                  </Field>
                  <Button icon={<Globe size={13} />} loading={lookup === "busy"} onClick={() => void detect()}>
                    {t("ipl.detect")}
                  </Button>
                </div>
                {lookup === "failed" ? <p className="text-warn mt-2 text-xs">{t("ipl.detectFailed")}</p> : null}
                {myIp.trim() && !myIpValid ? <p className="text-bad mt-2 text-xs">{t("ipl.problem.format")}</p> : null}
                {coversMe !== null ? (
                  <p className={coversMe ? "text-good mt-2 text-xs" : "text-bad mt-2 text-xs"}>
                    {coversMe ? t("ipl.covered") : t("ipl.notCovered")}
                  </p>
                ) : null}
              </div>

              {draft.entries.length === 0 ? (
                <p className="text-fg-subtle text-xs">{t("ipl.empty")}</p>
              ) : (
                <ul className="border-line divide-line divide-y rounded-lg border">
                  {draft.entries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <span className="text-fg font-mono text-sm" dir="ltr">
                        {entry.cidr}
                      </span>
                      <span className="text-fg-muted text-xs">{entry.label}</span>
                      {myIpValid && cidrContains(entry.cidr, myIp.trim()) ? <Badge tone="good">{t("ipl.youAreHere")}</Badge> : null}
                      <span className="text-fg-subtle ms-auto text-xs">{entry.addedBy}</span>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={12} />}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("ipl.removeTitle"),
                              body: t("ipl.removeBody").replace("{cidr}", entry.cidr),
                              confirmLabel: t("common.remove"),
                              tone: "danger",
                            });
                            if (ok) setDraft({ ...draft, entries: draft.entries.filter((row) => row.id !== entry.id) });
                          }}
                        >
                          {t("common.remove")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit ? (
                <div className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Field
                    label={t("ipl.cidr")}
                    error={
                      problem
                        ? t(`ipl.problem.${problem.problem}` as ConsoleKey) +
                          (problem.suggestion ? ` ${t("ipl.didYouMean").replace("{cidr}", problem.suggestion)}` : "")
                        : duplicate
                          ? t("ipl.duplicate")
                          : null
                    }
                    hint={broad ? t("ipl.tooBroad") : t("ipl.cidrHint")}
                  >
                    <Input dir="ltr" className="font-mono" value={cidr} placeholder="198.51.100.0/24" onChange={(event) => setCidr(event.target.value)} />
                  </Field>
                  <Field label={t("ipl.label")}>
                    <Input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
                  </Field>
                  <div className="sm:pt-6">
                    <Button icon={<Plus size={13} />} disabled={!parsed?.ok || duplicate || !label.trim()} onClick={add}>
                      {t("common.add")}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Callout tone="muted">{t("ipl.enforcementNote")}</Callout>
              <ErrorCallout error={save.error} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stamp at={stored.updatedAt} by={stored.updatedBy} />
                {canEdit ? (
                  <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
                    {t("common.save")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      </AsyncPanel>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-053 — SIEM forwarding
// ---------------------------------------------------------------------------

export function SiemCard({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const { tenant } = useSession();
  const actor = useActor();
  const state = useAsync(() => services.securitySettings.siem(), []);
  const events = useAsync(() => services.securityEvents.list().then((rows) => rows.slice(0, 3)), []);
  const [draft, setDraft] = useState<SiemConfig | null>(null);
  const [token, setToken] = useState("");
  const [sample, setSample] = useState<string | null>(null);
  const save = useSave(notify);
  const enterprise = tenant.plan === "enterprise";

  useEffect(() => {
    if (state.data) setDraft(state.data.value);
  }, [state.data]);

  function buildSample(format: SiemFormat) {
    const now = new Date().toISOString();
    const probe: SecurityEvent = {
      id: "01TEST00000000000000000000",
      seq: 0,
      tenantId: tenant.id,
      at: now,
      kind: "policy.siem_changed",
      category: "configuration",
      actorId: actor.actorId,
      actorName: actor.actorName,
      subjectType: "siem_sink",
      subjectId: tenant.id,
      detail: { test: true },
      correlationId: "test",
      userAgent: "",
      previousHash: "",
      hash: "",
    };
    setSample(formatSiemEvent(probe, format));
  }

  return (
    <Card>
      <CardHeader title={t("siem.title")} hint={t("siem.hint")} spec="FR-SEC-053" />
      <AsyncPanel state={state}>
        {(stored) =>
          draft ? (
            <div className="space-y-4">
              {!enterprise ? <Callout tone="warn">{t("siem.enterpriseOnly")}</Callout> : null}
              <Toggle
                checked={draft.enabled}
                disabled={!canEdit || !enterprise}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
                label={t("siem.enabled")}
              />
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label={t("siem.endpoint")} hint={t("siem.endpointHint")}>
                  <Input
                    dir="ltr"
                    className="font-mono"
                    value={draft.endpoint}
                    disabled={!canEdit || !enterprise}
                    placeholder="https://siem.example.com/ingest"
                    onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
                  />
                </Field>
                <Field label={t("siem.format")}>
                  <Select
                    value={draft.format}
                    disabled={!canEdit || !enterprise}
                    onChange={(event) => setDraft({ ...draft, format: event.target.value as SiemFormat })}
                  >
                    {SIEM_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {t(`siem.format.${format}` as ConsoleKey)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {/* FR-SEC-053 — write-only credential: typed, fingerprinted, discarded. */}
              <Field
                label={t("siem.token")}
                hint={
                  draft.tokenSetAt
                    ? t("siem.tokenSet").replace("{fp}", draft.tokenFingerprint ?? "—").replace("{when}", draft.tokenSetAt.slice(0, 10))
                    : t("siem.tokenNotSet")
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  value={token}
                  disabled={!canEdit || !enterprise}
                  placeholder={draft.tokenSetAt ? "••••••••" : ""}
                  onChange={(event) => setToken(event.target.value)}
                />
              </Field>

              <fieldset>
                <legend className="text-fg mb-1 text-xs font-medium">{t("siem.categories")}</legend>
                <div className="grid gap-x-6 sm:grid-cols-2">
                  {SIEM_CATEGORIES.map((category) => (
                    <Toggle
                      key={category}
                      checked={draft.categories.includes(category)}
                      disabled={!canEdit || !enterprise}
                      label={t(`siem.cat.${category}` as ConsoleKey)}
                      onChange={(on) =>
                        setDraft({
                          ...draft,
                          categories: on ? [...draft.categories, category] : draft.categories.filter((row) => row !== category),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>

              <div className="border-line space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-fg text-xs font-medium">{t("siem.testTitle")}</p>
                  <Button size="sm" icon={<RadioTower size={12} />} onClick={() => buildSample(draft.format)}>
                    {t("siem.buildTest")}
                  </Button>
                </div>
                <p className="text-fg-muted text-xs">{t("siem.testServer")}</p>
                {sample ? (
                  <pre className="bg-sunken border-line overflow-x-auto rounded border p-2 text-[0.68rem]" dir="ltr">
                    {sample}
                  </pre>
                ) : null}
                {events.data && events.data.length > 0 ? (
                  <>
                    <p className="text-fg-subtle text-xs">{t("siem.recentPreview")}</p>
                    <pre className="bg-sunken border-line max-h-40 overflow-auto rounded border p-2 text-[0.68rem]" dir="ltr">
                      {events.data.map((event) => formatSiemEvent(event, draft.format)).join("\n")}
                    </pre>
                  </>
                ) : null}
              </div>

              <ErrorCallout error={save.error} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stamp at={stored.updatedAt} by={stored.updatedBy} />
                {canEdit && enterprise ? (
                  <Button
                    variant="primary"
                    loading={save.pending}
                    onClick={() =>
                      void save.run(
                        () => {
                          const { tokenSetAt: _a, tokenFingerprint: _b, ...rest } = draft;
                          return services.securitySettings.saveSiem(rest, token || null, actor);
                        },
                        () => {
                          setToken("");
                          state.reload();
                        },
                      )
                    }
                  >
                    {t("common.save")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      </AsyncPanel>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-034 / FR-SEC-035 — approval routing
// ---------------------------------------------------------------------------

export function ApprovalPolicyCard({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const { t, tx } = useI18n();
  const actor = useActor();
  const state = useAsync(() => services.securitySettings.approvalPolicy(), []);
  const [draft, setDraft] = useState<ApprovalPolicy | null>(null);
  const save = useSave(notify);

  useEffect(() => {
    if (state.data) setDraft(state.data.value);
  }, [state.data]);

  return (
    <Card>
      <CardHeader title={t("apl.title")} hint={t("apl.hint")} spec="FR-SEC-034" />
      <AsyncPanel state={state}>
        {(stored) =>
          draft ? (
            <div className="space-y-4">
              <Toggle
                checked={draft.escalationEnabled}
                disabled={!canEdit}
                onChange={(escalationEnabled) => setDraft({ ...draft, escalationEnabled })}
                label={t("apl.escalate")}
                hint={t("apl.escalateHint")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label={t("apl.afterMinutes")}
                  hint={t("apl.afterMinutesHint")}
                  value={draft.escalateAfterMinutes}
                  min={5}
                  max={10080}
                  disabled={!canEdit || !draft.escalationEnabled}
                  onChange={(escalateAfterMinutes) => setDraft({ ...draft, escalateAfterMinutes })}
                />
                <NumberField
                  label={t("apl.maxLevels")}
                  value={draft.maxLevels}
                  min={1}
                  max={ESCALATION_LADDER.length - 1}
                  disabled={!canEdit || !draft.escalationEnabled}
                  onChange={(maxLevels) => setDraft({ ...draft, maxLevels })}
                />
              </div>
              <ol className="flex flex-wrap items-center gap-2 text-xs">
                {ESCALATION_LADDER.slice(0, draft.maxLevels + 1).map((role, index) => (
                  <li key={role} className="flex items-center gap-2">
                    {index > 0 ? (
                      <span className="text-fg-subtle">
                        → {t("apl.after").replace("{h}", String(Math.round((draft.escalateAfterMinutes * index) / 6) / 10))}
                      </span>
                    ) : null}
                    <Badge tone={index === 0 ? "neutral" : "warn"}>{tx(ROLE_DEFINITIONS[role].name)}</Badge>
                  </li>
                ))}
              </ol>

              <div className="border-line space-y-3 border-t pt-4">
                <p className="text-fg flex items-center gap-2 text-sm font-semibold">
                  {t("apl.offlineTitle")} <span className="text-fg-subtle font-mono text-[0.62rem]">FR-SEC-035</span>
                </p>
                <SegmentedControl
                  value={draft.offlinePolicy}
                  onChange={(offlinePolicy) => canEdit && setDraft({ ...draft, offlinePolicy })}
                  options={OFFLINE_POLICIES.map((policy) => ({ value: policy, label: t(`apl.offline.${policy}` as ConsoleKey) }))}
                  label={t("apl.offlineTitle")}
                />
                <p className="text-fg-muted text-xs">{t(`apl.offlineHint.${draft.offlinePolicy}` as ConsoleKey)}</p>
                {draft.offlinePolicy === "retrospective" ? (
                  <NumberField
                    label={t("apl.reviewHours")}
                    hint={t("apl.reviewHoursHint")}
                    value={draft.retrospectiveReviewHours}
                    min={1}
                    max={168}
                    disabled={!canEdit}
                    onChange={(retrospectiveReviewHours) => setDraft({ ...draft, retrospectiveReviewHours })}
                  />
                ) : null}
              </div>

              <Callout tone="muted">{t("apl.enforcementNote")}</Callout>
              <ErrorCallout error={save.error} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stamp at={stored.updatedAt} by={stored.updatedBy} />
                {canEdit ? (
                  <Button
                    variant="primary"
                    loading={save.pending}
                    onClick={() => void save.run(() => services.securitySettings.saveApprovalPolicy(draft, actor), state.reload)}
                  >
                    {t("common.save")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      </AsyncPanel>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-060 — classification register
// ---------------------------------------------------------------------------

/** The fields the console handles, and their class. Screens read the same labels. */
export const FIELD_REGISTER: { field: string; cls: DataClass }[] = [
  { field: "menu_item.price", cls: "public" },
  { field: "menu_item.name", cls: "public" },
  { field: "order.total", cls: "internal" },
  { field: "stock_level.quantity", cls: "internal" },
  { field: "recipe.cost", cls: "confidential" },
  { field: "supplier.terms", cls: "confidential" },
  { field: "report.margin", cls: "confidential" },
  { field: "audit_log.entry", cls: "confidential" },
  { field: "user.email", cls: "restricted" },
  { field: "user.phone", cls: "restricted" },
  { field: "customer.phone", cls: "restricted" },
  { field: "customer.email", cls: "restricted" },
  { field: "employee.national_id", cls: "restricted" },
  { field: "employee.bank_account", cls: "restricted" },
  { field: "integration.credentials", cls: "restricted" },
];

export function ClassificationRegister() {
  const { t } = useI18n();
  const byClass = useMemo(
    () => DATA_CLASSES.map((cls) => ({ cls, fields: FIELD_REGISTER.filter((row) => row.cls === cls) })),
    [],
  );
  const yes = (value: boolean) => (value ? t("common.yes") : t("common.no"));
  return (
    <Card>
      <CardHeader title={t("cls.title")} hint={t("cls.hint")} spec="FR-SEC-060" />
      <div className="overflow-x-auto">
        <table className="w-full text-start text-xs">
          <caption className="sr-only">{t("cls.title")}</caption>
          <thead>
            <tr className="text-fg-subtle border-line border-b text-start">
              <th scope="col" className="py-2 pe-3 text-start font-medium">{t("cls.class")}</th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">{t("cls.controlsCol")}</th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">{t("cls.masked")}</th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">{t("cls.logged")}</th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">{t("cls.permission")}</th>
              <th scope="col" className="py-2 text-start font-medium">{t("cls.fields")}</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {byClass.map(({ cls, fields }) => (
              <tr key={cls} className="align-top">
                <td className="py-2 pe-3">
                  <ClassificationBadge cls={cls} />
                </td>
                <td className="text-fg-muted max-w-xs py-2 pe-3">{t(`cls.controls.${cls}` as ConsoleKey)}</td>
                <td className="py-2 pe-3">{yes(CLASS_CONTROLS[cls].maskByDefault)}</td>
                <td className="py-2 pe-3">{yes(CLASS_CONTROLS[cls].logged)}</td>
                <td className="py-2 pe-3 font-mono" dir="ltr">
                  {CLASS_CONTROLS[cls].permission ?? "—"}
                </td>
                <td className="py-2 font-mono" dir="ltr">
                  {fields.map((row) => row.field).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout tone="muted" className="mt-3">
        {t("cls.serverNote")}
      </Callout>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function SecurityIntro({ children }: { children: ReactNode }) {
  return (
    <Callout tone="neutral" icon={<ShieldCheck size={14} />}>
      {children}
    </Callout>
  );
}
