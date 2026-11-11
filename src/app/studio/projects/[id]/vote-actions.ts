"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudio } from "@/lib/studio/auth";
import { loadFork } from "@/lib/studio/script/script";
import { getStudioSettings } from "@/lib/studio/settings";
import { loadStory } from "@/lib/studio/story/story";
import { withParams } from "@/lib/studio/url";
import { feedNextEpisode, unfeedNextEpisode } from "@/lib/studio/vote/decide";
import { cleanText, prepareComments, readiness, youChose } from "@/lib/studio/vote/free";
import { forkSnapshot, latestScriptPanels, loadLiveComments, loadLiveEpisode, loadRoundComments, loadRounds, loadVoteEpisodes } from "@/lib/studio/vote/load";
import { runScreening } from "@/lib/studio/vote/prompts";
import { NONE_FITS, type Decision, type Round } from "@/lib/studio/vote/types";

// One server action per button. Every action re-checks access; the database rules apply too.
// Nothing here writes to the public site: comments, episodes, series and panels are only read.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, ep: string, extra = "") => `/studio/projects/${id}/vote?ep=${ep}${extra}`;
function go(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}
const refresh = (id: string) => {
  revalidatePath(`/studio/projects/${id}/vote`);
  revalidatePath(`/studio/projects/${id}/script`);
  revalidatePath(`/studio/projects/${id}/structure`);
};

async function ctx(form: FormData) {
  const id = t(form, "project_id");
  const ep = t(form, "episode_id");
  const c = await requireStudio(`/studio/projects/${id}/vote`);
  const episodes = await loadVoteEpisodes(c.supabase, id);
  if (!episodes) go(`/studio/projects/${id}/vote`, { error: "Run the Stage 8 database update (0011_studio_vote.sql) first." });
  const episode = episodes.find((e) => e.id === ep);
  if (!episode) go(`/studio/projects/${id}/vote`, { error: "That episode doesn't exist." });
  return { ...c, id, ep, episode };
}

async function latestRound(c: Awaited<ReturnType<typeof ctx>>): Promise<Round | null> {
  return (await loadRounds(c.supabase, c.ep))[0] ?? null;
}

// ---------------------------------------------------------------- read-only link

export async function linkSource(form: FormData) {
  const c = await ctx(form);
  const live = await loadLiveEpisode(c.supabase, t(form, "source_episode_id"));
  if (!live) go(page(c.id, c.ep), { error: "Pick a live episode to read comments from." });
  // Only the studio's own row changes. The live episode is not touched.
  const { error } = await c.supabase.from("studio_episodes").update({ comment_source_episode_id: live.id }).eq("id", c.ep).eq("project_id", c.id);
  if (error) go(page(c.id, c.ep), { error: "Couldn't save the link. Has the Stage 8 database update been run?" });
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `Linked to ${live.series?.title ?? "a series"}, episode ${live.number}, to read its comments. Nothing on the live site was changed.` });
}

export async function unlinkSource(form: FormData) {
  const c = await ctx(form);
  await c.supabase.from("studio_episodes").update({ comment_source_episode_id: null }).eq("id", c.ep).eq("project_id", c.id);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: "Unlinked. The live episode and its comments are unchanged." });
}

// ---------------------------------------------------------------- Claude screening

