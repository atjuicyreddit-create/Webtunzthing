# Pathtoon Studio: build instructions for Opus

You are building Pathtoon Studio inside this repo. Read these three files before anything else:

1. `docs/studio/STUDIO-PLAN.md`: the approved plan, data model and open questions.
2. `studio-reference/STORY-STUDIO-CLAUDE-PROMPT.md`: the original brief. Its "Hard rules" are
   binding.
3. The reference files in `studio-reference/`: `STORY-GUIDELINES.md`, `PIPELINE-RULES.md`,
   `EDIT-LOG.md`, `BRAND-NOTES.md`, and `morning-brew/` (`story.md`, `characters.md`,
   `assemble.py`). Paths inside them starting `/workspace/...` mean this folder.
4. This file.

`PIPELINE-RULES.md` specifies a Python tool (`toonpipe`) that was never built. Treat it as the
detailed rulebook for Stages 4 to 7, implemented in this Next.js app, not as code to write.

**Assets pack:** `studio-reference/studio-assets/` (read its `README.md` first).
- `brand/`: the symbol SVGs (use as they are, never redraw; provisional until Tom signs off),
  wordmark, lockup, app icon.
- `fonts/ui/`: Sora ExtraBold, Unbounded Bold, DM Sans. `fonts/lettering/`: Comic Relief Bold
  (speech), Patrick Hand (captions), Kalam Bold (notes and labels), Bangers (titles and shout text only, never sound effects). All are SIL Open Font Licence. Copy the ones you use into the app
  (for example `src/fonts/`) and load them with `next/font/local`; sharp lettering needs the
  files on the server too.
- `morning-brew-test-pack/`: 15 lettered panels, unlettered masters, three reference sheets, the
  script files, `scroll-format.md`, `letter_reference.py`. For the test project only.
- The Python files are references to read. Do not run them: they point at `/workspace/...`
  paths that don't exist here.
- `handbook/` holds `build_pdf.py`, `handbook.yaml`, `handbook.css` and the current
  `comic-lessons-learned.pdf`: the reference for the Stage 6 PDF export.
- Do not commit `studio-assets.zip`. Ask Tom before committing the images (plan question 16).

Tom is not a developer. Write to him in plain words. He approves each stage by saying "go".

## Kickoff prompt (Tom pastes this into a new session)

> Read `docs/studio/OPUS-BUILD.md` and `docs/studio/STUDIO-PLAN.md`. Build **Stage [N]** only.
> First tell me in a few lines what you will build and list any SQL I need to run. Wait for my
> go. When you finish, demo it to me against the stage's "Done when" list, then stop.

---

## A. Standing rules (every stage)

**A1. One stage at a time.** Build only the stage Tom named. Demo it. Stop.

**A2. Hard rules from the brief are enforced in code, not just in the page.**
- Gates in order: Story approved, Script final, Asset designs approved, Panels approved, Publish.
  Only a button press by Tom sets one. Every press records who, when and a note.
- No `final` panel take can be created for an episode unless its Script final gate is approved.
  Check this in the server action *and* with a database rule.
- `exploration` takes can never be chosen for a panel or published. Database rule.
- Every Claude and KIE call goes through `aiCall()` (A6). No other file may import the Anthropic
  SDK or call KIE.
- Text is never AI-drawn. Dialogue, captions, clocks and numbers are lettered in code.
- One fix regenerates one panel. Never loop over all panels to fix one.
- `is_test` projects never write to an existing series. Database rule.

**A3. Secrets.**
- Never print, log, echo or paste a key or an `.env` value, including in error messages.
- Real keys live only in `secrets/.env.local` (git-ignored) and in Vercel's env vars.
- No secret gets a `NEXT_PUBLIC_` prefix. Only the Supabase URL, the Supabase anon key and the
  site URL are public.
- Before the first commit of Stage 0, prove the ignore rules with `git check-ignore`.

**A4. Database changes.**
- Write each change as a numbered file in `supabase/migrations/` (next is `0005_...`). Make it
  safe to re-run.
- Tom's standing rule: show him the SQL and what it does before it runs. The Supabase MCP
  `apply_migration` tool has been declined in this project, so **Tom runs the SQL himself** in the
  Supabase SQL Editor. Afterwards, confirm it with a read-only query.
- Every `studio_` table: row-level security on, admin-only via `public.is_admin()`.
- Never touch the `auth` or `storage` schemas without showing Tom the SQL first.

**A5. This repo's habits (already learned the hard way).**
- Stack: Next.js 15 App Router, React 19, Tailwind 3, `@supabase/ssr`. Server reads go through
  `src/lib/data.ts`. Admin pages use `requireAdmin()` from `src/lib/admin.ts`.
