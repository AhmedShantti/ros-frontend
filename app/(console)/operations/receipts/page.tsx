"use client";

/**
 * Receipt templates — SRS §8.8, FR-POS-100 … FR-POS-102.
 *
 * One template per brand and country at most, a tenant default underneath,
 * and a live preview at the paper's real width beside the form. The preview
 * is the point: a header that wraps onto three lines on a 58 mm roll, or a
 * bilingual layout that doubles the receipt's length, is obvious in the
 * preview and invisible in a form.
 *
 * For Saudi Arabia the QR is not decoration: a simplified tax invoice must
 * carry the ZATCA TLV (seller, VAT number, time, total, VAT), and the
 * preview renders the real code with what it decodes to underneath.
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, Printer, Trash2 } from "lucide-react";

import type { CountryCode, CountryPack, Localised, MenuItem } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { blankTemplate } from "@/lib/console/services/receipt-templates";
import {
  columnsFor,
  readZatcaTlv,
  renderReceipt,
  resolveTemplate,
  validSaudiVat,
  zatcaTlv,
  type ReceiptInput,
  type ReceiptLayout,
  type ReceiptTemplate,
} from "@/lib/console/receipt";
import { SETTING_BY_KEY, resolveSetting } from "@/lib/console/settings";
import { encodeQr, qrSvgPath } from "@/lib/console/qr";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import type { ConsoleKey } from "@/locales";
import { useConfirmDelete } from "@/components/console/confirm";
import { EMPTY_LOCALISED, LocalisedField } from "@/components/console/fields";
import { PageBody, PageHeader } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  SegmentedControl,
  Select,
  Toast,
  Toggle,
  cx,
} from "@/components/console/ui";

export default function ReceiptTemplatesPage() {
  return (
    <Gate permissions={["settings.branch.manage", "settings.tenant.manage"]}>
      <ReceiptTemplatesScreen />
    </Gate>
  );
}

const COUNTRIES: CountryCode[] = ["EG", "SA", "AE", "JO", "KW", "QA"];

function ReceiptTemplatesScreen() {
  const { t, tx } = useI18n();
  const { availableBrands } = useSession();
  const [message, setMessage] = useTransientMessage();
  const templates = useAsync(() => services.receiptTemplates.all(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const action = useAction(setMessage);

  const rows = templates.data ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const describeScope = (row: ReceiptTemplate) =>
    [
      row.brandId ? tx(availableBrands.find((brand) => brand.id === row.brandId)?.name) || row.brandId : t("rcpt.allBrands"),
      row.countryCode ?? t("rcpt.allCountries"),
    ].join(" · ");

  async function create() {
    await action.run(() => services.receiptTemplates.create({ ...blankTemplate({ name: t("rcpt.newName"), active: false }) }), {
      onSuccess: (created) => {
        templates.reload();
        setSelectedId(created.id);
      },
      success: t("rcpt.created"),
    });
  }

  return (
    <>
      <PageHeader
        title={t("rcpt.title")}
        subtitle={t("rcpt.subtitle")}
        spec="FR-POS-101"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} loading={action.pending} onClick={() => void create()}>
            {t("rcpt.new")}
          </Button>
        }
      />
      <PageBody>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <AsyncPanel state={templates}>
          {() => (
            <div className="grid gap-5 xl:grid-cols-[16rem_minmax(0,1fr)]">
              <nav aria-label={t("rcpt.title")} className="space-y-1.5">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    aria-current={selected?.id === row.id}
                    className={cx(
                      "w-full rounded-lg border px-3 py-2 text-start transition-colors",
                      selected?.id === row.id ? "border-accent bg-accent-soft/40" : "border-line bg-raised hover:bg-sunken",
                    )}
                  >
                    <span className="text-fg flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{row.name}</span>
                      {!row.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}
                    </span>
                    <span className="text-fg-subtle block truncate text-xs">{describeScope(row)}</span>
                  </button>
                ))}
              </nav>
              {selected ? (
                <TemplateEditor
                  key={selected.id}
                  template={selected}
                  all={rows}
                  onSaved={(note) => {
                    templates.reload();
                    setMessage(note);
                  }}
                  onDeleted={() => {
                    setSelectedId(null);
                    templates.reload();
                    setMessage(t("rcpt.deleted"));
                  }}
                />
              ) : null}
            </div>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Floyd–Steinberg to 1-bit at the printer's dot width — thermal heads print black or nothing. */
