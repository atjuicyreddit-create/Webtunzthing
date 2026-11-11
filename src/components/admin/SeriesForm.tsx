"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveSeries } from "@/app/(site)/admin/actions";
import { slugify } from "@/lib/slug";
import type { Series } from "@/lib/types";
import { Field, fieldClass } from "./ui";

export function SeriesForm({ series }: { series?: Series }) {
  const [title, setTitle] = useState(series?.title ?? "");
  const [slug, setSlug] = useState(series?.slug ?? "");
  const [editingLink, setEditingLink] = useState(false);
  // On a new series the link follows the title until you edit it by hand.
  // On an existing series it never changes by itself (that would break shared links).
  const [linkTouched, setLinkTouched] = useState(Boolean(series));

  const shownSlug = linkTouched ? slug : slugify(title);

  return (
    <form action={saveSeries} className="space-y-4">
      {series && <input type="hidden" name="id" value={series.id} />}
      <input type="hidden" name="slug" value={shownSlug} />

      <Field label="Title" htmlFor="title">
        <input
          id="title"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />
      </Field>

      <div>
        <p className="text-sm text-muted">
          Link: <span className="font-mono">/series/{shownSlug || "…"}</span>{" "}
          <button
            type="button"
            onClick={() => setEditingLink((v) => !v)}
            aria-expanded={editingLink}
            className="min-h-11 px-1 font-bold text-brand underline"
          >
            {editingLink ? "Done" : "Edit link"}
          </button>
        </p>
        {editingLink && (
          <div className="mt-1">
            <label htmlFor="slug-edit" className="sr-only">
              Web address
            </label>
            <input
              id="slug-edit"
              value={shownSlug}
              onChange={(e) => {
                setLinkTouched(true);
                setSlug(slugify(e.target.value));
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldClass}
            />
            <p className="mt-1 text-sm text-muted">
              Lowercase letters, numbers and dashes. If it&rsquo;s already taken, a number is
              added for you.
            </p>
          </div>
        )}
      </div>

      <Field label="Tagline" htmlFor="tagline">
        <input id="tagline" name="tagline" defaultValue={series?.tagline ?? ""} className={fieldClass} />
      </Field>
      <Field label="Description" htmlFor="description">
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={series?.description ?? ""}
          className={fieldClass}
        />
      </Field>
      <Field label="Cover image address (optional)" htmlFor="cover_url" hint="A link to an image for the home page. Leave empty to use the first panel.">
        <input
          id="cover_url"
          name="cover_url"
          type="url"
          inputMode="url"
          defaultValue={series?.cover_url ?? ""}
          className={fieldClass}
        />
      </Field>

      <SubmitButton label={series ? "Save series" : "Create series"} />
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">
      {pending ? "Saving…" : label}
    </button>
  );
}
