"use client";

/**
 * Settings — SRS §6.4, FR-PLT-025 … FR-PLT-028.
 *
 * Two different things live under this one nav entry, and the tabs keep them
 * apart:
 *
 *   - **The configuration cascade** — values that belong to the business and
 *     resolve Platform → Country pack → Tenant → Brand → Branch → Terminal.
 *     Configurator, inspector and financial versions all read the same
 *     resolver (`lib/console/settings.ts`), so they cannot disagree.
 *   - **My preferences** — language, theme and password. These belong to the
 *     person, not the business, and do not cascade.
 *
 * The till toggles that used to sit here drove the in-memory simulator
 * directly. They still do (demo mode only), under "This device", so the demo
 * keeps working — but they are labelled for what they are.
 */

import { useMemo, useState } from "react";

import type { CountryPack, Terminal } from "@/lib/console/types";
import { useI18n, usePreferences, useSession } from "@/lib/console/providers";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { services } from "@/lib/console/services";
import { useLive } from "@/lib/console/live/store";
import { branchById } from "@/lib/console/mock/org";
import { DATA_MODE } from "@/lib/api/config";
import { countryPacks } from "@/lib/console/mock/platform";
import { formatMoney, money } from "@/lib/console/format";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { TerminalLinks } from "@/components/console/live-panels";
import { ChangePasswordCard } from "@/components/console/change-password";
import { useConfirm } from "@/components/console/confirm";
import { TwoStepCard } from "@/components/console/mfa-enrol";
import {
  CascadeLegend,
  FinancialHistory,
  SettingsConfigurator,
  SettingsInspector,
  type SettingsWorld,
} from "@/components/console/settings-editor";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  DescList,
  DescRow,
  Field,
  Input,
  SegmentedControl,
  Tabs,
  Toast,
  Toggle,
} from "@/components/console/ui";

type Tab = "config" | "inspector" | "history" | "preferences";

