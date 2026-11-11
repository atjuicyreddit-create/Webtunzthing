import { Stepper } from "./Stepper";

// Three columns on desktop: stepper | work area | Claude panel. Stacks on tablet and phone.
export function ProjectShell({
  projectId,
  current,
  storyGate,
  side,
  children,
}: {
  projectId: string;
  current?: Parameters<typeof Stepper>[0]["current"];
  storyGate?: "open" | "approved" | "stale" | null;
  side?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
      <aside className="s-card h-fit p-3">
        <Stepper projectId={projectId} current={current} storyGate={storyGate} />
      </aside>
      <section className="min-w-0">{children}</section>
      <aside aria-label="Claude" className="s-card h-fit p-5 lg:col-start-2 xl:col-start-auto">
        <h2 className="s-head text-lg">Claude</h2>
        <div className="mt-2 space-y-3 text-sm">{side ?? <p className="s-muted">Nothing to suggest here yet.</p>}</div>
      </aside>
    </div>
  );
}

export function costLabel(usd: number | null): string {
  if (usd === null) return "cost unknown";
  if (usd < 0.01) return "under 1¢";
  return `up to $${usd.toFixed(2)}`;
}
