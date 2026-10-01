/**
 * Receipt templates — the in-memory demo implementation (`DATA_MODE === "mock"`).
 *
 * Reached ONLY through `services/mock.ts`; the http registry never imports it.
 * State is a module variable: it lives for the page's lifetime and is never
 * written to `localStorage` (or anywhere else), so there is exactly one place
 * a template can be read from in each mode — this file in the demo, the
 * backend in http mode.
 *
 * It follows the backend's rules closely enough for the editor to behave the
 * same either way: one template per (brand, country pack), a version that
 * increments on every real change, a 409 for a stale version or a duplicate
 * scope, a 400 for an invalid field, and a built-in default when nothing
 * applies.
 */

import {
  DEFAULT_RECEIPT_OPTIONS,
  RECEIPT_MAX_TIPS,
  RECEIPT_PAPER_STYLES,
  RECEIPT_SHOW_OPTIONS,
  optionsOf,
  type ReceiptOptions,
  RECEIPT_MAX_LINES,
  RECEIPT_MAX_LINE_LENGTH,
  isHttpsUrl,
  sameContent,
  type NewReceiptTemplate,
  type ReceiptScopeOptions,
  type ReceiptTemplate,
  type ReceiptTemplateContent,
  type ReceiptTemplateScope,
  type ReceiptTemplateSource,
  type ResolvedReceiptTemplate,
} from "../receipt";
import { ServiceError, type ReceiptTemplateService } from "../services/types";
import type { Localised } from "../types";
import { ACTIVE_TENANT_ID, branches, tenants } from "./org";
import { countryPacks } from "./platform";

/** The demo tenant's own pack and the packs "loaded" in the demo. */
const TENANT_PACK =
  tenants.find((tenant) => tenant.id === ACTIVE_TENANT_ID)?.countryCode ?? "EG";
const LOADED_PACKS = countryPacks.map((pack) => pack.code as string).sort();

/** What prints when nothing is configured — the backend serves the same. */
const BUILT_IN_DEFAULT: ReceiptTemplateContent = {
  languageMode: "bilingual",
  bothOrder: "ar_first",
  logoUrl: null,
  backSide: "none",
  options: DEFAULT_RECEIPT_OPTIONS,
  headerLines: [],
  footerLines: [{ en: "Thank you", ar: "شكرًا لزيارتكم" }],
};

const SCOPE_RANK: Record<ReceiptTemplateScope, number> = {
  tenant_default: 0,
  country_pack: 1,
  brand: 2,
  brand_country_pack: 3,
};

let rows: ReceiptTemplate[] = [];
let counter = 0;

/** Test hook: forget everything (the module lives as long as the page). */
export function resetMockReceiptTemplates(): void {
  rows = [];
  counter = 0;
}

/** What create/update validation produces: the fields supplied, options as a partial. */
type Validated = Partial<Omit<ReceiptTemplateContent, "options">> & {
  options?: Partial<ReceiptOptions>;
};

const copy = (row: ReceiptTemplate): ReceiptTemplate => ({
  ...row,
  options: optionsOf(row),
  headerLines: row.headerLines.map((line) => ({ ...line })),
  footerLines: row.footerLines.map((line) => ({ ...line })),
});

const contentOf = (row: ReceiptTemplate): ReceiptTemplateContent => ({
  languageMode: row.languageMode,
  bothOrder: row.bothOrder,
  logoUrl: row.logoUrl,
  backSide: row.backSide ?? "none",
  options: optionsOf(row),
  headerLines: row.headerLines.map((line) => ({ ...line })),
  footerLines: row.footerLines.map((line) => ({ ...line })),
});

const scopeOf = (
  brandId: string | null,
  pack: string | null,
): ReceiptTemplateScope =>
  brandId && pack
    ? "brand_country_pack"
    : brandId
      ? "brand"
      : pack
        ? "country_pack"
        : "tenant_default";

/** A back-side pattern needs a logo to repeat — checked on the whole template, as the backend does. */
function assertConsistent(
  template: Pick<ReceiptTemplateContent, "backSide" | "logoUrl">,
): void {
  if (template.backSide === "logo_pattern" && !template.logoUrl) {
    refuse("backSide 'logo_pattern' needs a logoUrl to repeat.");
  }
}

function refuse(message: string | string[]): never {
  throw new ServiceError(
    "BAD_REQUEST",
    Array.isArray(message) ? message.join(" · ") : message,
    400,
    "mock",
  );
}

