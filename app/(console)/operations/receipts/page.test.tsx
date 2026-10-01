import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-POS-101 / FR-POS-102 — the receipt template editor.
 *
 * The page is real, including its own `Gate`. It talks to
 * `services.receiptTemplates`, which here is the in-memory implementation
 * that applies the backend's rules (400 messages, 409 on a stale version or a
 * taken scope, precedence on resolve) — so a test exercises the page's
 * behaviour against a faithful server, and the spies below record exactly
 * what the page sent. The http implementation has its own test.
 */

const { update, create, list, refuseNext } = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  /** When set, the next create is refused with this message, as a backend 400 would be. */
  refuseNext: { message: null as string | null },
}));

vi.mock("@/lib/console/services", async () => {
  const { mockReceiptTemplates } =
    await import("@/lib/console/mock/receipt-templates");
  const { brands } = await import("@/lib/console/mock/org");
  const { ServiceError } = await import("@/lib/console/services/types");
  return {
    ServiceError,
    services: {
      receiptTemplates: {
        ...mockReceiptTemplates,
        list: (...args: []) => {
          list(...args);
          return mockReceiptTemplates.list();
        },
        create: (input: Parameters<typeof mockReceiptTemplates.create>[0]) => {
          create(input);
          if (refuseNext.message) {
            const message = refuseNext.message;
            refuseNext.message = null;
            return Promise.reject(
              new ServiceError("BAD_REQUEST", message, 400),
            );
          }
          return mockReceiptTemplates.create(input);
        },
        update: (
          id: string,
          patch: Parameters<typeof mockReceiptTemplates.update>[1],
        ) => {
          update(id, patch);
          return mockReceiptTemplates.update(id, patch);
        },
      },
      organisation: {
        brands: { list: async () => ({ rows: brands, total: brands.length }) },
      },
    },
  };
});

let granted = new Set(["settings.tenant.read", "settings.tenant.manage"]);

vi.mock("@/lib/console/providers", async () => {
  const { consoleEn } = await import("@/content/console/en");
  const { branches } = await import("@/lib/console/mock/org");
  return {
    useI18n: () => ({
      t: (key: keyof typeof consoleEn) => consoleEn[key] ?? key,
      tx: (value: unknown) =>
        typeof value === "string"
          ? value
          : ((value as { en?: string })?.en ?? ""),
      locale: "en",
      dir: "ltr",
      fmt: { locale: "en", arabicIndicNumerals: false },
    }),
    useSession: () => ({
      scope: { tenantId: "t1", brandId: null, branchId: null },
      branch: null,
      availableBranches: branches,
      can: (permission: string) => granted.has(permission),
      canAny: (list: string[]) =>
        list.length === 0 || list.some((p) => granted.has(p)),
    }),
    usePermission: (permission: string) => granted.has(permission),
  };
});

import ReceiptTemplatesPage from "./page";
import {
  mockReceiptTemplates,
  resetMockReceiptTemplates,
} from "@/lib/console/mock/receipt-templates";
import { branches, brands } from "@/lib/console/mock/org";

beforeEach(() => {
  granted = new Set(["settings.tenant.read", "settings.tenant.manage"]);
  resetMockReceiptTemplates();
  vi.clearAllMocks();
});
afterEach(cleanup);

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label));
  await user.click(
    within(await screen.findByRole("listbox")).getByRole("option", {
      name: option,
    }),
  );
}

const preview = () => screen.getByTestId("rcpt-preview");
const printed = () => within(preview()).getByTestId("receipt");

