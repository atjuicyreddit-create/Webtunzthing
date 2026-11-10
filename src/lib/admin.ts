import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { hasSupabaseEnv } from "./env";

// Guard for every admin page and action. Signed out -> sign-in page.
// Signed in but not an admin -> a plain "not found", so the area isn't advertised.
// (The database's own rules also block non-admins; this is the friendly layer.)
export async function requireAdmin(next = "/admin") {
  if (!hasSupabaseEnv()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") notFound();

  return { supabase, user };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
