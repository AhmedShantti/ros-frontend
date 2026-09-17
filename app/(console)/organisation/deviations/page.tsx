"use client";

/**
 * Brand standards and branch deviations — SRS §17.2, FR-BRN-006, FR-BRN-007.
 *
 * Menu, price and recipe are managed centrally, per brand, and a branch may
 * depart from them — a different price in an airport, a recipe adjusted for
 * a local supplier's product. What the brand must be able to see is *where*
 * that has happened. So this screen does three things:
 *
 *   1. records the brand standard: which menus every branch serves, which
 *      price list is the reference, and how far a branch price may drift
 *      before it counts as a deviation;
 *   2. lets a branch override centrally — a branch-scoped price list entry
 *      (real price-list endpoints) or a recipe override (kept locally; the
 *      API has no branch recipe variant) — subject to franchise locks
 *      (FR-BRN-035);
 *   3. reports every branch that deviates, by menu, price and recipe.
 *
 * Menu *authoring* belongs to the menu module; this screen only reads menus
 * and price lists and writes branch-level overrides.
 */

import { useMemo, useState } from "react";
import { Check, GitMerge, Plus, Save, X } from "lucide-react";

import type { Branch, Id, MenuItem, Recipe } from "@/lib/console/types";
import type { BrandStandard, RecipeOverride, RecipeOverrideLine } from "@/lib/console/branch-network";
import { franchiseLockFor } from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatPercent, numberFromInput, toMajorUnits } from "@/lib/console/format";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { BranchGroupSelect, useBranchGroups, useGroupBranchIds } from "@/components/console/branch-group-filter";
import { deviationsFor, useDeviationInputs, type DeviationInputs } from "@/components/console/branch-deviation-data";
import { FranchiseLockNotice, todayIso } from "@/components/console/franchise-lock";
import { Badge, Button, Callout, Field, Input, Modal, Select, Textarea, Toast } from "@/components/console/ui";

export default function DeviationsPage() {
  return (
    <Gate permissions={["org.manage", "menu.price.read", "recipe.view"]}>
      <DeviationsScreen />
    </Gate>
  );
}

