import { isDemoMode } from "@/lib/data";

// Shown only until Supabase keys are added to .env.local.
export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="border-b border-line bg-brand-soft px-4 py-2 text-center text-sm">
      <strong>Demo mode.</strong> You&rsquo;re seeing built-in sample data. Add your
      Supabase keys to <code className="font-mono">.env.local</code> to go live (see the
      README).
    </div>
  );
}
