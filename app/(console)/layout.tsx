import type { Metadata } from "next";
import { ConsoleProvider, ConsoleRoot } from "@/lib/console/providers";
import { ConsoleShell } from "@/components/console/shell";
import { ConsoleThemeScript } from "@/components/console/theme-script";
import { LiveProvider } from "@/lib/console/live/store";

export const metadata: Metadata = {
  title: "TRENDOW — Management Console",
  description:
    "Restaurant operating system: orders, menu and recipes, inventory, purchasing, costing, workforce, finance and governance.",
  robots: { index: false, follow: false },
};

/**
 * Everything behind the sign-in screen. The providers here are the console's
 * own — its dictionary, its theme, and its session — and share nothing with
 * the marketing site's.
 */
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ConsoleThemeScript />
      <ConsoleProvider>
        {/* The same store the terminals write to, so a sale taken on the POS
            is visible here without a round trip. */}
        <LiveProvider>
          <ConsoleRoot className="bg-surface min-h-screen">
            <ConsoleShell>{children}</ConsoleShell>
          </ConsoleRoot>
        </LiveProvider>
      </ConsoleProvider>
    </>
  );
}
