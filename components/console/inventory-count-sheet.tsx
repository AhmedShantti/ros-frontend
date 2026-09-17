"use client";

/**
 * Count sheets in walking order — SRS FR-INV-049.
 *
 * "A count sheet ordered by physical storage location to minimise walking,
 * configurable by the tenant." The order comes from the location's storage
 * layout (`services.inventoryControls.storage`): areas in walk order, then
 * shelf, then position. Items with no slot are printed last under
 * "Unassigned", which is itself the prompt to finish the layout.
 *
 * A blind count's sheet has no expected column (FR-INV-041/042) — a sheet
 * that prints what the system expects turns the count into a copying exercise.
 */

import { useState } from "react";
import { Printer } from "lucide-react";

import type { Id, Localised } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { orderForSheet } from "@/lib/console/services/inventory-controls";
import { useI18n } from "@/lib/console/providers";
import { Button } from "@/components/console/ui";

export interface SheetLine {
  itemId: Id;
  itemName: Localised;
  sku: string;
  unit: string;
  expected: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function CountSheetButton({
  title,
  reference,
  locationId,
  locationName,
  lines,
  blind,
  size = "sm",
}: {
  title: string;
  reference: string;
  locationId: Id;
  locationName: string;
  lines: SheetLine[];
  blind: boolean;
  size?: "sm" | "md";
}) {
  const { t, tx, locale, dir } = useI18n();
  const [blocked, setBlocked] = useState(false);

  async function print() {
    const popup = window.open("", "_blank", "width=800,height=900");
    if (!popup) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    const layout = await services.inventoryControls.storage.get(locationId).catch(() => null);
    const ordered = orderForSheet(layout, lines, locale);
    let lastArea: string | null = "__start__";
    const body = ordered
      .map(({ line, area, slot }) => {
        const areaKey = area?.id ?? null;
        const header =
          areaKey !== lastArea
            ? `<tr class="area"><td colspan="${blind ? 4 : 5}">${escapeHtml(area ? `${area.code} · ${tx(area.name)}` : t("invx.sheet.unassigned"))}</td></tr>`
            : "";
        lastArea = areaKey;
        return `${header}<tr><td class="shelf">${escapeHtml(slot?.shelf ?? "")}</td><td>${escapeHtml(tx(line.itemName))}<div class="sku">${escapeHtml(line.sku)}</div></td><td class="unit">${escapeHtml(line.unit)}</td>${blind ? "" : `<td class="num">${escapeHtml(line.expected ?? "")}</td>`}<td class="box"></td></tr>`;
      })
      .join("");
    popup.document.write(`<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#000;margin:24px}
h1{font-size:18px;margin:0}p{margin:2px 0 12px;font-size:12px;color:#333}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #aaa;padding:6px;text-align:start;vertical-align:top}
th{font-size:11px;text-transform:uppercase;color:#444}.area td{background:#eee;font-weight:700;border-top:2px solid #000}
.sku{font:11px ui-monospace,monospace;color:#555;direction:ltr}.num{text-align:end;direction:ltr}.box{width:110px;border-bottom:1px solid #000}
.shelf{width:70px;font:12px ui-monospace,monospace}.unit{width:50px}
footer{margin-top:24px;display:flex;gap:24px;font-size:12px}footer div{flex:1;border-top:1px solid #000;padding-top:4px}
</style></head><body>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(reference)} · ${escapeHtml(locationName)} · ${escapeHtml(blind ? t("invx.sheet.blind") : t("invx.sheet.open"))}</p>
<table><thead><tr><th>${escapeHtml(t("invx.sheet.shelf"))}</th><th>${escapeHtml(t("inv.item"))}</th><th>${escapeHtml(t("common.unit"))}</th>${blind ? "" : `<th class="num">${escapeHtml(t("inv.expected"))}</th>`}<th>${escapeHtml(t("inv.counted"))}</th></tr></thead><tbody>${body}</tbody></table>
<footer><div>${escapeHtml(t("invx.sheet.countedBy"))}</div><div>${escapeHtml(t("invx.sheet.checkedBy"))}</div></footer>
<script>window.onload=function(){window.print()}</script></body></html>`);
    popup.document.close();
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size={size} variant="secondary" icon={<Printer size={12} />} onClick={() => void print()} disabled={lines.length === 0}>
        {t("invx.sheet.print")}
      </Button>
      {blocked ? <span className="text-bad text-xs">{t("invx.note.popupBlocked")}</span> : null}
    </span>
  );
}
