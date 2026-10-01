import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * FR-POS-101 / FR-POS-102 — `services.receiptTemplates`.
 *
 * The http implementation against the wire (mocked only at
 * `@/lib/api/endpoints`, so the real mapping runs): what it sends, what it
 * returns, that backend errors pass through untouched, and that it never
 * reads or writes browser storage. And that the in-memory demo
 * implementation stays a demo: only the mock registry references it.
 */

const { list, create, update, scopeOptions, resolveOne, posTemplate } =
  vi.hoisted(() => ({
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    scopeOptions: vi.fn(),
    resolveOne: vi.fn(),
    posTemplate: vi.fn(),
  }));

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    sales: {
      listReceiptTemplates: (...args: unknown[]) => list(...args),
      createReceiptTemplates: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
      scopeOptions: (...args: unknown[]) => scopeOptions(...args),
      resolveReceiptTemplates: (...args: unknown[]) => resolveOne(...args),
      receiptTemplate: (...args: unknown[]) => posTemplate(...args),
    },
  },
}));

import { httpReceiptTemplates } from "./receipt-templates";
import { ServiceError } from "./types";

const wireOptions = {
  paperStyle: "thermal",
  showBrandName: true,
  showBranchName: true,
  showBranchAddress: false,
  showOrderType: true,
  showTable: true,
  showGuests: false,
  showCashier: true,
  suggestedTips: [10, 15, 20],
  signatureLine: true,
};

const wireRow = (overrides: Record<string, unknown> = {}) => ({
  id: "rct_1",
  tenantId: "tenant-1",
  brandId: null,
  countryPackCode: "EG",
  scope: "country_pack",
  languageMode: "bilingual",
  bothOrder: "en_first",
  logoUrl: "https://cdn.example.com/logo.png",
  backSide: "none",
  options: wireOptions,
  headerLines: [{ en: "Header", ar: "ترويسة" }],
  footerLines: [{ en: "Footer", ar: "تذييل" }],
  version: 4,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  ...overrides,
});

const storageCalls = () => [
  ...vi.mocked(Storage.prototype.getItem).mock.calls,
  ...vi.mocked(Storage.prototype.setItem).mock.calls,
  ...vi.mocked(Storage.prototype.removeItem).mock.calls,
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Storage.prototype, "getItem");
  vi.spyOn(Storage.prototype, "setItem");
  vi.spyOn(Storage.prototype, "removeItem");
});
afterEach(() => vi.restoreAllMocks());