- **One server action per button** (`formAction={...}`). A button's `name`/`value` does not reach
  a server action here; that bug made Publish silently behave like Save.
- Show a pending state on every submit button (`useFormStatus`), and disable it while pending.
- Tap targets are at least 44px. Check every page at 375px wide, in light and dark.
- The project folder is in OneDrive. **Stop the dev server and delete `.next` before
  `next build`**, or the build output corrupts. Never run a build while `next dev` is running.
- Pushing to `main` deploys to Vercel automatically. Vercel is on the Hobby plan: keep every
  request short (A7).
- Deleting a row that owns files must also delete the files (see `removeEpisodeFolder`).
- Don't touch the live series "Morning Brew", "Morning brew v3" or "Morning Brew v4".

**A6. The AI gateway: `src/lib/studio/ai/aiCall.ts`** (server only).
Every call does these steps in order:
1. Build the request and **estimate the cost** from the price table in `studio_settings`.
2. Check the per-episode cap and the per-session cap. Reserve the estimate in `studio_ai_calls`
   inside one database function, so parallel calls can't both pass. Warn at 80%. Refuse at 100%.
3. If dry-run is on, record the row as `dry_run` and return a canned result. Spend nothing.
4. Call the provider. Record model, size, prompt, tokens, actual cost and credits before and
   after. On failure, record the error and release the reservation.
5. Return the result plus the ledger row id, so the page can show "this cost $0.06".

Claude specifics (TypeScript, official `@anthropic-ai/sdk` only):
- The model id comes from `studio_settings`. Defaults: `claude-fable-5-2` for story, script checks
  and vision QA; `claude-haiku-5-5` for small jobs. Never hard-code a model id in a feature file.
- Fable 5.2: don't send `thinking: {type: "disabled"}`, `budget_tokens`, `temperature`,
  assistant prefill, or forced `tool_choice`. Control depth with `output_config.effort`
  (start at `high`; use `low` or `medium` for routine cards).
