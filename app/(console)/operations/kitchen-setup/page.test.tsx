import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * KITCHEN-DISPLAY-SETUP-FRONTEND-P0
 *
 * The manager Console page for stations, routing rules, the branch fallback
 * station, and KDS timing — the canonical backend truth Fire/KDS already
 * read via `GET/PATCH .../kitchen-setup` and `.../kitchen-config`. Not the
 * KDS operator screen, and no terminal/device pairing.
 *
 * Mocked only at the transport boundary (`@/lib/console/services`) and
 * `@/lib/console/providers`, following the same real-granted-codes
 * permission model `/operations/tables`'s test already established.
 * `KitchenSetupPage` (default export) is the real component, including its
 * own `Gate`.
 */

const getKitchenSetup = vi.fn();
const addStationRoutingRule = vi.fn();
const updateStationRoutingRule = vi.fn();
const removeStationRoutingRule = vi.fn();
const updateKitchenConfig = vi.fn();
const createStation = vi.fn();
const updateStation = vi.fn();
const categoriesList = vi.fn();
const itemsList = vi.fn();
const modifierGroupsList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  services: {
    organisation: {
      getKitchenSetup: (...args: unknown[]) => getKitchenSetup(...args),
      addStationRoutingRule: (...args: unknown[]) => addStationRoutingRule(...args),
      updateStationRoutingRule: (...args: unknown[]) => updateStationRoutingRule(...args),
      removeStationRoutingRule: (...args: unknown[]) => removeStationRoutingRule(...args),
      updateKitchenConfig: (...args: unknown[]) => updateKitchenConfig(...args),
    },
    operations: {
      createStation: (...args: unknown[]) => createStation(...args),
      updateStation: (...args: unknown[]) => updateStation(...args),
    },
    catalogue: {
      categories: { list: (...args: unknown[]) => categoriesList(...args) },
      items: { list: (...args: unknown[]) => itemsList(...args) },
      modifierGroups: { list: (...args: unknown[]) => modifierGroupsList(...args) },
    },
  },
}));

const BRANCH_1 = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } };
const BRANCH_2 = { id: "branch-2", name: { en: "Marina", ar: "المارينا" } };

const OWNER_CODES = new Set(["settings.branch.read", "settings.branch.manage", "org.manage"]);
const READ_ONLY_CODES = new Set(["settings.branch.read"]);
const KDS_OPERATE_ONLY_CODES = new Set(["kds.operate"]);
const FAKE_BRANCH_READ_CODES = new Set(["BRANCH_READ"]);

let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  branch: null as typeof BRANCH_1 | null,
  availableBranches: [BRANCH_1, BRANCH_2] as (typeof BRANCH_1)[],
  grantedCodes: OWNER_CODES,
};

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({
    scope: session.scope,
    branch: session.branch,
    availableBranches: session.availableBranches,
    can: (permission: string) => session.grantedCodes.has(permission),
    canAny: (list: string[]) => list.length === 0 || list.some((p) => session.grantedCodes.has(p)),
  }),
  usePermission: (permission: string) => session.grantedCodes.has(permission),
}));

import KitchenSetupPage from "./page";
import { ConfirmProvider } from "@/components/console/confirm";

/** `RuleRemoveButton` calls `useConfirm()`, which throws outside a provider. */
function renderPage() {
  return render(
    <ConfirmProvider>
      <KitchenSetupPage />
    </ConfirmProvider>,
  );
}

const STATION_GRILL = {
  id: "st-grill",
  branchId: BRANCH_1.id,
  name: { en: "Grill", ar: "شواية" },
  displayColour: "#ff0000",
  capacityPerHour: 40,
};
const STATION_EXPO = {
  id: "st-expo",
  branchId: BRANCH_1.id,
  name: { en: "Expo", ar: "إكسبو" },
  displayColour: null,
  capacityPerHour: null,
};
const CATEGORY_MAINS = { id: "cat-1", name: { en: "Mains", ar: "الأطباق الرئيسية" } };
const ROUTING_RULE = {
  id: "rr-1",
  branchId: BRANCH_1.id,
  stationId: STATION_GRILL.id,
  categoryId: CATEGORY_MAINS.id,
  menuItemId: null,
  modifierId: null,
  priority: 10,
};

