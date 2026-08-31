"use client";

/**
 * Settings — SRS ch.6.4.
 *
 * These are not decorative. Every switch here changes how the terminals
 * behave on the next order: whether a line fires on entry, whether the shift
 * close hides the expected figure, what a cashier may discount before a
 * manager is called.
 */

import { useI18n, usePreferences } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { branchById } from "@/lib/console/mock/org";
import { DATA_MODE } from "@/lib/api/config";
import { UnsupportedPanel } from "@/components/console/states";
import { countryPacks } from "@/lib/console/mock/platform";
import { formatMoney, money } from "@/lib/console/format";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { TerminalLinks } from "@/components/console/live-panels";
import { ChangePasswordCard } from "@/components/console/change-password";
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
  Toggle,
} from "@/components/console/ui";

export default function SettingsPage() {
  const { t, tx, fmt } = useI18n();
  const { locale, setLocale, theme, setTheme, arabicIndicNumerals, setArabicIndicNumerals } =
    usePreferences();
  const { state, dispatch, reset } = useLive();

  const settings = state.settings;

  /*
   * Everything below the language and theme controls belongs to the
   * in-memory simulator: the till toggles patch its store, and the branch
   * and country pack are looked up in the fixtures it was seeded from.
   *
   * None of it describes a live deployment. There is no tenant-settings
   * endpoint to write those toggles to, and no country-pack endpoint to
   * read the branch's rounding and tax engine from — so live, those
   * sections say they are unavailable rather than showing a branch's name
   * and tax rules that came from a demo dataset.
   */
  const live = DATA_MODE === "http";

  const branch = live ? null : branchById.get(state.branchId);
  const pack = live ? null : countryPacks.find((p) => p.code === branch?.countryCode);
  const currency = branch?.currency ?? "EGP";

  const patch = (next: Partial<typeof settings>) =>
    dispatch({ type: "SET_SETTINGS", patch: next });

  return (
    <>
      <PageHeader
        title={t("set.title")}
        subtitle={t("set.subtitle")}
        spec="§6.4"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <Callout tone="accent" title={t("set.cascade")}>
          {t("set.cascadeNote")}
        </Callout>

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

        <Section title={t("set.pos")}>
          {live ? (
            <UnsupportedPanel detail="No tenant-settings endpoint exists in api/openapi.json — these toggles would write nowhere." />
          ) : (
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
          )}
        </Section>

        {/* Also the simulator's: a threshold here is enforced by the local
            engine, and the server has no field to store it in. */}
        <Section title={t("set.thresholds")}>
          {live ? (
            <UnsupportedPanel detail="No tenant-settings endpoint exists in api/openapi.json — these limits would write nowhere." />
          ) : (
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
          )}
        </Section>

        <Section title={t("set.general")}>
          {live ? (
            <UnsupportedPanel detail="No country-pack endpoint exists in api/openapi.json." />
          ) : (
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
          )}
        </Section>

        <Section title={t("set.security")}>
          <ChangePasswordCard />
        </Section>

        {/* Resets the demo dataset. There is nothing local to reset when
            the data belongs to a server. */}
        {live ? null : (
          <Section title={t("set.demo")}>
            <Card>
              <CardHeader title={t("term.reset")} hint={t("term.resetNote")} />
              <Button variant="danger" onClick={reset}>
                {t("term.reset")}
              </Button>
            </Card>
          </Section>
        )}
      </PageBody>
    </>
  );
}
