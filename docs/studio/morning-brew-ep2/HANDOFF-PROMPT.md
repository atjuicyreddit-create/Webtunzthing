# Hand-off prompt: build the next Morning Brew episode from the winning reader comment

Paste everything below the line into another AI (Claude Code works best, run in
`C:\Users\tcmac\OneDrive\Documents\webzthing`). It explains the task with full context, how Episode 2
was built step by step, the choice made at every step and why, and what kind of story to write.
The finished Episode 2 script is in `docs/studio/morning-brew-ep2/script.md`: use it as the worked example.

---

## Your task

You are building the next episode of **Morning Brew**, a vertical-scroll comic (webtoon) on Pathtoon.
Each episode ends on a reader vote. Readers comment; the winning comment, screened against the story's
rules, decides what happens next. Your job is to:

1. Find the winning comment for the latest episode.
2. Screen it against the rules and settle the route.
3. Write the next episode's full script, panel by panel, in the house format.
4. Load it into Pathtoon Studio as the next episode.
5. Stop before anything that costs money (image generation, paid Claude calls) or touches the live site
   (uploading or publishing), and ask Tom first, saying what it costs.

Tom is the creator. He is not a developer: write to him in plain words, short sentences, British English.
He approves every gate and every spend.

## Read these first

- `docs/studio/OPUS-BUILD.md`: the studio's standing rules (section A is binding).
- `studio-reference/STORY-STUDIO-CLAUDE-PROMPT.md`: the original brief. Its hard rules are binding.
- `studio-reference/STORY-GUIDELINES.md` (copied in `src/lib/studio/story/guidelines.ts`): the source of
  every story check.
- `studio-reference/PIPELINE-RULES.md`: the art pipeline rules (prompt blocks, lint, QA checklist).
- `studio-reference/morning-brew/story.md` and `characters.md`: Episode 1 and the cast.
- `docs/studio/morning-brew-ep2/script.md`: Episode 2, the worked example of this task.
- `docs/studio/WINNING-COMMENT-PLAN.md`: how the Reader vote step works.

## Hard rules (never break these)

- Pudding only ever says "…quack" or "Ahh." He never smiles.
- Great-Aunt Mallow always arrives at 7. The cottage stays standing.
- Comments steer the route, never the destination. The lead's flaw (laziness) is never cured early.
- No sound effects anywhere. Captions are 7 words or fewer and only say what the picture can't show.
- All text in the art (captions, dialogue, labels, notes, clock times) is lettered in code, never drawn
  by the image model.
- British English. Original characters, names and plots only.
- Every Claude and image call goes through the studio's gateway (`aiCall`) with its estimate, ledger and
  caps. Keep dry-run on unless Tom says yes to a specific spend.
- Gates in order, pressed only by Tom: Story approved, Script final, Asset designs approved, Panels
  approved, Publish.
- Never change the live series Morning Brew, Morning brew v3 or Morning Brew v4 without Tom's explicit yes.
- Any SQL that changes data: show Tom the SQL first and let him run it. Read-only queries are fine.
- Keys stay in `secrets/.env.local`. Never print them.

## The world, in brief

- **Pudding:** a fat, dopey white duck in a striped nightcap (tail and bobble), exactly one upright
  feather, blue dungarees. Never pyjamas. Lives alone in a crooked thatched cottage in Lower Muddle.
  Flaw: laziness; he'll put a lot of effort into a shortcut to avoid a little effort.
- **Great-Aunt Mallow:** a tall, stern old goose and village witch; pointed hat, half-moon glasses,
  clipboard, pocket watch. Keeps her overflow potion stock on a HANDS OFF shelf in Pudding's kitchen.
  Inspects the cottage at 7 a.m. If he fails, he moves back in with her.
- **World rules:** every household object has a rune; tap it and it does its job by itself. Potions are
  real and strong.
- **Running devices:** a wall clock in the same spot in every kitchen wide shot, ticking towards 7; a
  cutaway of Mallow flying in; the chore note on the door; "Step one / Without…" captions; matched camera
  angles that echo earlier panels.
- **Season shape (provisional, Tom to agree):** destination "Pudding passes one of Mallow's inspections by
  his own effort, with no magic shortcuts". Milestones: Shortcuts backfire; First chore done properly;
  Asks for help; No magic all morning.

## What kind of story to write

A **cosy fantasy kitchen comedy** in 14 to 16 panels plus a vote card. Each episode is one morning,
6-ish to 7:00 a.m., with the clock as the ticking danger. Pudding wants to get out of effort; the
readers' choice is the shortcut he takes; it works in the silliest way and backfires; the ending comes
from his laziness, not luck; he takes one small real step (a "false dawn") but isn't cured; Mallow's
arrival at 7 is the button. Gags escalate in threes. Every payoff is planted earlier; every plant pays
off (in this episode or as an open plant for later). Visual comedy carries it, because Pudding barely
speaks. The tone is gentle: things break, nobody is hurt.

