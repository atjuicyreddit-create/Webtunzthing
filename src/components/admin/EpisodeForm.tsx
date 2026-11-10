"use client";

import { useState } from "react";
import { saveEpisode } from "@/app/admin/actions";
import type { Episode } from "@/lib/types";
import { Field, fieldClass } from "./ui";

// ISO timestamp -> the value a <input type="datetime-local"> wants (browser's local time).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Props = {
  seriesId: string;
  nextNumber: number;
  episode?: Pick<Episode, "id" | "number" | "title" | "synopsis" | "access" | "early_until" | "status">;
  panelCount?: number;
};

export function EpisodeForm({ seriesId, nextNumber, episode, panelCount = 0 }: Props) {
  const [access, setAccess] = useState<"free" | "paid_early">(episode?.access ?? "free");
  const [until, setUntil] = useState(toLocalInput(episode?.early_until ?? null));
  const published = episode?.status === "published";

  return (
    <form action={saveEpisode} className="space-y-4">
      <input type="hidden" name="series_id" value={seriesId} />
      {episode && <input type="hidden" name="id" value={episode.id} />}
      {/* The browser converts the local time to a real moment before sending. */}
      <input
        type="hidden"
        name="early_until"
        value={access === "paid_early" && until ? new Date(until).toISOString() : ""}
      />

      <Field label="Episode number" htmlFor="number">
        <input
          id="number"
          name="number"
          type="number"
          inputMode="numeric"
          min={1}
          required
          defaultValue={episode?.number ?? nextNumber}
          className={fieldClass}
        />
      </Field>
      <Field label="Title" htmlFor="title">
        <input id="title" name="title" required defaultValue={episode?.title} className={fieldClass} />
      </Field>
      <Field label="Synopsis (optional)" htmlFor="synopsis">
        <textarea id="synopsis" name="synopsis" rows={3} defaultValue={episode?.synopsis ?? ""} className={fieldClass} />
      </Field>

      <fieldset className="rounded-2xl border-2 border-line bg-surface p-4">
        <legend className="px-2 font-bold">Who can read it?</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="radio"
            name="access"
            value="free"
            checked={access === "free"}
            onChange={() => setAccess("free")}
            className="size-6 accent-[var(--brand)]"
          />
          <span>
            <strong>Free</strong> — everyone
          </span>
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="radio"
            name="access"
            value="paid_early"
            checked={access === "paid_early"}
            onChange={() => setAccess("paid_early")}
            className="size-6 accent-[var(--brand)]"
          />
          <span>
            <strong>Paid early</strong> — supporters first
          </span>
        </label>
        {access === "paid_early" && (
          <div className="mt-2">
            <label htmlFor="until" className="block font-bold">
              Free for everyone from
            </label>
            <p className="text-sm text-muted">Leave empty to keep it supporters-only for now.</p>
            <input
              id="until"
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </div>
        )}
      </fieldset>

      {/* Sticky so the buttons are always under your thumb on a phone. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row">
          <button type="submit" name="intent" value="save" className="btn btn-quiet flex-1">
            Save
          </button>
          {published ? (
            <button type="submit" name="intent" value="draft" className="btn btn-quiet flex-1">
              Unpublish (make draft)
            </button>
          ) : (
            episode && (
              <button
                type="submit"
                name="intent"
                value="publish"
                disabled={panelCount === 0}
                className="btn btn-primary flex-1 disabled:opacity-50"
              >
                {panelCount === 0 ? "Add panels to publish" : "Publish now"}
              </button>
            )
          )}
        </div>
      </div>
    </form>
  );
}
