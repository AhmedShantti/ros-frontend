"use client";

/**
 * Segregation-of-duties conflict report — FR-SEC-015 … FR-SEC-017.
 *
 * "Every user whose effective permissions contain an incompatible pair."
 * The roles screen checks one role at a time; the danger it cannot see is
 * two harmless roles on one person — Storekeeper at one branch, Accountant
 * across the tenant — which together receive goods and approve paying for
 * them. So this runs the same check (`lib/console/access.ts`) across the
 * whole population, on the assignments in force *today*: an elevation that
 * expired last week is not a finding, and one that starts tomorrow is not
 * one yet.
 */

import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";

import type { Role, User } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatNumber } from "@/lib/console/format";
import { SOD_PAIRS } from "@/lib/console/permissions";
import { isInForce, userSodFindings, type UserSodFinding } from "@/lib/console/access";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, SearchInput, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Badge, Callout, Toast } from "@/components/console/ui";

export default function SodReportPage() {
  return (
    <Gate permissions={["security.user.manage", "audit.view", "report.view.governance"]}>
      <SodReport />
    </Gate>
  );
}

interface Row {
  user: User;
  finding: UserSodFinding;
}

function SodReport() {
  const { t, tx, fmt } = useI18n();
  const [message, setMessage] = useTransientMessage();
  const [term, setTerm] = useState("");
  const [severity, setSeverity] = useState("all");
  const [pairKey, setPairKey] = useState("all");

  const data = useAsync(async () => {
    const [users, roles] = await Promise.all([
      services.security.users.list({ limit: 1000 }).then((page) => page.rows),
      services.security.roles.list({ limit: 500 }).then((page) => page.rows),
    ]);
    return { users, roles };
  }, []);

  const rolesById = useMemo(
    () => new Map<string, Role>((data.data?.roles ?? []).map((role) => [role.id, role])),
    [data.data],
  );

  const rows: Row[] = useMemo(
    () =>
      (data.data?.users ?? []).flatMap((user) =>
        userSodFindings(user, rolesById).map((finding) => ({ user, finding })),
      ),
    [data.data, rolesById],
  );

  const pairId = (row: Row) => `${row.finding.pair.a}|${row.finding.pair.b}`;
  const visible = rows.filter((row) => {
    if (severity === "blocking" && !row.finding.pair.blocking) return false;
    if (severity === "warning" && row.finding.pair.blocking) return false;
    if (pairKey !== "all" && pairId(row) !== pairKey) return false;
    const needle = term.trim().toLowerCase();
    return !needle || tx(row.user.name).toLowerCase().includes(needle) || row.user.email.toLowerCase().includes(needle);
  });

  const usersScanned = data.data?.users.length ?? 0;
  const usersWithConflicts = new Set(rows.map((row) => row.user.id)).size;
  const blocking = rows.filter((row) => row.finding.pair.blocking).length;
  const combined = rows.filter((row) => row.finding.acrossRoles).length;

  const roleNames = (ids: string[]) => ids.map((id) => tx(rolesById.get(id)?.name) || id).join(", ");

  const columns: Column<Row>[] = [
    {
      key: "user",
      header: t("common.name"),
      render: (row) => <CellStack primary={tx(row.user.name)} secondary={row.user.email} />,
    },
    {
      key: "risk",
      header: t("role.sodRisk"),
      render: (row) => (
        <CellStack
          primary={tx(row.finding.pair.risk)}
          secondary={
            <span className="font-mono" dir="ltr">
              {row.finding.pair.a} + {row.finding.pair.b}
            </span>
          }
        />
      ),
    },
    {
      key: "source",
      header: t("sod.from"),
      render: (row) =>
        row.finding.acrossRoles ? (
          <span className="flex items-start gap-1.5 text-xs">
            <Link2 size={12} className="text-warn mt-0.5 shrink-0" aria-hidden />
            <span>
              {roleNames(row.finding.fromA)} <span className="text-fg-subtle">+</span> {roleNames(row.finding.fromB)}
            </span>
          </span>
        ) : (
          <span className="text-xs">{roleNames(row.finding.fromA.filter((id) => row.finding.fromB.includes(id)))}</span>
        ),
    },
    {
      key: "kind",
      header: t("sod.kind"),
      render: (row) =>
        row.finding.pair.blocking ? <Badge tone="bad">{t("role.sodBlocking")}</Badge> : <Badge tone="warn">{t("role.sodWarning")}</Badge>,
    },
    {
      key: "assignments",
      header: t("usr.assignments"),
      secondary: true,
      numeric: true,
      render: (row) => formatNumber(row.user.assignments.filter((assignment) => isInForce(assignment)).length, fmt),
    },
  ];

  // How many people hold each pair — the "which rule is the problem" view.
  const byPair = SOD_PAIRS.map((pair) => ({
    pair,
    count: new Set(rows.filter((row) => row.finding.pair === pair).map((row) => row.user.id)).size,
  }));

  return (
    <>
      <PageHeader
        title={t("sod.title")}
        subtitle={t("sod.subtitle")}
        spec="FR-SEC-017"
        crumbs={[{ label: t("rep.title"), href: "/reports" }]}
        actions={
          <ExportButton
            filename="sod-conflicts"
            title={t("sod.title")}
            rows={visible}
            onExported={setMessage}
            columns={[
              { key: "user", header: t("common.name"), value: (row) => tx(row.user.name) },
              { key: "email", header: t("usr.email"), value: (row) => row.user.email },
              { key: "risk", header: t("role.sodRisk"), value: (row) => tx(row.finding.pair.risk) },
              { key: "a", header: "A", value: (row) => row.finding.pair.a },
              { key: "b", header: "B", value: (row) => row.finding.pair.b },
              { key: "blocking", header: t("sod.kind"), value: (row) => (row.finding.pair.blocking ? "blocking" : "warning") },
              { key: "across", header: t("sod.from"), value: (row) => `${roleNames(row.finding.fromA)} + ${roleNames(row.finding.fromB)}` },
            ]}
          />
        }
      />

      <PageBody>
        <Callout tone="muted">{t("sod.method")}</Callout>

        <AsyncPanel state={data}>
          {() => (
            <>
              <TileGrid columns={4}>
                <MetricTile label={t("sod.scanned")} value={formatNumber(usersScanned, fmt)} />
                <MetricTile label={t("sod.withConflicts")} value={formatNumber(usersWithConflicts, fmt)} />
                <MetricTile label={t("sod.blocking")} value={formatNumber(blocking, fmt)} />
                <MetricTile label={t("sod.combined")} value={formatNumber(combined, fmt)} hint={t("sod.combinedHint")} />
              </TileGrid>

              <Section title={t("sod.byPair")} padded={false}>
                <ul className="divide-line divide-y">
                  {byPair.map(({ pair, count }) => (
                    <li key={`${pair.a}-${pair.b}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0">
                        <span className="text-fg block text-sm">{tx(pair.risk)}</span>
                        <span className="text-fg-subtle font-mono text-[0.68rem]" dir="ltr">
                          {pair.a} + {pair.b}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {pair.blocking ? <Badge tone="bad">{t("role.sodBlocking")}</Badge> : <Badge tone="warn">{t("role.sodWarning")}</Badge>}
                        <span className={count > 0 ? "text-fg font-mono font-semibold" : "text-fg-subtle font-mono"}>
                          {formatNumber(count, fmt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Toolbar>
                <SearchInput value={term} onChange={setTerm} />
                <FilterSelect
                  filter={{
                    key: "severity",
                    label: t("sod.kind"),
                    options: [
                      { value: "blocking", label: t("role.sodBlocking") },
                      { value: "warning", label: t("role.sodWarning") },
                    ],
                  }}
                  value={severity}
                  onChange={setSeverity}
                />
                <FilterSelect
                  filter={{
                    key: "pair",
                    label: t("role.sodRisk"),
                    options: SOD_PAIRS.map((pair) => ({ value: `${pair.a}|${pair.b}`, label: tx(pair.risk) })),
                  }}
                  value={pairKey}
                  onChange={setPairKey}
                />
              </Toolbar>

              <DataTable
                columns={columns}
                rows={visible}
                rowKey={(row) => `${row.user.id}:${pairId(row)}`}
                caption={t("sod.title")}
                emptyTitle={rows.length === 0 ? t("sod.clean") : t("common.noResults")}
                emptyBody={rows.length === 0 ? t("sod.cleanBody") : undefined}
              />
            </>
          )}
        </AsyncPanel>
      </PageBody>

      <Toast message={message} />
    </>
  );
}
