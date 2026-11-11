# Pathtoon Studio: plan (for Tom's approval)

Written 11 November 2026 from `STORY-STUDIO-CLAUDE-PROMPT.md` (v1.1) and the current repo.
Nothing is built yet. The build instructions for Opus are in `OPUS-BUILD.md`, next to this file.

**Updated after reading the reference files** in `studio-reference/` (`STORY-GUIDELINES.md`,
`PIPELINE-RULES.md`, `EDIT-LOG.md`, `BRAND-NOTES.md`, and Morning Brew's `story.md`,
`characters.md` and `assemble.py`). Section 5 lists what they changed.

**Assets pack added** (`studio-reference/studio-assets/`, unpacked from `studio-assets.zip`):
the Spoken Fork symbol SVGs, wordmark, lockup and app icon; the UI and lettering fonts; and the
Morning Brew test set (15 lettered panels, 15 unlettered masters plus one alternate end card,
three reference sheets, the script files, `scroll-format.md` and `letter_reference.py`).
Section 6 lists what the pack settled and what it raised.

**Now complete:** `letter_v3.py` (lettering helper) and the handbook files (`build_pdf.py`,
`handbook.yaml`, `handbook.css`, `comic-lessons-learned.pdf`) were added on 11 November.

---

## 1. Short plan

Studio is a protected `/studio` area inside the existing Next.js app. It reuses what the site
already has: Supabase sign-in, the admin check (`requireAdmin`), the `series` / `episodes` /
`panels` tables, the `panels` bucket and the admin publish flow.

| Stage | What Tom gets | Demo that proves it |
|---|---|---|
| 0. Foundation | `secrets/` folder, key-leak commit check, `RESOURCES.md`, README, `/studio/health`, the AI gateway with cost caps and dry-run, gates, version history, lessons table | Health page shows each service OK or Missing. A dry-run AI call appears in the cost log and spends nothing. |
| 1. Idea and story builder | Idea box, three loglines, question cards, "Why?" pass, one-line test, character sheets, fork engine (serial), plotline suggestions, **Story approved** gate | Take a one-line idea to an approved story. Close the browser, reopen, resume. |
| 2. Structure board | Season, episodes, acts, scenes as drag-and-drop cards with live warnings and Claude reorder diffs | Reorder scenes and watch a "prop used before introduced" warning appear and clear. |
| 3. Script | Panel-by-panel script, versions with diff and restore, the full guideline check, **Script final** gate | A failed check shows the panel number. Editing the story afterwards marks the script stale. |
| 4. Assets | Auto-detected assets, cheap options, pick and comment, character templates, **Asset designs approved** gate | Generate two options for one prop for about 8 cents and see the cost log. |
| 5. Panels, QA, lettering | Prompt builder from fixed blocks, takes side by side, single-panel regenerate, lettering in code, Claude vision QA, **Panels approved** gate | Fix one panel without touching the others. |
| 6. Preview and history | Phone preview, stitched master and slices export, history and cost dashboard | Preview scrolls like the live reader. Restore an old script version. |
| 7. Publish | Upload as **draft** to the live tables, **Publish** gate | A draft series appears in `/admin`. Nothing is public until Publish. |

Each stage ends with a demo and Tom's go before the next starts.

---

## 2. Data model

All new tables are prefixed `studio_`, have row-level security on, and are readable and writable
only by an admin (the existing `public.is_admin()` function). The public site's tables are not
changed until Stage 7.

**Projects and story**
- `studio_projects`: title, slug, `is_test`, format (`one_off` or `serial`), idea, tone, audience,
  length, chosen logline, one-line test, season summary, destination, world rules,
  `published_series_id` (empty until Stage 7).
