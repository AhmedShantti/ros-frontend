import type { Metadata } from "next";
import {
  Alumni_Sans,
  Cairo,
  DM_Mono,
  Figtree,
  Inter,
  JetBrains_Mono,
  Noto_Kufi_Arabic,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import { ar } from "@/content/ar";

/* ------------------------------------------------------------------
   The marketing site's four faces.

   Alumni Sans is the display voice — condensed, heavy, and set in caps
   with the leading crushed below 1. It is the loudest decision in the
   design and everything else is chosen to stay out of its way.
   ------------------------------------------------------------------ */
const alumni = Alumni_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-alumni",
  display: "swap",
  // next/font otherwise synthesises an "Alumni Sans Fallback" family — a
  // metric-adjusted local Arial — and inserts it directly after the real
  // one. Arial has full Arabic coverage, so on the Arabic build it caught
  // every Arabic glyph before the stack ever reached Noto Kufi, and the
  // whole Arabic site rendered in Arial. Turning the shim off lets the
  // font stack route by script the way it is written.
  adjustFontFallback: false,
});

/** Figtree reads at speed under the display face: open, neutral, quiet. */
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-figtree",
  display: "swap",
});

/** DM Mono is the label voice — step numbers, spec ids, eyebrows. */
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dmmono",
  display: "swap",
});

/**
 * Noto Kufi Arabic carries display, body and label in Arabic.
 *
 * It is not a fallback for Alumni Sans, it is the Arabic answer to the
 * same brief. Alumni Sans has no Arabic glyphs at all; Arabic has no
 * uppercase to set; and an Arabic face that is condensed hard enough to
 * match Alumni Sans stops being readable, because the script carries its
 * meaning in the connections between letters rather than in their
 * width. Noto Kufi keeps what actually reads as the brand here — the
 * weight, the density, the flat geometric build — and drops the two
 * tricks that do not survive the crossing.
 */
const kufi = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-kufi",
  display: "swap",
  // Same reason, mirrored: with the shim on, Noto Kufi's Arial fallback
  // would catch the Latin in the Arabic build — the wordmark, the spec
  // ids — before the stack reached Alumni Sans.
  adjustFontFallback: false,
});

/* ------------------------------------------------------------------
   The console's four faces.

   Unchanged. The management console, the auth screens and the terminals
   are a different surface with a different job, and the industrial
   re-skin deliberately stops at the marketing site's edge.

   They opt out of preloading: every one of these routes sits behind a
   login, while the marketing site is the public front door, and eight
   preload hints on a landing page is seven too many.
   ------------------------------------------------------------------ */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
  preload: false,
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cairo",
  display: "swap",
  preload: false,
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: ar.meta.title,
  description: ar.meta.description,
};

export const viewport = {
  themeColor: "#1b1a18",
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
      className={`${alumni.variable} ${figtree.variable} ${dmMono.variable} ${kufi.variable} ${grotesk.variable} ${inter.variable} ${cairo.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
