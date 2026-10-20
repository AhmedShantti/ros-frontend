import { DATA_MODE } from "@/lib/api/config";
import type { PermissionKey } from "./permissions";

/** Match GoodsReceiptsController's existing RequireAnyPermission contract.
 * Demo roles keep their fixture permission; live grants are never fabricated.
 */
export function receivingPermissions(): PermissionKey[] {
  return DATA_MODE === "http"
    ? ["purchase.order.create", "inventory.adjust"]
    : ["purchase.view"];
}
