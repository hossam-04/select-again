// Browser check of the built page's progress features, with Playwright and the browsers cached for playwright-core
// 1.63.0 (Chromium 1243, WebKit 2359). Needs the network for sql.js and fonts from their CDNs.
//   node tools/e2e.mjs [--engines chromium,webkit] [--targets serve,file] [--page <built html>] [--shots]
// Targets: serve = sql-course.html over http with the artifact viewer's CSP (tools/serve.mjs); file = file://.
// --shots writes the home page's progress panel at 390 and 1440 px, light and dark, to build/shots/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright-core';
import { startServer } from './serve.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(ROOT);
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1].split(',') : dflt;
};
const ENGINES = arg('--engines', ['chromium', 'webkit']);
const TARGETS = arg('--targets', ['serve', 'file']);
const PAGE = path.resolve(arg('--page', [path.join(REPO, 'sql-course.html')])[0]);
const SHOTS = argv.includes('--shots');
const SHOT_DIR = path.join(ROOT, 'build', 'shots');
const ALLOWED = [/^file:/, /^data:/, /^http:\/\/localhost:\d+\//, /^https:\/\/cdnjs\.cloudflare\.com\//, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//];
const KEY = 'select-again:v1';
// A save written by the first version of the course, before quiz scores existed.
const OLD_SAVE = JSON.stringify({ solved: { 176: 1727300000000 }, tried: { 176: 1727299000000 }, drafts: {}, done: {}, last: 'p176', play: '', playDb: 'sample' });
const NON_ASCII = "-- café, اختر الأسماء, 名前 🚀\nSELECT 'Zoë' AS name;";

const results = [];
async function check(engine, target, name, fn) {
  try {
    await fn();
    results.push({ engine, target, name, ok: true });
  } catch (e) {
    results.push({ engine, target, name, ok: false, detail: String((e && e.message) || e).split('\n')[0].slice(0, 300) });
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// Change the hash and wait for the router to draw the new view.
async function goto(page, hash, ready) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => location.hash === `#${h}`, hash);
  if (ready) await page.waitForSelector(ready);
}
// #playground.card<n>-<hash> loads a card's SQL, then tidies the address to #playground.
async function openCard(page, h) {
  await page.evaluate((x) => { location.hash = `playground.card0-${x}`; }, h);
  await page.waitForFunction(() => location.hash === '#playground' && document.querySelector('.editor-host .CodeMirror'));
}
// Same entries, any key order.
const sameMap = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
const booted = (page) => page.waitForSelector('#sidebar .side-progress');
const sidebar = (page) => page.$eval('.side-progress', (n) => n.innerText.replace(/\s+/g, ' ').trim());
const homeTable = (page) => page.$$eval('.stats tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

// Contrast of an element's text against the first opaque background behind it (WCAG 2 relative luminance).
async function contrast(page, selector) {
  return page.$eval(selector, (node) => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bg = null;
    for (let n = node; n && !bg; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length === 3 || c[3] === 1) bg = c.slice(0, 3);
    }
    const a = lum(rgb(getComputedStyle(node).color).slice(0, 3));
    const b = lum(bg || [255, 255, 255]);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function scenario(page, engine, target) {
  const t = (name, fn) => check(engine, target, name, fn);
  const course = await page.evaluate(() => JSON.parse(document.getElementById('course-data').textContent));
  const mod = course.modules.find((m) => m.problems.length >= 2 && m.quizzes.length);
  const [solveId, draftId] = mod.problems;
  const total = Object.keys(course.problems).length;
  const modCount = course.modules.length;
  let code = '';
  let before = null;
  const cards = await page.evaluate(() => window.CardList.expand(JSON.parse(document.getElementById('course-data').textContent).cards, JSON.parse(document.getElementById('course-data').textContent).problems));
  const own = (m) => cards.filter((c) => c.m === m && c.p === undefined);
  const other = course.modules.find((m) => m.id !== mod.id && own(m.id).length >= 4 && cards.some((c) => c.m === m.id && c.k === 'out'));
  const third = course.modules.find((m) => m.id !== mod.id && own(m.id).length >= 4 && !cards.some((c) => c.m === m.id && c.k === 'out'));
  const outCard = cards.find((c) => c.k === 'out' && course.modules.find((m) => m.id === c.m).examples.find((e) => e.id === c.ex).db === 'empty');
  const exampleOf = (c) => course.modules.find((m) => m.id === c.m).examples.find((e) => e.id === c.ex);
  const namedOut = cards.find((c) => c.k === 'out' && !['empty', 'sample'].includes(exampleOf(c).db));
  const namedEx = exampleOf(namedOut);
  let reviewed = 0;
  let schedule = null;
  const state = async () => (await saved(page)) || {};
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.className || a.tagName) : ''; });

  await t('an old save from before quiz scores still loads', async () => {
    await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [KEY, OLD_SAVE]);
    await page.reload();
    await booted(page);
    const s = await sidebar(page);
    expect(s.includes(`Problems solved 1 / ${total}`), s);
    expect((await page.textContent('.hero .actions .btn.primary')).includes('#176'), 'the Continue button lost the last page');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await booted(page);
    expect((await sidebar(page)).includes(`Problems solved 0 / ${total}`), 'storage was not cleared');
  });

  await t('solve a problem with Check', async () => {
    await goto(page, `p${solveId}`, '.editor-host .CodeMirror');
    await page.click('button:has-text("Show solutions")');
    await page.click('.sol >> nth=0 >> button:has-text("Load into editor")');
    await page.click('.work-bar button:has-text("Check")');
    await page.waitForSelector('.verdict', { timeout: 60000 });
    expect(await page.$('.verdict.ok'), await page.textContent('.verdict'));
    expect((await page.textContent('.p-head .status')).trim() === 'Solved', 'status did not change to Solved');
  });

  await t('a non-ASCII draft is saved', async () => {
    await goto(page, `p${draftId}`, '.editor-host .CodeMirror');
    await page.evaluate((v) => document.querySelector('.editor-host .CodeMirror').CodeMirror.setValue(v), NON_ASCII);
    await page.waitForFunction(([k, id, v]) => { const s = JSON.parse(localStorage.getItem(k) || '{}'); return s.drafts && s.drafts[id] === v; }, [KEY, draftId, NON_ASCII]);
  });

  await t('finish a module and its quiz; the score is saved and shown on return', async () => {
    await goto(page, mod.id, '.lesson-head');
    await page.click('.lesson-head button:has-text("Mark as finished")');
    expect((await page.getAttribute('.lesson-head button[aria-pressed]', 'aria-pressed')) === 'true', 'module not marked finished');
    for (const q of await page.$$('.quiz-q')) await (await q.$('.quiz-opt')).click();
    const score = (await page.textContent('.quiz-score')).trim();
    const m = /^(\d+) of (\d+) correct$/.exec(score);
    expect(m, score);
    await page.waitForFunction(([k, id]) => { const s = JSON.parse(localStorage.getItem(k) || '{}'); return s.quiz && s.quiz[id]; }, [KEY, mod.quizzes[0].id]);
    await goto(page, 'home', '.progress-io');
    await goto(page, mod.id, '.quiz-q');
    const prev = (await page.textContent('.quiz-prev')).trim();
    expect(prev === `Last time: ${m[1]} of ${m[2]} correct.`, prev);
  });


  await t('flashcards: review cards by keyboard, with focus kept and the answer announced', async () => {
    await goto(page, 'cards', '.fc-overview');
    const label = await page.textContent('.fc-overview .btn.primary');
    expect(/^Review \d+ cards?$/.test(label.trim()), `review button: ${label}`);
    await page.focus('.fc-overview .btn.primary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.fc-card');
    for (let i = 0; i < 3; i++) {
      const count = await page.textContent('.fc-count');
      expect(count.startsWith(`Card ${i + 1} of `), count);
      expect((await active()).includes('fc-show'), `focus before reveal: ${await active()}`);
      expect(await page.isHidden('.fc-back'), 'answer visible before Space');
      await page.keyboard.press('Space');
      expect(await page.isVisible('.fc-back'), 'Space did not show the answer');
      expect((await active()).includes('fc-back'), `focus after reveal: ${await active()}`);
      const live = await page.textContent('#fc-live');
      expect(/^Answer: .{10,}/.test(live), `live region: ${live.slice(0, 80)}`);
      expect((await page.getAttribute('#fc-live', 'aria-live')) === 'polite', 'not a live region');
      await page.keyboard.press('2');
      await page.waitForFunction((n) => { const c = document.querySelector('.fc-count'); return !c || !c.textContent.startsWith(`Card ${n} of`); }, i + 1);
      reviewed++;
    }
    expect((await active()).includes('fc-show'), `focus after rating: ${await active()}`);
    await page.waitForFunction((k) => Object.keys((JSON.parse(localStorage.getItem(k) || '{}').cards) || {}).length === 3, KEY);
    const s = await state();
    expect(Object.values(s.cards).every((e) => e[0] === 2), JSON.stringify(s.cards));
    expect(s.cardNew[1] === 3, `new-card count ${JSON.stringify(s.cardNew)}`);
    // End the session: the summary heading takes focus.
    await page.click('.fc-top a:has-text("End session")');
    await page.waitForSelector('.fc-done h1');
    expect((await page.textContent('.fc-done h1')).trim() === '3 cards reviewed', await page.textContent('.fc-done h1'));
    expect(await page.evaluate(() => document.activeElement.matches('.fc-done h1')), 'focus lost after the session');
  });

  await t('flashcards: Space in a text field is never taken over', async () => {
    await goto(page, 'playground', '.editor-host .CodeMirror');
    await page.click('.editor-host .CodeMirror');
    await page.keyboard.type('x y');
    expect((await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.getValue())).includes('x y'), 'typing a space in the editor failed');
    await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.undo());
  });

  await t('flashcards: add a module early', async () => {
    await goto(page, `cards.${other.id}`, '.fc-overview');
    await page.click('.fc-actions button:has-text("Add this module to my deck")');
    await page.waitForFunction(() => /Added/.test(document.querySelector('.fc-status .msg').textContent));
    const s = await state();
    expect(s.cardAdd && s.cardAdd[other.id], 'cardAdd not saved');
    expect(await page.evaluate(() => document.activeElement.matches('.fc-actions .study')), `focus after Add: ${await active()}`);
    const row = await page.$eval(`.fc-table a[href="#cards.${other.id}"]`, (a) => a.closest('tr').innerText.replace(/\s+/g, ' '));
    expect(row.includes(` ${own(other.id).length} `), `row: ${row}`);
  });

  await t('flashcards: study one module, past the daily limit', async () => {
    await goto(page, `cards.${other.id}`, '.fc-overview');
    await page.click('.fc-actions button:has-text("Study this module")');
    await page.waitForSelector('.fc-card');
    const count = await page.textContent('.fc-count');
    expect(count === `Card 1 of ${own(other.id).length} · ${other.title}`, count);
    await page.click('.fc-show');
    await page.click('.fc-rate.g3');
    reviewed++;
    expect((await page.textContent('.fc-count')).startsWith('Card 2 of'), 'did not advance after clicking Easy');
    expect((await active()).includes('fc-show'), 'focus lost after clicking a rating');
    await page.waitForFunction((k) => Object.keys(JSON.parse(localStorage.getItem(k)).cards).length === 4, KEY);
    const s = await state();
    expect(Object.values(s.cards).some((e) => e[0] === 3), 'Easy did not move a new card to box 3');
  });

  await t("flashcards: open a card's SQL in the playground, on the right data, twice", async () => {
    // From a card: the solved problem's "Which approach?" card in its module's study session.
    await goto(page, `cards.${mod.id}`, '.fc-overview');
    await page.click('.fc-actions button:has-text("Study this module")');
    await page.waitForSelector('.fc-card');
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      await page.keyboard.press('Space');
      if (await page.$('.fc-back a:has-text("Open in the playground")')) { found = true; break; }
      await page.keyboard.press('2');
      reviewed++;
      if (await page.$('.fc-done')) break;
    }
    expect(found, 'no card with SQL in this module');
    const sql = await page.$eval('.fc-back .fc-sql pre', (n) => n.textContent);
    await page.click('.fc-back a:has-text("Open in the playground")');
    await page.waitForSelector('.editor-host .CodeMirror');
    expect((await page.evaluate(() => location.hash)) === '#playground', 'the hash was not tidied');
    const value = await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.getValue());
    expect(value.startsWith(sql.trim()), `editor: ${value.slice(0, 60)}`);
    expect((await page.inputValue('#play-db')) === `p${solveId}`, `db: ${await page.inputValue('#play-db')}`);
    for (let i = 0; i < 2; i++) {
      await page.click('.work-bar button:has-text("Run")');
      await page.waitForSelector('.work-out .result, .work-out .out-msg.error');
      expect(!(await page.$('.work-out .out-msg.error')), `run ${i + 1}: ${await page.textContent('.work-out')}`);
    }
    // An empty-database example that creates its own table runs every time it is opened.
    for (let i = 0; i < 2; i++) {
      await openCard(page, outCard.h);
      expect((await page.inputValue('#play-db')) === 'empty', 'not the empty database');
      await page.click('.work-bar button:has-text("Run")');
      await page.waitForSelector('.work-out .result, .work-out .out-msg.error');
      expect(!(await page.$('.work-out .out-msg.error')), `open ${i + 1}: ${await page.textContent('.work-out')}`);
      await goto(page, 'cards', '.fc-overview');
    }
    // A module's own example data (a named setup): the tables are listed, and the result matches the card's.
    await openCard(page, namedOut.h);
    expect((await page.inputValue('#play-db')) === `m:${namedOut.m}:${namedEx.db}`, `db: ${await page.inputValue('#play-db')}`);
    await page.waitForFunction(() => document.querySelector('.schema-browser summary'));
    await page.click('.work-bar button:has-text("Run")');
    await page.waitForSelector('.work-out .result, .work-out .out-msg.error');
    const rows = await page.$$eval('.work-out table.grid tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
    const want = namedEx.output.rows.map((r) => r.map((v) => (v === null ? 'NULL' : String(v))));
    expect(JSON.stringify(rows) === JSON.stringify(want), `got ${JSON.stringify(rows)} want ${JSON.stringify(want)}`);
    // Undo brings the scratchpad back.
    await goto(page, 'playground', '.editor-host .CodeMirror');
    await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.setValue('-- my scratchpad'));
    await openCard(page, outCard.h);
    await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.undo());
    expect((await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.getValue())) === '-- my scratchpad', 'undo did not restore the scratchpad');
  });

  await t('flashcards: focus stays put when the page redraws itself', async () => {
    await goto(page, 'cards', '.fc-table');
    const row = course.modules.find((m) => m.id !== mod.id && m.id !== other.id && own(m.id).length);
    await page.click(`.fc-table button[aria-label="Add ${row.title} to my deck"]`);
    expect(await page.evaluate((id) => document.activeElement.matches(`button[data-study="${id}"]`), row.id), `focus after the table's Add: ${await active()}`);
    // End a session before rating anything.
    await page.click(`.fc-table button[data-study="${row.id}"]`);
    await page.waitForSelector('.fc-card');
    await page.click('.fc-top a:has-text("End session")');
    await page.waitForSelector('.fc-overview');
    expect(!(await page.evaluate(() => document.activeElement === document.body)), 'focus fell to the page body');
  });

  await t('flashcards: the schedule is kept after a reload, and the home page counts it', async () => {
    await page.waitForTimeout(400);
    schedule = await state();
    await page.reload();
    await booted(page);
    const s = await state();
    expect(sameMap(s.cards, schedule.cards), 'schedule changed after reload');
    expect(Object.keys(s.cards).length === reviewed, `${Object.keys(s.cards).length} reviews saved, ${reviewed} made`);
    await goto(page, 'cards', '.fc-overview');
    expect(/0 due/.test(await page.textContent('.fc-status')), await page.textContent('.fc-status'));
    await goto(page, 'home', '#home-cards');
    expect(/Flashcards/.test(await page.textContent('#home-cards')), await page.textContent('#home-cards'));
    await goto(page, mod.id, '.lesson-head');
    expect(/\d+ flashcards/.test(await page.textContent('.lesson-head .fc-link')), 'no flashcards link on the module');
  });

  await t('flashcards: the backup brings the schedule back after an older copy drops it', async () => {
    const full = await state();
    // What an older copy of the page leaves behind when it saves: the main save without the flashcard keys.
    await page.evaluate(([k, v]) => { localStorage.setItem(k, v); }, [KEY, JSON.stringify(Object.fromEntries(Object.entries(full).filter(([key]) => !['cards', 'cardAdd', 'cardNew'].includes(key))))]);
    await page.context().newPage().then(async (p2) => {
      await p2.goto(page.url().split('#')[0] + '#cards');
      await p2.waitForSelector('.fc-overview');
      const s = await p2.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
      expect(sameMap(s.cards, full.cards) && sameMap(s.cardAdd, full.cardAdd), 'the schedule was not restored from the backup');
      await p2.close();
    });
  });

  await t('flashcards: Reset needs a second click', async () => {
    await goto(page, 'cards', '.fc-reset');
    await page.click('.fc-reset button');
    expect(/Click again/.test(await page.textContent('.fc-reset button')), 'first click did not ask again');
    expect(Object.keys((await state()).cards).length === reviewed, 'the first click already reset');
    await page.waitForTimeout(4300);
    expect(/Reset schedule/.test(await page.textContent('.fc-reset button')), 'the confirm did not time out');
  });

  await t('copy the progress code from the home page', async () => {
    await goto(page, 'home', '.progress-io');
    before = { side: await sidebar(page), home: await homeTable(page) };
    expect(before.side.includes(`Problems solved 1 / ${total}`) && before.side.includes(`Modules finished 1 / ${modCount}`), before.side);
    await page.click('button:has-text("Copy progress code")');
    await page.waitForFunction(() => document.querySelector('.progress-io .msg').textContent.length > 0);
    code = await page.inputValue('#progress-code');
    expect(code.startsWith('SQ2:'), code.slice(0, 20));
    const msg = await page.textContent('.progress-io .msg');
    if (engine === 'chromium' && target === 'serve') {  // the one context granted clipboard access
      expect(/copied/.test(msg), msg);
      expect((await page.evaluate(() => navigator.clipboard.readText())) === code, 'the clipboard does not hold the code');
    } else expect(/copied|selected/.test(msg), msg);
  });

  await t('wrong, Sorted Again and truncated codes are refused without touching progress', async () => {
    const sa = 'SA1:' + Buffer.from(JSON.stringify({ solved: { 1: 1 } })).toString('base64');
    for (const [text, re] of [[sa, /Sorted Again/], ['hello', /Codes start with SQ2:/], ['SQ3:' + code.slice(4), /newer version/], [code.slice(0, Math.floor(code.length / 2)), /incomplete/], ['', /Paste a progress code/]]) {
      await page.fill('#progress-code', text);
      await page.click('.progress-io button.import');
      const msg = await page.textContent('.progress-io .msg');
      expect(re.test(msg), `${text.slice(0, 8)}… -> ${msg}`);
    }
    expect((await sidebar(page)) === before.side, 'a refused code changed the progress');
  });

  await t('clear storage, import the code, and everything comes back', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await booted(page);
    await goto(page, 'home', '.progress-io');
    expect((await sidebar(page)).includes(`Problems solved 0 / ${total}`), 'storage was not cleared');
    expect((await homeTable(page)).every((r) => / 0 \d+$/.test(r)), (await homeTable(page)).join(' | '));
    await page.fill('#progress-code', code.replace(/(.{60})/g, '$1\n'));  // a paste that picked up line breaks
    await page.click('.progress-io button.import');
    await page.waitForFunction(() => /^Imported/.test(document.querySelector('.progress-io .msg').textContent));
    const msg = await page.textContent('.progress-io .msg');
    expect(msg === `Imported 1 solved problem and 1 finished module, plus 1 quiz score, 2 drafts and ${reviewed} flashcard reviews.`, msg);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.matches('.progress-io button.import')), 'focus did not return to Import');
    expect((await sidebar(page)) === before.side, `sidebar: ${await sidebar(page)}`);
    expect(JSON.stringify(await homeTable(page)) === JSON.stringify(before.home), `home: ${(await homeTable(page)).join(' | ')}`);
    const s = await saved(page);
    expect(s && s.solved[solveId] && s.done[mod.id] && s.drafts[draftId] === NON_ASCII, 'the import was not written to storage at once');
    expect(sameMap(s.cards, schedule.cards) && sameMap(s.cardAdd, schedule.cardAdd), 'the flashcard schedule did not come back');
  });


  await t('flashcards: a progress code carries the schedule to a fresh browser profile', async () => {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', (route) => (ALLOWED.some((re) => re.test(route.request().url())) ? route.continue() : route.abort()));
    const p2 = await ctx.newPage();
    await p2.goto(page.url().split('#')[0]);
    await booted(p2);
    expect(!(await p2.evaluate((k) => localStorage.getItem(k), KEY)), 'the new profile is not empty');
    await goto(p2, 'home', '.progress-io');
    await p2.fill('#progress-code', code);
    await p2.click('.progress-io button.import');
    await p2.waitForFunction(() => /^Imported/.test(document.querySelector('.progress-io .msg').textContent));
    const s = await p2.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    expect(sameMap(s.cards, schedule.cards), 'the schedule did not arrive');
    expect(sameMap(s.cardAdd, schedule.cardAdd), 'the added module did not arrive');
    await goto(p2, 'cards', '.fc-overview');
    const foot = await p2.textContent('.fc-table .result-foot');
    await goto(page, 'cards', '.fc-overview');
    expect(foot === (await page.textContent('.fc-table .result-foot')), `deck differs: ${foot}`);
    await ctx.close();
  });

  await t('after a reload: problem status, draft, finished module and quiz score are all back', async () => {
    await page.reload();
    await booted(page);
    expect((await sidebar(page)) === before.side, 'sidebar changed after reload');
    await goto(page, `p${solveId}`, '.p-head .status');
    expect((await page.textContent('.p-head .status')).trim() === 'Solved', 'problem not solved after reload');
    await goto(page, `p${draftId}`, '.editor-host .CodeMirror');
    expect((await page.evaluate(() => document.querySelector('.editor-host .CodeMirror').CodeMirror.getValue())) === NON_ASCII, 'non-ASCII draft changed');
    expect((await page.textContent('.work-title')).includes('draft restored'), 'draft not marked as restored');
    await goto(page, mod.id, '.quiz-q');
    expect((await page.getAttribute('.lesson-head button[aria-pressed]', 'aria-pressed')) === 'true', 'module not finished after reload');
    expect(/^Last time: \d+ of \d+ correct\.$/.test((await page.textContent('.quiz-prev')).trim()), 'quiz score missing');
    const sideMod = await page.textContent(`.side-mod[href="#${mod.id}"] .state`);
    expect(sideMod === '✓', `sidebar module state: ${sideMod}`);
  });

  await t('phone width: no sideways scroll, and the panel fits', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [hash, ready] of [['home', '.progress-io'], [mod.id, '.quiz-q'], [`p${solveId}`, '.editor-host'], ['cards', '.fc-table'], ['cheatsheet', '.sheet-grid']]) {
      await goto(page, hash, ready);
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
      expect(w.doc <= w.vw, `${hash}: page is ${w.doc}px wide in a ${w.vw}px window`);
    }
    await goto(page, 'cards', '.fc-table');
    const table = await page.$eval('.fc-table .result', (r) => r.scrollWidth - r.clientWidth);
    expect(table <= 0, `the flashcards table scrolls sideways by ${table}px`);
    // Every card of a module's study session, answer shown, fits the width (rated Again, so nothing moves on).
    await goto(page, `cards.${mod.id}`, '.fc-overview');
    await page.click('.fc-actions button:has-text("Study this module")');
    await page.waitForSelector('.fc-card');
    for (let i = 0; i < 40 && (await page.$('.fc-card')); i++) {
      await page.keyboard.press('Space');
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth, label: document.querySelector('.fc-label').textContent }));
      expect(w.doc <= w.vw, `${w.label}: page is ${w.doc}px wide in a ${w.vw}px window`);
      await page.keyboard.press('1');
    }
    await goto(page, 'home', '.progress-io');
    const box = await page.$eval('.progress-io', (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    expect(box.left >= 0 && box.right <= 390, `panel spans ${box.left}..${box.right}`);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await t('contrast of the new text meets WCAG AA in light and dark', async () => {
    const low = [];
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await goto(page, 'home', '.progress-io');
      await page.click('button:has-text("Copy progress code")');
      await page.waitForFunction(() => document.querySelector('.progress-io .msg').textContent.length > 0);
      for (const sel of ['.progress-io p', '.progress-io .msg', '#progress-code', '.progress-io .btn', '.section-head h2']) {
        const c = await contrast(page, sel);
        if (c < 4.5) low.push(`${scheme} ${sel}: ${c.toFixed(2)}`);
      }
      await goto(page, mod.id, '.quiz-prev');
      const c = await contrast(page, '.quiz-prev');
      if (c < 4.5) low.push(`${scheme} .quiz-prev: ${c.toFixed(2)}`);
      await goto(page, 'cards', '.fc-overview');
      for (const sel of ['.fc-overview .lede', '.fc-status', '.fc-keys', '.fc-keys .kbd', '.fc-table td.m a', '.fc-table .result-foot', '.fc-reset .btn', '.fc-reset .meta']) {
        const c = await contrast(page, sel);
        if (c < 4.5) low.push(`${scheme} ${sel}: ${c.toFixed(2)}`);
      }
      await goto(page, `cards.${third.id}`, '.fc-overview');
      await page.click('.fc-actions button:has-text("Study this module")');
      await page.waitForSelector('.fc-card');
      await page.keyboard.press('Space');
      for (const sel of ['.fc-label > span', '.fc-q', '.fc-back', '.fc-source', '.fc-rate.g1 b', '.fc-rate.g2 b', '.fc-rate.g3 b', '.fc-rate small', '.fc-count']) {
        if (!(await page.$(sel))) continue;
        const c = await contrast(page, sel);
        if (c < 4.5) low.push(`${scheme} ${sel}: ${c.toFixed(2)}`);
      }
      await goto(page, 'home', '#home-cards');
      for (const sel of ['#home-cards', '#home-cards .fc-badge']) {
        const c = await contrast(page, sel);
        if (c < 4.5) low.push(`${scheme} ${sel}: ${c.toFixed(2)}`);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    expect(!low.length, low.join('; '));
  });

  if (SHOTS) {
    await t('screenshots', async () => {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
          await page.waitForTimeout(400);  // the sidebar slides out of view when the window narrows
          await goto(page, 'home', '.progress-io');
          await page.fill('#progress-code', code);
          await page.click('.progress-io button.import');
          await page.waitForFunction(() => /^Imported/.test(document.querySelector('.progress-io .msg').textContent));
          await page.locator('.progress-io').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOT_DIR, `${engine}-${target}-home-${width}-${scheme}.png`) });
          await goto(page, mod.id, '.quiz-prev');
          await page.locator('.quiz-prev').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOT_DIR, `${engine}-${target}-quiz-${width}-${scheme}.png`) });
          await goto(page, 'cards', '.fc-overview');
          await page.screenshot({ path: path.join(SHOT_DIR, `${engine}-${target}-cards-${width}-${scheme}.png`), fullPage: true });
          await page.click('.fc-reset button');
          await page.click('.fc-reset button');
          await goto(page, `cards.${mod.id}`, '.fc-overview');
          await page.click('.fc-actions button:has-text("Study this module")');
          await page.waitForSelector('.fc-card');
          for (let i = 0; i < 40 && !(await page.$('.fc-card .fc-sql')); i++) await page.keyboard.press('Space').then(() => page.keyboard.press('1'));
          await page.keyboard.press('Space');
          await page.screenshot({ path: path.join(SHOT_DIR, `${engine}-${target}-card-${width}-${scheme}.png`), fullPage: true });
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1280, height: 900 });
    });
  }
}

const server = TARGETS.includes('serve') ? await startServer(path.dirname(PAGE)) : null;
const urls = {
  serve: server && `http://localhost:${server.address().port}/${path.basename(PAGE)}`,
  file: pathToFileURL(PAGE).href,
};
for (const engine of ENGINES) {
  const browser = await { chromium, webkit }[engine].launch();
  for (const target of TARGETS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (engine === 'chromium' && target === 'serve') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.route('**/*', (route) => (ALLOWED.some((re) => re.test(route.request().url())) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(urls[target]);
    await booted(page);
    await scenario(page, engine, target);
    await check(engine, target, 'no script errors or CSP violations', async () => expect(!errors.length, errors.slice(0, 3).join(' | ')));
    await context.close();
  }
  await browser.close();
}
if (server) server.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.engine.padEnd(8)} ${r.target.padEnd(5)} ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
