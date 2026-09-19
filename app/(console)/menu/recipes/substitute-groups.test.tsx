import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * FRONTEND-REAL-UX-BATCH-1A — `SubstituteGroups` gated its create/add-member
 * UI on `usePermission("recipe.manage")`, a permission code that does not
 * exist in the backend (`production.permissions.ts` defines exactly
 * recipe.view/edit/publish; substitute-group writes are documented as
 * falling under `recipe.edit`). No role could ever hold `recipe.manage`, so
 * this UI was permanently disabled regardless of real authorization. This
 * proves a real `recipe.edit` holder now sees it, and a session without it
 * still does not.
 */

const substituteGroups = vi.fn();
const itemsList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    production: {
      substituteGroups: (...args: unknown[]) => substituteGroups(...args),
    },
    inventory: {
      items: { list: (...args: unknown[]) => itemsList(...args) },
    },
  },
}));

let granted = new Set<string>();

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  usePermission: (perm: string) => granted.has(perm),
}));

import { SubstituteGroups } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set(["recipe.edit"]);
  substituteGroups.mockResolvedValue([{ id: "sg-1", name: "Cooking oils", memberIds: [] }]);
  itemsList.mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("Recipes — SubstituteGroups: recipe.manage -> recipe.edit", () => {
  it("shows the create/add-member controls for a real recipe.edit holder", async () => {
    render(<SubstituteGroups onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: "common.new" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.add" })).toBeInTheDocument();
  });

  it("hides them for a session without recipe.edit — the old recipe.manage bug never granted this to anyone real, so this must still be gated", async () => {
    granted = new Set(["recipe.view"]);
    render(<SubstituteGroups onChanged={() => {}} />);
    await waitFor(() => expect(substituteGroups).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.add" })).not.toBeInTheDocument();
  });
});
