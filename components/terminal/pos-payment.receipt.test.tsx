import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/*
 * FR-POS-101 / FR-POS-102 — the receipt the till shows after payment
 * (`ReceiptSheet`) prints from the branch's template:
 *
 *   - the template comes from `GET /orders/receipt-template`
 *     (`services.receiptTemplates.forPosBranch`), and nothing is drawn until
 *     it has arrived;
 *   - labels print in the TEMPLATE's language(s) — Arabic, English, or both in
 *     the template's order — whatever language the screen itself is in;
 *   - the logo, header lines and footer lines are the template's, and the
 *     footer is no longer hardcoded;
 *   - fiscal content is untouched.
 */

const { forPosBranch } = vi.hoisted(() => ({ forPosBranch: vi.fn() }));

vi.mock("@/lib/console/services", () => ({
  services: {
    receiptTemplates: {
      forPosBranch: (...args: unknown[]) => forPosBranch(...args),
    },
  },
  ServiceError: class ServiceError extends Error {},
}));

let uiLocale: "en" | "ar" = "en";

vi.mock("@/lib/console/providers", async () => {
  const { consoleEn } = await import("@/content/console/en");
  const { consoleAr } = await import("@/content/console/ar");
  return {
    useI18n: () => {
      const dictionary = (uiLocale === "ar" ? consoleAr : consoleEn) as Record<
        string,
        string
      >;
      return {
        t: (key: string) => dictionary[key] ?? key,
        tx: (value: unknown) =>
          typeof value === "string"
            ? value
            : ((value as Record<string, string>)?.[uiLocale] ?? ""),
        locale: uiLocale,
        dir: uiLocale === "ar" ? "rtl" : "ltr",
        fmt: { locale: uiLocale, arabicIndicNumerals: false },
      };
    },
  };
});

vi.mock("@/lib/console/live/store", () => ({
  useLive: () => ({
    state: { settings: { blindCount: false }, orders: {} },
    dispatch: vi.fn(),
  }),
}));

import { ReceiptSheet } from "./pos-payment";
import { ConfirmProvider } from "@/components/console/confirm";
import { completedOrders } from "@/lib/console/mock/sales";
import type { ResolvedReceiptTemplate } from "@/lib/console/receipt";
import { consoleEn } from "@/content/console/en";
import { consoleAr } from "@/content/console/ar";

const consoleEnText = (key: keyof typeof consoleEn) =>
  (consoleEn as Record<string, string>)[key]!;
const consoleArText = (key: keyof typeof consoleEn) =>
  (consoleAr as Record<string, string>)[key]!;

const order = completedOrders.find(
  (candidate) => candidate.payments.length > 0,
)!;

function resolved(
  template: Partial<ResolvedReceiptTemplate["template"]> = {},
): ResolvedReceiptTemplate {
  return {
    template: {
      languageMode: "en",
      bothOrder: "ar_first",
      logoUrl: null,
      headerLines: [],
      footerLines: [],
      ...template,
    },
    source: "tenant_default",
    templateId: "rct_1",
    version: 3,
    isDefault: false,
  };
}

async function renderReceipt() {
  render(
    <ConfirmProvider>
      <ReceiptSheet order={order} onClose={() => undefined} />
    </ConfirmProvider>,
  );
  return screen.findByTestId("receipt");
}

