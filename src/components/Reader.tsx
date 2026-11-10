import type { Panel } from "@/lib/types";

// The vertical-scroll reader. Panels are 800px-wide slices (drawn at 1600px).
// Everything scales down together on a phone, including the empty gaps:
//   same scene 150–300px · scene jump 500–800px · before the payoff 1000px+
// The gap is a box with the same width:height ratio as the 800px-wide design,
// so it shrinks in proportion to the panels and the pacing is preserved.
export function Reader({ panels }: { panels: Panel[] }) {
  if (panels.length === 0) {
    return (
      <div className="mx-auto max-w-panel px-4 py-16 text-center">
        <p className="text-lg font-bold">This episode has no panels yet.</p>
        <p className="mt-2 text-muted">Check back soon — the art is on its way.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-panel" aria-label="Comic panels">
      {panels.map((panel, i) => (
        <div key={panel.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={panel.image_url}
            alt={panel.alt ?? `Panel ${panel.position}`}
            width={panel.width}
            height={panel.height}
            // The first panel loads straight away; the rest load as you scroll.
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
            decoding="async"
            draggable={false}
            className="panel-img select-none"
          />
          {panel.gap_after > 0 && i < panels.length - 1 && (
            <div
              aria-hidden="true"
              style={{ width: "100%", aspectRatio: `${panel.width} / ${panel.gap_after}` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
