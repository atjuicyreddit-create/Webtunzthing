import type { ReactNode } from "react";

// Shared phone-friendly bits for the admin forms: big fields, 16px+ text
// (stops iPhones zooming in), and message banners.

export const fieldClass =
  "min-h-12 w-full rounded-2xl border-2 border-line bg-surface px-4 py-2 text-base";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-bold">
        {label}
      </label>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function Banner({ error, ok }: { error?: string; ok?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="mb-4 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="mb-4 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
        ✓ {ok}
      </p>
    );
  }
  return null;
}