- Get JSON back with structured outputs (`output_config.format` / `client.messages.parse`).
- Stream anything long and use `.finalMessage()`.
- Always check `stop_reason`. Handle `"refusal"` (show Tom a plain message) and `"max_tokens"`.
  Enable the server-side fallback (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and tell Tom it's on.
- Put the stable material first (guidelines, house rules, active lessons, character sheets) with
  `cache_control`, and the changing question last. Log `cache_read_input_tokens`.
- Compute actual cost from `response.usage`. Before writing SDK code, read the `claude-api`
  skill; don't write SDK calls from memory.

KIE specifics (from `PIPELINE-RULES.md` 1.7; check them against KIE's live docs before the
first paid call, and tell Tom if anything differs):
- Create a task with `POST https://api.kie.ai/api/v1/jobs/createTask`, poll
  `/api/v1/jobs/recordInfo`, read the balance from `/api/v1/chat/credit`, and upload reference
  images through KIE's file upload.
- Default model Nano Banana 2 at 2K, PNG, $0.06 (12 credits). Aspect ratios: tall 9:16,
  mid 3:4, small 4:3. Exploration uses 1K, about $0.04. Prices live in `studio_settings`.
- Key in `KIE_API_KEY` only. Read the credit balance before and after each run and log both. If
  the balance goes *up*, flag a top-up; never record negative spend.
- At most 3 takes per panel by default. A retry changes one thing. Fixes use edit mode with the
  current take as the first reference.

**Caps:** each episode has an image cap ($2.50 and 40 generations by default) and a separate
Claude cap, pending Tom's answer in the plan. Both go through the same reservation function.

**A7. Long work runs as jobs.** Image generation: create a `studio_jobs` row, start the provider
task, return at once, and let the page poll a short status route. No request waits on an image.

**A8. Versions and staleness.**
- Any save of story, script, asset, panel or strip writes a `studio_versions` snapshot with a
  reason.
- Each gate stores a fingerprint of the content it approved. On any upstream save, recompute; if
  it differs, set the gate to `stale` and mark downstream items stale. Never clear a gate silently.

**A9. Claude never fixes silently.** Failed checks, QA findings, reorders and lesson proposals are
shown as notes or diffs that Tom accepts or rejects. Every AI action shows its cost first and has
Undo (restore the previous version).

**A10. Testing and finishing a stage.**
- `npx tsc --noEmit` and a clean `next build` must pass.
- Walk the stage's "Done when" list in a real browser, locally, then on the live site after the
  push. Tom signs in himself; never enter credentials.
- Use throwaway data named "TEST - delete me" and delete it afterwards, files included.
- Commit and push only when the list passes. Give Tom a pass/fail checklist, including what you
  did not test.
- Update `RESOURCES.md` and `README.md` whenever a stage adds a service, key, package or table.

---

## B. Stages

### Stage 0: Foundation
**Build**
- `.gitignore` rules for `secrets/*` (keeping `.env.example` and `README.md`), `.env*`,
  `!.env.example`. Prove with `git check-ignore`. This is the first commit.
- `secrets/.env.example` (every variable, empty, one comment each), `secrets/README.md`.
- A loader so the server reads `secrets/.env.local` (for example `loadEnvConfig` from `@next/env`
  in `next.config.mjs`). Ask Tom to move the existing root `.env.local` there. Don't read it.
- A pre-commit check: `.githooks/pre-commit` running a small Node script that blocks staged
  content that looks like a key (`sk-ant-`, long JWTs, `service_role`, etc.), enabled with
  `git config core.hooksPath .githooks`. Document that step in the README.
- `RESOURCES.md` and a non-developer `README.md` section, as the brief describes.
- Migration `0005_studio_foundation.sql`: `studio_settings`, `studio_projects`, `studio_gates`,
  `studio_gate_events`, `studio_versions`, `studio_ai_calls`, `studio_lessons`, the cap
  reservation function, and the private `studio` bucket with admin-only rules.
- `/studio` layout: `requireAdmin`, left stepper, middle work area, right suggestions panel, with
  the Studio brand tokens scoped to `/studio` (pending Tom's brand answer). Colours, contrast
  rules and fonts are in `BRAND-NOTES.md`; load Sora, Unbounded and DM Sans from the local
  files in the assets pack with `next/font/local`. Use `brand/symbol.svg` (and the
  on-dark version) as it is. Don't redraw the symbol.
- `/studio/health`: each service OK or Missing, never showing a value.
- `aiCall()` with dry-run, the ledger and both caps. A settings page for model ids, prices, caps.
- A projects list with create, rename, delete, and the `is_test` flag.

**Done when**
- A fake key in a staged file blocks the commit.
- `/studio` redirects a signed-out visitor and 404s a non-admin.
- Health shows the right OK or Missing for each service.
- A dry-run call writes a ledger row and spends nothing. A call over the cap is refused with a
  clear message. The 80% warning shows.

**Morning Brew test import (build the importer in the stage that first needs each part):**
project flagged `is_test`; script v3.5 from `story.md` and `characters.md` in Stage 3; panels,
masters and reference sheets in Stages 4 and 5. Tom has **not** marked v3.5 final. Import with
every gate open, and mark the panels "imported, made before the gate" so they are visible for
testing but unpublishable until Tom presses the gates himself (pending plan question 15).
Never pre-approve a gate in seed data.

### Stage 1: Idea and story builder
**Source:** `studio-reference/STORY-GUIDELINES.md` sections 1 to 6 are the question bank; its
checklist is the base of the Stage 3 script check. Character sheets follow
`morning-brew/characters.md` plus the bible fields in `PIPELINE-RULES.md` 1.4.
**Build** the Idea box and three loglines; one-question cards with 3 to 4 suggestions, a "why this
works" line each and "Write my own"; the spine order from the brief; skipping questions the idea
already answers; going back to a card with a "this affects..." list; the "Why?" pass; the one-line
test; character sheets with costume always/never and guardrails; for serials, destination,
milestones, fork questions, backup picks and branches; the plotline suggestions; the
**Story approved** gate. Autosave everything.
**Done when** an idea reaches an approved story; closing and reopening resumes at the same card;
changing an answer after approval turns the gate stale; every Claude call shows its cost and
appears in the ledger.

### Stage 2: Structure board
**Build** season, episodes, acts and scenes as cards with drag and drop (`@dnd-kit`), add, split,
merge, delete; each card's purpose, beat, characters, location, props, reader choice; live
warnings (prop before introduction, real-world steps out of order, plant with no payoff, scene
with no purpose); Claude reorder suggestions shown as a diff.
**Done when** reordering works by mouse and by keyboard, each warning can be triggered and
cleared, and an accepted reorder can be undone.

### Stage 3: Script and its gate
**Source:** `morning-brew/story.md` is the format to match (spine, panels, end card, checklist,
artist notes). Add the pipeline's script checks from `PIPELINE-RULES.md` 1.2: format decided, a
prop table (owner, location, state per panel), camera pairs checked against the props each must
show, and a list of every in-art text item marked model-drawn or lettered in code.
**Build** the panel-by-panel editor with stable panel keys; caption counter (7 words or fewer);
size, gap after, props, clock time, "matches panel"; versions with changelog, diff and restore;
the full script check, pass or fail with a panel number per item; the per-episode
**Script final** gate.
**Done when** a deliberately broken script fails the right checks with panel numbers, nothing is
auto-fixed, restore works, and a later story edit turns the gate stale.

### Stage 4: Assets
**Source:** `PIPELINE-RULES.md` 1.4, 1.5 and 1.7. References are attached only for characters
in the image. For a matched shot, the panel to match is the first reference.
**Ask Tom first:** is `KIE_API_KEY` in `secrets/.env.local`?
**Build** asset detection from the final script; series-level character templates; act-level
story assets; 2 to 4 cheap exploration options per asset as jobs; pick, comment, and
comment-to-revised-prompt; the **Asset designs approved** gate.
**Done when** options generate within the cap, the cost per image is logged, exploration images
are labelled and can't be published, and the page is blocked until Script final is approved.

### Stage 5: Panels, lettering and QA
**Source:** `PIPELINE-RULES.md` 1.6 to 1.9 and `EDIT-LOG.md`.
- Build prompts in the pipeline's nine-block order (1.6), not the shorter list in the brief.
- Run the free prompt lint (1.6) before Claude's pre-check and before any spend.
- Run the free QA checks in code with sharp (size, aspect, key colours, similarity to the
  camera-pair partner or to an old reference). Tesseract is not available on Vercel, so the
  stray-text check belongs to the Claude vision pass.
- Keep the manual QA tick-list from 1.8; a take can't be picked until it's ticked.
- Seed `studio_lessons` from the 42 `EDIT-LOG.md` entries (fixed field format; themes map to
  tags). Imported lessons start inactive until Tom approves them, except the six "key lessons"
  in the brief.
- Lettering fonts are decided: Comic Relief Bold for speech, Patrick Hand for captions, Kalam
  Bold for notes and labels. No Bangers, no sound effects.
- `morning-brew-test-pack/script/letter_reference.py` lists every lettering element and its position
  for all 15 panels at 1600 px scale. Build the same element kinds (caption box, balloon with
  tail, pinned note with checklist, plaque, jar label patch, wall clock, pocket watch, vote card)
  and store positions per panel as data, not code. Import these positions for the test project
  and compare your lettered output with `morning-brew-test-pack/panels/`.
- `studio-reference/morning-brew/letter_v3.py` draws those elements (caption box, balloon,
  note, plaque, label, clock, watch). Port its drawing maths to Node; don't run it.
- From `scroll-format.md`: text at least 24 px tall at 800 px wide; nothing in the outer 40 px.
- Masters are 1600 px wide; publish at 800.
**Build** the prompt builder from fixed blocks (style, locks only for characters in the panel,
asset references, shot, action, "do not add" list, active lessons) with a Claude pre-check;
takes side by side with prompt and cost; single-panel regenerate; lettering in code with bundled
fonts (bubbles, captions, clocks) using sharp; Claude vision QA per lettered panel; lesson
proposals on reject or QA finding, approved by Tom; the lessons seed from `EDIT-LOG.md`;
the **Panels approved** gate.
**Done when** one panel can be regenerated and re-lettered without touching the others, each
prompt lists the lessons applied to it, and QA findings are shown, not acted on.

### Stage 6: Preview, stitch and history
**Source:** `morning-brew/assemble.py` and `PIPELINE-RULES.md` 1.10. Note that `assemble.py`
hard-codes 11 panels and keeps gaps in numbered lists (`BEFORE = {7: 500}`, `AFTER = {9: 1200}`),
which is exactly what the brief says not to do. Keep its maths (resize to 800 wide, the gap
between two panels is the larger of "after" and "before", one default gap of padding top and
bottom, slices of 1280), but read each gap from the panel record.
**Build** the stitch in Node (ported from `assemble.py`, output compared against it), the 2×
master and 800×1280 slices as downloads, the phone-frame preview using the live `Reader`
component, the history browser with compare and restore, the cost dashboard per episode and
season, and the lessons PDF export.
**Done when** the preview matches the live reader's spacing, a restore brings back an old
version, and the dashboard totals match the ledger.

### Stage 7: Publish
**Source:** `PIPELINE-RULES.md` 1.11: fail the publish if any panel is older than its source or
isn't in the current script (the "old Panel 13" trap).
**Build** upload of approved, lettered panels to the `panels` bucket and creation or update of
`series`, `episodes` and `panels` rows through the same model `/admin` uses (panels plus
`gap_after`, cover, text). Always save as a draft. The **Publish** gate publishes. Enforce the
`is_test` rule: new series only, address starting `test-`, never linked to an existing series.
**Done when** a studio episode appears in `/admin` as a draft, the public site doesn't show it
until Publish, a test project can't reach a live series even by a hand-made request, and
re-publishing after one panel fix replaces only that panel.

---

## C. Ask Tom, don't guess
Stop and ask when: a reference file is missing; a KIE detail is unknown; a rule in the brief
conflicts with what the repo does; a change would touch the public site's look or the live
series; or any step would spend real money for the first time in a stage.
