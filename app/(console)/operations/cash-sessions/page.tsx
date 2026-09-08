"use client";

/**
 * Open cash sessions — DEMO-MANAGER-CASH-SESSIONS-FRONTEND-P0.
 *
 * Discovery only. `GET /branches/{branchId}/cash-sessions/open` answers with
 * every session still OPEN or CLOSING at a branch — including ones opened by
 * an employee other than whoever is looking at this screen — so an Owner or
 * Shift Supervisor can find a drawer a reload/deploy stranded and hand it to
 * the terminal's own close_other workflow. This screen never closes a
 * session itself: the count, the variance and the manager-PIN decision all
 * stay at the terminal (`components/terminal/pos-drawer.tsx`'s
 * `DrawerSheet`), which is the only place FR-POS-095's blind count and the
 * finalize approval can run against a real till. "Close at terminal" hands
 * off nothing but the session id and this row's own display fields — the
 * server re-derives and re-checks everything else from the fresh PIN session
 * signed on there.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { OpenCashSession } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney } from "@/lib/console/format";
import { CASH_SESSION_STATUS, labelOf } from "@/lib/console/labels";
import { Gate, AsyncPanel } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { DataTable, type Column } from "@/components/console/data-table";
import { Badge, Button, Callout, Field, Select } from "@/components/console/ui";

export default function OpenCashSessionsPage() {
  return (
    <Gate permissions={["cash.session.close_other"]}>
      <OpenCashSessionsScreen />
    </Gate>
  );
}

function OpenCashSessionsScreen() {
  const { t, tx, fmt } = useI18n();
  const router = useRouter();
  const { branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");

  // Same re-sync as Drawers/Cash-close-policy: `branch`/`availableBranches`
  // resolve asynchronously from the live org bootstrap, so a one-time
  // initializer would lock onto an empty/stale selection forever.
  useEffect(() => {
    const defaultBranchId = branch?.id ?? availableBranches[0]?.id ?? "";
    setBranchId((current) => {
      if (current && availableBranches.some((b) => b.id === current)) {
        return current;
      }
      return defaultBranchId;
    });
  }, [branch, availableBranches]);

  const sessions = useAsync(
    () =>
      branchId
        ? services.treasury.listOpenSessions(branchId)
        : Promise.resolve([] as OpenCashSession[]),
    [branchId],
  );

  const selectedBranch = availableBranches.find((b) => b.id === branchId);

  const columns: Column<OpenCashSession>[] = [
    {
      key: "drawer",
      header: t("fin.drawer"),
      render: (row) => <span className="text-fg text-sm font-medium">{row.drawerName}</span>,
    },
    {
      key: "employee",
      header: t("cashSessions.employee"),
      render: (row) => row.employeeName,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const entry = labelOf(CASH_SESSION_STATUS, row.status);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
    {
      key: "openedAt",
      header: t("shift.openedAt"),
      secondary: true,
      render: (row) => formatDateTime(row.openedAt, fmt),
    },
    {
      key: "openingFloat",
      header: t("fin.openingFloat"),
      numeric: true,
      render: (row) => formatMoney(row.openingFloat, fmt),
    },
    {
      key: "currency",
      header: t("common.currency"),
      secondary: true,
      render: (row) => row.openingFloat.currency,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <Button
          size="sm"
          variant="primary"
          icon={<ArrowRight size={13} />}
          onClick={() => {
            const params = new URLSearchParams({
              sessionId: row.sessionId,
              employee: row.employeeName,
              drawer: row.drawerName,
              branch: selectedBranch ? tx(selectedBranch.name) : row.branchId,
            });
            router.push(`/pos/close?${params.toString()}`);
          }}
        >
          {t("cashSessions.closeAtTerminal")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("cashSessions.title")} subtitle={t("cashSessions.subtitle")} />

      <PageBody>
        {availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Callout tone="muted" icon={<AlertTriangle size={14} />}>
          {t("cashSessions.handoffNote")}
        </Callout>

        <Section title={t("cashSessions.title")}>
          {!branchId ? (
            <Callout tone="muted">{t("cashSessions.selectBranch")}</Callout>
          ) : (
            <AsyncPanel
              state={sessions}
              isEmpty={(rows) => rows.length === 0}
              empty={<Callout tone="muted">{t("cashSessions.empty")}</Callout>}
            >
              {(rows) => (
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.sessionId}
                  caption={t("cashSessions.title")}
                />
              )}
            </AsyncPanel>
          )}
        </Section>
      </PageBody>
    </>
  );
}
