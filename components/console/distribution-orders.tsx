"use client";

/**
 * Distribution orders — FR-BRN-027 / FR-BRN-028.
 *
 * What a production run made, shared out to the branches it serves. Each
 * branch's request starts at what it is short of par; when the run cannot
 * cover every request, the rule decides who gets what — proportional, by
 * priority, or typed in by hand — and the screen shows every branch's
 * request beside its allocation so nobody's shortfall is hidden in a total.
 *
 * Dispatching sends one real transfer per branch, each carrying the batch
 * number, so the batch can be followed from the kitchen to the branch
 * (FR-BRN-029). The manifest is the list the driver signs.
 */

import { useEffect, useMemo, useState } from "react";
import { Send, Trash2 } from "lucide-react";

import type { Branch, Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import type { DistributionLine, DistributionOrder, ProductionOrder } from "@/lib/console/services/production";
import { allocate, allocationTotal, branchNeed, type AllocationRule } from "@/lib/console/production";
import { toScaled } from "@/lib/console/stock-units";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatQuantity } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel } from "@/components/console/states";
import { useConfirm, useConfirmDelete } from "@/components/console/confirm";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Input, Meter, SegmentedControl, cx } from "@/components/console/ui";
import type { KitchenData } from "@/components/console/production-orders";

interface Draft {
  available: string;
  lines: DistributionLine[];
  rule: AllocationRule;
}

