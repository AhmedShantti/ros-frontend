"use client";

/**
 * Two-step verification: status, enrolment and the per-role requirement —
 * FR-SEC-023, FR-SEC-024.
 *
 * Enrolment is a short wizard because each step exists to stop a specific
 * lock-out:
 *
 *   1. Scan — the QR code, with the key written out for a phone that cannot
 *      scan.
 *   2. Confirm — a code from the app, checked, so a mis-scanned secret is
 *      caught now and not at the next sign-in.
 *   3. Recovery — ten single-use codes, shown once, with an explicit "I have
 *      saved these" before the wizard lets go. A lost phone without them is
 *      a support ticket and an identity check.
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";

import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate } from "@/lib/console/format";
import { roleRequiresMfa } from "@/lib/console/permissions";
import { SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import { encodeQr, qrSvgPath } from "@/lib/console/qr";
import { groupSecret, newSecret, otpauthUri } from "@/lib/console/totp";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Modal, cx } from "@/components/console/ui";

const ISSUER = "TRENDOW ROS";

function useAccount(): string | null {
  const { session } = useSession();
  return session?.user.email ?? null;
}

/** Whether this person's role, or the tenant, requires the second step. */
export function useMfaRequired(): boolean {
  const { roleKey, tenant } = useSession();
  const overrides = useAsync(() => services.settings.overrides().catch(() => []), []);
  const managers = useMemo(() => {
    const resolved = resolveSetting(SETTING_BY_KEY.get("sec.mfaForManagers")!, overrides.data ?? [], {
      countryCode: tenant.countryCode,
      tenantId: tenant.id,
      brandId: null,
      branchId: null,
      terminalId: null,
    });
    return Boolean(resolved.value);
  }, [overrides.data, tenant]);
  const managerRole = ["owner", "operations_director", "brand_manager", "branch_manager", "franchisee"].includes(roleKey);
  return roleRequiresMfa(roleKey) || (managers && managerRole);
}

// ---------------------------------------------------------------------------

function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrSvgPath(encodeQr(text)), [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="h-52 w-52 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <ol className="border-line bg-sunken/50 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border p-3 font-mono text-sm" dir="ltr">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <Button
        size="sm"
        variant="ghost"
        icon={<Copy size={12} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t("mfa.copied") : t("mfa.copyCodes")}
      </Button>
    </div>
  );
}

