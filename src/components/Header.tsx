import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { getCurrentUser, getProfile } from "@/lib/data";
import { SITE_NAME } from "@/lib/env";

// Slim on purpose: the comic is the hero, the chrome is second.
export async function Header() {
  const [user, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const isAdmin = profile?.role === "admin";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
        <Link href="/" className="inline-flex min-h-11 items-center text-xl font-extrabold tracking-tight">
          {SITE_NAME}
          <span className="text-brand">.</span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          {/* Studio is admin-only for now; a paid tier for other accounts comes later. */}
          {isAdmin && (
            <Link href="/studio" className="btn btn-quiet !min-h-11 whitespace-nowrap !px-3 text-sm sm:!px-4">
              Studio
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="btn btn-quiet !min-h-11 whitespace-nowrap !px-3 text-sm sm:!px-4">
              Admin
            </Link>
          )}
          {user ? (
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn-quiet !min-h-11 whitespace-nowrap !px-3 text-sm sm:!px-4">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className="btn btn-primary !min-h-11 whitespace-nowrap !px-3 text-sm sm:!px-4">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
