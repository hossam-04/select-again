# SELECT Again

**Get your SQL back by running it.** An interactive MySQL refresher for people who knew SQL once: 15 short modules, 116 examples you can edit and run, all 78 free LeetCode SQL problems, graded right in the page in MySQL syntax, and 390 flashcards that bring it back on a spaced schedule.

It's one HTML page. A real SQL engine (SQLite, through sql.js, with a MySQL compatibility layer) runs inside it, so there's nothing to install and no database to set up.

**[Open it now →](https://hossam-04.github.io/select-again/)**

![The SELECT Again home page: progress by difficulty and the list of modules](.github/screenshot.png)

## What's inside

- **15 modules**, each with runnable, editable examples on the same small sample shop database, and a quick check at the end.
- **78 problems**, grouped by module. Each has its tables, an editor, **Run** (your result on the example data) and **Check** (the example data plus hidden edge cases), hints that open one at a time, solutions with alternatives, and **common wrong answers** you can run to see exactly how they fail.
- **390 flashcards** for spaced recall, next to the quizzes: you see a prompt, answer in your head, show the answer and rate it Again, Good or Easy. Cards come back after 1, 3, 7, 16, 35 and 80 days (Leitner boxes), with at most 20 new cards a day. They're made by the build from content it already checks, so they can't drift from the lessons:
  - 72 quiz questions, 53 callouts (gotchas, key ideas, MySQL-vs-other-databases notes, on-the-job notes, 3 tips and 1 interview note) and 36 cheat-sheet facts;
  - 145 "What's wrong with this query?" cards, one per common wrong answer, each proven by the build to fail;
  - 78 "Which approach?" cards, one per problem;
  - 6 "What does this return?" cards whose result the build computed.

  A module's cards join your deck when you finish it, and a problem's cards join when you solve it. You can also add or study any module early. Each card links back to its section or problem, and SQL on a card opens in the playground on the right data. Keys: Space shows the answer, 1/2/3 rate it.
- A **cheat sheet**, a **playground** that lists every table and column, and notes on where the engine differs from MySQL.
- Light and dark themes, readable contrast (WCAG AA), and a phone layout.

| | Module |
|---|---|
| 00 | Start here: how it works, the sample shop, warm-up quiz |
| 01 | Query basics |
| 02 | Filtering and NULL |
| 03 | Expressions and functions |
| 04 | Aggregation |
| 05 | Joins |
| 06 | Subqueries and EXISTS |
| 07 | Set operations |
| 08 | CTEs and recursion |
| 09 | Window functions |
| 10 | Interview patterns |
| 11 | Changing data |
| 12 | Schema design |
| 13 | Indexes and performance |
| 14 | Interview playbook |

## Use it offline

Download [`sql-course.html`](https://hossam-04.github.io/select-again/sql-course.html) and open it in any modern browser. The SQL engine, the editor and the fonts load from cdnjs and Google Fonts, so the first open needs an internet connection.

## Your progress

Solved problems, attempts, drafts, finished modules, quiz scores and your flashcard schedule are saved **in your browser only**, on this device. Nothing is sent anywhere.

To move your progress, for example from the downloaded file to the online version, or to another device: on the home page, under **Your progress**, press **Copy progress code**, then paste the code into the same box on the other copy and press **Import**. Importing merges: it never removes anything you already have. For each flashcard, it keeps whichever review schedules the card later.

- Codes now start with `SQ2:` and carry the flashcard schedule. Older `SQ1:` codes still import.
- A copy of the page downloaded before flashcards existed can't read an `SQ2:` code: it says the code isn't from this course. Download `sql-course.html` again and import there.
- The flashcard schedule is also kept in a backup next to the main save. If you open a downloaded copy from before flashcards in the same browser (downloaded files opened from disk share one save), it drops the schedule from the main save. The next time you open the new page, it brings the schedule back from the backup.
- A full deck adds about 3.5 KB to the code.
- **Reset schedule** on the Flashcards page forgets your reviews (after a second click). Because importing only adds, importing an older code afterwards brings its schedule back.
- Days follow your computer's calendar date, so a code moved between time zones can be a day off.

## Build it from source

The page is built from `course-src/`. You need Node.js.

```bash
cd course-src
npm install
npm run build   # run every example, solution, alternative and wrong answer, check every flashcard, then write ../sql-course.html
npm test        # unit tests: the checker, the MySQL compatibility layer, progress codes, the flashcard scheduler and card ids
npm run e2e     # end-to-end checks in a real browser (Playwright; needs its browsers installed)
```

The build refuses to finish unless every example runs, every solution and alternative passes every test, and every "wrong answer" fails. It also checks every flashcard:
- each card has a front and a back, and a unique id;
- its link back resolves;
- its SQL is SQL the build ran;
- its "wrong answer" still fails, and its "what does this return" result matches a fresh run.

Card ids come from the source (module, block kind, a slug of the title or question; problem number and trap number), so editing one module never resets the schedule of cards elsewhere.

In the content:
- `:::tip`, `:::interview` and other callouts take `{card}` / `{nocard}` and an optional `{ask: …}` on their title line;
- quiz questions take `{options}` when the card should show the options;
- cheat-sheet headings take `{module=…}`, and `{{…}}` marks the part a cheat-sheet card hides.

- `course-src/content/modules/` – the lessons, in Markdown
- `course-src/content/problems/` – the problems, their tests, hints, solutions and wrong answers
- `course-src/content/sample-db.sql` – the sample shop database
- `course-src/lib/` – the engine wrapper, the MySQL compatibility layer and the result checker
- `course-src/template/` – the page, its styles and its script

## License

- The **code** (everything in `course-src/` except `content/`, plus the SQL examples and solutions inside the lessons) is under the [MIT License](LICENSE).
- The **written course material** (lessons, problem descriptions, hints, explanations, quizzes, the cheat sheet and the sample database) is under [CC BY-NC-SA 4.0](LICENSE-CONTENT): share and adapt it for non-commercial use, with credit, under the same license.

Third-party software and fonts are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Credits

Made by [hossam-04](https://github.com/hossam-04). SQL in the browser by [sql.js](https://sql.js.org) and [SQLite](https://sqlite.org). Every problem links to LeetCode, but all descriptions, tables and tests here are original. SELECT Again isn't affiliated with LeetCode.

Its companion is [Sorted Again](https://github.com/hossam-04/sorted-again), the same idea for data structures and algorithms. Both fit into [The Engineer's Syllabus](https://github.com/hossam-04/engineers-syllabus).