- `studio_story_answers`: one row per question card (question key, answer, whether it was a
  suggestion or Tom's own, order). This is what makes a session resumable.
- `studio_why_items`: each action or object with no reason yet, and Tom's one-line reason.
- `studio_milestones`: ordered growth milestones (serial only).
- `studio_characters`: name, sheet (backstory, want, fear, flaw, voice, role, look with hex
  colours), signature props, `costume_always`, `costume_never`, guardrails.
- `studio_suggestions`: Claude's plotline or reorder suggestions, each accepted or rejected.

**Structure and script**
- `studio_episodes`: number, title, budget cap (default $2.50), `published_episode_id`.
- `studio_scenes`: episode, act, position, purpose (spine point or milestone), beat, characters,
  location, props, reader choice.
- `studio_forks`: per episode, the scoped vote question, in bounds, locked, backup pick,
  2 to 3 branches, the milestone each branch rejoins.
- `studio_scripts`: episode, version number, changelog line, which one is current.
- `studio_script_panels`: script, **panel key** (a permanent id that survives reordering),
  position, visual (shot, camera, characters, action), caption, dialogue, size (small, mid, tall),
  **gap after**, props, clock time, "matches panel" link.

**Art**
- `studio_assets`: kind (character, location, prop, recurring), scope (series or act), prompt,
  chosen take, status.
- `studio_panels`: episode, panel key, chosen take, lettered image path, gap after, size,
  stale flag, QA findings.
- `studio_takes`: one generated image for an asset or a panel. Kind is `exploration` or `final`,
  plus prompt, lessons applied, model, size, cost, Tom's comment, picked or not.
  A database rule stops an `exploration` take from ever being chosen for a panel or published.
- `studio_jobs`: image generation jobs in progress (see improvement 4).
- `studio_strips`: each stitched master and its slices, per version.

**Control**
- `studio_gates`: project, episode (where relevant), gate name, state (`open`, `approved`,
  `stale`), who, when, note, and a fingerprint of the content that was approved.
- `studio_gate_events`: every press, reopen and stale mark, kept forever.
- `studio_versions`: a snapshot of any story, script, asset, panel or strip, with time, cost and
  reason. Used for compare and restore.
- `studio_ai_calls`: the cost ledger. One row per Claude or KIE call: purpose, model, size,
  prompt, estimated cost, actual cost, tokens, credits before and after, dry-run or real, result.
- `studio_settings`: one row with the model ids, the price table, and the per-episode and
  per-session caps.
- `studio_lessons`: stage, problem, cause, fix, lesson, tag (writing or art), scope (global,
  series or character), status (proposed, approved, rejected), active switch.

**Storage:** a new **private** bucket `studio` for references, exploration takes, panel takes,
lettered panels and strips. The public `panels` bucket only receives approved, lettered panels at
Stage 7.

---

## 3. Suggested changes to the workflow, with reasons

1. **Add a Stage 0 before "Idea".** The prompt wants the secrets folder, the commit check and the
   cost caps in place before any key exists. They need their own milestone or Stage 1 has nothing
   safe to call.
2. **One gateway called `aiCall()`, not `generateImage()`.** The prompt routes Claude *and* image
   calls through one service. The name should say so. It reserves the estimated cost in the
   ledger first, inside one database transaction, so two clicks at once can't both slip under
   the cap.
3. **Detect "stale" by fingerprint, not by hand.** Each gate stores a fingerprint of what Tom
   approved. If the upstream content no longer matches, the gate reopens and downstream items show
   stale. Nobody has to remember to flag anything.
4. **Run image generation as background jobs.** The site is on Vercel's Hobby plan, where a
   request can't run for long. The studio starts a job, saves it, and the page checks until it's
   done. This also survives a closed browser tab. `PIPELINE-RULES.md` confirms KIE works this
   way: create a task, then poll for the result, with a separate credit-balance check.
5. **Letter and stitch in Node (sharp), not Python.** The live site can't run `assemble.py`.
   The same logic is ported to Node, with `assemble.py` kept as the reference and used to check
   the output matches. `assemble.py` is 27 lines and covers the old 11-panel version only, so
   the port also has to handle any panel count.
6. **Publish panels, not slices.** The live reader already stores each panel with its own
   gap-after and does the stitching itself (Morning Brew v4 was uploaded this way: 15 panels,
   original gaps). So Stage 7 publishes lettered panels plus gaps. The stitched 2× master and
   the 800×1280 slices are still exported, as downloads for socials.
7. **Keep generated art private until publish.** Exploration and rejected takes go to the private
   `studio` bucket, so nothing unapproved has a public link.
8. **Make "test only" a database rule.** An `is_test` project can only publish to a new series
   whose address starts with `test-`, and can never be linked to an existing series. The rule
   lives in the database, not just in the page.
9. **Voting is not on the public site yet.** The site has comments, not votes. I suggest the
   studio prepares the vote card, branches and backup pick now, the vote card publishes as the
   last panel (as v4 does), and the winning comment is picked in the studio from the live
   comments. A real vote button is a separate, later job.
10. **Brand scope.** The prompt's colours and fonts (Ink, Paper, Signal Magenta, Volt, Sora,
    Unbounded, DM Sans) differ from the live site's warm orange. I'd apply the new brand inside
    `/studio` only, as its own set of colour tokens, and leave the public site alone until Tom
    decides on a rebrand.
