import type { Metadata } from "next";
import { ConsoleProvider, ConsoleRoot } from "@/lib/console/providers";
import { AuthShell } from "@/components/console/auth-shell";
import { ConsoleThemeScript } from "@/components/console/theme-script";

export const metadata: Metadata = {
  title: "Sign in — TRENDOW",
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ConsoleThemeScript />
      <ConsoleProvider>
        <ConsoleRoot className="bg-surface min-h-screen">
          <AuthShell>{children}</AuthShell>
        </ConsoleRoot>
      </ConsoleProvider>
    </>
  );
}