beforeEach(() => {
  uiLocale = "en";
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("POS receipt — printed from the branch's template", () => {
  it("loads the template from the branch's template route before drawing anything", async () => {
    let release: (value: ResolvedReceiptTemplate) => void = () => undefined;
    forPosBranch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(
      <ConfirmProvider>
        <ReceiptSheet order={order} onClose={() => undefined} />
      </ConfirmProvider>,
    );

    expect(forPosBranch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("receipt")).not.toBeInTheDocument();
    // Printing is not offered until the receipt exists.
    expect(
      screen.getByRole("button", { name: consoleEnText("pos.printReceipt") }),
    ).toBeDisabled();

    release(resolved());
    expect(await screen.findByTestId("receipt")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: consoleEnText("pos.printReceipt") }),
    ).toBeEnabled();
  });

  it("does not invent a receipt when the template cannot be loaded", async () => {
    forPosBranch.mockRejectedValue(new Error("Template unavailable"));
    render(
      <ConfirmProvider>
        <ReceiptSheet order={order} onClose={() => undefined} />
      </ConfirmProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("receipt")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/Template unavailable/)).toBeInTheDocument();
  });

  it("prints the template's logo, header lines and footer lines — and no footer of its own", async () => {
    forPosBranch.mockResolvedValue(
      resolved({
        logoUrl: "https://cdn.example.com/logo.png",
        headerLines: [{ en: "Open daily 8am–11pm", ar: "مفتوح يوميًا" }],
        footerLines: [{ en: "See you soon", ar: "نراكم قريبًا" }],
        languageMode: "bilingual",
        bothOrder: "en_first",
      }),
    );
    const receipt = await renderReceipt();

    expect(within(receipt).getByTestId("receipt-logo")).toHaveAttribute(
      "src",
      "https://cdn.example.com/logo.png",
    );
    expect(within(receipt).getByTestId("receipt-header")).toHaveTextContent(
      "Open daily 8am–11pm",
    );
    expect(within(receipt).getByTestId("receipt-header")).toHaveTextContent(
      "مفتوح يوميًا",
    );
    expect(within(receipt).getByTestId("receipt-footer")).toHaveTextContent(
      "See you soon",
    );
    expect(within(receipt).getByTestId("receipt-footer")).toHaveTextContent(
      "نراكم قريبًا",
    );
  });

  it("prints the footer only when the template has one (the old hardcoded thank-you is gone)", async () => {
    forPosBranch.mockResolvedValue(resolved({ footerLines: [] }));
    const receipt = await renderReceipt();
    expect(
      within(receipt).queryByTestId("receipt-footer"),
    ).not.toBeInTheDocument();
    expect(receipt).not.toHaveTextContent(/Thank you|شكرًا لزيارتكم/);
  });

  it("leaves the fiscal registration line exactly as it was", async () => {
    forPosBranch.mockResolvedValue(resolved());
    const receipt = await renderReceipt();
    expect(receipt).toHaveTextContent(/(VAT|TAX) REG 100-238-991/);
  });
});

describe("POS receipt — the language is the template's, not the screen's", () => {
  it("prints English labels on an Arabic screen when the template is English", async () => {
    uiLocale = "ar";
    forPosBranch.mockResolvedValue(resolved({ languageMode: "en" }));
    const receipt = await renderReceipt();

    expect(receipt).toHaveAttribute("data-receipt-languages", "en");
    expect(receipt).toHaveAttribute("dir", "ltr");
    expect(receipt).toHaveTextContent(consoleEnText("pos.subtotal"));
    expect(receipt).not.toHaveTextContent(consoleArText("pos.subtotal"));
    expect(receipt).not.toHaveTextContent(consoleArText("pos.total"));
  });

  it("prints Arabic labels on an English screen when the template is Arabic", async () => {
    uiLocale = "en";
    forPosBranch.mockResolvedValue(resolved({ languageMode: "ar" }));
    const receipt = await renderReceipt();

    expect(receipt).toHaveAttribute("data-receipt-languages", "ar");
    expect(receipt).toHaveAttribute("dir", "rtl");
    expect(receipt).toHaveTextContent(consoleArText("pos.subtotal"));
    expect(receipt).not.toHaveTextContent(consoleEnText("pos.subtotal"));
    expect(receipt).not.toHaveTextContent(consoleEnText("pos.total"));
  });

  it.each([
    ["ar_first", "ar,en", true],
    ["en_first", "en,ar", false],
  ] as const)(
    "prints both languages in the template's order (%s)",
    async (bothOrder, languages, arabicFirst) => {
      uiLocale = "en";
      forPosBranch.mockResolvedValue(
        resolved({ languageMode: "bilingual", bothOrder }),
      );
      const receipt = await renderReceipt();

      expect(receipt).toHaveAttribute("data-receipt-languages", languages);
      const text = receipt.textContent ?? "";
      const ar = text.indexOf(consoleArText("pos.subtotal"));
      const en = text.indexOf(consoleEnText("pos.subtotal"));
      expect(ar).toBeGreaterThanOrEqual(0);
      expect(en).toBeGreaterThanOrEqual(0);
      expect(ar < en).toBe(arabicFirst);
    },
  );

  it("changes nothing when the screen language changes but the template does not", async () => {
    forPosBranch.mockResolvedValue(resolved({ languageMode: "en" }));
    uiLocale = "en";
    const onEnglishScreen = (await renderReceipt()).getAttribute(
      "data-receipt-languages",
    );
    cleanup();
    uiLocale = "ar";
    const onArabicScreen = (await renderReceipt()).getAttribute(
      "data-receipt-languages",
    );
    expect(onArabicScreen).toBe(onEnglishScreen);
  });
});

