import Link from "next/link";
import { notFound } from "next/navigation";
import { screenComments } from "../vote-actions";
import { BackupForm, DecisionCard, ForkCard, History, LiveComments, SourceSection, Verdicts } from "./parts";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell, costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { loadFork } from "@/lib/studio/script/script";
import { getStudioSettings } from "@/lib/studio/settings";
import { loadStory } from "@/lib/studio/story/story";
import { prepareComments, readiness } from "@/lib/studio/vote/free";
import {
  forkSnapshot,
  latestScriptPanels,
  listLiveEpisodes,
  loadLiveComments,
  loadLiveEpisode,
  loadRoundComments,
  loadRounds,
  loadVoteEpisodes,
} from "@/lib/studio/vote/load";
import { estimateScreening } from "@/lib/studio/vote/prompts";

export const metadata = { title: "Reader vote" };
export const maxDuration = 60;

export default async function VotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string; error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/vote`);
  const [story, settings, episodes] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase), loadVoteEpisodes(supabase, id)]);
  if (!story) notFound();

  const shell = (children: React.ReactNode, side?: React.ReactNode) => (
    <ProjectShell projectId={id} current="vote" storyGate={story.gate?.state ?? null} side={side}>
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Reader vote</p>
      <h1 className="s-head text-3xl">The winning comment</h1>
      <p className="s-muted mt-1">
        Read the live comments on a published episode, let Claude screen them against the story&rsquo;s rules, then choose the route into the next episode.
      </p>
      <div className="mt-4"><Notice error={sp.error} ok={sp.ok} /></div>
      {children}
    </ProjectShell>
  );

  if (episodes === null) return shell(<Notice warn="Run the Stage 8 database update (supabase/migrations/0011_studio_vote.sql) in the Supabase SQL Editor, then reload." />);
  if (story.project.format !== "serial") return shell(<p className="s-card p-6 text-center">Reader votes are for serial comics. This project is a one-off.</p>);
  if (!episodes.length || !settings) {
    return shell(
      <div className="s-card p-6 text-center">
        <p className="s-head text-lg">No episodes yet</p>
        <Link href={`/studio/projects/${id}/structure`} className="s-btn s-btn-primary mt-3">Go to the structure board</Link>
      </div>,
    );
  }

  const episode = episodes.find((e) => e.id === sp.ep) ?? episodes[0];
  const ids = { projectId: id, episodeId: episode.id };
  const next = episodes.find((e) => e.number === episode.number + 1) ?? null;
  const [fork, live, liveComments, rounds, panels] = await Promise.all([
    loadFork(supabase, episode.id).then(forkSnapshot),
    loadLiveEpisode(supabase, episode.comment_source_episode_id),
    loadLiveComments(supabase, episode.comment_source_episode_id),
    loadRounds(supabase, episode.id),
    latestScriptPanels(supabase, episode.id),
  ]);
  const choices = live ? [] : await listLiveEpisodes(supabase);
  const latest = rounds[0] ?? null;
  const rows = latest ? await loadRoundComments(supabase, latest.id) : [];
  const decided = latest?.status === "decided";
  const prepared = prepareComments(liveComments, settings.vote_max_comments);
  const valid = prepared.filter((p) => p.skipped === null || p.skipped === "over_cap").length;
  const tooFew = valid < settings.vote_min_comments;
  const voteOpen = Boolean(live?.vote_closes_at && new Date(live.vote_closes_at) > new Date());
  const blocks = readiness({
    fork,
    destination: story.project.destination,
    milestones: story.milestones.length,
    serial: true,
    linked: Boolean(live),
  });
  const estimate = fork && !blocks.length ? estimateScreening(settings, { story, episodeNumber: episode.number, fork, panels, comments: prepared }) : null;
  const toScreen = prepared.filter((p) => p.n !== null).length;

  return shell(
    <>
      <nav aria-label="Episodes" className="flex flex-wrap gap-2">
        {episodes.map((e) => (
          <Link
            key={e.id}
            href={`/studio/projects/${id}/vote?ep=${e.id}`}
            aria-current={e.id === episode.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${e.id === episode.id ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"}`}
          >
            Vote after episode {e.number}
          </Link>
        ))}
      </nav>
      {episode.reader_route && (
        <p className="s-card mt-3 p-3 text-sm">
          Episode {episode.number} itself starts from an earlier vote: <strong>{episode.reader_route.you_chose}</strong> {episode.reader_route.route}
        </p>
      )}

      <SourceSection ids={ids} live={live} choices={choices} voteOpen={voteOpen} />
      <ForkCard projectId={id} episodeId={episode.id} fork={fork} />
      {blocks.length > 0 && (
        <div className="mt-4">
          <Notice warn={`Before screening: ${blocks.join(" ")}`} />
        </div>
      )}
      {live && <LiveComments prepared={prepared} min={settings.vote_min_comments} max={settings.vote_max_comments} />}

      {decided && latest && <DecisionCard ids={ids} round={latest} nextNumber={episode.number + 1} nextRoute={next?.reader_route ?? null} />}
      {latest && rows.length > 0 && <Verdicts ids={ids} round={latest} rows={rows} decided={decided} />}
      {!decided && <BackupForm ids={ids} fork={fork} tooFew={tooFew} />}
      <History rounds={rounds} />
    </>,
    <>
      <form>
        <input type="hidden" name="project_id" value={id} />
        <input type="hidden" name="episode_id" value={episode.id} />
        <p>
          Claude checks each comment against what&rsquo;s in bounds, the locked lines, the character guardrails, the world rules, the house rules and the
          destination. It suggests; you choose.
        </p>
        <SubmitButton formAction={screenComments} variant="info" pendingText="Screening…" className="mt-2 w-full" disabled={blocks.length > 0 || decided || toScreen === 0}>
          {latest && !decided ? "Screen again" : "Screen"} {toScreen} comment{toScreen === 1 ? "" : "s"} · {costLabel(estimate)}
        </SubmitButton>
      </form>
      {decided && <p className="s-muted">This vote is decided. Reopen it to screen again.</p>}
      <p className="s-muted">Comments are treated as text to judge, never as instructions. Names aren&rsquo;t sent to Claude.</p>
      <p className="s-muted">This counts towards episode {episode.number}&rsquo;s Claude budget.</p>
      {settings.dry_run && <p className="font-bold">Dry-run is on: Claude replies are placeholders and cost nothing.</p>}
    </>,
  );
}
