import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_OPTIONS,
  columnsFor,
  contentChanges,
  documentDirection,
  isHttpsUrl,
  languageFieldsOf,
  layoutOf,
  localisedLabel,
  previewReceiptDocument,
  printLanguages,
  printedTexts,
  receiptContentIssues,
  sameContent,
  type ReceiptTemplateContent,
} from "./receipt";

/*
 * FR-POS-101 / FR-POS-102 — the pure parts: the layout <-> languageMode +
 * bothOrder mapping, which languages print and in what order, the checks the
 * editor makes before sending, and the diff a PATCH carries.
 */

const base: ReceiptTemplateContent = {
  languageMode: "bilingual",
  bothOrder: "ar_first",
  logoUrl: null,
  backSide: "none",
  options: DEFAULT_RECEIPT_OPTIONS,
  headerLines: [],
  footerLines: [],
};

describe("layout mapping", () => {
  it.each([
    ["ar", { languageMode: "ar" }],
    ["en", { languageMode: "en" }],
    ["ar_en", { languageMode: "bilingual", bothOrder: "ar_first" }],
    ["en_ar", { languageMode: "bilingual", bothOrder: "en_first" }],
  ] as const)("%s <-> %j", (layout, fields) => {
    expect(languageFieldsOf(layout)).toEqual(fields);
    expect(layoutOf({ bothOrder: "ar_first", ...fields })).toBe(layout);
  });

  it("never produces the retired 'both' mode", () => {
    for (const layout of ["ar", "en", "ar_en", "en_ar"] as const) {
      expect(JSON.stringify(languageFieldsOf(layout))).not.toContain('"both"');
    }
  });
});

describe("which languages print, and in what order", () => {
  it("Arabic", () =>
    expect(printLanguages({ ...base, languageMode: "ar" })).toEqual(["ar"]));
  it("English", () =>
    expect(printLanguages({ ...base, languageMode: "en" })).toEqual(["en"]));
  it("bilingual, Arabic first", () =>
    expect(printLanguages(base)).toEqual(["ar", "en"]));
  it("bilingual, English first", () =>
    expect(printLanguages({ ...base, bothOrder: "en_first" })).toEqual([
      "en",
      "ar",
    ]));

  it("the document reads in the direction of its first language", () => {
    expect(documentDirection(["ar"])).toBe("rtl");
    expect(documentDirection(["ar", "en"])).toBe("rtl");
    expect(documentDirection(["en"])).toBe("ltr");
    expect(documentDirection(["en", "ar"])).toBe("ltr");
  });

  it("a text prints in each requested language, in order", () => {
    const value = { en: "Thank you", ar: "شكرًا" };
    expect(printedTexts(value, ["ar"]).map((entry) => entry.text)).toEqual([
      "شكرًا",
    ]);
    expect(printedTexts(value, ["en"]).map((entry) => entry.text)).toEqual([
      "Thank you",
    ]);
    expect(
      printedTexts(value, ["ar", "en"]).map((entry) => entry.text),
    ).toEqual(["شكرًا", "Thank you"]);
    expect(
      printedTexts(value, ["en", "ar"]).map((entry) => entry.text),
    ).toEqual(["Thank you", "شكرًا"]);
    expect(printedTexts(value, ["ar", "en"]).map((entry) => entry.dir)).toEqual(
      ["rtl", "ltr"],
    );
  });

  it("a line written in one language falls back rather than printing nothing, and is not printed twice", () => {
    expect(
      printedTexts({ en: "Open daily", ar: "" }, ["ar"]).map(
        (entry) => entry.text,
      ),
    ).toEqual(["Open daily"]);
    expect(
      printedTexts({ en: "Open daily", ar: "" }, ["ar", "en"]).map(
        (entry) => entry.text,
      ),
    ).toEqual(["Open daily"]);
    expect(printedTexts({ en: "", ar: "" }, ["ar", "en"])).toEqual([]);
  });

  it("fixed labels come from both dictionaries, whatever the screen language", () => {
    const label = localisedLabel("pos.subtotal");
    expect(label.en).not.toBe(label.ar);
    expect(label.en.length).toBeGreaterThan(0);
    expect(label.ar.length).toBeGreaterThan(0);
  });
});

