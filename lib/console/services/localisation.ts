"use client";

/**
 * Localisation records with no backend resource — SRS ch.22.
 *
 *   - Country pack versions (FR-LOC-021/024/025/030). The platform's pack
 *     list is read-only on the API, and live it is not served at all; the
 *     authoring tool, version history and certification live here. The mock
 *     registry seeds the shipped packs; the live one starts empty rather than
 *     pretending a server's packs are known.
 *   - Language assignment per user, terminal and document type (FR-LOC-008).
 *   - Arabic print profile, printer models and test results (FR-LOC-011/012).
 */

import type { CountryPack, Id } from "../types";
import {
  blankVersion,
  digestOf,
  runConformance,
  validatePack,
  type CountryPackVersion,
} from "../country-pack-authoring";
import {
  DEFAULT_PRINT_PROFILE,
  type DocumentLanguage,
  type PrintProfile,
  type PrintTestRecord,
  type PrinterModel,
  type TerminalLanguage,
  type UserLanguage,
} from "../locale-packs";
import { localCollection, localDocument, nowIso, type LocalCollection } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

const tenantOf = () => getActiveTenantId();

/** A shipped pack as its first recorded version. */
export function versionFromPlatformPack(pack: CountryPack): CountryPackVersion {
  const certified = pack.signed && pack.conformancePassed;
  const at = `${pack.effectiveFrom}T00:00:00.000Z`;
  const row: CountryPackVersion = {
    id: `cpv_${pack.code}_${pack.version}`,
    ...blankVersion({
      code: pack.code,
      name: pack.name,
      version: pack.version,
      effectiveFrom: pack.effectiveFrom,
      currency: pack.currency,
      currencyExponent: pack.currencyExponent,
      taxEngine: pack.taxEngine,
      pricingMode: pack.pricingMode,
      roundingMode: pack.roundingMode,
      computationLevel: pack.computationLevel,
      taxClasses: pack.taxClasses.map((row) => ({ code: row.code, rate: row.rate, label: row.label })),
      fiscalProvider: pack.fiscalProvider,
      fiscalMode: pack.fiscalMode,
      weekStart: pack.weekStart,
      weekend: pack.weekend,
      standardWeeklyHours: pack.standardWeeklyHours,
      overtimeMultiplier: pack.overtimeMultiplier,
      dataRetentionYears: pack.dataRetentionYears,
      hijriCalendar: pack.code === "SA",
      status: certified ? "certified" : "draft",
      changeNote: "Shipped with the platform.",
      certifiedAt: certified ? at : null,
      certifiedBy: certified ? "platform" : null,
      publishedAt: certified ? at : null,
      createdAt: at,
      createdBy: "platform",
      platform: true,
    }),
  };
  return { ...row, conformance: runConformance(row, at) };
}

