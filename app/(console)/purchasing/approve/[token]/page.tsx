"use client";

/**
 * Approve by link — SRS §12.4, FR-PRC-020.
 *
 * Where an approval link lands. The token is looked up by its hash; a link
 * that has expired, been used or been revoked says which, and offers nothing
 * to press. A valid one shows the order and takes one decision, after which
 * the link is spent (single use is enforced in `redeemApprovalLink`, which burns
 * the link before acting). The signed-in approver is still subject to the
 * self-approval refusal (FR-PRC-019) and to their value band.
 *
 * What this is not: a server-signed token. Links are issued and checked in
 * the browser that holds the purchasing records, and the page says so. Once
 * the server issues signed tokens, only the lookup changes.
 */

import { use, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ShieldX } from "lucide-react";

import { services } from "@/lib/console/services";
import { linkState } from "@/lib/console/services/purchasing-local";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { PageBody, PageHeader } from "@/components/console/page";
import { ErrorPanel, Gate, LoadingPanel, StatePanel } from "@/components/console/states";
import { useDecisionBlock, useOrderWorkflow } from "@/components/console/purchasing-orders";
import { useActor } from "@/components/console/purchasing-shared";
import { Button, Callout, Card, DescList, DescRow, Field, Textarea } from "@/components/console/ui";

export default function ApproveByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <Gate permissions={["purchase.view"]}>
      <ApproveByLink token={token} />
    </Gate>
  );
}

function ApproveByLink({ token }: { token: string }) {
  const { t, tx, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [note, setNote] = useState("");
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);

  const lookup = useAsync(async () => {
    const link = await services.procurement.findApprovalLink(token);
    const order = link ? await services.purchasing.orders.get(link.orderId) : null;
    return { link, order };
  }, [token]);

  const order = lookup.data?.order ?? null;
  const workflow = useOrderWorkflow(order?.id ?? null);
  const block = useDecisionBlock(order, workflow.data ?? null);

  if (lookup.error) return <ErrorPanel error={lookup.error} onRetry={lookup.reload} />;
  if (lookup.loading || !lookup.data) return <LoadingPanel />;

  const { link } = lookup.data;
  const state = linkState(link);

  async function decide(decision: "approved" | "rejected") {
    await action.run(
      () =>
        services.procurement.redeemApprovalLink(token, decision, { actor, note }, {
          orders: services.purchasing.orders,
          approveOrder: services.purchasing.approveOrder,
        }),
      { onSuccess: () => setDecided(decision) },
    );
  }

  return (
    <>
      <PageHeader title={t("prc.approveLink.title")} spec="FR-PRC-020" />
      <PageBody className="mx-auto max-w-xl">
        <Callout tone="muted">{t("prc.approveLink.localNote")}</Callout>

        {decided ? (
          <StatePanel
            icon={<CheckCircle2 size={18} />}
            title={decided === "approved" ? t("prc.approveLink.doneApproved") : t("prc.approveLink.doneRejected")}
            body={t("prc.approveLink.doneBody")}
            action={
              <Link href="/purchasing/orders">
                <Button>{t("nav.purchaseOrders")}</Button>
              </Link>
            }
          />
        ) : state !== "valid" || !order ? (
          <StatePanel
            icon={<ShieldX size={18} />}
            title={t(`prc.approveLink.state.${order || state !== "valid" ? state : "unknown"}` as ConsoleKey)}
            body={t("prc.approveLink.unusableBody")}
          />
        ) : (
          <Card>
            <div className="space-y-4">
              <DescList>
                <DescRow label={t("common.reference")} mono>
                  {order.reference}
                </DescRow>
                <DescRow label={t("pur.supplier")}>{tx(order.supplierName)}</DescRow>
                <DescRow label={t("prc.history.requester")}>{workflow.data?.requesterName || tx(order.createdBy)}</DescRow>
                <DescRow label={t("pur.expectedDelivery")}>{formatDate(order.expectedDelivery, fmt)}</DescRow>
                <DescRow label={t("common.total")} mono>
                  {formatMoney(order.total, fmt)}
                </DescRow>
                <DescRow label={t("prc.approveLink.expires")}>{formatDateTime(link!.expiresAt, fmt)}</DescRow>
              </DescList>

              <ul className="border-line divide-line divide-y rounded-lg border text-xs">
                {order.lines.map((line) => (
                  <li key={line.id} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-fg min-w-0 flex-1">{tx(line.itemName)}</span>
                    <span className="font-mono tabular-nums">{formatQuantity(line.quantity, fmt)}</span>
                    <span className="font-mono tabular-nums">{formatMoney(line.lineTotal, fmt)}</span>
                  </li>
                ))}
              </ul>

              {block ? (
                <Callout tone="warn" title={t("prc.decide.cannotTitle")}>
                  {block}
                </Callout>
              ) : null}
              {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

              <Field label={t("prc.approveLink.note")} hint={t("prc.approveLink.noteHint")}>
                <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={action.pending} disabled={Boolean(block)} onClick={() => void decide("approved")}>
                  {t("pur.approveOrder")}
                </Button>
                <Button variant="danger" loading={action.pending} disabled={Boolean(block) || note.trim().length < 8} onClick={() => void decide("rejected")}>
                  {t("prc.decide.reject")}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
