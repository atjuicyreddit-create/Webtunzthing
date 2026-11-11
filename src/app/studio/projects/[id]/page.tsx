import { notFound } from "next/navigation";
import { deleteProject, renameProject } from "../../actions";
import { Notice } from "@/components/studio/Notice";
import { Stepper } from "@/components/studio/Stepper";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { formatUsd } from "@/lib/studio/settings";

export const metadata = { title: "Project" };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; created?: string }>;
}) {
  const { id } = await params;
  const { error, saved, created } = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}`);

  const { data: project } = await supabase.from("studio_projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const { data: calls } = await supabase
    .from("studio_ai_calls")
    .select("actual_usd,estimated_usd,status")
    .eq("project_id", id);
  const spent = (calls ?? [])
    .filter((c) => c.status === "done" || c.status === "reserved")
    .reduce((n, c) => n + Number(c.actual_usd ?? c.estimated_usd ?? 0), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr_300px]">
      <aside className="s-card h-fit p-3">
        <Stepper />
      </aside>

      <section aria-labelledby="project-title" className="min-w-0">
        <p className="s-muted text-sm font-bold uppercase tracking-wide">
          {project.is_test ? "Test project" : "Project"} · {project.format === "serial" ? "Serial" : "One-off"}
        </p>
        <h1 id="project-title" className="s-head mt-1 text-3xl">
          {project.title}
        </h1>
        <p className="s-muted mt-1">Spent so far: {formatUsd(spent)}</p>

        <div className="mt-4">
          <Notice
            error={error}
            ok={created ? "Project created. The story builder arrives in stage 1." : saved ? "Saved." : null}
          />
        </div>

        <div className="s-card mt-4 p-5">
          <h2 className="s-head text-lg">Details</h2>
          <form action={renameProject} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={project.id} />
            <div>
              <label htmlFor="title" className="block font-bold">
                Title
              </label>
              <input id="title" name="title" required maxLength={120} defaultValue={project.title} className="s-input mt-1" />
            </div>
            <fieldset>
              <legend className="font-bold">Format</legend>
              <label className="mt-1 flex min-h-11 items-center gap-2">
                <input type="radio" name="format" value="serial" defaultChecked={project.format === "serial"} className="size-5" />
                Serial, readers vote each episode
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="format" value="one_off" defaultChecked={project.format === "one_off"} className="size-5" />
                One-off
              </label>
            </fieldset>
            <p className="s-muted text-sm">
              {project.is_test
                ? "This is a test project. It can never publish to a live series."
                : "This is a real project."}
            </p>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        </div>

        <form action={deleteProject} className="s-card mt-6 p-5">
          <input type="hidden" name="id" value={project.id} />
          <h2 className="s-head text-lg">Delete project</h2>
          <p className="s-muted mt-1 text-sm">
            Removes the project and everything in it. Its cost history is kept. Type <strong>delete</strong> to confirm.
          </p>
          <label htmlFor="confirm" className="sr-only">
            Type delete to confirm
          </label>
          <input id="confirm" name="confirm" autoComplete="off" autoCapitalize="none" className="s-input mt-2" />
          <SubmitButton variant="quiet" pendingText="Deleting…" className="mt-3">
            Delete project
          </SubmitButton>
        </form>
      </section>

      <aside aria-labelledby="claude-title" className="s-card h-fit p-5">
        <h2 id="claude-title" className="s-head text-lg">
          Claude
        </h2>
        <p className="s-muted mt-2 text-sm">
          Suggestions and comments appear here once the story builder is built (stage 1). Every suggestion shows its
          cost before it runs.
        </p>
      </aside>
    </div>
  );
}
