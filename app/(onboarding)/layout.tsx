import type { Metadata } from "next";
import { ConsoleProvider, ConsoleRoot } from "@/lib/console/providers";
import { ConsoleThemeScript } from "@/components/console/theme-script";

export const metadata: Metadata = {
  title: "Set up your restaurant — TRENDOW",
  robots: { index: false, follow: false },
};

/**
 * The wizard runs outside the console shell on purpose.
 *
 * A tenant part-way through setup has no branches, no menu and no
 * permissions worth speaking of, so the console's navigation would be a
 * sidebar of dead links. Full width, no chrome, one job.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ConsoleThemeScript />
      <ConsoleProvider>
        <ConsoleRoot className="bg-surface min-h-screen">{children}</ConsoleRoot>
      </ConsoleProvider>
    </>
  );
}
