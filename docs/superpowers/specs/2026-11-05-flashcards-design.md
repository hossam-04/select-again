# Flashcards for SELECT Again: design

Status: approved and built (see "As built" at the end). Date: 2026-11-05.

## Why

The course teaches through runnable examples, quizzes and graded problems, but nothing brings a fact back a month later. Flashcards add spaced recall next to the quizzes; they don't replace them. A prompt appears, you answer in your head, then reveal the answer and rate yourself.

Cards are **generated at build time from content the build already checks**, so they can't drift from the lessons. Nothing gets hand-copied.

## Goals, non-goals, anti-goals

- **Goals:** recall practice on a Leitner schedule; cards that come from verified sources and link back to them; a schedule that survives reloads and travels in the progress code; full keyboard use, screen-reader support, both themes and a phone layout.
- **Non-goals:** an SM-2/Anki algorithm, cards you write yourself in the page, syncing, practising cards early (a "cram" mode), repeating failed cards in the same session.
- **Anti-goals** (failure even if it technically works):
  - an import that removes or rewinds progress;
  - a card that changes its id when an unrelated module is edited;
  - SQL on a card that the build never ran;
  - LeetCode's text on a card;
  - the same fact drilled two or three times under different card types;
  - a code pasted into an older copy that silently drops the schedule.

## Card types

Approximate counts are from today's content.

| Type | From | Front | Back | ≈ count |
|---|---|---|---|---|
| **Quiz** | each `? …` in a `:::quiz` | The question, without options. Exception: stems marked `{options}` also show the options (see below). | The correct option and the explanation. | 72 |
| **Callout** | `:::gotcha`, `:::key`, `:::dialect`, `:::work`, plus opted-in `:::tip` and `:::interview` | Kind label, title, and a prompt set by the kind | The callout body | 53 |
| **Cheat sheet** | table rows, the evaluation-order line, and bullets with a marked hidden part | Section name, plus the row's first cell or the bullet with its marked part blanked | The rest of the row, or the full bullet with the hidden part shown | ≈ 50 |
| **What's wrong?** | each trap in `problems/*.mjs` | Prompt "What's wrong with this query?", then the task, the tables line, and the wrong SQL | The trap's `why` and the solution SQL | 145 |
| **Which approach?** | one per problem | Prompt "Which approach?", then the task and the tables line | Patterns, the solution's `explain`, and the solution SQL | 78 |
| **What does this return?** | short module examples (rule below) | The setup data (if any) and the SQL | The result table the build computed | ≈ 6 |

That's about 400 cards.

### Decisions per type

**Quiz.** A few stems only make sense with their options. Today those are "Which query finds customers with no orders safely…", "An index on `(last_name, first_name)` can speed up which query?" and "Which condition can use an index on `created_at`?". They get a `{options}` marker on the `?` line, which the page strips. Their card front lists the options as plain text, and you still recall the answer instead of clicking one. The build warns about any stem that starts with "Which" followed by query, condition or statement and has no marker.

**Callouts.**
- The front is the kind label, the title and a prompt set by the kind:
  - gotcha: "What's the catch?"
  - key: "Explain it, and why it holds."
  - dialect: "How does MySQL compare with other databases?"
  - work: "What should you know when it comes up at work?"
- An explicit `{ask: …}` at the end of the `:::kind Title` line overrides the prompt. I'll use it wherever the template reads badly, and on every opted-in tip and interview callout.
- The build requires a title on every carded callout. Ten have none today: 2 gotchas, 7 dialects and 1 work note. I'll write titles for them, and the titles show on the page too.
- On `tip`, `interview` and `work`, my recommendation:
  - **`work`: all 6 become cards.** They're concrete facts with consequences: deep OFFSETs, `group_concat_max_len`, the double-join bug, correlated subqueries on big tables, deadlocks, denormalising.
  - **`tip`: opt-in, 3 of 6.** In: AUTO_INCREMENT/`LAST_INSERT_ID()`, `EXPLAIN ANALYZE`, safe-update habits (`sql_safe_updates`). Out, because they're study advice: "A good order", the AND/OR parentheses habit, grain comments.
  - **`interview`: opt-in, 1 of 8.** In: "When interviewers ask for recursion", which lists the recursive-CTE signals. Out: the rest are delivery advice ("say it out loud", "narrate as you type"), and the NOT IN one repeats a key-idea card.
