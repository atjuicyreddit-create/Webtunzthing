import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin";
import { hasSupabaseEnv, supabaseAnonKey, supabaseUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Setup check", robots: { index: false } };
export const dynamic = "force-dynamic";

// A friendly "is everything plugged in?" page. It shows a tick or cross for each
// setting and NEVER shows the values themselves. Admin-only, since Stage 3.

type Row = { label: string; ok: boolean; hint: string; optional?: boolean };

const present = (name: string) => Boolean(process.env[name]?.trim());

async function checkSupabase(): Promise<{ reachable: boolean; schema: boolean; seeded: boolean }> {
  if (!hasSupabaseEnv()) return { reachable: false, schema: false, seeded: false };
  try {
    const health = await fetch(`${supabaseUrl()}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const reachable = health.ok;
    if (!reachable) return { reachable, schema: false, seeded: false };

    const supabase = await createClient();
    const { count, error } = await supabase
      .from("series")
      .select("id", { count: "exact", head: true });
    return { reachable, schema: !error, seeded: !error && (count ?? 0) > 0 };
  } catch {
    return { reachable: false, schema: false, seeded: false };
  }
}

export default async function SetupPage() {
  // Demo mode has no admin to check, so the page stays open there to help set up.
  if (hasSupabaseEnv()) await requireAdmin("/setup");
  const sb = await checkSupabase();

  const rows: Row[] = [
    {
      label: "Supabase URL and anon key are set",
      ok: hasSupabaseEnv(),
      hint: "Put NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
    },
    {
      label: "Supabase answers (URL and key are correct)",
      ok: sb.reachable,
      hint: "Check you copied the Project URL and the anon public key from Project Settings > API, with no spaces or quotes.",
    },
    {
      label: "Database tables exist",
      ok: sb.schema,
      hint: "Run supabase/migrations/0001_init.sql in the Supabase SQL Editor.",
    },
    {
      label: "Morning Brew is seeded",
      ok: sb.seeded,
      hint: "Run supabase/seed.sql in the Supabase SQL Editor.",
    },
    {
      label: "Service role key is set (server only)",
      ok: present("SUPABASE_SERVICE_ROLE_KEY"),
      hint: "Not used yet. If you add it, never prefix it with NEXT_PUBLIC_.",
      optional: true,
    },
    {
      label: "Site address is set",
      ok: present("NEXT_PUBLIC_SITE_URL"),
      hint: "http://localhost:3000 locally; your Vercel address once deployed.",
    },
    {
      label: "Admin email is set",
      ok: present("ADMIN_EMAIL"),
      hint: "Optional. Admin rights come from profiles.role in Supabase (see the README).",
      optional: true,
    },
    {
      label: "Anthropic API key is set (server only)",
      ok: present("ANTHROPIC_API_KEY"),
      hint: "Only needed for the Stage 4 story builder.",
      optional: true,
    },
  ];

  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-10">
      <h1 className="text-3xl font-extrabold">Setup check</h1>
      <p className="mt-2 text-muted">
        A tick means it&rsquo;s working. Values are never shown on this page.
      </p>

      <ul className="mt-6 space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="rounded-2xl border-2 border-line bg-surface p-4">
            <p className="flex items-start gap-3 font-bold">
              <span aria-hidden="true" className="text-xl leading-none">
                {row.ok ? "✅" : row.optional ? "➖" : "❌"}
              </span>
              <span>
                {row.label}
                <span className="sr-only">{row.ok ? " — yes" : " — not yet"}</span>
                {row.optional && !row.ok && (
                  <span className="ml-2 text-sm font-semibold text-muted">(not needed yet)</span>
                )}
              </span>
            </p>
            {!row.ok && <p className="mt-1 pl-9 text-sm text-muted">{row.hint}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
