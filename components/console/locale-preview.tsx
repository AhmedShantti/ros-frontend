"use client";

/**
 * Paper previews for pack-language documents — FR-LOC-009.
 *
 * Shared by the languages page and the Arabic print test. Lines come from the
 * pure renderers in `lib/console/receipt.ts`; this only paints them at the
 * paper's column width in the language's own font stack.
 */

import type { KitchenTicketInput, ReceiptInput, ReceiptLine, ReceiptTemplate } from "@/lib/console/receipt";
import { blankTemplate } from "@/lib/console/services/receipt-templates";
import { columnsFor } from "@/lib/console/receipt";
import { cx } from "@/components/console/ui";

export const SAMPLE_TEMPLATE: ReceiptTemplate = {
  id: "sample",
  ...blankTemplate({
    name: "Sample",
    legalName: { en: "Cairo Kitchen", ar: "مطبخ القاهرة" },
    taxRegistration: "300000000000003",
    header: [{ en: "26 Talaat Harb St, Cairo", ar: "٢٦ شارع طلعت حرب، القاهرة" }],
    footer: [{ en: "Thank you — see you soon", ar: "شكرًا لزيارتكم" }],
    show: { orderNumber: true, cashier: true, table: true, modifiers: true, taxBreakdown: true, customer: false, loyalty: false },
  }),
};

export const SAMPLE_RECEIPT: ReceiptInput = {
  orderNumber: "A-1042",
  issuedAt: "2026-09-17T13:42:00.000Z",
  cashier: "Mona",
  table: "12",
  customer: null,
  loyaltyPoints: null,
  lines: [
    { quantity: 2, name: { en: "Chicken shawarma", ar: "شاورما دجاج" }, modifiers: [{ en: "Extra garlic", ar: "ثوم إضافي" }], total: "190.00" },
    { quantity: 1, name: { en: "Koshary", ar: "كشري" }, modifiers: [], total: "65.00" },
    { quantity: 3, name: { en: "Mint lemonade", ar: "ليمون بالنعناع" }, modifiers: [], total: "105.00" },
  ],
  subtotal: "360.00",
  taxes: [{ label: { en: "VAT 14%", ar: "ضريبة القيمة المضافة ١٤٪" }, amount: "44.21" }],
  total: "360.00",
  currency: "EGP",
};

export const SAMPLE_TICKET: KitchenTicketInput = {
  orderNumber: "A-1042",
  orderType: "dine_in",
  table: "12",
  guests: 3,
  server: "Mona",
  firedAt: "2026-09-17T13:42:00.000Z",
  kind: "amendment",
  rush: true,
  lines: [
    {
      quantity: 2,
      name: { en: "Chicken shawarma", ar: "شاورما دجاج" },
      names: { ur: "چکن شوارما", hi: "चिकन शावरमा", bn: "চিকেন শর্মা", fr: "Shawarma poulet", tr: "Tavuk döner", tl: "Chicken shawarma" },
      seat: 1,
      course: 1,
      allergy: "sesame",
      modifiers: [
        { kind: "no", text: { en: "onion", ar: "بصل" }, texts: { ur: "پیاز", hi: "प्याज़", bn: "পেঁয়াজ", fr: "oignon", tr: "soğan", tl: "sibuyas" } },
        { kind: "extra", text: { en: "garlic", ar: "ثوم" }, texts: { ur: "لہسن", hi: "लहसुन", bn: "রসুন", fr: "ail", tr: "sarımsak", tl: "bawang" } },
      ],
    },
    { quantity: 1, name: { en: "Koshary", ar: "كشري" }, seat: 2, course: 1, modifiers: [] },
  ],
};

export function PaperPreview({
  lines,
  paperWidth,
  fontStack,
  className,
}: {
  lines: ReceiptLine[];
  paperWidth: 58 | 80;
  fontStack?: string;
  className?: string;
}) {
  const columns = columnsFor(paperWidth);
  return (
    <div
      className={cx("overflow-x-auto rounded-md bg-white px-3 py-3 text-black shadow-sm", className)}
      style={{ width: `calc(${columns}ch + 1.5rem)`, maxWidth: "100%" }}
    >
      <div className="text-[12px] leading-[1.45]" style={{ width: `${columns}ch`, fontFamily: fontStack ?? "ui-monospace, monospace" }}>
        {lines.map((line, index) => {
          if (line.kind === "rule") return <div key={index} className="my-1 border-t border-dashed border-black/60" />;
          if (line.kind !== "text") return null;
          return (
            <div
              key={index}
              dir={line.dir}
              className={cx("whitespace-pre-wrap", line.bold && "font-bold")}
              style={{ textAlign: line.align === "center" ? "center" : line.align === "end" ? "end" : "start" }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