---

## How Episode 2 was built, step by step, with every choice

### Step 1: Find the winning comment
- **Did:** read the live comments for Morning Brew v4, Episode 1 (read-only query; the public tables are
  never written). One comment: "Make him eat a magic cake to make him big and destroy the house"
  (atjuicyreddit).
- **Choice:** used Morning Brew v4, not the older Morning Brew or v3, because v4 is the published version
  with the 15-panel episode and the vote card ("Mallow's back at 7. What does Pudding do?").

### Step 2: Screen the comment (Studio, Reader vote page)
- **Did:** linked the studio episode to the live v4 episode (read-only), ran Claude's screening once for
  real ($0.11, story model) with Tom's yes.
- **Result:** *nearly passes*. In bounds (in the cottage, before 7) and no locked line broken, but
  "destroy the house" would remove the cottage the inspections depend on, so it threatens the
  destination. Adjusted: "Pudding eats a magic cake from Mallow's shelf, swells to giant size and wrecks
  the kitchen, but the cottage is still standing when Mallow arrives at 7." Label: "the giant cake".
- **Choice:** kept the commenter's two key ideas (he gets big; the house gets smashed) and fixed only the
  one detail that broke a rule (wrecked, not destroyed). This is the brief's rule: keep the intent, fix
  one detail. Credited the commenter on the vote card, with a switch to hide it.

### Step 3: Settle the world-rule problem
- **Problem:** "magic cake" doesn't exist in this world.
- **Choice:** made it **Mallow's Growing Cake, baked for the village Giant Marrow Show**, kept on her
  HANDS OFF shelf. Why: potions and magic produce are a world rule; the shelf is her overflow stock
  (planted in Episode 1); a show cake explains why it exists and why it's at the cottage. It also gives
  a free open plant (a marrow by the gate).

### Step 4: The spine
- **Want:** the second inspection's chores done with no effort.
- **Why today:** Mallow's note "Same time tomorrow" from Episode 1's ending.
- **Flaw escalation (the key choice):** in Episode 1 he took the shortcut by accident (grabbed without
  looking). In Episode 2 he **looks, reads the label, and eats it anyway**. The growth from Episode 1's
  last page ("Looking, this time") is real, and the flaw still wins. That is funnier and keeps the series
  engine.
- **Lazy logic:** a big duck can reach every chore without walking. A shortcut that fits his character.
- **Cost and ending:** everything he touches breaks; the small print says the cake "wears off with honest
  work", so he must sweep the floor by hand to shrink back. Ending from the flaw, not luck.
- **False dawn:** the first chore he does properly, only because the magic forced him. Not cured.
- **One-line test:** "Pudding wants the chores done without lifting a feather because Mallow inspects again
  at 7, but he's lazy enough to eat her Growing Cake on purpose, so he wrecks the kitchen and has to sweep
  his way back to normal size by hand."

### Step 5: Panel plan (15 panels + vote card)
Choices, in order:
- **Panel 1 (tall, exterior):** same camera as Episode 1's first and twelfth panels, so readers recognise
  the cottage and the "after" state. The caption carries the brief's required opening: "You chose: the
  giant cake." (5 words). Plant: a marrow in a wheelbarrow.
- **Panel 2:** same camera as Episode 1's Panel 13, where it left off. Plants: ceiling footprints (from
  being stuck to the ceiling), the broom's rune. Clock 6:10 starts the countdown.
- **Panel 3:** the plant. The cake tin's label holds the warning *and* the small print that pays off
  later. Caption calls back to Episode 1's last-page caption: "Looking, this time. Reading, too."
- **Panel 4 (small):** the lazy idea, shown in his eyes. "A big duck needn't walk."
- **Panels 5 to 7: rule of three.** One crumb (nothing), one bite (a bit), the whole slice (giant).
  Captions "One crumb. Nothing." / "One bite. A bit." Panel 7 is tall with "Ahh." (one of his two words),
  then a 1,200px gap before the turn, as the pacing rule asks (big gap before the twist).
- **Panel 8:** close-up turn, "Oh. Again.", a callback to Episode 1's "Oh."
- **Panel 9 (tall):** the payoff image, giant Pudding filling the kitchen. Walls bulge but hold (rule:
  the cottage stands; nobody hurt).
- **Panels 10 and 11: a second rule of three, chores the lazy way.** Ceiling cleaned just by sitting
  (works; pays off the footprints), windows wiped (pop out: the cost). The third chore is Panel 14.
