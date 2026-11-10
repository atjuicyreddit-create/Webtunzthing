"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, slugify } from "@/lib/admin";

// Every action re-checks that the caller is an admin, then writes with the
// caller's own session, so the database's admin-only rules apply as well.

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}
function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}
function back(path: string, error: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
}

export async function saveSeries(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const title = text(form, "title");
  const slug = slugify(text(form, "slug") || title);
  const here = id ? `/admin/series/${id}` : "/admin/series/new";

  if (!title) back(here, "Please give the series a title.");
  if (!slug) back(here, "Please give the series a web address (slug).");

  const row = {
    title,
    slug,
    tagline: optional(form, "tagline"),
    description: optional(form, "description"),
    cover_url: optional(form, "cover_url"),
  };

  const query = id
    ? supabase.from("series").update(row).eq("id", id).select("id").single()
    : supabase.from("series").insert(row).select("id").single();
  const { data, error } = await query;
  if (error || !data) {
    back(
      here,
      error?.code === "23505" ? "That web address is already used." : "Couldn't save the series.",
    );
  }

  revalidatePath("/", "layout");
  redirect(`/admin/series/${data.id}?saved=1`);
}

export async function deleteSeries(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  if (text(form, "confirm") !== "delete") {
    back(`/admin/series/${id}`, "Type delete to confirm.");
  }
  const { error } = await supabase.from("series").delete().eq("id", id);
  if (error) back(`/admin/series/${id}`, "Couldn't delete the series.");
  revalidatePath("/", "layout");
  redirect("/admin");
}

function parseEpisode(form: FormData) {
  const access = text(form, "access") === "paid_early" ? "paid_early" : "free";
  const earlyRaw = text(form, "early_until");
  const earlyDate = earlyRaw ? new Date(earlyRaw) : null;
  return {
    number: Number.parseInt(text(form, "number"), 10),
    title: text(form, "title"),
    synopsis: optional(form, "synopsis"),
    access,
    early_until:
      access === "paid_early" && earlyDate && !Number.isNaN(earlyDate.getTime())
        ? earlyDate.toISOString()
        : null,
  } as const;
}

// intent: "draft" (save, keep or make it a draft), "publish", or "save" (keep status).
export async function saveEpisode(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const seriesId = text(form, "series_id");
  const intent = text(form, "intent");
  const here = id ? `/admin/episodes/${id}` : `/admin/series/${seriesId}/episodes/new`;

  const ep = parseEpisode(form);
  if (!Number.isInteger(ep.number) || ep.number < 1) back(here, "Episode number must be 1 or more.");
  if (!ep.title) back(here, "Please give the episode a title.");

  if (id) {
    const update: Record<string, unknown> = { ...ep };
    if (intent === "publish") {
      const { data: current } = await supabase
        .from("episodes")
        .select("status,published_at,panels(id)")
        .eq("id", id)
        .single();
      if (!current?.panels?.length) back(here, "Add at least one panel before publishing.");
      update.status = "published";
      if (!current.published_at || current.status !== "published") {
        update.published_at = new Date().toISOString();
      }
    } else if (intent === "draft") {
      update.status = "draft";
    }
    const { error } = await supabase.from("episodes").update(update).eq("id", id);
    if (error) {
      back(
        here,
        error.code === "23505" ? "That episode number is already used." : "Couldn't save the episode.",
      );
    }
    revalidatePath("/", "layout");
    redirect(
      `/admin/episodes/${id}?${intent === "publish" ? "published=1" : "saved=1"}`,
    );
  }

  // New episodes always start as drafts: add panels first, then publish.
  const { data, error } = await supabase
    .from("episodes")
    .insert({ ...ep, series_id: seriesId, status: "draft" })
    .select("id")
    .single();
  if (error || !data) {
    back(
      here,
      error?.code === "23505" ? "That episode number is already used." : "Couldn't create the episode.",
    );
  }
  revalidatePath("/", "layout");
  redirect(`/admin/episodes/${data.id}?created=1`);
}

export async function deleteEpisode(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(form, "id");
  const seriesId = text(form, "series_id");
  if (text(form, "confirm") !== "delete") back(`/admin/episodes/${id}`, "Type delete to confirm.");
  const { error } = await supabase.from("episodes").delete().eq("id", id);
  if (error) back(`/admin/episodes/${id}`, "Couldn't delete the episode.");
  revalidatePath("/", "layout");
  redirect(`/admin/series/${seriesId}`);
}
