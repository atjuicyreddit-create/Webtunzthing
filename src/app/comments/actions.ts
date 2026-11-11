"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Comments are written with the reader's own session, so the database rules
// decide who may post (signed in, published episode) and delete (own or admin).

function safePath(value: FormDataEntryValue | null): string {
  const p = String(value ?? "");
  return p.startsWith("/series/") && !p.startsWith("//") ? p : "/";
}

export async function addComment(form: FormData) {
  const back = safePath(form.get("path"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);

  const body = String(form.get("body") ?? "").trim();
  if (!body) redirect(`${back}?comment_error=empty#comments`);
  if (body.length > 1000) redirect(`${back}?comment_error=long#comments`);

  const { error } = await supabase
    .from("comments")
    .insert({ episode_id: String(form.get("episode_id") ?? ""), body });
  if (error) redirect(`${back}?comment_error=failed#comments`);

  revalidatePath(back);
  redirect(`${back}?commented=1#comments`);
}

export async function deleteComment(form: FormData) {
  const back = safePath(form.get("path"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", String(form.get("id") ?? ""));
  revalidatePath(back);
  redirect(`${back}?${error ? "comment_error=delete" : "comment_deleted=1"}#comments`);
}
