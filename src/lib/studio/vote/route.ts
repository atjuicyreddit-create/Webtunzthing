import type { ReaderRoute } from "./types";

/** What the structure and script prompts say about the reader vote that leads into an episode. */
export function readerRouteText(r: ReaderRoute | null | undefined): string {
  if (!r?.route) return "";
  return `READERS CHOSE (from the vote at the end of episode ${r.from_episode}): ${r.route}
Open this episode by narrating "${r.you_chose}"${r.credit ? ` and credit ${r.credit} in that caption or the end card` : ""}.
Follow the prepared branch "${r.branch}" and rejoin the milestone "${r.rejoins || "the next milestone"}" by the end of the episode.
The destination doesn't change.`;
}
