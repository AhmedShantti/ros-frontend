"use client";

/**
 * FR-LOC-012 — the supported printer matrix: models, test results per paper
 * width × rendering mode × font, and the mode each model should use.
 */

import { useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";

import {
  ARABIC_FONTS,
  matrixCell,
  recommendedMode,
  type MatrixCell,
  type PrintTestRecord,
  type PrinterModel,
  type RenderMode,
} from "@/lib/console/locale-packs";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { RecordDrawer } from "@/components/console/record-drawer";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, IconButton } from "@/components/console/ui";
import { fontById } from "@/components/console/locale-print-profile";

export interface TestDefaults {
  paperWidth: 58 | 80;
  mode: RenderMode;
  fontId: string;
  sizeDots: number;
}

function Cell({ cell }: { cell: MatrixCell }) {
  const { t, fmt } = useI18n();
  if (cell.state === "untested") return <Badge tone="muted">{t("lpk.print.untested")}</Badge>;
  return (
    <span className="flex flex-col items-start gap-0.5" title={cell.record?.notes || undefined}>
      <Badge tone={cell.state === "pass" ? "good" : "bad"} dot>
        {t(`lpk.print.${cell.state}` as ConsoleKey)}
      </Badge>
      <span className="text-fg-subtle text-[11px]">
        {fontById(cell.record!.fontId).label} · {cell.record!.sizeDots}d · {formatDate(cell.record!.testedAt, fmt)}
      </span>
    </span>
  );
}

