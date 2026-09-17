"use client";

/**
 * Full tenant data export — FR-PLT-022.
 *
 * "CSV per entity plus a JSON manifest", built in the browser from the same
 * service registry every screen reads, so what is exported is exactly what
 * the tenant can see — no more (it cannot reach another tenant's rows, the
 * services are scoped) and no less (every entity with a source is walked to
 * the end, not just its first page).
 *
 * An entity whose source the backend does not implement is not skipped in
 * silence: it is listed in the manifest with the reason, and the job is
 * marked partial. A manifest that omits what it could not fetch would read
 * as "you have no suppliers".
 *
 * Every file is SHA-256'd into the manifest so the archive can be checked
 * after it has been moved around, and each entity carries its data class
 * (FR-SEC-060).
 */

import type { Page } from "./types";
import { services } from "./services";
import type { ScopedQuery } from "./services/types";
import { toCsv, zip, type ZipEntry } from "./export";
import type { DataClass } from "./security-policy";
import type { ExportEntityResult, ExportJobStatus } from "./services/tenant-lifecycle";

interface EntitySource {
  entity: string;
  classification: DataClass;
  load: () => Promise<unknown[]>;
}

const PAGE = 500;
const MAX_ROWS = 200_000;

/** Walk a collection to the end, by offset. */
async function drain<T>(list: (query: ScopedQuery) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await list({ limit: PAGE, offset });
    out.push(...page.rows);
    if (page.rows.length < PAGE || out.length >= page.total) break;
  }
  return out;
}

function sources(): EntitySource[] {
  const s = services;
  const c = <T>(entity: string, classification: DataClass, list: (query: ScopedQuery) => Promise<Page<T>>): EntitySource => ({
    entity,
    classification,
    load: () => drain(list),
  });
  return [
    c("brands", "internal", (q) => s.organisation.brands.list(q)),
    c("branches", "internal", (q) => s.organisation.branches.list(q)),
    c("warehouses", "internal", (q) => s.organisation.warehouses.list(q)),
    c("central_kitchens", "internal", (q) => s.organisation.centralKitchens.list(q)),
    c("users", "restricted", (q) => s.security.users.list(q)),
    c("roles", "internal", (q) => s.security.roles.list(q)),
    c("menus", "public", (q) => s.catalogue.menus.list(q)),
    c("menu_categories", "public", (q) => s.catalogue.categories.list(q)),
    c("menu_items", "public", (q) => s.catalogue.items.list(q)),
    c("modifier_groups", "public", (q) => s.catalogue.modifierGroups.list(q)),
    c("combos", "public", (q) => s.catalogue.combos.list(q)),
    c("price_lists", "public", (q) => s.catalogue.priceLists.list(q)),
    c("recipes", "confidential", (q) => s.catalogue.recipes.list(q)),
    c("stock_items", "internal", (q) => s.inventory.items.list(q)),
    c("stock_levels", "internal", (q) => s.inventory.levels.list(q)),
    c("stock_movements", "internal", (q) => s.inventory.movements.list(q)),
    c("stock_counts", "internal", (q) => s.inventory.counts.list(q)),
    c("transfers", "internal", (q) => s.inventory.transfers.list(q)),
    c("waste", "internal", (q) => s.inventory.waste.list(q)),
    c("suppliers", "confidential", (q) => s.purchasing.suppliers.list(q)),
    c("purchase_orders", "confidential", (q) => s.purchasing.orders.list(q)),
    c("supplier_invoices", "confidential", (q) => s.purchasing.invoices.list(q)),
    c("employees", "restricted", (q) => s.workforce.employees.list(q)),
    c("attendance", "restricted", (q) => s.workforce.attendance.list(q)),
    c("orders", "internal", (q) => s.sales.orders.list(q)),
    c("cash_sessions", "confidential", (q) => s.finance.cashSessions.list(q)),
    c("expenses", "confidential", (q) => s.finance.expenses.list(q)),
    c("customers", "restricted", (q) => s.crm.customers.list(q)),
    c("promotions", "internal", (q) => s.crm.promotions.list(q)),
    c("approvals", "confidential", (q) => s.governance.approvals.list(q)),
    { entity: "audit_log", classification: "confidential", load: () => s.governance.auditExport({}) },
    { entity: "settings_overrides", classification: "internal", load: () => s.settings.overrides() },
    { entity: "security_events", classification: "confidential", load: () => s.securityEvents.list() },
    c("data_subject_requests", "restricted", (q) => s.dataSubjectRequests.requests.list(q)),
  ];
}

export function exportEntityCount(): number {
  return sources().length;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function csvOf(rows: unknown[]): Blob {
  const records = rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : { value: row }));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return toCsv({
    filename: "entity",
    title: "",
    rows: records,
    columns: keys.map((key) => ({ key, header: key, value: (row: Record<string, unknown>) => cell(row[key]) })),
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface BuiltExport {
  blob: Blob;
  filename: string;
  status: ExportJobStatus;
  entities: ExportEntityResult[];
}

export async function buildTenantExport(
  tenant: { id: string; slug: string },
  jobId: string,
  onProgress?: (done: number, total: number, entity: string) => void,
): Promise<BuiltExport> {
  const list = sources();
  const files: ZipEntry[] = [];
  const results: ExportEntityResult[] = [];

  for (let index = 0; index < list.length; index += 1) {
    const source = list[index]!;
    onProgress?.(index, list.length, source.entity);
    const file = `data/${source.entity}.csv`;
    try {
      const rows = await source.load();
      const bytes = new Uint8Array(await csvOf(rows).arrayBuffer());
      files.push({ name: file, bytes });
      results.push({ entity: source.entity, file, rows: rows.length, sha256: await sha256(bytes), classification: source.classification, error: null });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ERROR";
      const message = error instanceof Error ? error.message : String(error);
      results.push({ entity: source.entity, file, rows: 0, sha256: null, classification: source.classification, error: `${code}: ${message}` });
    }
  }
  onProgress?.(list.length, list.length, "manifest");

  const generatedAt = new Date().toISOString();
  const manifest = {
    format: "ros-tenant-export",
    version: 1,
    requirement: "FR-PLT-022",
    jobId,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    generatedAt,
    generatedIn: "browser",
    encoding: "UTF-8 with BOM, RFC 4180",
    entities: results,
  };
  files.push({ name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });

  const failed = results.filter((row) => row.error).length;
  const status: ExportJobStatus = failed === results.length ? "failed" : failed > 0 ? "partial" : "ready";
  const stamp = generatedAt.slice(0, 19).replace(/[-:T]/g, "");
  return { blob: zip(files), filename: `${tenant.slug}-export-${stamp}.zip`, status, entities: results };
}