async function ditherLogo(file: File, dots: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not an image this browser can read."));
      element.src = url;
    });
    const width = Math.min(dots, Math.round(dots * 0.6), image.width);
    const height = Math.max(1, Math.round((image.height * width) / image.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      const r = data.data[i * 4]!;
      const g = data.data[i * 4 + 1]!;
      const b = data.data[i * 4 + 2]!;
      const a = data.data[i * 4 + 3]! / 255;
      gray[i] = 255 - a * (255 - (0.299 * r + 0.587 * g + 0.114 * b));
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const old = gray[i]!;
        const next = old < 128 ? 0 : 255;
        const error = old - next;
        gray[i] = next;
        if (x + 1 < width) gray[i + 1]! += (error * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) gray[i + width - 1]! += (error * 3) / 16;
          gray[i + width]! += (error * 5) / 16;
          if (x + 1 < width) gray[i + width + 1]! += error / 16;
        }
      }
    }
    for (let i = 0; i < width * height; i += 1) {
      const value = gray[i]! < 128 ? 0 : 255;
      data.data[i * 4] = value;
      data.data[i * 4 + 1] = value;
      data.data[i * 4 + 2] = value;
      data.data[i * 4 + 3] = 255;
    }
    context.putImageData(data, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LinesEditor({
  label,
  lines,
  onChange,
}: {
  label: string;
  lines: Localised[];
  onChange: (next: Localised[]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-fg text-xs font-medium">{label}</span>
        <Button size="sm" variant="ghost" icon={<Plus size={12} />} disabled={lines.length >= 6} onClick={() => onChange([...lines, { ...EMPTY_LOCALISED }])}>
          {t("common.add")}
        </Button>
      </div>
      {lines.map((line, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="flex-1">
            <LocalisedField
              label={`${label} ${index + 1}`}
              value={line}
              onChange={(next) => onChange(lines.map((row, i) => (i === index ? next : row)))}
              maxLength={80}
            />
          </div>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} aria-label={t("common.remove")} onClick={() => onChange(lines.filter((_, i) => i !== index))} />
        </div>
      ))}
    </div>
  );
}

function TemplateEditor({
  template,
  all,
  onSaved,
  onDeleted,
}: {
  template: ReceiptTemplate;
  all: ReceiptTemplate[];
  onSaved: (message: string) => void;
  onDeleted: () => void;
}) {
  const { t, tx } = useI18n();
  const { availableBrands, tenant } = useSession();
  const confirmDelete = useConfirmDelete();
  const action = useAction();
  const [draft, setDraft] = useState<ReceiptTemplate>(template);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<ReceiptTemplate>) => setDraft((current) => ({ ...current, ...patch }));
  const setShow = (key: keyof ReceiptTemplate["show"], value: boolean) =>
    setDraft((current) => ({ ...current, show: { ...current.show, [key]: value } }));

  const context = useAsync(async () => {
    const [overrides, packs, items] = await Promise.all([
      services.settings.overrides().catch(() => []),
      services.platform.countryPacks.list({ limit: 50 }).then((page) => page.rows).catch(() => [] as CountryPack[]),
      services.catalogue.items.list({ limit: 3 }).then((page) => page.rows).catch(() => [] as MenuItem[]),
    ]);
    return { overrides, packs, items };
  }, []);

  const inheritedLayout = String(
    resolveSetting(SETTING_BY_KEY.get("pos.receiptLanguages")!, context.data?.overrides ?? [], {
      countryCode: draft.countryCode ?? tenant.countryCode,
      tenantId: tenant.id,
      brandId: draft.brandId,
      branchId: null,
      terminalId: null,
    }).value,
  ) as ReceiptLayout;
  const layout: ReceiptLayout = draft.layout ?? inheritedLayout;

  const clash = all.find(
    (row) => row.id !== draft.id && row.active && draft.active && row.brandId === draft.brandId && row.countryCode === draft.countryCode,
  );
  const zatcaNeeded = draft.countryCode === "SA" || draft.qr === "zatca";
  const vatBad = draft.qr === "zatca" && !validSaudiVat(draft.taxRegistration);

  const problems = [
    !draft.name.trim() ? t("rcpt.needName") : null,
    !draft.legalName.en.trim() && !draft.legalName.ar.trim() ? t("rcpt.needLegal") : null,
    clash ? t("rcpt.clash").replace("{name}", clash.name) : null,
    vatBad ? t("rcpt.badVat") : null,
  ].filter((row): row is string => row !== null);

  // A preview order: the first items on the catalogue, or a fixed sample if
  // the catalogue is empty. It is labelled as a preview, never as a sale.
  const pack = (context.data?.packs ?? []).find((row) => row.code === (draft.countryCode ?? tenant.countryCode));
  const rate = pack?.taxClasses.find((row) => row.code === "standard")?.rate ?? 0;
  const input: ReceiptInput = useMemo(() => {
    const source = (context.data?.items ?? []).slice(0, 3);
    const lines = (source.length > 0
      ? source.map((item, index) => ({
          quantity: index === 0 ? 2 : 1,
          name: item.receiptName ?? item.name,
          modifiers: index === 0 ? [{ en: "Extra garlic", ar: "ثوم إضافي" }] : [],
          minor: (item.variants[0]?.basePrice.amount ?? 5000) * (index === 0 ? 2 : 1),
        }))
      : [
          { quantity: 2, name: { en: "Chicken shawarma", ar: "شاورما دجاج" }, modifiers: [{ en: "Extra garlic", ar: "ثوم إضافي" }], minor: 17000 },
          { quantity: 1, name: { en: "Fattoush", ar: "فتوش" }, modifiers: [], minor: 6500 },
          { quantity: 1, name: { en: "Mint lemonade", ar: "ليمون بالنعناع" }, modifiers: [], minor: 4000 },
        ]);
    const total = lines.reduce((sum, line) => sum + line.minor, 0);
    const vat = rate > 0 ? Math.round((total * rate) / (100 + rate)) : 0;
    const money = (minor: number) => (minor / 100).toFixed(2);
    return {
      orderNumber: "PREVIEW-1043",
      issuedAt: new Date().toISOString(),
      cashier: "Nour",
      table: "T12",
      customer: "Layla M.",
      loyaltyPoints: 486,
      lines: lines.map((line) => ({ quantity: line.quantity, name: line.name, modifiers: line.modifiers, total: money(line.minor) })),
      subtotal: money(total - vat),
      taxes: rate > 0 ? [{ label: { en: `VAT ${rate}% (incl.)`, ar: `ضريبة ${rate}٪ (شاملة)` }, amount: money(vat) }] : [],
      total: money(total),
      currency: pack?.currency ?? tenant.baseCurrency,
    };
  }, [context.data, rate, pack, tenant]);

  const zatca =
    draft.qr === "zatca" && !vatBad
      ? zatcaTlv({
          seller: draft.legalName.ar.trim() || draft.legalName.en.trim() || "—",
          vatNumber: draft.taxRegistration.trim(),
          timestamp: input.issuedAt.slice(0, 19) + "Z",
          total: input.total,
          vat: input.taxes[0]?.amount ?? "0.00",
        })
      : null;
  const lines = renderReceipt(draft, input, layout, zatca);

  async function save() {
    await action.run(() => services.receiptTemplates.update(draft.id, draft), {
      onSuccess: () => onSaved(t("rcpt.saved")),
    });
  }

  async function remove() {
    if (!(await confirmDelete(draft.name))) return;
    await action.run(() => services.receiptTemplates.remove(draft.id), { onSuccess: onDeleted });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    try {
      set({ logo: await ditherLogo(file, draft.paperWidth === 58 ? 384 : 576) });
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {problems.length > 0 ? (
          <Callout tone="warn">
            <ul className="list-disc space-y-0.5 ps-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <Card>
          <CardHeader title={t("rcpt.appliesTo")} hint={t("rcpt.appliesHint")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("common.name")} required>
              <Input value={draft.name} maxLength={60} onChange={(event) => set({ name: event.target.value })} />
            </Field>
            <Field label={t("org.brand")}>
              <Select value={draft.brandId ?? ""} onChange={(event) => set({ brandId: event.target.value || null })}>
                <option value="">{t("rcpt.allBrands")}</option>
                {availableBrands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {tx(brand.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("rcpt.country")}>
              <Select value={draft.countryCode ?? ""} onChange={(event) => set({ countryCode: (event.target.value || null) as CountryCode | null })}>
                <option value="">{t("rcpt.allCountries")}</option>
                {COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Toggle checked={draft.active} onChange={(active) => set({ active })} label={t("common.active")} />
        </Card>

        <Card>
          <CardHeader title={t("rcpt.identity")} spec="FR-POS-100" />
          <div className="space-y-4">
            <LocalisedField label={t("rcpt.legalName")} value={draft.legalName} onChange={(legalName) => set({ legalName })} required maxLength={80} />
            <Field label={t("rcpt.taxRegistration")} hint={zatcaNeeded ? t("rcpt.vatHintSa") : undefined} error={vatBad ? t("rcpt.badVat") : null}>
              <Input dir="ltr" value={draft.taxRegistration} maxLength={20} onChange={(event) => set({ taxRegistration: event.target.value })} className="font-mono" />
            </Field>
            <Field label={t("rcpt.logo")} hint={t("rcpt.logoHint")} error={logoError}>
              <div className="flex items-center gap-3">
                {draft.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logo} alt="" className="border-line max-h-16 rounded border bg-white p-1" />
                ) : null}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void pickLogo(event.target.files?.[0])} />
                <Button size="sm" icon={<ImagePlus size={12} />} onClick={() => fileRef.current?.click()}>
                  {draft.logo ? t("mie.replaceImage") : t("mie.addImage")}
                </Button>
                {draft.logo ? (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => set({ logo: null })}>
                    {t("common.remove")}
                  </Button>
                ) : null}
              </div>
            </Field>
            <LinesEditor label={t("rcpt.header")} lines={draft.header} onChange={(header) => set({ header })} />
            <LinesEditor label={t("rcpt.footer")} lines={draft.footer} onChange={(footer) => set({ footer })} />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("rcpt.layoutTitle")} spec="FR-POS-102" />
          <div className="space-y-4">
            <Field label={t("rcpt.languages")} hint={draft.layout === null ? t("rcpt.inheritsHint").replace("{value}", t(`rcpt.layout.${inheritedLayout}` as ConsoleKey)) : undefined}>
              <SegmentedControl<"inherit" | ReceiptLayout>
                value={draft.layout ?? "inherit"}
                onChange={(value) => set({ layout: value === "inherit" ? null : value })}
                options={[
                  { value: "inherit", label: t("rcpt.inherit") },
                  ...(["ar_en", "en_ar", "ar", "en"] as ReceiptLayout[]).map((value) => ({ value, label: t(`rcpt.layout.${value}` as ConsoleKey) })),
                ]}
              />
            </Field>
            <Field label={t("rcpt.paper")}>
              <SegmentedControl<"58" | "80">
                value={String(draft.paperWidth) as "58" | "80"}
                onChange={(value) => set({ paperWidth: Number(value) as 58 | 80 })}
                options={[
                  { value: "58", label: t("rcpt.paper58") },
                  { value: "80", label: t("rcpt.paper80") },
                ]}
              />
            </Field>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {(Object.keys(draft.show) as (keyof ReceiptTemplate["show"])[]).map((key) => (
                <Toggle key={key} checked={draft.show[key]} onChange={(value) => setShow(key, value)} label={t(`rcpt.show.${key}` as ConsoleKey)} />
              ))}
            </div>
            <Field label={t("rcpt.qr")} hint={draft.countryCode === "SA" && draft.qr !== "zatca" ? t("rcpt.zatcaRequired") : t("rcpt.qrHint")}>
              <SegmentedControl<ReceiptTemplate["qr"]>
                value={draft.qr}
                onChange={(qr) => set({ qr })}
                options={[
                  { value: "none", label: t("rcpt.qrNone") },
                  { value: "summary", label: t("rcpt.qrSummary") },
                  { value: "zatca", label: t("rcpt.qrZatca") },
                ]}
              />
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => void remove()}>
            {t("common.delete")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <p className="text-fg-muted flex items-center gap-1.5 text-xs">
          <Printer size={13} aria-hidden /> {t("rcpt.preview").replace("{n}", String(columnsFor(draft.paperWidth)))}
        </p>
        <ReceiptPreview template={draft} lines={lines} />
        <ResolutionCheck all={all.map((row) => (row.id === draft.id ? draft : row))} />
      </div>
    </div>
  );
}

function ReceiptPreview({ template, lines }: { template: ReceiptTemplate; lines: ReturnType<typeof renderReceipt> }) {
  const { t } = useI18n();
  const columns = columnsFor(template.paperWidth);
  return (
    <div className="mx-auto overflow-x-auto rounded-md bg-white px-3 py-4 text-black shadow-md" style={{ width: `calc(${columns}ch + 1.5rem)` }}>
      <div className="font-mono text-[12px] leading-[1.35]" style={{ width: `${columns}ch` }}>
        {lines.map((line, index) => {
          if (line.kind === "rule") return <div key={index} className="my-1 border-t border-dashed border-black/60" />;
          if (line.kind === "logo") {
            return template.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={index} src={template.logo} alt="" className="mx-auto mb-1 max-h-20" style={{ imageRendering: "pixelated" }} />
            ) : null;
          }
          if (line.kind === "qr") return <PreviewQr key={index} payload={line.payload} zatca={template.qr === "zatca"} />;
          return (
            <div
              key={index}
              dir={line.dir}
              className={cx("whitespace-pre", line.bold && "font-bold")}
              style={{ textAlign: line.align === "center" ? "center" : line.align === "end" ? "end" : "start" }}
            >
              {line.text}
            </div>
          );
        })}
        <p className="mt-2 text-center text-[10px] text-black/50">{t("rcpt.previewNote")}</p>
      </div>
    </div>
  );
}

