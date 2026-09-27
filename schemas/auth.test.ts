import { describe, expect, it } from "vitest";
import { signUpSchema } from "./auth";

const valid = {
  fullName: "Nour Ibrahim",
  email: "nour@example.com",
  roleKey: "owner" as const,
  organisation: "Levant Kitchens",
  password: "Restaurant2026",
  confirm: "Restaurant2026",
  employeeCode: "N01",
  pin: "1234",
  acceptedTerms: true,
};

describe("signUpSchema — organisation name", () => {
  it("accepts a name of 3 characters or more", () => {
    expect(signUpSchema.safeParse({ ...valid, organisation: "ABC" }).success).toBe(true);
  });

  it("rejects a name shorter than 3 characters", () => {
    const result = signUpSchema.safeParse({ ...valid, organisation: "AB" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "organisation")).toBe(true);
  });

  it("counts characters after trimming spaces", () => {
    expect(signUpSchema.safeParse({ ...valid, organisation: "  AB  " }).success).toBe(false);
  });
});
