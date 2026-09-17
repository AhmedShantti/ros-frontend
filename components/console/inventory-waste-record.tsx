"use client";

/**
 * One waste record, in full — SRS FR-INV-056.
 *
 * "Every waste record SHALL capture: item, quantity, unit, reason code,
 * location, employee, timestamp, and computed value. Photographs SHALL be
 * optionally attachable." All of those are shown, each saying plainly when
 * the source did not carry it (the live waste list returns headers only).
 * The photograph is read from this device (`services.inventoryControls
 * .photos`), where the entry drawer kept it, and one can be attached after
 * the fact.
 */

import { useState } from "react";
import { Camera, Trash2 } from "lucide-react";

import type { WasteRecord } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { MAX_PHOTO_BYTES } from "@/lib/console/services/inventory-controls";
import { useAsync, useStations } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, unitLabel } from "@/lib/console/format";
import { APPROVAL_STATE, WASTE_CATEGORY, labelOf } from "@/lib/console/labels";
import { useConfirm } from "@/components/console/confirm";
import { downscalePhoto } from "@/components/console/inventory-entry";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Input } from "@/components/console/ui";

export function WasteRecordDrawer({ record, onClose }: { record: WasteRecord | null; onClose: () => void }) {
  if (!record) return null;
  return <RecordDrawer key={record.id} record={record} onClose={onClose} />;
}

function RecordDrawer({ record, onClose }: { record: WasteRecord; onClose: () => void }) {
  const { t, tx, fmt, locale } = useI18n();
  const { scope, session } = useSession();
  const stations = useStations(scope);
  const confirm = useConfirm();
  const action = useAction();
  const photo = useAsync(() => services.inventoryControls.photos.get(record.id), [record.id]);
  const missing = <span className="text-fg-subtle">{t("invx.wa.notRecorded")}</span>;
  const category = labelOf(WASTE_CATEGORY, record.category);
  const approval = labelOf(APPROVAL_STATE, record.approval);

  async function attach(file: File) {
    await action.run(async () => {
      const data = await downscalePhoto(file).catch(() => null);
      if (!data || data.length > MAX_PHOTO_BYTES) throw new Error(t("invx.entry.photoTooLarge"));
      await services.inventoryControls.photos.save({
        recordId: record.id,
        dataUrl: data,
        fileName: file.name,
        capturedAt: new Date().toISOString(),
        capturedBy: session?.user.email ?? null,
      });
      photo.reload();
    });
  }

  async function removePhoto() {
    const ok = await confirm({ title: t("invx.entry.removePhotoTitle"), body: t("invx.entry.removePhotoBody"), confirmLabel: t("common.delete"), tone: "danger" });
    if (!ok) return;
    await action.run(() => services.inventoryControls.photos.remove(record.id), { onSuccess: photo.reload });
  }

  return (
    <Drawer open onClose={onClose} title={tx(record.itemName) || t("inv.wasteTitle")} subtitle="FR-INV-056">
      <div className="space-y-5">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <DescList>
          <DescRow label={t("inv.item")}>{tx(record.itemName) || missing}</DescRow>
          <DescRow label={t("common.quantity")} mono>
            {record.itemId ? (
              <span dir="ltr">
                {record.quantity.value} {unitLabel(record.quantity.unit, locale)}
              </span>
            ) : (
              missing
            )}
          </DescRow>
          <DescRow label={t("inv.reason")}>
            <span className="flex items-center gap-2">
              {tx(record.reasonName) || record.reasonCode}
              <Badge tone={category.tone}>{tx(category.label)}</Badge>
              {!record.isTrueWaste ? <Badge tone="muted">{t("inv.controlledConsumption")}</Badge> : null}
            </span>
          </DescRow>
          <DescRow label={t("common.location")}>{tx(record.locationName) || missing}</DescRow>
          <DescRow label={t("invx.wa.dim.station")}>
            {record.stationId ? tx(stations.find((row) => row.id === record.stationId)?.name) || record.stationId : missing}
          </DescRow>
          <DescRow label={t("inv.performedBy")}>{tx(record.recordedByName) || missing}</DescRow>
          <DescRow label={t("common.time")}>{formatDateTime(record.recordedAt, fmt)}</DescRow>
          <DescRow label={t("entry.value")} mono>
            {formatMoney(record.value, fmt)}
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={approval.tone} dot>
              {tx(approval.label)}
            </Badge>
          </DescRow>
          {record.notes ? <DescRow label={t("common.notes")}>{record.notes}</DescRow> : null}
        </DescList>

        <section className="space-y-2">
          <h3 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
            <Camera size={14} aria-hidden /> {t("entry.photo")}
          </h3>
          {photo.data ? (
            <figure className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.data.dataUrl} alt={t("invx.entry.photoAlt").replace("{item}", tx(record.itemName))} className="border-line max-h-80 rounded-lg border object-contain" />
              <figcaption className="text-fg-subtle flex items-center justify-between gap-2 text-xs">
                <span>
                  {photo.data.fileName} · {formatDateTime(photo.data.capturedAt, fmt)} · {photo.data.capturedBy ?? "—"}
                </span>
                <Button size="sm" variant="ghost" icon={<Trash2 size={11} />} onClick={() => void removePhoto()}>
                  {t("common.delete")}
                </Button>
              </figcaption>
            </figure>
          ) : (
            <>
              <p className="text-fg-subtle text-xs">{t("invx.entry.noPhoto")}</p>
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label={t("entry.photo")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file);
                }}
              />
            </>
          )}
          <p className="text-fg-subtle text-xs">{t("invx.entry.photoLocal")}</p>
        </section>
      </div>
    </Drawer>
  );
}
