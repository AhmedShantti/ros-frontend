import type { Metadata } from "next";
import { ConsoleProvider, ConsoleRoot } from "@/lib/console/providers";
import { ConsoleThemeScript } from "@/components/console/theme-script";
import { LiveProvider } from "@/lib/console/live/store";

export const metadata: Metadata = {
  title: "TRENDOW — Terminal",
  description: "Point of sale and kitchen display.",
  robots: { index: false, follow: false },
};

/**
 * The terminals.
 *
 * Separate from `(console)` because a POS is not a dashboard: no sidebar, no
 * breadcrumbs, no page chrome competing with the menu grid. It shares the
 * console's dictionary and theme, and adds the live store that the console
 * reads from too.
 */
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConsoleThemeScript />
      <ConsoleProvider>
        <LiveProvider>
          <ConsoleRoot className="bg-surface flex h-dvh flex-col overflow-hidden">
            {children}
          </ConsoleRoot>
        </LiveProvider>
      </ConsoleProvider>
    </>
  );
}
