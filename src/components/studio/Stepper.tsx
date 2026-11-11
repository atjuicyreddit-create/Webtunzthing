import Link from "next/link";

// The studio's left-hand stepper. Stages unlock as they're built (docs/studio/OPUS-BUILD.md).
export const BUILT_STAGE = 2;

type StepKey = "idea" | "story" | "structure" | "script" | "assets" | "panels" | "preview" | "history" | "publish";

const STEPS: { key: StepKey; label: string; stage: number; gate?: string; href?: (id: string) => string }[] = [
  { key: "idea", label: "Idea", stage: 1, href: (id) => `/studio/projects/${id}/idea` },
  { key: "story", label: "Story builder", stage: 1, gate: "Story approved", href: (id) => `/studio/projects/${id}/story` },
  { key: "structure", label: "Structure board", stage: 2, href: (id) => `/studio/projects/${id}/structure` },
  { key: "script", label: "Script", stage: 3, gate: "Script final" },
  { key: "assets", label: "Assets", stage: 4, gate: "Asset designs approved" },
  { key: "panels", label: "Panels", stage: 5, gate: "Panels approved" },
  { key: "preview", label: "Preview & stitch", stage: 6 },
  { key: "history", label: "History & costs", stage: 6 },
  { key: "publish", label: "Publish", stage: 7, gate: "Publish" },
];

export function Stepper({
  projectId,
  current,
  storyGate,
}: {
  projectId: string;
  current?: StepKey;
  storyGate?: "open" | "approved" | "stale" | null;
}) {
  return (
    <nav aria-label="Project steps">
      <Link href={`/studio/projects/${projectId}`} className="s-link mb-2 inline-flex min-h-11 items-center px-3 text-sm">
        Project overview
      </Link>
      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const ready = s.stage <= BUILT_STAGE && s.href;
          const active = current === s.key;
          const gateState = s.key === "story" ? storyGate : null;
          const inner = (
            <>
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${
                  gateState === "approved" ? "s-active border-transparent" : "border-[var(--s-line)]"
                }`}
              >
                {gateState === "approved" ? "✓" : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{s.label}</span>
                <span className="block text-xs">
                  {!ready && `Coming in stage ${s.stage}`}
                  {gateState === "approved" && "Approved"}
                  {gateState === "stale" && <span className="font-bold text-[var(--s-magenta-deep)]">Changed since approval</span>}
                  {ready && !gateState && s.gate ? `Gate: ${s.gate}` : ""}
                  {!ready && s.gate ? ` · gate: ${s.gate}` : ""}
                </span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {ready ? (
                <Link
                  href={s.href!(projectId)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 ${
                    active ? "bg-[var(--s-ink)] text-white" : "hover:bg-[var(--s-paper)]"
                  }`}
                >
                  {inner}
                </Link>
              ) : (
                <div className="s-muted flex min-h-11 items-center gap-3 rounded-lg px-3 py-2" aria-disabled="true">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