export function EnrolWizard({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const action = useAction();
  const [secret] = useState(() => newSecret());
  const [step, setStep] = useState<"scan" | "confirm" | "recovery">("scan");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const uri = otpauthUri({ issuer: ISSUER, account: account ?? "account", secret });

  async function confirm() {
    if (!account) return;
    await action.run(() => services.mfa.confirm(account, secret, code), {
      onSuccess: (recovery) => {
        setCodes(recovery);
        setStep("recovery");
      },
    });
  }

  return (
    <Modal
      open
      onClose={step === "recovery" && !saved ? () => undefined : onClose}
      title={t("mfa.enrolTitle")}
      footer={
        step === "scan" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => setStep("confirm")}>
              {t("mfa.scanned")}
            </Button>
          </>
        ) : step === "confirm" ? (
          <>
            <Button variant="ghost" onClick={() => setStep("scan")}>
              {t("common.back")}
            </Button>
            <Button variant="primary" loading={action.pending} disabled={!/^\d{6}$/.test(code)} onClick={confirm}>
              {t("mfa.verify")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={!saved}
            onClick={() => {
              onDone(t("mfa.enrolled"));
              onClose();
            }}
          >
            {t("mfa.finish")}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <ol className="text-fg-subtle flex gap-3 text-xs">
          {(["scan", "confirm", "recovery"] as const).map((id, index) => (
            <li key={id} className={cx(step === id && "text-accent font-semibold")}>
              {index + 1}. {t(`mfa.step.${id}`)}
            </li>
          ))}
        </ol>

        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        {step === "scan" ? (
          <div className="space-y-4">
            <p className="text-fg-muted text-sm">{t("mfa.scanBody")}</p>
            <div className="flex justify-center">
              <QrCode text={uri} label={t("mfa.qrLabel")} />
            </div>
            <Field label={t("mfa.manualKey")} hint={t("mfa.manualKeyHint")}>
              <p className="border-line bg-sunken/50 rounded-lg border px-3 py-2 font-mono text-sm tracking-wider break-all" dir="ltr">
                {groupSecret(secret)}
              </p>
            </Field>
          </div>
        ) : step === "confirm" ? (
          <div className="space-y-3">
            <p className="text-fg-muted text-sm">{t("mfa.confirmBody")}</p>
            <Input
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && /^\d{6}$/.test(code)) void confirm();
              }}
              className="text-center font-mono text-2xl tracking-[0.5em]"
              aria-label={t("mfa.code")}
              data-autofocus
            />
          </div>
        ) : (
          <div className="space-y-3">
            <Callout tone="warn" title={t("mfa.recoveryTitle")}>
              {t("mfa.recoveryBody")}
            </Callout>
            <RecoveryCodes codes={codes} />
            <label className="text-fg flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="accent-accent" />
              {t("mfa.savedThem")}
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A code, for any action that needs the second factor re-proved. */
function CodePrompt({
  title,
  body,
  confirmLabel,
  tone,
  onSubmit,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "danger" | "primary";
  onSubmit: (code: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [code, setCode] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={action.pending}
            disabled={code.trim().length < 6}
            onClick={() => void action.run(() => onSubmit(code), {})}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <p className="text-fg-muted text-sm">{body}</p>
        <Input
          dir="ltr"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456 / abcd-efgh"
          className="text-center font-mono text-lg"
          aria-label={t("mfa.code")}
          data-autofocus
        />
      </div>
    </Modal>
  );
}

export function TwoStepCard({ notify }: { notify: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const account = useAccount();
  const required = useMfaRequired();
  const confirm = useConfirm();
  const status = useAsync(
    () => (account ? services.mfa.status(account) : Promise.resolve(null)),
    [account],
  );
  const [enrolling, setEnrolling] = useState(false);
  const [prompt, setPrompt] = useState<"remove" | "regenerate" | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);

  const enrolled = status.data?.enrolled ?? false;

  return (
    <Card>
      <CardHeader
        title={t("mfa.title")}
        hint={t("mfa.hint")}
        spec="FR-SEC-023"
        action={
          enrolled ? (
            <Badge tone="good" dot>
              {t("mfa.on")}
            </Badge>
          ) : (
            <Badge tone={required ? "warn" : "muted"}>{required ? t("mfa.required") : t("mfa.off")}</Badge>
          )
        }
      />

      {!account ? (
        <Callout tone="muted">{t("mfa.noAccount")}</Callout>
      ) : enrolled ? (
        <div className="space-y-3">
          <p className="text-fg-muted flex items-center gap-2 text-sm">
            <Smartphone size={14} aria-hidden />
            {t("mfa.since").replace("{date}", formatDate(status.data!.enrolledAt, fmt))}
          </p>
          <p className="text-fg-muted flex items-center gap-2 text-sm">
            <KeyRound size={14} aria-hidden />
            {t("mfa.recoveryLeft").replace("{n}", String(status.data!.recoveryRemaining))}
          </p>
          {status.data!.recoveryRemaining <= 2 ? <Callout tone="warn">{t("mfa.recoveryLow")}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setPrompt("regenerate")}>
              {t("mfa.newCodes")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (required) {
                  const ok = await confirm({
                    title: t("mfa.removeRequiredTitle"),
                    body: t("mfa.removeRequiredBody"),
                    confirmLabel: t("mfa.removeAnyway"),
                    tone: "danger",
                  });
                  if (!ok) return;
                }
                setPrompt("remove");
              }}
            >
              {t("mfa.turnOff")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {required ? <Callout tone="warn">{t("mfa.requiredBody")}</Callout> : null}
          <Button variant="primary" icon={<ShieldCheck size={14} />} onClick={() => setEnrolling(true)}>
            {t("mfa.setUp")}
          </Button>
        </div>
      )}

      <p className="text-fg-subtle mt-3 text-[0.68rem] leading-relaxed">{t("mfa.localNote")}</p>

      {enrolling ? (
        <EnrolWizard
          onClose={() => setEnrolling(false)}
          onDone={(message) => {
            notify(message);
            status.reload();
          }}
        />
      ) : null}

      {prompt && account ? (
        <CodePrompt
          title={prompt === "remove" ? t("mfa.turnOff") : t("mfa.newCodes")}
          body={prompt === "remove" ? t("mfa.removeBody") : t("mfa.regenerateBody")}
          confirmLabel={prompt === "remove" ? t("mfa.turnOff") : t("mfa.newCodes")}
          tone={prompt === "remove" ? "danger" : "primary"}
          onClose={() => setPrompt(null)}
          onSubmit={async (code) => {
            if (prompt === "remove") {
              await services.mfa.remove(account, code);
              notify(t("mfa.removed"));
            } else {
              setFreshCodes(await services.mfa.regenerateRecovery(account, code));
            }
            setPrompt(null);
            status.reload();
          }}
        />
      ) : null}

      {freshCodes ? (
        <Modal
          open
          onClose={() => setFreshCodes(null)}
          title={t("mfa.newCodes")}
          footer={
            <Button variant="primary" onClick={() => setFreshCodes(null)}>
              {t("mfa.finish")}
            </Button>
          }
        >
          <div className="space-y-3">
            <Callout tone="warn">{t("mfa.oldCodesDead")}</Callout>
            <RecoveryCodes codes={freshCodes} />
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

/**
 * FR-SEC-024 — the role requires the second step and this person has not set
 * it up. Shown on every console page until they do; dismissing it only hides
 * it for this visit.
 */
export function MfaRequiredBanner() {
  const { t } = useI18n();
  const account = useAccount();
  const required = useMfaRequired();
  const [hidden, setHidden] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const status = useAsync(
    () => (account && required ? services.mfa.status(account) : Promise.resolve(null)),
    [account, required],
  );
  const [done, setDone] = useState(false);

  useEffect(() => setHidden(false), [account]);

  if (!required || hidden || done || !status.data || status.data.enrolled) return null;

  return (
    <div className="mb-4">
      <Callout tone="warn" icon={<ShieldAlert size={14} />} title={t("mfa.bannerTitle")}>
        <span>{t("mfa.bannerBody")}</span>
        <span className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={() => setEnrolling(true)}>
            {t("mfa.setUp")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
            {t("mfa.later")}
          </Button>
        </span>
      </Callout>
      {enrolling ? (
        <EnrolWizard onClose={() => setEnrolling(false)} onDone={() => setDone(true)} />
      ) : null}
    </div>
  );
}
