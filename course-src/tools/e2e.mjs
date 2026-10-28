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

  await t('copy the progress code from the home page', async () => {
    await goto(page, 'home', '.progress-io');
    before = { side: await sidebar(page), home: await homeTable(page) };
    expect(before.side.includes(`Problems solved 1 / ${total}`) && before.side.includes(`Modules finished 1 / ${modCount}`), before.side);
    await page.click('button:has-text("Copy progress code")');
    await page.waitForFunction(() => document.querySelector('.progress-io .msg').textContent.length > 0);
    code = await page.inputValue('#progress-code');
    expect(code.startsWith('SQ1:'), code.slice(0, 20));
    const msg = await page.textContent('.progress-io .msg');
    if (engine === 'chromium' && target === 'serve') {  // the one context granted clipboard access
      expect(/copied/.test(msg), msg);
      expect((await page.evaluate(() => navigator.clipboard.readText())) === code, 'the clipboard does not hold the code');
    } else expect(/copied|selected/.test(msg), msg);
  });

  await t('wrong, Sorted Again and truncated codes are refused without touching progress', async () => {
    const sa = 'SA1:' + Buffer.from(JSON.stringify({ solved: { 1: 1 } })).toString('base64');
    for (const [text, re] of [[sa, /Sorted Again/], ['hello', /Codes start with SQ1:/], [code.slice(0, Math.floor(code.length / 2)), /incomplete/], ['', /Paste a progress code/]]) {
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
    expect(msg === 'Imported 1 solved problem and 1 finished module, plus 1 quiz score and 2 drafts.', msg);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.matches('.progress-io button.import')), 'focus did not return to Import');
    expect((await sidebar(page)) === before.side, `sidebar: ${await sidebar(page)}`);
    expect(JSON.stringify(await homeTable(page)) === JSON.stringify(before.home), `home: ${(await homeTable(page)).join(' | ')}`);
    const s = await saved(page);
    expect(s && s.solved[solveId] && s.done[mod.id] && s.drafts[draftId] === NON_ASCII, 'the import was not written to storage at once');
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
    for (const [hash, ready] of [['home', '.progress-io'], [mod.id, '.quiz-q'], [`p${solveId}`, '.editor-host']]) {
      await goto(page, hash, ready);
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
      expect(w.doc <= w.vw, `${hash}: page is ${w.doc}px wide in a ${w.vw}px window`);
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
