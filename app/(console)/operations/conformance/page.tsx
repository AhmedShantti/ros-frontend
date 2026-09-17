"use client";

/**
 * Shared-logic conformance — FR-OFF-050.
 *
 * Runs the language-neutral test corpus against this client's own pure
 * business functions — the same ones the till uses offline — and shows each
 * vector's pass or fail with its input, expected and actual output. The
 * corpus can be exported as the JSON file the server and Dart suites run, and
 * a corpus file from those suites can be imported and run here, so a
 * divergence between client and server shows up as a failing row rather than
 * a till that prices a burger differently from the ledger.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { CheckCircle2, Download, Play, RotateCcw, Upload, XCircle } from "lucide-react";
import {
  CONFORMANCE_AREAS,
  CORPUS,
  parseCorpus,
  runCorpus,
  type ConformanceArea,
  type ConformanceCorpus,
  type VectorOutcome,
} from "@/lib/console/offline-conformance";
import { useI18n } from "@/lib/console/providers";
import { useTransientMessage } from "@/lib/console/hooks";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Button, Callout, Field, Select, Toast } from "@/components/console/ui";

type StatusFilter = "all" | "pass" | "fail";

export default function ConformancePage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("conf.title")} subtitle={t("conf.subtitle")} spec="FR-OFF-050" />
      <Gate permissions={["settings.tenant.manage", "platform.countrypack.manage", "audit.view"]}>
        <Runner />
      </Gate>
    </>
  );
}

function Runner() {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useTransientMessage();
  const [corpus, setCorpus] = useState<ConformanceCorpus>(CORPUS);
  const [imported, setImported] = useState(false);
  const [outcomes, setOutcomes] = useState<VectorOutcome[]>(() => runCorpus(CORPUS));
  // Set after mount: a timestamp rendered on the server would never match the client's.
  const [ranAt, setRanAt] = useState<string | null>(null);
  useEffect(() => setRanAt(new Date().toISOString()), []);
  const [area, setArea] = useState<ConformanceArea | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const fileInput = useRef<HTMLInputElement>(null);

  function run(next: ConformanceCorpus) {
    setOutcomes(runCorpus(next));
    setRanAt(new Date().toISOString());
  }

  const passed = outcomes.filter((outcome) => outcome.pass).length;
  const failed = outcomes.length - passed;
  const visible = useMemo(
    () =>
      outcomes.filter(
        (outcome) =>
          (area === "all" || outcome.vector.area === area) &&
          (status === "all" || (status === "pass" ? outcome.pass : !outcome.pass)),
      ),
    [outcomes, area, status],
  );

  function exportCorpus() {
    const blob = new Blob([JSON.stringify(corpus, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ros-conformance-${corpus.version}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCorpus(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const { corpus: next, error } = parseCorpus(await file.text());
    if (!next) {
      setMessage(t("conf.importFailed").replace("{detail}", error ?? ""));
      return;
    }
    setCorpus(next);
    setImported(true);
    run(next);
    setMessage(t("conf.imported").replace("{count}", String(next.vectors.length)));
  }

  return (
    <PageBody>
      <Callout tone="muted">{t("conf.note")}</Callout>

      <TileGrid>
        <MetricTile label={t("conf.vectors")} value={formatNumber(outcomes.length, fmt)} footer={`${t("conf.version")} ${corpus.version}${imported ? ` · ${t("conf.importedTag")}` : ""}`} />
        <MetricTile label={t("conf.passed")} value={formatNumber(passed, fmt)} />
        <MetricTile label={t("conf.failed")} value={formatNumber(failed, fmt)} />
        <MetricTile label={t("conf.ranAt")} value={ranAt ? formatDateTime(ranAt, fmt) : "—"} />
      </TileGrid>

      {failed > 0 ? (
        <Callout tone="bad" title={t("conf.failTitle")}>
          {t("conf.failBody")}
        </Callout>
      ) : (
        <Callout tone="good">{t("conf.allPass")}</Callout>
      )}

      <Section
        title={t("conf.results")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={<Play size={12} aria-hidden />} onClick={() => run(corpus)}>
              {t("conf.runAgain")}
            </Button>
            <Button size="sm" icon={<Download size={12} aria-hidden />} onClick={exportCorpus}>
              {t("conf.export")}
            </Button>
            <Button size="sm" icon={<Upload size={12} aria-hidden />} onClick={() => fileInput.current?.click()}>
              {t("conf.import")}
            </Button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void importCorpus(event)} />
            {imported ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={12} aria-hidden />}
                onClick={() => {
                  setCorpus(CORPUS);
                  setImported(false);
                  run(CORPUS);
                }}
              >
                {t("conf.builtIn")}
              </Button>
            ) : null}
          </div>
        }
      >
        <Toolbar className="mb-3">
          <Field label={t("conf.area")}>
            <Select value={area} onChange={(event) => setArea(event.target.value as ConformanceArea | "all")}>
              <option value="all">{t("common.all")}</option>
              {CONFORMANCE_AREAS.map((key) => (
                <option key={key} value={key}>
                  {t(`conf.area.${key}` as never)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.status")}>
            <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="all">{t("common.all")}</option>
              <option value="pass">{t("conf.passed")}</option>
              <option value="fail">{t("conf.failed")}</option>
            </Select>
          </Field>
        </Toolbar>

        <ul className="divide-line divide-y" aria-live="polite">
          {visible.map((outcome) => (
            <li key={outcome.vector.id} className="py-2.5">
              <details>
                <summary className="focus-visible:ring-accent flex cursor-pointer list-none flex-wrap items-center gap-2 rounded focus-visible:ring-2 focus-visible:outline-none">
                  {outcome.pass ? (
                    <CheckCircle2 size={15} className="text-good shrink-0" aria-hidden />
                  ) : (
                    <XCircle size={15} className="text-bad shrink-0" aria-hidden />
                  )}
                  <Badge tone={outcome.pass ? "good" : "bad"}>{outcome.pass ? t("conf.pass") : t("conf.fail")}</Badge>
                  <code dir="ltr" className="text-fg font-mono text-xs">
                    {outcome.vector.id}
                  </code>
                  <Badge tone="muted">{t(`conf.area.${outcome.vector.area}` as never)}</Badge>
                  <span className="text-fg-muted min-w-0 flex-1 text-xs">{outcome.vector.description}</span>
                </summary>
                <div dir="ltr" className="mt-2 grid gap-2 lg:grid-cols-3">
                  <JsonBlock title={t("conf.input")} value={outcome.vector.input} />
                  <JsonBlock title={t("conf.expected")} value={outcome.vector.expected} />
                  <JsonBlock title={t("conf.actual")} value={outcome.error ? { error: outcome.error } : outcome.actual} tone={outcome.pass ? undefined : "bad"} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Section>

      <Toast message={message} />
    </PageBody>
  );
}

function JsonBlock({ title, value, tone }: { title: string; value: unknown; tone?: "bad" }) {
  return (
    <div className={tone === "bad" ? "border-bad/40 rounded-lg border" : "border-line rounded-lg border"}>
      <p className="text-fg-subtle border-line border-b px-2 py-1 text-[0.68rem]">{title}</p>
      <pre className="text-fg max-h-56 overflow-auto px-2 py-1.5 font-mono text-[0.68rem] leading-relaxed whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