- Markers: `{card}` opts a block in, `{nocard}` opts one out. Defaults: gotcha, key, dialect and work are in; tip and interview are out.

**Cheat sheet.**
- Each table row becomes a card. The front is the section name plus the first cell ("Dates: month key"); the back is the other cells.
- The evaluation-order line becomes one card: "In what order are the clauses evaluated?"
- A bullet becomes a card only where I mark its hidden part with `{{…}}` in `cheatsheet.md`. The cheat-sheet page renders the marked part as plain text.
- I skip bullets that repeat a gotcha, key-idea or quiz card. For example, "`NOT IN` + NULL returns nothing" is already a key idea.
- Each section is assigned to a module with `## NULL rules {module=filtering}`, which the page strips. That module sets when its cards join your deck and which filter shows them. The build fails if a section has no module.
- Code blocks on the cheat sheet (the query skeleton and the patterns block) are left out, because the build doesn't run them (see "Left out").

**What's wrong? / Which approach?**
- Neither type has a one-line task, so the front shows the whole task. It's your own text, about 200 characters at the median and 405 at most.
- A compact tables line follows, derived from the schema: `Customer(id, name, referee_id)`.
- LeetCode's title stays off the front. The source link on the back reads "#584 …", the way the rest of the page does.
- Trap ids are `p<id>.trap<n>`, as you asked. Reordering a problem's traps therefore reassigns their schedules; adding one at the end doesn't.

**What does this return?**
- It's worth it only in a narrow form. 65 of the 71 short-result examples run on the sample shop, and you can't predict their output without its data.
- So the rule is: the example runs on the `empty` database or on a named setup of 12 rows or fewer (shown on the card). It has 8 result rows or fewer and 5 columns or fewer, with no error, warning or EXPLAIN.
- Today that gives about 6 cards: BETWEEN on timestamps, ON DUPLICATE KEY UPDATE, INSERT IGNORE / REPLACE, the transfer transaction, and the denormalised-cities example.
- `{nocard}` on the code fence opts an example out.

## Card ids

Each card gets an id built from its source, never its position on the page:

- `<module>.quiz.<slug(question)>`
- `<module>.<kind>.<slug(title)>`
- `sheet.<slug(section)>.<slug(row's first cell or bullet's hidden part)>`
- `<module>.out.<slug(example title, or the first 40 characters of its SQL)>`
- `p<id>.trap<n>`
- `p<id>.approach`

Slugs use the same function as heading anchors. The existing positional ids (`basics-q1`, `filtering-ex5`) are never part of a card id. Two cards with the same id fail the build, with a message naming both sources.

Each card also has a **short code hash**: 30 bits of FNV-1a over the id, written as 5 base64url characters. The build computes it and ships it with the card. The build fails if two cards share a hash. Only the progress code uses it.

## Scheduling