11. **Secrets folder needs a small loader.** Next.js only reads `.env.local` from the project
    root. A few lines in the config will load `secrets/.env.local` instead, on the server only.
    Tom then moves the existing root `.env.local` into `secrets/`. The Supabase URL and anon key
    stay `NEXT_PUBLIC_` because they are public by design; every real secret has no prefix.
12. **Models.** `claude-fable-5-2` exists and is the most capable model ($8 in / $40 out per
    million tokens). Prices for the others: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10,
    Haiku 5.5 $0.10 / $0.50 (price list cached 3 November 2026; the studio keeps them in
    settings). Suggested defaults: Fable 5.2 for story, script checks and vision QA; Haiku 5.5 for
    small jobs like turning a comment into a revised prompt.
13. **Two caps per episode, not one.** In `PIPELINE-RULES.md` the $2.50 is an *image* budget
    (plus a 40-generation limit). Morning Brew used 31 generations for 15 images, about $1.86.
    That leaves no room for Claude calls, and vision QA of 15 panels on Fable 5.2 costs real
    money. I suggest $2.50 for images and a separate Claude cap, both enforced by the gateway.
14. **Prompt lint before any spend.** The pipeline rules list a free automatic check: no
    character named who isn't in the panel, costume lock present, no time on the clock, no banned
    words ("filter", "pyjamas", "logo", sound-effect words). This runs in code before Claude's
    pre-check, so most bad prompts cost nothing to catch.
15. **Free QA checks first, Claude QA second.** Size and aspect ratio, key colours from the
    character sheet, and a similarity check against the matching panel all run in code for free.
    The pipeline's word check uses a tool the live site can't run (tesseract), so stray-text
    detection moves to the Claude vision pass.
16. **Use the pipeline's nine-block prompt order**, with the joke-carrying expression second so
    it isn't lost. It's more specific than the brief's list.
17. **"Test run" equals "exploration".** The pipeline's `--test-run` (a comparison test before
    the script is final, never publishable) and the brief's "exploration" are the same thing, so
    there is one mechanism for both.

---

## 4. Questions for Tom

1. **Missing files:** can you add `letter_v3.py` (the lettering helper) and, later,
   `build_pdf.py` with `comic-lessons-learned.pdf`? Without `letter_v3.py` the studio's caption
   boxes, balloons and clocks would be rebuilt by eye from the finished panels.
2. **Brand:** new colours and fonts for `/studio` only, or rebrand the public site too?
3. **Models:** OK to default to `claude-fable-5-2`, with `claude-haiku-5-5` for small jobs?
4. **Budget:** OK to keep $2.50 (and 40 generations) for images and add a separate Claude cap
   per episode? What should the Claude cap be? I'd start at $3.
5. **Session cap:** what counts as a session (a calendar day?) and what's the default limit?
6. **KIE:** the pipeline rules give the API details and the price ($0.06, 12 credits, per 2K
   image). Is your KIE key ready to go into `secrets/.env.local` when Stage 4 starts?
7. **Publish:** happy to publish panels plus gaps (improvement 6), with slices as a download?
8. **Voting:** prepare votes in the studio now and build the public vote button later
   (improvement 9)?
9. **Who can open `/studio`?** Any admin, or only your one account (matched by `ADMIN_EMAIL`)?
10. **Morning Brew test import:** which panel images are "the Nano Banana 2 panels"? The v4 strip
    in Downloads, or a folder of separate files?
11. **Lettering fonts: answered by the assets pack.** Comic Relief Bold for speech, Patrick Hand
    for captions, Kalam Bold for handwritten notes and labels. See question 14 about Bangers.
12. **Gate sign-off:** the pipeline rules want the Script final gate to store your exact words.
    In the studio, is pressing the button with an optional note enough?
