"use client";

/**
 * Languages and formats — SRS §22.1: FR-LOC-008, FR-LOC-009, FR-LOC-010.
 *
 * Three questions on one page: which languages exist and what they can
 * print (packs and coverage), who and what reads which language (per user,
 * per terminal, per document type), and how dates, numbers and money look —
 * including the Hijri calendar where a branch's country pack offers it.
 *
 * No permission gate: every signed-in user may choose their own language and
 * calendar. Writing terminal and document languages is local configuration
 * until the backend serves it (see `services.localisation`).
 */

import { useMemo, useState } from "react";

import { versionInForce } from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { PageBody, PageHeader } from "@/components/console/page";
import { Tabs, Toast } from "@/components/console/ui";
import { LocalePacksPanel } from "@/components/console/locale-packs-panel";
import { LocaleAssignmentPanel } from "@/components/console/locale-assignment";
import { LocaleFormatsPanel, type HijriSource } from "@/components/console/locale-formats";

type Tab = "packs" | "assignment" | "formats";

export default function LanguagesPage() {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const [tab, setTab] = useState<Tab>("assignment");
  const [message, setMessage] = useTransientMessage();

  const versions = useAsync(() => services.localisation.packVersions.all(), []);

  // FR-LOC-010 — Hijri is offered only where a pack in force enables it.
  const hijriSources = useMemo<HijriSource[]>(() => {
    const all = versions.data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return availableBranches.flatMap((branch) => {
      const version = versionInForce(all, branch.countryCode, today);
      return version?.hijriCalendar ? [{ branchName: tx(branch.name), packLabel: `${version.code} v${version.version}` }] : [];
    });
  }, [versions.data, availableBranches, tx]);

  return (
    <>
      <PageHeader title={t("lpk.title")} subtitle={t("lpk.subtitle")} spec="FR-LOC-008" />
      <PageBody>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          label={t("lpk.title")}
          options={[
            { value: "assignment", label: t("lpk.tab.assignment") },
            { value: "packs", label: t("lpk.tab.packs") },
            { value: "formats", label: t("lpk.tab.formats") },
          ]}
        />
        {tab === "packs" ? <LocalePacksPanel /> : null}
        {tab === "assignment" ? <LocaleAssignmentPanel notify={setMessage} hijriAllowed={hijriSources.length > 0} /> : null}
        {tab === "formats" ? <LocaleFormatsPanel hijriSources={hijriSources} loading={versions.loading} /> : null}
      </PageBody>
      <Toast message={message} />
    </>
  );
}
