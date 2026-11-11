import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The private "studio" bucket. Layout:
//   projects/<project>/assets/<asset>/<take>.png      generated or imported asset images
//   projects/<project>/assets/<asset>/reference-*.ext  a reference image Tom uploaded
// Pages show images through short-lived signed links; nothing here is public.

const BUCKET = "studio";

export async function uploadStudioFile(supabase: SupabaseClient, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  return !error;
}

export async function readStudioFile(supabase: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Signed links (1 hour) for a list of paths. Missing files are left out. */
export async function signedUrls(supabase: SupabaseClient, paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!list.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(list, 3600);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

export async function removeStudioFiles(supabase: SupabaseClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
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
