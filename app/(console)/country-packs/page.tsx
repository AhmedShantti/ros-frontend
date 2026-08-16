"use client";

/**
 * Country packs — SRS ch.22.
 *
 * The architectural claim this screen exists to demonstrate: jurisdiction
 * rules are data, not code. Tax classes, rounding mode, invoice format, week
 * start, overtime multiplier and retention period all live in a signed,
 * versioned pack. Adding a country is shipping a pack, not editing the tax
 * engine and regression-testing every existing market.
 *
 * Two properties keep that honest:
 *
 *   - Packs are signed. An unsigned pack cannot be activated in production,
 *     because a file that decides what tax gets charged is exactly the file
 *     worth tampering with.
 *   - Packs must pass the conformance suite (§21.9). The suite is the same set
 *     of cases the terminals run offline, so a pack that passes here computes
 *     the same tax on a device with no connection.
 *
 * Both are shown as gates rather than badges: the activation blocker is stated
 * where the status is read.
 */

import { useMemo, useState } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import type { CountryPack } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatNumber, formatPercent } from "@/lib/console/format";
import { COUNTRY_PACK_STATUS, TAX_CLASS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Callout,
  DescList,
  DescRow,
  Drawer,
} from "@/components/console/ui";

export default function CountryPacksPage() {
  return (
    <Gate permissions={["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"]}>
      <CountryPacksScreen />
    </Gate>
  );
}

function CountryPacksScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<CountryPack | null>(null);

  const collection = useCollection<CountryPack>(
    (query) => services.platform.countryPacks.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.status === "active").length,
      // Anything that cannot go live: unsigned, or failing conformance.
      blocked: rows.filter((row) => !row.signed || !row.conformancePassed).length,
      branches: rows.reduce((sum, row) => sum + row.branchCount, 0),
    };
  }, [collection.rows]);

  const columns = useMemo<Column<CountryPack>[]>(
    () => [
      {
        key: "name",
        header: t("org.country"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={
              <span className="font-mono">
                {row.code} · {row.currency}
              </span>
            }
          />
        ),
      },
      {
        key: "version",
        header: t("cp.version"),
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.version}
          </span>
        ),
      },
      {
        key: "effectiveFrom",
        header: t("cp.effectiveFrom"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.effectiveFrom, fmt),
      },
      {
        key: "pricingMode",
        header: t("cp.pricingMode"),
        secondary: true,
        render: (row) => (
          <Badge tone={row.pricingMode === "tax_inclusive" ? "accent" : "neutral"}>
            {row.pricingMode === "tax_inclusive"
              ? t("fin.taxInclusive")
              : t("fin.taxExclusive")}
          </Badge>
        ),
      },
      {
        key: "signed",
        header: t("cp.signed"),
        render: (row) =>
          row.signed ? (
            <Badge tone="good">
              <ShieldCheck size={11} aria-hidden />
              {t("cp.signed")}
            </Badge>
          ) : (
            <Badge tone="bad">
              <ShieldX size={11} aria-hidden />
              {t("cp.unsigned")}
            </Badge>
          ),
      },
      {
        key: "conformance",
        header: t("cp.conformance"),
        render: (row) => (
          <Badge tone={row.conformancePassed ? "good" : "bad"}>
            {row.conformancePassed ? t("cp.conformancePassed") : t("cp.conformanceFailed")}
          </Badge>
        ),
      },
      {
        key: "branchCount",
        header: t("org.branchCount"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.branchCount, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(COUNTRY_PACK_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader title={t("cp.title")} subtitle={t("cp.subtitle")} spec="§22.2" />

      <PageBody>
        <Callout tone="muted">{t("cp.activationBlocked")}</Callout>

        <TileGrid columns={3}>
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("cp.cannotActivate")}
            value={formatNumber(totals.blocked, fmt)}
            hint={t("cp.activationBlocked")}
          />
          <MetricTile
            label={t("cp.branchesUsing")}
            value={formatNumber(totals.branches, fmt)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(COUNTRY_PACK_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "signed",
              label: t("cp.signed"),
              options: [
                { value: "true", label: t("cp.signed") },
                { value: "false", label: t("cp.unsigned") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.code}
          caption={t("cp.title")}
          onRowClick={setSelected}
          activeRowKey={selected?.code ?? null}
          dense
        />
      </PageBody>

      <PackDrawer pack={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function PackDrawer({ pack, onClose }: { pack: CountryPack | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!pack) return null;

  const status = labelOf(COUNTRY_PACK_STATUS, pack.status);
  const blocked = !pack.signed || !pack.conformancePassed;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(pack.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {pack.code} · v{pack.version}
        </span>
      }
    >
      <div className="space-y-5">
        {blocked ? (
          <Callout tone="bad" title={t("cp.cannotActivate")}>
            {t("cp.activationBlocked")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("cp.effectiveFrom")}>{formatDate(pack.effectiveFrom, fmt)}</DescRow>
          <DescRow label={t("cp.signed")}>
            <Badge tone={pack.signed ? "good" : "bad"}>
              {pack.signed ? t("cp.signed") : t("cp.unsigned")}
            </Badge>
          </DescRow>
          <DescRow label={t("cp.conformance")}>
            <Badge tone={pack.conformancePassed ? "good" : "bad"}>
              {pack.conformancePassed ? t("cp.conformancePassed") : t("cp.conformanceFailed")}
            </Badge>
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("fin.taxTitle")}</h3>
          <DescList>
            <DescRow label={t("cp.taxEngine")} mono>
              <span dir="ltr">{pack.taxEngine}</span>
            </DescRow>
            <DescRow label={t("cp.pricingMode")}>
              {pack.pricingMode === "tax_inclusive"
                ? t("fin.taxInclusive")
                : t("fin.taxExclusive")}
            </DescRow>
            <DescRow label={t("cp.computationLevel")}>
              {pack.computationLevel === "line" ? t("fin.perLine") : t("fin.perOrder")}
            </DescRow>
            <DescRow label={t("cp.rounding")} mono>
              <span dir="ltr">{pack.roundingMode}</span>
            </DescRow>
            <DescRow label={t("org.currency")} mono>
              <span dir="ltr">
                {pack.currency} ({pack.currencyExponent})
              </span>
            </DescRow>
            <DescRow label={t("cp.fiscal")}>
              {pack.fiscalProvider ? (
                <span dir="ltr">
                  {pack.fiscalProvider}
                  {pack.fiscalMode ? ` · ${pack.fiscalMode}` : ""}
                </span>
              ) : (
                t("common.none")
              )}
            </DescRow>
          </DescList>
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("cp.taxClasses")}</h3>
          <ul className="divide-line divide-y">
            {pack.taxClasses.map((taxClass) => {
              const entry = labelOf(TAX_CLASS, taxClass.code);
              return (
                <li
                  key={taxClass.code}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={entry.tone}>{tx(entry.label)}</Badge>
                    <span className="text-fg-subtle text-xs">{tx(taxClass.label)}</span>
                  </span>
                  <span className="text-fg font-mono text-sm tabular-nums">
                    {taxClass.rate === null ? "—" : formatPercent(taxClass.rate, fmt, 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("nav.workforce")}</h3>
          <DescList>
            <DescRow label={t("cp.weekStart")}>{pack.weekStart}</DescRow>
            <DescRow label={t("cp.weekend")}>{pack.weekend.join(", ")}</DescRow>
            <DescRow label={t("cp.weeklyHours")} mono>
              {formatNumber(pack.standardWeeklyHours, fmt)}
            </DescRow>
            <DescRow label={t("cp.overtimeMultiplier")} mono>
              <span dir="ltr">×{formatNumber(pack.overtimeMultiplier, fmt, 2)}</span>
            </DescRow>
            <DescRow label={t("cp.retention")} mono>
              {formatNumber(pack.dataRetentionYears, fmt)} {t("cp.years")}
            </DescRow>
            <DescRow label={t("cp.branchesUsing")} mono>
              {formatNumber(pack.branchCount, fmt)}
            </DescRow>
          </DescList>
        </section>
      </div>
    </Drawer>
  );
}