- **Boxes** 1–6 with intervals of 1, 3, 7, 16, 35 and 80 days. A new card counts as being in box 1. Again → box 1. Good → box + 1. Easy → box + 2. The box is capped at 6. Due day = the day you reviewed it + that box's interval. A late review is scheduled from the day you actually reviewed it.
- **A day** is your local calendar date: `Date.UTC(y, m, d) / 86400000` built from the local date fields. That avoids milliseconds-divided-by-a-day maths, which breaks around DST. The scheduler takes `today` as an argument, so tests can inject the clock. A code moved between time zones can be a day off. That's accepted.
- **Your deck** holds every card that:
  - has a schedule entry (you've reviewed it), or
  - belongs to a finished module or one you added early, or
  - comes from a solved problem.

  Un-finishing a module removes only its cards you haven't reviewed yet.
- **New cards per day:** at most 20, counted in a local-only `[day, n]`. They come in module order, then source order within a module. Problem cards follow their module's other cards.
- **Studying one module** adds the module (if needed) and shows its due cards and **all** of its new cards, past the limit. Those new cards still count toward today's 20.
- **A session** shows due cards first, oldest due day first, then new cards up to today's allowance. The module filter narrows both. Cards you rate Again come back tomorrow, not later in the same session.
- **Reset schedule** (two clicks, no dialog) clears every review, the early-added modules and today's new-card count. Cards from finished modules and solved problems stay in the deck as new. Because importing only adds, importing an older code afterwards brings its schedule back. The README will say so.

## Storage

These keys are added to `select-again:v1` and saved with the same debounced `save()` in a try/catch:

- `cards: { "<card id>": [box, reviewDay] }`. It uses full ids so it stays readable. Entries for ids this build doesn't know are kept, since another version may know them, and ignored.
- `cardAdd: { "<module id>": time }` lists the modules added early.
- `cardNew: [day, count]` is local only.

`load()` gets the new defaults in both `app.js` and the test's `DEFAULTS`. Schedule entries are checked one by one, so one bad entry can't wipe the rest.

## Progress code

- **Format:** `SQ2:` + base64(JSON). The JSON has the existing five keys plus `cardAdd` and `k`, a packed schedule string *inside* the JSON. That keeps the rule that any truncated code is refused.
- **`k`** holds comma-separated groups, one per (review day, box): 3 base36 characters for the day, 1 for the box, then 5-character hashes. A malformed group refuses the whole code as incomplete.
- **Merge rules,** added to `lib/progress.js`:
  - For each card, the entry with the later due day wins; on a tie, the later review day wins; if that ties too, the entry already here stays.
  - Hashes this build doesn't know are skipped, like unknown problems.
  - `cardAdd` merges as a union.
  - The summary adds "… and N flashcard reviews".
- **Older codes:** `SQ1:` codes still import as before.
- **Newer codes:**
  - `SQ3:` and later get "This code is from a newer version of SELECT Again. Download the page again, then import."
  - An `SQ2:` code pasted into a copy from before this change gets that copy's existing message: "That is not a progress code from this course. Codes start with SQ1:". It fails visibly, but the wording is misleading, and an old file can't be fixed after the fact.
  - To make up for it, the progress panel says: "Copies of the page downloaded before November 2026 can't read this code. Download sql-course.html again."
  - The existing test that asserts `SQ2:` is rejected changes accordingly.
- **Size:** a full course today (all 78 solved, every module finished, every quiz taken, no drafts) is **5.9 KB**. Simulating about 500 reviewed cards adds **3.7–4.0 KB**, roughly 7.5 characters per card, depending on how many review days the deck is spread over. Four-character hashes would save about 0.8 KB, at a real risk of hash collisions as content grows, so I'm keeping 5.

## The page

```
#cards                                 Flashcards
┌──────────────────────────────────────────────────────────────┐
│ 12 due · 20 new today · 186 in your deck · 214 not added yet │
│ [Module: All ▾]           [ Review 32 cards ]                │
├──────────────────────────────────────────────────────────────┤
│ SELECT module, cards, in_deck, due FROM flashcards;          │
│ 02 Filtering and NULL     34   34   5   [Study]              │
│ 05 Joins                  61    0   –   [Add] [Study]        │
│ …                                                            │
├──────────────────────────────────────────────────────────────┤
│ [Reset schedule] → "Click again to reset all 186 reviews"    │
└──────────────────────────────────────────────────────────────┘

Session                                       3 of 32 · Joins
┌──────────────────────────────────────────────────────────────┐
│ GOTCHA · Joins                                               │
│ Conditions on the right table of a LEFT JOIN                 │
│ What's the catch?                                            │
│                       [ Show answer  Space ]                 │
│ ─ revealed (aria-live) ───────────────────────────────────── │
│ …callout body…                                               │
│ From: Joins › LEFT JOIN ↗        [Open in the playground]    │
│ [Again 1 · 1 day] [Good 2 · 7 days] [Easy 3 · 35 days]       │
└──────────────────────────────────────────────────────────────┘
```

- **Routes:**
  - `#cards` opens the overview and `#cards.<module>` opens it filtered to one module; a session runs inside the page without a route of its own.
  - `#cheatsheet.<section>` gets anchors, so cheat-sheet cards can link back.
  - `#playground.<card hash>` loads a card's SQL. The page then replaces the hash with `#playground`, so going back doesn't load it again.
- **Entry points:**
  - "Flashcards" in the top bar and the sidebar.
  - On the home page, a "Review N flashcards" button in the hero, plus a "cards due" row in the stats table.
  - "N flashcards" in each module's header, linking to `#cards.<module>`.
- **Open in the playground:**
  - The button loads the SQL through the undoable `setValue` with the existing "Ctrl+Z undoes it" toast, because it overwrites your scratchpad.
  - It resets the playground database, so the `CREATE TABLE` in an empty-db example runs every time.
  - The database select gets the card's data as an extra option ("#584 example data", "Module 02 data: events"). That choice is saved in `playDb` like the others, and the page falls back to the sample shop if the choice no longer resolves.
  - For DML problems (#196, #627), the button appends the problem's after-query, so the table shows the result.
  - The function problem (#177) gets Copy only, since the playground can't call a stored function.
- **Keyboard:**
  - Space shows the answer and 1, 2 and 3 rate it, but only while the session view is open and focus isn't in a field.
  - Rating buttons show their next interval.
- **Accessibility:** a live region announces the revealed answer. After a rating, focus moves to the next card's "Show answer" button, or to the summary heading when the session ends.
- **Look:** the result-grid styling, existing tokens, and both themes at WCAG AA contrast. At 390 px the layout has no sideways scroll: card SQL wraps, and wide result tables scroll inside their box, as they do elsewhere.

## Page size

- Cards point at data the page already has instead of copying it:
  - quiz → quiz id and question index;
  - trap and approach → problem id;
  - output → example id;
  - callout → a `data-card` attribute on the callout's `<aside>` in the module HTML, which the page reads at runtime.
- Only the cheat-sheet fronts and backs, plus the explicit asks, carry new text.
- Estimate: **+60–90 KB** (index, script and styles), so about 870 → 940–960 KB. I'll report the measured number.

## Build-time checks (compile.mjs)

1. Every card has a non-empty front and back, as rendered text.
2. Ids are unique, and hashes are unique.
3. Every link back resolves:
   - a module section to a heading id the build generated (heading ids now come from a shared `slug()` in `lib/`, used by the build and the page);
   - a problem to an existing problem;
   - a cheat-sheet section to an existing anchor.
4. Every SQL snippet on a card, meaning a code block with a playground or copy button, comes from a block the build already runs: a run example, a solution, or a trap.
5. Every trap card's trap fails on at least one dataset (re-checked for cards, also under `--only`).
6. Every output card's stored result matches a fresh run.
7. Every carded callout has a title. Every cheat-sheet section has a module. Every `{{…}}` mark is non-empty and sits inside a bullet.

Card generation is a pure, importable function, `tools/cards.mjs`, over the parsed sources. The id-stability test can call it without the engine.

## Tests

- **`test/cards.test.mjs` (id stability):** edit one module three ways: insert a paragraph, a callout and a quiz question at the top; reword one callout's body; delete a section. Every card id from other modules, problems and the cheat sheet stays the same. Inside the edited module, every card that wasn't touched keeps its id.
- **`test/leitner.test.mjs`, with an injected clock:**
  - box moves for Again, Good and Easy from every box, including the cap at 6;
  - due days across midnight;
  - due days in `TZ=Pacific/Auckland`, `America/Los_Angeles` and `UTC`, plus a DST change (in child processes);
  - the 20-new-cards limit, and the module-study bypass that still counts;
  - deck membership (finish, un-finish, add early, solve);
  - reset.
- **`test/progress.test.mjs`, extended:**
  - SQ2 round trip;
  - merge keeps the later due day, and the later review on a tie;
  - unknown hashes ignored;
  - SQ1 codes without flashcards import cleanly;
  - SQ3 gets the "newer version" message;
  - truncation is still refused at every cut;
  - a full-deck code's size is asserted under a ceiling.
- **e2e, in Chromium and WebKit, served and as a local file:**
  - review cards by keyboard (Space, 1/2/3), with focus checked after each rating;
  - add a module early;
  - study a module;
  - open a card's SQL in the playground and run it;
  - reload and see the schedule kept;
  - carry the schedule to a fresh browser profile with a progress code;
  - screenshots of the cards page at 390 and 1440 px, light and dark, with contrast checks on the card text and the buttons.
- **By hand, in the in-app browser:** desktop and phone width, both themes.

## Left out, and why

- **Cheat-sheet code blocks** (the query skeleton and the patterns block): they use placeholder tables, so the build can't run them. The patterns are covered by the Which-approach cards.
- **Output cards for sample-shop examples:** you can't predict them without the data.
- **Same-session repeat of failed cards and a cram mode:** non-goals for now; both are easy to add later.
- **A "copy for an older page" SQ1 code:** you chose SQ2 only.

## Left to the builder

- Exact wording of the prompts and empty states.
- Visual details within the existing design system.
- File split under `lib/`: the scheduler as a plain script like `progress.js`, and `slug()` shared.

## As built

Where the build differs from the design above:

- **Cards:** 390 in total.
  - The cheat sheet gives 36 cards, not about 50: 23 table rows and 13 marked facts. I skipped more bullets as repeats of callout and quiz cards.
  - Quiz stems: 2 show their options (`{options}`). 2 more that start with "Which…" read fine as recall questions, so they're marked `{nooptions}`, which silences the build's reminder.
- **Home page:** the "Flashcards" button in the hero carries a badge with the due count, the new count, or "all done". There's no row in the stats table.
- **Playground:** a card's SQL loads through `#playground.card<n>-<hash>`, where n is the snippet on the card (0 is the wrong query or the example, 1 the solution). The page then replaces the address with `#playground`.
- **Shipping:** the page receives a compact card list (`lib/cardlist.js`): problem cards as their id alone, other cards without the fields their id implies, and no hashes. The build checks that expanding the list gives back exactly the cards it checked. That took the page growth from 91 KB to 76 KB.
- **Saving:** the page writes on `pagehide` only while a save is still pending. Writing on every exit would overwrite progress another tab saved since.
- **Module card counts:** a module's "N flashcards" count includes its problem cards. Problem cards join the deck only when their problem is solved, and adding or studying a module early brings in only its own cards (no solution spoilers). So Joins shows 75 cards, and studying it before solving anything gives 11.
- **Older copies:** tested against the page at the previous commit.
  - An `SQ2:` code gets the old message, "That is not a progress code from this course. Codes start with SQ1:".
  - An older copy that shares the same storage (downloaded files opened from disk) drops `cards`, `cardAdd` and `cardNew` the next time it saves, because the old `load()` keeps only the keys it knows. The README warns about this.
  - Guard, added after review with the user's approval: every save also writes `cards`, `cardAdd` and `cardNew` to `select-again:v1:cards`. On load, the page merges that backup back in with the import rules (later due day wins, modules are a union), then saves. Reset clears both. Tested against the real previous page: it drops the schedule, and the new page restores all of it.
