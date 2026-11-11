import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteProject, renameProject } from "../../actions";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { formatUsd } from "@/lib/studio/settings";
import { QUESTIONS } from "@/lib/studio/story/questions";
import { loadStory, storyGaps } from "@/lib/studio/story/story";

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

  const s = await loadStory(supabase, id);
  if (!s) notFound();
  const project = s.project;
  const { data: calls } = await supabase.from("studio_ai_calls").select("actual_usd,estimated_usd,status").eq("project_id", id);
  const spent = (calls ?? [])
    .filter((c) => c.status === "done" || c.status === "reserved")
    .reduce((n, c) => n + Number(c.actual_usd ?? c.estimated_usd ?? 0), 0);
  const answered = QUESTIONS.filter((q) => s.answers[q.key]?.answer?.trim()).length;
  const gaps = storyGaps(s);
  const next = !project.idea ? "idea" : !project.logline ? "idea" : "story";

  return (
    <ProjectShell projectId={id} storyGate={s.gate?.state ?? null}>
      <p className="s-muted text-sm font-bold uppercase tracking-wide">
        {project.is_test ? "Test project" : "Project"} · {project.format === "serial" ? "Serial" : "One-off"}
      </p>
      <h1 className="s-head mt-1 text-3xl">{project.title}</h1>
      <p className="s-muted mt-1">Spent so far: {formatUsd(spent)}</p>

      <div className="mt-4">
        <Notice error={error} ok={created ? "Project created. Start with the idea." : saved ? "Saved." : null} />
      </div>

      <div className="s-card mt-4 p-5">
        <h2 className="s-head text-lg">Progress</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>Idea: {project.idea ? "written" : "not yet"}</li>
          <li>Logline: {project.logline ?? "not chosen yet"}</li>
          <li>
            Story questions: {answered} of {QUESTIONS.length} answered
          </li>
          <li>Characters: {s.characters.length}</li>
          <li>
            Story gate:{" "}
            <strong>
              {s.gate?.state === "approved" ? "Approved" : s.gate?.state === "stale" ? "Changed since approval" : `Open (${gaps.length} to do)`}
            </strong>
          </li>
        </ul>
        <Link href={`/studio/projects/${id}/${next}`} className="s-btn s-btn-primary mt-4">
          Continue: {next === "idea" ? "Idea" : "Story builder"}
        </Link>
      </div>

      <div className="s-card mt-6 p-5">
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
            {project.is_test ? "This is a test project. It can never publish to a live series." : "This is a real project."}
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
    </ProjectShell>
  );
}
