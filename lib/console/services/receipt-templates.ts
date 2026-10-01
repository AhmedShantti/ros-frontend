/**
 * Receipt templates over HTTP — FR-POS-101 / FR-POS-102.
 *
 * `services.receiptTemplates` when `DATA_MODE === "http"`. Every call reaches
 * the backend; nothing is cached in the browser and there is no local
 * fallback — a template a person edits is the one the till prints, so it
 * lives on the server. (The in-memory demo implementation is in
 * `../mock/receipt-templates.ts`, and only `mock.ts` imports it.)
 *
 * Errors pass through as the `ServiceError` the transport already builds: a
 * 400 keeps the backend's own sentence(s) — joined with " · " when there are
 * several — and a 409 is `CONFLICT` (a duplicate scope on create, a stale
 * version on update).
 */

import { api } from "@/lib/api/endpoints";
import type * as S from "@/lib/api/schema";
import type {
  ReceiptBackSide,
  ReceiptOptions,
  ReceiptScopeOptions,
  ReceiptTemplate,
  ReceiptTemplateContent,
  ResolvedReceiptTemplate,
} from "../receipt";
import type { ReceiptTemplateService } from "./types";

type WireLines = { en: string; ar: string }[];
type WireContent = {
  languageMode: ReceiptTemplateContent["languageMode"];
  bothOrder: ReceiptTemplateContent["bothOrder"];
  logoUrl: string | null;
  backSide: ReceiptBackSide;
  options: ReceiptOptions;
  headerLines: WireLines;
  footerLines: WireLines;
};

const lines = (rows: WireLines): { en: string; ar: string }[] =>
  rows.map((row) => ({ en: row.en, ar: row.ar }));

function toContent(wire: WireContent): ReceiptTemplateContent {
  return {
    languageMode: wire.languageMode,
    bothOrder: wire.bothOrder,
    logoUrl: wire.logoUrl,
    backSide: wire.backSide,
    options: {
      ...wire.options,
      suggestedTips: [...wire.options.suggestedTips],
    },
    headerLines: lines(wire.headerLines),
    footerLines: lines(wire.footerLines),
  };
}

export function toReceiptTemplate(
  wire: S.ReceiptTemplatesController_getResponse,
): ReceiptTemplate {
  return {
    ...toContent(wire),
    id: wire.id,
    brandId: wire.brandId,
    countryPackCode: wire.countryPackCode,
    scope: wire.scope,
    version: wire.version,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toResolved(
  wire:
    | S.OrdersController_receiptTemplateResponse
    | S.ReceiptTemplatesController_resolveResponse,
): ResolvedReceiptTemplate {
  const resolved: ResolvedReceiptTemplate = {
    template: toContent(wire.template),
    source: wire.source,
    templateId: wire.templateId,
    version: wire.version,
    isDefault: wire.isDefault,
  };
  if ("resolvedFor" in wire && wire.resolvedFor) {
    resolved.resolvedFor = {
      branchId: wire.resolvedFor.branchId,
      brandId: wire.resolvedFor.brandId,
      countryPackCode: wire.resolvedFor.countryPackCode,
    };
  }
  return resolved;
}

const toLines = (rows: { en: string; ar: string }[] | undefined) =>
  rows?.map((row) => ({ en: row.en, ar: row.ar }));

export const httpReceiptTemplates: ReceiptTemplateService = {
  async list() {
    const response = await api.sales.listReceiptTemplates();
    return response.items.map(toReceiptTemplate);
  },

  async create(input) {
    const row = await api.sales.createReceiptTemplates({
      brandId: input.brandId ?? null,
      countryPackCode: input.countryPackCode ?? null,
      // Only what was chosen: an omitted field takes the backend's default.
      ...(input.languageMode !== undefined
        ? { languageMode: input.languageMode }
        : {}),
      ...(input.bothOrder !== undefined ? { bothOrder: input.bothOrder } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.backSide !== undefined ? { backSide: input.backSide } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.headerLines !== undefined
        ? { headerLines: toLines(input.headerLines) }
        : {}),
      ...(input.footerLines !== undefined
        ? { footerLines: toLines(input.footerLines) }
        : {}),
    });
    return toReceiptTemplate(row);
  },

  async update(id, patch) {
    const row = await api.sales.update(id, {
      version: patch.version,
      ...(patch.languageMode !== undefined
        ? { languageMode: patch.languageMode }
        : {}),
      ...(patch.bothOrder !== undefined ? { bothOrder: patch.bothOrder } : {}),
      ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
      ...(patch.backSide !== undefined ? { backSide: patch.backSide } : {}),
      ...(patch.options !== undefined ? { options: patch.options } : {}),
      ...(patch.headerLines !== undefined
        ? { headerLines: toLines(patch.headerLines) }
        : {}),
      ...(patch.footerLines !== undefined
        ? { footerLines: toLines(patch.footerLines) }
        : {}),
    });
    return toReceiptTemplate(row);
  },

  async scopeOptions(): Promise<ReceiptScopeOptions> {
    const row = await api.sales.scopeOptions();
    return {
      tenantCountryPackCode: row.tenantCountryPackCode,
      loadedCountryPackCodes: [...row.loadedCountryPackCodes],
    };
  },

  async resolveForBranch(branchId) {
    return toResolved(await api.sales.resolveReceiptTemplates({ branchId }));
  },

  async forPosBranch() {
    return toResolved(await api.sales.receiptTemplate());
  },
};