export function DistributionDrawer({
  data,
  branches,
  source,
  existing,
  onClose,
  onChanged,
}: {
  data: KitchenData;
  branches: Branch[];
  /** Start a new distribution from this completed run. */
  source: ProductionOrder | null;
  existing: DistributionOrder | null;
  onClose: () => void;
  onChanged: (row: DistributionOrder, message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const confirm = useConfirm();
  const confirmDelete = useConfirmDelete();
  const canSend = usePermission("inventory.transfer.create");
  const action = useAction();
  const [row, setRow] = useState<DistributionOrder | null>(existing);
  const [draft, setDraft] = useState<Draft | null>(null);

  const kitchen = data.kitchens.find((k) => k.id === (row?.kitchenId ?? source?.kitchenId)) ?? null;
  const unit = row?.unit ?? source?.unit ?? "pc";
  const itemName = row?.itemName ?? source?.outputName ?? { en: "", ar: "" };

  // The starting point: what is left of the run, and each served branch's gap to par.
  const init = useAsync(async (): Promise<Draft | null> => {
    if (existing) return { available: existing.available, lines: existing.lines, rule: existing.rule };
    if (!source) return null;
    const [available, levels] = await Promise.all([
      services.centralKitchen.undistributed(source.id),
      services.inventory.levels.list({ limit: 5000 }).then((page) => page.rows.filter((level) => level.itemId === source.outputItemId)),
    ]);
    const served = kitchen?.servesBranchIds.length ? branches.filter((b) => kitchen.servesBranchIds.includes(b.id)) : branches;
    const byBranch = new Map(levels.map((level) => [level.locationId, level]));
    return {
      available,
      rule: "proportional",
      lines: served.map((branch, index) => {
        const level = byBranch.get(branch.id);
        return {
          branchId: branch.id,
          branchName: branch.name,
          requested: level ? branchNeed(level.onHand.value, String(level.parLevel)) : "0",
          priority: index + 1,
          allocated: "0",
          transferId: null,
          error: null,
        };
      }),
    };
  }, [existing?.id, source?.id]);

  useEffect(() => {
    if (init.data) setDraft(init.data);
  }, [init.data]);

  const editable = !row || row.status === "draft";

  // Allocations follow the rule; manual keeps whatever was typed.
  const lines = useMemo(() => {
    if (!draft) return [];
    if (!editable || draft.rule === "manual") return draft.lines;
    const shares = allocate(
      draft.available,
      draft.lines.map((line) => ({ branchId: line.branchId, requested: line.requested, priority: line.priority })),
      draft.rule,
      unit,
    );
    return draft.lines.map((line) => ({ ...line, allocated: shares.get(line.branchId) ?? "0" }));
  }, [draft, editable, unit]);

  const totals = draft ? allocationTotal(lines.map((line) => line.allocated || "0"), draft.available) : null;
  const requestedTotal = lines.reduce((sum, line) => sum + (Number(line.requested) || 0), 0);
  const invalid = lines.some((line) => toScaled(line.requested || "0") === null || toScaled(line.allocated || "0") === null);
  const short = draft ? requestedTotal > Number(draft.available) : false;

  function patchLine(branchId: Id, patch: Partial<DistributionLine>) {
    setDraft((current) =>
      current ? { ...current, lines: current.lines.map((line) => (line.branchId === branchId ? { ...line, ...patch } : line)) } : current,
    );
  }

  async function persist(): Promise<DistributionOrder | undefined> {
    if (!draft || !source || !kitchen) {
      if (row && draft) return services.centralKitchen.saveDistribution(row.id, { rule: draft.rule, lines });
      return row ?? undefined;
    }
    if (row) return services.centralKitchen.saveDistribution(row.id, { rule: draft.rule, lines });
    return services.centralKitchen.createDistribution({
      kitchenId: kitchen.id,
      kitchenName: kitchen.name,
      fromLocationId: source.locationId,
      itemId: source.outputItemId,
      itemName: source.outputName,
      unit: source.unit,
      unitCostMinor: Math.round(source.completion?.unitCostMinor ?? 0),
      currency: source.currency,
      productionOrderId: source.id,
      batchNumber: source.completion?.batchNumber ?? null,
      available: draft.available,
      rule: draft.rule,
      lines,
      createdBy: session?.user.email ?? null,
    });
  }

  async function save() {
    await action.run(persist, {
      onSuccess: (saved) => {
        if (!saved) return;
        setRow(saved);
        onChanged(saved, t("dst.saved"));
      },
    });
  }

  async function dispatch() {
    const sending = lines.filter((line) => !line.transferId && Number(line.allocated) > 0);
    const ok = await confirm({
      title: t("dst.dispatchTitle").replace("{n}", String(sending.length)),
      body: t("dst.dispatchBody"),
      confirmLabel: t("dst.dispatch"),
      tone: "warn",
    });
    if (!ok) return;
    await action.run(
      async () => {
        const saved = editable ? await persist() : row;
        if (!saved) throw new Error(t("dst.nothingSaved"));
        return services.centralKitchen.dispatch(saved.id, services.inventory, {
          en: session?.user.email ?? "",
          ar: session?.user.email ?? "",
        });
      },
      {
        onSuccess: (sent) => {
          setRow(sent);
          setDraft({ available: sent.available, lines: sent.lines, rule: sent.rule });
          onChanged(sent, sent.status === "dispatched" ? t("dst.dispatched") : t("dst.partial"));
        },
      },
    );
  }

  async function remove() {
    if (!row) return;
    if (!(await confirmDelete(row.number))) return;
    await action.run(() => services.centralKitchen.removeDistribution(row.id), {
      onSuccess: () => {
        onChanged({ ...row, status: "draft" }, t("dst.deleted"));
        onClose();
      },
    });
  }

  const sentLines = lines.filter((line) => Number(line.allocated) > 0);
  const batch = row?.batchNumber ?? source?.completion?.batchNumber ?? null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? `${row.number} · ${tx(itemName)}` : t("dst.new")}
      subtitle={
        row ? (
          <Badge tone={row.status === "dispatched" ? "good" : row.status === "partial" ? "bad" : "neutral"} dot>
            {t(`dst.status.${row.status}` as ConsoleKey)}
          </Badge>
        ) : (
          tx(itemName)
        )
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {row && row.status === "draft" ? (
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove} disabled={action.pending}>
              {t("common.delete")}
            </Button>
          ) : null}
          {editable ? (
            <Button variant="secondary" onClick={save} loading={action.pending} disabled={!draft || invalid || totals?.over || action.pending}>
              {t("dst.saveDraft")}
            </Button>
          ) : null}
          {canSend && row?.status !== "dispatched" ? (
            <Button
              variant="primary"
              icon={<Send size={14} />}
              onClick={dispatch}
              loading={action.pending}
              disabled={!draft || invalid || totals?.over || sentLines.length === 0 || action.pending}
            >
              {row?.status === "partial" ? t("dst.retry") : t("dst.dispatch")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {!canSend ? <Callout tone="muted">{t("dst.needTransfer")}</Callout> : null}

        <AsyncPanel state={init}>
          {() =>
            draft ? (
              <>
                <DescList>
                  <DescRow label={t("prd.kitchen")}>{kitchen ? tx(kitchen.name) : "—"}</DescRow>
                  <DescRow label={t("prd.batchNumber")} mono>
                    {batch ?? "—"}
                  </DescRow>
                  <DescRow label={t("dst.available")} mono>
                    {formatQuantity({ value: draft.available, unit }, fmt)}
                  </DescRow>
                  <DescRow label={t("dst.requestedTotal")} mono>
                    {formatQuantity({ value: String(requestedTotal), unit }, fmt)}
                  </DescRow>
                </DescList>

                {short && editable ? <Callout tone="warn">{t("dst.shortBody")}</Callout> : null}

                {editable ? (
                  <SegmentedControl<AllocationRule>
                    value={draft.rule}
                    onChange={(rule) => setDraft({ ...draft, lines, rule })}
                    options={[
                      { value: "proportional", label: t("dst.rule.proportional") },
                      { value: "priority", label: t("dst.rule.priority") },
                      { value: "manual", label: t("dst.rule.manual") },
                    ]}
                  />
                ) : (
                  <p className="text-fg-muted text-xs">
                    {t("dst.ruleUsed").replace("{rule}", t(`dst.rule.${draft.rule}` as ConsoleKey))}
                  </p>
                )}
                {editable ? <p className="text-fg-subtle text-xs">{t(`dst.ruleHint.${draft.rule}` as ConsoleKey)}</p> : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-fg-muted text-xs">
                        <th className="py-1 text-start font-medium">{t("common.branch")}</th>
                        <th className="py-1 text-end font-medium">{t("dst.priority")}</th>
                        <th className="py-1 text-end font-medium">{t("dst.requested")}</th>
                        <th className="py-1 text-end font-medium">{t("dst.allocated")}</th>
                        <th className="py-1" />
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {lines.map((line) => {
                        const cut = Number(line.allocated) < Number(line.requested);
                        return (
                          <tr key={line.branchId}>
                            <td className="text-fg py-1.5 pe-2">
                              {tx(line.branchName)}
                              {line.error ? <span className="text-bad block text-xs">{line.error}</span> : null}
                            </td>
                            <td className="py-1.5 text-end">
                              {editable && draft.rule === "priority" ? (
                                <Input
                                  dir="ltr"
                                  inputMode="numeric"
                                  aria-label={t("dst.priority")}
                                  value={String(line.priority)}
                                  onChange={(event) => patchLine(line.branchId, { priority: Number(event.target.value) || 0 })}
                                  className="ms-auto w-14 text-end font-mono"
                                />
                              ) : (
                                <span className="font-mono">{line.priority}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-end">
                              {editable ? (
                                <Input
                                  dir="ltr"
                                  inputMode="decimal"
                                  aria-label={t("dst.requested")}
                                  value={line.requested}
                                  onChange={(event) => patchLine(line.branchId, { requested: event.target.value })}
                                  className="ms-auto w-24 text-end font-mono"
                                />
                              ) : (
                                <span className="font-mono">{line.requested}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-end">
                              {editable && draft.rule === "manual" ? (
                                <Input
                                  dir="ltr"
                                  inputMode="decimal"
                                  aria-label={t("dst.allocated")}
                                  value={line.allocated}
                                  onChange={(event) => patchLine(line.branchId, { allocated: event.target.value })}
                                  className="ms-auto w-24 text-end font-mono"
                                />
                              ) : (
                                <span className={cx("font-mono", cut && "text-warn")}>{line.allocated}</span>
                              )}
                            </td>
                            <td className="py-1.5 ps-2 text-end">
                              {line.transferId ? <Badge tone="good">{t("dst.sent")}</Badge> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totals ? (
                  <div className="space-y-1">
                    <Meter value={Number(draft.available) > 0 ? (Number(totals.total) / Number(draft.available)) * 100 : 0} tone={totals.over ? "bad" : "accent"} />
                    <p className={cx("text-xs", totals.over ? "text-bad" : "text-fg-muted")}>
                      {t("dst.allocatedOf")
                        .replace("{total}", formatQuantity({ value: totals.total, unit }, fmt))
                        .replace("{available}", formatQuantity({ value: draft.available, unit }, fmt))}
                      {totals.over ? ` — ${t("dst.over")}` : ""}
                    </p>
                  </div>
                ) : null}

                {sentLines.length > 0 ? (
                  <ExportButton
                    filename={`manifest-${row?.number ?? "draft"}`}
                    title={`${t("dst.manifest")} ${row?.number ?? ""} · ${tx(itemName)}`}
                    filterSummary={batch ? `${t("prd.batchNumber")} ${batch}` : undefined}
                    rows={sentLines}
                    variant="secondary"
                    permission="inventory.view"
                    columns={[
                      { key: "branch", header: t("common.branch"), value: (line) => tx(line.branchName) },
                      { key: "item", header: t("prd.output"), value: () => tx(itemName) },
                      { key: "qty", header: t("dst.allocated"), value: (line) => line.allocated },
                      { key: "unit", header: t("dst.unit"), value: () => unit },
                      { key: "batch", header: t("prd.batchNumber"), value: () => batch ?? "" },
                      { key: "transfer", header: t("dst.transfer"), value: (line) => line.transferId ?? "" },
                      { key: "received", header: t("dst.receivedBy"), value: () => "" },
                    ]}
                  />
                ) : null}
              </>
            ) : null
          }
        </AsyncPanel>
      </div>
    </Drawer>
  );
}
