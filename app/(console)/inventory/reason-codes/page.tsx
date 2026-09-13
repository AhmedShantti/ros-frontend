"use client";

/**
 * Reason codes — FR-INV-013, GOLDEN-PATH-FINAL-INTEGRATION.
 *
 * The tenant-wide registry `POST`/`GET /inventory/reason-codes` back:
 * every void, refund, waste and adjustment reason picked elsewhere in the
 * console is one of these rows, not free text. Nothing in the product could
 * provision a new one — an Owner/authorized-manager setup gap that left the
 * refund flow's `reasonCodeId` unfillable without a seeded fixture. Reuses
 * the existing Inventory reason-code service (already read by Adjustments,
 * Transfers and Expiry) rather than inventing a parallel one.
 *
 * Gated on `inventory.adjust` — the same permission the backend requires to
 * create a reason code (`INVENTORY_PERMISSIONS.ADJUST`), not a branch-scoped
 * permission: reason codes are shared by every location in the tenant.
 */

import { useState } from "react";
import type { ReasonCode } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
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
  Toast,
} from "@/components/console/ui";
import { Plus } from "lucide-react";

export default function ReasonCodesPage() {
  return (
    <Gate permissions={["inventory.adjust"]}>
      <ReasonCodesScreen />
    </Gate>
  );
}

function ReasonCodesScreen() {
  const { t, tx } = useI18n();
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useTransientMessage();

  const reasonQuery = useAsync(() => services.inventory.reasonCodes(), []);
  const reasons = reasonQuery.data ?? [];

  return (
    <>
      <PageHeader title={t("rc.title")} subtitle={t("rc.subtitle")} spec="FR-INV-013" />

      <PageBody>
        <Section
          title={t("rc.listTitle")}
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              {t("rc.new")}
            </Button>
          }
        >
          {reasonQuery.loading ? (
            <Callout tone="muted">{t("state.loading")}</Callout>
          ) : reasons.length === 0 ? (
            <Callout tone="muted">{t("rc.empty")}</Callout>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reasons.map((reason) => (
                <li key={reason.id}>
                  <Card className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-fg text-sm font-semibold">{tx(reason.label)}</span>
                      <Badge tone="muted" dot>
                        {reason.category}
                      </Badge>
                    </div>
                    <p className="text-fg-subtle font-mono text-xs" dir="ltr">
                      {reason.code}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>

      {creating ? (
        <NewReasonCodeDrawer
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setMessage(t("rc.created"));
            reasonQuery.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

function NewReasonCodeDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (reason: ReasonCode) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const [category, setCategory] = useState("");
  const [code, setCode] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");

  const valid = category.trim() !== "" && code.trim() !== "" && labelEn.trim() !== "";

  async function create() {
    if (!valid) return;
    await action.run(
      () =>
        services.inventory.createReasonCode({
          category: category.trim(),
          code: code.trim(),
          label: { en: labelEn.trim(), ar: labelAr.trim() || labelEn.trim() },
        }),
      { onSuccess: onCreated },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("rc.new")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={create}>
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

        <Field label={t("common.category")} hint={t("rc.categoryHint")} required>
          <Input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={16} />
        </Field>

        <Field label={t("common.code")} hint={t("rc.codeHint")} required>
          <Input dir="ltr" value={code} onChange={(event) => setCode(event.target.value)} maxLength={32} />
        </Field>

        <Field label={t("common.name")} required>
          <Input value={labelEn} onChange={(event) => setLabelEn(event.target.value)} maxLength={120} />
        </Field>

        <Field label={t("rc.labelAr")} hint={t("rc.labelArHint")}>
          <Input
            dir="rtl"
            value={labelAr}
            onChange={(event) => setLabelAr(event.target.value)}
            maxLength={120}
          />
        </Field>
      </div>
    </Drawer>
  );
}
