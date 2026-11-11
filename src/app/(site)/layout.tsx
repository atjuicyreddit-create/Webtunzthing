import { Header } from "@/components/Header";

// The public site's chrome. /studio sits outside this group and has its own.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink"
      >
        Skip to the comic
      </a>
      <Header />
      <main id="main">{children}</main>
    </>
  );
}
