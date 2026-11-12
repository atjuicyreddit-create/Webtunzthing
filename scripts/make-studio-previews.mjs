// One-off: makes the small <path>.preview.webp copy for every Studio image that doesn't have one.
// New images get theirs automatically (src/lib/studio/assets/storage.ts); this covers older ones.
// Run:  node scripts/make-studio-previews.mjs        (add --dry to only count)
// Uses the service key from secrets/.env.local. Never prints keys.
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { loadSecrets } from "./load-secrets.mjs";

loadSecrets();
// The saved value may include a path such as /rest/v1/; the client wants just the origin.
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const url = rawUrl ? new URL(rawUrl).origin : "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets/.env.local");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
const BUCKET = "studio";
const SUFFIX = ".preview.webp";
const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);

async function walk(dir, depth = 0, out = []) {
  if (depth > 8) return out;
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(dir, { limit: 100, offset });
    if (error) throw new Error(`list ${dir}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const full = dir ? `${dir}/${item.name}` : item.name;
      if (item.id) out.push(full);
      else await walk(full, depth + 1, out);
    }
    if (data.length < 100) break;
  }
  return out;
}

const files = await walk("projects"); // everything in the bucket lives under projects/
const have = new Set(files.filter((f) => f.endsWith(SUFFIX)));
const todo = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.endsWith(SUFFIX) && !have.has(f + SUFFIX));
console.log(`${files.length} files, ${have.size} previews already, ${todo.length} to make${dry ? " (dry run)" : ""}`);
if (dry) process.exit(0);

let made = 0, before = 0, after = 0;
for (const path of todo) {
  const { data, error } = await storage.download(path);
  if (error || !data) { console.log(`skip ${path}: ${error?.message ?? "no data"}`); continue; }
  const bytes = Buffer.from(await data.arrayBuffer());
  try {
    const small = await sharp(bytes).rotate().resize({ width: 1000, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const up = await storage.upload(path + SUFFIX, small, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (up.error) { console.log(`skip ${path}: ${up.error.message}`); continue; }
    made++; before += bytes.length; after += small.length;
    console.log(`${path}  ${(bytes.length / 1e6).toFixed(1)} MB -> ${(small.length / 1e3).toFixed(0)} KB`);
  } catch (e) {
    console.log(`skip ${path}: ${e.message}`);
  }
}
console.log(`Made ${made} previews: ${(before / 1e6).toFixed(0)} MB of originals now show as ${(after / 1e6).toFixed(1)} MB.`);