13. **Retire `toonpipe`?** The pipeline rules describe a Python tool that isn't built yet. The
    studio would replace it. Is that the intent, or should both exist?

---

## 5. What the reference files changed

- **Story builder questions** come straight from `STORY-GUIDELINES.md` sections 1 to 6. Its
  ten-item checklist becomes the base of the script check. The brief's extra questions (need
  versus want, stakes, world rules) are added on top.
- **Script format** follows `story.md`: per panel a Visual, a Caption, optional dialogue, a size
  note, clock time in the visual, plus the spine, an end card with question, in bounds, locked
  and backup pick, a filled-in checklist, and notes for the artist.
- **Character sheets** follow `characters.md` plus the pipeline's bible fields: species, body
  shape, hex colours, costume lock (always and never), signature details, default expression,
  voice, the canonical reference image, and a "why they do what they do in this story" list.
- **New from the pipeline rules:** a prop table (owner, location and state per panel), camera
  pairs (for example panel 1 with 12, and 3 with 13), a list of every piece of in-art text and
  whether it is lettered in code, a maximum of 3 takes per panel, "change one thing per retry",
  and edit-mode as the default for fixes.
- **Gaps:** `assemble.py` uses 250 by default, 500 before a key beat and 1,200 after the sip.
  The brief gives ranges (150 to 300, 500 to 800, 1,000 or more). The studio stores a gap on each
  panel and offers those three presets plus a custom value, which the admin page already supports.
- **Lessons seed:** `EDIT-LOG.md` has 42 entries in a fixed format that can be imported as is.
  Its nine themes (continuity, props, text, camera, unrequested, expressions, layout, lettering,
  process) become the lesson tags, grouped under writing or art.
- **Test import:** script v3.5 has 14 panels and an end card, which matches the 15-panel
  "Morning Brew v4" already on the site. The test project is a separate copy and never links
  to it.
- **Brand:** the notes add Slate, Charcoal and White, contrast rules (no Ink text on Signal
  Magenta), and Google's own rules for the sign-in button.
14. **Bangers and sound effects:** the assets README says Bangers is for "sound effects only
    (QUACK!)". The house rule is no sound effects. I'd leave Bangers out of the lettering tool.
    Agreed?
15. **The test import breaks a hard rule unless we say how.** The assets README says script v3.5
    is "not yet marked final by Tom", yet 15 finished panels exist. My suggestion: import the
    script with every gate open, and import the panels marked "imported, made before the gate".
    They show in the studio for testing but can't be published until you press the gates
    yourself. OK?
16. **Is the GitHub repo private?** The pack holds unreleased art and the provisional symbol,
    about 15 MB. If the repo is public, I'd keep `studio-assets/` out of git and only commit the
    text files. Either way the zip itself shouldn't be committed.
17. **Symbol sign-off:** the Spoken Fork mark is marked provisional. OK to use it in `/studio`
    now and swap the file if you pick another?

---

## 6. What the assets pack settled and raised

- **Symbol:** `brand/symbol.svg` and `symbol-on-dark.svg` are used as they are, never redrawn.
- **UI fonts are local files:** Sora ExtraBold, Unbounded Bold, DM Sans Regular, Medium and
  Bold. The studio loads these files directly, so it doesn't depend on Google Fonts.
- **Lettering fonts** are decided (question 11).
- **Test panels:** `p01` to `p14` and `end`, 1600 px wide JPGs, lettered and unlettered. That is
  the 2x master size, so the studio keeps 1600 px masters and publishes at 800.
- **Lettering positions exist:** `letter_reference.py` holds the exact position and size of every
  caption, balloon, note, plaque, label and clock for all 15 panels, at 1600 px scale. These
  become the test project's lettering data, so re-lettering can be compared with the real panels.
- **Lettering kinds the tool needs** (from that file): caption box, speech balloon with a tail,
  pinned note with a ticked or unticked checklist, shelf plaque, jar label patch, wall clock,
  pocket watch, and the vote card laid out in code.
- **Lettering rules** (from `scroll-format.md`): text at least 24 px tall at 800 px wide, and
  nothing in the outer 40 px.
- **Stale numbering:** `scroll-format.md` and `assemble.py` still use the old 11-panel numbering
  (the sip was panel 8, now 9). This is the bug the brief warns about, and why gaps are stored
  on each panel.
