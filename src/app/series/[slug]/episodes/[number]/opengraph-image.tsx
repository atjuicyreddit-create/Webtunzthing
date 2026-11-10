import { ImageResponse } from "next/og";
import { getEpisodePage } from "@/lib/data";
import { SITE_NAME } from "@/lib/env";

export const alt = "Comic episode";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The picture shown when an episode link is shared on social media.
// Image generation for panels is out of scope for v1 — this is just a title card.
export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const n = Number.parseInt(number, 10);
  const page = Number.isInteger(n) ? await getEpisodePage(slug, n) : null;

  const series = page?.series.title ?? SITE_NAME;
  const episode = page ? `Episode ${page.episode.number}: ${page.episode.title}` : "";
  const hook = page?.isLatest ? "What happens next? You decide." : "Read free on " + SITE_NAME;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fff8ef",
          padding: 72,
          fontFamily: "sans-serif",
          color: "#2b2118",
          borderLeft: "28px solid #b8501a",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: "#b8501a" }}>
          {SITE_NAME}.
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 800, lineHeight: 1.05 }}>
            {series}
          </div>
          {episode && (
            <div style={{ display: "flex", fontSize: 44, marginTop: 20, color: "#6b5b4b" }}>
              {episode}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            fontSize: 40,
            fontWeight: 800,
            background: "#b8501a",
            color: "#ffffff",
            padding: "16px 36px",
            borderRadius: 999,
          }}
        >
          {hook}
        </div>
      </div>
    ),
    size,
  );
}