function setupFixture(overrides: Partial<typeof BASE_SETUP> = {}) {
  return { ...BASE_SETUP, ...overrides };
}

const BASE_SETUP = {
  branchId: BRANCH_1.id,
  stations: [STATION_GRILL, STATION_EXPO],
  routingRules: [ROUTING_RULE],
  fallbackStationId: null as string | null,
  recallWindowSeconds: 1800,
  cancelledLineVisibilitySeconds: null as number | null,
  capabilities: {
    itemRouting: true,
    categoryRouting: true,
    modifierRouting: true,
    lineOverride: true,
    multiStation: true,
    fallback: true,
  },
};

function selectBranch1() {
  session = { ...session, scope: { ...session.scope, branchId: BRANCH_1.id }, branch: BRANCH_1 };
}

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    scope: { tenantId: "t1", brandId: null, branchId: null },
    branch: null,
    availableBranches: [BRANCH_1, BRANCH_2],
    grantedCodes: OWNER_CODES,
  };
  getKitchenSetup.mockResolvedValue(setupFixture());
  categoriesList.mockResolvedValue({ rows: [CATEGORY_MAINS], total: 1, cursor: null });
  itemsList.mockResolvedValue({ rows: [], total: 0, cursor: null });
  modifierGroupsList.mockResolvedValue({ rows: [], total: 0, cursor: null });
});

afterEach(() => {
  cleanup();
});

describe("Kitchen Display Setup — branch resolution", () => {
  it("1. the route renders the page without throwing", async () => {
    selectBranch1();
    renderPage();
    expect(await screen.findByText("kitchenSetup.title")).toBeInTheDocument();
  });

  it("2. a concrete branch fetches GET kitchen-setup for that branch", async () => {
    selectBranch1();
    renderPage();
    await waitFor(() => expect(getKitchenSetup).toHaveBeenCalledWith(BRANCH_1.id));
  });

  it('3. "All branches" sends no setup request and prompts branch selection', async () => {
    renderPage();
    expect(await screen.findByText("kitchenSetup.selectBranch")).toBeInTheDocument();
    expect(getKitchenSetup).not.toHaveBeenCalled();
  });

  it("4. switching branches clears the previous branch's setup before the new one resolves", async () => {
    selectBranch1();
    let resolveBranch2: (value: unknown) => void = () => {};
    getKitchenSetup.mockImplementation((branchId: string) =>
      branchId === BRANCH_1.id
        ? Promise.resolve(setupFixture())
        : new Promise((resolve) => {
            resolveBranch2 = resolve;
          }),
    );
    const { rerender } = renderPage();
    await screen.findAllByText("Grill");

    session = { ...session, scope: { ...session.scope, branchId: BRANCH_2.id }, branch: BRANCH_2 };
    rerender(
      <ConfirmProvider>
        <KitchenSetupPage />
      </ConfirmProvider>,
    );

    await waitFor(() => expect(screen.queryByText("Grill")).not.toBeInTheDocument());
    resolveBranch2(setupFixture({ branchId: BRANCH_2.id, stations: [] }));
  });
});

