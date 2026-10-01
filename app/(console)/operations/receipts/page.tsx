"use client";

/**
 * Receipt templates — FR-POS-101 / FR-POS-102.
 *
 * Edits the templates the till prints from: the receipt language (Arabic,
 * English, or both in either order), a logo link, and up to four header and
 * footer lines per language. A template is scoped by brand and/or country
 * pack; the scope is fixed at creation. A branch prints with the most
 * specific template that matches its brand and pack.
 *
 * Every read and write goes through `services.receiptTemplates` — the
 * backend when `DATA_MODE === "http"`. Nothing here is kept in the browser:
 * a save is followed by a reload from the server, and the only client-side
 * state is the draft being typed and the (never saved) preview paper width.
 *
 * The editor is a short list of plain choices — language, logo and header,
 * which details print, tips and signature lines, footer, paper style, back
 * page — next to a live preview. Deliberately not here: a template name,
 * deactivation, the business's legal name / tax registration and QR — fiscal
 * identity belongs to FR-POS-100 and no option can remove it.
 *
 * Read requires `settings.tenant.read`; every control that changes something
 * is separately gated on `settings.tenant.manage`.
 */

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Id, Localised } from "@/lib/console/types";
import type { Brand } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import {
  RECEIPT_BACK_SIDES,
  RECEIPT_MAX_LINES,
  RECEIPT_MAX_LINE_LENGTH,
  RECEIPT_PAPER_STYLES,
  RECEIPT_SHOW_OPTIONS,
  contentChanges,
  isHttpsUrl,
  languageFieldsOf,
  layoutOf,
  optionsOf,
  previewReceiptDocument,
  receiptContentIssues,
  sameContent,
  type PaperWidth,
  type ReceiptLayout,
  type ReceiptOptions,
  type ReceiptPaperStyle,
  type ReceiptScopeOptions,
  type ReceiptTemplate,
  type ReceiptTemplateContent,
  type ReceiptTemplateSource,
  type ReceiptBackSide,
} from "@/lib/console/receipt";
import { Gate, AsyncPanel } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Select,
  SegmentedControl,
  Toast,
  Toggle,
} from "@/components/console/ui";
import { ReceiptRenderer } from "@/components/terminal/receipt-renderer";

export default function ReceiptTemplatesPage() {
  return (
    <Gate permissions={["settings.tenant.read", "settings.tenant.manage"]}>
      <ReceiptTemplatesScreen />
    </Gate>
  );
}

type Selection = { kind: "template"; id: Id } | { kind: "new" } | null;

