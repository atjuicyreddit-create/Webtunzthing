import { checkClaudeKey, checkKieKey } from "@/lib/studio/ai/aiCall";
import { ownerEmailStatus, requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import { hasSupabaseEnv, supabaseAnonKey, supabaseUrl } from "@/lib/env";

export const metadata = { title: "Health" };

// Each service shows OK, Missing or a problem. Values are NEVER shown, only whether
// they're present and whether the service answers. These checks cost nothing.

type Status = "ok" | "missing" | "problem" | "later";
type Row = { name: string; status: Status; detail: string; stage: string };

const present = (k: string) => Boolean(process.env[k]?.trim());

async function checkAnthropic(model: string | undefined): Promise<Row> {
  const r = await checkClaudeKey(model ?? "claude-haiku-5-5");
  return { name: "Claude (Anthropic API)", stage: "Stage 1", ...r };
}

export default async function HealthPage() {
  const { supabase } = await requireStudio("/studio/health");
  const settings = await getStudioSettings(supabase);
  const ownerStatus = ownerEmailStatus();

  let supabaseOk = false;
  if (hasSupabaseEnv()) {
    try {
      const r = await fetch(`${supabaseUrl()}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey() },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      supabaseOk = r.ok;
    } catch {
      supabaseOk = false;
    }
  }
  const { error: tablesError } = await supabase.from("studio_projects").select("id", { head: true, count: "exact" });
  // Reading bucket details needs extra rights; listing it only needs the admin read rule.
  const { error: bucketError } = await supabase.storage.from("studio").list("", { limit: 1 });
  const bucketOk = !bucketError;

  const rows: Row[] = [
    {
      name: "Supabase (sign-in and database)",
      stage: "Stage 0",
      status: !hasSupabaseEnv() ? "missing" : supabaseOk ? "ok" : "problem",
      detail: !hasSupabaseEnv()
        ? "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set."
        : supabaseOk
          ? "Reachable."
          : "Set, but Supabase didn't answer. Check the project URL.",
    },
    {
      name: "Studio database tables",
      stage: "Stage 0",
      status: tablesError ? "missing" : "ok",
      detail: tablesError ? "Not found. Run supabase/migrations/0005_studio_foundation.sql." : "Installed.",
    },
    {
      name: "Studio settings and cost limits",
      stage: "Stage 0",
      status: settings ? "ok" : "missing",
      detail: settings
        ? `Dry-run ${settings.dry_run ? "on" : "off"}. Daily limit $${settings.session_cap_usd.toFixed(2)}.`
        : "Missing. Run the Stage 0 migration.",
    },
    {
      name: "Private storage bucket “studio”",
      stage: "Stage 0",
      status: bucketOk ? "ok" : "missing",
      detail: bucketOk
        ? "Exists, and you can read it as admin. The migration makes it private."
        : "Not found, or no access. Run the Stage 0 migration.",
    },
    {
      name: "Owner email (ADMIN_EMAIL)",
      stage: "Stage 0",
      status: ownerStatus === "ok" ? "ok" : ownerStatus === "missing" ? "missing" : "problem",
      detail:
        ownerStatus === "ok"
          ? "Set. Only that admin account can open the studio."
          : ownerStatus === "missing"
            ? "Not set, so any admin can open the studio. Set it to your sign-in email."
            : "Set, but it isn't a valid email address, so it's being ignored (any admin can open the studio). Set it to your sign-in email.",
    },
    {
      name: "Site address (NEXT_PUBLIC_SITE_URL)",
      stage: "Stage 0",
      status: present("NEXT_PUBLIC_SITE_URL") ? "ok" : "missing",
      detail: present("NEXT_PUBLIC_SITE_URL") ? "Set." : "Not set. Use http://localhost:3000 locally.",
    },
    await checkAnthropic(settings?.models.small),
    { name: "KIE (image generation)", stage: "Stage 4", ...(await checkKieKey(settings?.kie_usd_per_credit ?? 0.005)) },
    {
      name: "Vercel",
      stage: "Live site",
      status: process.env.VERCEL ? "ok" : "later",
      detail: process.env.VERCEL
        ? `Running on Vercel (${process.env.VERCEL_ENV ?? "unknown"}).`
        : "Running locally. On the live site this shows the Vercel environment.",
    },
    {
      name: "Supabase service key",
      stage: "Not used",
      status: "later",
      detail: present("SUPABASE_SERVICE_ROLE_KEY")
        ? "Set, but the studio doesn't use it. It's safe to remove from Vercel."
        : "Not set. The studio doesn't need it.",
    },
  ];

  const badge: Record<Status, string> = {
    ok: "OK",
    missing: "Missing",
    problem: "Problem",
    later: "Later",
  };
  const badgeClass: Record<Status, string> = {
    ok: "s-active",
    missing: "bg-[var(--s-magenta)] text-white",
    problem: "bg-[var(--s-magenta)] text-white",
    later: "bg-[var(--s-paper)] border border-[var(--s-line)]",
  };

  return (
    <div className="max-w-3xl">
      <h1 className="s-head text-3xl">Health</h1>
      <p className="s-muted mt-1">Is everything connected? Keys are never shown here, only whether they work.</p>
      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <li key={r.name} className="s-card flex items-start gap-4 p-4">
            <span className={`mt-0.5 min-w-20 rounded-md px-2 py-1 text-center text-xs font-bold ${badgeClass[r.status]}`}>
              {badge[r.status]}
            </span>
            <span className="min-w-0">
              <span className="block font-bold">
                {r.name} <span className="s-muted text-xs font-medium">· {r.stage}</span>
              </span>
              <span className="s-muted block text-sm">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
