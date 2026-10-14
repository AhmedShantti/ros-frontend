import { ServiceError } from "./services/types";

/** Whole basis points only: use decimal digits, never floating-point rounding. */
export function percentToBps(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(2))) return undefined;
  const bps = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return bps <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bps) : undefined;
}

export function bpsToPercent(bps: number | null | undefined): string {
  if (bps == null) return "";
  const digits = String(bps).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export interface CountVarianceViolation {
  lineId: string;
  stockItemId: string;
  exceededDimensions: ("value" | "percent")[];
}

/** Validate the exact FR-INV-046 envelope. No threshold evaluation here. */
export function countVarianceViolations(error: ServiceError): CountVarianceViolation[] {
  if (error.status !== 400 || !error.payload || typeof error.payload !== "object") return [];
  const lines = (error.payload as Record<string, unknown>).violatingLines;
  if (!Array.isArray(lines) || lines.length === 0) return [];
  const valid = lines.every((line: unknown) => {
    if (!line || typeof line !== "object") return false;
    const l = line as Record<string, unknown>;
    return typeof l.lineId === "string" && l.lineId.length > 0 &&
      typeof l.stockItemId === "string" && l.stockItemId.length > 0 &&
      Array.isArray(l.exceededDimensions) && l.exceededDimensions.length > 0 &&
      l.exceededDimensions.every((d: unknown) => d === "value" || d === "percent");
  });
  return valid ? lines as CountVarianceViolation[] : [];
}
