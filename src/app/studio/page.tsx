import Link from "next/link";
import { createProject, importMorningBrew } from "./actions";
import { Notice } from "@/components/studio/Notice";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { morningBrewAvailable } from "@/lib/studio/seed/morningBrew";
import { formatUsd } from "@/lib/studio/settings";

// The layout's title template doesn't apply to a page in the same folder, so set it in full.
export const metadata = { title: { absolute: "Projects · Pathtoon Studio" } };

export default async function StudioHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const { supabase } = await requireStudio();
  const { error, deleted } = await searchParams;
  const canImport = morningBrewAvailable();
  const [{ data: projects }, { data: spend }] = await Promise.all([
    supabase.from("studio_projects").select("id,title,format,is_test,created_at").order("created_at", { ascending: false }),
    supabase.from("studio_ai_calls").select("project_id,actual_usd,estimated_usd,status").in("status", ["done", "reserved"]),
  ]);
  const spentBy: Record<string, number> = {};
  for (const r of spend ?? []) {
    if (!r.project_id) continue;
    spentBy[r.project_id] = (spentBy[r.project_id] ?? 0) + Number(r.actual_usd ?? r.estimated_usd ?? 0);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section aria-labelledby="projects-title">
        <h1 id="projects-title" className="s-head text-3xl">
          Projects
        </h1>
        <p className="s-muted mt-1">From a one-line idea to a published scroll comic.</p>
        <div className="mt-4">
          <Notice error={error} ok={deleted ? "Project deleted." : null} />
        </div>

        {(projects ?? []).length === 0 ? (
          <div className="s-card mt-4 p-8 text-center">
            <p className="s-head text-lg">No projects yet</p>
            <p className="s-muted mt-1">Start one on the right.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {projects!.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/studio/projects/${p.id}`}
                  className="s-card block p-5 transition hover:border-[var(--s-magenta)]"
                >
                  <span className="flex items-center gap-2">
                    <span className="s-head text-lg">{p.title}</span>
                    {p.is_test && (
                      <span className="rounded-md bg-[var(--s-cobalt)] px-2 py-0.5 text-xs font-bold text-white">TEST</span>
                    )}
                  </span>
                  <span className="s-muted mt-1 block text-sm">
                    {p.format === "serial" ? "Serial (with votes)" : "One-off"} · spent {formatUsd(spentBy[p.id] ?? 0)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside aria-labelledby="new-title" className="s-card h-fit p-5">
        <h2 id="new-title" className="s-head text-xl">
          New project
        </h2>
        <form action={createProject} className="mt-3 space-y-3">
          <div>
            <label htmlFor="title" className="block font-bold">
              Working title
            </label>
            <input id="title" name="title" required maxLength={120} className="s-input mt-1" placeholder="e.g. Morning Brew" />
          </div>
          <fieldset>
            <legend className="font-bold">Format</legend>
            <label className="mt-1 flex min-h-11 items-center gap-2">
              <input type="radio" name="format" value="serial" defaultChecked className="size-5" /> Serial, readers vote each episode
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="format" value="one_off" className="size-5" /> One-off
            </label>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="is_test" className="size-5" /> Test project (can never publish to a live series)
          </label>
          <SubmitButton pendingText="Creating…" className="w-full">
            Create project
          </SubmitButton>
        </form>
        {canImport && (
          <form className="mt-5 border-t border-[var(--s-line)] pt-4">
            <p className="text-sm">
              <strong>Morning Brew test project.</strong> Imports script v3.5 and the characters from studio-reference on this
              computer, flagged as a test (it can never touch the live series). Only works locally.
            </p>
            <SubmitButton formAction={importMorningBrew} variant="quiet" pendingText="Importing…" className="mt-2 w-full">
              Import Morning Brew (test)
            </SubmitButton>
          </form>
        )}
      </aside>
    </div>
  );
}
