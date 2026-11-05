import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initCompiler, compileModuleSource, loadProblems, getParser, compileErrors, CONTENT } from '../tools/compile.mjs';
import { buildCards, sheetCards, hash30, calloutMarkers } from '../tools/cards.mjs';
import extra from '../content/extra.mjs';

const MOD_DIR = path.join(CONTENT, 'modules');
const files = fs.readdirSync(MOD_DIR).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
const sources = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(MOD_DIR, f), 'utf8')]));
const raw = await loadProblems();
initCompiler(Object.fromEntries(raw.map((p) => [p.id, '?'])));

function deck(src) {
  compileErrors.length = 0;
  const modules = files.map((f, i) => compileModuleSource(src[f], i));
  assert.deepEqual(compileErrors, [], 'the content compiles without errors');
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  const problems = {};
  for (const p of raw) { problems[p.id] = { id: p.id, module: p.module, traps: p.traps || [] }; byId[p.module].problems.push(p.id); }
  const { sheetSections } = extra(getParser(), null, globalThis.Slug.slug);
  return buildCards({ modules, problems, sheet: sheetCards(sheetSections).cards });
}

const JOINS = files.find((f) => f.includes('joins'));
const sectionOf = (src, heading) => {
  const start = src.indexOf(`\n## ${heading}\n`);
  const end = src.indexOf('\n## ', start + 1);
  return [start, end];
};

test('editing one module leaves every other card id unchanged', () => {
  const before = deck(sources);
  let src = sources[JOINS];
  // 1. New blocks at the top: a paragraph, a callout, a quiz question and a runnable example.
  src = src.replace(/^(---\n[\s\S]*?\n---\n)/, `$1
A new opening paragraph.

:::gotcha A brand-new gotcha
Something new to remember.
:::

:::quiz
? A brand-new question?
- [x] Yes
- [ ] No
> Because it is new.
:::

\`\`\`sql run
SELECT 1 AS one;
\`\`\`
`);
  // 2. Reword one callout's body.
  src = src.replace(/(:::work The double-join report bug\n)[^\n]+/, '$1Reworded: joining payments and refunds before aggregating multiplies rows.');
  // 3. Delete a whole section.
  const [a, b] = sectionOf(src, 'Self-join: a table meets itself');
  src = src.slice(0, a) + src.slice(b);
  const after = deck({ ...sources, [JOINS]: src });

  const ids = (list) => new Set(list.map((c) => c.id));
  const afterIds = ids(after);
  const others = before.filter((c) => c.m !== 'joins');
  assert.ok(others.length > 250);
  for (const c of others) assert.ok(afterIds.has(c.id), `${c.id} changed`);
  assert.deepEqual(after.filter((c) => c.m !== 'joins').map((c) => c.id), others.map((c) => c.id), 'same ids, same order');

  const deleted = before.filter((c) => c.m === 'joins' && c.s === 'self-join-a-table-meets-itself');
  const kept = before.filter((c) => c.m === 'joins' && !deleted.includes(c));
  for (const c of kept) assert.ok(afterIds.has(c.id), `joins card ${c.id} changed`);
  for (const c of deleted) assert.ok(!afterIds.has(c.id), `${c.id} should be gone with its section`);
  const added = after.filter((c) => !ids(before).has(c.id)).map((c) => c.id).sort();
  assert.deepEqual(added, ['joins.gotcha.a-brand-new-gotcha', 'joins.quiz.a-brand-new-question'].sort());
  // Positional quiz ids moved (joins-q1 is now the new quiz), but the old question kept its card id.
  const old = before.find((c) => c.k === 'quiz' && c.m === 'joins');
  const now = after.find((c) => c.id === old.id);
  assert.notDeepEqual(now.q, old.q);
  // Hashes follow the id, so they are stable too.
  for (const c of others) assert.equal(after.find((x) => x.id === c.id).h, c.h);
});

test('card hashes are 5 base64url characters and differ between ids', () => {
  assert.match(hash30('joins.quiz.x'), /^[A-Za-z0-9_-]{5}$/);
  assert.notEqual(hash30('p175.trap1'), hash30('p175.trap2'));
  assert.equal(hash30('p175.trap1'), hash30('p175.trap1'));
});

test('callout title markers', () => {
  assert.deepEqual(calloutMarkers('tip', 'AUTO_INCREMENT {card} {ask: How?}'), { title: 'AUTO_INCREMENT', ask: 'How?', carded: true });
  assert.deepEqual(calloutMarkers('gotcha', 'Empty input {nocard}'), { title: 'Empty input', ask: '', carded: false });
  assert.deepEqual(calloutMarkers('interview', 'Say it'), { title: 'Say it', ask: '', carded: false });
  assert.deepEqual(calloutMarkers('key', ''), { title: '', ask: '', carded: true });
});