export async function screenComments(form: FormData) {
  const c = await ctx(form);
  const last = await latestRound(c);
  if (last?.status === "decided") go(page(c.id, c.ep), { error: "This vote is decided. Reopen it before screening again." });
  const [story, settings, fork] = await Promise.all([loadStory(c.supabase, c.id), getStudioSettings(c.supabase), loadFork(c.supabase, c.ep)]);
  if (!story || !settings) go(page(c.id, c.ep), { error: "Couldn't load the project." });
  const snap = forkSnapshot(fork);
  const blocks = readiness({
    fork: snap,
    destination: story.project.destination,
    milestones: story.milestones.length,
    serial: story.project.format === "serial",
    linked: Boolean(c.episode.comment_source_episode_id),
  });
  if (blocks.length) go(page(c.id, c.ep), { error: blocks[0] });
  const live = await loadLiveComments(c.supabase, c.episode.comment_source_episode_id);
  const prepared = prepareComments(live, settings.vote_max_comments ?? 30);
  if (!prepared.some((p) => p.n !== null)) go(page(c.id, c.ep), { error: "There are no comments to screen. Use the backup pick instead." });
  const panels = await latestScriptPanels(c.supabase, c.ep);

  const r = await runScreening(c.supabase, c.ep, { story, episodeNumber: c.episode.number, fork: snap!, panels, comments: prepared });
  if (!r.ok) go(page(c.id, c.ep), { error: r.reason });

  const { data: round, error } = await c.supabase
    .from("studio_vote_rounds")
    .insert({
      project_id: c.id,
      episode_id: c.ep,
      source_episode_id: c.episode.comment_source_episode_id,
      status: "screened",
      fork_snapshot: snap,
      summary: cleanText(r.data.summary ?? "", 600),
      ai_call_id: r.ledgerId,
    })
    .select("id")
    .single();
  if (error || !round) go(page(c.id, c.ep), { error: "Couldn't save the screening (the cost was logged)." });

  const byN = new Map(r.data.results.map((x) => [x.n, x]));
  const branchTitles = new Set(snap!.branches.map((b) => b.title));
  const rows = prepared.map((p) => {
    const x = p.n !== null ? byN.get(p.n) : undefined;
    const unsafe = Boolean(x?.unsafe);
    const verdict = x ? (unsafe ? "veto" : x.verdict) : null;
    return {
      round_id: round.id,
      comment_id: p.id,
      author_name: p.author_name ? cleanText(p.author_name, 80) : null,
      body: p.body.slice(0, 2000),
      posted_at: p.created_at,
      skipped_reason: p.skipped,
      flags: p.flags,
      verdict,
      reason: x ? cleanText(x.reason ?? "", 300) : p.n !== null ? "Claude didn't return a verdict for this comment." : null,
      breaks: x ? (x.breaks ?? []).slice(0, 7) : [],
      adjusted: x && verdict === "near" ? cleanText(x.adjusted ?? "", 600) || null : null,
      label: x && verdict !== "veto" ? cleanText(x.label ?? "", 60) || null : null,
      branch: x && branchTitles.has(x.branch) ? x.branch : x ? NONE_FITS : null,
      unsafe,
      suggested_rank: x && verdict !== "veto" && Number.isInteger(x.rank) && x.rank > 0 ? x.rank : null,
    };
  });
  if (rows.length) await c.supabase.from("studio_vote_comments").insert(rows);
  const counts = { pass: 0, near: 0, veto: 0 };
  for (const row of rows) if (row.verdict) counts[row.verdict as keyof typeof counts]++;
  refresh(c.id);
  go(page(c.id, c.ep, "#verdicts"), {
    ok: `Screened ${counts.pass + counts.near + counts.veto} comment(s): ${counts.pass} pass, ${counts.near} nearly pass, ${counts.veto} vetoed. Nothing was chosen or changed (${r.note})`,
  });
}

// ---------------------------------------------------------------- Tom's edits and decision

async function loadRow(c: Awaited<ReturnType<typeof ctx>>, form: FormData) {
  const round = await latestRound(c);
  if (!round) go(page(c.id, c.ep), { error: "Screen the comments first." });
  const rows = await loadRoundComments(c.supabase, round.id);
  const row = rows.find((x) => x.id === t(form, "vote_comment_id"));
  if (!row) go(page(c.id, c.ep, "#verdicts"), { error: "That comment isn't part of the latest screening." });
  return { round, row };
}

export async function saveRowEdit(form: FormData) {
  const c = await ctx(form);
  const { round, row } = await loadRow(c, form);
  if (round.status === "decided") go(page(c.id, c.ep, "#verdicts"), { error: "This vote is decided. Reopen it first." });
  const branch = t(form, "branch");
  await c.supabase
    .from("studio_vote_comments")
    .update({
      tom_adjusted: cleanText(t(form, "route"), 600) || null,
      tom_label: cleanText(t(form, "label"), 60) || null,
      tom_branch: round.fork_snapshot.branches.some((b) => b.title === branch) ? branch : null,
    })
    .eq("id", row.id);
  refresh(c.id);
  go(page(c.id, c.ep, `#c-${row.id}`), { ok: "Saved your edits. Nothing is chosen yet." });
}

async function decide(c: Awaited<ReturnType<typeof ctx>>, round: Round, decision: Decision, note: string) {
  const story = await loadStory(c.supabase, c.id);
  const now = new Date().toISOString();
  const { error } = await c.supabase
    .from("studio_vote_rounds")
    .update({ status: "decided", decision, decided_by: c.user.id, decided_at: now, note: note || null })
    .eq("id", round.id);
  if (error) {
    const msg = /unsafe|vetoed|not part|not screened/i.test(error.message) ? error.message : "Couldn't record the decision.";
    go(page(c.id, c.ep, "#verdicts"), { error: msg });
  }
  const next = await feedNextEpisode(c.supabase, {
    projectId: c.id,
    episodeNumber: c.episode.number,
    round: { ...round, decision },
    decision,
    milestones: story?.milestones ?? [],
    userId: c.user.id,
    decidedAt: now,
  });
  refresh(c.id);
  go(page(c.id, c.ep, "#decision"), {
    ok: `Decided: ${decision.you_chose}${next ? ` Episode ${next.number}'s drafts now start from this route.${next.staled ? " Its approved script is marked as changed." : ""}` : ""}`,
  });
}

