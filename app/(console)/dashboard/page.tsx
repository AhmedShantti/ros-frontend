"use client";

/**
 * Dashboard — SRS §19.4.
 *
 * FR-RPT-030 — every role lands on a role-appropriate default: the executive
 * roles on FR-RPT-031's view, branch managers and supervisors on FR-RPT-032's,
 * and kitchen, stock, finance, people and front-line roles on their own.
 * FR-RPT-034 — the user can choose and arrange the widgets, the arrangement
 * persists, and a tenant can set the default layout per role. Resolution is
 * user layout → tenant role default → built-in template, filtered by what
 * the session may see (`resolveLayout`).
 * NFR-USA-009 — the dashboard is fully keyboard-operable: the customise
 * panel has a keyboard reorder path with announcements, charts carry
 * disclosure tables, and every action is a native control.
 *
 * Exception over enumeration still applies: the default views lead with the
 * figures somebody acts on, and a figure with no source is a dash.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Sparkles } from "lucide-react";
import type { OperationalAlert, RoleKey } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime } from "@/lib/console/format";
import {
  TEMPLATE_LABEL,
  WIDGET_BY_ID,
  resolveLayout,
  sanitise,
  type WidgetId,
} from "@/lib/console/reports/dashboard-layout";
import { ROLE_DEFINITIONS } from "@/lib/console/permissions";
import { CURRENT_RELEASE, lastSeenRelease } from "@/lib/console/ops-release-notes";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { AsyncPanel, CardSkeleton, MetricSkeleton } from "@/components/console/states";
import { LiveTodayStrip, useLiveAlerts } from "@/components/console/live-panels";
import { DashboardWidget } from "@/components/console/dashboard-widgets";
import { DashboardCustomise } from "@/components/console/dashboard-customise";
import { Badge, Button, Callout, Toast, cx } from "@/components/console/ui";

export default function DashboardPage() {
  const { t, tx, fmt } = useI18n();
  const { scope, session, roleKey, canAny } = useSession();
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [message, setMessage] = useTransientMessage();
  const userKey = session?.user.id ?? `demo-${roleKey}`;

  const state = useAsync(
    () => services.dashboard.get(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const layouts = useAsync(
    async () => {
      const [user, roleDefault] = await Promise.all([
        services.dashboardLayouts.getUserLayout(userKey),
        services.dashboardLayouts.getRoleDefault(roleKey),
      ]);
      return { user, roleDefault };
    },
    [userKey, roleKey, scope.tenantId],
  );

  const resolved = useMemo(
    () =>
      resolveLayout({
        role: roleKey,
        user: layouts.data?.user?.widgets ?? null,
        roleDefault: layouts.data?.roleDefault?.widgets ?? null,
        canAny,
      }),
    [roleKey, layouts.data, canAny],
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WidgetId[]>([]);
  const [saving, setSaving] = useState(false);

  // Leaving edit mode — or the stored layout changing under it — resets the draft.
  useEffect(() => {
    if (!editing) setDraft(resolved.widgets);
  }, [editing, resolved.widgets]);

  const liveAlerts = useLiveAlerts();

  // FR-OPS-013 — point at the in-product release notes until they are opened.
  const [unseenRelease, setUnseenRelease] = useState(false);
  useEffect(() => setUnseenRelease(lastSeenRelease() !== CURRENT_RELEASE), []);
  const shown = editing ? draft : resolved.widgets;

  async function persist(action: () => Promise<unknown>, done: string) {
    setSaving(true);
    try {
      await action();
      layouts.reload();
      setEditing(false);
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    } finally {
      setSaving(false);
    }
  }

  const sourceLabel =
    resolved.source === "user"
      ? t("dashc.sourceUser")
      : resolved.source === "role_default"
        ? t("dashc.sourceRoleDefault").replace("{role}", tx(ROLE_DEFINITIONS[roleKey].name))
        : t("dashc.sourceTemplate").replace("{template}", t(TEMPLATE_LABEL[resolved.template]));

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        subtitle={t("dash.subtitle")}
        spec="§19.4"
        meta={
          <>
            {state.data ? (
              <>
                <span>
                  {t("common.date")}: {formatDate(state.data.businessDay, fmt)}
                </span>
                <span>
                  {t("dash.dataAsOf")}: {formatDateTime(state.data.generatedAt, fmt)}
                </span>
              </>
            ) : null}
            <span className="flex items-center gap-1.5">
              {t("dashc.layout")}: <Badge tone="muted">{sourceLabel}</Badge>
            </span>
            {unseenRelease ? (
              <Link href="/operations/release-notes" className="text-accent inline-flex items-center gap-1 font-medium">
                <Sparkles size={12} aria-hidden />
                {t("relnotes.whatsNew").replace("{version}", CURRENT_RELEASE)}
              </Link>
            ) : null}
          </>
        }
        actions={
          editing ? null : (
            <Button
              size="sm"
              icon={<LayoutGrid size={13} aria-hidden />}
              onClick={() => {
                setDraft(resolved.widgets);
                setEditing(true);
              }}
              aria-expanded={editing}
            >
              {t("dashc.customise")}
            </Button>
          )
        }
      />

      <PageBody>
        {editing ? (
          <DashboardCustomise
            draft={draft}
            onDraft={(next) => setDraft(sanitise(next))}
            saving={saving}
            hasUserLayout={Boolean(layouts.data?.user)}
            onCancel={() => setEditing(false)}
            onSave={() =>
              void persist(
                () => services.dashboardLayouts.saveUserLayout(userKey, roleKey, draft),
                t("dashc.saved"),
              )
            }
            onResetToRole={() =>
              void persist(() => services.dashboardLayouts.clearUserLayout(userKey), t("dashc.resetDone"))
            }
            onSaveRoleDefault={(role: RoleKey) =>
              void persist(
                () => services.dashboardLayouts.saveRoleDefault(role, draft, userKey),
                t("dashc.roleDefaultSaved").replace("{role}", tx(ROLE_DEFINITIONS[role].name)),
              )
            }
            onClearRoleDefault={(role: RoleKey) =>
              void persist(
                () => services.dashboardLayouts.clearRoleDefault(role),
                t("dashc.roleDefaultCleared").replace("{role}", tx(ROLE_DEFINITIONS[role].name)),
              )
            }
          />
        ) : null}

        <AsyncPanel
          state={state}
          skeleton={
            <>
              <TileGrid>
                {Array.from({ length: 4 }, (_, index) => (
                  <MetricSkeleton key={index} />
                ))}
              </TileGrid>
              <CardSkeleton />
            </>
          }
        >
          {(data) => {
            // What the terminals on this device raised goes first: it is
            // happening now, where the fixtures describe a seeded yesterday.
            const openAlerts = [...liveAlerts, ...data.alerts].filter(
              (alert) => !alert.acknowledged && !acknowledged.includes(alert.id),
            );
            const ctx = {
              data,
              openAlerts,
              onAcknowledge: (alert: OperationalAlert) => {
                setAcknowledged((current) => [...current, alert.id]);
                setMessage(t("common.approved"));
              },
            };

            return (
              <div className="space-y-5">
                <LiveTodayStrip />
                <Callout tone="muted">{t("dash.partialDay")}</Callout>

                {resolved.hidden.length > 0 && !editing ? (
                  <Callout tone="muted">
                    {t("dashc.hiddenByPermission").replace("{count}", String(resolved.hidden.length))}
                  </Callout>
                ) : null}

                {shown.length === 0 ? (
                  <Callout tone="accent" title={t("dashc.emptyTitle")}>
                    {t("dashc.emptyBody")}
                  </Callout>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {shown.map((id) => (
                      <div
                        key={id}
                        className={cx("min-w-0", WIDGET_BY_ID.get(id)?.size === "full" && "lg:col-span-2")}
                      >
                        <DashboardWidget id={id} ctx={ctx} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        </AsyncPanel>
      </PageBody>

      <Toast message={message} />
    </>
  );
}