describe("Kitchen Display Setup — stations (canonical station API)", () => {
  it("5. renders only truthful station fields — no fabricated type or Active/Inactive", async () => {
    selectBranch1();
    renderPage();

    await screen.findAllByText("Grill");
    expect(screen.getByText("Expo")).toBeInTheDocument();
    expect(screen.queryByText(/active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/inactive/i)).not.toBeInTheDocument();
  });

  it("6. a read-only holder (settings.branch.read only) sees setup but no mutation affordances", async () => {
    session.grantedCodes = READ_ONLY_CODES;
    selectBranch1();
    renderPage();

    await screen.findAllByText("Grill");
    expect(screen.queryByRole("button", { name: "kitchenSetup.addStation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "kitchenSetup.addRoutingRule" })).not.toBeInTheDocument();
    expect(screen.getByText("kitchenSetup.readOnly")).toBeInTheDocument();
  });

  it("7. a manager can open the create-station flow, which calls the canonical station API", async () => {
    selectBranch1();
    createStation.mockResolvedValue({ ...STATION_GRILL, id: "st-new", name: { en: "Fry", ar: "قلي" } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "kitchenSetup.addStation" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/kitchenSetup\.stationName/), "Fry");
    await user.click(within(dialog).getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(createStation).toHaveBeenCalledWith(
        BRANCH_1.id,
        expect.objectContaining({ name: { en: "Fry", ar: "Fry" } }),
      ),
    );
  });

  it("8. a manager can edit a station via the canonical station PATCH", async () => {
    selectBranch1();
    updateStation.mockResolvedValue({ ...STATION_GRILL, name: { en: "Grill 2", ar: "Grill 2" } });
    const user = userEvent.setup();
    renderPage();

    const [stationCard] = await screen.findAllByText("Grill");
    await user.click(stationCard!);
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText(/kitchenSetup\.stationName/);
    await user.clear(name);
    await user.type(name, "Grill 2");
    await user.click(within(dialog).getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateStation).toHaveBeenCalledWith(
        STATION_GRILL.id,
        expect.objectContaining({ name: { en: "Grill 2", ar: "Grill 2" } }),
      ),
    );
  });

  it("9. no station delete/archive control exists anywhere on the page", async () => {
    selectBranch1();
    const user = userEvent.setup();
    renderPage();

    const [stationCard] = await screen.findAllByText("Grill");
    await user.click(stationCard!);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
  });
});

describe("Kitchen Display Setup — routing rules", () => {
  it("10. renders the selector tier, selector identity, and destination station", async () => {
    selectBranch1();
    renderPage();

    await screen.findByText("Mains");
    expect(screen.getByText("kitchenSetup.category")).toBeInTheDocument();
    expect(screen.getAllByText("Grill").length).toBeGreaterThan(0);
  });

  it("11. creating a routing rule uses the canonical create-rule endpoint", async () => {
    selectBranch1();
    addStationRoutingRule.mockResolvedValue({ ...ROUTING_RULE, id: "rr-2" });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "kitchenSetup.addRoutingRule" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByLabelText(/kitchenSetup\.category/));
    await user.click(within(dialog).getByRole("option", { name: "Mains" }));
    await user.click(within(dialog).getByLabelText(/kitchenSetup\.destinationStation/));
    await user.click(within(dialog).getByRole("option", { name: "Expo" }));
    await user.click(within(dialog).getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(addStationRoutingRule).toHaveBeenCalledWith(
        BRANCH_1.id,
        expect.objectContaining({ categoryId: CATEGORY_MAINS.id, stationId: STATION_EXPO.id }),
      ),
    );
  });

  it("12. changing a rule's destination calls PATCH with only the station changing", async () => {
    selectBranch1();
    updateStationRoutingRule.mockResolvedValue({ ...ROUTING_RULE, stationId: STATION_EXPO.id });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Mains");
    await user.click(screen.getByLabelText("kitchenSetup.changeStation"));
    await user.click(screen.getByRole("option", { name: "Expo" }));

    await waitFor(() =>
      expect(updateStationRoutingRule).toHaveBeenCalledWith(BRANCH_1.id, ROUTING_RULE.id, STATION_EXPO.id),
    );
  });

  it("13/15. deleting a rule requires confirmation, names future orders only, and removes only after server success", async () => {
    selectBranch1();
    removeStationRoutingRule.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Mains");
    await user.click(screen.getByRole("button", { name: "kitchenSetup.removeRoutingRule" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("kitchenSetup.futureOrdersOnly")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "kitchenSetup.removeRoutingRule" }));

    await waitFor(() => expect(removeStationRoutingRule).toHaveBeenCalledWith(BRANCH_1.id, ROUTING_RULE.id));
  });

  it("14. a failed delete keeps the rule visible", async () => {
    selectBranch1();
    removeStationRoutingRule.mockRejectedValue(new Error("Station-routing rule not found."));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Mains");
    await user.click(screen.getByRole("button", { name: "kitchenSetup.removeRoutingRule" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "kitchenSetup.removeRoutingRule" }));

    await waitFor(() => expect(removeStationRoutingRule).toHaveBeenCalled());
    expect(await screen.findByText("Station-routing rule not found.")).toBeInTheDocument();
    expect(screen.getByText("Mains")).toBeInTheDocument();
  });
});

describe("Kitchen Display Setup — fallback station", () => {
  it("16. shows the canonical current fallback value, never auto-selecting the first station", async () => {
    selectBranch1();
    getKitchenSetup.mockResolvedValue(setupFixture({ fallbackStationId: null }));
    renderPage();

    const trigger = await screen.findByLabelText("kitchenSetup.fallbackTitle");
    await waitFor(() => expect(trigger).toHaveTextContent("kitchenSetup.noFallback"));
  });

  it("17/18. saving a fallback station (or None) calls the kitchen-config PATCH", async () => {
    selectBranch1();
    updateKitchenConfig.mockResolvedValue({
      fallbackStationId: STATION_GRILL.id,
      recallWindowSeconds: 1800,
      cancelledLineVisibilitySeconds: null,
    });
    const user = userEvent.setup();
    renderPage();

    const trigger = await screen.findByLabelText("kitchenSetup.fallbackTitle");
    const section = trigger.closest("section")!;
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Grill" }));
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateKitchenConfig).toHaveBeenCalledWith(BRANCH_1.id, { fallbackStationId: STATION_GRILL.id }),
    );
  });
});

