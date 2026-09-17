"use client";

/**
 * Purchasing approvals inbox — SRS §12.4, FR-PRC-019, FR-PRC-020.
 *
 * Built for a phone first: an approver standing in a kitchen needs to read an
 * order and decide it without the console's tables. Each card is one order or
 * requisition waiting on a decision, with the lines one tap away. Decisions
 * are recorded with the channel they came from — "mobile" on a small screen —
 * and the self-approval refusal (019) applies here exactly as in the console.
 *
 * There is no separate native app in this repository; this responsive page is
 * the mobile surface the requirement asks for.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { PurchaseOrder, Requisition } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { ApprovalChannel } from "@/lib/console/services/purchasing-local";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/lib/console/format";
import { PageBody, PageHeader } from "@/components/console/page";
import { EmptyPanel, ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { OrderDecision, useOrderWorkflow } from "@/components/console/purchasing-orders";
import { RequisitionDecision } from "@/components/console/purchasing-requisitions";
import { Badge, Card, IconButton, SegmentedControl, Toast } from "@/components/console/ui";

type Filter = "orders" | "requisitions";

/** "mobile" when decided on a phone-sized screen, so the record says where approval happened. */
function useChannel(): ApprovalChannel {
  const [channel, setChannel] = useState<ApprovalChannel>("console");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setChannel(query.matches ? "mobile" : "console");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return channel;
}

export default function PurchasingApprovalsPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <ApprovalsScreen />
    </Gate>
  );
}

function ApprovalsScreen() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("orders");
  const [message, setMessage] = useTransientMessage();
  const channel = useChannel();

  const orders = useAsync(
    () => services.purchasing.orders.list({ limit: 200, filters: { status: "pending_approval" }, sort: "-createdAt" }).then((page) => page.rows),
    [],
  );
  const requisitions = useAsync(
    () => services.purchasing.requisitions.list({ limit: 200, filters: { status: "submitted" }, sort: "-requestedAt" }).then((page) => page.rows),
    [],
  );

  const state = filter === "orders" ? orders : requisitions;

  return (
    <>
      <PageHeader title={t("prc.inbox.title")} subtitle={t("prc.inbox.subtitle")} spec="FR-PRC-020" />
      <PageBody className="mx-auto max-w-2xl">
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          label={t("prc.inbox.title")}
          options={[
            { value: "orders", label: `${t("nav.purchaseOrders")} (${orders.data?.length ?? "…"})` },
            { value: "requisitions", label: `${t("nav.requisitions")} (${requisitions.data?.length ?? "…"})` },
          ]}
        />

        {state.error ? (
          <ErrorPanel error={state.error} onRetry={state.reload} />
        ) : state.loading && !state.data ? (
          <LoadingPanel />
        ) : filter === "orders" ? (
          (orders.data ?? []).length === 0 ? (
            <EmptyPanel title={t("prc.inbox.emptyOrders")} body={t("prc.inbox.emptyBody")} />
          ) : (
            <ul className="space-y-3">
              {(orders.data ?? []).map((order) => (
                <li key={order.id}>
                  <OrderCard
                    order={order}
                    channel={channel}
                    onDone={(note) => {
                      setMessage(note);
                      orders.reload();
                    }}
                  />
                </li>
              ))}
            </ul>
          )
        ) : (requisitions.data ?? []).length === 0 ? (
          <EmptyPanel title={t("prc.inbox.emptyRequisitions")} body={t("prc.inbox.emptyBody")} />
        ) : (
          <ul className="space-y-3">
            {(requisitions.data ?? []).map((requisition) => (
              <li key={requisition.id}>
                <RequisitionCard
                  requisition={requisition}
                  channel={channel}
                  onDone={(note) => {
                    setMessage(note);
                    requisitions.reload();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function OrderCard({ order, channel, onDone }: { order: PurchaseOrder; channel: ApprovalChannel; onDone: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const workflow = useOrderWorkflow(order.id);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg font-mono text-sm font-semibold">{order.reference}</p>
          <p className="text-fg-muted text-sm">{tx(order.supplierName)}</p>
          <p className="text-fg-subtle mt-1 text-xs">
            {workflow.data?.requesterName || tx(order.createdBy)} · {formatDateTime(order.createdAt, fmt)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-fg font-mono text-lg font-semibold tabular-nums">{formatMoney(order.total, fmt)}</p>
          <Badge tone="accent">{t("prc.inbox.tier").replace("{n}", String(order.approvalTier))}</Badge>
        </div>
      </div>

      <div className="text-fg-muted mt-2 flex items-center justify-between text-xs">
        <span>
          {t("pur.expectedDelivery")}: {formatDate(order.expectedDelivery, fmt)} · {t("prc.inbox.lines").replace("{n}", String(order.lines.length))}
        </span>
        <IconButton label={open ? t("prc.inbox.hideLines") : t("prc.inbox.showLines")} icon={open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} onClick={() => setOpen((value) => !value)} />
      </div>

      {open ? (
        <ul className="border-line divide-line my-2 divide-y rounded-lg border text-xs">
          {order.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-2 px-3 py-1.5">
              <span className="text-fg min-w-0 flex-1">{tx(line.itemName)}</span>
              <span className="font-mono tabular-nums">{formatQuantity(line.quantity, fmt)}</span>
              <span className="font-mono tabular-nums">{formatMoney(line.lineTotal, fmt)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3">
        <OrderDecision order={order} workflow={workflow.data ?? null} channel={channel} onDone={(_updated, note) => onDone(note)} />
      </div>
    </Card>
  );
}

function RequisitionCard({ requisition, channel, onDone }: { requisition: Requisition; channel: ApprovalChannel; onDone: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg font-mono text-sm font-semibold">{requisition.reference}</p>
          <p className="text-fg-muted text-sm">{tx(requisition.branchName)}</p>
          <p className="text-fg-subtle mt-1 text-xs">
            {tx(requisition.requestedBy)} · {t("pur.neededBy")} {formatDate(requisition.neededBy, fmt)}
          </p>
        </div>
        <p className="text-fg font-mono text-lg font-semibold tabular-nums">{formatMoney(requisition.estimatedTotal, fmt)}</p>
      </div>
      <div className="text-fg-muted mt-2 flex items-center justify-between text-xs">
        <span>{t("prc.inbox.lines").replace("{n}", String(requisition.lines.length))}</span>
        <IconButton label={open ? t("prc.inbox.hideLines") : t("prc.inbox.showLines")} icon={open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} onClick={() => setOpen((value) => !value)} />
      </div>
      {open ? (
        <ul className="border-line divide-line my-2 divide-y rounded-lg border text-xs">
          {requisition.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-2 px-3 py-1.5">
              <span className="text-fg min-w-0 flex-1">{tx(line.itemName)}</span>
              <span className="font-mono tabular-nums">{formatQuantity(line.quantity, fmt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3">
        <RequisitionDecision requisition={requisition} channel={channel} onDone={(_updated, note) => onDone(note)} />
      </div>
    </Card>
  );
}
