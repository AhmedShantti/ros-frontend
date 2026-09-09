"use client";

/**
 * The export control — FR-RPT-043, FR-RPT-044.
 *
 * One button, three formats, and two behaviours the SRS is explicit about:
 *
 *   - Every export is logged with the requesting user, the filters applied
 *     and the row count (FR-RPT-044). An export is tenant data leaving the
 *     system; the receipt for that is not optional, so this reports what it
 *     produced rather than silently dropping a file in Downloads.
 *   - Beyond 50,000 rows an export is processed asynchronously and delivered
 *     by notification (FR-RPT-043). Generating that in the tab would freeze
 *     it, so past the threshold this queues a job instead of downloading.
 *
 * `permission` gates the whole control: a role without `report.export` sees
 * it disabled with the permission named, not hidden — knowing that export
 * exists is not itself sensitive, and hiding it produces support tickets.
 */

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Table } from "lucide-react";

import {
  ASYNC_EXPORT_THRESHOLD,
  exportRows,
  type ExportColumn,
  type ExportFormat,
} from "@/lib/console/export";
import { useI18n, useSession } from "@/lib/console/providers";
import { useExportLog } from "@/lib/console/export-log";
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/console/ui";

export interface ExportButtonProps<T> {
  filename: string;
  title: string;
  /** The filters in force, for the audit entry and the PDF subtitle. */
  filterSummary?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Defaults to `report.export`. */
  permission?: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost" | "primary";
  /** Called after a successful export, for a toast. */
  onExported?: (message: string) => void;
}

const FORMATS: { id: ExportFormat; icon: typeof Table }[] = [
  { id: "csv", icon: Table },
  { id: "xlsx", icon: FileSpreadsheet },
  { id: "pdf", icon: FileText },
];

export function ExportButton<T>({
  filename,
  title,
  filterSummary,
  columns,
  rows,
  permission = "report.export",
  size = "sm",
  variant = "ghost",
  onExported,
}: ExportButtonProps<T>) {
  const { t } = useI18n();
  const { canAny, session } = useSession();
  const log = useExportLog();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const allowed = canAny([permission as never]);
  const oversized = rows.length > ASYNC_EXPORT_THRESHOLD;

  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      if (oversized) {
        // Past the threshold this becomes a job. The frontend owns the
        // queueing and the notification; what fills it in is a later
        // concern, and pretending otherwise would hand the user a file
        // that took the tab down with it.
        log.queue({
          title,
          format,
          rowCount: rows.length,
          filters: filterSummary ?? null,
          requestedBy: session ? session.user.email : null,
        });
        onExported?.(t("export.queued").replace("{n}", String(rows.length)));
        return;
      }

      // Yield a frame so the button's busy state paints before a large
      // synchronous render blocks the thread.
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      const outcome = exportRows(format, {
        filename,
        title,
        subtitle: filterSummary,
        columns,
        rows,
      });

      log.record({
        title,
        format,
        rowCount: outcome.rowCount,
        filters: filterSummary ?? null,
        requestedBy: session ? session.user.email : null,
      });

      onExported?.(
        outcome.degraded
          ? t("export.doneDegraded").replace("{n}", String(outcome.rowCount))
          : t("export.done")
              .replace("{n}", String(outcome.rowCount))
              .replace("{format}", format.toUpperCase()),
      );
    } finally {
      setBusy(null);
    }
  }

  const trigger = (
    <Button
      size={size}
      variant={variant}
      icon={<Download size={size === "sm" ? 12 : 14} />}
      disabled={!allowed || rows.length === 0}
      loading={busy !== null}
      title={!allowed ? t("export.denied").replace("{permission}", permission) : undefined}
    >
      {t("common.export")}
    </Button>
  );

  if (!allowed) return trigger;

  return (
    <Menu trigger={({ toggle }) => <span onClick={toggle}>{trigger}</span>} align="end">
      <MenuLabel>
        {t("export.rowCount").replace("{n}", String(rows.length))}
      </MenuLabel>
      {FORMATS.map(({ id, icon: Icon }) => (
        <MenuItem key={id} icon={<Icon size={13} />} onSelect={() => void run(id)}>
          {t(`export.${id}` as never)}
        </MenuItem>
      ))}
      {oversized ? (
        <>
          <MenuSeparator />
          <MenuLabel>{t("export.asyncNote")}</MenuLabel>
        </>
      ) : null}
    </Menu>
  );
}