function cleanLines(
  field: string,
  value: Localised[],
  issues: string[],
): Localised[] | undefined {
  if (value.length > RECEIPT_MAX_LINES) {
    issues.push(`${field} may contain at most ${RECEIPT_MAX_LINES} lines.`);
    return undefined;
  }
  const out: Localised[] = [];
  let ok = true;
  value.forEach((line, index) => {
    const en = (line.en ?? "").trim();
    const ar = (line.ar ?? "").trim();
    if (en.length > RECEIPT_MAX_LINE_LENGTH) {
      issues.push(
        `${field}[${index}].en must be at most ${RECEIPT_MAX_LINE_LENGTH} characters.`,
      );
      ok = false;
    }
    if (ar.length > RECEIPT_MAX_LINE_LENGTH) {
      issues.push(
        `${field}[${index}].ar must be at most ${RECEIPT_MAX_LINE_LENGTH} characters.`,
      );
      ok = false;
    }
    if (en.length === 0 && ar.length === 0) {
      issues.push(
        `${field}[${index}] must contain text in at least one language.`,
      );
      ok = false;
    }
    out.push({ en, ar });
  });
  return ok ? out : undefined;
}

function validateOptions(
  value: unknown,
  issues: string[],
): Partial<ReceiptOptions> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push("options must be an object.");
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const known = [
    "paperStyle",
    "suggestedTips",
    "signatureLine",
    ...RECEIPT_SHOW_OPTIONS,
  ];
  const before = issues.length;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (!known.includes(key))
      issues.push(
        `options.${key} is not a recognised option. Options: ${known.join(", ")}.`,
      );
  }
  if (input.paperStyle !== undefined) {
    if (RECEIPT_PAPER_STYLES.includes(input.paperStyle as never))
      out.paperStyle = input.paperStyle;
    else
      issues.push(
        `options.paperStyle must be one of: ${RECEIPT_PAPER_STYLES.join(", ")}.`,
      );
  }
  for (const key of [...RECEIPT_SHOW_OPTIONS, "signatureLine"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] === "boolean") out[key] = input[key];
    else issues.push(`options.${key} must be true or false.`);
  }
  if (input.suggestedTips !== undefined) {
    const tips = input.suggestedTips;
    if (!Array.isArray(tips))
      issues.push("options.suggestedTips must be an array of percentages.");
    else if (tips.length > RECEIPT_MAX_TIPS)
      issues.push(
        `options.suggestedTips may contain at most ${RECEIPT_MAX_TIPS} percentages.`,
      );
    else if (
      !tips.every(
        (tip) =>
          typeof tip === "number" &&
          Number.isInteger(tip) &&
          tip >= 1 &&
          tip <= 100,
      )
    )
      issues.push(
        "options.suggestedTips must be whole percentages from 1 to 100.",
      );
    else if (new Set(tips).size !== tips.length)
      issues.push("options.suggestedTips must not repeat a percentage.");
    else out.suggestedTips = [...tips];
  }
  return issues.length === before
    ? (out as Partial<ReceiptOptions>)
    : undefined;
}

/** The backend's write-side validation, for the fields that were supplied. */
function validate(input: Validated): Validated {
  const issues: string[] = [];
  const out: Validated = {};
  if (input.languageMode !== undefined) {
    if (["ar", "en", "bilingual"].includes(input.languageMode))
      out.languageMode = input.languageMode;
    else issues.push("languageMode must be one of: ar, en, bilingual.");
  }
  if (input.bothOrder !== undefined) {
    if (["ar_first", "en_first"].includes(input.bothOrder))
      out.bothOrder = input.bothOrder;
    else issues.push("bothOrder must be one of: ar_first, en_first.");
  }
  if (input.logoUrl !== undefined) {
    const logo = input.logoUrl === null ? "" : input.logoUrl.trim();
    if (logo.length === 0) out.logoUrl = null;
    else if (isHttpsUrl(logo)) out.logoUrl = logo;
    else {
      issues.push(
        "logoUrl must be an absolute https URL of at most 500 characters, without whitespace, control characters or embedded credentials.",
      );
    }
  }
  if (input.backSide !== undefined) {
    if (["none", "logo_pattern"].includes(input.backSide))
      out.backSide = input.backSide;
    else issues.push("backSide must be one of: none, logo_pattern.");
  }
  if (input.options !== undefined) {
    const options = validateOptions(input.options, issues);
    if (options && Object.keys(options).length > 0) out.options = options;
  }
  for (const field of ["headerLines", "footerLines"] as const) {
    if (input[field] === undefined) continue;
    const cleaned = cleanLines(field, input[field]!, issues);
    if (cleaned) out[field] = cleaned;
  }
  if (issues.length > 0) refuse(issues);
  return out;
}