describe("http receipt templates", () => {
  it("lists the tenant's templates from the API", async () => {
    list.mockResolvedValue({
      items: [
        wireRow(),
        wireRow({
          id: "rct_2",
          scope: "tenant_default",
          countryPackCode: null,
        }),
      ],
    });
    const rows = await httpReceiptTemplates.list();

    expect(list).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.id)).toEqual(["rct_1", "rct_2"]);
    expect(rows[0]).toEqual({
      id: "rct_1",
      brandId: null,
      countryPackCode: "EG",
      scope: "country_pack",
      languageMode: "bilingual",
      bothOrder: "en_first",
      logoUrl: "https://cdn.example.com/logo.png",
      backSide: "none",
      options: wireOptions,
      headerLines: [{ en: "Header", ar: "ترويسة" }],
      footerLines: [{ en: "Footer", ar: "تذييل" }],
      version: 4,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
    });
  });

  it("creates with the chosen scope and content — never the retired fields, never a paper width", async () => {
    create.mockResolvedValue(wireRow());
    const created = await httpReceiptTemplates.create({
      brandId: "brand-1",
      countryPackCode: "EG",
      languageMode: "bilingual",
      bothOrder: "ar_first",
      logoUrl: "https://cdn.example.com/logo.png",
      headerLines: [{ en: "Header", ar: "ترويسة" }],
      footerLines: [],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0];
    expect(body).toEqual({
      brandId: "brand-1",
      countryPackCode: "EG",
      languageMode: "bilingual",
      bothOrder: "ar_first",
      logoUrl: "https://cdn.example.com/logo.png",
      headerLines: [{ en: "Header", ar: "ترويسة" }],
      footerLines: [],
    });
    expect(Object.keys(body)).not.toEqual(
      expect.arrayContaining([
        "name",
        "active",
        "layout",
        "paperWidth",
        "qr",
        "show",
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('"both"');
    expect(created.id).toBe("rct_1");
  });

  it("sends a plain scope-only create without content, leaving the backend's defaults", async () => {
    create.mockResolvedValue(wireRow());
    await httpReceiptTemplates.create({ brandId: null, countryPackCode: "SA" });
    expect(create.mock.calls[0]![0]).toEqual({
      brandId: null,
      countryPackCode: "SA",
    });
  });

  it("updates with the version it read and only the fields it was given", async () => {
    update.mockResolvedValue(wireRow({ version: 5, languageMode: "ar" }));
    const saved = await httpReceiptTemplates.update("rct_1", {
      version: 4,
      languageMode: "ar",
    });

    expect(update).toHaveBeenCalledWith("rct_1", {
      version: 4,
      languageMode: "ar",
    });
    expect(saved.version).toBe(5);
  });

  it("reads the options from the wire and sends only the option keys it was given", async () => {
    list.mockResolvedValue({ items: [wireRow()] });
    expect((await httpReceiptTemplates.list())[0]!.options).toEqual(
      wireOptions,
    );

    update.mockResolvedValue(wireRow({ version: 5 }));
    await httpReceiptTemplates.update("rct_1", {
      version: 4,
      options: { showTable: false },
    });
    expect(update).toHaveBeenLastCalledWith("rct_1", {
      version: 4,
      options: { showTable: false },
    });
  });

  it("reads the country pack choices from the scope-options route", async () => {
    scopeOptions.mockResolvedValue({
      tenantCountryPackCode: "EG",
      loadedCountryPackCodes: ["EG", "SA"],
    });
    expect(await httpReceiptTemplates.scopeOptions()).toEqual({
      tenantCountryPackCode: "EG",
      loadedCountryPackCodes: ["EG", "SA"],
    });
  });

  it("resolves the template of a branch, with the inputs the backend used", async () => {
    resolveOne.mockResolvedValue({
      template: {
        languageMode: "en",
        bothOrder: "ar_first",
        logoUrl: null,
        backSide: "none",
        options: wireOptions,
        headerLines: [],
        footerLines: [],
      },
      source: "brand",
      templateId: "rct_9",
      version: 2,
      isDefault: false,
      resolvedFor: {
        branchId: "branch-1",
        brandId: "brand-1",
        countryPackCode: "EG",
      },
    });
    const result = await httpReceiptTemplates.resolveForBranch("branch-1");

    expect(resolveOne).toHaveBeenCalledWith({ branchId: "branch-1" });
    expect(result).toMatchObject({
      source: "brand",
      templateId: "rct_9",
      version: 2,
      isDefault: false,
      resolvedFor: {
        branchId: "branch-1",
        brandId: "brand-1",
        countryPackCode: "EG",
      },
    });
  });

  it("reads the POS branch's template from the till's own route", async () => {
    posTemplate.mockResolvedValue({
      template: {
        languageMode: "ar",
        bothOrder: "ar_first",
        logoUrl: null,
        backSide: "none",
        options: wireOptions,
        headerLines: [],
        footerLines: [],
      },
      source: "built_in_default",
      templateId: null,
      version: null,
      isDefault: true,
    });
    const result = await httpReceiptTemplates.forPosBranch();

    expect(posTemplate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "built_in_default",
      templateId: null,
      version: null,
      isDefault: true,
    });
    expect(result.template.languageMode).toBe("ar");
  });

  it("carries the back side both ways: read from the wire, and sent only when chosen", async () => {
    list.mockResolvedValue({ items: [wireRow({ backSide: "logo_pattern" })] });
    expect((await httpReceiptTemplates.list())[0]!.backSide).toBe(
      "logo_pattern",
    );

    create.mockResolvedValue(wireRow({ backSide: "logo_pattern" }));
    await httpReceiptTemplates.create({
      brandId: null,
      countryPackCode: "EG",
      logoUrl: "https://cdn.example.com/logo.png",
      backSide: "logo_pattern",
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      backSide: "logo_pattern",
    });

    update.mockResolvedValue(wireRow({ version: 5 }));
    await httpReceiptTemplates.update("rct_1", {
      version: 4,
      backSide: "none",
    });
    expect(update).toHaveBeenLastCalledWith("rct_1", {
      version: 4,
      backSide: "none",
    });

    // Not chosen, not sent: the backend keeps what it has.
    await httpReceiptTemplates.update("rct_1", {
      version: 5,
      languageMode: "en",
    });
    expect(update).toHaveBeenLastCalledWith("rct_1", {
      version: 5,
      languageMode: "en",
    });
  });

  it("passes the backend's 400 and 409 through unchanged", async () => {
    const refused = new ServiceError(
      "BAD_REQUEST",
      "headerLines may contain at most 4 lines.",
      400,
    );
    create.mockRejectedValue(refused);
    await expect(
      httpReceiptTemplates.create({ brandId: null, countryPackCode: null }),
    ).rejects.toBe(refused);

    const stale = new ServiceError("CONFLICT", "version conflict", 409);
    update.mockRejectedValue(stale);
    await expect(
      httpReceiptTemplates.update("rct_1", { version: 1, logoUrl: null }),
    ).rejects.toBe(stale);
  });

  it("never reads or writes browser storage — the server is the only source of truth", async () => {
    list.mockResolvedValue({ items: [wireRow()] });
    create.mockResolvedValue(wireRow());
    update.mockResolvedValue(wireRow());
    scopeOptions.mockResolvedValue({
      tenantCountryPackCode: "EG",
      loadedCountryPackCodes: ["EG"],
    });
    resolveOne.mockResolvedValue({
      template: {
        languageMode: "en",
        bothOrder: "ar_first",
        logoUrl: null,
        backSide: "none",
        options: wireOptions,
        headerLines: [],
        footerLines: [],
      },
      source: "built_in_default",
      templateId: null,
      version: null,
      isDefault: true,
      resolvedFor: { branchId: "b", brandId: "br", countryPackCode: "EG" },
    });
    posTemplate.mockResolvedValue(
      await httpReceiptTemplates.resolveForBranch("b"),
    );

    await httpReceiptTemplates.list();
    await httpReceiptTemplates.create({ brandId: null, countryPackCode: "EG" });
    await httpReceiptTemplates.update("rct_1", {
      version: 1,
      languageMode: "en",
    });
    await httpReceiptTemplates.scopeOptions();
    await httpReceiptTemplates.resolveForBranch("b");
    await httpReceiptTemplates.forPosBranch();

    expect(storageCalls()).toEqual([]);
  });
});

describe("mock receipt templates stay in mock mode", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

  it("is referenced only by the mock registry", () => {
    expect(read("./mock.ts")).toContain("../mock/receipt-templates");
    // Imports only — a doc comment may mention the mock by name.
    const imports = (source: string) =>
      source
        .split("\n")
        .filter((line) =>
          /^\s*(import|export)\b.*\bfrom\b|^\s*import\s*\(/.test(line),
        );
    expect(imports(read("./http.ts")).join("\n")).not.toMatch(
      /mock\/receipt-templates/,
    );
    expect(imports(read("./receipt-templates.ts")).join("\n")).not.toMatch(
      /mock\//,
    );
    expect(imports(read("./index.ts")).join("\n")).not.toMatch(
      /mock\/receipt-templates/,
    );
  });

  it("is registered as live in the http coverage map", async () => {
    const { API_COVERAGE, httpServices } = await import("./http");
    expect(API_COVERAGE.live).toContain("receiptTemplates");
    expect(httpServices.receiptTemplates).toBe(httpReceiptTemplates);
  });

  it("does not use browser storage or the network, and can be reset", async () => {
    const { mockReceiptTemplates, resetMockReceiptTemplates } =
      await import("../mock/receipt-templates");
    resetMockReceiptTemplates();
    const created = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      languageMode: "ar",
    });
    expect(await mockReceiptTemplates.list()).toHaveLength(1);
    expect(created.version).toBe(1);

    resetMockReceiptTemplates();
    expect(await mockReceiptTemplates.list()).toEqual([]);
    expect(storageCalls()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("applies the backend's version rule, so the mock cannot hide a conflict", async () => {
    const { mockReceiptTemplates, resetMockReceiptTemplates } =
      await import("../mock/receipt-templates");
    resetMockReceiptTemplates();
    const row = await mockReceiptTemplates.create({ countryPackCode: "EG" });
    await mockReceiptTemplates.update(row.id, {
      version: 1,
      languageMode: "en",
    });
    await expect(
      mockReceiptTemplates.update(row.id, { version: 1, languageMode: "ar" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("applies the backend's back-side rules: a pattern needs a logo, and clearing the logo is refused while it is on", async () => {
    const { mockReceiptTemplates, resetMockReceiptTemplates } =
      await import("../mock/receipt-templates");
    resetMockReceiptTemplates();

    await expect(
      mockReceiptTemplates.create({
        countryPackCode: "EG",
        backSide: "logo_pattern",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: expect.stringContaining("needs a logoUrl"),
    });
    await expect(
      mockReceiptTemplates.create({
        countryPackCode: "EG",
        backSide: "sideways" as never,
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    const row = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      logoUrl: "https://cdn.example.com/logo.png",
      backSide: "logo_pattern",
    });
    expect(row.backSide).toBe("logo_pattern");
    await expect(
      mockReceiptTemplates.update(row.id, { version: 1, logoUrl: null }),
    ).rejects.toMatchObject({ status: 400 });
    const cleared = await mockReceiptTemplates.update(row.id, {
      version: 1,
      logoUrl: null,
      backSide: "none",
    });
    expect(cleared.backSide).toBe("none");
    expect(cleared.logoUrl).toBeNull();
  });

  it("serves 'none' when nothing is configured", async () => {
    const { mockReceiptTemplates, resetMockReceiptTemplates } =
      await import("../mock/receipt-templates");
    resetMockReceiptTemplates();
    expect((await mockReceiptTemplates.forPosBranch()).template.backSide).toBe(
      "none",
    );
  });

  it("keeps the options the client chose, key by key, and refuses bad ones like the backend", async () => {
    const { mockReceiptTemplates, resetMockReceiptTemplates } =
      await import("../mock/receipt-templates");
    resetMockReceiptTemplates();
    const row = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      options: { showCashier: false, suggestedTips: [10, 15] },
    });
    expect(row.options).toMatchObject({
      showCashier: false,
      showTable: true,
      suggestedTips: [10, 15],
      paperStyle: "classic",
    });
    const next = await mockReceiptTemplates.update(row.id, {
      version: 1,
      options: { paperStyle: "thermal" },
    });
    expect(next.options).toMatchObject({
      paperStyle: "thermal",
      showCashier: false,
      suggestedTips: [10, 15],
    });
    await expect(
      mockReceiptTemplates.update(row.id, {
        version: 2,
        options: { suggestedTips: [10, 10] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      mockReceiptTemplates.update(row.id, {
        version: 2,
        options: { colour: "red" } as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
