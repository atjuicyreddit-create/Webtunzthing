import "server-only";
import { notFound, redirect } from "next/navigation";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Guard for every /studio page and action.
// Signed out -> sign-in page. Signed in but not Tom -> plain "not found".
// "Tom" = an admin (profiles.role) whose email matches ADMIN_EMAIL, when ADMIN_EMAIL is set.
// The database rules (public.is_admin()) are the real lock; this is the friendly layer.
export async function requireStudio(next = "/studio") {
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

  const owner = studioOwnerEmail();
  if (owner && (user.email ?? "").toLowerCase() !== owner) notFound();

  return { supabase, user };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** ADMIN_EMAIL, lower-cased, or null if unset or not a valid email (then any admin may enter). */
export function studioOwnerEmail(): string | null {
  const v = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  return EMAIL.test(v) ? v : null;
}

/** For /studio/health: "ok", "missing" or "invalid" — never the value itself. */
export function ownerEmailStatus(): "ok" | "missing" | "invalid" {
  const raw = (process.env.ADMIN_EMAIL ?? "").trim();
  if (!raw) return "missing";
  return studioOwnerEmail() ? "ok" : "invalid";
}

export type StudioContext = Awaited<ReturnType<typeof requireStudio>>;
