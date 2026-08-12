import type { Metadata } from "next";
import { Cairo, Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ar } from "@/content/ar";

/**
 * Space Grotesk for headings. It is geometric with a few deliberately
 * odd letterforms, which is what stops a dark technical layout from
 * looking like every other dark technical layout.
 */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

/** Inter for everything read at speed: large x-height, open apertures. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Cairo carries Arabic on every surface — headings included. FR-LOC-011
 * asks for a face chosen for Arabic legibility at small sizes, and Cairo
 * holds its counters at the sizes a receipt and a kitchen ticket use.
 */
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cairo",
  display: "swap",
});

/** Mono stays: requirement tags and money columns need to line up. */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: ar.meta.title,
  description: ar.meta.description,
};

export const viewport = {
  themeColor: "#0a0e14",
};

/**
 * The root layout owns only the document shell and the fonts. Each route
 * group — (marketing), (auth), (console) — supplies its own providers,
 * because the marketing site and the management console have separate
 * dictionaries, themes, and chrome.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${grotesk.variable} ${inter.variable} ${cairo.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