function ReceiptTemplatesScreen() {
  const { t, tx } = useI18n();
  const canManage = usePermission("settings.tenant.manage");
  const [message, setMessage] = useTransientMessage();
  const [selection, setSelection] = useState<Selection>(null);
  // A conflict message outlives the editor remount that follows the reload.
  const [conflict, setConflict] = useState(false);
  // Bumped after a write so the "which template" panel reads again.
  const [revision, setRevision] = useState(0);

  const templates = useAsync(
    () => services.receiptTemplates.list(),
    [revision],
  );
  const brands = useAsync(
    () =>
      services.organisation.brands
        .list({ limit: 200 })
        .then((page) => page.rows),
    [],
  );
  const options = useAsync(() => services.receiptTemplates.scopeOptions(), []);

  const brandName = (id: Id | null): string => {
    if (!id) return t("rcpt.allBrands");
    const found = brands.data?.find((brand) => brand.id === id);
    return found ? tx(found.name) : id.slice(0, 8);
  };
  const packName = (code: string | null): string => code ?? t("rcpt.allPacks");

  const scopeLabel = (
    template: Pick<ReceiptTemplate, "brandId" | "countryPackCode" | "scope">,
  ): string => {
    switch (template.scope) {
      case "tenant_default":
        return t("rcpt.scope.tenant_default");
      case "brand":
        return t("rcpt.scope.brand").replace(
          "{brand}",
          brandName(template.brandId),
        );
      case "country_pack":
        return t("rcpt.scope.country_pack").replace(
          "{pack}",
          packName(template.countryPackCode),
        );
      case "brand_country_pack":
        return t("rcpt.scope.brand_country_pack")
          .replace("{brand}", brandName(template.brandId))
          .replace("{pack}", packName(template.countryPackCode));
    }
  };

  const sourceLabel = (source: ReceiptTemplateSource): string =>
    source === "built_in_default"
      ? t("rcpt.source.built_in_default")
      : t(`rcpt.scope.${source}` as ConsoleKey);

  const selectedTemplate =
    selection?.kind === "template"
      ? (templates.data?.find((row) => row.id === selection.id) ?? null)
      : null;

  function afterWrite(saved: ReceiptTemplate, text: string) {
    setConflict(false);
    setMessage(text);
    setSelection({ kind: "template", id: saved.id });
    setRevision((n) => n + 1);
    templates.reload();
  }

  function afterConflict() {
    setConflict(true);
    setRevision((n) => n + 1);
    templates.reload();
  }

  return (
    <>
      <PageHeader
        title={t("rcpt.title")}
        subtitle={t("rcpt.subtitle")}
        spec="FR-POS-101/102"
      />
      <PageBody>
        {DATA_MODE === "mock" ? (
          <Callout tone="warn">
            <span data-testid="rcpt-demo-mode">{t("rcpt.demoMode")}</span>
          </Callout>
        ) : null}
        {!canManage ? (
          <Callout tone="neutral">{t("rcpt.readOnly")}</Callout>
        ) : null}
        {conflict ? (
          <Callout tone="warn">
            <span role="alert" data-testid="rcpt-conflict">
              {t("rcpt.conflict")}
            </span>
          </Callout>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Section
            title={t("rcpt.templates")}
            action={
              canManage ? (
                <Button size="sm" onClick={() => setSelection({ kind: "new" })}>
                  <Plus size={14} /> {t("rcpt.new")}
                </Button>
              ) : null
            }
          >
            <AsyncPanel
              state={templates}
              isEmpty={(rows) => rows.length === 0}
              empty={
                <p className="text-fg-muted text-sm">{t("rcpt.emptyList")}</p>
              }
            >
              {(rows) => (
                <ul className="space-y-1.5" data-testid="rcpt-list">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelection({ kind: "template", id: row.id })
                        }
                        aria-current={
                          selection?.kind === "template" &&
                          selection.id === row.id
                        }
                        className="border-line hover:bg-sunken aria-[current=true]:border-accent w-full rounded-lg border px-3 py-2 text-start text-sm"
                      >
                        <span className="block font-medium">
                          {scopeLabel(row)}
                        </span>
                        <span className="text-fg-subtle block text-xs">
                          {t(`rcpt.layout.${layoutOf(row)}` as ConsoleKey)} ·{" "}
                          {t("rcpt.version").replace(
                            "{version}",
                            String(row.version),
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </AsyncPanel>
          </Section>

          <div className="min-w-0 space-y-5">
            {selection?.kind === "new" ? (
              <AsyncPanel state={options}>
                {(scopeOptions) => (
                  <AsyncPanel state={brands}>
                    {(brandRows) => (
                      <TemplateEditor
                        key="new"
                        template={null}
                        brands={brandRows}
                        options={scopeOptions}
                        canManage={canManage}
                        scopeText={t("rcpt.creating")}
                        onSaved={(saved) =>
                          afterWrite(saved, t("rcpt.created"))
                        }
                        onConflict={afterConflict}
                      />
                    )}
                  </AsyncPanel>
                )}
              </AsyncPanel>
            ) : selectedTemplate ? (
              <AsyncPanel state={options}>
                {(scopeOptions) => (
                  <AsyncPanel state={brands}>
                    {(brandRows) => (
                      <TemplateEditor
                        key={`${selectedTemplate.id}:${selectedTemplate.version}`}
                        template={selectedTemplate}
                        brands={brandRows}
                        options={scopeOptions}
                        canManage={canManage}
                        scopeText={scopeLabel(selectedTemplate)}
                        onSaved={(saved) => afterWrite(saved, t("rcpt.saved"))}
                        onConflict={afterConflict}
                      />
                    )}
                  </AsyncPanel>
                )}
              </AsyncPanel>
            ) : null}

            <ResolvePanel
              revision={revision}
              sourceLabel={sourceLabel}
              scopeLabel={scopeLabel}
            />
          </div>
        </div>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Which template does a branch use?
// ---------------------------------------------------------------------------

function ResolvePanel({
  revision,
  sourceLabel,
  scopeLabel,
}: {
  revision: number;
  sourceLabel: (source: ReceiptTemplateSource) => string;
  scopeLabel: (
    template: Pick<ReceiptTemplate, "brandId" | "countryPackCode" | "scope">,
  ) => string;
}) {
  const { t, tx } = useI18n();
  const { availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");

  const resolved = useAsync(
    () =>
      branchId
        ? services.receiptTemplates.resolveForBranch(branchId)
        : Promise.resolve(null),
    [branchId, revision],
  );

  return (
    <Section title={t("rcpt.resolveTitle")} hint={t("rcpt.resolvedInputs")}>
      <div className="max-w-sm">
        <Field label={t("rcpt.resolveBranch")}>
          <Select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">{t("rcpt.resolvePick")}</option>
            {availableBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {branchId ? (
        <div className="mt-4" data-testid="rcpt-resolved">
          <AsyncPanel state={resolved}>
            {(result) =>
              result ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-fg-muted">
                    {t("rcpt.resolvedFrom")}
                  </span>
                  <Badge tone={result.isDefault ? "muted" : "accent"}>
                    {result.templateId
                      ? scopeLabel({
                          scope:
                            result.source === "built_in_default"
                              ? "tenant_default"
                              : result.source,
                          brandId: result.resolvedFor?.brandId ?? null,
                          countryPackCode:
                            result.resolvedFor?.countryPackCode ?? null,
                        })
                      : sourceLabel(result.source)}
                  </Badge>
                  {result.version != null ? (
                    <span className="text-fg-subtle text-xs">
                      {t("rcpt.version").replace(
                        "{version}",
                        String(result.version),
                      )}
                    </span>
                  ) : null}
                  <span className="text-fg-subtle text-xs">
                    {t(
                      `rcpt.layout.${layoutOf(result.template)}` as ConsoleKey,
                    )}
                  </span>
                </div>
              ) : null
            }
          </AsyncPanel>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

/**
 * A labelled group of buttons. Not a `Field`: that renders a <label>, and a
 * <label> around several buttons would name the first one after the whole group.
 */
function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="text-fg block text-xs font-medium">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <span className="text-fg-subtle mt-1 block text-xs">{hint}</span>
      ) : null}
    </div>
  );
}

const BLANK_LINE: Localised = { en: "", ar: "" };

function contentOf(template: ReceiptTemplate | null): ReceiptTemplateContent {
  return template
    ? {
        languageMode: template.languageMode,
        bothOrder: template.bothOrder,
        logoUrl: template.logoUrl,
        backSide: template.backSide ?? "none",
        options: optionsOf(template),
        headerLines: template.headerLines,
        footerLines: template.footerLines,
      }
    : {
        languageMode: "bilingual",
        bothOrder: "ar_first",
        logoUrl: null,
        backSide: "none",
        options: optionsOf({}),
        headerLines: [],
        footerLines: [],
      };
}

/** One titled part of the editor, with a plain-words line on what it controls. */
function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-fg text-sm font-semibold">{title}</h3>
        {hint ? (
          <p className="text-fg-subtle mt-0.5 text-xs leading-relaxed">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The language picker's three answers: one language, or both. */
type Language = "ar" | "en" | "both";
type First = "ar" | "en";

const languageOf = (layout: ReceiptLayout): Language =>
  layout === "ar" ? "ar" : layout === "en" ? "en" : "both";

const layoutFrom = (language: Language, first: First): ReceiptLayout =>
  language === "both" ? (first === "en" ? "en_ar" : "ar_en") : language;

function TemplateEditor({
  template,
  brands,
  options,
  canManage,
  scopeText,
  onSaved,
  onConflict,
}: {
  /** Null: a template being created. */
  template: ReceiptTemplate | null;
  brands: Brand[];
  options: ReceiptScopeOptions;
  canManage: boolean;
  scopeText: string;
  onSaved: (saved: ReceiptTemplate) => void;
  onConflict: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const start = contentOf(template);
  const startOptions = optionsOf(start);

  const startLayout = layoutOf(start);
  const [language, setLanguage] = useState<Language>(languageOf(startLayout));
  // Which language goes on top when both print; kept even while one language is chosen.
  const [first, setFirst] = useState<First>(
    start.bothOrder === "en_first" ? "en" : "ar",
  );
  const [logo, setLogo] = useState(start.logoUrl ?? "");
  const [backSide, setBackSide] = useState<ReceiptBackSide>(
    start.backSide ?? "none",
  );
  const [opts, setOpts] = useState<ReceiptOptions>(startOptions);
  const [header, setHeader] = useState<Localised[]>(start.headerLines);
  const [footer, setFooter] = useState<Localised[]>(start.footerLines);
  // Preview only — never sent to the backend.
  const [paper, setPaper] = useState<PaperWidth>(80);
  // The scope of a template being created; fixed once it exists.
  const [brandId, setBrandId] = useState("");
  const [pack, setPack] = useState(options.tenantCountryPackCode);

  const layout = layoutFrom(language, first);
  // The editor no longer offers suggested tips; whatever is stored stays as it is.
  const tips: number[] = [...startOptions.suggestedTips];
  const setOption = <K extends keyof ReceiptOptions>(
    key: K,
    value: ReceiptOptions[K],
  ) => setOpts((current) => ({ ...current, [key]: value }));

  const draft: ReceiptTemplateContent = {
    ...start,
    ...languageFieldsOf(layout),
    bothOrder: languageFieldsOf(layout).bothOrder ?? start.bothOrder,
    logoUrl: logo.trim() === "" ? null : logo.trim(),
    backSide,
    options: { ...opts, suggestedTips: tips },
    headerLines: header,
    footerLines: footer,
  };

  const issues = receiptContentIssues(draft);
  const sectionName = (field: "headerLines" | "footerLines") =>
    field === "headerLines" ? t("rcpt.header") : t("rcpt.footer");
  const issueText = (issue: (typeof issues)[number]): string => {
    switch (issue.code) {
      case "logoNotHttps":
        return t("rcpt.err.logoNotHttps");
      case "backSideNeedsLogo":
        return t("rcpt.err.backSideNeedsLogo");
      case "badTips":
        return t("rcpt.err.badTips");
      case "tooManyLines":
        return t("rcpt.err.tooManyLines")
          .replace("{section}", sectionName(issue.field))
          .replace("{max}", String(RECEIPT_MAX_LINES));
      case "lineTooLong":
        return t("rcpt.err.lineTooLong")
          .replace("{section}", sectionName(issue.field))
          .replace("{line}", String(issue.index + 1))
          .replace("{chars}", String(RECEIPT_MAX_LINE_LENGTH));
      case "lineEmpty":
        return t("rcpt.err.lineEmpty")
          .replace("{section}", sectionName(issue.field))
          .replace("{line}", String(issue.index + 1));
    }
  };

  const changed = template ? !sameContent(start, draft) : true;
  const canSave =
    canManage && changed && issues.length === 0 && !action.pending;

  async function save() {
    if (!canSave) return;
    if (template) {
      await action.run(
        () =>
          services.receiptTemplates.update(template.id, {
            version: template.version,
            ...contentChanges(start, draft),
          }),
        {
          onSuccess: onSaved,
          onError: (error) => {
            if (error.code === "CONFLICT") onConflict();
          },
        },
      );
      return;
    }
    await action.run(
      () =>
        services.receiptTemplates.create({
          brandId: brandId || null,
          countryPackCode: pack || null,
          ...draft,
        }),
      { onSuccess: onSaved },
    );
  }

  const previewTemplate: ReceiptTemplateContent = {
    ...draft,
    // A link the backend would refuse is not fetched by the preview either.
    logoUrl: draft.logoUrl && isHttpsUrl(draft.logoUrl) ? draft.logoUrl : null,
    // A malformed tips list previews as none until it is fixed.
    options: {
      ...opts,
      suggestedTips: issues.some((issue) => issue.code === "badTips") ? [] : tips,
    },
  };

  return (
    <div
      className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
      data-testid="rcpt-editor"
    >
      <Section
        title={scopeText}
        hint={template ? t("rcpt.scopeFixed") : undefined}
      >
        <div className="space-y-5">
          {template ? null : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("rcpt.brand")}>
                <Select
                  aria-label={t("rcpt.brand")}
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">{t("rcpt.allBrands")}</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {tx(brand.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("rcpt.countryPack")}
                hint={t("rcpt.tenantPackHint")}
              >
                <Select
                  aria-label={t("rcpt.countryPack")}
                  value={pack}
                  onChange={(event) => setPack(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">{t("rcpt.allPacks")}</option>
                  {options.loadedCountryPackCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <Block title={t("rcpt.block.language")} hint={t("rcpt.langHint")}>
            <Group label={t("rcpt.lang")}>
              <div>
                <SegmentedControl<Language>
                  label={t("rcpt.lang")}
                  value={language}
                  onChange={setLanguage}
                  options={(["ar", "en", "both"] as const).map((value) => ({
                    value,
                    label: t(`rcpt.lang.${value}` as ConsoleKey),
                  }))}
                />
              </div>
            </Group>
            {language === "both" ? (
              <Group label={t("rcpt.langFirst")} hint={t("rcpt.langFirstHint")}>
                <div>
                  <SegmentedControl<First>
                    label={t("rcpt.langFirst")}
                    value={first}
                    onChange={setFirst}
                    options={(["ar", "en"] as const).map((value) => ({
                      value,
                      label: t(`rcpt.langFirst.${value}` as ConsoleKey),
                    }))}
                  />
                </div>
              </Group>
            ) : null}
          </Block>

          <Block title={t("rcpt.block.brand")} hint={t("rcpt.block.brandHint")}>
            <Field label={t("rcpt.logo")} hint={t("rcpt.logoHint")}>
              <Input
                type="url"
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                aria-label={t("rcpt.logo")}
                value={logo}
                onChange={(event) => setLogo(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            <LinesEditor
              title={t("rcpt.header")}
              hint={t("rcpt.headerHint")}
              lines={header}
              onChange={setHeader}
              disabled={!canManage}
              testId="rcpt-header-lines"
            />
          </Block>

          <Block title={t("rcpt.block.show")} hint={t("rcpt.fiscalNote")}>
            <div className="divide-line divide-y" data-testid="rcpt-show">
              {RECEIPT_SHOW_OPTIONS.map((key) => (
                <Toggle
                  key={key}
                  checked={opts[key]}
                  onChange={(next) => setOption(key, next)}
                  label={t(`rcpt.show.${key}` as ConsoleKey)}
                  disabled={!canManage}
                />
              ))}
            </div>
          </Block>

          <Block title={t("rcpt.block.signature")}>
            <Toggle
              checked={opts.signatureLine}
              onChange={(next) => setOption("signatureLine", next)}
              label={t("rcpt.signatureLine")}
              hint={t("rcpt.signatureLineHint")}
              disabled={!canManage}
            />
          </Block>

          <Block title={t("rcpt.block.footer")}>
            <LinesEditor
              title={t("rcpt.footer")}
              hint={t("rcpt.footerHint")}
              lines={footer}
              onChange={setFooter}
              disabled={!canManage}
              testId="rcpt-footer-lines"
            />
          </Block>

          <Block title={t("rcpt.block.style")}>
            <Group label={t("rcpt.style")} hint={t("rcpt.styleHint")}>
              <div>
                <SegmentedControl<ReceiptPaperStyle>
                  label={t("rcpt.style")}
                  value={opts.paperStyle}
                  onChange={(next) => setOption("paperStyle", next)}
                  options={RECEIPT_PAPER_STYLES.map((value) => ({
                    value,
                    label: t(`rcpt.style.${value}` as ConsoleKey),
                  }))}
                />
              </div>
            </Group>
            <Group label={t("rcpt.backSide")} hint={t("rcpt.backSideHint")}>
              <div>
                <SegmentedControl<ReceiptBackSide>
                  label={t("rcpt.backSide")}
                  value={backSide}
                  onChange={setBackSide}
                  options={RECEIPT_BACK_SIDES.map((value) => ({
                    value,
                    label: t(`rcpt.backSide.${value}` as ConsoleKey),
                  }))}
                />
              </div>
            </Group>
          </Block>

          {issues.length > 0 ? (
            <Callout tone="warn">
              <ul className="list-disc ps-4" data-testid="rcpt-issues">
                {issues.map((issue, index) => (
                  <li key={index}>{issueText(issue)}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {action.error ? (
            <Callout tone="bad">
              <span role="alert" data-testid="rcpt-error">
                {action.error}
              </span>
            </Callout>
          ) : null}

          {canManage ? (
            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={!canSave}>
                {template ? t("rcpt.save") : t("rcpt.create")}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <Section title={t("rcpt.preview")} hint={t("rcpt.previewNote")}>
          <div className="mb-3">
            <Group label={t("rcpt.paper")} hint={t("rcpt.paperNote")}>
              <div>
                <SegmentedControl<"58" | "80">
                  label={t("rcpt.paper")}
                  value={String(paper) as "58" | "80"}
                  onChange={(next) => setPaper(next === "58" ? 58 : 80)}
                  options={[
                    { value: "58", label: t("rcpt.paper58") },
                    { value: "80", label: t("rcpt.paper80") },
                  ]}
                />
              </div>
            </Group>
          </div>
          <div className="overflow-x-auto" data-testid="rcpt-preview">
            <ReceiptRenderer
              document={previewReceiptDocument()}
              template={previewTemplate}
              paper={paper}
              backCaption={t("rcpt.backCaption")}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function LinesEditor({
  title,
  hint,
  lines,
  onChange,
  disabled,
  testId,
}: {
  title: string;
  /** What the lines are for, in plain words. */
  hint?: string;
  lines: Localised[];
  onChange: (next: Localised[]) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useI18n();
  const set = (index: number, patch: Partial<Localised>) =>
    onChange(
      lines.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    );

  return (
    <fieldset data-testid={testId} className="space-y-2">
      <legend className="text-fg text-xs font-medium">{title}</legend>
      {hint ? <p className="text-fg-subtle text-xs leading-relaxed">{hint}</p> : null}
      <p className="text-fg-subtle text-xs">
        {t("rcpt.linesHint")
          .replace("{max}", String(RECEIPT_MAX_LINES))
          .replace("{chars}", String(RECEIPT_MAX_LINE_LENGTH))}
      </p>
      {lines.map((line, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_1fr_auto] items-start gap-2"
        >
          <Input
            dir="ltr"
            lang="en"
            aria-label={`${title} ${index + 1} — ${t("rcpt.lineEn")}`}
            placeholder={t("rcpt.lineEn")}
            value={line.en}
            onChange={(event) => set(index, { en: event.target.value })}
            disabled={disabled}
          />
          <Input
            dir="rtl"
            lang="ar"
            aria-label={`${title} ${index + 1} — ${t("rcpt.lineAr")}`}
            placeholder={t("rcpt.lineAr")}
            value={line.ar}
            onChange={(event) => set(index, { ar: event.target.value })}
            disabled={disabled}
          />
          {disabled ? null : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t("rcpt.removeLine")} ${index + 1}`}
              onClick={() => onChange(lines.filter((_, at) => at !== index))}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      ))}
      {disabled ? null : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...lines, { ...BLANK_LINE }])}
          disabled={lines.length >= RECEIPT_MAX_LINES}
        >
          <Plus size={14} /> {t("rcpt.addLine")}
        </Button>
      )}
    </fieldset>
  );
}