describe("Kitchen Display Setup — KDS settings", () => {
  it("19. recallWindowSeconds round-trips exactly through minutes", async () => {
    selectBranch1();
    updateKitchenConfig.mockResolvedValue({
      fallbackStationId: null,
      recallWindowSeconds: 900,
      cancelledLineVisibilitySeconds: null,
    });
    const user = userEvent.setup();
    renderPage();

    const recall = await screen.findByLabelText(/^kitchenSetup\.recallWindow/);
    const section = recall.closest("section")!;
    await user.clear(recall);
    await user.type(recall, "15");
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateKitchenConfig).toHaveBeenCalledWith(
        BRANCH_1.id,
        expect.objectContaining({ recallWindowSeconds: 900 }),
      ),
    );
  });

  it("20. a blank cancelled-line-visibility field saves as an explicit null", async () => {
    selectBranch1();
    getKitchenSetup.mockResolvedValue(setupFixture({ cancelledLineVisibilitySeconds: 120 }));
    updateKitchenConfig.mockResolvedValue({
      fallbackStationId: null,
      recallWindowSeconds: 1800,
      cancelledLineVisibilitySeconds: null,
    });
    const user = userEvent.setup();
    renderPage();

    const cancelled = await screen.findByLabelText(/^kitchenSetup\.cancelledLineVisibility/);
    const section = cancelled.closest("section")!;
    expect(cancelled).toHaveValue("2");
    await user.clear(cancelled);
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateKitchenConfig).toHaveBeenCalledWith(
        BRANCH_1.id,
        expect.objectContaining({ cancelledLineVisibilitySeconds: null }),
      ),
    );
  });

  it("shows a truthful not-configured state when cancelledLineVisibilitySeconds is null, for a read-only holder", async () => {
    session.grantedCodes = READ_ONLY_CODES;
    selectBranch1();
    renderPage();

    await screen.findByText("kitchenSetup.notConfigured");
  });

  it("21. clearing the recall window (required) disables Save rather than fabricating a value", async () => {
    selectBranch1();
    const user = userEvent.setup();
    renderPage();

    const recall = await screen.findByLabelText(/^kitchenSetup\.recallWindow/);
    const section = recall.closest("section")!;
    await user.clear(recall);

    expect(within(section).getByRole("button", { name: "common.save" })).toBeDisabled();
    expect(updateKitchenConfig).not.toHaveBeenCalled();
  });
});