function PreviewQr({ payload, zatca }: { payload: string; zatca: boolean }) {
  const { t } = useI18n();
  const encoded = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(payload), 2);
    } catch {
      return null;
    }
  }, [payload]);
  if (!encoded) return <p className="text-center text-[10px] text-red-600">{t("rcpt.qrTooLong")}</p>;
  const decoded = zatca ? readZatcaTlv(payload) : null;
  return (
    <div className="my-2 flex flex-col items-center gap-1">
      <svg viewBox={`0 0 ${encoded.size} ${encoded.size}`} className="h-28 w-28" shapeRendering="crispEdges" role="img" aria-label="QR">
        <rect width={encoded.size} height={encoded.size} fill="#fff" />
        <path d={encoded.path} fill="#000" />
      </svg>
      {decoded ? <p className="text-center text-[9px] leading-tight text-black/60">{decoded.join(" · ")}</p> : null}
    </div>
  );
}

/** Which template each brand × country will actually print with. */
function ResolutionCheck({ all }: { all: ReceiptTemplate[] }) {
  const { t, tx } = useI18n();
  const { availableBrands, tenant } = useSession();
  const pairs = availableBrands.slice(0, 6).map((brand) => ({
    brand,
    template: resolveTemplate(all, brand.id, tenant.countryCode),
  }));
  if (pairs.length === 0) return null;
  return (
    <Card>
      <CardHeader title={t("rcpt.whoUses")} hint={t("rcpt.whoUsesHint").replace("{country}", tenant.countryCode)} />
      <ul className="space-y-1 text-xs">
        {pairs.map(({ brand, template }) => (
          <li key={brand.id} className="flex justify-between gap-2">
            <span className="text-fg-muted">{tx(brand.name)}</span>
            <span className={template ? "text-fg" : "text-bad"}>{template ? template.name : t("rcpt.noTemplate")}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