export async function chooseComment(form: FormData) {
  const c = await ctx(form);
  const { round, row } = await loadRow(c, form);
  if (round.status === "decided") go(page(c.id, c.ep, "#verdicts"), { error: "This vote is already decided. Reopen it to change it." });
  if (row.unsafe) go(page(c.id, c.ep, `#c-${row.id}`), { error: "An unsafe comment can never be chosen." });
  if (!row.verdict) go(page(c.id, c.ep, `#c-${row.id}`), { error: "That comment wasn't screened." });
  const override = cleanText(t(form, "override_note"), 300);
  if (row.verdict === "veto" && (form.get("override") !== "on" || !override)) {
    go(page(c.id, c.ep, `#c-${row.id}`), { error: "Claude vetoed this comment. Tick “override” and write why to choose it anyway." });
  }
  const branchTitle = t(form, "branch") || row.tom_branch || row.branch || "";
  const branch = round.fork_snapshot.branches.find((b) => b.title === branchTitle);
  const route = cleanText(t(form, "route"), 600) || row.tom_adjusted || (row.verdict === "near" ? row.adjusted : null) || cleanText(row.body, 600);
  const label = cleanText(t(form, "label"), 60) || row.tom_label || row.label || branch?.title || "the readers' idea";
  const decision: Decision = {
    kind: "comment",
    vote_comment_id: row.id,
    route,
    you_chose: youChose(label),
    credit: form.get("show_credit") === "on" && row.author_name ? row.author_name : null,
    branch: branch?.title ?? NONE_FITS,
    rejoins: branch?.rejoins ?? "",
    ...(row.verdict === "veto" ? { override_note: override } : {}),
  };
  await decide(c, round, decision, cleanText(t(form, "note"), 500));
}

export async function chooseBackup(form: FormData) {
  const c = await ctx(form);
  let round = await latestRound(c);
  if (round?.status === "decided") go(page(c.id, c.ep, "#backup"), { error: "This vote is already decided. Reopen it to change it." });
  const fork = forkSnapshot(await loadFork(c.supabase, c.ep));
  if (!fork?.backup_pick.trim() && !t(form, "route")) go(page(c.id, c.ep, "#backup"), { error: "The end card has no backup pick. Write the route here or on the Script page." });
  // A backup can be chosen without screening (too few comments): record an empty round for history.
  if (!round) {
    const { data } = await c.supabase
      .from("studio_vote_rounds")
      .insert({ project_id: c.id, episode_id: c.ep, source_episode_id: c.episode.comment_source_episode_id, status: "screened", fork_snapshot: fork, summary: "Backup pick, no screening." })
      .select("id,episode_id,source_episode_id,status,fork_snapshot,summary,screened_at,decision,decided_by,decided_at,note")
      .single();
    round = (data as Round | null) ?? null;
    if (!round) go(page(c.id, c.ep, "#backup"), { error: "Couldn't record the decision." });
  }
  const branch = round.fork_snapshot.branches.find((b) => b.title === t(form, "branch"));
  const route = cleanText(t(form, "route"), 600) || fork!.backup_pick;
  const decision: Decision = {
    kind: "backup",
    route,
    // A backup is still narrated as "You chose…" (the brief).
    you_chose: youChose(t(form, "label") || branch?.title || "the backup plan"),
    credit: null,
    branch: branch?.title ?? NONE_FITS,
    rejoins: branch?.rejoins ?? "",
  };
  await decide(c, round, decision, cleanText(t(form, "note"), 500));
}

export async function reopenDecision(form: FormData) {
  const c = await ctx(form);
  const round = await latestRound(c);
  if (!round || round.status !== "decided") go(page(c.id, c.ep), {});
  const note = cleanText(t(form, "note"), 500);
  await c.supabase
    .from("studio_vote_rounds")
    .update({ status: "screened", decision: null, decided_by: null, decided_at: null, note: note ? `Reopened: ${note}` : "Reopened" })
    .eq("id", round.id);
  const staled = await unfeedNextEpisode(c.supabase, c.id, c.episode.number, round.id, c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, "#verdicts"), { ok: `Reopened. Episode ${c.episode.number + 1} no longer has a reader route.${staled ? " Its approved script is marked as changed." : ""}` });
}
