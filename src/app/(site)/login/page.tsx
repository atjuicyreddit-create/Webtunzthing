import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";
import { SITE_NAME, TAGLINE, hasSupabaseEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to ${SITE_NAME} — ${TAGLINE}.`,
};
export const dynamic = "force-dynamic";

function safeNext(value: string | undefined): string {
  // Only allow on-site paths, never another website.
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <h1 className="text-3xl font-extrabold">Sign in to {SITE_NAME}</h1>
      <p className="mt-1 font-bold text-brand">{TAGLINE}</p>
      <p className="mt-2 text-muted">
        Free for now. Signing in lets you suggest what happens next and vote on other
        people&rsquo;s ideas.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          That sign-in link didn&rsquo;t work or has expired. Please try again.
        </p>
      )}

      {hasSupabaseEnv() ? (
        <LoginForm next={safeNext(next)} />
      ) : (
        <div className="mt-6 rounded-3xl border-2 border-dashed border-line p-6">
          <p className="font-bold">Sign-in isn&rsquo;t connected yet.</p>
          <p className="mt-2 text-muted">
            Add your Supabase URL and anon key to <code className="font-mono">.env.local</code>,
            restart the dev server, and this page will work. The README has the steps.
          </p>
        </div>
      )}
    </div>
  );
}
