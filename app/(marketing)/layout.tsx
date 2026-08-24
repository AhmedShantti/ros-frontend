import { I18nProvider } from "@/lib/i18n";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      {/* A skip link is the cheapest accessibility win on a long site. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-100 focus:bg-amber focus:px-4 focus:py-2 focus:text-sm focus:text-void"
      >
        TRENDOW
      </a>

      {/*
        `site-shell` is the boundary of the industrial design system.
        globals.css scopes the whole re-skin to this class — the fonts,
        the squared corners, the display voice, the scroll devices — so
        that the console, the auth screens and the terminals, which are
        wrapped in `ros-console` instead, never inherit any of it.
      */}
      <div className="site-shell bg-bone flex min-h-screen flex-col">
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </I18nProvider>
  );
}
