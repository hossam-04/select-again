# Flashcards Implementation Plan

> Executed natively in this session (no subagents). No commits until the user says so.

**Goal:** Spaced-repetition flashcards generated at build time from verified course content, with a Leitner scheduler, progress-code support and a Flashcards page.

**Architecture:**
- `tools/cards.mjs` is a pure function over the parsed sources. It returns the card list, and the build embeds it in course.json.
- `lib/leitner.js` is the scheduler: plain script, no DOM, `today` injected.
- `lib/progress.js` gains `SQ2:`, the packed schedule and the card merge rules.
- `template/app.js` gains the `#cards` view, the entry points and loading a card's SQL into the playground.

**Tech stack:** Node ESM build, marked, sql.js (asm), node:test, playwright-core e2e.

**Spec:** `docs/superpowers/specs/2026-11-05-flashcards-design.md`

## Global constraints

- Boxes 1, 3, 7, 16, 35, 80 days. Again → 1, Good +1, Easy +2, capped at 6. A new card counts as box 1. At most 20 new cards a day.
- Store `select-again:v1`, debounced save in try/catch. Code `SQ2:`; SQ1 still imports; SQ3+ gets the "newer version" message.
- Import only adds. Per card, the later due day wins, then the later review day. Unknown hashes are ignored.
- No new external scripts. Page growth stays modest and is reported. AA contrast, both themes, no sideways scroll at 390 px, full keyboard use, the answer announced by a live region, focus kept after rating.
- No commits, no push.

## Review focus

1. A localStorage save with a malformed `cards` entry: the other entries survive (owner: Task 2, load test).
2. A code cut in the middle of `k`: refused, never partly imported (owner: Task 2, truncation test runs on an SQ2 code with cards).
3. Running card SQL twice from an empty-db example: the playground DB is reset, so no "table exists" error (owner: Task 4, e2e).
4. A due card from an id that no longer exists (content edited): ignored in counts and sessions, but kept in storage (owner: Task 2, deck test).
5. Pressing Space while focus is in the playground, a search box or another field: never captured (owner: Task 4, keyboard handler only active in the session view; e2e checks the editor on another page).

---

### Task 1: Card generation and build checks

**Files:**
- Create: `course-src/tools/cards.mjs`, `course-src/lib/slug.js`, `course-src/test/cards.test.mjs`
- Modify:
  - `tools/compile.mjs`: heading ids, callout markers, quiz `{options}`, example `nocard`, call `buildCards`, checks, export the functions;
  - `content/extra.mjs`: cheat-sheet `{module=}`, `{{…}}` and anchors;
  - content: titles for 10 untitled callouts, opt-in markers, `{options}` on 3 quiz stems, cheat-sheet module tags and marks.

**Interfaces:**
- `Slug.slug(text) → string`. It's the same algorithm as app.js today: lowercase, strip tags, non-alphanumeric runs → `-`, trimmed, at most 48 characters. `Slug.headingIds(htmlHeadings[]) → string[]` adds the `-x` suffix on duplicates.
- `buildCards({ modules, problems, sheet }) → { cards: Card[], errors: string[] }`.
  - `Card = { id, h, kind: 'quiz'|'callout'|'sheet'|'trap'|'approach'|'out', m: moduleId, ref, link }`, plus `front`/`back` HTML only for sheet cards and explicit asks.
  - `ref` points at existing data: `{q:[quizId, idx]}`, `{c: calloutKey}`, `{p:id, t:idx}`, `{p:id}`, `{ex:id}`.
- `hash30(id) → 5-character base64url string` (FNV-1a, 30 bits).
- Card ids follow the spec's "Card ids" section.

Steps:
- [ ] Write the `cards.test.mjs` id-stability test. Compile a module source, edit a copy three ways, and assert that ids outside the module are unchanged and that untouched cards inside it keep theirs.
- [ ] Implement `slug.js` and `cards.mjs`. Refactor compile.mjs to `export` its functions, with `main()` guarded.
- [ ] Add the build checks 1–7 from the spec to compile.mjs. Run `npm run build`: the card summary prints and all checks pass.
- [ ] Edit the content (titles, markers, marks, module tags).

### Task 2: Scheduler and progress code

**Files:**
- Create: `lib/leitner.js`, `test/leitner.test.mjs`
- Modify: `lib/progress.js`, `test/progress.test.mjs`, `build.mjs` (LIBS)

**Interfaces:**
- `Leitner.INTERVALS = [1,3,7,16,35,80]`
- `Leitner.dayOf(ms) → int` (local calendar date)
- `Leitner.rate(entry|undefined, grade: 1|2|3, today) → [box, day]`
- `Leitner.due(entry) → int`
- `Leitner.inDeck(card, state) → bool`
- `Leitner.queue(cards, state, today, { module, study }) → { due: Card[], fresh: Card[] }`
- `Leitner.newLeft(state, today) → int`
- `Leitner.reset(state)`
- `ProgressCode`:
  - `encode(state, cards)`;
  - `decode(text)` accepts SQ1 and SQ2;
  - `merge(state, data, known)`, where `known.cards` is a Map from hash to id and `known.modules` covers `cardAdd`;
  - `pack(cardsState, idToHash) → string` and `unpack(k) → [[hash, box, day]] | null`;
  - `summary(n)` mentions flashcard reviews.

Steps:
- [ ] Write the leitner tests:
  - box moves from every box;
  - midnight;
  - TZ child processes (Auckland, LA, UTC, a DST day);
  - the new-card limit and the study bypass;
  - membership;
  - reset.
- [ ] Write the progress tests:
  - SQ2 round trip;
  - later due wins, and the later review on a tie;
  - unknown hashes;
  - an SQ1 code imports;
  - SQ3 message;
  - truncation with cards;
  - full-deck size under 5 KB extra;
  - bad entries skipped.
- [ ] Implement, then run `npm test`: all pass.

### Task 3: Flashcards page and entry points

**Files:** `template/app.js`, `template/page.html`, `template/styles.css`

- [ ] Store: add defaults `cards: {}`, `cardAdd: {}`, `cardNew: [0, 0]`, and pass `known.cards` and the card list to export and import.
- [ ] Add the `#cards[.module]` overview: counts, module filter, Review, the per-module Add/Study list, and a two-click Reset.
- [ ] Add the session view: front, Show answer, live region, rating buttons with intervals, keys Space/1/2/3, focus management, source link, and SQL with Open in the playground / Copy.
- [ ] Add the entry points: top bar, sidebar, the home hero button and stats row, and the module header link. Add cheat-sheet anchors and `#cheatsheet.section` scrolling.
- [ ] Playground: `#playground.<hash>` loads the SQL (undoable, with a toast), resets the DB, adds the card's data option persisted in `playDb`, and falls back to the sample shop.
- [ ] Progress panel: a note about older copies.

### Task 4: e2e, verification, docs

- [ ] Extend `tools/e2e.mjs`:
  - keyboard review with focus checks;
  - add a module early;
  - study a module;
  - open in the playground and run twice;
  - reload and see the schedule kept;
  - carry it to a fresh profile with a code;
  - screenshots and contrast of the cards page.
- [ ] `npm test && npm run build && npm run e2e`: all pass.
- [ ] Check by hand in the in-app browser: 1440 and 390 px, light and dark.
- [ ] README: "What's inside" and "Your progress". Write the summary numbers.
