import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-4">
      <nav aria-label="Admin" className="mb-4 flex items-center gap-2 text-sm font-bold">
        <Link href="/admin" className="rounded-full bg-brand-soft px-3 py-2">
          Admin
        </Link>
        <Link href="/setup" className="px-3 py-2 text-muted underline">
          Setup check
        </Link>
      </nav>
      {children}
    </div>
  );
}
