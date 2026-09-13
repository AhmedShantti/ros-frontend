"use client";

/**
 * Receipt templates — FR-POS-101, FR-POS-102.
 *
 * No template resource exists in `api/openapi.json`; templates are kept here
 * behind the interface a server will take over, and resolved per brand and
 * country by `resolveTemplate` in `lib/console/receipt.ts`. A fresh tenant
 * gets one default so the till always has something to print with.
 */

import type { ReceiptTemplate } from "../receipt";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type CollectionService } from "./types";

export function blankTemplate(input: Partial<ReceiptTemplate> = {}): Omit<ReceiptTemplate, "id"> {
  return {
    name: "Default receipt",
    brandId: null,
    countryCode: null,
    logo: null,
    legalName: { en: "", ar: "" },
    taxRegistration: "",
    header: [],
    footer: [{ en: "Thank you — see you soon", ar: "شكرًا لزيارتكم" }],
    layout: null,
    paperWidth: 80,
    show: {
      orderNumber: true,
      cashier: true,
      table: true,
      modifiers: true,
      taxBreakdown: true,
      customer: false,
      loyalty: false,
    },
    qr: "none",
    active: true,
    updatedAt: nowIso(),
    ...input,
  };
}

const store = localCollection<ReceiptTemplate>(
  {
    name: "receipt-templates",
    idOf: (row) => row.id,
    seed: () => [{ id: "rct_default", ...blankTemplate() }],
    search: (row) => [row.name],
    sorters: { name: (row) => row.name, updatedAt: (row) => row.updatedAt },
    factory: (input, id) => ({ id, ...blankTemplate(input) }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
    guardRemove: (row, all) =>
      !row.brandId && !row.countryCode && all.filter((other) => !other.brandId && !other.countryCode && other.active).length <= 1
        ? "The tenant default cannot be deleted while it is the only one — the till would have nothing to print."
        : null,
  },
  () => getActiveTenantId(),
);

export type ReceiptTemplateService = CollectionService<ReceiptTemplate> & {
  all(): Promise<ReceiptTemplate[]>;
};

export const receiptTemplateService: ReceiptTemplateService = {
  ...store,
  async create(input) {
    const all = await store.all();
    const clash = all.find(
      (row) => row.active && row.brandId === (input.brandId ?? null) && row.countryCode === (input.countryCode ?? null),
    );
    if (clash && input.active !== false) {
      throw new ServiceError(
        "CONFLICT",
        `"${clash.name}" already covers that brand and country. Edit it, or deactivate it first.`,
        409,
      );
    }
    return store.create(input);
  },
};