- **Panel 12 (small cutaway):** Mallow flying in, same framing as Episode 1's cutaway. "Meanwhile. Exactly
  on time." echoes "Early, as always" and keeps the locked 7:00 arrival.
- **Panel 13:** the small print pays off; his wing hovers over the broom rune (temptation).
- **Panel 14 (tall):** honest work, three poses shrinking as he sweeps by hand, gripping *below* the rune.
  Pays off Episode 1's last-panel plant by **not** using the rune. "Floor: done. Properly. Only the floor."
- **Panel 15 (tall, exterior):** the button, same camera as Panel 1. Mallow at 7:00, wrecked but standing
  cottage, empty tin on the step, Pudding with the broom. "Great-Aunt Mallow asked, this time." reverses
  Episode 1's "decided not to ask". Pudding: "…quack."
- **Vote card:** "Mallow wants answers. What does Pudding do?" Scoped to explaining or making it right
  today; locked lines restated; backup pick (the broom rune, which pays off the rune he resisted and
  escalates the runes gag); three branches (Charades, Bake it back, Hide the evidence), each rejoining a
  milestone.

### Step 6: Check it against the guidelines
- Every caption counted (all 7 words or fewer). No sound effects. Clock times on the clock field only,
  never in the visual text (the image model must not draw times).
- Plants and payoffs listed and matched (see the checklist in `script.md`). Open plants left on purpose:
  the marrow, the wobbling SWIFTNESS BEANS jar.
- Every action and object has a why.

### Step 7: Load it into Pathtoon Studio
- **Did:** imported the Morning Brew test project (local only), added the vote card branches and a
  provisional destination and milestones (the Reader vote page refuses to screen without them), linked
  the live v4 episode read-only, recorded the decision with the real screening's wording. That created
  Episode 2 with the reader route in its summary. Then entered all 15 panels on the Script page (title,
  shot, camera, characters, visual, caption, dialogue, size, gap, clock, props, text in art, notes),
  set Panel 15 to match Panel 1's camera, filled the vote card and the prop table, and named the
  episode "Big Breakfast".
- **Choice:** wrote the script by hand rather than pressing "Draft episode with Claude" (up to $1.30),
  because Tom asked for the episode to be fully written, and so every choice above is deliberate and
  explainable.
- **Free checks caught one real problem:** six panel props didn't match the prop table by name. Fixed by
  adding them with owners and rules. Then: "No problems: captions, sound effects, clocks, matched panels,
  props and the end card all look fine."
- **Panel prompt lint:** Panel 1's visual first said "Pudding's cottage" while Pudding isn't in that
  panel; the studio's prompt lint would block that (a character name in the prompt invites an extra
  character), so it was reworded to "The crooked thatched cottage".

### Step 7b: Claude's script checks, and what they taught (real spend)
- **First check ($0.60, high effort):** 6 fails, all fair: no reason to re-clean a gleaming cottage, no
  visible reason to shrink, an "empty" tin after eating one slice, a dropped plant (a wobbling jar), too
  much lettering in panel 3, the commenter not credited, panel 15 not matching panel 1's details.
- **Fixes were made in the script, not the art** (story fixes are free; art fixes cost money): the kitchen
  is messy inside; he's stuck in the door with Mallow in sight; he eats the rest of the whole cake; the jar
  thread was cut; the label went from 16 to 11 words; a small credit line in panel 1; panel 15 keeps panel
  1's marrow, well and washing line, and the popped pane lies on the lawn.
- **Mistakes to avoid (they cost $1.02):**
  - A second check at high effort ran out of tokens mid-thinking and was charged in full ($0.71). The
    studio now runs the script check at **medium** effort with a larger limit (cost about $0.30 to $0.50).
  - Editing the Script page forms by script before the page finished loading lost the text-box edits
    (React reset them), so one check ($0.31) ran on the old text. Wait for the page to load, set the
    values, read them back, then save. Verify in the database before paying for a check.
  - Every script edit clears the check, and Script final needs a check on the current version. Batch all
    edits, then check once.
- **Third check ($0.49, medium):** 5 small continuity notes (giant posture between panels 9, 10 and 13,
  the already-cut slice, broom position, label density). Accepted for v1 with a note on the gate, and the
  posture points were handled in each panel's **art direction** on the Panels page (it goes first in the
  image prompt and doesn't reopen the script).

### Step 7c: Assets (free)
- Picked the imported Morning Brew reference sheets for Pudding, Great-Aunt Mallow and the kitchen.
- Marked the 10 props "no design needed": they're described in the panel text, and a 1K reference each
  would add cost. (The Growing Cake tin appears in 6 panels; a 4¢ reference would improve consistency if
  the takes drift.)
