import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { getCurrentUser } from "@/lib/data";
import { SITE_NAME } from "@/lib/env";

// Slim on purpose: the comic is the hero, the chrome is second.
export async function Header() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
        <Link href="/" className="text-xl font-extrabold tracking-tight">
          {SITE_NAME}
          <span className="text-brand">.</span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn-quiet !min-h-11 !px-4 text-sm">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className="btn btn-primary !min-h-11 !px-4 text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