const tick = <T>(value: T): Promise<T> => Promise.resolve(value);

export const mockReceiptTemplates: ReceiptTemplateService = {
  list() {
    return tick(
      rows
        .map(copy)
        .sort(
          (a, b) =>
            SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
            (a.countryPackCode ?? "").localeCompare(b.countryPackCode ?? "") ||
            (a.brandId ?? "").localeCompare(b.brandId ?? "") ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    );
  },

  async create(input: NewReceiptTemplate) {
    const content = validate(input);
    const brandId = input.brandId ?? null;
    const pack = input.countryPackCode ?? null;
    if (pack !== null && !LOADED_PACKS.includes(pack)) {
      refuse(
        `Unknown country pack code "${pack}". Loaded country packs: ${LOADED_PACKS.join(", ")}.`,
      );
    }
    if (
      rows.some(
        (row) => row.brandId === brandId && row.countryPackCode === pack,
      )
    ) {
      throw new ServiceError(
        "CONFLICT",
        "A receipt template already exists for this scope (tenant, brand, country pack). Edit the existing template instead.",
        409,
        "mock",
      );
    }
    assertConsistent({ ...BUILT_IN_DEFAULT, ...content });
    const now = new Date().toISOString();
    counter += 1;
    const row: ReceiptTemplate = {
      ...BUILT_IN_DEFAULT,
      ...content,
      options: optionsOf({ options: content.options }),
      id: `rct_mock_${counter}`,
      brandId,
      countryPackCode: pack,
      scope: scopeOf(brandId, pack),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    rows.push(row);
    return copy(row);
  },

  async update(id, patch) {
    const content = validate(patch);
    if (Object.keys(content).length === 0)
      refuse("Supply at least one template field to change.");
    const row = rows.find((candidate) => candidate.id === id);
    if (!row)
      throw new ServiceError(
        "NOT_FOUND",
        "Receipt template not found.",
        404,
        "mock",
      );
    if (row.version !== patch.version) {
      throw new ServiceError(
        "CONFLICT",
        "This receipt template was changed by someone else since you loaded it. Reload it and re-apply your change.",
        409,
        "mock",
      );
    }
    const next: ReceiptTemplate = {
      ...row,
      ...content,
      options: optionsOf({
        options: { ...optionsOf(row), ...content.options },
      }),
    };
    assertConsistent(next);
    if (sameContent(row, next)) return copy(row);
    Object.assign(row, content, {
      options: next.options,
      version: row.version + 1,
      updatedAt: new Date().toISOString(),
    });
    return copy(row);
  },

  scopeOptions(): Promise<ReceiptScopeOptions> {
    return tick({
      tenantCountryPackCode: TENANT_PACK,
      loadedCountryPackCodes: [...LOADED_PACKS],
    });
  },

  async resolveForBranch(branchId) {
    const branch = branches.find((candidate) => candidate.id === branchId);
    if (!branch)
      throw new ServiceError("NOT_FOUND", "Branch not found.", 404, "mock");
    return resolve(branch.brandId, branchId);
  },

  async forPosBranch() {
    // The demo till has no session-bound branch; the first branch stands in.
    const branch = branches[0];
    return resolve(branch?.brandId ?? "", branch?.id ?? "");
  },
};

/** The same precedence the backend applies: brand+pack, brand, pack, tenant, built-in. */
function resolve(brandId: string, branchId: string): ResolvedReceiptTemplate {
  const tiers: [string | null, string | null, ReceiptTemplateSource][] = [
    [brandId, TENANT_PACK, "brand_country_pack"],
    [brandId, null, "brand"],
    [null, TENANT_PACK, "country_pack"],
    [null, null, "tenant_default"],
  ];
  for (const [brand, pack, source] of tiers) {
    const row = rows.find(
      (candidate) =>
        candidate.brandId === brand && candidate.countryPackCode === pack,
    );
    if (row) {
      return {
        template: contentOf(row),
        source,
        templateId: row.id,
        version: row.version,
        isDefault: false,
        resolvedFor: { branchId, brandId, countryPackCode: TENANT_PACK },
      };
    }
  }
  return {
    template: {
      ...BUILT_IN_DEFAULT,
      headerLines: [],
      footerLines: BUILT_IN_DEFAULT.footerLines.map((line) => ({ ...line })),
    },
    source: "built_in_default",
    templateId: null,
    version: null,
    isDefault: true,
    resolvedFor: { branchId, brandId, countryPackCode: TENANT_PACK },
  };
}
