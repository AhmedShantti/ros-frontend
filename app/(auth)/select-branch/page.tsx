"use client";

/**
 * Select the branch to operate — FR-SEC-030.
 *
 * FRONTEND-REMOVE-DEVICE-UX-P1 — POS and KDS are application sessions with no
 * device concept at all: nothing here is registered, bound, paired, or "set
 * up". The only operational prerequisite before either is choosing which
 * authorized branch to operate (a Kitchen Station is chosen separately,
 * inside KDS itself, once signed on). This screen does exactly that and
 * nothing else: it makes one local write (the selected branch) and no
 * network call — there is no device-identity concept to register with the
 * backend.
 *
 * One flow, not two: `useSession()` already resolves live-backend vs.
 * fixture-backed `availableBranches` internally (see `lib/console/
 * providers.tsx`), and `authenticated` already reconciles against the real
 * session token when one exists. So this screen needs no branch of its own
 * for a backend vs. a demo build — a demo build just renders the same
 * branch list, sourced from fixtures instead of `GET /org`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ChefHat, Check, ScanLine } from "lucide-react";
import { useI18n, useSession } from "@/lib/console/providers";
import { setActiveBranchId } from "@/lib/api/session";
import { setReturnTo } from "@/lib/console/auth";
import { Button, Callout, Card, Field, Input, Select, Spinner } from "@/components/console/ui";

export default function SelectBranchPage() {
  const { t, tx } = useI18n();
  const router = useRouter();
  const { authenticated, branch, availableBranches, org } = useSession();

  const [branchId, setBranchId] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  // Defaults to whichever branch the console's OWN switcher is already
  // showing, when it has a real one selected — "already has an active
  // branch" from the console flows straight into this. Never overwrites a
  // choice already made on this screen.
  useEffect(() => {
    setBranchId((current) => {
      if (current && availableBranches.some((b) => b.id === current)) return current;
      return branch?.id ?? availableBranches[0]?.id ?? "";
    });
  }, [branch, availableBranches]);

  function confirm(chosen: { id: string; name: { en: string; ar: string } }) {
    // A local write only — there is nothing to register this against.
    setActiveBranchId(chosen.id);
    setSelected({ id: chosen.id, name: tx(chosen.name) });
  }

  // Exactly one authorized branch: proceed without making someone choose it
  // — the same shortcut `signIn()` already takes for a single-tenant account.
  useEffect(() => {
    if (selected || org.loading || availableBranches.length !== 1) return;
    confirm(availableBranches[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableBranches, org.loading, selected]);

  if (!authenticated) {
    return (
      <Card className="ros-fade-in">
        <h1 className="text-fg text-lg font-semibold">{t("branch.selectTitle")}</h1>
        <Callout tone="warn" className="mt-3">
          {t("branch.needsSession")}
        </Callout>
        <Button
          variant="primary"
          className="mt-4 w-full"
          onClick={() => {
            setReturnTo("/select-branch");
            router.push("/login");
          }}
        >
          {t("auth.signIn")}
        </Button>
      </Card>
    );
  }

  if (selected) {
    return <BranchSelected name={selected.name} />;
  }

  return (
    <Card className="ros-fade-in">
      <h1 className="text-fg text-lg font-semibold">{t("branch.selectTitle")}</h1>
      <p className="text-fg-muted mt-1.5 text-xs leading-relaxed">{t("branch.selectLede")}</p>

      {org.error ? (
        <Callout tone="bad" className="mt-4">
          {org.error.message}
        </Callout>
      ) : null}

      {org.loading && availableBranches.length === 0 ? (
        <div className="text-fg-subtle mt-5 flex items-center gap-2 text-xs">
          <Spinner size={14} />
          {t("state.loading")}
        </div>
      ) : availableBranches.length === 0 ? (
        <Callout tone="muted" className="mt-4">
          {t("branch.noneAvailable")}
        </Callout>
      ) : (
        <div className="mt-4">
          <Field label={t("term.branch")} required>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {availableBranches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)} · {row.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!branchId}
        icon={<Check size={14} />}
        onClick={() => {
          const chosen = availableBranches.find((row) => row.id === branchId);
          if (chosen) confirm(chosen);
        }}
      >
        {t("branch.confirmSelection")}
      </Button>

      <Link
        href="/login"
        className="text-fg-muted hover:text-fg mt-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} className="rtl:rotate-180" aria-hidden />
        {t("auth.backToSignIn")}
      </Link>
    </Card>
  );
}

/**
 * A branch is now selected — the only confirmation this flow needs. No
 * device identifier is shown: for normal production use there is no
 * established reason to surface a raw branch UUID, only the name a manager
 * already recognises.
 */
function BranchSelected({ name }: { name: string }) {
  const { t } = useI18n();

  return (
    <Card className="ros-fade-in">
      <div className="text-good flex items-center gap-2">
        <Building2 size={18} aria-hidden />
        <h1 className="text-fg text-lg font-semibold">{t("branch.selected")}</h1>
      </div>
      <p className="text-fg-muted mt-2 text-xs leading-relaxed">{t("branch.selectedBody")}</p>

      <div className="mt-4">
        <Field label={t("term.branch")}>
          <Input readOnly value={name} dir="auto" />
        </Field>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Button
          variant="primary"
          className="w-full"
          icon={<ScanLine size={14} />}
          onClick={() => {
            window.location.href = "/pos";
          }}
        >
          {t("branch.openPos")}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          icon={<ChefHat size={14} />}
          onClick={() => {
            window.location.href = "/kds";
          }}
        >
          {t("branch.openKds")}
        </Button>
        <Link
          href="/login"
          className="text-fg-muted hover:text-fg inline-flex items-center justify-center gap-1.5 py-1 text-xs transition-colors"
        >
          <ArrowLeft size={12} className="rtl:rotate-180" aria-hidden />
          {t("auth.backToSignIn")}
        </Link>
      </div>
    </Card>
  );
}