describe("what the editor checks before it sends", () => {
  const line = (en: string, ar = "") => ({ en, ar });

  it("accepts up to four lines of up to 120 characters", () => {
    const four = [
      line("a"),
      line("b"),
      line("", "ج"),
      line("x".repeat(120), "ي".repeat(120)),
    ];
    expect(
      receiptContentIssues({ ...base, headerLines: four, footerLines: four }),
    ).toEqual([]);
  });

  it("flags a fifth line", () => {
    const five = Array.from({ length: 5 }, () => line("a"));
    expect(receiptContentIssues({ ...base, footerLines: five })).toEqual([
      { code: "tooManyLines", field: "footerLines" },
    ]);
  });

  it("flags a line over 120 characters, naming the language", () => {
    expect(
      receiptContentIssues({ ...base, headerLines: [line("x".repeat(121))] }),
    ).toEqual([
      { code: "lineTooLong", field: "headerLines", index: 0, language: "en" },
    ]);
    expect(
      receiptContentIssues({
        ...base,
        headerLines: [line("a", "ب".repeat(121))],
      }),
    ).toEqual([
      { code: "lineTooLong", field: "headerLines", index: 0, language: "ar" },
    ]);
  });

  it("flags a line with no text in either language", () => {
    expect(
      receiptContentIssues({ ...base, headerLines: [line("  ", "")] }),
    ).toEqual([{ code: "lineEmpty", field: "headerLines", index: 0 }]);
  });

  it("accepts up to four different whole-number tips from 1 to 100", () => {
    const withTips = (suggestedTips: number[]) =>
      receiptContentIssues({
        ...base,
        options: { ...DEFAULT_RECEIPT_OPTIONS, suggestedTips },
      });
    expect(withTips([])).toEqual([]);
    expect(withTips([5, 10, 15, 100])).toEqual([]);
    for (const bad of [
      [0],
      [101],
      [7.5],
      [Number.NaN],
      [10, 10],
      [1, 2, 3, 4, 5],
    ]) {
      expect(withTips(bad)).toEqual([{ code: "badTips" }]);
    }
  });

  it("only accepts an https logo without spaces or credentials", () => {
    expect(isHttpsUrl("https://cdn.example.com/logo.png")).toBe(true);
    for (const bad of [
      "http://cdn.example.com/logo.png",
      "data:image/png;base64,AAAA",
      "//cdn.example.com/logo.png",
      "https://user:pass@cdn.example.com/logo.png",
      "https://cdn.example.com/my logo.png",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isHttpsUrl(bad)).toBe(false);
    }
    expect(
      receiptContentIssues({ ...base, logoUrl: "http://x.test/a.png" }),
    ).toEqual([{ code: "logoNotHttps" }]);
    expect(receiptContentIssues({ ...base, logoUrl: null })).toEqual([]);
  });
});

describe("what a PATCH carries", () => {
  it("is empty when nothing changed", () => {
    expect(sameContent(base, { ...base })).toBe(true);
    expect(contentChanges(base, { ...base })).toEqual({});
  });

  it("carries only the fields that changed", () => {
    const after = {
      ...base,
      languageMode: "en" as const,
      footerLines: [{ en: "Bye", ar: "وداعًا" }],
    };
    expect(sameContent(base, after)).toBe(false);
    expect(contentChanges(base, after)).toEqual({
      languageMode: "en",
      footerLines: [{ en: "Bye", ar: "وداعًا" }],
    });
  });

  it("carries only the option keys that changed", () => {
    const after = {
      ...base,
      options: {
        ...DEFAULT_RECEIPT_OPTIONS,
        showCashier: false,
        suggestedTips: [10, 15],
      },
    };
    expect(sameContent(base, after)).toBe(false);
    expect(contentChanges(base, after)).toEqual({
      options: { showCashier: false, suggestedTips: [10, 15] },
    });
    expect(contentChanges(after, after)).toEqual({});
  });

  it("clearing the logo is a change to null", () => {
    expect(
      contentChanges({ ...base, logoUrl: "https://x.test/a.png" }, base),
    ).toEqual({ logoUrl: null });
  });
});

describe("preview", () => {
  it("is a sample with no business data of its own", () => {
    const sample = previewReceiptDocument();
    expect(sample.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(sample)).not.toMatch(/REG|\d{3}-\d{3}-\d{3}/);
  });

  it("58 mm paper is narrower than 80 mm", () => {
    expect(columnsFor(58)).toBeLessThan(columnsFor(80));
  });
});

describe("back side (double-sided receipt)", () => {
  const logo = "https://cdn.example.com/logo.png";

  it("a template without the field reads as none", () => {
    expect(sameContent(base, { ...base, backSide: "none" })).toBe(true);
    expect(contentChanges(base, { ...base, backSide: "none" })).toEqual({});
  });

  it("a change to the back side is a PATCH field of its own", () => {
    expect(sameContent(base, { ...base, backSide: "logo_pattern" })).toBe(
      false,
    );
    expect(
      contentChanges(
        { ...base, logoUrl: logo },
        { ...base, logoUrl: logo, backSide: "logo_pattern" },
      ),
    ).toEqual({
      backSide: "logo_pattern",
    });
    expect(
      contentChanges(
        { ...base, logoUrl: logo, backSide: "logo_pattern" },
        { ...base, logoUrl: logo },
      ),
    ).toEqual({
      backSide: "none",
    });
  });

  it("a repeated-logo back needs a logo, the same rule the backend applies", () => {
    expect(receiptContentIssues({ ...base, backSide: "logo_pattern" })).toEqual(
      [{ code: "backSideNeedsLogo" }],
    );
    expect(
      receiptContentIssues({
        ...base,
        backSide: "logo_pattern",
        logoUrl: "   ",
      }),
    ).toEqual([{ code: "backSideNeedsLogo" }]);
    expect(
      receiptContentIssues({
        ...base,
        backSide: "logo_pattern",
        logoUrl: logo,
      }),
    ).toEqual([]);
    expect(receiptContentIssues({ ...base, backSide: "none" })).toEqual([]);
  });
});
