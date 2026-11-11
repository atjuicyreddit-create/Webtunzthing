# Pathtoon Studio: resources

Everything the studio needs, in one place. Kept up to date at every stage.
Last updated: 11 November 2026 (Stage 3).

## Services and keys

| Service | Used for | Cost | Sign up | Env var(s) | First needed |
|---|---|---|---|---|---|
| Supabase | Sign-in, database, image storage | Free tier | supabase.com | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design) | Stage 0 (already set up) |
| Vercel | Hosts the live site | Free (Hobby) | vercel.com | none (set the other vars there) | Stage 0 (already set up) |
| GitHub | Code; pushing `main` deploys | Free | github.com | none | Stage 0 (already set up) |
| Anthropic (Claude) | Story questions, script checks, panel QA | Paid per token. Fable 5.2 $8 in / $40 out per million tokens; Haiku 5.5 $0.10 / $0.50. Prices live in Studio settings | platform.claude.com | `ANTHROPIC_API_KEY` (server only) | Stage 1 |
| KIE | Images (Nano Banana 2) | Paid per image: about $0.04 at 1K, $0.06 at 2K | kie.ai | `KIE_API_KEY` (server only) | Stage 4 |

Also used: `ADMIN_EMAIL` (who may open `/studio`) and `NEXT_PUBLIC_SITE_URL`.
Not used by the studio: `SUPABASE_SERVICE_ROLE_KEY`.

Real values live only in `secrets/.env.local` (git-ignored) and in Vercel's env vars.
Never give a secret a `NEXT_PUBLIC_` prefix.

## Local tools

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 or newer (tested on 26) | Runs the site and studio |
| npm | comes with Node | Installs packages |
| Git | any recent | Saves and pushes code; the commit check runs here |
| Python + Pillow | not needed | The old `assemble.py` and lettering scripts are references only; the studio does this in Node |
| Supabase CLI | not needed | SQL is run in the Supabase SQL Editor |

## npm packages added for the studio

| Package | Why |
|---|---|
| `@anthropic-ai/sdk` | Official Claude client. Only `src/lib/studio/ai/aiCall.ts` may import it |
| `server-only` | Makes the build fail if server code (keys, gateway) is ever imported into the browser |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Drag and drop on the structure board, with keyboard and touch support |

Later stages will add `sharp`-based lettering (stage 5; sharp is already installed).

## Fonts (SIL Open Font Licence, bundled in `src/fonts/studio/`)

| Font | Role |
|---|---|
| Sora ExtraBold | Wordmark only |
| Unbounded Bold | Studio headlines |
| DM Sans Regular, Medium, Bold | Studio interface |
| Comic Relief Bold, Patrick Hand, Kalam Bold | Lettering (speech, captions, notes); added in stage 5 |

## Storage buckets

| Bucket | Public? | What's in it |
|---|---|---|
| `panels` | Public | Published panel images (the live site) |
| `studio` | **Private** | References, exploration and panel takes, lettered panels, strips |

## Database tables

Public site (unchanged): `profiles`, `series`, `episodes`, `panels`, `comments`.

Studio (migration `0005_studio_foundation.sql`, admin-only):

| Table | Holds |
|---|---|
| `studio_settings` | One row: model ids, price table, limits, dry-run switch |
| `studio_projects` | Each comic project (title, format, test flag) |
| `studio_episodes` | Episodes and their per-episode limits |
| `studio_gates`, `studio_gate_events` | The five approval gates and every press, reopen and stale mark |
| `studio_versions` | Snapshots of everything for compare and restore |
| `studio_ai_calls` | The cost ledger: every Claude and image call, estimate and actual |
| `studio_lessons` | Lessons learned, proposed and approved |

Stage 1 (migration `0006_studio_story.sql`, admin-only; also adds idea, tone, audience, length,
loglines, one-line test, season summary and destination to `studio_projects`):

| Table | Holds |
|---|---|
| `studio_story_answers` | One row per question card: the answer, where it came from, and the last suggestions |
| `studio_why_items` | The Why? pass: each item without a reason, and Tom's one line |
| `studio_characters` | Character sheets (look, colours, costume locks, guardrails…) |
| `studio_milestones` | A serial's growth milestones, in order |
| `studio_suggestions` | Claude's plot suggestions, accepted or rejected |

Stage 2 (migration `0007_studio_structure.sql`, admin-only; adds summary and milestone to `studio_episodes`,
and a `payload` column to `studio_suggestions` for reorder suggestions):

| Table | Holds |
|---|---|
| `studio_acts` | Acts within an episode, in order |
| `studio_scenes` | Scene cards: purpose, beat, characters, location, props, plants, payoffs, real-world step, vote question |

Function: `studio_reorder_episodes` (renumbers episodes in one go).

Stage 3 (migration `0008_studio_script.sql`, admin-only):

| Table | Holds |
|---|---|
| `studio_scripts` | Each version of an episode's script (changelog, Claude's check of that version) |
| `studio_script_panels` | Panels of a version: visual, caption, dialogue, size, gap after, props, clock, matched panel, text in art |
| `studio_props` | The project's prop table (owner, rule) |
| `studio_forks` | A serial episode's vote card: question, in bounds, locked, backup pick, branches |

The Morning Brew test import reads `studio-reference/morning-brew/` on your computer, so it only works locally.

Functions: `studio_reserve_ai_call` (checks limits and reserves cost, under a lock), `studio_finish_ai_call`.
