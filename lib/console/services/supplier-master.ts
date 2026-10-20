import { api } from "@/lib/api/endpoints";
import { getTenantId } from "@/lib/api/session";
import type * as S from "@/lib/api/schema";
import type { Supplier, SupplierAddress, SupplierContact } from "../types";
import { currencyOf } from "./map";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function mapSupplier(row: S.ProcurementController_getSupplierResponse): Supplier {
  const contacts = row.contacts as unknown as SupplierContact[];
  const primary = contacts.find(c => c.isPrimary) ?? contacts[0];
  const currency = currencyOf(row.currency);
  return {
    id: row.id, tenantId: getTenantId() ?? "", code: row.code,
    legalName: { en: row.legalName, ar: row.legalName },
    tradingName: { en: row.tradingName ?? row.legalName, ar: row.tradingName ?? row.legalName },
    tradingNameValue: row.tradingName, taxRegistration: row.taxRegistrationNumber ?? "", addresses: row.addresses as unknown as SupplierAddress[], contacts,
    contactName: primary?.name ?? "", phone: primary?.phone ?? "", email: primary?.email ?? "",
    paymentTermsDays: row.paymentTermsNetDays, currency, currencyCode: row.currency,
    leadTimeDays: row.deliveryLeadTimeDays, minimumOrderValueMinor: row.minimumOrderValue,
    minimumOrderValue: { amount: Number(row.minimumOrderValue), currency },
    deliveryDays: row.deliveryDays.map(d => DAYS[d]!), active: row.status === "active", scorecardVerified: false,
    scorecard: { onTimeDeliveryRate: 0, fillRate: 0, priceStability: 0, qualityRejectionRate: 0, invoiceAccuracy: 0, averageLeadTimeDays: 0 },
    outstandingBalance: { amount: 0, currency },
  };
}
const name = (v: Supplier["legalName"]) => v.en?.trim() || v.ar?.trim() || "";
export function supplierInput(input: Partial<Supplier>): S.UpdateSupplierDto {
  return {
    ...(input.code !== undefined ? { code: input.code.trim() } : {}),
    ...(input.legalName !== undefined ? { legalName: name(input.legalName) } : {}),
    ...(input.tradingName !== undefined ? { tradingName: name(input.tradingName) || null } : {}),
    ...(input.taxRegistration !== undefined ? { taxRegistrationNumber: input.taxRegistration.trim() || null } : {}),
    ...(input.addresses !== undefined ? { addresses: input.addresses } : {}),
    ...(input.contacts !== undefined ? { contacts: input.contacts } : {}),
    ...(input.paymentTermsDays !== undefined ? { paymentTermsNetDays: input.paymentTermsDays } : {}),
    ...(input.currencyCode !== undefined || input.currency !== undefined ? { currency: input.currencyCode ?? input.currency } : {}),
    ...(input.leadTimeDays !== undefined ? { deliveryLeadTimeDays: input.leadTimeDays } : {}),
    ...(input.minimumOrderValueMinor !== undefined || input.minimumOrderValue !== undefined ? { minimumOrderValue: input.minimumOrderValueMinor ?? String(input.minimumOrderValue!.amount) } : {}),
    ...(input.deliveryDays !== undefined ? { deliveryDays: input.deliveryDays.map(d => DAYS.indexOf(d)).filter(d => d >= 0) } : {}),
  };
}
export async function createSupplier(input: Partial<Supplier>): Promise<Supplier> {
  // Tenant/code uniqueness prevents duplicates even if a successful response is lost.
  const body = supplierInput(input);
  return mapSupplier(await api.procurement.createSupplier({ ...body, tradingName: body.tradingName ?? undefined, taxRegistrationNumber: body.taxRegistrationNumber ?? undefined } as S.CreateSupplierDto));
}
export async function updateSupplier(id: string, input: Partial<Supplier>): Promise<Supplier> {
  // Status is a separate existing authorized operation. Retry is safe; do not create another supplier.
  const body = supplierInput(input);
  let row = Object.keys(body).length ? await api.procurement.updateSupplier(id, body) : await api.procurement.getSupplier(id);
  if (input.active !== undefined && (row.status === "active") !== input.active) {
    row = await api.procurement.setSupplierStatus(id, { status: input.active ? "active" : "inactive" });
  }
  return mapSupplier(row);
}