export function createLocalisationService(seedPacks: () => CountryPackVersion[]) {
  const versionStore = localCollection<CountryPackVersion>(
    {
      name: "country-pack-versions",
      idOf: (row) => row.id,
      seed: seedPacks,
      search: (row) => [row.name, row.code, row.version],
      filters: { code: (row) => row.code, status: (row) => row.status },
      sorters: { effectiveFrom: (row) => row.effectiveFrom, code: (row) => row.code },
      factory: (input, id) => ({ id, ...blankVersion(input), status: "draft", digest: null, conformance: null, certifiedAt: null, certifiedBy: null, publishedAt: null, platform: false }),
    },
    tenantOf,
  );

  const packVersions = {
    ...versionStore,
    async update(id: Id, patch: Partial<CountryPackVersion>) {
      const current = await versionStore.get(id);
      if (!current) throw new ServiceError("NOT_FOUND", "That pack version no longer exists.", 404);
      // FR-LOC-021 — a certified version is history. Change means a new version.
      if (current.status !== "draft") {
        throw new ServiceError("CONFLICT", "A certified version cannot be edited. Start a new version from it instead.", 409);
      }
      // Editing a draft invalidates any earlier conformance run.
      return versionStore.update(id, { ...patch, status: "draft", conformance: null, digest: null });
    },
    async remove(id: Id) {
      const current = await versionStore.get(id);
      if (current && current.status !== "draft") {
        throw new ServiceError("CONFLICT", "Certified versions are kept for the transactions they governed. Void it instead.", 409);
      }
      return versionStore.remove(id);
    },
    /** A new draft copied from an existing version. */
    async branchFrom(id: Id, by: string | null): Promise<CountryPackVersion> {
      const source = await versionStore.get(id);
      if (!source) throw new ServiceError("NOT_FOUND", "That pack version no longer exists.", 404);
      const [year, minor] = source.version.split("-")[0]!.split(".");
      const { id: _drop, ...rest } = source;
      void _drop;
      return versionStore.create({
        ...rest,
        version: `${year}.${Number(minor ?? 0) + 1}`,
        changeNote: "",
        createdBy: by,
        createdAt: nowIso(),
      });
    },
    async runConformance(id: Id): Promise<CountryPackVersion> {
      const current = await versionStore.get(id);
      if (!current) throw new ServiceError("NOT_FOUND", "That pack version no longer exists.", 404);
      if (current.status !== "draft") return current;
      return versionStore.update(id, { conformance: runConformance(current, nowIso()) });
    },
    /** FR-LOC-030 — valid, conformant, digested: then terminals may download it. */
    async certify(id: Id, by: string | null): Promise<CountryPackVersion> {
      const all = await versionStore.all();
      const current = all.find((row) => row.id === id);
      if (!current) throw new ServiceError("NOT_FOUND", "That pack version no longer exists.", 404);
      if (current.status !== "draft") throw new ServiceError("CONFLICT", "Only a draft can be certified.", 409);
      const errors = validatePack(current, all).filter((problem) => problem.severity === "error");
      if (errors.length > 0) {
        throw new ServiceError("VALIDATION", `${errors.length} validation error(s) remain: ${errors[0]!.message}`, 422);
      }
      const conformance = runConformance(current, nowIso());
      if (!conformance.passed) {
        throw new ServiceError("VALIDATION", `The conformance suite failed ${conformance.cases.filter((row) => !row.passed).length} case(s).`, 422);
      }
      const digest = await digestOf(current);
      const at = nowIso();
      return versionStore.update(id, { status: "certified", conformance, digest, certifiedAt: at, certifiedBy: by, publishedAt: at });
    },
    async voidVersion(id: Id): Promise<CountryPackVersion> {
      const current = await versionStore.get(id);
      if (!current) throw new ServiceError("NOT_FOUND", "That pack version no longer exists.", 404);
      if (current.status !== "certified") throw new ServiceError("CONFLICT", "Only a certified version can be voided.", 409);
      if (current.effectiveFrom <= nowIso().slice(0, 10)) {
        throw new ServiceError("CONFLICT", "This version has already governed transactions and cannot be voided. Supersede it with a new version.", 409);
      }
      return versionStore.update(id, { status: "void" });
    },
  };

  const userLanguages = localCollection<UserLanguage>(
    { name: "user-languages", idOf: (row) => row.id, factory: (input, id) => ({ ...(input as UserLanguage), id: input.id ?? id, updatedAt: nowIso() }), onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }) },
    tenantOf,
  );
  const terminalLanguages = localCollection<TerminalLanguage>(
    { name: "terminal-languages", idOf: (row) => row.id, branchOf: (row) => row.branchId, factory: (input, id) => ({ ...(input as TerminalLanguage), id: input.id ?? id, updatedAt: nowIso() }), onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }) },
    tenantOf,
  );
  const documentLanguages = localCollection<DocumentLanguage>(
    { name: "document-languages", idOf: (row) => row.id, factory: (input, id) => ({ ...(input as DocumentLanguage), id: input.id ?? id, updatedAt: nowIso() }), onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }) },
    tenantOf,
  );

  async function put<T extends { id: string }>(store: LocalCollection<T>, row: T): Promise<T> {
    const existing = await store.get(row.id);
    return existing ? store.update(row.id, row) : store.create(row);
  }

  const printerModels = localCollection<PrinterModel>(
    {
      name: "printer-models",
      idOf: (row) => row.id,
      search: (row) => [row.vendor, row.model],
      sorters: { vendor: (row) => `${row.vendor} ${row.model}` },
      factory: (input, id) => {
        if (!input.vendor?.trim() || !input.model?.trim()) throw new ServiceError("VALIDATION", "Give the vendor and the model.", 422);
        if (!input.paperWidths?.length) throw new ServiceError("VALIDATION", "Choose at least one paper width.", 422);
        return { id, vendor: input.vendor.trim(), model: input.model.trim(), dpi: input.dpi ?? 203, paperWidths: input.paperWidths, claimsArabic: input.claimsArabic ?? false, createdAt: nowIso() };
      },
    },
    tenantOf,
  );

  const printTests = localCollection<PrintTestRecord>(
    {
      name: "print-tests",
      idOf: (row) => row.id,
      filters: { printerModelId: (row) => row.printerModelId, result: (row) => row.result },
      sorters: { testedAt: (row) => row.testedAt },
      factory: (input, id) => {
        if (!input.printerModelId) throw new ServiceError("VALIDATION", "Choose the printer model tested.", 422);
        if (input.result !== "pass" && input.result !== "fail") throw new ServiceError("VALIDATION", "Record whether the print passed.", 422);
        if (input.result === "fail" && !input.notes?.trim()) {
          throw new ServiceError("VALIDATION", "Describe the failure — broken joins, reversed text, missing dots — so the next test can check for it.", 422);
        }
        return { ...(input as PrintTestRecord), id, notes: input.notes?.trim() ?? "", testedAt: nowIso() };
      },
      guardRemove: () => "Test results are the evidence behind the matrix and are kept.",
    },
    tenantOf,
  );

  const profileDoc = localDocument<PrintProfile>("print-profile", () => DEFAULT_PRINT_PROFILE, tenantOf);

  return {
    packVersions,
    userLanguages,
    terminalLanguages,
    documentLanguages,
    setUserLanguage: (row: UserLanguage) => put(userLanguages, row),
    setTerminalLanguage: (row: TerminalLanguage) => put(terminalLanguages, row),
    setDocumentLanguage: (row: DocumentLanguage) => put(documentLanguages, row),
    printerModels,
    printTests,
    async printProfile(): Promise<PrintProfile> {
      return profileDoc.read();
    },
    async savePrintProfile(profile: PrintProfile): Promise<PrintProfile> {
      if (!(profile.receiptSizeDots >= 16 && profile.receiptSizeDots <= 64)) {
        throw new ServiceError("VALIDATION", "Receipt text size must be between 16 and 64 dots.", 422);
      }
      if (!(profile.kdsSizePx >= 12 && profile.kdsSizePx <= 160)) {
        throw new ServiceError("VALIDATION", "KDS text size must be between 12 and 160 px.", 422);
      }
      const next = { ...profile, updatedAt: nowIso() };
      profileDoc.write(next);
      return next;
    },
  };
}

export type LocalisationService = ReturnType<typeof createLocalisationService>;
