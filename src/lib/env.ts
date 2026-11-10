// Small helpers so the app never crashes when keys are missing — it falls back
// to built-in demo data and tells the visitor what to set up.

// Supabase shows several addresses in its dashboard (e.g. .../rest/v1/). The app
// only needs the bare project address, so anything after the host is dropped.
export function supabaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export function supabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
}

export function hasSupabaseEnv(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export const SITE_NAME = "Pathtoon";
export const TAGLINE = "stories you steer";

// Feature flag for the future £2.99/month plan. Payments are NOT built in v1;
// this only exists so later stages can gate commenting/voting behind a plan.
export function subscriptionsEnabled(): boolean {
  return process.env.SUBSCRIPTIONS_ENABLED === "true";
}
