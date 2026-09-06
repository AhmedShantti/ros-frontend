"use client";

/**
 * Drawers — FR-FIN-001.
 *
 * The physical cash container a shift's CashSession opens over. Without at
 * least one real drawer provisioned for a branch, a Cashier's own "Open
 * Shift" always 404s ("Drawer not found") — this page is the one place that
 * gap gets closed.
 */

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Drawer as DrawerRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { Gate } from "@/components/console/states";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import {
  Badge,
  Button,
  Callout,
  Card,
  Drawer,
  Field,
  Input,
  Select,
  Toast,
} from "@/components/console/ui";

export default function DrawersPage() {
  return (
    <Gate permissions={["settings.branch.manage"]}>
      <DrawersScreen />
    </Gate>
  );
}

function DrawersScreen() {
  const { t, tx } = useI18n();
  const { branch, availableBranches } = useSession();
  const [branchId, setBranchId] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessageLocal();

  // Same branch-context re-sync as the Stations page (DEMO-OPS-HOTFIX-3):
  // `branch`/`availableBranches` resolve asynchronously, so a one-time
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

  const drawersQuery = useAsync(
    () =>
      branchId
        ? services.treasury.listDrawers(branchId)
        : Promise.resolve([] as DrawerRow[]),
    [branchId],
  );

  const drawers = drawersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={t("drawers.title")}
        subtitle={t("drawers.subtitle")}
        spec="FR-FIN-001"
      />

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

        <Section
          title={t("drawers.listTitle")}
          action={
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              disabled={!branchId}
              onClick={() => setCreating(true)}
            >
              {t("drawers.new")}
            </Button>
          }
        >
          {drawersQuery.loading ? (
            <Callout tone="muted">{t("state.loading")}</Callout>
          ) : drawers.length === 0 ? (
            <Callout tone="muted">{t("drawers.empty")}</Callout>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {drawers.map((drawer) => (
                <li key={drawer.id}>
                  <Card className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-fg text-sm font-semibold">{drawer.name}</span>
                      <Badge tone={drawer.isActive ? "good" : "muted"} dot>
                        {drawer.isActive ? t("common.active") : t("common.inactive")}
                      </Badge>
                    </div>
                    {drawer.terminalId ? (
                      <p className="text-fg-subtle text-xs">{t("drawers.terminalBound")}</p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>

      {creating ? (
        <NewDrawerDrawer
          branchId={branchId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setMessage(t("drawers.created"));
            drawersQuery.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

function useTransientMessageLocal() {
  const [message, setMessage] = useState<string | null>(null);
  return [
    message,
    (value: string | null) => {
      setMessage(value);
      if (value) {
        setTimeout(() => setMessage(null), 4000);
      }
    },
  ] as const;
}

function NewDrawerDrawer({
  branchId,
  onClose,
  onCreated,
}: {
  branchId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim() || !branchId) return;
    await action.run(
      () => services.treasury.createDrawer(branchId, { name: name.trim() }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("drawers.new")}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!name.trim()}
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
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
        </Field>
      </div>
    </Drawer>
  );
}