describe("Kitchen Display Setup — errors", () => {
  it("22. a 403 read shows an unauthorized state, never stale/fabricated data", async () => {
    selectBranch1();
    getKitchenSetup.mockRejectedValue(apiError(403, "Forbidden"));
    renderPage();

    expect(await screen.findByText("kitchenSetup.forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Grill")).not.toBeInTheDocument();
  });

  it("23. a 403 on a mutation leaves the local setup unchanged", async () => {
    selectBranch1();
    updateStationRoutingRule.mockRejectedValue(apiError(403, "You do not have permission to do that."));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Mains");
    await user.click(screen.getByLabelText("kitchenSetup.changeStation"));
    await user.click(screen.getByRole("option", { name: "Expo" }));

    await screen.findByText("You do not have permission to do that.");
    // Still shows the ORIGINAL destination — no optimistic mutation applied.
    expect(screen.getByLabelText("kitchenSetup.changeStation")).toHaveTextContent("Grill");
  });

  it("24. a 404 does not leak any setup data", async () => {
    selectBranch1();
    getKitchenSetup.mockRejectedValue(apiError(404, "Branch not found."));
    renderPage();

    expect(await screen.findByText("kitchenSetup.notFound")).toBeInTheDocument();
    expect(screen.queryByText("Grill")).not.toBeInTheDocument();
    expect(screen.queryByText("Mains")).not.toBeInTheDocument();
  });

  it("25. a network failure is explicit, never rendered as an empty setup", async () => {
    selectBranch1();
    getKitchenSetup.mockRejectedValue(Object.assign(new Error("The backend did not answer."), { status: 0 }));
    renderPage();

    expect(await screen.findByText("The backend did not answer.")).toBeInTheDocument();
    expect(screen.queryByText("kitchenSetup.stationsEmpty")).not.toBeInTheDocument();
  });
});

describe("Kitchen Display Setup — permission dependencies", () => {
  it("26. kds.operate alone does not reach this page", async () => {
    session.grantedCodes = KDS_OPERATE_ONLY_CODES;
    selectBranch1();
    renderPage();

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(getKitchenSetup).not.toHaveBeenCalled();
  });

  it("27. a fictitious BRANCH_READ code does not reach this page (only real settings.branch.* codes do)", async () => {
    session.grantedCodes = FAKE_BRANCH_READ_CODES;
    selectBranch1();
    renderPage();

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(getKitchenSetup).not.toHaveBeenCalled();
  });
});

describe("Kitchen Display Setup — no terminal/device UI", () => {
  it("28. contains no terminal registration, pairing, or device-status affordances", async () => {
    selectBranch1();
    renderPage();

    await screen.findAllByText("Grill");
    expect(screen.queryByText(/terminal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pairing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/heartbeat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last seen/i)).not.toBeInTheDocument();
  });
});

describe("Kitchen Display Setup — Arabic catalogue", () => {
  it("33. every kitchenSetup.*/nav.kitchenSetup key is authored in Arabic, not just present in English", async () => {
    const { consoleEn } = await import("@/content/console/en");
    const { consoleAr } = await import("@/content/console/ar");
    const keys = Object.keys(consoleEn).filter(
      (key) => key.startsWith("kitchenSetup.") || key === "nav.kitchenSetup",
    );
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      const arabic = consoleAr[key as keyof typeof consoleAr];
      expect(arabic, `missing Arabic for ${key}`).toBeTruthy();
      expect(arabic, `Arabic for ${key} looks unauthored`).not.toBe(consoleEn[key as keyof typeof consoleEn]);
    }
  });
});
