/** Adds query params to a path, keeping any "#section" at the end (where browsers expect it). */
export function withParams(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  if (!q) return path;
  const i = path.indexOf("#");
  const [p, hash] = i === -1 ? [path, ""] : [path.slice(0, i), path.slice(i)];
  return `${p}${p.includes("?") ? "&" : "?"}${q}${hash}`;
}
