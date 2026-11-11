// The studio's left-hand stepper. Stages unlock as they're built (see docs/studio/OPUS-BUILD.md).
const STEPS = [
  { key: "idea", label: "Idea", stage: 1 },
  { key: "story", label: "Story builder", stage: 1, gate: "Story approved" },
  { key: "structure", label: "Structure board", stage: 2 },
  { key: "script", label: "Script", stage: 3, gate: "Script final" },
  { key: "assets", label: "Assets", stage: 4, gate: "Asset designs approved" },
  { key: "panels", label: "Panels", stage: 5, gate: "Panels approved" },
  { key: "preview", label: "Preview & stitch", stage: 6 },
  { key: "history", label: "History & costs", stage: 6 },
  { key: "publish", label: "Publish", stage: 7, gate: "Publish" },
] as const;

export const BUILT_STAGE = 0;

export function Stepper() {
  return (
    <nav aria-label="Project steps">
      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const ready = s.stage <= BUILT_STAGE;
          return (
            <li key={s.key}>
              <div
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 ${ready ? "" : "s-muted"}`}
                aria-disabled={!ready}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-[var(--s-line)] text-xs font-bold">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-xs">
                    {ready ? "" : `Coming in stage ${s.stage}`}
                    {"gate" in s && s.gate ? ` · gate: ${s.gate}` : ""}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
