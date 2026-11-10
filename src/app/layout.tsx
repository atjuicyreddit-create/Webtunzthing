import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { SITE_NAME, TAGLINE, siteUrl } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — ${TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: `${SITE_NAME}: ${TAGLINE}. Vertical-scroll comics where the readers decide what happens next. Read free, then comment and vote on the next episode.`,
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8ef" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1713" },
  ],
};

// Runs before the page paints so a saved light/dark choice never flashes.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink"
        >
          Skip to the comic
        </a>
        <Header />
        <main id="main">{children}</main>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
