"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const callback = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback() },
    });
    if (error) {
      setStatus("error");
      setMessage("Google sign-in isn't switched on yet. Try the email link instead.");
    }
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callback() },
    });
    if (error) {
      setStatus("error");
      setMessage(
        error.message.toLowerCase().includes("rate")
          ? "Too many tries — please wait a minute and try again."
          : "We couldn't send that link. Check the email address and try again.",
      );
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="mt-6 space-y-6">
      <button type="button" onClick={signInWithGoogle} className="btn btn-quiet w-full">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.8V6.5H1.4a12 12 0 0 0 0 11l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
        </svg>
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      {status === "sent" ? (
        <div role="status" className="rounded-3xl bg-brand-soft p-5">
          <p className="text-lg font-extrabold">Check your email</p>
          <p className="mt-1">
            We&rsquo;ve sent a sign-in link to <strong>{email}</strong>. Open it in{" "}
            <strong>this same browser</strong> to finish signing in.
          </p>
        </div>
      ) : (
        <form onSubmit={sendMagicLink} className="space-y-3">
          <label htmlFor="email" className="block font-bold">
            Or get a sign-in link by email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-12 w-full rounded-2xl border-2 border-line bg-surface px-4 text-lg"
          />
          <button type="submit" disabled={status === "sending"} className="btn btn-primary w-full disabled:opacity-60">
            {status === "sending" ? "Sending…" : "Email me a link"}
          </button>
        </form>
      )}

      {status === "error" && (
        <p role="alert" className="rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
