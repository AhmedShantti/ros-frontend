"use client";

/**
 * Country pack authoring and validation — FR-LOC-025, FR-LOC-030.
 *
 * A new jurisdiction is produced here as data: the tax model is chosen from
 * the registered strategies (never typed as an engine name), its parameters
 * are filled in, and the draft is validated live with each problem shown
 * beside the field it concerns. Running the conformance suite and certifying
 * both go through `services.localisation.packVersions`, which re-validates —
 * a refused certification is refused by the service, not only by this form.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, FlaskConical, Save, X } from "lucide-react";

import {
  ISO_EXPONENT,
  STRATEGY_BY_ID,
  TAX_CLASS_CODES,
  TAX_STRATEGIES,
  WEEKDAYS,
  blankVersion,
  validatePack,
  type CountryPackVersion,
  type PackProblem,
} from "@/lib/console/country-pack-authoring";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { numberFromInput } from "@/lib/console/format";
import { LocalisedField } from "@/components/console/fields";
import { Section } from "@/components/console/page";
import { Badge, Button, Callout, Field, Input, Select, Textarea, Toggle, cx } from "@/components/console/ui";
import { ConformanceTable, ProblemList } from "@/components/console/country-pack-versions";

type Draft = CountryPackVersion;

function fieldError(problems: PackProblem[], field: string): string | null {
  const hit = problems.find((row) => row.severity === "error" && (row.field === field || row.field.startsWith(`${field}.`)));
  return hit?.message ?? null;
}

/** A number input that keeps what was typed and reports NaN for unreadable text, which the validator refuses. */
function NumberInput({
  value,
  onChange,
  nullable,
  className,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  nullable?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value === null || Number.isNaN(value) ? "" : String(value));
  useEffect(() => {
    const parsed = numberFromInput(text);
    if (parsed !== value && !(value !== null && Number.isNaN(value) && parsed === null)) {
      setText(value === null || Number.isNaN(value) ? "" : String(value));
    }
    // Only when the value is replaced from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      className={cx("font-mono", className)}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = numberFromInput(event.target.value);
        onChange(parsed === null ? (nullable ? null : Number.NaN) : parsed);
      }}
    />
  );
}

