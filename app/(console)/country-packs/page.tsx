"use client";

/**
 * Country packs — SRS ch.22.
 *
 * The architectural claim this screen exists to demonstrate: jurisdiction
 * rules are data, not code. Tax model, rates, rounding, invoice format, week
 * start, overtime multiplier and retention all live in a versioned pack, and
 * adding a country is authoring a pack, not editing the tax engine.
 *
 * Four views of the same versions:
 *
 *   - Versions (FR-LOC-021): the history per country with effective dates,
 *     what changed between versions, and re-validation on read.
 *   - Transaction lookup (FR-LOC-021): which version governed a given sale.
 *   - Distribution (FR-LOC-024): which terminals already hold a version
 *     before its effective date, and which will cross it without it.
 *   - Authoring (FR-LOC-025, FR-LOC-030): a draft built from the registered
 *     tax strategies, validated live, run against the conformance suite and
 *     certified — at which point terminals may download it.
 *
 * Certification is the gate: an uncertified draft is never served, and a
 * certified version is never edited — a change is a new version. The order-
 * type rate matrix and rounding-consistency panels (FR-FIN-033/035) now sit
 * in the version drawer (`components/console/country-pack-versions.tsx`).
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import type { CountryPackVersion } from "@/lib/console/country-pack-authoring";
import { lifecycle, validatePack } from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { EmptyState } from "@/components/console/fields";
import { Button, Callout, Tabs, Toast } from "@/components/console/ui";
import { PackVersionsTab } from "@/components/console/country-pack-versions";
import { PackDistribution, PackTransactionLookup } from "@/components/console/country-pack-lookup";
import { PackEditor } from "@/components/console/country-pack-editor";
import { DATA_MODE } from "@/lib/api/config";

export default function CountryPacksPage() {
  return (
    <Gate permissions={["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"]}>
      <CountryPacksScreen />
    </Gate>
  );
}

type Tab = "versions" | "lookup" | "distribution" | "authoring";

function CountryPacksScreen() {
  const { t, fmt } = useI18n();
  const { canAny } = useSession();
  const canAuthor = canAny(["platform.countrypack.manage", "settings.tenant.manage"]);
  const [tab, setTab] = useState<Tab>("versions");
  // Undefined: authoring list; null: a new pack; string: that version.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  // Bumped on every open, so saving a new pack does not remount the editor mid-edit.
  const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useTransientMessage();
  const today = new Date().toISOString().slice(0, 10);

  const versions = useAsync(() => services.localisation.packVersions.all(), []);
  const rows = useMemo(() => versions.data ?? [], [versions.data]);

  const totals = useMemo(() => {
    const states = rows.map((row) => lifecycle(row, rows, today));
    return {
      active: states.filter((state) => state === "active").length,
      scheduled: states.filter((state) => state === "scheduled").length,
      drafts: states.filter((state) => state === "draft").length,
      invalid: rows.filter((row) => row.status !== "void" && validatePack(row, rows).some((problem) => problem.severity === "error")).length,
    };
  }, [rows, today]);

  function openEditor(id: string | null) {
    setEditing(id);
    setEditorKey((key) => key + 1);
    setTab("authoring");
  }

  const newButton = canAuthor ? (
    <Button variant="primary" icon={<Plus size={14} />} onClick={() => openEditor(null)}>
      {t("cpv.newPack")}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t("cp.title")} subtitle={t("cp.subtitle")} spec="FR-LOC-021" actions={newButton} />

      <PageBody>
        <Callout tone="muted">{t("cpv.pageNote")}</Callout>

        <AsyncPanel state={versions}>
          {() =>
            rows.length === 0 && tab !== "authoring" ? (
              <EmptyState
                title={t("cpv.emptyTitle")}
                body={DATA_MODE === "http" ? t("cpv.emptyBodyLive") : t("cpv.emptyBody")}
                action={newButton ?? undefined}
              />
            ) : (
              <>
                <TileGrid columns={4}>
                  <MetricTile label={t("cpv.state.active")} value={formatNumber(totals.active, fmt)} />
                  <MetricTile label={t("cpv.state.scheduled")} value={formatNumber(totals.scheduled, fmt)} />
                  <MetricTile label={t("cpv.state.draft")} value={formatNumber(totals.drafts, fmt)} />
                  <MetricTile label={t("cpv.invalidCount")} value={formatNumber(totals.invalid, fmt)} hint={t("cpv.invalidHint")} />
                </TileGrid>

                <Tabs<Tab>
                  value={tab}
                  onChange={setTab}
                  label={t("cp.title")}
                  options={[
                    { value: "versions", label: t("cpv.versionsTab"), count: rows.length },
                    { value: "lookup", label: t("cpv.lookupTab") },
                    { value: "distribution", label: t("cpv.distributionTab") },
                    ...(canAuthor ? [{ value: "authoring" as const, label: t("cpv.authoringTab") }] : []),
                  ]}
                />

                {tab === "versions" ? (
                  <PackVersionsTab
                    versions={rows}
                    today={today}
                    onChanged={(note) => {
                      setMessage(note);
                      versions.reload();
                    }}
                    onEdit={(id) => {
                      versions.reload();
                      openEditor(id);
                    }}
                  />
                ) : null}
                {tab === "lookup" ? <PackTransactionLookup versions={rows} today={today} /> : null}
                {tab === "distribution" ? <PackDistribution versions={rows} today={today} /> : null}
                {tab === "authoring" && canAuthor ? (
                  editing === undefined ? (
                    <DraftList versions={rows} onOpen={openEditor} />
                  ) : (
                    <PackEditor
                      key={editorKey}
                      versionId={editing}
                      versions={rows}
                      onSaved={(note, id) => {
                        setMessage(note);
                        versions.reload();
                        if (editing === null) setEditing(id);
                      }}
                      onClose={() => setEditing(undefined)}
                    />
                  )
                ) : null}
              </>
            )
          }
        </AsyncPanel>
      </PageBody>

      <Toast message={message} />
    </>
  );
}

function DraftList({ versions, onOpen }: { versions: CountryPackVersion[]; onOpen: (id: string | null) => void }) {
  const { t, tx } = useI18n();
  const drafts = versions.filter((row) => row.status === "draft");
  return (
    <div className="space-y-3">
      <Callout tone="muted">{t("cpv.authoringNote")}</Callout>
      {drafts.length === 0 ? (
        <EmptyState
          title={t("cpv.noDrafts")}
          body={t("cpv.noDraftsBody")}
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => onOpen(null)}>
              {t("cpv.newPack")}
            </Button>
          }
        />
      ) : (
        <ul className="border-line divide-line divide-y rounded-lg border">
          {drafts.map((row) => {
            const errors = validatePack(row, versions).filter((problem) => problem.severity === "error").length;
            return (
              <li key={row.id}>
                <button type="button" onClick={() => onOpen(row.id)} className="hover:bg-sunken flex w-full items-center gap-3 px-3 py-2.5 text-start">
                  <span className="font-mono text-xs" dir="ltr">
                    {row.code || "—"} {row.version}
                  </span>
                  <span className="text-fg min-w-0 flex-1 truncate text-sm">{tx(row.name)}</span>
                  <span className={errors > 0 ? "text-bad text-xs" : "text-good text-xs"}>
                    {errors > 0 ? t("cpv.errorsCount").replace("{n}", String(errors)) : t("cpv.valid")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
