import type { Metadata } from "next";
import { ConsoleProvider, ConsoleRoot } from "@/lib/console/providers";
import { ConsoleThemeScript } from "@/components/console/theme-script";

export const metadata: Metadata = {
  title: "Your loyalty balance",
  robots: { index: false, follow: false },
};

/**
 * Customer-facing pages reached without signing in — FR-CRM-022.
 *
 * The console's providers are used only for the dictionary, theme and
 * direction; nothing here reads or requires a session.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConsoleThemeScript />
      <ConsoleProvider>
        <ConsoleRoot className="bg-surface min-h-screen">{children}</ConsoleRoot>
      </ConsoleProvider>
    </>
  );
}
