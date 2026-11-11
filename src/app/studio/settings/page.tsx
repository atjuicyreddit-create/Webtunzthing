import { saveSettings, testClaudeCall, testImageCall } from "../actions";
import { Notice } from "@/components/studio/Notice";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { formatUsd, getStudioSettings } from "@/lib/studio/settings";

export const metadata = { title: "Settings & costs" };

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; test?: string; warn?: string }>;
}) {
  const { supabase } = await requireStudio("/studio/settings");
  const q = await searchParams;
  const settings = await getStudioSettings(supabase);
  const { data: calls } = await supabase
    .from("studio_ai_calls")
    .select("id,kind,purpose,model,size,status,estimated_usd,actual_usd,input_tokens,output_tokens,error,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const dayStart = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/London" }).split(",")[0],
  );
  const today = (calls ?? []).filter(
    (c) => (c.status === "done" || c.status === "reserved") && new Date(c.created_at) >= dayStart,
  );
  const spentToday = today.reduce((n, c) => n + Number(c.actual_usd ?? c.estimated_usd ?? 0), 0);

  if (!settings) {
    return (
      <Notice error="Studio settings are missing. Run supabase/migrations/0005_studio_foundation.sql in the Supabase SQL Editor, then reload." />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_1fr]">
      <section aria-labelledby="settings-title">
        <h1 id="settings-title" className="s-head text-3xl">
          Settings &amp; costs
        </h1>
        <div className="mt-4">
          <Notice error={q.error} warn={q.warn} ok={q.saved ? "Settings saved." : q.test ?? null} />
        </div>

        <form action={saveSettings} className="s-card mt-4 space-y-5 p-5">
          <fieldset className="space-y-3">
            <legend className="s-head text-lg">Models</legend>
            <p className="s-muted text-sm">Model ids, exactly as the provider names them. Every Claude model needs a price below.</p>
            {(
              [
                ["model_story", "Story, script checks", settings.models.story],
                ["model_small", "Small jobs", settings.models.small],
                ["model_vision", "Panel QA (vision)", settings.models.vision],
                ["model_image", "Images (KIE)", settings.models.image],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name}>
                <label htmlFor={name} className="block font-bold">
                  {label}
                </label>
                <input id={name} name={name} defaultValue={value} required className="s-input mt-1 font-mono text-sm" autoCapitalize="none" spellCheck={false} />
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="s-head text-lg">Limits</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["episode_image_cap_usd", "Images per episode ($)", settings.episode_image_cap_usd, "0.01"],
                  ["episode_image_cap_gens", "Images per episode (count)", settings.episode_image_cap_gens, "1"],
                  ["episode_claude_cap_usd", "Claude per episode ($)", settings.episode_claude_cap_usd, "0.01"],
                  ["session_cap_usd", "Everything per day ($)", settings.session_cap_usd, "0.01"],
                  ["warn_at_percent", "Warn at (% of a limit)", Math.round(settings.warn_at * 100), "1"],
                ] as const
              ).map(([name, label, value, step]) => (
                <div key={name}>
                  <label htmlFor={name} className="block font-bold">
                    {label}
                  </label>
                  <input id={name} name={name} type="number" inputMode="decimal" min={0} step={step} defaultValue={value} required className="s-input mt-1" />
                </div>
              ))}
            </div>
            <p className="s-muted text-sm">A day runs midnight to midnight, UK time. Calls stop at 100% of any limit.</p>
          </fieldset>

          <label className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" name="dry_run" defaultChecked={settings.dry_run} className="size-5" />
            Dry-run (log estimates, call nothing, charge nothing)
          </label>

          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-bold">Price table (advanced)</summary>
            <p className="s-muted text-sm">
              US dollars. Claude: per million tokens. Images: per image, keyed <code>model:size</code>. Prices change;
              update them here.
            </p>
            <label htmlFor="prices" className="sr-only">
              Price table as JSON
            </label>
            <textarea
              id="prices"
              name="prices"
              rows={16}
              defaultValue={JSON.stringify(settings.prices, null, 2)}
              className="s-input mt-2 font-mono text-xs"
              spellCheck={false}
            />
          </details>

          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </form>

        <form className="s-card mt-6 space-y-3 p-5">
          <h2 className="s-head text-lg">Test the gateway</h2>
          <p className="s-muted text-sm">
            {settings.dry_run
              ? "Dry-run is on: these write a ledger row with an estimate and spend nothing."
              : `Dry-run is off: the Claude test makes a real call to ${settings.models.small} (a fraction of a cent).`}
          </p>
          {!settings.dry_run && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" name="confirm_spend" className="size-5" /> I understand this spends real money
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton formAction={testClaudeCall} variant="info" pendingText="Calling…">
              Test Claude call
            </SubmitButton>
            <SubmitButton formAction={testImageCall} variant="quiet" pendingText="Logging…">
              Test image call (dry-run only)
            </SubmitButton>
          </div>
        </form>
      </section>

      <section aria-labelledby="ledger-title" className="min-w-0">
        <h2 id="ledger-title" className="s-head text-2xl">
          Cost ledger
        </h2>
        <p className="s-muted mt-1">
          Today: {formatUsd(spentToday)} of {formatUsd(settings.session_cap_usd)}. Every AI call is listed, including dry
          runs and refusals. The ledger can&rsquo;t be edited.
        </p>
        {(calls ?? []).length === 0 ? (
          <p className="s-card mt-4 p-6 text-center s-muted">No calls yet.</p>
        ) : (
          <div className="s-card mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--s-line)] text-xs uppercase tracking-wide s-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">What</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Estimate</th>
                  <th className="px-3 py-2 text-right">Charged</th>
                </tr>
              </thead>
              <tbody>
                {calls!.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--s-line)] last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{when(c.created_at)}</td>
                    <td className="px-3 py-2">
                      {c.purpose}
                      {c.error && <span className="block text-xs text-[var(--s-magenta-deep)]">{c.error}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {c.model}
                      {c.size ? ` · ${c.size}` : ""}
                      {c.input_tokens !== null && (
                        <span className="block s-muted">
                          {c.input_tokens} in / {c.output_tokens} out
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                          c.status === "done"
                            ? "s-active"
                            : c.status === "refused" || c.status === "failed"
                              ? "bg-[var(--s-magenta)] text-white"
                              : "bg-[var(--s-paper)]"
                        }`}
                      >
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatUsd(Number(c.estimated_usd))}</td>
                    <td className="px-3 py-2 text-right">{c.actual_usd === null ? "—" : formatUsd(Number(c.actual_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
