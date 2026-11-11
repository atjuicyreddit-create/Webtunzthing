import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiImageAbandon, aiImagePoll, aiImageStart, type ImageRef } from "../ai/aiCall";
import { fullPrompt } from "./prompts";
import { readStudioFile, uploadStudioFile } from "./storage";
import type { Asset } from "./types";

// Image generation runs as jobs: start the KIE task, save a job row, return at once.
// The page polls /studio/api/jobs, which checks each task and stores the finished image.

const GIVE_UP_MS = 10 * 60 * 1000;

const extOf = (type: string) => (type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png");

/** Starts `count` cheap exploration options (1K) for one asset. Stops at the first refusal. */
export async function startExploration(
  supabase: SupabaseClient,
  asset: Asset,
  episodeId: string,
  count: number,
): Promise<{ started: number; dryRun: boolean; reason?: string; warn: boolean; percent: number; estimateEach: number }> {
  const prompt = fullPrompt(asset.kind, asset.name, asset.prompt);
  const references: ImageRef[] = [];
  if (asset.reference_path) {
    const bytes = await readStudioFile(supabase, asset.reference_path);
    if (bytes) {
      const name = asset.reference_path.split("/").pop() ?? "reference.png";
      references.push({ name, bytes, type: name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" : name.endsWith(".webp") ? "image/webp" : "image/png" });
    }
  }

  let started = 0;
  let dryRun = false;
  let warn = false;
  let percent = 0;
  let estimateEach = 0;
  for (let i = 0; i < count; i++) {
    const r = await aiImageStart({
      supabase,
      projectId: asset.project_id,
      episodeId,
      purpose: `Asset option: ${asset.name} (${i + 1} of ${count})`,
      size: "1K",
      aspect: asset.aspect,
      prompt,
      references,
    });
    if (!r.ok) return { started, dryRun, reason: r.reason, warn, percent, estimateEach };
    dryRun = r.dryRun;
    warn = warn || r.warn;
    percent = Math.max(percent, r.percent);
    estimateEach = r.estimatedUsd;

    if (r.dryRun) {
      await supabase.from("studio_takes").insert({
        project_id: asset.project_id,
        episode_id: episodeId,
        asset_id: asset.id,
        kind: "exploration",
        status: "dry_run",
        prompt,
        model: r.model,
        size: "1K",
        aspect: asset.aspect,
        cost_usd: 0,
        ai_call_id: r.ledgerId,
      });
    } else {
      const { data: job } = await supabase
        .from("studio_jobs")
        .insert({
          project_id: asset.project_id,
          episode_id: episodeId,
          task_id: r.taskId,
          status: "running",
          ai_call_id: r.ledgerId,
          credits_before: r.creditsBefore,
        })
        .select("id")
        .single();
      await supabase.from("studio_takes").insert({
        project_id: asset.project_id,
        episode_id: episodeId,
        asset_id: asset.id,
        kind: "exploration",
        status: "pending",
        prompt,
        model: r.model,
        size: "1K",
        aspect: asset.aspect,
        cost_usd: r.estimatedUsd,
        ai_call_id: r.ledgerId,
        job_id: job?.id ?? null,
      });
    }
    started++;
  }
  return { started, dryRun, warn, percent, estimateEach };
}

type JobRow = {
  id: string;
  project_id: string;
  task_id: string | null;
  status: string;
  ai_call_id: string | null;
  credits_before: number | null;
  created_at: string;
};

/** Checks one job once. Returns its status after the check. */
export async function pollJob(supabase: SupabaseClient, jobId: string): Promise<"running" | "done" | "failed"> {
  const { data: job } = await supabase
    .from("studio_jobs")
    .select("id,project_id,task_id,status,ai_call_id,credits_before,created_at")
    .eq("id", jobId)
    .maybeSingle<JobRow>();
  if (!job) return "failed";
  if (job.status === "done" || job.status === "failed") return job.status;
  const { data: take } = await supabase
    .from("studio_takes")
    .select("id,asset_id,cost_usd")
    .eq("job_id", job.id)
    .maybeSingle<{ id: string; asset_id: string | null; cost_usd: number }>();

  const fail = async (reason: string, cost: number) => {
    await supabase.from("studio_jobs").update({ status: "failed", error: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", job.id);
    if (take) await supabase.from("studio_takes").update({ status: "failed", error: reason.slice(0, 300), cost_usd: cost }).eq("id", take.id);
    return "failed" as const;
  };

  if (!job.task_id || !job.ai_call_id) return fail("The job has no KIE task.", 0);
  if (Date.now() - new Date(job.created_at).getTime() > GIVE_UP_MS) {
    await aiImageAbandon(supabase, job.ai_call_id, job.credits_before === null ? null : Number(job.credits_before));
    return fail("KIE took longer than 10 minutes, so the studio stopped waiting. Check the ledger before trying again.", 0);
  }

  const r = await aiImagePoll({
    supabase,
    ledgerId: job.ai_call_id,
    taskId: job.task_id,
    creditsBefore: job.credits_before === null ? null : Number(job.credits_before),
    estimatedUsd: Number(take?.cost_usd ?? 0),
  });
  if (r.state === "pending") return "running";
  if (r.state === "failed") return fail(r.reason, r.costUsd);

  if (!take) return fail("The image finished, but its take was deleted.", r.costUsd);
  const path = `projects/${job.project_id}/assets/${take.asset_id ?? "panels"}/${take.id}.${extOf(r.contentType)}`;
  const stored = await uploadStudioFile(supabase, path, r.bytes, r.contentType);
  if (!stored) return fail("The image was made (and charged) but couldn't be saved to storage.", r.costUsd);
  await supabase.from("studio_takes").update({ status: "ready", storage_path: path, cost_usd: r.costUsd }).eq("id", take.id);
  await supabase
    .from("studio_jobs")
    .update({ status: "done", credits_after: r.creditsAfter, topup: r.topup, updated_at: new Date().toISOString() })
    .eq("id", job.id);
  return "done";
}
