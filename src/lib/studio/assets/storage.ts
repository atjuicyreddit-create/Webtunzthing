import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

// The private "studio" bucket. Layout:
//   projects/<project>/assets/<asset>/<take>.png      generated or imported asset images
//   projects/<project>/assets/<asset>/reference-*.ext  a reference image Tom uploaded
// Pages show images through short-lived signed links; nothing here is public.
//
// Every image also gets a small preview beside it (<path>.preview.webp, about 1000px wide).
// Studio pages show the previews, so browsing doesn't download the 5-8 MB originals
// (Supabase egress). The originals are still what the AI and publishing read.

const BUCKET = "studio";
const PREVIEW_SUFFIX = ".preview.webp";

export const previewPath = (path: string) => `${path}${PREVIEW_SUFFIX}`;

/** A small WebP copy for showing on Studio pages. Null if the bytes aren't an image sharp can read. */
export async function makePreview(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const out = await sharp(bytes).rotate().resize({ width: 1000, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

export async function uploadStudioFile(supabase: SupabaseClient, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) return false;
  if (contentType.startsWith("image/") && !path.endsWith(PREVIEW_SUFFIX)) {
    // A missing preview only means the page falls back to the original, so failures are ignored.
    const small = await makePreview(bytes);
    if (small) await supabase.storage.from(BUCKET).upload(previewPath(path), small, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
  }
  return true;
}

export async function readStudioFile(supabase: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function sign(supabase: SupabaseClient, list: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!list.length) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(list, 3600);
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}

/**
 * Signed links (1 hour) for showing images on a page, keyed by the original path.
 * Each link points at the small preview when there is one, else at the original.
 * Pass { full: true } for the original file (downloads, zooming in). Missing files are left out.
 */
export async function signedUrls(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
  opts: { full?: boolean } = {},
): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!list.length) return {};
  if (opts.full) return sign(supabase, list);
  const previews = await sign(supabase, list.map(previewPath));
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of list) {
    const u = previews[previewPath(p)];
    if (u) out[p] = u;
    else missing.push(p);
  }
  return { ...out, ...(await sign(supabase, missing)) };
}

export async function removeStudioFiles(supabase: SupabaseClient, paths: string[]) {
  const all = paths.flatMap((p) => (p.endsWith(PREVIEW_SUFFIX) ? [p] : [p, previewPath(p)]));
  for (let i = 0; i < all.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(all.slice(i, i + 100));
  }
}

/** Deletes everything under a folder (storage folders aren't real, so list them level by level). */
export async function removeStudioFolder(supabase: SupabaseClient, prefix: string) {
  const files: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 6) return;
    for (let offset = 0; ; offset += 100) {
      const { data } = await supabase.storage.from(BUCKET).list(dir, { limit: 100, offset });
      if (!data?.length) break;
      for (const item of data) {
        const full = `${dir}/${item.name}`;
        if (item.id) files.push(full);
        else await walk(full, depth + 1);
      }
      if (data.length < 100) break;
    }
  };
  await walk(prefix.replace(/\/+$/, ""), 0);
  if (files.length) await removeStudioFiles(supabase, files);
}
