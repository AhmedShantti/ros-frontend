"use client";

/**
 * Named price lists, their scope and their precedence — FR-MNU-020, FR-MNU-021.
 *
 * Three parts:
 *
 *  - **Authoring** a list with everything FR-MNU-020 names: a scope (tenant,
 *    brand, branch or branch group), a validity window, an optional recurring
 *    window and a priority — plus the order type it prices (FR-MNU-021).
 *    `POST /catalogue/price-lists` takes all of these except the branch group,
 *    which C-06 deliberately left out of the enum; a group is materialised as
 *    one branch-scoped list per member, created through the same endpoint and
 *    linked in `services.menuPricing.branchGroups`.
 *  - **Resolution**: which list prices an item for a given order type, branch
 *    and moment, and why every other list lost. This is the question behind
 *    "why is delivery charging the dine-in price?", and it is answered from
 *    the same data the till reads.
 *  - **Branch groups** themselves.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Id, Localised, MenuItem, OrderType, PriceList, PriceListEntry } from "@/lib/console/types";
import type { BranchGroup } from "@/lib/console/services/menu-pricing";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync, useBranches } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber } from "@/lib/console/format";
import { ORDER_TYPE, PRICE_LIST_SCOPE, labelOf } from "@/lib/console/labels";
import {
  parseRecurrence,
  resolvePrice,
  serialiseRecurrence,
  type ExclusionReason,
  type RecurrenceWindow,
} from "@/lib/console/menu-pricing";
import { localDateTimeValue } from "@/components/console/menu-price-tools";
import { useConfirm } from "@/components/console/confirm";
import { FranchiseLockNotice, useFranchiseLock } from "@/components/console/franchise-lock";
import { AsyncPanel } from "@/components/console/states";
import { EMPTY_LOCALISED, LocalisedField, hasLocalisedText, trimLocalised } from "@/components/console/fields";
import { Badge, Button, Callout, Card, CardHeader, Drawer, Field, Input, Select, cx } from "@/components/console/ui";

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function dayLabel(day: number, locale: string): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "short" }).format(new Date(2023, 0, 1 + day));
}

type ScopeChoice = "tenant" | "brand" | "branch" | "branch_group";

// ---------------------------------------------------------------------------
// FR-MNU-020/021 — authoring
// ---------------------------------------------------------------------------

export function NewPriceListDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { availableBrands, scope: sessionScope } = useSession();
  const branches = useBranches(sessionScope);
  const action = useAction();

  const [name, setName] = useState<Localised>({ ...EMPTY_LOCALISED });
  const [scope, setScope] = useState<ScopeChoice>("tenant");
  const [scopeId, setScopeId] = useState("");
  const [orderType, setOrderType] = useState<OrderType | "">("");
  const [priority, setPriority] = useState("10");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("18:00");

  const groups = useAsync(() => (open ? services.menuPricing.branchGroups.all() : Promise.resolve([])), [open]);
  // FR-BRN-035 — a branch list at a franchise branch that keeps pricing with the brand.
  const lock = useFranchiseLock(scope === "branch" && scopeId ? scopeId : null, "pricing");

  if (!open) return null;

  const priorityNumber = Number(priority);
  const problems: string[] = [];
  if (!hasLocalisedText(name)) problems.push(t("mnp.list.nameRequired"));
  if (!Number.isInteger(priorityNumber) || priorityNumber < 0) problems.push(t("mnp.list.priorityInvalid"));
  if (scope !== "tenant" && !scopeId) problems.push(t("mnp.list.scopeRequired"));
  if (validFrom && validTo && validTo < validFrom) problems.push(t("mnp.list.windowInvalid"));
  if (recurring && days.length === 0) problems.push(t("mnp.list.daysRequired"));
  if (recurring && start === end) problems.push(t("mnp.list.timesInvalid"));
  if (lock.locked) problems.push(t("frn.lock.lockedTitle"));

  const group = (groups.data ?? []).find((row) => row.id === scopeId) ?? null;

  async function create() {
    if (problems.length > 0) return;
    const base = {
      priority: priorityNumber,
      validFrom: validFrom || null,
      validTo: validTo || null,
      // FR-MNU-021 — none selected means every order type.
      orderTypes: orderType ? [orderType] : [],
      recurrence: recurring ? serialiseRecurrence({ days, start, end }) : null,
    };

    await action.run(
      async () => {
        if (scope !== "branch_group") {
          await services.catalogue.priceLists.create({
            ...base,
            name: trimLocalised(name),
            scope,
            scopeId: scope === "tenant" ? null : scopeId,
          });
          return 1;
        }
        // C-06 — no branch_group scope on the server: one branch list per member.
        if (!group) return 0;
        const created: Id[] = [];
        for (const branchId of group.branchIds) {
          const branch = branches.find((row) => row.id === branchId);
          const suffix = branch ? tx(branch.name) : branchId;
          const list = await services.catalogue.priceLists.create({
            ...base,
            name: { en: `${name.en.trim() || name.ar.trim()} · ${suffix}`, ar: `${name.ar.trim() || name.en.trim()} · ${suffix}` },
            scope: "branch",
            scopeId: branchId,
          });
          created.push(list.id);
        }
        await services.menuPricing.branchGroups.update(group.id, {
          priceListIds: [...group.priceListIds, ...created],
        });
        return created.length;
      },
      {
        onSuccess: (count) => {
          setName({ ...EMPTY_LOCALISED });
          onCreated(count);
        },
      },
    );
  }

  const singleNameHint = DATA_MODE === "http" ? t("loc.singleOnServer") : undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("menu.newPriceList")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={problems.length > 0} onClick={() => void create()}>
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

        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={120} hint={singleNameHint} />

        {/* FR-MNU-020: scope — tenant, brand, branch or branch group */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("menu.scope")}>
            <Select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as ScopeChoice);
                setScopeId("");
              }}
            >
              <option value="tenant">{t("menu.scopeTenant")}</option>
              <option value="brand">{t("menu.scopeBrand")}</option>
              <option value="branch">{t("menu.scopeBranch")}</option>
              <option value="branch_group">{t("mnp.list.scopeGroup")}</option>
            </Select>
          </Field>
          {scope === "brand" ? (
            <Field label={t("mnp.list.brand")} required>
              <Select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
                <option value="">—</option>
                {availableBrands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {tx(brand.name)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {scope === "branch" ? (
            <Field label={t("mnp.list.branch")} required>
              <Select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
                <option value="">—</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {tx(branch.name)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {scope === "branch_group" ? (
            <Field label={t("mnp.list.group")} required hint={(groups.data ?? []).length === 0 ? t("mnp.list.noGroups") : undefined}>
              <Select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
                <option value="">—</option>
                {(groups.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {tx(row.name)} ({formatNumber(row.branchIds.length, fmt)})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        {scope === "branch_group" ? <Callout tone="muted">{t("mnp.list.groupNote")}</Callout> : null}
        <FranchiseLockNotice lock={lock} domain="pricing" />

        <div className="grid gap-3 sm:grid-cols-2">
          {/* FR-MNU-021: order-type-specific pricing */}
          <Field label={t("mnp.list.orderType")} hint={t("mnp.list.orderTypeHint")}>
            <Select value={orderType} onChange={(event) => setOrderType(event.target.value as OrderType | "")}>
              <option value="">{t("mnp.list.allOrderTypes")}</option>
              {Object.entries(ORDER_TYPE).map(([value, entry]) => (
                <option key={value} value={value}>
                  {tx(entry.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("menu.priority")} hint={t("menu.priorityHint")} required>
            <Input inputMode="numeric" dir="ltr" value={priority} onChange={(event) => setPriority(event.target.value)} />
          </Field>
        </div>

        {/* FR-MNU-020: validity window */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("mnp.list.validFrom")} hint={t("mnp.list.validFromHint")}>
            <Input type="date" dir="ltr" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
          </Field>
          <Field label={t("mnp.list.validTo")} hint={t("mnp.list.validToHint")}>
            <Input type="date" dir="ltr" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
          </Field>
        </div>

        {/* FR-MNU-020: optional recurrence schedule */}
        <section className="border-line space-y-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
            {t("mnp.list.recurring")}
          </label>
          {recurring ? (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("mnp.list.days")}>
                {DAYS.map((day) => {
                  const on = days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays(on ? days.filter((d) => d !== day) : [...days, day])}
                      className={cx(
                        "rounded-md border px-2.5 py-1 text-xs",
                        on ? "bg-accent text-accent-fg border-transparent" : "border-line text-fg-muted",
                      )}
                    >
                      {dayLabel(day, locale)}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("mnp.list.start")}>
                  <Input type="time" dir="ltr" value={start} onChange={(event) => setStart(event.target.value)} />
                </Field>
                <Field label={t("mnp.list.end")} hint={t("mnp.list.endHint")}>
                  <Input type="time" dir="ltr" value={end} onChange={(event) => setEnd(event.target.value)} />
                </Field>
              </div>
              {DATA_MODE === "http" ? <Callout tone="warn">{t("mnp.list.recurrenceServer")}</Callout> : null}
            </>
          ) : null}
        </section>

        {problems.length > 0 ? (
          <ul className="text-fg-muted space-y-0.5 text-xs">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}

/** Readable recurrence for a table cell. */
export function RecurrenceText({ recurrence }: { recurrence: string | null }) {
  const { t, locale } = useI18n();
  const parsed = parseRecurrence(recurrence);
  if (!parsed) return <span className="text-fg-subtle">—</span>;
  if (parsed === "opaque") return <span className="text-fg-muted font-mono text-xs">{recurrence}</span>;
  return (
    <span className="text-fg-muted text-xs" dir="auto">
      {parsed.days.map((day) => dayLabel(day, locale)).join(" ")} · <span dir="ltr">{parsed.start}–{parsed.end}</span>
      {parsed.days.length === 7 ? ` (${t("mnp.list.everyDay")})` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-020/021 — resolution preview
// ---------------------------------------------------------------------------

export function PriceResolutionPanel({ lists }: { lists: PriceList[] }) {
  const { t, tx, fmt } = useI18n();
  const { availableBrands, scope: sessionScope } = useSession();
  const branches = useBranches(sessionScope);

  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [branchId, setBranchId] = useState(sessionScope.branchId ?? "");
  const [at, setAt] = useState(() => localDateTimeValue(new Date()));

  const items = useAsync(() => services.catalogue.items.list({ limit: 1000 }).then((page) => page.rows), []);
  const detail = useAsync(async () => (itemId ? services.catalogue.items.get(itemId) : null), [itemId]);
  const entries = useAsync(
    async () =>
      Promise.all(
        lists.map(async (list) => ({
          list,
          entries: await services.catalogue.priceEntries(list.id).catch(() => [] as PriceListEntry[]),
        })),
      ),
    [lists.map((list) => list.id).join(",")],
  );

  const branch = branches.find((row) => row.id === branchId) ?? null;
  const brandId = branch?.brandId ?? sessionScope.brandId ?? availableBrands[0]?.id ?? null;
  const moment = new Date(at);
  const variants = detail.data?.variants ?? [];
  const chosenVariant = variantId || variants[0]?.id || "";

  const matrix = useMemo(() => {
    if (!entries.data || !chosenVariant || Number.isNaN(moment.getTime())) return [];
    return (Object.keys(ORDER_TYPE) as OrderType[]).map((orderType) => ({
      orderType,
      resolution: resolvePrice(entries.data!, {
        variantId: chosenVariant,
        orderType,
        brandId,
        branchId: branchId || null,
        at: moment,
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.data, chosenVariant, brandId, branchId, at]);

  const [openType, setOpenType] = useState<OrderType | null>(null);
  const expanded = matrix.find((row) => row.orderType === openType) ?? null;

  return (
    <Card>
      <CardHeader title={t("mnp.resolve.title")} hint={t("mnp.resolve.hint")} spec="FR-MNU-021" />
      <div className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("menu.itemName")}>
            <Select
              value={itemId}
              onChange={(event) => {
                setItemId(event.target.value);
                setVariantId("");
              }}
            >
              <option value="">—</option>
              {(items.data ?? []).map((item: MenuItem) => (
                <option key={item.id} value={item.id}>
                  {tx(item.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("menu.variants")}>
            <Select value={chosenVariant} disabled={!itemId} onChange={(event) => setVariantId(event.target.value)}>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {tx(variant.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("mnp.list.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">{t("mnp.resolve.anyBranch")}</option>
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("mnp.resolve.at")}>
            <Input type="datetime-local" dir="ltr" value={at} onChange={(event) => setAt(event.target.value)} />
          </Field>
        </div>

        {!itemId ? (
          <Callout tone="muted">{t("mnp.resolve.pick")}</Callout>
        ) : (
          <AsyncPanel state={entries}>
            {() => (
              <div className="space-y-3">
                <ul className="border-line divide-line divide-y rounded-lg border">
                  {matrix.map(({ orderType, resolution }) => {
                    const type = labelOf(ORDER_TYPE, orderType);
                    const winner = resolution.winner;
                    return (
                      <li key={orderType}>
                        <button
                          type="button"
                          className="hover:bg-sunken flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start text-sm"
                          aria-expanded={openType === orderType}
                          onClick={() => setOpenType(openType === orderType ? null : orderType)}
                        >
                          <Badge tone={type.tone}>{tx(type.label)}</Badge>
                          <span className="text-fg-muted min-w-0 flex-1 truncate text-xs">
                            {winner ? tx(winner.list.name) : t("mnp.resolve.noPrice")}
                          </span>
                          {resolution.tie ? <Badge tone="warn">{t("mnp.resolve.tie")}</Badge> : null}
                          {winner?.opaqueRecurrence ? <Badge tone="warn">{t("mnp.resolve.opaque")}</Badge> : null}
                          <span className={cx("font-mono tabular-nums", !winner && "text-bad")}>
                            {winner?.entry ? formatMoney(winner.entry.price, fmt) : "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {expanded ? (
                  <div className="border-line rounded-lg border p-3">
                    <h4 className="text-fg mb-2 text-xs font-semibold">
                      {t("mnp.resolve.why").replace("{type}", tx(labelOf(ORDER_TYPE, expanded.orderType).label))}
                    </h4>
                    <ul className="space-y-1.5">
                      {expanded.resolution.candidates.map((candidate) => {
                        const won = expanded.resolution.winner?.list.id === candidate.list.id;
                        const listScope = labelOf(PRICE_LIST_SCOPE, candidate.list.scope);
                        return (
                          <li key={candidate.list.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className={cx("font-mono", won ? "text-good font-semibold" : "text-fg-subtle")} dir="ltr">
                              P{candidate.list.priority}
                            </span>
                            <span className={cx(won ? "text-fg font-medium" : "text-fg-muted")}>{tx(candidate.list.name)}</span>
                            <Badge tone={listScope.tone}>{tx(listScope.label)}</Badge>
                            {won ? <Badge tone="good">{t("mnp.resolve.wins")}</Badge> : null}
                            {candidate.excluded.map((reason: ExclusionReason) => (
                              <Badge key={reason} tone="muted">
                                {t(`mnp.resolve.reason.${reason}` as never)}
                              </Badge>
                            ))}
                            {candidate.entry ? (
                              <span className="text-fg-subtle ms-auto font-mono">{formatMoney(candidate.entry.price, fmt)}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                <p className="text-fg-subtle text-xs leading-relaxed">
                  {DATA_MODE === "http" ? t("mnp.resolve.serverNote") : t("mnp.resolve.demoNote")}
                </p>
              </div>
            )}
          </AsyncPanel>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FR-MNU-020 — branch groups
// ---------------------------------------------------------------------------

export function BranchGroupsPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const canChange = usePermission("menu.price.change");
  const confirm = useConfirm();
  const [editing, setEditing] = useState<BranchGroup | "new" | null>(null);
  const [nonce, setNonce] = useState(0);

  const groups = useAsync(() => services.menuPricing.branchGroups.all(), [nonce]);

  async function remove(group: BranchGroup) {
    const ok = await confirm({
      title: t("mnp.group.deleteTitle").replace("{name}", tx(group.name)),
      body: t("mnp.group.deleteBody").replace("{count}", formatNumber(group.priceListIds.length, fmt)),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await services.menuPricing.branchGroups.remove(group.id);
    setNonce((n) => n + 1);
    onChanged(t("mnp.group.deleted"));
  }

  return (
    <Card>
      <CardHeader
        title={t("mnp.group.title")}
        hint={t("mnp.group.hint")}
        spec="FR-MNU-020"
        action={
          canChange ? (
            <Button variant="ghost" icon={<Plus size={13} />} onClick={() => setEditing("new")}>
              {t("common.new")}
            </Button>
          ) : null
        }
      />
      <AsyncPanel
        state={groups}
        isEmpty={(rows) => rows.length === 0}
        empty={<Callout tone="muted">{t("mnp.group.empty")}</Callout>}
      >
        {(rows) => (
          <ul className="border-line divide-line mt-3 divide-y rounded-lg border">
            {rows.map((group) => (
              <li key={group.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm font-medium">{tx(group.name)}</p>
                  <p className="text-fg-subtle truncate text-xs">
                    {group.branchIds
                      .map((id) => {
                        const branch = branches.find((row) => row.id === id);
                        return branch ? tx(branch.name) : id;
                      })
                      .join(" · ")}
                  </p>
                </div>
                <Badge tone="muted">
                  {t("mnp.group.lists").replace("{count}", formatNumber(group.priceListIds.length, fmt))}
                </Badge>
                {canChange ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>
                      {t("common.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t("common.delete")} icon={<Trash2 size={13} />} onClick={() => void remove(group)} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>

      {editing ? (
        <BranchGroupDrawer
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNonce((n) => n + 1);
            onChanged(t("mnp.group.saved"));
          }}
        />
      ) : null}
    </Card>
  );
}

function BranchGroupDrawer({
  group,
  onClose,
  onSaved,
}: {
  group: BranchGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const branches = useBranches(scope);
  const action = useAction();
  const [name, setName] = useState<Localised>(group?.name ?? { ...EMPTY_LOCALISED });
  const [branchIds, setBranchIds] = useState<Id[]>(group?.branchIds ?? []);

  const valid = hasLocalisedText(name) && branchIds.length >= 2;

  async function save() {
    if (!valid) return;
    await action.run(
      () =>
        group
          ? services.menuPricing.branchGroups.update(group.id, { name: trimLocalised(name), branchIds })
          : services.menuPricing.branchGroups.create({ name: trimLocalised(name), branchIds, priceListIds: [] }),
      { onSuccess: onSaved },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={group ? tx(group.name) : t("mnp.group.new")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" loading={action.pending} disabled={!valid} onClick={() => void save()}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("mnp.group.localNote")}</Callout>
        <LocalisedField label={t("common.name")} value={name} onChange={setName} required maxLength={80} />
        <Field label={t("mnp.group.members")} hint={t("mnp.group.membersHint")} required>
          <ul className="border-line divide-line max-h-72 divide-y overflow-y-auto rounded-lg border">
            {branches.map((branch) => (
              <li key={branch.id}>
                <label className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(branch.id)}
                    onChange={(event) =>
                      setBranchIds(event.target.checked ? [...branchIds, branch.id] : branchIds.filter((id) => id !== branch.id))
                    }
                  />
                  {tx(branch.name)}
                </label>
              </li>
            ))}
          </ul>
        </Field>
        {group && group.priceListIds.length > 0 ? <Callout tone="warn">{t("mnp.group.membershipNote")}</Callout> : null}
      </div>
    </Drawer>
  );
}

/** The group a list was created for, if any. */
export function useListGroup(listId: Id | null) {
  return useAsync(
    async () => (listId ? ((await services.menuPricing.branchGroups.all()).find((group) => group.priceListIds.includes(listId)) ?? null) : null),
    [listId],
  );
}

export type { RecurrenceWindow };