describe("Receipt template editor", () => {
  it("loads the templates from the service and labels them by scope, not by name", async () => {
    await mockReceiptTemplates.create({
      countryPackCode: "EG",
      languageMode: "en",
    });
    await mockReceiptTemplates.create({
      brandId: brands[0]!.id,
      languageMode: "ar",
    });

    render(<ReceiptTemplatesPage />);

    const listing = await screen.findByTestId("rcpt-list");
    expect(list).toHaveBeenCalled();
    expect(within(listing).getByText("Country pack: EG")).toBeInTheDocument();
    expect(
      within(listing).getByText(`Brand: ${brands[0]!.name.en}`),
    ).toBeInTheDocument();
    // No name field and none of the retired settings exist.
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deactivate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tax registration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/QR/)).not.toBeInTheDocument();
  });

  it("says so when there are no templates yet", async () => {
    render(<ReceiptTemplatesPage />);
    expect(await screen.findByText(/No templates yet/)).toBeInTheDocument();
  });

  it("creates a template with the tenant's country pack preselected, and the brand chosen from the brand list", async () => {
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: /New template/ }),
    );

    // Country pack defaults to the tenant's own; the choices are the loaded packs.
    const options = await mockReceiptTemplates.scopeOptions();
    const packButton = await screen.findByLabelText("Country pack");
    expect(packButton).toHaveTextContent(options.tenantCountryPackCode);
    await user.click(packButton);
    const packs = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((node) => node.textContent);
    expect(packs).toEqual([
      "All country packs",
      ...options.loadedCountryPackCodes,
    ]);
    await user.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: options.tenantCountryPackCode,
      }),
    );

    // Brands come from the organisation's brand list.
    await user.click(screen.getByLabelText("Brand"));
    const brandNames = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((node) => node.textContent);
    expect(brandNames).toEqual([
      "All brands",
      ...brands.map((brand) => brand.name.en),
    ]);
    await user.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: brands[0]!.name.en,
      }),
    );

    await user.click(screen.getByRole("radio", { name: "English" }));
    await user.click(screen.getByRole("button", { name: /Create template/ }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: brands[0]!.id,
        countryPackCode: options.tenantCountryPackCode,
        languageMode: "en",
      }),
    );
    // The retired fields are never sent.
    expect(Object.keys(create.mock.calls[0]![0]).sort()).toEqual(
      [
        "backSide",
        "bothOrder",
        "brandId",
        "countryPackCode",
        "footerLines",
        "headerLines",
        "languageMode",
        "logoUrl",
        "options",
      ].sort(),
    );
    expect(await screen.findByText("Template created.")).toBeInTheDocument();
    expect(
      await within(await screen.findByTestId("rcpt-list")).findByText(
        `${brands[0]!.name.en} · ${options.tenantCountryPackCode}`,
      ),
    ).toBeInTheDocument();
  });

  it("can create a template for any loaded country pack or for all packs", async () => {
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: /New template/ }),
    );
    await screen.findByLabelText("Country pack");
    await pick(user, "Country pack", "All country packs");
    await user.click(screen.getByRole("button", { name: /Create template/ }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      brandId: null,
      countryPackCode: null,
    });
    expect(
      await within(await screen.findByTestId("rcpt-list")).findByText(
        "Default for all brands and countries",
      ),
    ).toBeInTheDocument();
  });

  it("shows the backend's message when the scope already has a template", async () => {
    await mockReceiptTemplates.create({ countryPackCode: "EG" });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: /New template/ }),
    );
    await screen.findByLabelText("Country pack");
    await user.click(screen.getByRole("button", { name: /Create template/ }));

    expect(await screen.findByTestId("rcpt-error")).toHaveTextContent(
      /already exists for this scope/,
    );
  });

  it("updates a template, sending the version it read and only what changed", async () => {
    const stored = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      languageMode: "en",
    });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));

    // The scope is fixed — there is no brand or country pack control on an existing template.
    expect(screen.queryByLabelText("Country pack")).not.toBeInTheDocument();
    expect(
      screen.getByText(/scope is fixed after creation/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Arabic" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(stored.id, {
      version: 1,
      languageMode: "ar",
    });
    expect(await screen.findByText("Template saved.")).toBeInTheDocument();
    // Reloaded from the service: the new version is what is listed.
    expect(await screen.findByText(/Version 2/)).toBeInTheDocument();
  });

  it("does not offer to save when nothing changed", async () => {
    await mockReceiptTemplates.create({ countryPackCode: "EG" });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));
    expect(
      await screen.findByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
  });

  it("on a 409 tells the user the template changed and reloads it", async () => {
    const stored = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      footerLines: [{ en: "Original", ar: "الأصل" }],
    });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));
    await screen.findByDisplayValue("Original");

    // Someone else saves first.
    await mockReceiptTemplates.update(stored.id, {
      version: 1,
      footerLines: [{ en: "Changed elsewhere", ar: "تغيّر" }],
    });

    await user.click(screen.getByRole("radio", { name: "English" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(stored.id, {
        version: 1,
        languageMode: "en",
      }),
    );
    expect(await screen.findByTestId("rcpt-conflict")).toHaveTextContent(
      /changed by someone else/,
    );
    // The editor now shows the server's copy, not the stale draft.
    expect(
      await screen.findByDisplayValue("Changed elsewhere"),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Original")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Arabic and English" }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: "Arabic on top" })).toBeChecked();
  });

  describe("header and footer", () => {
    async function openNew() {
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await user.click(
        await screen.findByRole("button", { name: /New template/ }),
      );
      await screen.findByTestId("rcpt-editor");
      return user;
    }

    it("allows at most four lines per section", async () => {
      const user = await openNew();
      const header = screen.getByTestId("rcpt-header-lines");
      const add = within(header).getByRole("button", { name: "Add line" });
      for (let i = 0; i < 4; i += 1) await user.click(add);
      expect(within(header).getAllByRole("textbox")).toHaveLength(8);
      expect(add).toBeDisabled();
      // The footer has its own allowance.
      expect(
        within(screen.getByTestId("rcpt-footer-lines")).getByRole("button", {
          name: "Add line",
        }),
      ).toBeEnabled();
    });

    it("rejects a line over 120 characters and an empty line before anything is sent", async () => {
      const user = await openNew();
      const header = screen.getByTestId("rcpt-header-lines");
      await user.click(
        within(header).getByRole("button", { name: "Add line" }),
      );
      expect(await screen.findByTestId("rcpt-issues")).toHaveTextContent(
        "Header lines, line 1: enter text in at least one language.",
      );

      const english = within(header).getByLabelText(
        /Header lines 1 — English text/,
      );
      await user.click(english);
      await user.paste("x".repeat(121));
      expect(screen.getByTestId("rcpt-issues")).toHaveTextContent(
        "Header lines, line 1: at most 120 characters.",
      );
      expect(
        screen.getByRole("button", { name: /Create template/ }),
      ).toBeDisabled();

      await user.clear(english);
      await user.type(english, "x".repeat(120));
      expect(screen.queryByTestId("rcpt-issues")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Create template/ }),
      ).toBeEnabled();
      expect(create).not.toHaveBeenCalled();
    });

    it("only accepts an https logo link", async () => {
      const user = await openNew();
      await user.type(
        screen.getByLabelText("Logo URL"),
        "http://example.com/logo.png",
      );
      expect(screen.getByTestId("rcpt-issues")).toHaveTextContent(
        "The logo must be an https:// link.",
      );
      expect(
        screen.getByRole("button", { name: /Create template/ }),
      ).toBeDisabled();
      await user.clear(screen.getByLabelText("Logo URL"));
      await user.type(
        screen.getByLabelText("Logo URL"),
        "https://example.com/logo.png",
      );
      expect(screen.queryByTestId("rcpt-issues")).not.toBeInTheDocument();
    });

    it("shows the backend's own 400 message when it refuses what the page let through", async () => {
      const user = await openNew();
      // A control character passes the page's check; the backend's rule catches it.
      const refusal =
        "footerLines[0].en must not contain control or line-break characters. · footerLines[0].ar must be at most 120 characters.";
      refuseNext.message = refusal;
      const footer = screen.getByTestId("rcpt-footer-lines");
      await user.click(
        within(footer).getByRole("button", { name: "Add line" }),
      );
      await user.type(
        within(footer).getByLabelText(/Footer lines 1 — English text/),
        "Thanks",
      );
      await user.click(screen.getByRole("button", { name: /Create template/ }));

      // Shown verbatim, nothing was created, and the draft is still there to fix.
      expect(await screen.findByTestId("rcpt-error")).toHaveTextContent(
        refusal,
      );
      expect(await mockReceiptTemplates.list()).toHaveLength(0);
      expect(screen.getByDisplayValue("Thanks")).toBeInTheDocument();
    });
  });

  describe("preview", () => {
    async function openNew() {
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await user.click(
        await screen.findByRole("button", { name: /New template/ }),
      );
      await screen.findByTestId("rcpt-preview");
      return user;
    }

    it("prints Arabic only", async () => {
      const user = await openNew();
      await user.click(screen.getByRole("radio", { name: "Arabic" }));
      expect(printed()).toHaveAttribute("data-receipt-languages", "ar");
      expect(printed()).toHaveAttribute("dir", "rtl");
      expect(printed()).toHaveTextContent("المجموع الفرعي");
      expect(printed()).not.toHaveTextContent("Subtotal");
    });

    it("prints English only", async () => {
      const user = await openNew();
      await user.click(screen.getByRole("radio", { name: "English" }));
      expect(printed()).toHaveAttribute("data-receipt-languages", "en");
      expect(printed()).toHaveAttribute("dir", "ltr");
      expect(printed()).toHaveTextContent("Subtotal");
      expect(printed()).not.toHaveTextContent("المجموع الفرعي");
    });

    it("prints bilingual, Arabic first", async () => {
      const user = await openNew();
      await user.click(screen.getByRole("radio", { name: "Arabic and English" }));
      await user.click(screen.getByRole("radio", { name: "Arabic on top" }));
      expect(printed()).toHaveAttribute("data-receipt-languages", "ar,en");
      const text = printed().textContent ?? "";
      expect(text.indexOf("المجموع الفرعي")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("المجموع الفرعي")).toBeLessThan(
        text.indexOf("Subtotal"),
      );
    });

    it("prints bilingual, English first", async () => {
      const user = await openNew();
      await user.click(screen.getByRole("radio", { name: "Arabic and English" }));
      await user.click(screen.getByRole("radio", { name: "English on top" }));
      expect(printed()).toHaveAttribute("data-receipt-languages", "en,ar");
      const text = printed().textContent ?? "";
      expect(text.indexOf("Subtotal")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Subtotal")).toBeLessThan(
        text.indexOf("المجموع الفرعي"),
      );
    });

    it("follows the header and footer lines as they are typed, and is labelled as a sample", async () => {
      const user = await openNew();
      expect(
        screen.getByText("Sample data — this is not a real receipt."),
      ).toBeInTheDocument();
      await user.click(
        within(screen.getByTestId("rcpt-header-lines")).getByRole("button", {
          name: "Add line",
        }),
      );
      await user.type(
        screen.getByLabelText(/Header lines 1 — English text/),
        "Open daily",
      );
      await user.type(
        screen.getByLabelText(/Header lines 1 — Arabic text/),
        "مفتوح يوميًا",
      );
      expect(within(printed()).getByTestId("receipt-header")).toHaveTextContent(
        "Open daily",
      );
      expect(within(printed()).getByTestId("receipt-header")).toHaveTextContent(
        "مفتوح يوميًا",
      );
    });

    it("draws its own ink on the paper, so it stays readable in the dark theme", async () => {
      const user = await openNew();
      expect(printed().style.getPropertyValue("--color-fg")).toBe("#1d1d1b");
      await user.click(screen.getByRole("radio", { name: "Thermal roll" }));
      expect(printed().style.getPropertyValue("--color-fg")).toBe("#111111");
      expect(printed().style.getPropertyValue("--color-fg-muted")).not.toBe("");
    });

    it("draws 58 mm and 80 mm paper, and never saves the width", async () => {
      const user = await openNew();
      const narrow = printed().style.width;
      await user.click(screen.getByRole("radio", { name: "58 mm" }));
      const at58 = printed().style.width;
      await user.click(screen.getByRole("radio", { name: "80 mm" }));
      const at80 = printed().style.width;
      expect(at58).not.toBe(at80);
      expect(narrow).toBe(at80);
      expect(
        screen.getByText("Preview only — the width is not saved."),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: "58 mm" }));
      await user.click(screen.getByRole("button", { name: /Create template/ }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(create.mock.calls[0]![0])).not.toMatch(
        /paperWidth|"width"|58/,
      );
    });
  });

  describe("options", () => {
    async function openNew() {
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await user.click(
        await screen.findByRole("button", { name: /New template/ }),
      );
      await screen.findByTestId("rcpt-preview");
      return user;
    }

    it("says plainly that demo mode does not save", async () => {
      render(<ReceiptTemplatesPage />);
      expect(await screen.findByTestId("rcpt-demo-mode")).toHaveTextContent(
        /lost on refresh/,
      );
    });

    it("hides a detail from the preview when its switch is turned off", async () => {
      const user = await openNew();
      expect(printed()).toHaveTextContent("Cashier");
      await user.click(screen.getByRole("switch", { name: "Cashier name" }));
      expect(printed()).not.toHaveTextContent("Cashier");
      await user.click(screen.getByRole("switch", { name: "Cashier name" }));
      expect(printed()).toHaveTextContent("Cashier");
    });

    it("prints the signature lines when switched on, and has no tip choice", async () => {
      const user = await openNew();
      expect(screen.queryByText("Suggested tips")).not.toBeInTheDocument();
      await user.click(screen.getByRole("switch", { name: "Signature line" }));
      expect(printed()).toHaveTextContent("Signature");
    });

    it("saves only the option that changed", async () => {
      const stored = await mockReceiptTemplates.create({
        countryPackCode: "EG",
        languageMode: "en",
      });
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await user.click(await screen.findByText("Country pack: EG"));
      await user.click(await screen.findByRole("switch", { name: "Table" }));
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith(stored.id, {
          version: 1,
          options: { showTable: false },
        }),
      );
    });
  });

  describe("which template a branch uses", () => {
    it("shows the source, the template and its version for the chosen branch", async () => {
      const brandTemplate = await mockReceiptTemplates.create({
        brandId: branches[0]!.brandId,
        languageMode: "en",
      });
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await screen.findByTestId("rcpt-list");

      await pick(user, "Branch", branches[0]!.name.en);
      const panel = await screen.findByTestId("rcpt-resolved");
      expect(await within(panel).findByText(/Version 1/)).toBeInTheDocument();
      expect(within(panel).getByText("English")).toBeInTheDocument();
      expect(
        (await mockReceiptTemplates.resolveForBranch(branches[0]!.id))
          .templateId,
      ).toBe(brandTemplate.id);
    });

    it("names the built-in default when nothing matches", async () => {
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      await screen.findByText(/No templates yet/);
      await pick(user, "Branch", branches[0]!.name.en);
      expect(
        await within(await screen.findByTestId("rcpt-resolved")).findByText(
          "Built-in default",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("permissions", () => {
    it("is not shown without settings.tenant.read or settings.tenant.manage", () => {
      granted = new Set(["settings.branch.read"]);
      render(<ReceiptTemplatesPage />);
      expect(screen.queryByTestId("rcpt-list")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New template/ }),
      ).not.toBeInTheDocument();
    });

    it("lets a reader view a template but not change it", async () => {
      await mockReceiptTemplates.create({
        countryPackCode: "EG",
        footerLines: [{ en: "Thanks", ar: "شكرا" }],
      });
      granted = new Set(["settings.tenant.read"]);
      const user = userEvent.setup();
      render(<ReceiptTemplatesPage />);
      expect(
        screen.queryByRole("button", { name: /New template/ }),
      ).not.toBeInTheDocument();
      await user.click(await screen.findByText("Country pack: EG"));

      expect(await screen.findByDisplayValue("Thanks")).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add line" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("You can view templates but not change them."),
      ).toBeInTheDocument();
    });
  });
});

describe("Receipt template editor — double-sided receipt", () => {
  const LOGO = "https://cdn.example.com/logo.png";

  it("offers a blank back or the logo repeated, defaulting to blank, and previews no back page until a logo is set", async () => {
    await mockReceiptTemplates.create({ countryPackCode: "EG" });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));

    expect(screen.getByRole("radio", { name: "Blank" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Logo repeated over the page" }),
    ).not.toBeChecked();
    expect(
      within(preview()).queryByTestId("receipt-back"),
    ).not.toBeInTheDocument();
  });

  it("refuses to save a repeated-logo back with no logo, and says why", async () => {
    await mockReceiptTemplates.create({ countryPackCode: "EG" });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));

    await user.click(
      screen.getByRole("radio", { name: "Logo repeated over the page" }),
    );
    expect(await screen.findByTestId("rcpt-issues")).toHaveTextContent(
      /needs a logo URL/,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });

  it("previews the tiled back page once there is a logo, and saves only the back side", async () => {
    const stored = await mockReceiptTemplates.create({
      countryPackCode: "EG",
      logoUrl: LOGO,
    });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));

    await user.click(
      screen.getByRole("radio", { name: "Logo repeated over the page" }),
    );
    const back = within(preview()).getByTestId("receipt-back");
    expect(
      within(back).getAllByTestId("receipt-back-logo").length,
    ).toBeGreaterThan(10);
    expect(
      within(preview()).getAllByTestId("receipt-back-logo")[0],
    ).toHaveAttribute("src", LOGO);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(stored.id, {
      version: 1,
      backSide: "logo_pattern",
    });
    expect((await mockReceiptTemplates.list())[0]!.backSide).toBe(
      "logo_pattern",
    );
  });

  it("clearing the logo while the pattern is on is caught before anything is sent", async () => {
    await mockReceiptTemplates.create({
      countryPackCode: "EG",
      logoUrl: LOGO,
      backSide: "logo_pattern",
    });
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(await screen.findByText("Country pack: EG"));
    expect(within(preview()).getByTestId("receipt-back")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Logo URL"));
    expect(await screen.findByTestId("rcpt-issues")).toHaveTextContent(
      /needs a logo URL/,
    );
    expect(
      within(preview()).queryByTestId("receipt-back"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // Setting the back to Blank makes clearing the logo a valid edit.
    await user.click(screen.getByRole("radio", { name: "Blank" }));
    expect(screen.queryByTestId("rcpt-issues")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).toEqual({
      version: 1,
      logoUrl: null,
      backSide: "none",
    });
  });

  it("creates a template with the back side chosen", async () => {
    const user = userEvent.setup();
    render(<ReceiptTemplatesPage />);
    await user.click(
      await screen.findByRole("button", { name: /New template/ }),
    );
    await user.type(await screen.findByLabelText("Logo URL"), LOGO);
    await user.click(
      screen.getByRole("radio", { name: "Logo repeated over the page" }),
    );
    await user.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      logoUrl: LOGO,
      backSide: "logo_pattern",
    });
  });
});
