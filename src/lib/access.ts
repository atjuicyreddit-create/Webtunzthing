import type { Episode } from "./types";
import type { Profile } from "./data";

// Is this episode still locked for this reader? Admins and supporters always
// get in; everyone else waits until `early_until` (if no date is set, it stays
// supporters-only). The database enforces the same rule on the panel images.
export function isEarlyLocked(
  episode: Pick<Episode, "access" | "early_until">,
  profile: Profile | null,
): boolean {
  if (episode.access !== "paid_early") return false;
  if (profile?.role === "admin" || profile?.plan === "supporter") return false;
  if (episode.early_until && new Date(episode.early_until).getTime() <= Date.now()) return false;
  return true;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}
