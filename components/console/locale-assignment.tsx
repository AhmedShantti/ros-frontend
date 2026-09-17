"use client";

/**
 * FR-LOC-008 — language chosen independently per user, per terminal and per
 * printed document type.
 */

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import type { Terminal } from "@/lib/console/types";
import {
  DOCUMENT_TYPES,
  TRANSLATION_PACKS,
  documentLanguageId,
  languagesFor,
  resolveDocumentLanguages,
  surfaceOf,
  type DocumentLanguage,
  type DocumentType,
  type PackLanguage,
  type TerminalLanguage,
  type UserLanguage,
} from "@/lib/console/locale-packs";
import type { CalendarDisplay } from "@/lib/console/format";
import { formatDateTime } from "@/lib/console/format";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePreferences, useSession } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { AsyncPanel } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, Field, SegmentedControl, Select } from "@/components/console/ui";

const langLabel = (language: PackLanguage) => TRANSLATION_PACKS[language].endonym;

// ---------------------------------------------------------------------------

function UserLanguageSection({ notify, hijriAllowed, reloadKey }: { notify: (message: string) => void; hijriAllowed: boolean; reloadKey: number }) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const { locale, setLocale, calendar, setCalendar } = usePreferences();
  const action = useAction();
  const saved = useAsync(() => services.localisation.userLanguages.all(), [reloadKey]);
  const [language, setLanguage] = useState<"en" | "ar">(locale);
  const [cal, setCal] = useState<CalendarDisplay>(calendar);

  useEffect(() => setLanguage(locale), [locale]);
  useEffect(() => setCal(calendar), [calendar]);

  const user = session?.user ?? null;

  async function save() {
    if (!user) return;
    const effectiveCalendar = hijriAllowed ? cal : "gregory";
    await action.run(
      () =>
        services.localisation.setUserLanguage({
          id: user.id,
          userName: tx(user.name) || user.email,
          language,
          calendar: effectiveCalendar,
          updatedAt: new Date().toISOString(),
        }),
      {
        onSuccess: () => {
          setLocale(language);
          setCalendar(effectiveCalendar);
          saved.reload();
          notify(t("lpk.userSaved"));
        },
      },
    );
  }

  const columns: Column<UserLanguage>[] = [
    { key: "user", header: t("lpk.user"), render: (row) => row.userName },
    { key: "language", header: t("lpk.consoleLanguage"), render: (row) => langLabel(row.language) },
    { key: "calendar", header: t("lpk.calendar"), render: (row) => t(`lpk.cal.${row.calendar}` as ConsoleKey) },
    { key: "updatedAt", header: t("lpk.updated"), secondary: true, render: (row) => formatDateTime(row.updatedAt, fmt) },
  ];

  return (
    <Section title={t("lpk.perUser")} hint={t("lpk.perUserHint")} spec="FR-LOC-008">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {user ? (
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("lpk.consoleLanguage")} hint={t("lpk.consoleLanguageHint")}>
            <SegmentedControl<"en" | "ar">
              value={language}
              onChange={setLanguage}
              options={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
          </Field>
          <Field label={t("lpk.calendar")} hint={hijriAllowed ? undefined : t("lpk.hijriUnavailable")}>
            <Select value={hijriAllowed ? cal : "gregory"} onChange={(event) => setCal(event.target.value as CalendarDisplay)} disabled={!hijriAllowed}>
              <option value="gregory">{t("lpk.cal.gregory")}</option>
              <option value="hijri">{t("lpk.cal.hijri")}</option>
              <option value="both">{t("lpk.cal.both")}</option>
            </Select>
          </Field>
          <Button variant="primary" onClick={save} loading={action.pending}>
            {t("common.save")}
          </Button>
        </div>
      ) : (
        <Callout tone="muted">{t("lpk.noUser")}</Callout>
      )}
      <div className="mt-4">
        <AsyncPanel state={saved} isEmpty={(rows) => rows.length === 0} empty={<p className="text-fg-subtle text-sm">{t("lpk.noSavedUsers")}</p>}>
          {(rows) => <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption={t("lpk.perUser")} dense />}
        </AsyncPanel>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function TerminalLanguageSection({ notify, reloadKey }: { notify: (message: string) => void; reloadKey: number }) {
  const { t, tx } = useI18n();
  const { scope, availableBranches } = useSession();
  const action = useAction();
  const data = useAsync(async () => {
    const [terminals, saved] = await Promise.all([
      services.operations.terminals({ scope, limit: 200 }),
      services.localisation.terminalLanguages.all(),
    ]);
    return { terminals: terminals.rows, saved: new Map(saved.map((row) => [row.id, row])) };
  }, [scope.tenantId, scope.brandId, scope.branchId, reloadKey]);

  const branchName = (id: string) => {
    const branch = availableBranches.find((row) => row.id === id);
    return branch ? tx(branch.name) : id;
  };

  async function set(terminal: Terminal, language: "en" | "ar") {
    await action.run(
      () =>
        services.localisation.setTerminalLanguage({
          id: terminal.id,
          branchId: terminal.branchId,
          terminalName: terminal.name,
          language,
          updatedAt: new Date().toISOString(),
        } satisfies TerminalLanguage),
      {
        onSuccess: () => {
          data.reload();
          notify(t("lpk.terminalSaved").replace("{name}", terminal.name));
        },
      },
    );
  }

  return (
    <Section title={t("lpk.perTerminal")} hint={t("lpk.perTerminalHint")} spec="FR-LOC-008">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <AsyncPanel state={data} isEmpty={(ready) => ready.terminals.length === 0}>
        {(ready) => (
          <DataTable
            dense
            caption={t("lpk.perTerminal")}
            rows={ready.terminals}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: t("lpk.terminal"),
                render: (row) => (
                  <span className="flex flex-col">
                    <span className="text-fg text-sm">{row.name}</span>
                    <span className="text-fg-subtle text-xs">
                      {branchName(row.branchId)} · {row.kind.toUpperCase()}
                    </span>
                  </span>
                ),
              },
              {
                key: "language",
                header: t("lpk.interfaceLanguage"),
                render: (row) => {
                  const current = ready.saved.get(row.id)?.language ?? null;
                  return (
                    <span className="flex items-center gap-2">
                      <SegmentedControl<"en" | "ar" | "unset">
                        value={current ?? "unset"}
                        onChange={(next) => {
                          if (next !== "unset") void set(row, next);
                        }}
                        options={[
                          { value: "unset", label: t("lpk.notSet") },
                          { value: "en", label: "English" },
                          { value: "ar", label: "العربية" },
                        ]}
                      />
                    </span>
                  );
                },
              },
            ]}
          />
        )}
      </AsyncPanel>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function DocumentLanguageSection({ notify, reloadKey, onPreset }: { notify: (message: string) => void; reloadKey: number; onPreset: () => void }) {
  const { t, tx } = useI18n();
  const { session, availableBranches, scope } = useSession();
  const { setLocale } = usePreferences();
  const confirm = useConfirm();
  const action = useAction();
  const [target, setTarget] = useState<string>("tenant");
  const saved = useAsync(() => services.localisation.documentLanguages.all(), [reloadKey]);

  const branchId = target === "tenant" ? null : target;
  const rows = saved.data ?? [];

  async function save(documentType: DocumentType, languages: PackLanguage[]) {
    await action.run(
      () =>
        services.localisation.setDocumentLanguage({
          id: documentLanguageId(branchId, documentType),
          branchId,
          documentType,
          languages,
          updatedAt: new Date().toISOString(),
        } satisfies DocumentLanguage),
      {
        onSuccess: () => {
          saved.reload();
          notify(t("lpk.documentSaved"));
        },
      },
    );
  }

  async function applyPreset() {
    if (!branchId) return;
    const branch = availableBranches.find((row) => row.id === branchId);
    const ok = await confirm({
      title: t("lpk.presetTitle"),
      body: t("lpk.presetBody").replace("{branch}", branch ? tx(branch.name) : branchId),
      confirmLabel: t("lpk.presetApply"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      async () => {
        const now = new Date().toISOString();
        if (session?.user) {
          await services.localisation.setUserLanguage({
            id: session.user.id,
            userName: tx(session.user.name) || session.user.email,
            language: "en",
            calendar: "gregory",
            updatedAt: now,
          });
        }
        const terminals = await services.operations.terminals({ scope: { ...scope, branchId }, limit: 200 });
        for (const terminal of terminals.rows.filter((row) => row.branchId === branchId && row.kind === "pos")) {
          await services.localisation.setTerminalLanguage({ id: terminal.id, branchId, terminalName: terminal.name, language: "ar", updatedAt: now });
        }
        await services.localisation.setDocumentLanguage({ id: documentLanguageId(branchId, "kitchen_ticket"), branchId, documentType: "kitchen_ticket", languages: ["ur"], updatedAt: now });
        await services.localisation.setDocumentLanguage({ id: documentLanguageId(branchId, "receipt"), branchId, documentType: "receipt", languages: ["ar", "en"], updatedAt: now });
      },
      {
        onSuccess: () => {
          if (session?.user) setLocale("en");
          saved.reload();
          onPreset();
          notify(t("lpk.presetApplied"));
        },
      },
    );
  }

  return (
    <Section title={t("lpk.perDocument")} hint={t("lpk.perDocumentHint")} spec="FR-LOC-008">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <Field label={t("lpk.appliesTo")}>
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="tenant">{t("lpk.tenantDefault")}</option>
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="secondary" icon={<Sparkles size={14} />} disabled={!branchId || action.pending} onClick={applyPreset}>
          {t("lpk.preset")}
        </Button>
      </div>
      {!branchId ? <p className="text-fg-subtle mb-3 text-xs">{t("lpk.presetNeedsBranch")}</p> : null}

      <ul className="divide-line border-line divide-y rounded-lg border">
        {DOCUMENT_TYPES.map((documentType) => (
          <DocumentRow
            key={`${target}:${documentType}`}
            documentType={documentType}
            own={rows.find((row) => row.id === documentLanguageId(branchId, documentType)) ?? null}
            resolved={resolveDocumentLanguages(rows, branchId, documentType)}
            pending={action.pending}
            onSave={(languages) => save(documentType, languages)}
          />
        ))}
      </ul>
    </Section>
  );
}

function DocumentRow({
  documentType,
  own,
  resolved,
  pending,
  onSave,
}: {
  documentType: DocumentType;
  own: DocumentLanguage | null;
  resolved: ReturnType<typeof resolveDocumentLanguages>;
  pending: boolean;
  onSave: (languages: PackLanguage[]) => void;
}) {
  const { t } = useI18n();
  const offered = useMemo(() => languagesFor(surfaceOf(documentType)), [documentType]);
  const [first, setFirst] = useState<PackLanguage>(own?.languages[0] ?? resolved.languages[0] ?? "en");
  const [second, setSecond] = useState<PackLanguage | "">(own?.languages[1] ?? (own ? "" : resolved.languages[1] ?? ""));

  const next: PackLanguage[] = second && second !== first ? [first, second] : [first];

  return (
    <li className="flex flex-wrap items-end gap-3 px-3 py-3">
      <div className="min-w-40 flex-1">
        <p className="text-fg text-sm font-medium">{t(`lpk.doc.${documentType}` as ConsoleKey)}</p>
        <p className="text-fg-subtle mt-0.5 flex flex-wrap items-center gap-1 text-xs">
          {t("lpk.resolved")}: {resolved.languages.map(langLabel).join(" + ")}
          <Badge tone={resolved.from === "default" ? "muted" : "accent"}>{t(`lpk.from.${resolved.from}` as ConsoleKey)}</Badge>
        </p>
      </div>
      <Field label={t("lpk.firstLanguage")}>
        <Select value={first} onChange={(event) => setFirst(event.target.value as PackLanguage)}>
          {offered.map((language) => (
            <option key={language} value={language}>
              {langLabel(language)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("lpk.secondLanguage")}>
        <Select value={second} onChange={(event) => setSecond(event.target.value as PackLanguage | "")}>
          <option value="">{t("common.none")}</option>
          {offered
            .filter((language) => language !== first)
            .map((language) => (
              <option key={language} value={language}>
                {langLabel(language)}
              </option>
            ))}
        </Select>
      </Field>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => onSave(next)}>
        {t("common.save")}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------------------

export function LocaleAssignmentPanel({ notify, hijriAllowed }: { notify: (message: string) => void; hijriAllowed: boolean }) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="space-y-5">
      <UserLanguageSection notify={notify} hijriAllowed={hijriAllowed} reloadKey={reloadKey} />
      <TerminalLanguageSection notify={notify} reloadKey={reloadKey} />
      <DocumentLanguageSection notify={notify} reloadKey={reloadKey} onPreset={() => setReloadKey((key) => key + 1)} />
    </div>
  );
}
