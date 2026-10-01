import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  DEFAULT_RECEIPT_OPTIONS,
  previewReceiptDocument,
  type ReceiptTemplateContent,
} from "@/lib/console/receipt";
import { ReceiptRenderer } from "./receipt-renderer";

/*
 * FR-POS-101 / FR-POS-102 — the one renderer behind the editor preview and
 * both POS receipts: paper style, which details print, tip and signature
 * lines, and the staggered-logo back page.
 */

const template = (
  patch: Partial<Omit<ReceiptTemplateContent, "options">> & {
    options?: Partial<ReceiptTemplateContent["options"]>;
  } = {},
): ReceiptTemplateContent => ({
  languageMode: "en",
  bothOrder: "ar_first",
  logoUrl: null,
  backSide: "none",
  headerLines: [],
  footerLines: [],
  ...patch,
  options: { ...DEFAULT_RECEIPT_OPTIONS, ...patch.options },
});

const draw = (t: ReceiptTemplateContent) =>
  render(<ReceiptRenderer document={previewReceiptDocument()} template={t} />);

afterEach(cleanup);

describe("ReceiptRenderer", () => {
  it("prints the restaurant, branch and cashier by default", () => {
    draw(template());
    const heading = screen.getByTestId("receipt-heading");
    expect(heading).toHaveTextContent("Your restaurant");
    expect(heading).toHaveTextContent("Downtown branch");
    expect(screen.getByTestId("receipt-meta")).toHaveTextContent("Cashier");
  });

  it("leaves out what the client switched off, and never the totals", () => {
    draw(
      template({
        options: {
          showBrandName: false,
          showBranchName: false,
          showBranchAddress: false,
          showCashier: false,
          showTable: false,
          showGuests: false,
          showOrderType: false,
        },
      }),
    );
    expect(screen.queryByTestId("receipt-heading")).not.toHaveTextContent(
      "Your restaurant",
    );
    expect(screen.getByTestId("receipt-meta")).not.toHaveTextContent("Cashier");
    expect(screen.getByTestId("receipt-totals")).toHaveTextContent("Subtotal");
  });

  it("draws classic and thermal paper differently", () => {
    const { unmount } = draw(template({ options: { paperStyle: "classic" } }));
    const classic = screen.getByTestId("receipt").className;
    expect(screen.getByTestId("receipt-tear")).toBeInTheDocument();
    unmount();
    draw(template({ options: { paperStyle: "thermal" } }));
    expect(screen.getByTestId("receipt").className).not.toBe(classic);
    expect(screen.queryByTestId("receipt-tear")).not.toBeInTheDocument();
  });

  it("prints the suggested tips only when asked", () => {
    const { unmount } = draw(template());
    expect(screen.queryByTestId("receipt-tips")).not.toBeInTheDocument();
    unmount();
    draw(template({ options: { suggestedTips: [10, 15, 20] } }));
    const tips = screen.getByTestId("receipt-tips");
    expect(tips).toHaveTextContent("10%");
    expect(tips).toHaveTextContent("20%");
  });

  it("prints signature lines only when asked", () => {
    const { unmount } = draw(template());
    expect(screen.queryByTestId("receipt-signature")).not.toBeInTheDocument();
    unmount();
    draw(template({ options: { signatureLine: true } }));
    expect(screen.getByTestId("receipt-signature")).toHaveTextContent(
      "Signature",
    );
  });

  it("adds the staggered logo back page only with a logo and the pattern chosen", () => {
    const { unmount } = draw(template({ backSide: "logo_pattern" }));
    expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument();
    unmount();
    draw(
      template({
        backSide: "logo_pattern",
        logoUrl: "https://cdn.example.com/logo.png",
      }),
    );
    const back = screen.getByTestId("receipt-back");
    const logos = within(back).getAllByTestId("receipt-back-logo");
    expect(logos.length).toBeGreaterThan(6);
    expect(screen.getByTestId("receipt-back-wrap").className).toContain(
      "break-before-page",
    );
  });
});
