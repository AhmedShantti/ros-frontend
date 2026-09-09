"use client";

/**
 * Loyalty programme — SRS §18.3.
 *
 * Two models, and they are genuinely different products rather than a
 * setting: points suit a restaurant with a wide basket and variable spend,
 * stamps suit a café selling one thing repeatedly. Offering both and making
 * the choice explicit is cheaper than pretending a stamp card is a points
 * scheme with the rate set to one.
 *
 * The offline redemption cap (FR-CRM-021) is the setting operators skip and
 * then regret. Offline accrual is safe — points are added and reconciled on
 * sync. Offline *redemption* is a spend against a balance the terminal
 * cannot verify, so it is bounded, the overdraw is accepted, and it is
 * reported. Setting the cap to zero is a legitimate answer; not knowing the
 * setting exists is not.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { LoyaltyProgramme, LoyaltyTier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatMoney, money } from "@/lib/console/format";
import { AsyncPanel, Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField, MoneyInput } from "@/components/console/fields";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  SegmentedControl,
  Toast,
  Toggle,
  cx,
} from "@/components/console/ui";

export default function LoyaltyPage() {
  return (
    <Gate permissions={["crm.loyalty.view"]}>
      <LoyaltyScreen />
    </Gate>
  );
}

function LoyaltyScreen() {
  const { t } = useI18n();
  const state = useAsync<LoyaltyProgramme>(() => services.crm.loyalty.programme(), []);

  return (
    <>
      <PageHeader title={t("loy.title")} subtitle={t("loy.subtitle")} spec="§18.3" />
      <PageBody>
        <AsyncPanel state={state}>
          {(programme) => <ProgrammeForm initial={programme} onReload={state.reload} />}
        </AsyncPanel>
      </PageBody>
    </>
  );
}

function ProgrammeForm({
  initial,
  onReload,
}: {
  initial: LoyaltyProgramme;
  onReload: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();
  const confirm = useConfirm();
  const canManage = usePermission("crm.loyalty.manage");
  const [message, setMessage] = useTransientMessage();

  const [draft, setDraft] = useState<LoyaltyProgramme>(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(initial);
    setDirty(false);
  }, [initial]);

  function patch(part: Partial<LoyaltyProgramme>) {
    setDraft((current) => ({ ...current, ...part }));
    setDirty(true);
  }

  function patchTier(id: string, part: Partial<LoyaltyTier>) {
    patch({
      tiers: draft.tiers.map((tier) => (tier.id === id ? { ...tier, ...part } : tier)),
    });
  }

  async function removeTier(id: string) {
    const tier = draft.tiers.find((row) => row.id === id);
    const ok = await confirm({
      title: t("loy.removeTier"),
      body: t("loy.removeTierBody").replace("{name}", tier ? tx(tier.name) : ""),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    patch({ tiers: draft.tiers.filter((row) => row.id !== id) });
  }

  function addTier() {
    const highest = draft.tiers.reduce((max, tier) => Math.max(max, tier.thresholdPoints), 0);
    patch({
      tiers: [
        ...draft.tiers,
        {
          id: `tier_${Date.now().toString(36)}`,
          name: { ...EMPTY_LOCALISED },
          thresholdPoints: highest + 250,
          benefits: { ...EMPTY_LOCALISED },
          colour: "#0f766e",
        },
      ],
    });
  }

  const sortedTiers = [...draft.tiers].sort((a, b) => a.thresholdPoints - b.thresholdPoints);
  const duplicateThreshold = sortedTiers.some(
    (tier, index) => index > 0 && tier.thresholdPoints === sortedTiers[index - 1]!.thresholdPoints,
  );

  async function save() {
    if (duplicateThreshold) return;
    await action.run(() => services.crm.loyalty.saveProgramme(draft), {
      onSuccess: () => {
        setDirty(false);
        setMessage(t("loy.saved"));
        onReload();
      },
    });
  }

  return (
    <>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Section title={t("loy.programme")} spec="FR-CRM-015">
        <div className="space-y-4">
          <Toggle
            checked={draft.enabled}
            disabled={!canManage}
            onChange={(enabled) => patch({ enabled })}
            label={t("loy.enabled")}
            hint={t("loy.enabledHint")}
          />

          <Field label={t("loy.model")} hint={t("loy.modelHint")}>
            <SegmentedControl
              value={draft.model}
              onChange={(model) => patch({ model })}
              options={[
                { value: "points" as const, label: t("loy.modelPoints") },
                { value: "stamps" as const, label: t("loy.modelStamps") },
              ]}
            />
          </Field>

          {draft.model === "points" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("loy.earnRate")} hint={t("loy.earnRateHint")}>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!canManage}
                    value={String(draft.earnRatePerUnit)}
                    onChange={(event) =>
                      patch({ earnRatePerUnit: Number(event.target.value) || 0 })
                    }
                    className="text-end font-mono tabular-nums"
                  />
                </Field>
                <Field label={t("loy.redeemValue")} hint={t("loy.redeemValueHint")}>
                  <MoneyInput
                    value={draft.redeemValueMinor}
                    currency="EGP"
                    disabled={!canManage}
                    onChange={(minor) => patch({ redeemValueMinor: minor ?? 0 })}
                    aria-label={t("loy.redeemValue")}
                  />
                </Field>
              </div>

              <Callout tone="muted">
                {t("loy.worked")
                  .replace("{points}", String(draft.earnRatePerUnit * 100))
                  .replace(
                    "{value}",
                    formatMoney(money(draft.earnRatePerUnit * 100 * draft.redeemValueMinor, "EGP"), fmt),
                  )}
              </Callout>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("loy.expiry")} hint={t("loy.expiryHint")}>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    disabled={!canManage}
                    value={draft.expiryMonths === null ? "" : String(draft.expiryMonths)}
                    placeholder={t("common.never")}
                    onChange={(event) =>
                      patch({
                        expiryMonths: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    className="text-end font-mono tabular-nums"
                  />
                </Field>
                <Field label={t("loy.offlineCap")} hint={t("loy.offlineCapHint")}>
                  <MoneyInput
                    value={draft.offlineRedemptionCapMinor}
                    currency="EGP"
                    disabled={!canManage}
                    onChange={(minor) => patch({ offlineRedemptionCapMinor: minor ?? 0 })}
                    aria-label={t("loy.offlineCap")}
                  />
                </Field>
              </div>

              <Toggle
                checked={draft.excludeTax}
                disabled={!canManage}
                onChange={(excludeTax) => patch({ excludeTax })}
                label={t("loy.excludeTax")}
                hint={t("loy.excludeTaxHint")}
              />
              <Toggle
                checked={draft.excludeDiscountedLines}
                disabled={!canManage}
                onChange={(excludeDiscountedLines) => patch({ excludeDiscountedLines })}
                label={t("loy.excludeDiscounted")}
                hint={t("loy.excludeDiscountedHint")}
              />
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("loy.stampsRequired")} hint={t("loy.stampsRequiredHint")}>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  disabled={!canManage}
                  value={String(draft.stampsRequired)}
                  onChange={(event) => patch({ stampsRequired: Number(event.target.value) || 0 })}
                  className="text-end font-mono tabular-nums"
                />
              </Field>
            </div>
          )}
        </div>
      </Section>

      {draft.model === "points" ? (
        <Section
          title={t("loy.tiers")}
          hint={t("loy.tiersHint")}
          spec="FR-CRM-018"
          action={
            canManage ? (
              <Button size="sm" icon={<Plus size={12} />} onClick={addTier}>
                {t("loy.addTier")}
              </Button>
            ) : null
          }
        >
          {duplicateThreshold ? (
            <Callout tone="bad">{t("loy.duplicateThreshold")}</Callout>
          ) : null}

          {sortedTiers.length === 0 ? (
            <Callout tone="muted">{t("loy.noTiers")}</Callout>
          ) : (
            <ul className="space-y-3">
              {sortedTiers.map((tier) => (
                <li key={tier.id} className="border-line rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-2 h-4 w-4 shrink-0 rounded-full"
                      style={{ background: tier.colour }}
                    />
                    <div className="min-w-0 flex-1 space-y-3">
                      <LocalisedField
                        label={t("loy.tierName")}
                        required
                        value={tier.name}
                        onChange={(name) => patchTier(tier.id, { name })}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t("loy.threshold")} hint={t("loy.thresholdHint")}>
                          <Input
                            dir="ltr"
                            inputMode="numeric"
                            disabled={!canManage}
                            value={String(tier.thresholdPoints)}
                            onChange={(event) =>
                              patchTier(tier.id, {
                                thresholdPoints: Number(event.target.value) || 0,
                              })
                            }
                            className="text-end font-mono tabular-nums"
                          />
                        </Field>
                        <Field label={t("loy.colour")}>
                          <Input
                            dir="ltr"
                            disabled={!canManage}
                            value={tier.colour}
                            onChange={(event) => patchTier(tier.id, { colour: event.target.value })}
                            className="font-mono"
                          />
                        </Field>
                      </div>
                      <LocalisedField
                        label={t("loy.benefits")}
                        hint={t("loy.benefitsHint")}
                        multiline
                        value={tier.benefits}
                        onChange={(benefits) => patchTier(tier.id, { benefits })}
                      />
                    </div>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.delete")}
                        icon={<Trash2 size={13} />}
                        onClick={() => void removeTier(tier.id)}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!dirty || duplicateThreshold}
            onClick={save}
          >
            {t("common.save")}
          </Button>
          {dirty ? <Badge tone="warn">{t("common.unsavedChanges")}</Badge> : null}
        </div>
      ) : null}

      <Toast message={message} />
    </>
  );
}