function DeviationsScreen() {
  const { t, tx } = useI18n();
  const { scope, availableBrands, availableBranches, session } = useSession();
  const canManageStandard = usePermission("org.manage");
  const canPrice = usePermission("menu.price.change");
  const canRecipe = usePermission("recipe.edit");
  const [message, setMessage] = useTransientMessage();
  const [nonce, setNonce] = useState(0);
  const [brandId, setBrandId] = useState<string>(scope.brandId ?? "");
  const [groupId, setGroupId] = useState("");
  const [pricing, setPricing] = useState(false);
  const [overriding, setOverriding] = useState(false);

  const inputs = useDeviationInputs(nonce);
  const groups = useBranchGroups();
  const allowed = useGroupBranchIds(groups.data, groupId);
  const reload = () => setNonce((n) => n + 1);

  const branches = useMemo(
    () => availableBranches.filter((b) => (!brandId || b.brandId === brandId) && (!allowed || allowed.has(b.id))),
    [availableBranches, brandId, allowed],
  );

  const branchName = (id: Id) => {
    const branch = availableBranches.find((b) => b.id === id);
    return branch ? tx(branch.name) : id;
  };

  return (
    <>
      <PageHeader
        title={t("bdev.title")}
        subtitle={t("bdev.subtitle")}
        spec="FR-BRN-006"
        actions={
          <div className="flex flex-wrap gap-2">
            {canPrice ? (
              <Button variant="secondary" icon={<Plus size={14} />} onClick={() => setPricing(true)}>
                {t("bdev.setBranchPrice")}
              </Button>
            ) : null}
            {canRecipe ? (
              <Button variant="secondary" icon={<GitMerge size={14} />} onClick={() => setOverriding(true)}>
                {t("bdev.newRecipeOverride")}
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <AsyncPanel state={inputs}>
          {(data) => (
            <>
              <StandardEditor
                data={data}
                canManage={canManageStandard}
                onSaved={() => {
                  setMessage(t("bdev.standardSaved"));
                  reload();
                }}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("common.brand")}>
                  <Select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
                    <option value="">{t("bdev.allBrands")}</option>
                    {availableBrands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {tx(brand.name)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <BranchGroupSelect groups={groups.data ?? []} value={groupId} onChange={setGroupId} />
              </div>
              <DeviationReport
                data={data}
                branches={branches}
                branchName={branchName}
                onDecided={(note) => {
                  setMessage(note);
                  reload();
                }}
                decider={session?.user.email ?? null}
              />
              {pricing ? (
                <BranchPriceModal
                  data={data}
                  onClose={() => setPricing(false)}
                  onDone={() => {
                    setPricing(false);
                    setMessage(t("bdev.priceSaved"));
                    reload();
                  }}
                />
              ) : null}
              {overriding ? (
                <RecipeOverrideModal
                  data={data}
                  onClose={() => setOverriding(false)}
                  onDone={() => {
                    setOverriding(false);
                    setMessage(t("bdev.overrideSaved"));
                    reload();
                  }}
                />
              ) : null}
            </>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// FR-BRN-006 — the brand standard
// ---------------------------------------------------------------------------

function StandardEditor({ data, canManage, onSaved }: { data: DeviationInputs; canManage: boolean; onSaved: () => void }) {
  const { t, tx } = useI18n();
  const { availableBrands } = useSession();
  const action = useAction();
  const [brandId, setBrandId] = useState(availableBrands[0]?.id ?? "");
  const existing = data.standards.find((row) => row.brandId === brandId) ?? null;
  const [draft, setDraft] = useState<{ brandId: string; menuIds: Id[]; priceListId: string; tolerance: string } | null>(null);
  const current =
    draft && draft.brandId === brandId
      ? draft
      : {
          brandId,
          menuIds: existing?.menuIds ?? [],
          priceListId: existing?.priceListId ?? "",
          tolerance: String(existing?.priceTolerancePercent ?? 0),
        };
  const referenceLists = data.priceLists.filter((list) => list.scope !== "branch" && (list.scope === "tenant" || list.scopeId === brandId));
  const tolerance = numberFromInput(current.tolerance);

  async function save() {
    if (tolerance === null || tolerance < 0 || tolerance > 100) return;
    const row: BrandStandard = {
      id: brandId,
      brandId,
      menuIds: current.menuIds,
      priceListId: current.priceListId || null,
      priceTolerancePercent: tolerance,
      updatedAt: new Date().toISOString(),
    };
    await action.run(() => services.branchNetwork.standards.put(row), {
      onSuccess: () => {
        setDraft(null);
        onSaved();
      },
    });
  }

  return (
    <Section title={t("bdev.standardTitle")} hint={t("bdev.standardHint")} spec="FR-BRN-006">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label={t("common.brand")}>
          <Select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
            {availableBrands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {tx(brand.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("bdev.referencePriceList")} hint={t("bdev.referencePriceListHint")}>
          <Select
            value={current.priceListId}
            disabled={!canManage}
            onChange={(event) => setDraft({ ...current, priceListId: event.target.value })}
          >
            <option value="">{t("common.none")}</option>
            {referenceLists.map((list) => (
              <option key={list.id} value={list.id}>
                {tx(list.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("bdev.tolerance")}
          hint={t("bdev.toleranceHint")}
          error={tolerance === null || tolerance < 0 || tolerance > 100 ? t("bdev.toleranceInvalid") : null}
        >
          <Input
            dir="ltr"
            inputMode="decimal"
            disabled={!canManage}
            value={current.tolerance}
            onChange={(event) => setDraft({ ...current, tolerance: event.target.value })}
            className="font-mono"
          />
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="text-fg mb-2 text-xs font-medium">{t("bdev.standardMenus")}</legend>
        {data.menus.length === 0 ? (
          <p className="text-fg-muted text-sm">{t("bdev.noMenus")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.menus.map((menu) => (
              <label key={menu.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={current.menuIds.includes(menu.id)}
                  onChange={(event) =>
                    setDraft({
                      ...current,
                      menuIds: event.target.checked
                        ? [...current.menuIds, menu.id]
                        : current.menuIds.filter((id) => id !== menu.id),
                    })
                  }
                />
                <span className="text-fg">{tx(menu.name)}</span>
                {!menu.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {canManage ? (
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            icon={<Save size={14} />}
            loading={action.pending}
            disabled={!brandId || tolerance === null || tolerance < 0 || tolerance > 100}
            onClick={save}
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-BRN-006 / FR-BRN-007 — the report
// ---------------------------------------------------------------------------

type PriceRow = ReturnType<typeof deviationsFor>[number]["prices"][number];
type MenuRow = { branchId: Id; kind: "missing" | "extra"; menuName: string };
type RecipeRow = ReturnType<typeof deviationsFor>[number]["recipes"][number];

function DeviationReport({
  data,
  branches,
  branchName,
  onDecided,
  decider,
}: {
  data: DeviationInputs;
  branches: Branch[];
  branchName: (id: Id) => string;
  onDecided: (note: string) => void;
  decider: string | null;
}) {
  const { t, tx, fmt } = useI18n();
  const canPublish = usePermission("recipe.publish");
  const canOrg = usePermission("org.manage");
  const canDecide = canPublish || canOrg;
  const confirm = useConfirm();
  const action = useAction();
  const deviations = useMemo(() => deviationsFor(branches, data), [branches, data]);

  const noStandard = deviations.filter((row) => !row.standard);
  const menuRows: MenuRow[] = deviations.flatMap((row) => [
    ...(row.menu?.missing ?? []).map((menu) => ({ branchId: row.branch.id, kind: "missing" as const, menuName: tx(menu.name) })),
    ...(row.menu?.extra ?? []).map((menu) => ({ branchId: row.branch.id, kind: "extra" as const, menuName: tx(menu.name) })),
  ]);
  const priceRows: PriceRow[] = deviations.flatMap((row) => row.prices);
  const recipeRows: RecipeRow[] = deviations.flatMap((row) => row.recipes);

  async function decide(override: RecipeOverride, status: "approved" | "rejected") {
    if (status === "rejected") {
      const ok = await confirm({
        title: t("bdev.rejectTitle"),
        body: t("bdev.rejectBody").replace("{recipe}", tx(override.recipeName)).replace("{branch}", branchName(override.branchId)),
        confirmLabel: t("bdev.reject"),
        tone: "danger",
      });
      if (!ok) return;
    }
    await action.run(() => services.branchNetwork.decideOverride(override.id, status, decider), {
      onSuccess: () => onDecided(status === "approved" ? t("bdev.approved") : t("bdev.rejected")),
    });
  }

  const menuColumns: Column<MenuRow>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => branchName(row.branchId) },
    { key: "menu", header: t("bdev.menu"), render: (row) => row.menuName },
    {
      key: "kind",
      header: t("bdev.deviation"),
      render: (row) => (
        <Badge tone={row.kind === "missing" ? "bad" : "warn"}>
          {row.kind === "missing" ? t("bdev.menuMissing") : t("bdev.menuExtra")}
        </Badge>
      ),
    },
  ];

  const priceColumns: Column<PriceRow>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => branchName(row.branchId) },
    { key: "item", header: t("bdev.item"), render: (row) => tx(row.itemName) },
    { key: "standard", header: t("bdev.standardPrice"), numeric: true, render: (row) => formatMoney(row.standard, fmt) },
    { key: "branchPrice", header: t("bdev.branchPrice"), numeric: true, render: (row) => formatMoney(row.branch, fmt) },
    {
      key: "diff",
      header: t("bdev.difference"),
      numeric: true,
      render: (row) => (
        <span className={row.beyondTolerance ? "text-bad font-semibold" : "text-fg-muted"}>
          {row.difference > 0 ? "+" : ""}
          {formatPercent(row.percent, fmt)}
        </span>
      ),
    },
    {
      key: "tolerance",
      header: t("bdev.status"),
      render: (row) =>
        row.beyondTolerance ? <Badge tone="bad">{t("bdev.beyondTolerance")}</Badge> : <Badge tone="muted">{t("bdev.withinTolerance")}</Badge>,
    },
  ];

  const recipeColumns: Column<RecipeRow>[] = [
    { key: "branch", header: t("common.branch"), render: (row) => branchName(row.override.branchId) },
    {
      key: "recipe",
      header: t("bdev.recipe"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{tx(row.override.recipeName)}</span>
          <span className="text-fg-subtle text-xs">{row.override.reason}</span>
        </span>
      ),
    },
    {
      key: "lines",
      header: t("bdev.changedLines"),
      render: (row) => (
        <ul className="space-y-0.5 text-xs">
          {row.override.lines
            .filter((line) => line.branchQuantity !== line.standardQuantity)
            .map((line) => (
              <li key={line.lineId}>
                {tx(line.componentName)}:{" "}
                <span className="font-mono" dir="ltr">
                  {line.standardQuantity} → {line.branchQuantity} {line.unit}
                </span>
              </li>
            ))}
        </ul>
      ),
    },
    {
      key: "status",
      header: t("bdev.status"),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={row.override.status === "approved" ? "good" : "warn"}>{t(`bdev.override.${row.override.status}` as never)}</Badge>
          {row.stale ? <Badge tone="bad">{t("bdev.stale")}</Badge> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canDecide && row.override.status === "pending" ? (
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" icon={<Check size={12} />} disabled={action.pending} onClick={() => decide(row.override, "approved")}>
              {t("bdev.approve")}
            </Button>
            <Button size="sm" variant="danger" icon={<X size={12} />} disabled={action.pending} onClick={() => decide(row.override, "rejected")}>
              {t("bdev.reject")}
            </Button>
          </span>
        ) : row.override.decidedAt ? (
          <span className="text-fg-subtle text-xs">{formatDate(row.override.decidedAt, fmt)}</span>
        ) : null,
    },
  ];

  const deviatingBranches = (pick: (row: (typeof deviations)[number]) => boolean) =>
    formatNumber(deviations.filter(pick).length, fmt);

  return (
    <>
      <TileGrid columns={3}>
        <MetricTile label={t("bdev.tileMenu")} value={deviatingBranches((row) => Boolean(row.menu))} />
        <MetricTile label={t("bdev.tilePrice")} value={deviatingBranches((row) => row.prices.some((p) => p.beyondTolerance))} hint={t("bdev.tilePriceHint")} />
        <MetricTile label={t("bdev.tileRecipe")} value={deviatingBranches((row) => row.recipes.length > 0)} />
      </TileGrid>

      {noStandard.length > 0 ? (
        <Callout tone="warn">
          {t("bdev.noStandardFor").replace("{branches}", noStandard.map((row) => tx(row.branch.name)).join(", "))}
        </Callout>
      ) : null}
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Section
        title={t("bdev.menuTitle")}
        spec="FR-BRN-006"
        action={
          <ExportButton
            filename="menu-deviations"
            title={t("bdev.menuTitle")}
            rows={menuRows}
            columns={[
              { key: "branch", header: t("common.branch"), value: (row) => branchName(row.branchId) },
              { key: "menu", header: t("bdev.menu"), value: (row) => row.menuName },
              { key: "kind", header: t("bdev.deviation"), value: (row) => (row.kind === "missing" ? t("bdev.menuMissing") : t("bdev.menuExtra")) },
            ]}
          />
        }
      >
        <DataTable columns={menuColumns} rows={menuRows} rowKey={(row) => `${row.branchId}:${row.kind}:${row.menuName}`} caption={t("bdev.menuTitle")} emptyTitle={t("bdev.noMenuDeviation")} dense />
      </Section>

      <Section
        title={t("bdev.priceTitle")}
        spec="FR-BRN-006"
        action={
          <ExportButton
            filename="price-deviations"
            title={t("bdev.priceTitle")}
            rows={priceRows}
            columns={[
              { key: "branch", header: t("common.branch"), value: (row) => branchName(row.branchId) },
              { key: "item", header: t("bdev.item"), value: (row) => tx(row.itemName) },
              { key: "currency", header: t("org.currency"), value: (row) => row.standard.currency },
              { key: "standard", header: t("bdev.standardPrice"), value: (row) => toMajorUnits(row.standard) },
              { key: "branch_price", header: t("bdev.branchPrice"), value: (row) => toMajorUnits(row.branch) },
              { key: "percent", header: t("bdev.difference"), value: (row) => Number(row.percent.toFixed(2)) },
              { key: "beyond", header: t("bdev.status"), value: (row) => (row.beyondTolerance ? t("bdev.beyondTolerance") : t("bdev.withinTolerance")) },
            ]}
          />
        }
      >
        <DataTable columns={priceColumns} rows={priceRows} rowKey={(row) => `${row.priceListId}:${row.variantId}`} caption={t("bdev.priceTitle")} emptyTitle={t("bdev.noPriceDeviation")} dense />
      </Section>

      <Section
        title={t("bdev.recipeTitle")}
        spec="FR-BRN-007"
        hint={t("bdev.recipeHint")}
        action={
          <ExportButton
            filename="recipe-deviations"
            title={t("bdev.recipeTitle")}
            rows={recipeRows}
            columns={[
              { key: "branch", header: t("common.branch"), value: (row) => branchName(row.override.branchId) },
              { key: "recipe", header: t("bdev.recipe"), value: (row) => tx(row.override.recipeName) },
              { key: "changed", header: t("bdev.changedLines"), value: (row) => row.changedLines },
              { key: "status", header: t("bdev.status"), value: (row) => row.override.status },
              { key: "stale", header: t("bdev.stale"), value: (row) => (row.stale ? "yes" : "no") },
              { key: "reason", header: t("bdev.reason"), value: (row) => row.override.reason },
            ]}
          />
        }
      >
        <DataTable columns={recipeColumns} rows={recipeRows} rowKey={(row) => row.override.id} caption={t("bdev.recipeTitle")} emptyTitle={t("bdev.noRecipeDeviation")} dense />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// FR-BRN-006 — a branch price override, through the real price-list endpoints
// ---------------------------------------------------------------------------

function BranchPriceModal({ data, onClose, onDone }: { data: DeviationInputs; onClose: () => void; onDone: () => void }) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const isFranchisor = usePermission("org.manage");
  const action = useAction();
  const [branchId, setBranchId] = useState(availableBranches[0]?.id ?? "");
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [price, setPrice] = useState<number | null>(null);

  const items = useAsync(() => services.catalogue.items.list({ limit: 500 }).then((page) => page.rows), []);
  const branch = availableBranches.find((row) => row.id === branchId) ?? null;
  const item: MenuItem | null = items.data?.find((row) => row.id === itemId) ?? null;
  const variant = item?.variants.find((row) => row.id === variantId) ?? null;
  const standard = branch ? data.standards.find((row) => row.brandId === branch.brandId) ?? null : null;
  const standardEntry = standard?.priceListId
    ? data.priceLists.find((list) => list.id === standard.priceListId)?.entries.find((entry) => entry.variantId === variantId) ?? null
    : null;
  const lock = franchiseLockFor(data.agreements, branchId || null, "pricing", isFranchisor, todayIso());
  const currency = branch?.currency ?? "EGP";

  async function submit() {
    if (!branch || !variant || price === null || lock.locked) return;
    await action.run(
      async () => {
        let list = data.priceLists.find((row) => row.scope === "branch" && row.scopeId === branch.id && row.active);
        if (!list) {
          list = await services.catalogue.priceLists.create({
            name: { en: `${branch.name.en} — branch prices`, ar: `${branch.name.ar} — أسعار الفرع` },
            scope: "branch",
            scopeId: branch.id,
            priority: 100,
          });
        }
        return services.catalogue.setPrice(list.id, variant.id, { amount: price, currency });
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("bdev.setBranchPrice")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={!variant || price === null || lock.locked} onClick={submit}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("bdev.priceNote")}</Callout>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field label={t("common.branch")}>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            {availableBranches.map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>
        <FranchiseLockNotice lock={lock} domain="pricing" />
        <Field label={t("bdev.item")}>
          <Select
            value={itemId}
            onChange={(event) => {
              setItemId(event.target.value);
              setVariantId(items.data?.find((row) => row.id === event.target.value)?.variants[0]?.id ?? "");
            }}
          >
            <option value="">—</option>
            {(items.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {tx(row.name)}
              </option>
            ))}
          </Select>
        </Field>
        {item && item.variants.length > 1 ? (
          <Field label={t("bdev.variant")}>
            <Select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
              {item.variants.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {variant ? (
          <p className="text-fg-muted text-xs">
            {t("bdev.standardPrice")}:{" "}
            <span className="font-mono">
              {standardEntry ? formatMoney(standardEntry.price, fmt) : `${formatMoney(variant.basePrice, fmt)} (${t("bdev.basePrice")})`}
            </span>
          </p>
        ) : null}
        <Field label={t("bdev.branchPrice")}>
          <MoneyInput value={price} onChange={setPrice} currency={currency} min={0} disabled={lock.locked} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FR-BRN-007 — a branch recipe override
// ---------------------------------------------------------------------------

function RecipeOverrideModal({ data, onClose, onDone }: { data: DeviationInputs; onClose: () => void; onDone: () => void }) {
  const { t, tx } = useI18n();
  const { availableBranches, session } = useSession();
  const isFranchisor = usePermission("org.manage");
  const action = useAction();
  const [branchId, setBranchId] = useState(availableBranches[0]?.id ?? "");
  const [recipeId, setRecipeId] = useState("");
  const [quantities, setQuantities] = useState<Record<Id, string>>({});
  const [reason, setReason] = useState("");

  const recipes = data.recipes.filter((row) => row.status === "published");
  const recipe: Recipe | null = recipes.find((row) => row.id === recipeId) ?? null;
  const lock = franchiseLockFor(data.agreements, branchId || null, "recipes", isFranchisor, todayIso());

  const lines: RecipeOverrideLine[] = (recipe?.lines ?? []).map((line) => ({
    lineId: line.id,
    componentName: line.componentName,
    unit: line.quantity.unit,
    standardQuantity: line.quantity.value,
    branchQuantity: (quantities[line.id] ?? line.quantity.value).trim(),
  }));
  const invalid = lines.some((line) => !/^\d+(\.\d+)?$/.test(line.branchQuantity));
  const changed = lines.some((line) => Number(line.branchQuantity) !== Number(line.standardQuantity));

  async function submit() {
    if (!recipe || lock.locked) return;
    await action.run(
      () =>
        services.branchNetwork.recipeOverrides.create({
          branchId,
          recipeId: recipe.id,
          recipeName: recipe.name,
          recipeVersion: recipe.version,
          lines,
          reason,
          requestedBy: session?.user.email ?? null,
        }),
      { onSuccess: onDone },
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("bdev.newRecipeOverride")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={action.pending} disabled={!recipe || invalid || !changed || !reason.trim() || lock.locked} onClick={submit}>
            {t("bdev.submitOverride")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="muted">{t("bdev.overrideNote")}</Callout>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("common.branch")}>
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {availableBranches.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("bdev.recipe")}>
            <Select
              value={recipeId}
              onChange={(event) => {
                setRecipeId(event.target.value);
                setQuantities({});
              }}
            >
              <option value="">—</option>
              {recipes.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.name)} · v{row.version}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <FranchiseLockNotice lock={lock} domain="recipes" />
        {recipe ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-fg-muted text-xs">
                <th className="py-1 text-start font-medium">{t("bdev.component")}</th>
                <th className="py-1 text-end font-medium">{t("bdev.standardQty")}</th>
                <th className="py-1 text-end font-medium">{t("bdev.branchQty")}</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {lines.map((line) => (
                <tr key={line.lineId}>
                  <td className="py-1.5">{tx(line.componentName)}</td>
                  <td className="py-1.5 text-end font-mono" dir="ltr">
                    {line.standardQuantity} {line.unit}
                  </td>
                  <td className="w-36 py-1.5">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={tx(line.componentName)}
                      value={line.branchQuantity}
                      disabled={lock.locked}
                      onChange={(event) => setQuantities((prev) => ({ ...prev, [line.lineId]: event.target.value }))}
                      className="text-end font-mono"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {invalid ? <p className="text-bad text-xs">{t("bdev.qtyInvalid")}</p> : null}
        <Field label={t("bdev.reason")} required>
          <Textarea rows={2} value={reason} disabled={lock.locked} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
