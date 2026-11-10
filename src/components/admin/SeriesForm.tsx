import { saveSeries } from "@/app/admin/actions";
import type { Series } from "@/lib/types";
import { Field, fieldClass } from "./ui";

export function SeriesForm({ series }: { series?: Series }) {
  return (
    <form action={saveSeries} className="space-y-4">
      {series && <input type="hidden" name="id" value={series.id} />}

      <Field label="Title" htmlFor="title">
        <input id="title" name="title" required defaultValue={series?.title} className={fieldClass} />
      </Field>
      <Field
        label="Web address"
        htmlFor="slug"
        hint="Lowercase letters and dashes. Leave blank to make it from the title."
      >
        <input
          id="slug"
          name="slug"
          defaultValue={series?.slug}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={fieldClass}
        />
      </Field>
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
      <Field label="Cover image address (optional)" htmlFor="cover_url" hint="A link to an image. Not shown on the site yet.">
        <input
          id="cover_url"
          name="cover_url"
          type="url"
          inputMode="url"
          defaultValue={series?.cover_url ?? ""}
          className={fieldClass}
        />
      </Field>

      <button type="submit" className="btn btn-primary w-full">
        {series ? "Save series" : "Create series"}
      </button>
    </form>
  );
}
