"use client";

/**
 * Close-at-terminal handoff — DEMO-MANAGER-CASH-SESSIONS-FRONTEND-P0.
 *
 * The other half of Operations -> Open Cash Sessions. A dashboard/Console
 * token cannot perform the POS-only close workflow (close-context / close /
 * close/finalize) — the backend refuses a non-`typ: 'pos'` bearer on those
 * routes outright — so the Console hands off only a `sessionId` and some
 * display-only context via the URL, and everything that actually decides
 * anything happens here, on this surface's own PIN-scoped token
 * (`(terminal)/layout.tsx`'s `ConsoleProvider surface="terminal"` already
 * keeps this device's identity in a storage slot the Console never touches —
 * see `lib/api/session.ts`'s `DEMO-SESSION-ISOLATION-HOTFIX` block).
 *
 * `ManagerSignOn` below always asks for a PIN, even if this till already has
 * someone signed on: a stray Cashier session left open on a shared terminal
 * must never be reused to close a drawer that is not theirs, and a manager
 * closing someone else's shift is a deliberate act, not an ambient one.
 * Neither the sessionId nor the branch/employee names carried in the URL are
 * ever treated as authority — `DrawerSheet` re-reads the session fresh from
 * `close-context` under whichever PIN identity just signed on, and the
 * server is what actually decides whether that identity may act on it
 * (`cash.session.close_other`, `cash.variance.approve` on finalize). This
 * screen reuses `DrawerSheet` unmodified — the count, the blind-reveal, the
 * variance display and the manager-PIN approval are the SAME implementation
 * an employee closing their own shift gets, never a second one.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/console/providers";
import { useAction } from "@/lib/console/actions";
import {
  getDeviceTenantId,
  getPosEmployee,
  getTerminalId,
  setPosEmployee,
  type PosEmployee,
} from "@/lib/api/session";
import { signInWithPin } from "@/lib/api/auth";
import { TerminalBar } from "@/components/terminal/chrome";
import { DrawerSheet } from "@/components/terminal/pos-drawer";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Field,
  Input,
  Spinner,
  Toast,
} from "@/components/console/ui";

export default function CloseSessionPage() {
  return (
    <>
      <TerminalBar />
      {/* `useSearchParams` suspends during prerender; the boundary keeps the
          route statically renderable instead of forcing it dynamic. */}
      <Suspense
        fallback={
          <div className="text-fg-muted flex flex-1 items-center justify-center p-8 text-sm">
            <Spinner />
          </div>
        }
      >
        <CloseSessionScreen />
      </Suspense>
    </>
  );
}

function CloseSessionScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const sessionId = searchParams.get("sessionId") ?? "";
  const employeeName = searchParams.get("employee") ?? "";
  const drawerName = searchParams.get("drawer") ?? "";
  const branchName = searchParams.get("branch") ?? "";

  const [manager, setManager] = useState<PosEmployee | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Both the terminal binding and any previously-signed-on identity live in
  // `localStorage`, invisible to the server render — nothing is decided
  // until after mount, same as `LivePos`.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!sessionId) {
    return (
      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto p-4">
        <Callout tone="bad">{t("state.notFoundBody")}</Callout>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 p-8 text-sm">
        <Spinner /> {t("term.loading")}
      </div>
    );
  }

  const terminalId = getTerminalId();

  if (!terminalId) {
    return (
      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto p-4">
        <Card>
          <CardHeader title={t("pos.noTerminal")} spec="FR-SEC-030" />
          <Callout tone="warn">{t("pos.noTerminalNote")}</Callout>
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => {
              window.location.href = "/register-device";
            }}
          >
            {t("auth.deviceTitle")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-md space-y-3 p-4">
        <Card>
          <CardHeader title={t("shift.targetSession")} hint={t("shift.targetSessionNote")} />
          <DescList>
            <DescRow label={t("cashSessions.employee")}>{employeeName || "—"}</DescRow>
            <DescRow label={t("fin.drawer")}>{drawerName || "—"}</DescRow>
            <DescRow label={t("common.branch")}>{branchName || "—"}</DescRow>
          </DescList>
        </Card>

        {manager ? (
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-fg-subtle text-xs">
              {t("shift.managerCode")}: {manager.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPosEmployee(null);
                setManager(null);
              }}
            >
              {t("shift.switchEmployee")}
            </Button>
          </div>
        ) : null}

        {manager ? (
          <DrawerSheet
            open
            cashSessionId={sessionId}
            cashierName={employeeName || undefined}
            onClose={() => {
              // Never leave the manager signed on to a shared till, whether
              // this ends in a close or a cancel — the next person to walk
              // up gets a sign-on screen, not this manager's identity.
              setPosEmployee(null);
              router.push("/operations/cash-sessions");
            }}
            onMessage={setMessage}
            onClosed={() => {
              setPosEmployee(null);
              router.push("/operations/cash-sessions");
            }}
          />
        ) : (
          <ManagerSignOn
            terminalId={terminalId}
            onSignedOn={(employee) => {
              setManager(employee);
              setMessage(t("shift.signedOn"));
            }}
          />
        )}

        <Toast message={message} />
      </div>
    </div>
  );
}

/**
 * Always a fresh sign-on — never `getPosEmployee()` from a prior visit.
 *
 * This is deliberately its own small form rather than a shared export of
 * `pos-live.tsx`'s cashier sign-on: same underlying call
 * (`signInWithPin`), but this copy says plainly that it wants the
 * *manager's* own code and PIN, not whichever cashier last used this till.
 */
function ManagerSignOn({
  terminalId,
  onSignedOn,
}: {
  terminalId: string;
  onSignedOn: (employee: PosEmployee) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");

  const tenantId = getDeviceTenantId();
  const valid = employeeCode.trim() !== "" && /^[0-9]{4,8}$/.test(pin) && Boolean(tenantId);

  async function signOn() {
    if (!valid || !tenantId) return;
    const code = employeeCode.trim();
    await action.run(
      async () => {
        await signInWithPin({ tenantId, terminalId, employeeCode: code, pin });
        return getPosEmployee() ?? { code, name: code };
      },
      {
        onSuccess: (employee) => {
          // Never leave a manager's PIN sitting in a field on a shared till.
          setPin("");
          onSignedOn(employee);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader title={t("shift.closeOtherTitle")} hint={t("shift.closeOtherNote")} />

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {tenantId ? null : <Callout tone="warn">{t("shift.signOnNoTenant")}</Callout>}

      <div className="mt-4 space-y-4">
        <Field label={t("shift.managerCode")} required>
          <Input
            dir="ltr"
            autoComplete="off"
            value={employeeCode}
            onChange={(event) => setEmployeeCode(event.target.value)}
          />
        </Field>

        <Field label={t("shift.managerPin")} hint={t("shift.pinHint")} required>
          <Input
            type="password"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          loading={action.pending}
          disabled={!valid}
          onClick={signOn}
        >
          {t("shift.signOn")}
        </Button>
      </div>
    </Card>
  );
}
