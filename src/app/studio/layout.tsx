import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Symbol } from "@/components/studio/Symbol";
import { requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import "./studio.css";

const sora = localFont({
  src: "../../fonts/studio/Sora-ExtraBold.ttf",
  weight: "800",
  variable: "--font-sora",
  display: "swap",
});
const unbounded = localFont({
  src: "../../fonts/studio/Unbounded-Bold.ttf",
  weight: "700",
  variable: "--font-unbounded",
  display: "swap",
});
const dmSans = localFont({
  src: [
    { path: "../../fonts/studio/DMSans-Regular.ttf", weight: "400" },
    { path: "../../fonts/studio/DMSans-Medium.ttf", weight: "500" },
    { path: "../../fonts/studio/DMSans-Bold.ttf", weight: "700" },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Studio", template: "%s · Pathtoon Studio" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireStudio();
  const settings = await getStudioSettings(supabase);

  return (
    <div className={`studio min-h-dvh ${sora.variable} ${unbounded.variable} ${dmSans.variable}`}>
      <header className="sticky top-0 z-20 border-b border-[var(--s-line)] bg-[var(--s-ink)] text-white">
        <div className="mx-auto flex min-h-14 max-w-[1400px] flex-wrap items-center justify-between gap-x-3 px-4">
          <Link href="/studio" className="flex min-h-11 items-center gap-2" aria-label="Pathtoon Studio home">
            <Symbol onDark size={30} />
            <span className="s-wordmark text-lg">Pathtoon</span>
            <span className="hidden rounded-md bg-[var(--s-charcoal)] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#9AA0B0] sm:inline">
              Studio
            </span>
          </Link>
          <nav aria-label="Studio" className="-mx-2 flex flex-wrap items-center text-sm font-medium sm:mx-0 sm:gap-1">
            <Link href="/studio" className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--s-charcoal)]">
              Projects
            </Link>
            <Link href="/studio/lessons" className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--s-charcoal)]">
              Lessons
            </Link>
            <Link href="/studio/settings" className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--s-charcoal)]">
              Settings &amp; costs
            </Link>
            <Link href="/studio/health" className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--s-charcoal)]">
              Health
            </Link>
            <Link href="/" className="hidden min-h-11 items-center rounded-lg px-3 text-[#9AA0B0] hover:bg-[var(--s-charcoal)] sm:inline-flex">
              ← Site
            </Link>
          </nav>
        </div>
      </header>

      {settings === null ? (
        <p role="alert" className="bg-[var(--s-magenta)] px-4 py-2 text-center text-sm font-bold text-white">
          The studio database isn&rsquo;t set up yet. Run supabase/migrations/0005_studio_foundation.sql, then reload.
        </p>
      ) : settings.dry_run ? (
        <p className="s-active px-4 py-0.5 text-center text-sm font-bold">
          Dry-run is on: AI calls are logged with an estimate but nothing is charged.{" "}
          <Link href="/studio/settings" className="inline-flex min-h-11 items-center px-1 underline">
            Change
          </Link>
        </p>
      ) : null}

      <main id="main" className="mx-auto max-w-[1400px] px-4 pb-24 pt-6">
        {children}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 text-xs s-muted">
        Signed in as {user.email}
      </footer>
    </div>
  );
}
