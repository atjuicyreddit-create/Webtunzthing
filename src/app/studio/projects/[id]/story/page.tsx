import Link from "next/link";
import { notFound } from "next/navigation";
import { CardsStep, OneLineStep, WhyStep } from "./steps-a";
import { ApproveStep, CharactersStep, PlotStep } from "./steps-b";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell } from "@/components/studio/ProjectShell";
import { requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import { QUESTIONS, QUESTION_KEYS, STORY_STEPS, type QuestionKey, type StoryStep } from "@/lib/studio/story/questions";
import { estimateStoryAction } from "@/lib/studio/story/run";
import { loadStory, storyGaps } from "@/lib/studio/story/story";
import { WriterPage } from "./writer-page";
import { ModeSwitch } from "./writer";

export const metadata = { title: "Story builder" };

export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; q?: string; c?: string; error?: string; ok?: string; pending?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/story`);
  const [s, settings] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase)]);
  if (!s) notFound();
  if (s.project.story_mode === "draft") return <WriterPage s={s} settings={settings} supabase={supabase} sp={sp} />;

  const step: StoryStep = (STORY_STEPS.find((x) => x.key === sp.step)?.key ?? "cards") as StoryStep;
  const firstOpen = QUESTION_KEYS.find((k) => !s.answers[k]?.answer?.trim()) ?? QUESTION_KEYS[0];
  const q: QuestionKey = (QUESTION_KEYS as string[]).includes(sp.q ?? "") ? (sp.q as QuestionKey) : firstOpen;
  const gaps = storyGaps(s);
  const answered = QUESTIONS.filter((x) => s.answers[x.key]?.answer?.trim()).length;

  const estimate =
    step === "cards"
      ? estimateStoryAction(settings, s, { kind: "suggest", key: q })
      : step === "why"
        ? estimateStoryAction(settings, s, { kind: "why_pass" })
        : step === "oneline"
          ? estimateStoryAction(settings, s, { kind: "one_line" })
          : step === "characters"
            ? estimateStoryAction(settings, s, { kind: "characters" })
            : step === "plot"
              ? estimateStoryAction(settings, s, { kind: "plot" })
              : null;

  return (
    <ProjectShell
      projectId={id}
      current="story"
      storyGate={s.gate?.state ?? null}
      side={
        <>
          {s.project.logline ? (
            <p>
              <strong>Logline:</strong> {s.project.logline}
            </p>
          ) : (
            <p>
              No logline yet.{" "}
              <Link href={`/studio/projects/${id}/idea`} className="s-link">
                Go to Idea
              </Link>
            </p>
          )}
          <p className="s-muted">
            {answered} of {QUESTIONS.length} questions answered · {s.characters.length} character{s.characters.length === 1 ? "" : "s"}
          </p>
          <p className="s-muted">
            Model: <span className="font-mono text-xs">{settings?.models.story}</span>
            {settings?.dry_run && <strong className="block">Dry-run is on: replies are placeholders and cost nothing.</strong>}
          </p>
          <p className="s-muted">Claude never changes your answers on its own. Suggestions wait for you to pick or accept them.</p>
          {s.project.story_mode === "classic" && (
            <div className="border-t-2 border-[var(--s-line)] pt-3">
              <p className="font-bold">New: the story writer</p>
              <p className="s-muted text-xs">Tell the episode in your own words; Claude drafts it, asks only about the gaps and files every detail.</p>
              <div className="mt-2">
                <ModeSwitch id={id} to="draft" />
              </div>
            </div>
          )}
        </>
      }
    >
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 2</p>
      <h1 className="s-head text-3xl">Story builder</h1>

      <nav aria-label="Story steps" className="mt-4 flex flex-wrap gap-2">
        {STORY_STEPS.map((x) => (
          <Link
            key={x.key}
            href={`/studio/projects/${id}/story?step=${x.key}`}
            aria-current={x.key === step ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${
              x.key === step ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"
            }`}
          >
            {x.label}
            {x.key === "approve" && s.gate?.state === "approved" ? " ✓" : ""}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        <Notice error={sp.error} ok={sp.ok} />
        {s.gate?.state === "stale" && step !== "approve" && (
          <Notice warn="The story changed after you approved it. Approve it again when you're happy." />
        )}
      </div>

      <div className="mt-2">
        {step === "cards" && <CardsStep s={s} current={q} estimate={estimate} />}
        {step === "why" && <WhyStep s={s} estimate={estimate} />}
        {step === "oneline" && <OneLineStep s={s} estimate={estimate} />}
        {step === "characters" && <CharactersStep s={s} selected={sp.c} estimate={estimate} />}
        {step === "plot" && <PlotStep s={s} estimate={estimate} />}
        {step === "approve" && <ApproveStep s={s} gaps={gaps} />}
      </div>
    </ProjectShell>
  );
}
