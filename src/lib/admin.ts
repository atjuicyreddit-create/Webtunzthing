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

// Returns `base`, or `base-2`, `base-3`... — the first one no other series uses.
export async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string,
  excludeId?: string,
): Promise<string> {
  const { data } = await supabase.from("series").select("id,slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).filter((s) => s.id !== excludeId).map((s) => s.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}
