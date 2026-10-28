# Third-party notices

SELECT Again is built on the work below. Each keeps its own license.

## Bundled into `sql-course.html`

**CodeMirror 5.65.21** stylesheet (`lib/codemirror.css`).
- License: [MIT](https://github.com/codemirror/codemirror5/blob/master/LICENSE), Copyright (C) 2017 by Marijn Haverbeke and others.

## Loaded by the page at run time

- **sql.js 1.14.2** (`sql-asm.js`), SQLite compiled to JavaScript, from cdnjs.cloudflare.com. [MIT](https://github.com/sql-js/sql.js/blob/master/LICENSE). It contains **SQLite**, which is in the [public domain](https://sqlite.org/copyright.html).
- **CodeMirror 5.65.18** scripts, from cdnjs.cloudflare.com. [MIT](https://github.com/codemirror/codemirror5/blob/master/LICENSE).
- **IBM Plex Sans, IBM Plex Sans Condensed and IBM Plex Mono** fonts, from Google Fonts. [SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt).

## Used only to build and test (not shipped)

- **sql.js** from npm ([MIT](https://github.com/sql-js/sql.js/blob/master/LICENSE)), to run every example and solution at build time.
- **marked** ([MIT](https://github.com/markedjs/marked/blob/master/LICENSE.md)), Markdown to HTML.
- **playwright-core** ([Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE)), end-to-end tests.

## LeetCode

Problems link to LeetCode for reference. The problem descriptions, tables and tests in this course are original and are not LeetCode's. LeetCode data fetched by `course-src/tools/leetcode.mjs` to check the reference solutions stays in the gitignored `course-src/cache/` and is not published. LeetCode is a trademark of its owner, which is not affiliated with this project.
