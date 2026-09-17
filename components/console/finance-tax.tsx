"use client";

/**
 * Tax configuration panels — FR-FIN-031, FR-FIN-033, FR-FIN-035.
 *
 * Shared by the tax page and the country-pack drawer. Rates and rounding are
 * always read from the pack (FR-FIN-030); nothing here supplies a rate of its
 * own.
 */

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { CountryPack, Currency, MenuItem, PriceList, TaxClassCode } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  priceListModeAt,
  type PriceListTaxMode,
  type PriceListTaxVersion,
} from "@/lib/console/services/finance-tax-config";
import { ORDER_TYPES, TAX_CLASS_CODES, packDifferentiatesOrderTypes, rateFor, splitTax } from "@/lib/console/finance-tax";
import { roundingConsistency, sampleLines, type RoundingSurface } from "@/lib/console/finance-rounding";
import { LEVEL_LABEL, todayIso } from "@/lib/console/settings";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatPercent, money } from "@/lib/console/format";
import { ORDER_TYPE, TAX_CLASS, labelOf } from "@/lib/console/labels";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { Section } from "@/components/console/page";
import { useConfirm } from "@/components/console/confirm";
import { ErrorPanel } from "@/components/console/states";
import { useBranchSettings } from "@/components/console/finance-policy";
import { Badge, Button, Callout, Input, Select, cx } from "@/components/console/ui";

type Mode = CountryPack["pricingMode"];

