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
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-100 focus:rounded-full focus:bg-amber focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
      >
        TRENDOW
      </a>

      <div className="bg-bone flex min-h-screen flex-col">
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </I18nProvider>
  );
}
