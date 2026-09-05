"use client";

/**
 * Employees — SRS §14.2.
 *
 * An employee is a person in a job; a user is a credential (SRS §14.1). They
 * are separate entities with an optional link, and a kitchen porter who clocks
 * in on a shared terminal has an employee record and no login at all.
 *
 * Compensation is behind its own permission (FR-HRM-003). A shift manager
 * needs the roster and the attendance; they do not need everyone's hourly
 * rate, and a model that ships pay inside the employee record forces the
 * choice between blocking the roster and leaking the payroll.
 *
 * Document expiry is surfaced because it is an operational constraint, not
 * paperwork: a lapsed food-handler certificate is a person who cannot legally
 * be rostered tomorrow.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Branch, Employee, EmployeeDocument, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAction } from "@/lib/console/actions";
import { useCollection, useTransientMessage, useBranches } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE, labelOf } from "@/lib/console/labels";
import { employees as allEmployees } from "@/lib/console/mock/workforce";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
} from "@/components/console/ui";

export default function EmployeesPage() {
  return (
    <Gate permissions={["hr.employee.view"]}>
      <EmployeesScreen />
    </Gate>
  );
}

function EmployeesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canSeePay = usePermission("hr.compensation.view");
  const canManage = usePermission("hr.employee.manage");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Employee>(
    (query) => services.workforce.employees.list(query),
    { scope, initialSort: "name", pageSize: 25 },
  );

  /**
   * The departments the filter offers.
   *
   * From the rows actually loaded, not by enumerating a fixture — which
   * live would have listed departments no employee in this tenant belongs
   * to, and there are no employees to load anyway: the backend has no
   * workforce API.
   */
  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    const source = DATA_MODE === "http" ? collection.rows : allEmployees;
    for (const employee of source) {
      if (!seen.has(employee.department.en)) {
        seen.set(employee.department.en, tx(employee.department));
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tx, collection.rows]);

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      active: rows.filter((row) => row.status === "active").length,
      noLogin: rows.filter((row) => row.userId === null).length,
      expiringDocs: rows.filter((row) =>
        row.documents.some((doc) => doc.status === "expiring" || doc.status === "expired"),
      ).length,
    };
  }, [collection.rows]);

  const columns = useMemo<Column<Employee>[]>(
    () => [
      {
        key: "name",
        header: t("wf.employee"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.name)}
            secondary={<span className="font-mono">{row.code}</span>}
          />
        ),
      },
      {
        key: "position",
        header: t("wf.position"),
        sortable: true,
        render: (row) => <CellStack primary={tx(row.position)} secondary={tx(row.department)} />,
      },
      {
        key: "homeBranch",
        header: t("wf.homeBranch"),
        secondary: true,
        render: (row) => tx(row.homeBranchName),
      },
      {
        key: "employmentType",
        header: t("wf.employmentType"),
        secondary: true,
        render: (row) => {
          const type = labelOf(EMPLOYMENT_TYPE, row.employmentType);
          return <Badge tone={type.tone}>{tx(type.label)}</Badge>;
        },
      },
      {
        key: "hiredOn",
        header: t("wf.hiredOn"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.hiredOn, fmt),
      },
      ...(canSeePay
        ? [
            {
              key: "hourlyRate",
              header: t("wf.hourlyRate"),
              numeric: true,
              render: (row: Employee) => formatMoney(row.hourlyRate, fmt),
            } satisfies Column<Employee>,
          ]
        : []),
      {
        key: "documents",
        header: t("wf.documents"),
        render: (row) => <DocumentCell documents={row.documents} />,
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(EMPLOYEE_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt, canSeePay],
  );

  return (
    <>
      <PageHeader
        title={t("wf.employeesTitle")}
        subtitle={t("wf.employeesSubtitle")}
        spec="FR-HRM-001"
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              {t("common.new")}
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        {!canSeePay ? <Callout tone="muted">{t("wf.compensationHidden")}</Callout> : null}

        <TileGrid columns={3}>
          <MetricTile label={t("common.active")} value={formatNumber(totals.active, fmt)} />
          <MetricTile
            label={t("wf.expiringDocs")}
            value={formatNumber(totals.expiringDocs, fmt)}
            spec="FR-HRM-006"
            hint={t("wf.expiringDocsHint")}
          />
          <MetricTile label={t("wf.noLogin")} value={formatNumber(totals.noLogin, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("wf.searchPlaceholder")}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(EMPLOYEE_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "employmentType",
              label: t("wf.employmentType"),
              options: Object.entries(EMPLOYMENT_TYPE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            { key: "department", label: t("wf.department"), options: departments },
            {
              key: "homeBranchId",
              label: t("wf.homeBranch"),
              options: branches.map((branch) => ({
                value: branch.id,
                label: tx(branch.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("wf.employeesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <EmployeeDrawer
        employee={selected}
        canSeePay={canSeePay}
        canManage={canManage}
        onClose={() => setSelected(null)}
      />
      {creating ? (
        <NewEmployeeDrawer
          branches={branches}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setMessage(t("wf.employeeCreated"));
            collection.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** The worst document status wins — one expired certificate is the headline. */
function DocumentCell({ documents }: { documents: EmployeeDocument[] }) {
  const { t } = useI18n();

  if (documents.length === 0) return <span className="text-fg-subtle">—</span>;

  const expired = documents.filter((doc) => doc.status === "expired").length;
  const expiring = documents.filter((doc) => doc.status === "expiring").length;

  if (expired > 0) return <Badge tone="bad">{t("wf.docsExpired")}</Badge>;
  if (expiring > 0) return <Badge tone="warn">{t("wf.docsExpiring")}</Badge>;
  return <Badge tone="good">{t("wf.docsValid")}</Badge>;
}

// ---------------------------------------------------------------------------

function EmployeeDrawer({
  employee,
  canSeePay,
  canManage,
  onClose,
}: {
  employee: Employee | null;
  canSeePay: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!employee) return null;

  const status = labelOf(EMPLOYEE_STATUS, employee.status);
  const type = labelOf(EMPLOYMENT_TYPE, employee.employmentType);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(employee.name)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {employee.code}
        </span>
      }
    >
      <div className="space-y-5">
        {canManage ? <SetPinSection employeeId={employee.id} /> : null}
        <DescList>
          <DescRow label={t("wf.position")}>{tx(employee.position)}</DescRow>
          <DescRow label={t("wf.department")}>{tx(employee.department)}</DescRow>
          <DescRow label={t("wf.homeBranch")}>{tx(employee.homeBranchName)}</DescRow>
          <DescRow label={t("wf.employmentType")}>
            <Badge tone={type.tone}>{tx(type.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("wf.hiredOn")}>{formatDate(employee.hiredOn, fmt)}</DescRow>
          <DescRow label={t("usr.phone")} mono>
            <span dir="ltr">{employee.phone}</span>
          </DescRow>
          <DescRow label={t("auth.email")}>
            <span dir="ltr">{employee.email}</span>
          </DescRow>
          {canSeePay ? (
            <DescRow label={t("wf.hourlyRate")} mono>
              {formatMoney(employee.hourlyRate, fmt)}
            </DescRow>
          ) : null}
          <DescRow label={t("wf.hasLogin")}>
            {employee.userId ? (
              <Badge tone="accent">{t("common.yes")}</Badge>
            ) : (
              <Badge tone="muted">{t("wf.noLogin")}</Badge>
            )}
          </DescRow>
          <DescRow label={t("wf.permittedBranches")} mono>
            {formatNumber(employee.permittedBranchIds.length, fmt)}
          </DescRow>
        </DescList>

        {employee.documents.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("wf.documents")}</h3>
            <ul className="divide-line divide-y">
              {employee.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-fg truncate text-sm">{tx(doc.type)}</p>
                    <p className="text-fg-subtle mt-0.5 font-mono text-xs" dir="ltr">
                      {doc.reference}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-fg text-xs">{formatDate(doc.expiresOn, fmt)}</p>
                    <Badge
                      tone={
                        doc.status === "expired"
                          ? "bad"
                          : doc.status === "expiring"
                            ? "warn"
                            : "good"
                      }
                      className="mt-1"
                    >
                      {formatNumber(doc.daysToExpiry, fmt)} {t("inv.days")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!canSeePay ? <Callout tone="muted">{t("wf.compensationHidden")}</Callout> : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/**
 * LIVE-DEMO-HOTFIX-1 — `POST /workforce/employees/:employeeId/pin`. The only
 * way an employee created here gets a POS PIN credential at all: without
 * this, the employee can never pass `POST /auth/pin`.
 */
function SetPinSection({ employeeId }: { employeeId: Id }) {
  const { t } = useI18n();
  const action = useAction();
  const [pin, setPin] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (!/^\d{4,8}$/.test(pin)) return;
    await action.run(() => services.workforce.setEmployeePin(employeeId, pin), {
      onSuccess: () => {
        setDone(true);
        setPin("");
      },
    });
  }

  return (
    <section className="border-line space-y-2 rounded-lg border p-3">
      <h3 className="text-fg text-sm font-semibold">{t("wf.setPin")}</h3>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      {done ? <Callout tone="good">{t("wf.pinSet")}</Callout> : null}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t("wf.pinLabel")}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={pin}
              onChange={(event) => {
                setDone(false);
                setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
              }}
              maxLength={8}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          loading={action.pending}
          disabled={!/^\d{4,8}$/.test(pin)}
          onClick={submit}
        >
          {t("common.save")}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** `POST /workforce/employees` — a new POS/roster employee. Omitting the
 *  linked-user id auto-provisions an internal identity + PIN-ready credential
 *  slot server-side (LIVE-DEMO-HOTFIX-1). */
function NewEmployeeDrawer({
  branches,
  onClose,
  onCreated,
}: {
  branches: Branch[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, tx } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [homeBranchId, setHomeBranchId] = useState(branches[0]?.id ?? "");
  const [employmentType, setEmploymentType] = useState<keyof typeof EMPLOYMENT_TYPE>("full_time");

  async function create() {
    if (!name.trim() || !homeBranchId) return;
    await action.run(
      () =>
        services.workforce.employees.create({
          name: { en: name.trim(), ar: name.trim() },
          code: code.trim() || undefined,
          homeBranchId,
          employmentType,
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("wf.newEmployee")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!name.trim() || !homeBranchId}
            onClick={create}
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <Field label={t("common.name")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("wf.employeeCode")} hint={t("wf.employeeCodeHint")}>
          <Input
            dir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={32}
          />
        </Field>

        <Field label={t("wf.homeBranch")} required>
          <Select value={homeBranchId} onChange={(event) => setHomeBranchId(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {tx(branch.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("wf.employmentType")} required>
          <Select
            value={employmentType}
            onChange={(event) =>
              setEmploymentType(event.target.value as keyof typeof EMPLOYMENT_TYPE)
            }
          >
            {Object.entries(EMPLOYMENT_TYPE).map(([value, entry]) => (
              <option key={value} value={value}>
                {tx(entry.label)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Drawer>
  );
}
