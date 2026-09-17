"use client";

/**
 * Fiscal sequence — FR-OFF-017, FR-OFF-018.
 *
 * Three things a fiscal-compliance owner needs in one place:
 *
 *   1. Per country pack, whether the jurisdiction demands a strictly gapless
 *      fiscal sequence and which strategy keeps it gapless offline
 *      (FR-OFF-017): server-assigned on sync, pre-allocated blocks, or no
 *      offline issue at all.
 *   2. What each till does under that policy when the link is down — and in
 *      particular that a till whose block is exhausted or expired must go
 *      online before it can issue another fiscal document.
 *   3. The number-block register: used, unused and voided numbers per block,
 *      and the void report for expired blocks (FR-OFF-018), which is never
 *      silently discarded — an expired block with unused numbers stays
 *      "void pending" until a submission reference is recorded against it.
 *
 * Policies and blocks are held in the browser-local store (no fiscal-block
 * endpoints exist); recording a void report records the operator's
 * submission and reference, it does not itself contact a fiscal authority.
 */

import { useMemo, useState } from "react";
import { FileWarning, Play, Plus, Save } from "lucide-react";
import type { CountryCode, CountryPack, Terminal } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useBranches, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatNumber } from "@/lib/console/format";
import {
  SEQUENCE_STRATEGIES,
  blockSize,
  blockState,
  defaultPolicy,
  formatFiscalNumber,
  policyProblems,
  tillFiscalMode,
  unusedCount,
  unusedRanges,
  voidReportRows,
  type BlockState,
  type FiscalNumberBlock,
  type FiscalSequencePolicy,
  type Link as LinkState,
  type SequenceStrategy,
} from "@/lib/console/offline-fiscal";
import { useConnectivityStore } from "@/store/connectivity";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { useConfirm } from "@/components/console/confirm";
import { Badge, Button, Callout, Drawer, Field, Input, Select, Toast, Toggle, cx } from "@/components/console/ui";
import type { Tone } from "@/lib/console/labels";

const STATE_TONE: Record<BlockState, Tone> = {
  active: "good",
  exhausted: "neutral",
  void_pending: "bad",
  void_reported: "warn",
  closed: "muted",
};

export default function FiscalSequencePage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("fiscal.title")} subtitle={t("fiscal.subtitle")} spec="FR-OFF-017" />
      <Gate permissions={["settings.tenant.manage", "platform.countrypack.manage", "finance.tax.view"]}>
        <FiscalBody />
      </Gate>
    </>
  );
}

function FiscalBody() {
  const packs = useAsync<CountryPack[]>(async () => (await services.platform.countryPacks.list({ limit: 50 })).rows, []);
  return <AsyncPanel state={packs}>{(rows) => <FiscalScreens packs={rows} />}</AsyncPanel>;
}

