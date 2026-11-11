export function Notice({
  error,
  ok,
  warn,
}: {
  error?: string | null;
  ok?: string | null;
  warn?: string | null;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-xl border-2 border-[var(--s-magenta)] bg-white px-4 py-3 font-semibold text-[var(--s-magenta-deep)]">
          {error}
        </p>
      )}
      {warn && (
        <p role="status" className="mb-4 rounded-xl bg-[#FFF3C4] px-4 py-3 font-semibold">
          ⚠ {warn}
        </p>
      )}
      {ok && (
        <p role="status" className="s-active mb-4 rounded-xl px-4 py-3 font-semibold">
          ✓ {ok}
        </p>
      )}
    </>
  );
}
