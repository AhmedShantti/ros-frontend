/**
 * Client-side export — FR-RPT-043.
 *
 * The SRS asks for CSV, XLSX and PDF. Two of those are usually punted to the
 * server, which means the button does nothing until the server grows a
 * renderer. Everything here produces a genuine file in the browser instead,
 * with no CDN dependency and no library:
 *
 *   - CSV  — RFC 4180 quoting, plus a UTF-8 BOM so Excel stops mangling
 *            Arabic the moment the file is double-clicked.
 *   - XLSX — a real OOXML package. That needs a ZIP, and a ZIP needs CRC-32,
 *            so both are implemented below with the "stored" (uncompressed)
 *            method. A report is a few hundred kilobytes of text; paying for
 *            DEFLATE to save half of it is not worth the code.
 *   - PDF  — a hand-built PDF 1.4 document. Deliberately plain: a title, a
 *            header row, and paginated body rows in Helvetica.
 *
 * ## The Arabic caveat, stated rather than hidden
 *
 * PDF's built-in Helvetica has no Arabic glyphs, and embedding a font that
 * does (plus shaping and bidi) is a different order of problem. So the PDF
 * writer transliterates nothing and drops nothing — it writes the bytes it
 * can encode and replaces the rest with a marker, and `exportRows` warns the
 * caller when that happened. Arabic reports export cleanly as CSV and XLSX,
 * and the UI says so rather than handing over a page of hollow boxes.
 */

export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ExportColumn<T> {
  key: string;
  header: string;
  /** The exported value. Return a string; formatting belongs to the caller. */
  value: (row: T) => string | number | null | undefined;
}