export function PackEditor({
  versionId,
  versions,
  onSaved,
  onClose,
}: {
  /** Null: a new pack. */
  versionId: string | null;
  versions: CountryPackVersion[];
  onSaved: (message: string, id: string) => void;
  onClose: () => void;
}) {
  const { t, tx } = useI18n();
  const { session } = useSession();
  const action = useAction();
  const source = versionId ? versions.find((row) => row.id === versionId) ?? null : null;
  const [draft, setDraft] = useState<Draft>(() => source ?? { id: "", ...blankVersion() });
  const [dirty, setDirty] = useState(false);

  // Service writes (conformance, certification) come back through `versions`.
  useEffect(() => {
    if (source && !dirty) setDraft(source);
  }, [source, dirty]);

  const readOnly = draft.status !== "draft";
  const problems = useMemo(() => validatePack(draft, versions), [draft, versions]);
  const errors = problems.filter((row) => row.severity === "error");
  const strategy = STRATEGY_BY_ID.get(draft.taxEngine);
  const by = session ? tx(session.user.name) : null;

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  const err = (field: string) => fieldError(problems, field);

  async function persist(): Promise<string | null> {
    const { id, ...body } = draft;
    const saved = await action.run(() =>
      id ? services.localisation.packVersions.update(id, body) : services.localisation.packVersions.create({ ...body, createdBy: by }),
    );
    if (!saved) return null;
    setDraft(saved);
    setDirty(false);
    return saved.id;
  }

  async function save() {
    const id = await persist();
    if (id) onSaved(t("cpv.saved"), id);
  }

  async function conformance() {
    const id = dirty || !draft.id ? await persist() : draft.id;
    if (!id) return;
    const result = await action.run(() => services.localisation.packVersions.runConformance(id));
    if (result) {
      setDraft(result);
      setDirty(false);
      onSaved(result.conformance?.passed ? t("cpv.conformanceRanPass") : t("cpv.conformanceRanFail"), id);
    }
  }

  async function certify() {
    const id = dirty || !draft.id ? await persist() : draft.id;
    if (!id) return;
    const result = await action.run(() => services.localisation.packVersions.certify(id, by));
    if (result) {
      setDraft(result);
      setDirty(false);
      onSaved(t("cpv.certifiedDone").replace("{version}", `${result.code} ${result.version}`), id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-fg text-base font-semibold">
            {draft.id ? `${draft.code || "—"} · ${draft.version}` : t("cpv.newPack")}
          </h2>
          <p className="text-fg-muted text-xs">{readOnly ? t("cpv.readOnlyNote") : t("cpv.authoringNote")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={<X size={14} />} onClick={onClose}>
            {t("common.close")}
          </Button>
          {!readOnly ? (
            <>
              <Button icon={<Save size={14} />} onClick={save} loading={action.pending} disabled={!dirty && Boolean(draft.id)}>
                {t("cpv.saveDraft")}
              </Button>
              <Button icon={<FlaskConical size={14} />} onClick={conformance} disabled={action.pending}>
                {t("cpv.runConformance")}
              </Button>
              <Button variant="primary" icon={<ShieldCheck size={14} />} onClick={certify} disabled={action.pending || errors.length > 0}>
                {t("cpv.certify")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {!readOnly && errors.length > 0 ? <Callout tone="muted">{t("cpv.certifyBlocked")}</Callout> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          <Section title={t("cpv.sectionIdentity")}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("common.code")} required error={err("code")} hint={t("cpv.codeHint")}>
                <Input dir="ltr" maxLength={2} className="font-mono uppercase" value={draft.code} onChange={(event) => patch({ code: event.target.value.toUpperCase() })} />
              </Field>
              <Field label={t("cp.version")} required error={err("version")}>
                <Input dir="ltr" className="font-mono" value={draft.version} onChange={(event) => patch({ version: event.target.value.trim() })} />
              </Field>
              <Field label={t("cp.effectiveFrom")} required error={err("effectiveFrom")}>
                <Input type="date" dir="ltr" value={draft.effectiveFrom} onChange={(event) => patch({ effectiveFrom: event.target.value })} />
              </Field>
            </div>
            <div className="mt-3">
              <LocalisedField label={t("common.name")} required value={draft.name} onChange={(name) => patch({ name })} error={err("name")} />
            </div>
          </Section>

          {/* FR-LOC-025 — the tax model is one of the registered strategies, chosen, never typed. */}
          <Section title={t("cpv.sectionTax")}>
            <div className="space-y-3">
              <Field label={t("cpv.strategy")} required error={err("taxEngine")} hint={t("cpv.strategyHint")}>
                <Select value={draft.taxEngine} onChange={(event) => patch({ taxEngine: event.target.value, taxParams: {} })}>
                  {!strategy ? <option value={draft.taxEngine}>{draft.taxEngine} ({t("cpv.unregistered")})</option> : null}
                  {TAX_STRATEGIES.map((row) => (
                    <option key={row.id} value={row.id}>
                      {tx(row.label)}
                    </option>
                  ))}
                </Select>
              </Field>
              {strategy ? (
                <p className="text-fg-muted text-xs">
                  {tx(strategy.description)}
                  {strategy.requiresFiscalProvider ? (
                    <> {t("cpv.requiresFiscal").replace("{provider}", strategy.requiresFiscalProvider.join(", "))}</>
                  ) : null}
                </p>
              ) : null}
              {strategy && strategy.params.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {strategy.params.map((param) => (
                    <Field
                      key={param.key}
                      label={tx(param.label)}
                      required
                      error={err(`taxParams.${param.key}`)}
                      hint={`${param.min} – ${param.max}`}
                    >
                      <NumberInput
                        value={draft.taxParams[param.key] ?? null}
                        nullable
                        onChange={(next) => {
                          const taxParams = { ...draft.taxParams };
                          if (next === null) delete taxParams[param.key];
                          else taxParams[param.key] = next;
                          patch({ taxParams });
                        }}
                      />
                    </Field>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("cp.pricingMode")}>
                  <Select value={draft.pricingMode} onChange={(event) => patch({ pricingMode: event.target.value as Draft["pricingMode"] })}>
                    <option value="tax_inclusive">{t("fin.taxInclusive")}</option>
                    <option value="tax_exclusive">{t("fin.taxExclusive")}</option>
                  </Select>
                </Field>
                <Field label={t("cp.rounding")} error={err("roundingMode")}>
                  <Select value={draft.roundingMode} onChange={(event) => patch({ roundingMode: event.target.value as Draft["roundingMode"] })}>
                    <option value="HALF_UP">HALF_UP</option>
                    <option value="HALF_EVEN">HALF_EVEN</option>
                    <option value="DOWN">DOWN</option>
                  </Select>
                </Field>
                <Field label={t("cp.computationLevel")}>
                  <Select value={draft.computationLevel} onChange={(event) => patch({ computationLevel: event.target.value as Draft["computationLevel"] })}>
                    <option value="line">{t("fin.perLine")}</option>
                    <option value="order">{t("fin.perOrder")}</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("org.currency")} required error={err("currency")}>
                  <Select
                    value={draft.currency}
                    onChange={(event) => patch({ currency: event.target.value, currencyExponent: ISO_EXPONENT[event.target.value] ?? draft.currencyExponent })}
                  >
                    <option value="">—</option>
                    {Object.keys(ISO_EXPONENT).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("cpv.exponent")} error={err("currencyExponent")} hint={t("cpv.exponentHint")}>
                  <NumberInput value={draft.currencyExponent} onChange={(next) => patch({ currencyExponent: next ?? Number.NaN })} />
                </Field>
                <Field label={t("cp.fiscal")} error={err("fiscalProvider")}>
                  <Input dir="ltr" className="font-mono" value={draft.fiscalProvider ?? ""} placeholder="zatca_fatoora" onChange={(event) => patch({ fiscalProvider: event.target.value.trim() || null })} />
                </Field>
                <Field label={t("cpv.fiscalMode")} error={err("fiscalMode")}>
                  <Input dir="ltr" className="font-mono" value={draft.fiscalMode ?? ""} onChange={(event) => patch({ fiscalMode: event.target.value.trim() || null })} />
                </Field>
              </div>
            </div>
          </Section>

          <Section
            title={t("cp.taxClasses")}
            action={
              !readOnly ? (
                <Button
                  variant="ghost"
                  icon={<Plus size={13} />}
                  onClick={() => {
                    const used = new Set(draft.taxClasses.map((row) => row.code));
                    const code = TAX_CLASS_CODES.find((value) => !used.has(value)) ?? "standard";
                    patch({ taxClasses: [...draft.taxClasses, { code, rate: code === "exempt" ? null : 0, label: { en: "", ar: "" } }] });
                  }}
                >
                  {t("common.add")}
                </Button>
              ) : null
            }
          >
            {err("taxClasses") && !draft.taxClasses.some((_, index) => err(`taxClasses[${index}]`)) ? (
              <p className="text-bad mb-2 text-xs">{err("taxClasses")}</p>
            ) : null}
            <ul className="space-y-3">
              {draft.taxClasses.map((taxClass, index) => {
                const update = (next: Partial<typeof taxClass>) =>
                  patch({ taxClasses: draft.taxClasses.map((row, i) => (i === index ? { ...row, ...next } : row)) });
                const rowError = err(`taxClasses[${index}]`);
                return (
                  <li key={index} className={cx("border-line rounded-lg border p-3", rowError && "border-bad/50")}>
                    <div className="grid gap-3 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_auto]">
                      <Field label={t("common.code")}>
                        <Select
                          value={taxClass.code}
                          onChange={(event) => update({ code: event.target.value, rate: event.target.value === "exempt" ? null : (taxClass.rate ?? 0) })}
                        >
                          {TAX_CLASS_CODES.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t("cpv.ratePercent")} hint={taxClass.code === "exempt" ? t("cpv.exemptHint") : undefined}>
                        <NumberInput value={taxClass.rate} nullable onChange={(rate) => update({ rate })} />
                      </Field>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label={t("loc.english")}>
                          <Input dir="ltr" value={taxClass.label.en} onChange={(event) => update({ label: { ...taxClass.label, en: event.target.value } })} />
                        </Field>
                        <Field label={t("loc.arabic")}>
                          <Input dir="rtl" lang="ar" value={taxClass.label.ar} onChange={(event) => update({ label: { ...taxClass.label, ar: event.target.value } })} />
                        </Field>
                      </div>
                      {!readOnly ? (
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => patch({ taxClasses: draft.taxClasses.filter((_, i) => i !== index) })}
                          >
                            {t("common.remove")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {rowError ? <p className="text-bad mt-1 text-xs">{rowError}</p> : null}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title={t("nav.workforce")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("cp.weekStart")} error={err("weekStart")}>
                <Select value={draft.weekStart} onChange={(event) => patch({ weekStart: event.target.value })}>
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <span className="text-fg text-xs font-medium">{t("cp.weekend")}</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={t("cp.weekend")}>
                  {WEEKDAYS.map((day) => {
                    const on = draft.weekend.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        onClick={() => patch({ weekend: on ? draft.weekend.filter((row) => row !== day) : [...draft.weekend, day] })}
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-xs",
                          on ? "bg-accent-soft text-accent border-accent/30" : "border-line text-fg-muted",
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                {err("weekend") ? <p className="text-bad mt-1 text-xs">{err("weekend")}</p> : null}
              </div>
              <Field label={t("cp.weeklyHours")} error={err("standardWeeklyHours")}>
                <NumberInput value={draft.standardWeeklyHours} onChange={(next) => patch({ standardWeeklyHours: next ?? Number.NaN })} />
              </Field>
              <Field label={t("cp.overtimeMultiplier")} error={err("overtimeMultiplier")}>
                <NumberInput value={draft.overtimeMultiplier} onChange={(next) => patch({ overtimeMultiplier: next ?? Number.NaN })} />
              </Field>
              <Field label={`${t("cp.retention")} (${t("cp.years")})`} error={err("dataRetentionYears")}>
                <NumberInput value={draft.dataRetentionYears} onChange={(next) => patch({ dataRetentionYears: next ?? Number.NaN })} />
              </Field>
            </div>
            <Toggle
              checked={draft.hijriCalendar}
              onChange={(hijriCalendar) => patch({ hijriCalendar })}
              label={t("cpv.hijri")}
              hint={t("cpv.hijriHint")}
              disabled={readOnly}
            />
          </Section>

          <Section title={t("cpv.changeNote")}>
            <Textarea rows={3} value={draft.changeNote} onChange={(event) => patch({ changeNote: event.target.value })} placeholder={t("cpv.changeNotePlaceholder")} />
          </Section>
        </fieldset>

        <div className="space-y-4">
          <Section title={t("cpv.validation")} hint={t("cpv.validationHint")}>
            <ProblemList problems={problems} certified={draft.status === "certified"} />
          </Section>
          <Section
            title={t("cp.conformance")}
            action={dirty && draft.conformance ? <Badge tone="warn">{t("cpv.stale")}</Badge> : null}
          >
            <ConformanceTable version={draft} />
          </Section>
        </div>
      </div>
    </div>
  );
}
