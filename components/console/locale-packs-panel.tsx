"use client";

/**
 * FR-LOC-009 — translation packs and how much of each surface they cover.
 */

import { useMemo, useState } from "react";

import { consoleEn } from "@/content/console/en";
import {
  PACK_LANGUAGES,
  TRANSLATION_PACKS,
  coverage,
  type Coverage,
  type PackLanguage,
  type Surface,
} from "@/lib/console/locale-packs";
import { renderKitchenTicket, renderReceiptIn } from "@/lib/console/receipt";
import { useI18n } from "@/lib/console/providers";
import { formatNumber, formatPercent } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { Badge, Callout, Meter, SegmentedControl } from "@/components/console/ui";
import { PaperPreview, SAMPLE_RECEIPT, SAMPLE_TEMPLATE, SAMPLE_TICKET } from "@/components/console/locale-preview";

const CONSOLE_KEYS = Object.keys(consoleEn);
const SURFACES: Surface[] = ["kitchen_ticket", "receipt", "console"];

interface Row {
  language: PackLanguage;
  coverage: Record<Surface, Coverage>;
}

function CoverageCell({ value }: { value: Coverage }) {
  const { fmt } = useI18n();
  return (
    <div className="w-32">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums">{formatPercent(value.percent, fmt, 0)}</span>
        <span className="text-fg-subtle font-mono tabular-nums">
          {formatNumber(value.covered, fmt)}/{formatNumber(value.required, fmt)}
        </span>
      </div>
      <Meter value={value.percent} tone={value.complete ? "good" : value.percent > 0 ? "warn" : "muted"} />
    </div>
  );
}

export function LocalePacksPanel() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<PackLanguage>("ur");

  const rows = useMemo<Row[]>(
    () =>
      PACK_LANGUAGES.map((language) => ({
        language,
        coverage: Object.fromEntries(SURFACES.map((surface) => [surface, coverage(language, surface, CONSOLE_KEYS)])) as Record<Surface, Coverage>,
      })),
    [],
  );

  const columns: Column<Row>[] = [
    {
      key: "language",
      header: t("lpk.language"),
      render: (row) => {
        const pack = TRANSLATION_PACKS[row.language];
        return (
          <span className="flex flex-col">
            <span className="text-fg text-sm" style={{ fontFamily: pack.fontStack }} dir={pack.dir}>
              {pack.endonym}
            </span>
            <span className="text-fg-subtle text-xs">{t(`lang.${row.language}` as ConsoleKey)}</span>
          </span>
        );
      },
    },
    {
      key: "meta",
      header: t("lpk.packMeta"),
      secondary: true,
      render: (row) => {
        const pack = TRANSLATION_PACKS[row.language];
        return (
          <span className="flex flex-wrap gap-1">
            <Badge tone="muted">{pack.dir.toUpperCase()}</Badge>
            <Badge tone="muted">
              <span dir="ltr">{pack.intlTag}</span>
            </Badge>
            <Badge tone="muted">v{pack.version}</Badge>
          </span>
        );
      },
    },
    ...SURFACES.map<Column<Row>>((surface) => ({
      key: surface,
      header: t(`lpk.surface.${surface}` as ConsoleKey),
      render: (row) => <CoverageCell value={row.coverage[surface]} />,
    })),
    {
      key: "chrome",
      header: t("lpk.chrome"),
      render: (row) =>
        row.coverage.console.complete ? (
          <Badge tone="good">{t("lpk.chromeAvailable")}</Badge>
        ) : (
          <Badge tone="muted">{t("lpk.documentsOnly")}</Badge>
        ),
    },
  ];

  const pack = TRANSLATION_PACKS[selected];
  const missing = [...rows.find((row) => row.language === selected)!.coverage.kitchen_ticket.missing, ...rows.find((row) => row.language === selected)!.coverage.receipt.missing];
  const ticket = useMemo(() => renderKitchenTicket(SAMPLE_TICKET, selected, 80), [selected]);
  const receipt = useMemo(() => renderReceiptIn(SAMPLE_TEMPLATE, SAMPLE_RECEIPT, [selected], null), [selected]);

  return (
    <div className="space-y-5">
      <Callout tone="muted" title={t("lpk.chromeRuleTitle")}>
        {t("lpk.chromeRule")}
      </Callout>

      <DataTable columns={columns} rows={rows} rowKey={(row) => row.language} caption={t("lpk.packsTitle")} dense onRowClick={(row) => setSelected(row.language)} activeRowKey={selected} />

      <Section title={t("lpk.previewTitle").replace("{language}", pack.endonym)} hint={t("lpk.previewHint")} spec="FR-LOC-009">
        <div className="mb-3">
          <SegmentedControl<PackLanguage>
            value={selected}
            onChange={setSelected}
            label={t("lpk.language")}
            options={PACK_LANGUAGES.map((language) => ({ value: language, label: TRANSLATION_PACKS[language].endonym }))}
          />
        </div>
        {missing.length > 0 ? (
          <Callout tone="warn" title={t("lpk.missingKeys")}>
            <span className="font-mono" dir="ltr">
              {missing.join(", ")}
            </span>
          </Callout>
        ) : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-fg-muted mb-2 text-xs">{t("lpk.surface.kitchen_ticket")}</p>
            <PaperPreview lines={ticket} paperWidth={80} fontStack={pack.fontStack} />
          </div>
          <div>
            <p className="text-fg-muted mb-2 text-xs">{t("lpk.surface.receipt")}</p>
            <PaperPreview lines={receipt} paperWidth={80} fontStack={pack.fontStack} />
          </div>
        </div>
      </Section>
    </div>
  );
}
