"use client";

/**
 * Storage layout and count-sheet order — SRS FR-INV-049.
 *
 * The tenant describes each location as a walk: storage areas in the order a
 * counter passes them (dry store, walk-in chiller, freezer, bar), and for
 * each item the area, shelf and position it lives at. Count sheets and the
 * count drawer then list lines in that order, so a count is one lap of the
 * building instead of a zig-zag through an alphabetical list.
 *
 * The layout has no field on the server, so it is kept on this device
 * (`services.inventoryControls.storage`).
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import type { Id, StockLevel, StockLocation } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { newStorageArea, orderForSheet, type StorageArea, type StorageLayout, type StorageSlot } from "@/lib/console/services/inventory-controls";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime } from "@/lib/console/format";
import { useConfirm } from "@/components/console/confirm";
import { LocalisedField } from "@/components/console/fields";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { FilterSelect, PageBody, PageHeader, Section, Toolbar } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import { CountSheetButton } from "@/components/console/inventory-count-sheet";
import { Badge, Button, Callout, Input, Select, Toast } from "@/components/console/ui";

export default function StorageLayoutPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <StorageScreen />
    </Gate>
  );
}

function StorageScreen() {
  const { t, tx } = useI18n();
  const { scope } = useSession();
  const [message, setMessage] = useTransientMessage();
  const locations = useAsync(() => services.organisation.locations(), []);
  const [locationId, setLocationId] = useState<Id>(scope.branchId ?? "");

  useEffect(() => {
    if (!locationId && locations.data?.[0]) setLocationId(locations.data[0].id);
  }, [locations.data, locationId]);

  const data = useAsync(async () => {
    if (!locationId) return null;
    const [layout, levels] = await Promise.all([
      services.inventoryControls.storage.get(locationId),
      services.inventory.levels.list({ limit: 5000, filters: { locationId } }).then((page) => page.rows.filter((row) => row.locationId === locationId)),
    ]);
    return { layout, levels };
  }, [locationId]);

  return (
    <>
      <PageHeader
        title={t("invx.sto.title")}
        subtitle={t("invx.sto.subtitle")}
        spec="FR-INV-049"
        crumbs={[{ label: t("inv.countsTitle"), href: "/inventory/counts" }, { label: t("invx.sto.title") }]}
      />
      <PageBody>
        <Callout tone="muted">{t("invx.sto.localNote")}</Callout>
        <Toolbar>
          <FilterSelect
            filter={{
              key: "location",
              label: t("common.location"),
              allLabel: t("invx.cyc.chooseLocation"),
              options: (locations.data ?? []).map((row: StockLocation) => ({ value: row.id, label: tx(row.name) })),
            }}
            value={locationId}
            onChange={(value) => value !== "all" && setLocationId(value)}
          />
        </Toolbar>
        <AsyncPanel state={data}>
          {(loaded) =>
            loaded ? (
              <LayoutEditor
                key={`${locationId}-${loaded.layout.updatedAt}`}
                layout={loaded.layout}
                levels={loaded.levels}
                locationName={tx((locations.data ?? []).find((row) => row.id === locationId)?.name)}
                onSaved={() => {
                  setMessage(t("invx.sto.saved"));
                  data.reload();
                }}
              />
            ) : (
              <></>
            )
          }
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function LayoutEditor({
  layout,
  levels,
  locationName,
  onSaved,
}: {
  layout: StorageLayout;
  levels: StockLevel[];
  locationName: string;
  onSaved: () => void;
}) {
  const { t, tx, fmt, locale } = useI18n();
  const { session } = useSession();
  const canEdit = usePermission("inventory.item.manage");
  const confirm = useConfirm();
  const action = useAction();
  const [areas, setAreas] = useState<StorageArea[]>(() => [...layout.areas].sort((a, b) => a.walkOrder - b.walkOrder));
  const [slots, setSlots] = useState<Record<Id, StorageSlot>>(layout.slots);
  const [filter, setFilter] = useState("all");
  const dirty = JSON.stringify(areas) !== JSON.stringify([...layout.areas].sort((a, b) => a.walkOrder - b.walkOrder)) || JSON.stringify(slots) !== JSON.stringify(layout.slots);

  const renumber = (list: StorageArea[]) => list.map((area, index) => ({ ...area, walkOrder: index + 1 }));

  function move(index: number, delta: number) {
    const next = [...areas];
    const [area] = next.splice(index, 1);
    next.splice(index + delta, 0, area!);
    setAreas(renumber(next));
  }

  async function removeArea(area: StorageArea) {
    const assigned = Object.values(slots).filter((slot) => slot.areaId === area.id).length;
    const ok = await confirm({
      title: t("invx.sto.removeAreaTitle"),
      body: t("invx.sto.removeAreaBody").replace("{name}", tx(area.name) || area.code).replace("{n}", String(assigned)),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setAreas(renumber(areas.filter((row) => row.id !== area.id)));
    setSlots(Object.fromEntries(Object.entries(slots).filter(([, slot]) => slot.areaId !== area.id)));
  }

  const setSlot = (itemId: Id, patch: Partial<StorageSlot>) =>
    setSlots((current) => {
      const existing = current[itemId];
      const next = { areaId: existing?.areaId ?? "", shelf: existing?.shelf ?? "", position: existing?.position ?? 0, ...patch };
      if (!next.areaId) {
        const copy = { ...current };
        delete copy[itemId];
        return copy;
      }
      return { ...current, [itemId]: next };
    });

  const areaProblems = areas.filter((area) => (!area.name.en.trim() && !area.name.ar.trim()) || !area.code.trim()).length;
  const codes = areas.map((area) => area.code.trim().toUpperCase()).filter(Boolean);
  const duplicateCodes = codes.length !== new Set(codes).size;

  const lines = useMemo(() => levels.map((level) => ({ itemId: level.itemId, itemName: level.itemName, sku: level.sku, unit: level.onHand.unit })), [levels]);
  const draftLayout: StorageLayout = { ...layout, areas, slots };
  const ordered = useMemo(() => orderForSheet(draftLayout, lines, locale), [draftLayout, lines, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = filter === "unassigned" ? ordered.filter((row) => !row.area) : filter === "all" ? ordered : ordered.filter((row) => row.area?.id === filter);
  const unassigned = ordered.filter((row) => !row.area).length;

  const columns: Column<(typeof ordered)[number]>[] = [
    { key: "item", header: t("inv.item"), render: (row) => <CellStack primary={tx(row.line.itemName)} secondary={<span className="font-mono">{row.line.sku}</span>} /> },
    {
      key: "area",
      header: t("invx.sto.area"),
      render: (row) => (
        <Select value={slots[row.line.itemId]?.areaId ?? ""} onChange={(e) => setSlot(row.line.itemId, { areaId: e.target.value })} disabled={!canEdit} aria-label={`${t("invx.sto.area")} ${tx(row.line.itemName)}`}>
          <option value="">{t("invx.sheet.unassigned")}</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.code || "—"} · {tx(area.name)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "shelf",
      header: t("invx.sheet.shelf"),
      render: (row) => (
        <Input
          className="w-24 font-mono"
          value={slots[row.line.itemId]?.shelf ?? ""}
          maxLength={20}
          disabled={!canEdit || !slots[row.line.itemId]}
          onChange={(e) => setSlot(row.line.itemId, { shelf: e.target.value })}
          aria-label={`${t("invx.sheet.shelf")} ${tx(row.line.itemName)}`}
        />
      ),
    },
    {
      key: "position",
      header: t("invx.sto.position"),
      numeric: true,
      render: (row) => (
        <Input
          className="w-16 text-end font-mono"
          dir="ltr"
          inputMode="numeric"
          value={slots[row.line.itemId] ? String(slots[row.line.itemId]!.position) : ""}
          disabled={!canEdit || !slots[row.line.itemId]}
          onChange={(e) => setSlot(row.line.itemId, { position: Number(e.target.value.replace(/\D/g, "")) || 0 })}
          aria-label={`${t("invx.sto.position")} ${tx(row.line.itemName)}`}
        />
      ),
    },
  ];

  return (
    <>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Section
        title={t("invx.sto.areasTitle")}
        hint={t("invx.sto.areasHint")}
        action={
          canEdit ? (
            <Button size="sm" icon={<Plus size={12} />} onClick={() => setAreas(renumber([...areas, newStorageArea(areas.length + 1)]))}>
              {t("invx.sto.addArea")}
            </Button>
          ) : null
        }
      >
        {areas.length === 0 ? <p className="text-fg-muted text-sm">{t("invx.sto.noAreas")}</p> : null}
        <ol className="space-y-3">
          {areas.map((area, index) => (
            <li key={area.id} className="border-line flex flex-wrap items-start gap-3 rounded-lg border p-3">
              <Badge tone="accent">{index + 1}</Badge>
              <div className="w-24">
                <Input
                  dir="ltr"
                  className="font-mono uppercase"
                  value={area.code}
                  maxLength={8}
                  placeholder="WIC"
                  disabled={!canEdit}
                  aria-label={t("invx.sto.code")}
                  onChange={(e) => setAreas(areas.map((row) => (row.id === area.id ? { ...row, code: e.target.value } : row)))}
                />
              </div>
              <div className="min-w-64 flex-1">
                <LocalisedField
                  label={t("common.name")}
                  value={area.name}
                  onChange={(name) => setAreas(areas.map((row) => (row.id === area.id ? { ...row, name } : row)))}
                  maxLength={60}
                  required
                />
              </div>
              {canEdit ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<ArrowUp size={12} />} aria-label={t("invx.sto.earlier")} disabled={index === 0} onClick={() => move(index, -1)} />
                  <Button size="sm" variant="ghost" icon={<ArrowDown size={12} />} aria-label={t("invx.sto.later")} disabled={index === areas.length - 1} onClick={() => move(index, 1)} />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} aria-label={t("common.delete")} onClick={() => void removeArea(area)} />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {areaProblems > 0 ? <p className="text-warn mt-2 text-xs">{t("invx.sto.areaIncomplete")}</p> : null}
        {duplicateCodes ? <p className="text-bad mt-2 text-xs">{t("invx.sto.duplicateCode")}</p> : null}
      </Section>

      <Toolbar
        actions={
          <>
            <CountSheetButton
              title={t("invx.sheet.title")}
              reference={t("invx.sto.previewRef")}
              locationId={layout.locationId}
              locationName={locationName}
              blind
              lines={lines.map((line) => ({ ...line, expected: null }))}
            />
            {canEdit ? (
              <Button
                variant="primary"
                loading={action.pending}
                disabled={!dirty || areaProblems > 0 || duplicateCodes}
                onClick={() =>
                  void action.run(() => services.inventoryControls.storage.save({ ...draftLayout, updatedBy: session?.user.email ?? null }), { onSuccess: onSaved })
                }
              >
                {t("common.save")}
              </Button>
            ) : null}
          </>
        }
      >
        <FilterSelect
          filter={{
            key: "area",
            label: t("invx.sto.area"),
            options: [{ value: "unassigned", label: `${t("invx.sheet.unassigned")} (${unassigned})` }, ...areas.map((area) => ({ value: area.id, label: `${area.code} · ${tx(area.name)}` }))],
          }}
          value={filter}
          onChange={setFilter}
        />
        {layout.updatedBy ? (
          <span className="text-fg-subtle text-xs">
            {t("invx.sto.lastSaved").replace("{by}", layout.updatedBy).replace("{at}", formatDateTime(layout.updatedAt, fmt))}
          </span>
        ) : null}
      </Toolbar>

      {dirty ? <Callout tone="warn">{t("invx.sto.unsaved")}</Callout> : null}

      <Section title={t("invx.sto.walkTitle")} hint={t("invx.sto.walkHint")} padded={false}>
        <DataTable columns={columns} rows={visible} rowKey={(row) => row.line.itemId} caption={t("invx.sto.walkTitle")} emptyTitle={t("invx.sto.noItems")} dense />
      </Section>
    </>
  );
}