- **Don't press "Import Morning Brew masters" on Episode 2.** Those are Episode 1's images; the button is
  now limited to Episode 1 in code.

### Step 7d: The comic production rules (added after the first art attempt)
Tom added ten rules to `studio-reference/STORY-GUIDELINES.md`, section 7 (also in the app copy
`src/lib/studio/story/guidelines.ts`). The studio enforces them: free checks in
`src/lib/studio/script/checks.ts` (`productionIssues`), a "Comic production" item on Claude's script
checklist, and Script final refuses any panel without `Risk: low|medium|high · Takes: N` in its notes.
Applied to Episode 2: risk tags on every panel; "toadstool-shaped" and "duck-shaped" rewritten as real
shapes; a close-up for the 11-word tin label; "his left foot"; one action per panel (panels 11 and 13
simplified); a prop renamed so no absent character is named in a prompt.

### Step 8: The art (real spend, $1.38 for 23 takes)
- **Pre-checks first** (Haiku, about 0.05¢ each). They found real bugs in the prompt builder, now fixed
  in `src/lib/studio/panels/prompt.ts`: an exterior shot got the kitchen setting because the text said
  "kitchen window"; the clock line asked for a kitchen clock outdoors; "blank label" was added to props
  with no label; capitalised prop names ("GROWING CAKE tin") invited drawn text; and a matched panel
  pointed at "reference 1" (the character sheet) when its pair had no image yet. **Generate a matched
  panel only after its pair is chosen** (panel 15 waited for panel 1).
- **One take per panel first** (the "Generate one take for each ticked panel" button does 12 at a time).
- **Review every image at full size** against the 6-point checklist. Accept what tells the beat.
- **What went wrong and how it was handled:**
  - KIE refused one prompt as "sensitive" (the word "scheming" in an expression line). Reworded, retried.
  - One job timed out after 10 minutes; it wasn't charged. Retried.
  - The kitchen reference sheet has a white border; the model copied it as white bands in some takes.
    Fix with one change: "Fill the empty white area at the bottom with more of the stone kitchen floor."
  - **Giant scale was the hardest thing** (rule 1 was right): the first takes showed a normal-sized duck.
    What worked: an art-direction line starting "GIANT Pudding, three times his normal size…" plus "The
    picture fills the whole frame edge to edge", then one fix for any white band. Panels 10 and 11 never
    fully landed in budget; the best take was used and noted.
  - A fix that changed posture produced a duplicate nightcap; the earlier take was chosen instead.
  - An extra orange creature turned out to be part of the approved kitchen reference (a sleeping fire
    lizard), so it was kept.
- **Studio fixes made during the art stage:** a fix is no longer blocked by Claude's pre-check (it
  advises, like a new take); each panel's take limit follows its `Takes: N` budget, not a global 3.

### Step 9: Lettering (free)
For each panel: the caption sits at the top (the prompt reserves calm space there). Move the code-drawn
clock onto the painted blank clock face (find its position in the image and convert to the 1600px-wide
master: x = fraction across × 1600, y = fraction down × master height). Place each balloon beside the
speaker with its tail at the beak. Add label patches and credit lines as extra elements. Remove a clock
element where no clock should show (panel 15 is outdoors).

### Step 10: Upload (Morning Brew v4, as a draft)
Stage 7 (publish) isn't built, so: in `/admin`, open the series, "New episode (#2)", create it (always a
draft), then add the 15 lettered images in file-name order (01.png to 15.png) with the panel uploader
and set each gap (presets 200 / 600 / 1000 / 0). Check "Preview as a reader". **Publishing is Tom's call.**

### Step 11: What comes next (needs Tom's yes for each spend)
1. Approve the story, run Claude's script check (about $0.10 to $0.70), and press **Script final**.
2. Assets: pick reference designs (the imported Morning Brew reference sheets are free; Mallow's Growing
   Cake tin may want a 1K option at about 4¢).
3. Panels: one 2K take per panel (about 6¢ each, 15 panels, so about 90¢ plus redos; the Claude pre-check
   is under 1¢ per panel). Tick the 6-point checklist, choose, letter in code (free), optional Claude QA.
   Press **Panels approved**.
4. Upload to Morning Brew v4 as Episode 2: Stage 7 (publish) isn't built, so this is done by hand in
   `/admin`, as a draft first, then published. Ask Tom before touching v4.
5. After readers comment: Reader vote page, screen, choose, and the route feeds Episode 3.

## Output Tom expects from you

- The script file in the same format as `script.md` (spine, panels, vote card, prop table, checklist,
  notes for the artist).
- The episode loaded in the Studio, free checks passing.
- A short plain-English report: what you built, what each step decided and why, what it cost, what's
  not done, and one clear question about the next spend.
