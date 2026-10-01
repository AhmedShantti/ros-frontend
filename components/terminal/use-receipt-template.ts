"use client";

import { services } from "@/lib/console/services";
import { useAsync, type AsyncState } from "@/lib/console/hooks";
import type { ResolvedReceiptTemplate } from "@/lib/console/receipt";

/**
 * The receipt template the signed-in POS session's own branch prints with —
 * `GET /orders/receipt-template`. The backend resolves it (brand + country
 * pack, brand, country pack, tenant default, built-in default) from the
 * verified session, so there is nothing to pass and no client-side fallback:
 * a receipt is only drawn from a template the server sent.
 */
export function useReceiptTemplate(enabled = true): AsyncState<ResolvedReceiptTemplate | null> {
  return useAsync<ResolvedReceiptTemplate | null>(
    async () => (enabled ? services.receiptTemplates.forPosBranch() : null),
    [enabled],
  );
}
