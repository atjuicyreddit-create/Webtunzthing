"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Panel } from "@/lib/types";

const GAPS = [
  { value: 0, label: "No gap" },
  { value: 200, label: "Same scene (200)" },
  { value: 600, label: "Scene jump (600)" },
  { value: 1000, label: "Before the payoff (1000)" },
];

const MAX_WIDTH = 1600; // drawn at 1600px, shown at 800px
const MAX_AREA = 16_000_000; // keeps iPhones from running out of memory

// Shrinks a big phone photo/export and converts it to WebP so it loads fast.
async function prepare(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);
  if (w * h > MAX_AREA) {
    const s = Math.sqrt(MAX_AREA / (w * h));
    w = Math.floor(w * s);
    h = Math.floor(h * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let type = "image/webp";
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob || blob.type !== type) {
    type = "image/jpeg";
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  }
  if (!blob) throw new Error("Couldn't read that image.");
  return {
    blob,
    type,
    ext: type === "image/webp" ? "webp" : "jpg",
    // Shown 800 wide; the height keeps the same proportions.
    height: Math.max(1, Math.round((h * 800) / w)),
  };
}

type Props = { episodeId: string; initialPanels: Panel[]; previewHref: string };

export function PanelManager({ episodeId, initialPanels, previewHref }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [panels, setPanels] = useState<Panel[]>(
    [...initialPanels].sort((a, b) => a.position - b.position),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const supabase = createClient();
    const list = Array.from(files).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    let position = panels.reduce((m, p) => Math.max(m, p.position), 0);

    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(`Uploading ${i + 1} of ${list.length}…`);
        const prepared = await prepare(list[i]);
        const path = `${episodeId}/${crypto.randomUUID()}.${prepared.ext}`;
        const { error: upErr } = await supabase.storage
          .from("panels")
          .upload(path, prepared.blob, { contentType: prepared.type, cacheControl: "31536000" });
        if (upErr) throw new Error("Upload failed. Are you signed in as admin?");

        const { data: pub } = supabase.storage.from("panels").getPublicUrl(path);
        position += 1;
        const { data, error: insErr } = await supabase
          .from("panels")
          .insert({
            episode_id: episodeId,
            position,
            image_url: pub.publicUrl,
            width: 800,
            height: prepared.height,
            gap_after: 200,
          })
          .select("*")
          .single();
        if (insErr || !data) throw new Error("Couldn't save the panel.");
        setPanels((prev) => [...prev, data as Panel]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
      router.refresh();
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= panels.length) return;
    setError(null);
    const next = [...panels];
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((p, i) => ({ ...p, position: i + 1 }));
    setPanels(renumbered);
    const { error: err } = await createClient().rpc("reorder_panels", {
      p_episode: episodeId,
      p_ids: renumbered.map((p) => p.id),
    });
    if (err) {
      setError("Couldn't reorder. Has the Stage 3 database update been run?");
      setPanels(panels);
    }
    router.refresh();
  }

  async function setGap(panel: Panel, gap: number) {
    setPanels((prev) => prev.map((p) => (p.id === panel.id ? { ...p, gap_after: gap } : p)));
    const { error: err } = await createClient()
      .from("panels")
      .update({ gap_after: gap })
      .eq("id", panel.id);
    if (err) setError("Couldn't save the gap.");
    router.refresh();
  }

  async function remove(panel: Panel) {
    if (!window.confirm(`Delete panel ${panel.position}? This can't be undone.`)) return;
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.from("panels").delete().eq("id", panel.id);
    if (err) {
      setError("Couldn't delete the panel.");
      return;
    }
    const path = panel.image_url.split("/panels/")[1];
    if (path) await supabase.storage.from("panels").remove([path]);
    setPanels((prev) => prev.filter((p) => p.id !== panel.id));
    router.refresh();
  }

  return (
    <section aria-labelledby="panels-heading" className="mt-8">
      <h2 id="panels-heading" className="text-2xl font-extrabold">
        Panels ({panels.length})
      </h2>
      <p className="text-sm text-muted">
        Pick all the images at once; they&rsquo;re added in file-name order. Use the arrows to
        reorder.
      </p>

      <input
        ref={input}
        id="panel-files"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => addFiles(e.target.files)}
        disabled={Boolean(busy)}
      />
      <label
        htmlFor="panel-files"
        className={`btn btn-primary mt-3 w-full ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
      >
        {busy ?? "＋ Add panel images"}
      </label>

      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          {error}
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {panels.map((p, i) => (
          <li key={p.id} className="rounded-2xl border-2 border-line bg-surface p-3">
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.image_url}
                alt={`Panel ${i + 1}`}
                loading="lazy"
                className="h-28 w-20 shrink-0 rounded-lg bg-line object-cover object-top"
              />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">Panel {i + 1}</p>
                <label htmlFor={`gap-${p.id}`} className="block text-sm font-semibold">
                  Gap after
                </label>
                <select
                  id={`gap-${p.id}`}
                  value={p.gap_after}
                  onChange={(e) => setGap(p, Number(e.target.value))}
                  className="min-h-11 w-full rounded-xl border-2 border-line bg-bg px-2 text-base"
                >
                  {!GAPS.some((g) => g.value === p.gap_after) && (
                    <option value={p.gap_after}>Custom ({p.gap_after})</option>
                  )}
                  {GAPS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move panel ${i + 1} up`}
                className="btn btn-quiet !min-h-12 disabled:opacity-40"
              >
                ↑ Up
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === panels.length - 1}
                aria-label={`Move panel ${i + 1} down`}
                className="btn btn-quiet !min-h-12 disabled:opacity-40"
              >
                ↓ Down
              </button>
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={`Delete panel ${i + 1}`}
                className="btn btn-quiet !min-h-12"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ol>

      {panels.length > 0 && (
        <a href={previewHref} className="btn btn-quiet mt-4 w-full">
          Preview as a reader
        </a>
      )}
    </section>
  );
}
