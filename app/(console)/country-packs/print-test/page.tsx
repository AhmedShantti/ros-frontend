"use client";

/**
 * Arabic print test — SRS §22.1: FR-LOC-011, FR-LOC-012.
 *
 * Arabic on thermal paper fails in ways a screen never shows: letters print
 * unjoined, words come out left-to-right, the dots under ب and ي merge into
 * the stroke at small sizes. So the font is a tested choice, not a CSS
 * default (FR-LOC-011), and every printer model in use is tested at each
 * paper width in both rendering modes — the printer's own Arabic support
 * ("native") and a pre-shaped 1-bit image ("image") — with the results kept
 * as the matrix that decides how each model prints (FR-LOC-012).
 */

import { useMemo, useState } from "react";

import { renderReceiptIn } from "@/lib/console/receipt";
import { DEFAULT_PRINT_PROFILE, type RenderMode } from "@/lib/console/locale-packs";
import { useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { Callout, Field, SegmentedControl, Toast } from "@/components/console/ui";
import { PaperPreview, SAMPLE_RECEIPT, SAMPLE_TEMPLATE } from "@/components/console/locale-preview";
import { RasterPreview } from "@/components/console/locale-print-raster";
import { PrintProfilePanel, fontById, usePrintProfile } from "@/components/console/locale-print-profile";
import { PrinterMatrixPanel } from "@/components/console/locale-print-matrix";

export default function PrintTestPage() {
  return (
    <Gate permissions={["settings.tenant.manage", "settings.branch.manage", "platform.countrypack.manage"]}>
      <PrintTest />
    </Gate>
  );
}

function PrintTest() {
  const { t } = useI18n();
  const [message, setMessage] = useTransientMessage();
  const profile = usePrintProfile();
  const [paper, setPaper] = useState<"58" | "80">("80");
  const [mode, setMode] = useState<RenderMode>("image");

  const current = profile.data ?? DEFAULT_PRINT_PROFILE;
  const font = fontById(current.arabicFontId);
  const paperWidth = Number(paper) as 58 | 80;

  // Arabic first, then English — the bilingual receipt most Gulf tills print.
  const lines = useMemo(
    () => renderReceiptIn({ ...SAMPLE_TEMPLATE, paperWidth }, SAMPLE_RECEIPT, ["ar", "en"], null),
    [paperWidth],
  );

  return (
    <>
      <PageHeader title={t("lpk.print.title")} subtitle={t("lpk.print.subtitle")} spec="FR-LOC-012" />
      <PageBody>
        <PrintProfilePanel state={profile} onSaved={setMessage} />

        <Section title={t("lpk.print.testTitle")} hint={t("lpk.print.testHint")} spec="FR-LOC-012">
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <Field label={t("lpk.print.paper")}>
              <SegmentedControl<"58" | "80">
                value={paper}
                onChange={setPaper}
                options={[
                  { value: "58", label: "58 mm" },
                  { value: "80", label: "80 mm" },
                ]}
              />
            </Field>
            <Field label={t("lpk.print.mode")}>
              <SegmentedControl<RenderMode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: "native", label: t("lpk.print.mode.native") },
                  { value: "image", label: t("lpk.print.mode.image") },
                ]}
              />
            </Field>
            <p className="text-fg-subtle text-xs">
              {font.label} · {current.receiptSizeDots} dots
            </p>
          </div>

          {mode === "native" ? (
            <div className="space-y-2">
              <Callout tone="muted">{t("lpk.print.nativeNote")}</Callout>
              <PaperPreview lines={lines} paperWidth={paperWidth} />
            </div>
          ) : (
            <div className="space-y-2">
              <Callout tone="muted">{t("lpk.print.imageNote")}</Callout>
              <RasterPreview
                lines={lines}
                paperWidth={paperWidth}
                fontStack={font.id === "printer_cp864" ? "monospace" : font.stack}
                sizeDots={current.receiptSizeDots}
                filename={`arabic-test-${paperWidth}mm-${font.id}.png`}
              />
            </div>
          )}
        </Section>

        <PrinterMatrixPanel
          defaults={{ paperWidth, mode, fontId: current.arabicFontId, sizeDots: current.receiptSizeDots }}
          notify={setMessage}
        />
      </PageBody>
      <Toast message={message} />
    </>
  );
}