function FiscalScreens({ packs }: { packs: CountryPack[] }) {
  const { t, tx, fmt } = useI18n();
  const { scope, can } = useSession();
  const confirm = useConfirm();
  const branches = useBranches(scope);
  const [message, setMessage] = useTransientMessage();
  const canEdit = can("settings.tenant.manage") || can("platform.countrypack.manage");

  const policies = useAsync(() => services.fiscalSequence.policies(), []);
  const blocks = useAsync(() => services.fiscalSequence.blocks(), []);
  const terminals = useAsync<Terminal[]>(
    async () => (await services.operations.terminals({ scope, limit: 200 })).rows.filter((terminal) => terminal.kind === "pos"),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const now = useMemo(() => new Date(), [blocks.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const policyFor = (code: CountryCode): FiscalSequencePolicy => {
    const stored = policies.data?.find((policy) => policy.countryCode === code);
    const pack = packs.find((entry) => entry.code === code);
    return stored ?? defaultPolicy(pack ?? { code, fiscalProvider: null }, new Date(0).toISOString());
  };

  const [editing, setEditing] = useState<FiscalSequencePolicy | null>(null);
  const [saving, setSaving] = useState(false);

  async function savePolicy() {
    if (!editing) return;
    if (policyProblems(editing).length > 0) return;
    const current = policyFor(editing.countryCode);
    // Changing strategy while blocks are outstanding strands those numbers.
    const outstanding = (blocks.data ?? []).filter(
      (block) => block.countryCode === editing.countryCode && blockState(block, new Date()) === "active",
    );
    if (current.strategy !== editing.strategy && outstanding.length > 0) {
      const ok = await confirm({
        title: t("fiscal.changeStrategyTitle"),
        body: t("fiscal.changeStrategyBody").replace("{count}", String(outstanding.length)),
        confirmLabel: t("common.save"),
        tone: "warn",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await services.fiscalSequence.savePolicy(editing);
      policies.reload();
      setEditing(null);
      setMessage(t("fiscal.policySaved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    } finally {
      setSaving(false);
    }
  }

  // -- Till simulation -------------------------------------------------------
  const deviceLink = useConnectivityStore((store) => store.state);
  const [link, setLink] = useState<LinkState>(deviceLink === "online" || deviceLink === "synced" || deviceLink === "syncing" ? "online" : "offline");

  async function allocate(terminal: Terminal, policy: FiscalSequencePolicy) {
    try {
      await services.fiscalSequence.allocate({ policy, branchId: terminal.branchId, terminalId: terminal.id, terminalName: terminal.name });
      blocks.reload();
      setMessage(t("fiscal.blockAllocated").replace("{terminal}", terminal.name));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    }
  }

  async function issue(blockId: string, prefix: string) {
    try {
      const { number } = await services.fiscalSequence.issue(blockId);
      blocks.reload();
      setMessage(t("fiscal.issued").replace("{number}", formatFiscalNumber(prefix, number)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    }
  }

  // -- Register --------------------------------------------------------------
  const [stateFilter, setStateFilter] = useState<BlockState | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reference, setReference] = useState("");

  const allBlocks = useMemo(() => [...(blocks.data ?? [])].sort((a, b) => b.start - a.start), [blocks.data]);
  const visibleBlocks = allBlocks.filter((block) => stateFilter === "all" || blockState(block, now) === stateFilter);
  const pending = allBlocks.filter((block) => blockState(block, now) === "void_pending");
  const totals = allBlocks.reduce(
    (acc, block) => {
      const state = blockState(block, now);
      const unused = unusedCount(block);
      acc.issued += new Set(block.used).size;
      if (state === "void_pending") acc.pendingVoid += unused;
      if (state === "void_reported") acc.reportedVoid += unused;
      if (state === "active") acc.available += unused;
      return acc;
    },
    { issued: 0, available: 0, pendingVoid: 0, reportedVoid: 0 },
  );

  async function recordVoid() {
    const ids = selected.filter((id) => pending.some((block) => block.id === id));
    if (ids.length === 0 || !reference.trim()) return;
    const count = pending.filter((block) => ids.includes(block.id)).reduce((sum, block) => sum + unusedCount(block), 0);
    const ok = await confirm({
      title: t("fiscal.voidConfirmTitle"),
      body: t("fiscal.voidConfirmBody").replace("{count}", formatNumber(count, fmt)).replace("{blocks}", String(ids.length)),
      confirmLabel: t("fiscal.recordVoid"),
      tone: "warn",
    });
    if (!ok) return;
    try {
      await services.fiscalSequence.recordVoidReport(ids, { by: "console", reference });
      blocks.reload();
      setSelected([]);
      setReference("");
      setReporting(false);
      setMessage(t("fiscal.voidRecorded"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.actionFailed"));
    }
  }

  const prefixOf = (code: CountryCode) => policyFor(code).prefix;
  const voidRows = voidReportRows(allBlocks, now, prefixOf);

  return (
    <PageBody>
      <Callout tone="muted">{t("fiscal.localNote")}</Callout>

      {/* 1 — Policies per country pack ----------------------------------- */}
      <Section title={t("fiscal.policies")} hint={t("fiscal.policiesHint")} spec="FR-OFF-017">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("fiscal.policies")}</caption>
            <thead>
              <tr className="border-line text-fg-muted border-b text-xs">
                <th scope="col" className="px-2 py-2 text-start font-medium">{t("fiscal.pack")}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t("fiscal.gapless")}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t("fiscal.strategy")}</th>
                <th scope="col" className="px-2 py-2 text-end font-medium">{t("fiscal.blockSize")}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t("fiscal.voidReporting")}</th>
                <th scope="col" className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {packs.map((pack) => {
                const policy = policyFor(pack.code);
                const stored = policies.data?.some((entry) => entry.countryCode === pack.code);
                return (
                  <tr key={pack.code}>
                    <th scope="row" className="px-2 py-2 text-start font-normal">
                      <span className="text-fg block">{tx(pack.name)}</span>
                      <span className="text-fg-subtle text-xs">
                        {pack.code} · {pack.fiscalProvider ?? t("fiscal.noProvider")} {stored ? "" : `· ${t("fiscal.defaultTag")}`}
                      </span>
                    </th>
                    <td className="px-2 py-2">
                      <Badge tone={policy.gapless ? "accent" : "muted"}>{policy.gapless ? t("common.yes") : t("common.no")}</Badge>
                    </td>
                    <td className="text-fg px-2 py-2 text-xs">{policy.gapless ? t(`fiscal.strategy.${policy.strategy}` as never) : "—"}</td>
                    <td className="px-2 py-2 text-end font-mono tabular-nums">
                      {policy.gapless && policy.strategy === "pre_allocated_block" ? formatNumber(policy.blockSize, fmt) : "—"}
                    </td>
                    <td className="px-2 py-2 text-xs">{policy.voidReportingRequired ? t("fiscal.required") : t("fiscal.notRequired")}</td>
                    <td className="px-2 py-2 text-end">
                      {canEdit ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...policy, updatedAt: new Date().toISOString() })}>
                          {t("common.edit")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 2 — Till behaviour ---------------------------------------------- */}
      <Section
        title={t("fiscal.tillTitle")}
        hint={t("fiscal.tillHint")}
        spec="FR-OFF-017"
        action={
          <Field label={t("fiscal.link")}>
            <Select value={link} onChange={(event) => setLink(event.target.value as LinkState)}>
              <option value="online">{t("fiscal.linkOnline")}</option>
              <option value="offline">{t("fiscal.linkOffline")}</option>
            </Select>
          </Field>
        }
      >
        <AsyncPanel state={terminals} isEmpty={(rows) => rows.length === 0} empty={<p className="text-fg-subtle text-xs">{t("fiscal.noTerminals")}</p>}>
          {(rows) => (
            <ul className="divide-line divide-y">
              {rows.map((terminal) => {
                const branch = branches.find((entry) => entry.id === terminal.branchId);
                const code = branch?.countryCode ?? packs[0]?.code ?? "EG";
                const policy = policyFor(code);
                const terminalBlocks = allBlocks.filter((block) => block.terminalId === terminal.id && block.countryCode === code);
                const mode = tillFiscalMode({ policy, terminalBlocks, link, now: new Date() });
                const tone: Tone =
                  mode.kind === "must_go_online" ? "bad" : mode.kind === "provisional" || mode.kind === "request_block" ? "warn" : mode.kind === "issue_from_block" && mode.low ? "warn" : "good";
                return (
                  <li key={terminal.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-fg text-sm font-medium">
                        {terminal.name} <span className="text-fg-subtle text-xs font-normal">· {branch ? tx(branch.name) : terminal.branchId} · {code}</span>
                      </p>
                      <p className={cx("mt-0.5 text-xs", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-fg-muted")} role={tone === "bad" ? "alert" : undefined}>
                        {mode.kind === "issue_from_block"
                          ? t("fiscal.mode.issue_from_block")
                              .replace("{next}", formatFiscalNumber(policy.prefix, mode.next))
                              .replace("{remaining}", formatNumber(mode.remaining, fmt))
                          : mode.kind === "must_go_online"
                            ? t(`fiscal.mustGoOnline.${mode.reason}` as never)
                            : t(`fiscal.mode.${mode.kind}` as never)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Badge tone={tone}>{t(`fiscal.modeLabel.${mode.kind}` as never)}</Badge>
                      {mode.kind === "request_block" && canEdit ? (
                        <Button size="sm" icon={<Plus size={12} aria-hidden />} onClick={() => void allocate(terminal, policy)}>
                          {t("fiscal.requestBlock")}
                        </Button>
                      ) : null}
                      {mode.kind === "issue_from_block" ? (
                        <Button size="sm" variant="ghost" icon={<Play size={12} aria-hidden />} onClick={() => void issue(mode.blockId, policy.prefix)}>
                          {t("fiscal.simulateSale")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AsyncPanel>
      </Section>

      {/* 3 — Number-block register --------------------------------------- */}
      <TileGrid>
        <MetricTile label={t("fiscal.issuedNumbers")} value={formatNumber(totals.issued, fmt)} />
        <MetricTile label={t("fiscal.availableNumbers")} value={formatNumber(totals.available, fmt)} />
        <MetricTile label={t("fiscal.pendingVoid")} value={formatNumber(totals.pendingVoid, fmt)} spec="FR-OFF-018" />
        <MetricTile label={t("fiscal.reportedVoid")} value={formatNumber(totals.reportedVoid, fmt)} />
      </TileGrid>

      {pending.length > 0 ? (
        <Callout tone="bad" icon={<FileWarning size={14} />} title={t("fiscal.pendingTitle")}>
          {t("fiscal.pendingBody").replace("{count}", formatNumber(totals.pendingVoid, fmt)).replace("{blocks}", String(pending.length))}
        </Callout>
      ) : null}

      <Section
        title={t("fiscal.register")}
        hint={t("fiscal.registerHint")}
        spec="FR-OFF-018"
        padded={false}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              size="sm"
              filename="fiscal-void-report"
              title={t("fiscal.voidReport")}
              rows={voidRows}
              onExported={setMessage}
              columns={[
                { key: "countryCode", header: t("fiscal.pack"), value: (row) => row.countryCode },
                { key: "terminalName", header: t("fiscal.terminal"), value: (row) => row.terminalName },
                { key: "blockRange", header: t("fiscal.range"), value: (row) => row.blockRange },
                { key: "expiredAt", header: t("fiscal.expires"), value: (row) => row.expiredAt },
                { key: "unusedRanges", header: t("fiscal.unusedNumbers"), value: (row) => row.unusedRanges },
                { key: "unusedCount", header: t("fiscal.unused"), value: (row) => row.unusedCount },
                { key: "status", header: t("common.status"), value: (row) => t(`fiscal.state.${row.status}` as never) },
                { key: "reference", header: t("common.reference"), value: (row) => row.reference },
              ]}
            />
            {canEdit ? (
              <Button size="sm" variant="primary" disabled={selected.length === 0} onClick={() => setReporting(true)}>
                {t("fiscal.recordVoid")} ({selected.length})
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="px-5">
          <Toolbar className="mb-3">
            <Field label={t("common.status")}>
              <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as BlockState | "all")}>
                <option value="all">{t("common.all")}</option>
                {(["active", "exhausted", "void_pending", "void_reported", "closed"] as BlockState[]).map((state) => (
                  <option key={state} value={state}>
                    {t(`fiscal.state.${state}` as never)}
                  </option>
                ))}
              </Select>
            </Field>
          </Toolbar>
        </div>
        <AsyncPanel state={blocks} isEmpty={() => visibleBlocks.length === 0} empty={<p className="text-fg-subtle px-5 pb-5 text-xs">{t("fiscal.noBlocks")}</p>}>
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("fiscal.register")}</caption>
                <thead>
                  <tr className="border-line bg-sunken text-fg-muted border-y text-xs">
                    <th scope="col" className="w-10 px-3 py-2">
                      <span className="sr-only">{t("fiscal.select")}</span>
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("fiscal.terminal")}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("fiscal.range")}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("fiscal.expires")}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t("fiscal.used")}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t("fiscal.unused")}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {visibleBlocks.map((block) => (
                    <BlockRow
                      key={block.id}
                      block={block}
                      now={now}
                      prefix={prefixOf(block.countryCode)}
                      selectable={canEdit && blockState(block, now) === "void_pending"}
                      selected={selected.includes(block.id)}
                      onToggle={() => setSelected((current) => (current.includes(block.id) ? current.filter((id) => id !== block.id) : [...current, block.id]))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncPanel>
      </Section>

      {/* Policy editor ----------------------------------------------------- */}
      {editing ? (
        <Drawer
          open
          onClose={() => setEditing(null)}
          title={t("fiscal.editPolicy").replace("{pack}", editing.countryCode)}
          subtitle="FR-OFF-017"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" icon={<Save size={13} aria-hidden />} loading={saving} disabled={policyProblems(editing).length > 0} onClick={() => void savePolicy()}>
                {t("common.save")}
              </Button>
            </div>
          }
        >
          <PolicyForm policy={editing} onChange={setEditing} />
        </Drawer>
      ) : null}

      {/* Void report ------------------------------------------------------- */}
      {reporting ? (
        <Drawer
          open
          onClose={() => setReporting(false)}
          title={t("fiscal.recordVoid")}
          subtitle="FR-OFF-018"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReporting(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" disabled={!reference.trim()} onClick={() => void recordVoid()}>
                {t("fiscal.recordVoid")}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Callout tone="warn">{t("fiscal.voidGatewayNote")}</Callout>
            <ul className="divide-line divide-y text-sm">
              {pending
                .filter((block) => selected.includes(block.id))
                .map((block) => (
                  <li key={block.id} className="py-2">
                    <p className="text-fg">
                      {block.terminalName} · {formatNumber(unusedCount(block), fmt)} {t("fiscal.unused")}
                    </p>
                    <p dir="ltr" className="text-fg-subtle font-mono text-xs break-words">
                      {unusedRanges(block)
                        .map((range) => (range.from === range.to ? formatFiscalNumber(prefixOf(block.countryCode), range.from) : `${formatFiscalNumber(prefixOf(block.countryCode), range.from)}–${formatFiscalNumber(prefixOf(block.countryCode), range.to)}`))
                        .join("; ")}
                    </p>
                  </li>
                ))}
            </ul>
            <Field label={t("fiscal.submissionReference")} hint={t("fiscal.submissionReferenceHint")} required>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} data-autofocus />
            </Field>
          </div>
        </Drawer>
      ) : null}

      <Toast message={message} />
    </PageBody>
  );
}

function BlockRow({
  block,
  now,
  prefix,
  selectable,
  selected,
  onToggle,
}: {
  block: FiscalNumberBlock;
  now: Date;
  prefix: string;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t, fmt } = useI18n();
  const state = blockState(block, now);
  const used = new Set(block.used).size;
  const size = blockSize(block);
  return (
    <tr className={selected ? "bg-accent-soft/40" : undefined}>
      <td className="px-3 py-2">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={t("fiscal.selectBlock").replace("{range}", `${block.start}–${block.end}`)}
            className="accent-accent h-4 w-4"
          />
        ) : null}
      </td>
      <td className="px-3 py-2">
        <span className="text-fg block">{block.terminalName}</span>
        <span className="text-fg-subtle text-xs">{block.countryCode}</span>
      </td>
      <td dir="ltr" className="px-3 py-2 font-mono text-xs">
        {formatFiscalNumber(prefix, block.start)} – {formatFiscalNumber(prefix, block.end)}
      </td>
      <td className="px-3 py-2 text-xs">{formatDateTime(block.expiresAt, fmt)}</td>
      <td className="px-3 py-2 text-end font-mono tabular-nums">
        {formatNumber(used, fmt)} / {formatNumber(size, fmt)}
      </td>
      <td className="px-3 py-2 text-end font-mono tabular-nums">{formatNumber(unusedCount(block), fmt)}</td>
      <td className="px-3 py-2">
        <Badge tone={STATE_TONE[state]}>{t(`fiscal.state.${state}` as never)}</Badge>
        {block.voidReport ? (
          <span className="text-fg-subtle mt-0.5 block text-[0.68rem]">
            {block.voidReport.reference} · {formatDateTime(block.voidReport.reportedAt, fmt)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function PolicyForm({ policy, onChange }: { policy: FiscalSequencePolicy; onChange: (next: FiscalSequencePolicy) => void }) {
  const { t } = useI18n();
  const problems = policyProblems(policy);
  const numberField = (key: "blockSize" | "blockValidityHours" | "lowWaterPercent", value: string) =>
    onChange({ ...policy, [key]: value === "" ? Number.NaN : Number(value) });

  return (
    <div className="space-y-4">
      <Toggle checked={policy.gapless} onChange={(gapless) => onChange({ ...policy, gapless })} label={t("fiscal.gapless")} hint={t("fiscal.gaplessHint")} />
      {policy.gapless ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-fg text-xs font-medium">{t("fiscal.strategy")}</legend>
            {SEQUENCE_STRATEGIES.map((strategy: SequenceStrategy) => (
              <label key={strategy} className={cx("border-line flex cursor-pointer gap-3 rounded-lg border p-3", policy.strategy === strategy && "border-accent bg-accent-soft/40")}>
                <input
                  type="radio"
                  name="strategy"
                  value={strategy}
                  checked={policy.strategy === strategy}
                  onChange={() => onChange({ ...policy, strategy })}
                  className="accent-accent mt-0.5"
                />
                <span>
                  <span className="text-fg block text-sm">{t(`fiscal.strategy.${strategy}` as never)}</span>
                  <span className="text-fg-subtle block text-xs leading-relaxed">{t(`fiscal.strategyHint.${strategy}` as never)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {policy.strategy === "pre_allocated_block" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("fiscal.blockSize")} error={problems.includes("block_size") ? t("fiscal.problem.block_size") : null}>
                <Input type="number" inputMode="numeric" min={10} value={Number.isNaN(policy.blockSize) ? "" : policy.blockSize} onChange={(event) => numberField("blockSize", event.target.value)} />
              </Field>
              <Field label={t("fiscal.validityHours")} error={problems.includes("validity") ? t("fiscal.problem.validity") : null}>
                <Input type="number" inputMode="numeric" min={1} value={Number.isNaN(policy.blockValidityHours) ? "" : policy.blockValidityHours} onChange={(event) => numberField("blockValidityHours", event.target.value)} />
              </Field>
              <Field label={t("fiscal.lowWater")} hint={t("fiscal.lowWaterHint")} error={problems.includes("low_water") ? t("fiscal.problem.low_water") : null}>
                <Input type="number" inputMode="numeric" min={0} max={90} value={Number.isNaN(policy.lowWaterPercent) ? "" : policy.lowWaterPercent} onChange={(event) => numberField("lowWaterPercent", event.target.value)} />
              </Field>
            </div>
          ) : null}
          <Toggle
            checked={policy.voidReportingRequired}
            onChange={(voidReportingRequired) => onChange({ ...policy, voidReportingRequired })}
            label={t("fiscal.voidReporting")}
            hint={t("fiscal.voidReportingHint")}
          />
        </>
      ) : (
        <Callout tone="muted">{t("fiscal.notGaplessNote")}</Callout>
      )}
      <Field label={t("fiscal.prefix")} error={problems.includes("prefix") ? t("fiscal.problem.prefix") : null}>
        <Input dir="ltr" value={policy.prefix} onChange={(event) => onChange({ ...policy, prefix: event.target.value.toUpperCase() })} />
      </Field>
    </div>
  );
}