export default function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("config");
  const [message, setMessage] = useTransientMessage();

  return (
    <>
      <PageHeader
        title={t("set.title")}
        subtitle={t("set.subtitle")}
        spec="§6.4"
        actions={<TerminalLinks />}
        meta={<CascadeLegend />}
      />

      <PageBody>
        <Tabs
          value={tab}
          onChange={setTab}
          label={t("set.title")}
          options={[
            { value: "config", label: t("cfg.tabConfig") },
            { value: "inspector", label: t("cfg.tabInspector") },
            { value: "history", label: t("cfg.tabHistory") },
            { value: "preferences", label: t("cfg.tabPreferences") },
          ]}
        />

        {tab === "preferences" ? (
          <PreferencesTab notify={setMessage} />
        ) : (
          <CascadeTabs tab={tab} notify={setMessage} />
        )}
      </PageBody>

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

function CascadeTabs({
  tab,
  notify,
}: {
  tab: Exclude<Tab, "preferences">;
  notify: (message: string) => void;
}) {
  const { tenant, scope, availableBrands, availableBranches } = useSession();

  const overrides = useAsync(() => services.settings.overrides(), []);

  // The country pack is read through the registry. Live, there is no
  // country-pack endpoint, so the country level contributes nothing and the
  // configurator says so — it never borrows the demo's packs.
  const packs = useAsync<CountryPack[]>(
    () =>
      services.platform.countryPacks
        .list({ limit: 50 })
        .then((page) => page.rows)
        .catch(() => []),
    [],
  );

  const terminals = useAsync<Terminal[]>(
    () =>
      services.operations
        .terminals({ scope: { ...scope, branchId: null }, limit: 200 })
        .then((page) => page.rows)
        .catch(() => []),
    [scope.tenantId],
  );

  const world = useMemo<SettingsWorld | null>(
    () =>
      overrides.data
        ? {
            tenant,
            brands: availableBrands,
            branches: availableBranches,
            terminals: terminals.data ?? [],
            packs: packs.data ?? [],
            overrides: overrides.data,
            reload: overrides.reload,
          }
        : null,
    [overrides.data, overrides.reload, packs.data, terminals.data, tenant, availableBrands, availableBranches],
  );

  return (
    <AsyncPanel state={{ ...overrides, data: world }}>
      {(ready) =>
        tab === "config" ? (
          <SettingsConfigurator world={ready} notify={notify} />
        ) : tab === "inspector" ? (
          <SettingsInspector world={ready} />
        ) : (
          <FinancialHistory world={ready} notify={notify} />
        )
      }
    </AsyncPanel>
  );
}

// ---------------------------------------------------------------------------
// Personal preferences, and the demo device
// ---------------------------------------------------------------------------

function PreferencesTab({ notify }: { notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { locale, setLocale, theme, setTheme, arabicIndicNumerals, setArabicIndicNumerals } =
    usePreferences();
  const { state, dispatch, reset } = useLive();
  const confirm = useConfirm();

  const settings = state.settings;

  /*
   * Everything under "This device" belongs to the in-memory simulator: the
   * till toggles patch its store, and the branch and country pack are looked
   * up in the fixtures it was seeded from. None of it describes a live
   * deployment, so live those sections are not shown at all — the business
   * settings for a live tenant are the cascade tabs.
   */
  const live = DATA_MODE === "http";

  const branch = live ? null : branchById.get(state.branchId);
  const pack = live ? null : countryPacks.find((p) => p.code === branch?.countryCode);
  const currency = branch?.currency ?? "EGP";

  const patch = (next: Partial<typeof settings>) =>
    dispatch({ type: "SET_SETTINGS", patch: next });

  return (
    <>
      <Section title={t("set.localisation")}>
        <Card>
          <div className="space-y-4">
            <Field label={t("pref.language")}>
              <SegmentedControl
                value={locale}
                onChange={setLocale}
                options={[
                  { value: "en", label: "English" },
                  { value: "ar", label: "العربية" },
                ]}
              />
            </Field>
            <Field label={t("pref.theme")}>
              <SegmentedControl
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: t("pref.light") },
                  { value: "dark", label: t("pref.dark") },
                  { value: "system", label: t("pref.system") },
                ]}
              />
            </Field>
            <Toggle
              checked={arabicIndicNumerals}
              onChange={setArabicIndicNumerals}
              label={t("pref.numerals")}
              hint={t("pref.numeralsArabic")}
            />
          </div>
        </Card>
      </Section>

      <Section title={t("set.security")}>
        <div className="space-y-4">
          <TwoStepCard notify={notify} />
          <ChangePasswordCard />
        </div>
      </Section>

      {live ? null : (
        <>
          <Callout tone="muted" title={t("cfg.deviceTitle")}>
            {t("cfg.deviceNote")}
          </Callout>

          <Section title={t("set.pos")}>
            <Card>
              <CardHeader title={t("set.posSettings")} spec="FR-POS-035" />
              <Toggle
                checked={settings.autoFire}
                onChange={(next) => patch({ autoFire: next })}
                label={t("set.autoFire")}
                hint="FR-POS-035 — fast-casual mode. Off is table-service mode, where the waiter fires each course."
              />
              <Toggle
                checked={settings.blindCount}
                onChange={(next) => patch({ blindCount: next })}
                label={t("set.blindCount")}
                hint="FR-POS-095 — a cashier who can see the expected figure can count it instead of the cash."
              />
              <Toggle
                checked={settings.staggeredRelease}
                onChange={(next) => patch({ staggeredRelease: next })}
                label={t("set.staggerRelease")}
                hint="FR-KDS-012 — hold the salad back so it does not wilt while the steak cooks."
              />
              <Toggle
                checked={settings.serviceChargeTaxable}
                onChange={(next) => patch({ serviceChargeTaxable: next })}
                label={t("orders.serviceCharge")}
                hint="FR-POS-058 — whether the country pack taxes the service charge."
              />
            </Card>
          </Section>

          <Section title={t("set.thresholds")}>
            <Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("set.discountLimit")}
                  hint="FR-POS-047 — above this a manager PIN is required."
                >
                  <Input
                    inputMode="numeric"
                    value={String(settings.discountApprovalThreshold)}
                    onChange={(e) =>
                      patch({ discountApprovalThreshold: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </Field>
                <Field
                  label={t("orders.serviceCharge")}
                  hint="FR-POS-055 — percentage, dine-in only."
                >
                  <Input
                    inputMode="numeric"
                    value={String(settings.serviceChargePercent)}
                    onChange={(e) =>
                      patch({ serviceChargePercent: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </Field>
                <Field
                  label={t("shift.drawerLimit")}
                  hint={`FR-POS-092 · ${formatMoney(money(settings.drawerLimitMinor, currency), fmt)}`}
                >
                  <Input
                    inputMode="decimal"
                    value={String(settings.drawerLimitMinor / 100)}
                    onChange={(e) =>
                      patch({
                        drawerLimitMinor: Math.max(0, Math.round(Number(e.target.value) * 100) || 0),
                      })
                    }
                  />
                </Field>
              </div>
            </Card>
          </Section>

          <Section title={t("set.general")}>
            <Card>
              <CardHeader title={tx(branch?.name)} spec="§6.4" />
              <DescList>
                <DescRow label={t("term.branch")}>{branch?.code}</DescRow>
                <DescRow label={t("cp.title")}>
                  {pack ? `${tx(pack.name)} · ${pack.version}` : "—"}
                </DescRow>
                <DescRow label={t("cp.pricingMode")}>{pack?.pricingMode ?? "—"}</DescRow>
                <DescRow label={t("cp.rounding")}>{pack?.roundingMode ?? "—"}</DescRow>
                <DescRow label={t("cp.taxEngine")}>{pack?.taxEngine ?? "—"}</DescRow>
              </DescList>
            </Card>
          </Section>

          <Section title={t("set.demo")}>
            <Card>
              <CardHeader title={t("term.reset")} hint={t("term.resetNote")} />
              <Button
                variant="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("cfg.resetDemoTitle"),
                    body: t("cfg.resetDemoBody"),
                    confirmLabel: t("term.reset"),
                    tone: "danger",
                  });
                  if (ok) reset();
                }}
              >
                {t("term.reset")}
              </Button>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}
