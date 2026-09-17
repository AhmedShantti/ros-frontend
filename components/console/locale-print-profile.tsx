"use client";

/**
 * FR-LOC-011 — Arabic font selection for thermal receipts and kitchen displays.
 */

import { useEffect, useState } from "react";

import { ARABIC_FONTS, kdsMinimumPx, type PrintProfile } from "@/lib/console/locale-packs";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import { Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { Badge, Button, Callout, Field, Input, Select } from "@/components/console/ui";

export function fontById(id: string) {
  return ARABIC_FONTS.find((font) => font.id === id) ?? ARABIC_FONTS[0]!;
}

export function usePrintProfile() {
  return useAsync(() => services.localisation.printProfile(), []);
}

export function PrintProfilePanel({
  state,
  onSaved,
}: {
  state: ReturnType<typeof usePrintProfile>;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Section title={t("lpk.print.profileTitle")} hint={t("lpk.print.profileHint")} spec="FR-LOC-011">
      <AsyncPanel state={state}>{(profile) => <ProfileForm profile={profile} onSaved={(message) => { state.reload(); onSaved(message); }} />}</AsyncPanel>
    </Section>
  );
}

function ProfileForm({ profile, onSaved }: { profile: PrintProfile; onSaved: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const action = useAction();
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);

  const receiptFont = fontById(draft.arabicFontId);
  const kdsFont = fontById(draft.kdsFontId);
  const floor = kdsMinimumPx(2, 10);
  const comfortable = kdsMinimumPx(2, 16);
  const tooSmallReceipt = draft.receiptSizeDots < receiptFont.minDots;
  const tooSmallKds = draft.kdsSizePx < floor;

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-fg text-sm font-semibold">{t("lpk.print.receiptFont")}</h4>
          <Field label={t("lpk.print.font")} hint={receiptFont.note}>
            <Select value={draft.arabicFontId} onChange={(event) => setDraft({ ...draft, arabicFontId: event.target.value })}>
              {ARABIC_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("lpk.print.sizeDots")}
            hint={t("lpk.print.minDots").replace("{n}", formatNumber(receiptFont.minDots, fmt))}
            error={tooSmallReceipt ? t("lpk.print.belowMin") : null}
          >
            <Input
              dir="ltr"
              inputMode="numeric"
              className="w-28 font-mono"
              value={String(draft.receiptSizeDots)}
              onChange={(event) => setDraft({ ...draft, receiptSizeDots: Number(event.target.value) || 0 })}
            />
          </Field>
          <div className="rounded-md bg-white p-3 text-black" dir="rtl" style={{ fontFamily: receiptFont.stack, fontSize: `${(draft.receiptSizeDots * 0.75).toFixed(1)}px` }}>
            شاورما دجاج ×٢ — بدون بصل — ثوم إضافي
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-fg text-sm font-semibold">{t("lpk.print.kdsFont")}</h4>
          <Field label={t("lpk.print.font")} hint={kdsFont.note}>
            <Select value={draft.kdsFontId} onChange={(event) => setDraft({ ...draft, kdsFontId: event.target.value })}>
              {ARABIC_FONTS.filter((font) => font.id !== "printer_cp864").map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("lpk.print.sizePx")}
            hint={t("lpk.print.kdsGuide").replace("{floor}", String(floor)).replace("{comfortable}", String(comfortable))}
            error={tooSmallKds ? t("lpk.print.kdsBelowFloor").replace("{floor}", String(floor)) : null}
          >
            <Input
              dir="ltr"
              inputMode="numeric"
              className="w-28 font-mono"
              value={String(draft.kdsSizePx)}
              onChange={(event) => setDraft({ ...draft, kdsSizePx: Number(event.target.value) || 0 })}
            />
          </Field>
          <div className="flex flex-wrap gap-1">
            <Badge tone={draft.kdsSizePx >= comfortable ? "good" : draft.kdsSizePx >= floor ? "warn" : "bad"}>
              {draft.kdsSizePx >= comfortable ? t("lpk.print.kdsComfortable") : draft.kdsSizePx >= floor ? t("lpk.print.kdsFloor") : t("lpk.print.kdsTooSmall")}
            </Badge>
          </div>
        </div>
      </div>

      {/* A KDS ticket at the chosen size — the thing a cook reads from 2 m. */}
      <div className="overflow-x-auto rounded-lg bg-neutral-900 p-4 text-white" dir="rtl" style={{ fontFamily: kdsFont.stack }}>
        <p style={{ fontSize: `${draft.kdsSizePx}px`, lineHeight: 1.3 }} className="font-bold">
          ٢ × شاورما دجاج
        </p>
        <p style={{ fontSize: `${Math.round(draft.kdsSizePx * 0.75)}px`, lineHeight: 1.3 }}>بدون بصل · ثوم إضافي · حساسية: سمسم</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg-subtle text-xs">
          {t("lpk.updated")}: {profile.updatedAt.startsWith("1970") ? t("lpk.print.neverSaved") : formatDateTime(profile.updatedAt, fmt)}
        </span>
        <Button
          variant="primary"
          loading={action.pending}
          onClick={() =>
            action.run(() => services.localisation.savePrintProfile(draft), {
              onSuccess: () => onSaved(t("lpk.print.profileSaved")),
            })
          }
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