describe("POS receipt — double-sided", () => {
  const LOGO = "https://cdn.example.com/logo.png";

  it("prints no back page unless the template asks for one", async () => {
    forPosBranch.mockResolvedValue(resolved({ logoUrl: LOGO }));
    await renderReceipt();
    expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument();

    cleanup();
    forPosBranch.mockResolvedValue(
      resolved({ logoUrl: LOGO, backSide: "none" }),
    );
    await renderReceipt();
    expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument();
  });

  it("follows the receipt with the logo repeated over a page of its own", async () => {
    forPosBranch.mockResolvedValue(
      resolved({ logoUrl: LOGO, backSide: "logo_pattern" }),
    );
    const receipt = await renderReceipt();

    const back = screen.getByTestId("receipt-back");
    const logos = within(back).getAllByTestId("receipt-back-logo");
    expect(logos.length).toBeGreaterThan(10);
    for (const logo of logos) expect(logo).toHaveAttribute("src", LOGO);

    // After the receipt, not inside it — and starting a new sheet when printed.
    expect(receipt.contains(back)).toBe(false);
    expect(
      receipt.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("receipt-back-wrap").className).toContain(
      "break-before-page",
    );
    // The on-screen caption is never printed; the receipt itself keeps its logo on the front.
    expect(
      screen.getByText(consoleEnText("rcpt.backCaption")).className,
    ).toContain("print:hidden");
    expect(within(receipt).getByTestId("receipt-logo")).toHaveAttribute(
      "src",
      LOGO,
    );
    expect(back).toHaveAttribute("aria-hidden", "true");
  });

  it("has nothing to repeat without a logo, so it prints no back page", async () => {
    forPosBranch.mockResolvedValue(
      resolved({ logoUrl: null, backSide: "logo_pattern" }),
    );
    await renderReceipt();
    expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument();
  });

  it("drops the whole back page, not a grid of broken icons, when the logo cannot load", async () => {
    forPosBranch.mockResolvedValue(
      resolved({ logoUrl: LOGO, backSide: "logo_pattern" }),
    );
    await renderReceipt();
    fireEvent.error(screen.getAllByTestId("receipt-back-logo")[0]!);
    await waitFor(() =>
      expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument(),
    );
  });

  it("leaves the front exactly as it was: same content with or without a back", async () => {
    forPosBranch.mockResolvedValue(
      resolved({ logoUrl: LOGO, footerLines: [{ en: "See you", ar: "" }] }),
    );
    const without = (await renderReceipt()).textContent;
    cleanup();
    forPosBranch.mockResolvedValue(
      resolved({
        logoUrl: LOGO,
        footerLines: [{ en: "See you", ar: "" }],
        backSide: "logo_pattern",
      }),
    );
    expect((await renderReceipt()).textContent).toBe(without);
  });
});
