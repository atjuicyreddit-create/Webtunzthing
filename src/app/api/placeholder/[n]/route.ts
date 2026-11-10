// Grey "Panel N" placeholder, 800px wide, any height (?h=1200).
// Used until real panel art is uploaded.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ n: string }> },
) {
  const { n } = await params;
  const label = Number.parseInt(n, 10);
  const h = Number.parseInt(new URL(request.url).searchParams.get("h") ?? "", 10);
  const height = Number.isFinite(h) ? Math.min(Math.max(h, 200), 4000) : 1200;
  const text = Number.isFinite(label) ? `Panel ${label}` : "Panel";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-label="${text} placeholder">
  <rect width="800" height="${height}" fill="#d9d4cc"/>
  <rect x="24" y="24" width="752" height="${height - 48}" rx="24" fill="none" stroke="#a89f93" stroke-width="4" stroke-dasharray="18 14"/>
  <text x="400" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="72" font-weight="700" fill="#6f665b">${text}</text>
  <text x="400" y="${height / 2 + 70}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" fill="#6f665b">800 × ${height} placeholder</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