export function PrinterMatrixPanel({ defaults, notify }: { defaults: TestDefaults; notify: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const action = useAction();
  const [addingModel, setAddingModel] = useState(false);
  const [recording, setRecording] = useState<{ modelId: string; paperWidth: 58 | 80 } | null>(null);

  const data = useAsync(async () => {
    const [models, tests] = await Promise.all([services.localisation.printerModels.all(), services.localisation.printTests.all()]);
    return { models, tests };
  }, []);

  async function removeModel(model: PrinterModel, tests: PrintTestRecord[]) {
    const count = tests.filter((row) => row.printerModelId === model.id).length;
    const ok = await confirm({
      title: t("common.confirmDelete").replace("{name}", `${model.vendor} ${model.model}`),
      body: count > 0 ? t("lpk.print.deleteModelWithTests").replace("{n}", String(count)) : t("common.confirmDeleteBody").replace("{name}", `${model.vendor} ${model.model}`),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.localisation.printerModels.remove(model.id), {
      onSuccess: () => {
        data.reload();
        notify(t("lpk.print.modelDeleted"));
      },
    });
  }

  type Row = { model: PrinterModel; paperWidth: 58 | 80; tests: PrintTestRecord[] };

  const columns: Column<Row>[] = [
    {
      key: "model",
      header: t("lpk.print.model"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">
            {row.model.vendor} {row.model.model}
          </span>
          <span className="text-fg-subtle text-xs" dir="ltr">
            {row.paperWidth} mm · {row.model.dpi} dpi{row.model.claimsArabic ? ` · ${t("lpk.print.claimsArabic")}` : ""}
          </span>
        </span>
      ),
    },
    { key: "native", header: t("lpk.print.mode.native"), render: (row) => <Cell cell={matrixCell(row.tests, row.model.id, row.paperWidth, "native")} /> },
    { key: "image", header: t("lpk.print.mode.image"), render: (row) => <Cell cell={matrixCell(row.tests, row.model.id, row.paperWidth, "image")} /> },
    {
      key: "recommended",
      header: t("lpk.print.recommended"),
      render: (row) => {
        const rec = recommendedMode(row.tests, row.model.id, row.paperWidth);
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Badge tone={rec.verified ? "accent" : "warn"}>{t(`lpk.print.mode.${rec.mode}` as ConsoleKey)}</Badge>
            {!rec.verified ? <span className="text-fg-subtle text-[11px]">{t("lpk.print.unverified")}</span> : null}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          <Button size="sm" variant="secondary" icon={<ClipboardCheck size={12} />} onClick={() => setRecording({ modelId: row.model.id, paperWidth: row.paperWidth })}>
            {t("lpk.print.recordResult")}
          </Button>
          {row.paperWidth === row.model.paperWidths[0] ? (
            <IconButton label={t("common.delete")} icon={<Trash2 size={13} />} onClick={() => removeModel(row.model, row.tests)} />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Section
      title={t("lpk.print.matrixTitle")}
      hint={t("lpk.print.matrixHint")}
      spec="FR-LOC-012"
      action={
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAddingModel(true)}>
          {t("lpk.print.addModel")}
        </Button>
      }
    >
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <AsyncPanel state={data} isEmpty={(ready) => ready.models.length === 0} empty={<Callout tone="muted">{t("lpk.print.noModels")}</Callout>}>
        {(ready) => {
          const rows: Row[] = ready.models.flatMap((model) => model.paperWidths.map((paperWidth) => ({ model, paperWidth, tests: ready.tests })));
          const history = [...ready.tests].sort((a, b) => b.testedAt.localeCompare(a.testedAt)).slice(0, 12);
          const modelName = (id: string) => {
            const model = ready.models.find((row) => row.id === id);
            return model ? `${model.vendor} ${model.model}` : id;
          };
          return (
            <div className="space-y-4">
              <DataTable columns={columns} rows={rows} rowKey={(row) => `${row.model.id}:${row.paperWidth}`} caption={t("lpk.print.matrixTitle")} dense />
              {history.length > 0 ? (
                <div>
                  <h4 className="text-fg mb-2 text-sm font-semibold">{t("lpk.print.history")}</h4>
                  <ul className="divide-line border-line divide-y rounded-lg border text-xs">
                    {history.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <Badge tone={row.result === "pass" ? "good" : "bad"}>{t(`lpk.print.${row.result}` as ConsoleKey)}</Badge>
                        <span className="text-fg">{modelName(row.printerModelId)}</span>
                        <span className="text-fg-muted" dir="ltr">
                          {row.paperWidth} mm · {row.renderMode} · {fontById(row.fontId).label} {row.sizeDots}d{row.firmware ? ` · fw ${row.firmware}` : ""}
                        </span>
                        {row.notes ? <span className="text-fg-subtle">— {row.notes}</span> : null}
                        <span className="text-fg-subtle ms-auto">
                          {row.testedBy ?? ""} {formatDateTime(row.testedAt, fmt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        }}
      </AsyncPanel>

      <RecordDrawer
        open={addingModel}
        title={t("lpk.print.addModel")}
        fields={[
          { name: "vendor", label: t("lpk.print.vendor"), required: true, maxLength: 60, placeholder: "Epson" },
          { name: "model", label: t("lpk.print.model"), required: true, maxLength: 60, placeholder: "TM-T20III", ltr: true },
          { name: "dpi", label: "DPI", kind: "number", initial: "203", min: 100, max: 600 },
          {
            name: "paper",
            label: t("lpk.print.paper"),
            kind: "select",
            required: true,
            initial: "80",
            options: [
              { value: "58", label: "58 mm" },
              { value: "80", label: "80 mm" },
              { value: "both", label: "58 mm + 80 mm" },
            ],
          },
          { name: "claimsArabic", label: t("lpk.print.claimsArabic"), kind: "toggle", hint: t("lpk.print.claimsArabicHint") },
        ]}
        onClose={() => setAddingModel(false)}
        onSubmit={(values) =>
          services.localisation.printerModels.create({
            vendor: values.vendor,
            model: values.model,
            dpi: Number(values.dpi) || 203,
            paperWidths: values.paper === "both" ? [58, 80] : [Number(values.paper) as 58 | 80],
            claimsArabic: values.claimsArabic === "true",
          })
        }
        onDone={() => {
          setAddingModel(false);
          data.reload();
          notify(t("lpk.print.modelAdded"));
        }}
      />

      <RecordDrawer
        open={recording !== null}
        title={t("lpk.print.recordResult")}
        note={t("lpk.print.recordNote")}
        fields={[
          {
            name: "mode",
            label: t("lpk.print.mode"),
            kind: "select",
            required: true,
            initial: defaults.mode,
            options: [
              { value: "native", label: t("lpk.print.mode.native") },
              { value: "image", label: t("lpk.print.mode.image") },
            ],
          },
          {
            name: "fontId",
            label: t("lpk.print.font"),
            kind: "select",
            required: true,
            initial: defaults.fontId,
            options: ARABIC_FONTS.map((font) => ({ value: font.id, label: font.label })),
          },
          { name: "sizeDots", label: t("lpk.print.sizeDots"), kind: "number", initial: String(defaults.sizeDots), min: 8, max: 96 },
          { name: "firmware", label: t("lpk.print.firmware"), maxLength: 40, ltr: true },
          {
            name: "result",
            label: t("lpk.print.result"),
            kind: "select",
            required: true,
            options: [
              { value: "pass", label: t("lpk.print.pass") },
              { value: "fail", label: t("lpk.print.fail") },
            ],
          },
          {
            name: "notes",
            label: t("lpk.print.notes"),
            kind: "textarea",
            maxLength: 500,
            hint: t("lpk.print.notesHint"),
            validate: (value, all) => (all.result === "fail" && !value.trim() ? t("lpk.print.notesRequired") : null),
          },
        ]}
        onClose={() => setRecording(null)}
        onSubmit={(values) =>
          services.localisation.printTests.create({
            printerModelId: recording!.modelId,
            paperWidth: recording!.paperWidth,
            renderMode: values.mode as RenderMode,
            fontId: values.fontId,
            sizeDots: Number(values.sizeDots) || defaults.sizeDots,
            firmware: values.firmware.trim(),
            result: values.result as "pass" | "fail",
            notes: values.notes,
            testedBy: session?.user ? tx(session.user.name) || session.user.email : null,
          })
        }
        onDone={() => {
          setRecording(null);
          data.reload();
          notify(t("lpk.print.resultRecorded"));
        }}
      />
    </Section>
  );
}
