import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export default async function AdminHome() {
  const { supabase } = await requireAdmin();
  const { data: series } = await supabase
    .from("series")
    .select("id,title,slug,episodes(id,status)")
    .order("created_at", { ascending: true });

  return (
    <>
      <h1 className="text-3xl font-extrabold">Your comics</h1>

      <Link href="/admin/series/new" className="btn btn-primary mt-4 w-full">
        ＋ New series
      </Link>

      {(series ?? []).length === 0 ? (
        <p className="mt-6 rounded-3xl border-2 border-dashed border-line p-6 text-center text-muted">
          Nothing here yet. Create your first series.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {series!.map((s) => {
            const eps = (s.episodes ?? []) as { status: string }[];
            const live = eps.filter((e) => e.status === "published").length;
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/series/${s.id}`}
                  className="block rounded-2xl border-2 border-line bg-surface p-4 transition hover:border-brand"
                >
                  <span className="block text-xl font-extrabold">{s.title}</span>
                  <span className="block text-sm text-muted">
                    {live} published · {eps.length - live} draft
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