function ModeBadge({ mode }: { mode: Mode | string }) {
  const { t } = useI18n();
  return (
    <Badge tone={mode === "tax_inclusive" ? "accent" : "neutral"}>
      {mode === "tax_inclusive" ? t("fin.taxInclusive") : t("fin.taxExclusive")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// FR-FIN-031 — per branch
// ---------------------------------------------------------------------------

export function BranchPricingModeSection() {
  const { t, tx, fmt } = useI18n();
  const { availableBranches, tenant } = useSession();
  const { resolve, packs } = useBranchSettings();

  const rows = availableBranches.map((branch) => ({
    branch,
    resolved: resolve("fin.pricingMode", branch.id),
    pack: packs.find((pack) => pack.code === branch.countryCode) ?? null,
  }));

  const currency: Currency = availableBranches[0]?.currency ?? tenant.baseCurrency;
  const standardRate =
    rows.find((row) => row.pack)?.pack?.taxClasses.find((row) => row.code === "standard")?.rate ?? null;
  const shelf = 10_000;

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => tx(row.branch.name) },
    { key: "mode", header: t("cp.pricingMode"), render: (row) => (row.resolved ? <ModeBadge mode={String(row.resolved.value)} /> : "—") },
    {
      key: "source",
      header: t("fnc.setAt"),
      render: (row) =>
        row.resolved ? (
          <span className="text-fg-muted text-xs">
            {tx(LEVEL_LABEL[row.resolved.suppliedBy])}
            {row.resolved.lockedAt ? ` · ${t("fnc.lockedAt")} ${tx(LEVEL_LABEL[row.resolved.lockedAt])}` : ""}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Section title={t("fnc.pricingByBranch")} hint={t("fnc.pricingByBranchHint")} spec="FR-FIN-031">
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.branch.id} caption={t("fnc.pricingByBranch")} dense />
      {standardRate !== null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["tax_inclusive", "tax_exclusive"] as Mode[]).map((mode) => {
            const split = splitTax(shelf, standardRate, mode);
            return (
              <div key={mode} className="border-line rounded-lg border p-3 text-sm">
                <p className="mb-2 flex items-center justify-between">
                  <ModeBadge mode={mode} />
                  <span className="text-fg-subtle text-xs">
                    {t("fnc.shelfPrice")} {formatMoney(money(shelf, currency), fmt)} · {formatPercent(standardRate, fmt, 0)}
                  </span>
                </p>
                <p className="flex justify-between font-mono tabular-nums">
                  <span className="text-fg-muted font-sans">{t("fin.netAmount")}</span>
                  {formatMoney(money(split.net, currency), fmt)}
                </p>
                <p className="flex justify-between font-mono tabular-nums">
                  <span className="text-fg-muted font-sans">{t("fin.taxAmount")}</span>
                  {formatMoney(money(split.tax, currency), fmt)}
                </p>
                <p className="flex justify-between font-mono font-semibold tabular-nums">
                  <span className="text-fg font-sans">{t("fnc.customerPays")}</span>
                  {formatMoney(money(split.gross, currency), fmt)}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <Callout tone="muted">{t("fnc.noPackForExample")}</Callout>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-FIN-031 — per price list
// ---------------------------------------------------------------------------

export function PriceListTaxSection() {
  const { t, tx, fmt } = useI18n();
  const { scope, session } = useSession();
  const canEdit = usePermission("settings.tenant.manage");
  const confirm = useConfirm();
  const [nonce, setNonce] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { mode: PriceListTaxMode; from: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const lists = useAsync<PriceList[]>(
    () => services.catalogue.priceLists.list({ scope, limit: 200 }).then((page) => page.rows),
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const versions = useAsync<PriceListTaxVersion[]>(() => services.priceListTax.all(), [nonce]);

  async function save(list: PriceList) {
    const draft = drafts[list.id];
    if (!draft) return;
    const ok = await confirm({
      title: t("fnc.priceListModeConfirm").replace("{name}", tx(list.name)),
      body: t("fnc.priceListModeConfirmBody").replace("{date}", formatDate(draft.from, fmt)),
      tone: "warn",
    });
    if (!ok) return;
    setError(null);
    try {
      await services.priceListTax.set({
        priceListId: list.id,
        mode: draft.mode,
        effectiveFrom: draft.from,
        createdBy: session?.user.email ?? null,
      });
      setDrafts((all) => {
        const next = { ...all };
        delete next[list.id];
        return next;
      });
      setNonce((n) => n + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const columns: Column<PriceList>[] = [
    { key: "name", header: t("fnc.priceList"), render: (row) => tx(row.name) },
    {
      key: "inForce",
      header: t("fnc.modeInForce"),
      render: (row) => {
        const current = priceListModeAt(versions.data ?? [], row.id);
        return !current || current.mode === "inherit" ? (
          <Badge tone="muted">{t("fnc.inheritBranch")}</Badge>
        ) : (
          <ModeBadge mode={current.mode} />
        );
      },
    },
    {
      key: "scheduled",
      header: t("fnc.scheduled"),
      secondary: true,
      render: (row) => {
        const future = (versions.data ?? [])
          .filter((version) => version.priceListId === row.id && version.effectiveFrom > todayIso())
          .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
        return future.length === 0
          ? "—"
          : future.map((version) => `${formatDate(version.effectiveFrom, fmt)}: ${t(`fnc.plMode.${version.mode}` as ConsoleKey)}`).join(" · ");
      },
    },
    {
      key: "change",
      header: "",
      render: (row) => {
        if (!canEdit) return null;
        const draft = drafts[row.id] ?? { mode: "inherit" as PriceListTaxMode, from: todayIso() };
        const set = (patch: Partial<typeof draft>) => setDrafts((all) => ({ ...all, [row.id]: { ...draft, ...patch } }));
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="w-40">
              <Select value={draft.mode} onChange={(event) => set({ mode: event.target.value as PriceListTaxMode })}>
                {(["inherit", "tax_inclusive", "tax_exclusive"] as PriceListTaxMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`fnc.plMode.${mode}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </span>
            <Input
              type="date"
              dir="ltr"
              className="w-36"
              min={todayIso()}
              value={draft.from}
              onChange={(event) => set({ from: event.target.value })}
            />
            <Button size="sm" variant="secondary" disabled={!drafts[row.id]} onClick={() => save(row)}>
              {t("fnc.schedule")}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <Section title={t("fnc.pricingByPriceList")} hint={t("fnc.pricingByPriceListHint")} spec="FR-FIN-031">
      {error ? <Callout tone="bad">{error}</Callout> : null}
      {lists.error ? (
        <ErrorPanel error={lists.error} onRetry={lists.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={lists.data ?? []}
          rowKey={(row) => row.id}
          loading={lists.loading}
          caption={t("fnc.pricingByPriceList")}
          emptyTitle={t("fnc.noPriceLists")}
          dense
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-FIN-033 — tax class per item
// ---------------------------------------------------------------------------

export function ItemTaxClassSection({ pack }: { pack: CountryPack | null }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canEdit = usePermission("menu.item.manage");
  const confirm = useConfirm();
  const [filter, setFilter] = useState<TaxClassCode | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = useAsync<MenuItem[]>(
    () => services.catalogue.items.list({ scope, limit: 500 }).then((page) => page.rows),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const rows = useMemo(
    () => (items.data ?? []).filter((item) => filter === "all" || item.taxClass === filter),
    [items.data, filter],
  );

  async function change(item: MenuItem, next: TaxClassCode) {
    if (next === item.taxClass) return;
    const ok = await confirm({
      title: t("fnc.taxClassConfirm").replace("{name}", tx(item.name)),
      body: t("fnc.taxClassConfirmBody")
        .replace("{from}", tx(labelOf(TAX_CLASS, item.taxClass).label))
        .replace("{to}", tx(labelOf(TAX_CLASS, next).label)),
      tone: "warn",
    });
    if (!ok) return;
    setBusyId(item.id);
    setError(null);
    try {
      await services.catalogue.items.update(item.id, { taxClass: next });
      items.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<MenuItem>[] = [
    { key: "name", header: t("common.name"), render: (row) => tx(row.name) },
    {
      key: "class",
      header: t("menu.taxClass"),
      render: (row) =>
        canEdit ? (
          <span className="block w-40">
            <Select
              value={row.taxClass}
              disabled={busyId === row.id}
              onChange={(event) => change(row, event.target.value as TaxClassCode)}
            >
              {TAX_CLASS_CODES.map((code) => (
                <option key={code} value={code}>
                  {tx(TAX_CLASS[code].label)}
                </option>
              ))}
            </Select>
          </span>
        ) : (
          <Badge>{tx(labelOf(TAX_CLASS, row.taxClass).label)}</Badge>
        ),
    },
    {
      key: "rate",
      header: t("fin.taxRate"),
      numeric: true,
      render: (row) => {
        if (!pack) return "—";
        const resolved = rateFor(pack, row.taxClass, "dine_in");
        if (!resolved.defined) return <Badge tone="bad">{t("fnc.classNotInPack")}</Badge>;
        return resolved.rate === null ? t("fnc.exempt") : formatPercent(resolved.rate, fmt, resolved.rate % 1 ? 1 : 0);
      },
    },
  ];

  return (
    <Section title={t("fnc.itemTaxClasses")} hint={t("fnc.itemTaxClassesHint")} spec="FR-FIN-033">
      <div className="mb-3 w-48">
        <Select value={filter} onChange={(event) => setFilter(event.target.value as TaxClassCode | "all")}>
          <option value="all">{t("fnc.allClasses")}</option>
          {TAX_CLASS_CODES.map((code) => (
            <option key={code} value={code}>
              {tx(TAX_CLASS[code].label)}
            </option>
          ))}
        </Select>
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      {items.error ? (
        <ErrorPanel error={items.error} onRetry={items.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={items.loading}
          caption={t("fnc.itemTaxClasses")}
          dense
        />
      )}
    </Section>
  );
}

/** FR-FIN-033 — rate per tax class × order type, from pack data only. */
export function OrderTypeRateMatrix({ pack }: { pack: CountryPack }) {
  const { t, tx, fmt } = useI18n();
  const differentiates = packDifferentiatesOrderTypes(pack);

  return (
    <div className="space-y-2">
      {!differentiates ? <Callout tone="muted">{t("fnc.noOrderTypeDifferentiation")}</Callout> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-subtle">
              <th className="py-1 text-start font-normal">{t("menu.taxClass")}</th>
              {ORDER_TYPES.map((type) => (
                <th key={type} className="px-2 py-1 text-end font-normal">
                  {tx(ORDER_TYPE[type].label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {pack.taxClasses.map((row) => (
              <tr key={row.code} className="border-line border-t">
                <td className="py-1.5 font-sans">{tx(labelOf(TAX_CLASS, row.code).label)}</td>
                {ORDER_TYPES.map((type) => {
                  const resolved = rateFor(pack, row.code, type);
                  return (
                    <td key={type} className={cx("px-2 py-1.5 text-end", resolved.overridden && "text-accent font-semibold")}>
                      {resolved.rate === null ? t("fnc.exempt") : formatPercent(resolved.rate, fmt, resolved.rate % 1 ? 1 : 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-FIN-035 — rounding consistency
// ---------------------------------------------------------------------------

export function RoundingConsistency({ pack }: { pack: CountryPack }) {
  const { t, fmt } = useI18n();
  const lines = useMemo(() => sampleLines(pack), [pack]);
  const surfaces = useMemo(() => roundingConsistency(pack, lines), [pack, lines]);
  const m = (amount: number) => formatMoney(money(amount, pack.currency), fmt);
  const anyDiffers = surfaces.some((row) => row.differs);

  return (
    <div className="space-y-2">
      <p className="text-fg-muted text-xs">
        {t("cp.rounding")}: <span className="font-mono" dir="ltr">{pack.roundingMode}</span> · {t("fnc.roundingPoint")}:{" "}
        {pack.computationLevel === "line" ? t("fin.perLine") : t("fin.perOrder")} · {t("cp.pricingMode")}:{" "}
        {pack.pricingMode === "tax_inclusive" ? t("fin.taxInclusive") : t("fin.taxExclusive")}
      </p>
      <p className="text-fg-subtle font-mono text-[0.7rem] tabular-nums" dir="ltr">
        {lines.map((line) => `${line.label} ${m(line.amountMinor)} @ ${line.rate ?? 0}%`).join(" · ")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-subtle">
              <th className="py-1 text-start font-normal">{t("fnc.surface")}</th>
              {lines.map((line) => (
                <th key={line.label} className="px-2 py-1 text-end font-normal">
                  {line.label}
                </th>
              ))}
              <th className="px-2 py-1 text-end font-normal">{t("fin.taxAmount")}</th>
              <th className="px-2 py-1 text-end font-normal">{t("common.total")}</th>
              <th className="px-2 py-1 text-end font-normal">{t("fnc.cashTotal")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {surfaces.map((row) => (
              <Fragment key={row.surface}>
                <tr className="border-line border-t">
                  <td className="py-1.5 font-sans">
                    {t(`fnc.surface.${row.surface as RoundingSurface}` as ConsoleKey)}
                    <span className="text-fg-subtle block text-[0.65rem]">{t(`fnc.source.${row.source}` as ConsoleKey)}</span>
                  </td>
                  {row.result ? (
                    <>
                      {row.result.lineTax.map((value, index) => (
                        <td key={index} className="px-2 py-1.5 text-end">
                          {m(value)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-end">{m(row.result.taxTotal)}</td>
                      <td className="px-2 py-1.5 text-end">{m(row.result.grandTotal)}</td>
                      <td className="px-2 py-1.5 text-end">{m(row.result.cashTotal)}</td>
                    </>
                  ) : (
                    <td colSpan={lines.length + 3} className="text-fg-subtle px-2 py-1.5 text-end font-sans">
                      {t("fnc.notObservable")}
                    </td>
                  )}
                  <td className="py-1.5 text-end">
                    {row.result === null ? null : row.differs ? (
                      <AlertTriangle size={13} className="text-bad inline" aria-label={t("fnc.differs")} />
                    ) : (
                      <CheckCircle2 size={13} className="text-good inline" aria-label={t("fnc.consistent")} />
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {anyDiffers ? <Callout tone="bad">{t("fnc.roundingDiffers")}</Callout> : <Callout tone="muted">{t("fnc.roundingNote")}</Callout>}
    </div>
  );
}