export interface ExportRequest<T> {
  filename: string;
  title?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Printed under the title — the filters that produced this data. */
  subtitle?: string;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function cell<T>(column: ExportColumn<T>, row: T): string {
  const raw = column.value(row);
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

function matrix<T>(request: ExportRequest<T>): string[][] {
  return [
    request.columns.map((column) => column.header),
    ...request.rows.map((row) => request.columns.map((column) => cell(column, row))),
  ];
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180: quote when the value contains a delimiter, a quote or a newline. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv<T>(request: ExportRequest<T>): Blob {
  const body = matrix(request)
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
  // The BOM is what makes Excel read this as UTF-8 rather than as the
  // system codepage, which is the difference between "شاورما" and "Ø´Ø§".
  return new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
}

// ---------------------------------------------------------------------------
// ZIP (stored) — the container XLSX needs
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

function zip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const sum = crc32(entry.bytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20); // version needed
    u16(localView, 6, 0); // flags
    u16(localView, 8, 0); // method: stored
    u16(localView, 10, 0); // time
    u16(localView, 12, 0); // date
    u32(localView, 14, sum);
    u32(localView, 18, entry.bytes.length);
    u32(localView, 22, entry.bytes.length);
    u16(localView, 26, nameBytes.length);
    u16(localView, 28, 0); // extra
    local.set(nameBytes, 30);

    chunks.push(local, entry.bytes);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dirView = new DataView(dir.buffer);
    u32(dirView, 0, 0x02014b50);
    u16(dirView, 4, 20); // version made by
    u16(dirView, 6, 20); // version needed
    u16(dirView, 8, 0);
    u16(dirView, 10, 0);
    u16(dirView, 12, 0);
    u16(dirView, 14, 0);
    u32(dirView, 16, sum);
    u32(dirView, 20, entry.bytes.length);
    u32(dirView, 24, entry.bytes.length);
    u16(dirView, 28, nameBytes.length);
    u16(dirView, 30, 0);
    u16(dirView, 32, 0);
    u16(dirView, 34, 0);
    u16(dirView, 36, 0);
    u32(dirView, 38, 0);
    u32(dirView, 42, offset);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + entry.bytes.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 8, entries.length);
  u16(endView, 10, entries.length);
  u32(endView, 12, centralSize);
  u32(endView, 16, offset);

  // Copied into a plain ArrayBuffer: a `Uint8Array` over a `SharedArrayBuffer`
  // is not a valid `BlobPart`, and `TextEncoder` does not promise which it
  // hands back.
  const parts: BlobPart[] = [...chunks, ...central, end].map((chunk) => {
    const copy = new Uint8Array(new ArrayBuffer(chunk.length));
    copy.set(chunk);
    return copy;
  });

  return new Blob(parts, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters outright; a stray one makes
    // Excel declare the whole workbook corrupt rather than skip the cell.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/** Spreadsheet column name: 1 → A, 27 → AA. */
function columnName(index: number): string {
  let name = "";
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - remainder) / 26);
  }
  return name;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function toXlsx<T>(request: ExportRequest<T>): Blob {
  const encoder = new TextEncoder();
  const grid = matrix(request);

  const rowsXml = grid
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          // Header row is always text; a numeric-looking value below it is a
          // number, so Excel sums it instead of left-aligning it.
          if (rowIndex > 0 && NUMERIC.test(value.trim()) && value.trim() !== "") {
            return `<c r="${ref}"><v>${value.trim()}</v></c>`;
          }
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml}</sheetData></worksheet>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape((request.title ?? "Report").slice(0, 28))}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
    `<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs>` +
    `</styleSheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", bytes: encoder.encode(contentTypes) },
    { name: "_rels/.rels", bytes: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", bytes: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", bytes: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", bytes: encoder.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", bytes: encoder.encode(sheet) },
  ]);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * WinAnsi is what the built-in Helvetica can render. Anything outside it —
 * Arabic, above all — cannot be drawn without embedding a font, so it is
 * replaced rather than silently dropped, and the caller is told.
 */
function pdfText(value: string): { text: string; lost: boolean } {
  let lost = false;
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 32) {
      out += " ";
    } else if (code < 127) {
      out += char;
    } else {
      lost = true;
      out += "?";
    }
  }
  return { text: out.replace(/([\\()])/g, "\\$1"), lost };
}

const PAGE_WIDTH = 842; // A4 landscape, points
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const ROW_HEIGHT = 16;

export function toPdf<T>(request: ExportRequest<T>): { blob: Blob; lostGlyphs: boolean } {
  const grid = matrix(request);
  const header = grid[0]!;
  const body = grid.slice(1);
  let lostGlyphs = false;

  const usable = PAGE_WIDTH - MARGIN * 2;
  const columnWidth = usable / Math.max(1, header.length);
  const perPage = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 60) / ROW_HEIGHT);
  const pageCount = Math.max(1, Math.ceil(body.length / perPage));

  /** One column's worth of text, hard-clipped so columns never collide. */
  function clip(value: string): string {
    const converted = pdfText(value);
    if (converted.lost) lostGlyphs = true;
    const maxChars = Math.max(4, Math.floor(columnWidth / 5.2));
    return converted.text.length > maxChars
      ? converted.text.slice(0, maxChars - 1) + "-"
      : converted.text;
  }

  const contents: string[] = [];
  for (let page = 0; page < pageCount; page += 1) {
    const rows = body.slice(page * perPage, (page + 1) * perPage);
    const parts: string[] = [];
    let y = PAGE_HEIGHT - MARGIN;

    if (request.title) {
      parts.push(`BT /F2 14 Tf ${MARGIN} ${y} Td (${clip(request.title)}) Tj ET`);
      y -= 18;
    }
    if (request.subtitle) {
      parts.push(`BT /F1 8 Tf ${MARGIN} ${y} Td (${clip(request.subtitle)}) Tj ET`);
      y -= 14;
    }
    parts.push(
      `BT /F1 7 Tf ${MARGIN} ${y} Td (Page ${page + 1} of ${pageCount}  -  ${body.length} rows) Tj ET`,
    );
    y -= 16;

    // Header row, on a rule so the table reads as a table.
    parts.push(`0.85 0.85 0.85 rg ${MARGIN} ${y - 4} ${usable} ${ROW_HEIGHT} re f 0 0 0 rg`);
    header.forEach((label, index) => {
      parts.push(
        `BT /F2 8 Tf ${MARGIN + 3 + index * columnWidth} ${y} Td (${clip(label)}) Tj ET`,
      );
    });
    y -= ROW_HEIGHT;

    rows.forEach((row, rowIndex) => {
      if (rowIndex % 2 === 1) {
        parts.push(
          `0.96 0.96 0.96 rg ${MARGIN} ${y - 4} ${usable} ${ROW_HEIGHT} re f 0 0 0 rg`,
        );
      }
      row.forEach((value, index) => {
        parts.push(
          `BT /F1 8 Tf ${MARGIN + 3 + index * columnWidth} ${y} Td (${clip(value)}) Tj ET`,
        );
      });
      y -= ROW_HEIGHT;
    });

    contents.push(parts.join("\n"));
  }

  // -- Assemble the document -------------------------------------------------
  const encoder = new TextEncoder();
  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  // 1 catalog, 2 pages, 3 F1, 4 F2, then per page: content + page object.
  const firstPageObject = 5;
  contents.forEach((_, index) => {
    pageObjectIds.push(firstPageObject + index * 2 + 1);
  });

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  contents.forEach((stream, index) => {
    const contentId = firstPageObject + index * 2;
    const pageId = contentId + 1;
    objects[contentId] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = encoder.encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefAt = encoder.encode(pdf).length;
  const count = objects.length;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;

  return {
    blob: new Blob([pdf], { type: "application/pdf" }),
    lostGlyphs,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ExportOutcome {
  filename: string;
  rowCount: number;
  /** True when the PDF could not render some characters — Arabic, mainly. */
  degraded: boolean;
}

/**
 * Render and hand over the file.
 *
 * Returns what happened so the caller can report it — FR-RPT-044 wants the
 * row count recorded with every export, and a UI that says "exported 1,284
 * rows" is also the UI that makes a truncated export obvious.
 */
export function exportRows<T>(format: ExportFormat, request: ExportRequest<T>): ExportOutcome {
  const base = `${request.filename}-${stamp()}`;

  if (format === "csv") {
    download(toCsv(request), `${base}.csv`);
    return { filename: `${base}.csv`, rowCount: request.rows.length, degraded: false };
  }

  if (format === "xlsx") {
    download(toXlsx(request), `${base}.xlsx`);
    return { filename: `${base}.xlsx`, rowCount: request.rows.length, degraded: false };
  }

  const { blob, lostGlyphs } = toPdf(request);
  download(blob, `${base}.pdf`);
  return { filename: `${base}.pdf`, rowCount: request.rows.length, degraded: lostGlyphs };
}

/** FR-RPT-043 — beyond this, an export is a background job, not a download. */
export const ASYNC_EXPORT_THRESHOLD = 50_000;
