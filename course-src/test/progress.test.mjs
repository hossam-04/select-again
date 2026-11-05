import test from 'node:test';
import assert from 'node:assert/strict';
import '../lib/leitner.js';
import '../lib/progress.js';

const { load, encode, decode, merge, summary, PREFIX } = globalThis.ProgressCode;
const known = {
  problems: new Set(['175', '176', '177', '1757']),
  modules: new Set(['basics', 'filtering', 'joins']),
  quizzes: new Set(['basics-q1', 'joins-q1']),
};
const DEFAULTS = () => ({ solved: {}, tried: {}, drafts: {}, done: {}, quiz: {}, cards: {}, cardAdd: {}, cardNew: [0, 0], last: '', play: '', playDb: 'sample' });
const empty = () => load(null, DEFAULTS());
const codeOf = (data, prefix = PREFIX) => prefix + Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
const N0 = { solved: 0, tried: 0, done: 0, quiz: 0, drafts: 0, cardAdd: 0, cards: 0 };
const INCOMPLETE = /incomplete/;

const FULL = {
  solved: { 175: 1727300000000, 1757: 1727300100000 },
  tried: { 175: 1727200000000, 176: 1727200500000 },
  done: { basics: 1727300200000 },
  quiz: { 'basics-q1': { right: 4, total: 5, at: 1727300300000 } },
  drafts: { 176: 'SELECT name\nFROM Employee\nWHERE salary > 100;' },
};

test('a progress code round-trips into an empty browser', () => {
  const from = Object.assign(empty(), structuredClone(FULL), { last: 'p176', play: 'SELECT 1;', playDb: 'empty' });
  const code = encode(from);
  assert.ok(code.startsWith('SQ2:'));
  const r = decode(code);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data).sort(), ['cardAdd', 'done', 'drafts', 'k', 'quiz', 'solved', 'tried'], 'page position and scratchpad are not progress');
  const to = empty();
  const n = merge(to, r.data, known);
  assert.deepEqual(n, { ...N0, solved: 2, tried: 2, done: 1, quiz: 1, drafts: 1 });
  for (const k of ['solved', 'tried', 'done', 'quiz', 'drafts']) assert.deepEqual(to[k], JSON.parse(JSON.stringify(FULL[k])), k);
  assert.equal(to.last, '');
  assert.equal(to.playDb, 'sample');
  assert.equal(summary(n), 'Imported 2 solved problems and 1 finished module, plus 1 quiz score and 1 draft.');
});

test('drafts with accents, Arabic, CJK and emoji survive, and a long draft encodes', () => {
  const drafts = {
    175: "-- café, naïve, Ünïcode\nSELECT 'Zoë' AS name;",
    176: '-- اختر الأسماء\nSELECT name FROM Employee; -- 名前 🚀✓',
    177: 'x'.repeat(150000) + ' — end ✓',
  };
  const r = decode(encode({ drafts }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.drafts, drafts);
  assert.match(encode({ drafts }), /^SQ2:[A-Za-z0-9+/]+=*$/, 'the code is plain ASCII');
});

test('whitespace and line breaks pasted into a code are ignored', () => {
  const code = encode(FULL);
  const mangled = '  ' + code.slice(0, 10) + '\n' + code.slice(10, 30) + ' \r\n\t' + code.slice(30) + '\n';
  assert.deepEqual(decode(mangled), decode(code));
});

test('codes from elsewhere are rejected with a message saying why', () => {
  assert.match(decode('').message, /Paste a progress code/);
  assert.match(decode('   \n ').message, /Paste a progress code/);
  assert.match(decode(null).message, /Paste a progress code/);
  const sortedAgain = 'SA1:' + Buffer.from(JSON.stringify({ solved: { 1: 1 } })).toString('base64');
  const sa = decode(sortedAgain);
  assert.equal(sa.ok, false);
  assert.match(sa.message, /Sorted Again/);
  for (const other of ['hello', 'SQ:' + encode(FULL).slice(4), 'sq2:abc', 'SQ0:' + encode(FULL).slice(4), JSON.stringify(FULL)]) {
    const r = decode(other);
    assert.equal(r.ok, false, other.slice(0, 12));
    assert.match(r.message, /not a progress code from this course\. Codes start with SQ2:/);
  }
});

test('a truncated code never imports partial data', () => {
  const code = encode(FULL);
  const whole = decode(code).data;
  let refused = 0;
  for (let cut = PREFIX.length; cut < code.length; cut++) {
    const r = decode(code.slice(0, cut));
    if (r.ok) {
      // Only dropping the trailing '=' padding leaves every byte, which base64 decoders accept.
      assert.match(code.slice(cut), /^=+$/, `cut at ${cut} imported something`);
      assert.deepEqual(r.data, whole);
    } else {
      assert.match(r.message, INCOMPLETE);
      refused++;
    }
  }
  assert.ok(refused > 100);
  assert.match(decode(PREFIX).message, INCOMPLETE);
});

test('codes that are not an object, or not base64 at all, are reported as incomplete', () => {
  for (const json of ['null', '[1,2]', '"solved"', '42', 'true']) {
    const r = decode(PREFIX + Buffer.from(json).toString('base64'));
    assert.equal(r.ok, false, json);
    assert.match(r.message, INCOMPLETE);
  }
  assert.match(decode('SQ1:%%%not-base64%%%').message, INCOMPLETE);
  // Valid JSON around a broken character (the first byte of "é" without its second): refused, not imported as "�".
  const broken = Buffer.concat([Buffer.from('{"drafts":{"175":"caf'), Buffer.from([0xc3]), Buffer.from('"}}')]);
  assert.match(decode(PREFIX + broken.toString('base64')).message, INCOMPLETE, 'bytes that are not UTF-8');
});

test('a code from an older version, with keys missing, imports what it has', () => {
  const st = empty();
  st.quiz['joins-q1'] = { right: 3, total: 4, at: 5 };
  const r = decode(codeOf({ solved: { 175: 10 }, done: { basics: 20 } }));
  assert.equal(r.ok, true);
  const n = merge(st, r.data, known);
  assert.deepEqual(n, { ...N0, solved: 1, done: 1 });
  assert.equal(summary(n), 'Imported 1 solved problem and 1 finished module.');
  assert.deepEqual(st.solved, { 175: 10 });
  assert.deepEqual(st.quiz, { 'joins-q1': { right: 3, total: 4, at: 5 } });
  assert.deepEqual(st.tried, {});
  assert.deepEqual(st.drafts, {});
});

test('malformed values are skipped one by one, and never reshape the saved progress', () => {
  const st = empty();
  st.solved[177] = 7;
  const data = {
    solved: 'abc',                       // a string, not a map: Object.assign would have spread it into {0:'a',…}
    tried: [175, 176],
    done: { basics: 'yes', filtering: -1, joins: 0, nosuchmodule: 5 },
    quiz: {
      'basics-q1': { right: 6, total: 5, at: 1 },
      'joins-q1': { right: 2, total: 3 },  // no time
      'nosuch-q1': { right: 1, total: 1, at: 1 },
    },
    drafts: { 175: 42, 176: null, 177: ['SELECT'], 1757: 'SELECT 1;', 99999: 'unknown problem' },
  };
  const n = merge(st, data, known);
  assert.deepEqual(n, { ...N0, drafts: 1 });
  assert.deepEqual(st.solved, { 177: 7 });
  assert.deepEqual(st.tried, {});
  assert.deepEqual(st.done, {});
  assert.deepEqual(st.quiz, {});
  assert.deepEqual(st.drafts, { 1757: 'SELECT 1;' });
  // A mixed map keeps its good entries.
  const n2 = merge(st, { solved: { 175: 1, 176: '2', 177: null, 1757: Infinity }, quiz: { 'joins-q1': { right: 1, total: 2, at: 9, extra: 'dropped' } } }, known);
  assert.equal(n2.solved, 1);
  assert.deepEqual(st.solved, { 175: 1, 177: 7 });
  assert.deepEqual(st.quiz, { 'joins-q1': { right: 1, total: 2, at: 9 } });
});

test('merging keeps everything already here: solved, attempts, finished modules and local drafts', () => {
  const st = empty();
  Object.assign(st, {
    solved: { 175: 100, 177: 300 },
    tried: { 176: 150 },
    done: { basics: 200 },
    drafts: { 176: 'my local draft', 177: 'another local one' },
    quiz: { 'basics-q1': { right: 5, total: 5, at: 2000 }, 'joins-q1': { right: 1, total: 4, at: 1000 } },
  });
  const before = structuredClone(st);
  const n = merge(st, {
    solved: { 175: 999, 176: 500 },
    tried: { 176: 1, 1757: 2 },
    done: { basics: 999, joins: 400 },
    drafts: { 176: 'imported draft', 1757: 'imported only' },
    quiz: { 'basics-q1': { right: 2, total: 5, at: 1500 }, 'joins-q1': { right: 4, total: 4, at: 3000 } },
  }, known);
  assert.deepEqual(st.solved, { 175: 100, 176: 500, 177: 300 });
  assert.deepEqual(st.tried, { 176: 150, 1757: 2 });
  assert.deepEqual(st.done, { basics: 200, joins: 400 });
  assert.deepEqual(st.drafts, { 176: 'my local draft', 177: 'another local one', 1757: 'imported only' });
  assert.deepEqual(st.quiz['basics-q1'], before.quiz['basics-q1'], 'an older imported score does not replace a newer local one');
  assert.deepEqual(st.quiz['joins-q1'], { right: 4, total: 4, at: 3000 }, 'a newer imported score wins');
  for (const k of ['solved', 'tried', 'done', 'drafts', 'quiz']) {
    for (const id of Object.keys(before[k])) assert.ok(id in st[k], `${k} ${id} was lost`);
  }
  assert.equal(summary(n), 'Imported 2 solved problems and 2 finished modules, plus 2 quiz scores and 2 drafts.');
  const again = structuredClone(st);
  merge(st, decode(encode(st)).data, known);
  assert.deepEqual(st, again, 'importing your own code changes nothing');
});

test('old saves still load, and a wrong-typed value is ignored without wiping the rest', () => {
  // A save written by the first version of the course (no quiz key).
  const v1 = '{"solved":{"175":1727300000000},"tried":{"175":1727299000000,"176":1727299500000},"drafts":{"176":"SELECT 1;"},"done":{"basics":1727301000000},"last":"p176","play":"SELECT * FROM customers;","playDb":"empty"}';
  const st = load(v1, DEFAULTS());
  assert.deepEqual(st.solved, { 175: 1727300000000 });
  assert.deepEqual(Object.keys(st.tried), ['175', '176']);
  assert.deepEqual(st.drafts, { 176: 'SELECT 1;' });
  assert.deepEqual(st.done, { basics: 1727301000000 });
  assert.deepEqual(st.quiz, {});
  assert.equal(st.last, 'p176');
  assert.equal(st.play, 'SELECT * FROM customers;');
  assert.equal(st.playDb, 'empty');

  const odd = load('{"solved":[175],"tried":null,"done":{"basics":1},"quiz":"x","last":5,"play":"kept","playDb":null,"unknown":{}}', DEFAULTS());
  assert.deepEqual(odd, { ...DEFAULTS(), done: { basics: 1 }, play: 'kept' });

  for (const raw of [null, '', '{', 'null', '[]', '"str"', '7']) assert.deepEqual(load(raw, DEFAULTS()), DEFAULTS(), String(raw));
  const defaults = DEFAULTS();
  load(v1, defaults);
  assert.deepEqual(defaults, DEFAULTS(), 'the defaults object is not changed');
});

// ---------------------------------------------------------------- flashcards
const L = globalThis.Leitner;
const { pack, unpack, backupOf, restoreBackup } = globalThis.ProgressCode;
const IDS = ['basics.quiz.a', 'basics.key.b', 'joins.gotcha.c', 'p175.trap1', 'p175.approach'];
const HASH = new Map(IDS.map((id, i) => [id, `H${i}xx${String.fromCharCode(65 + i)}`]));   // 5 characters each
const cardKnown = { ...known, cards: new Map([...HASH].map(([id, h]) => [h, id])) };
const D = 20400;

test('a code from a copy with flashcards round-trips its schedule and early-added modules', () => {
  const from = Object.assign(empty(), structuredClone(FULL), {
    cards: { 'basics.quiz.a': [2, D], 'basics.key.b': [6, D - 40], 'joins.gotcha.c': [1, D], 'p175.trap1': [3, D - 2] },
    cardAdd: { joins: 1727300400000 }, cardNew: [D, 4],
  });
  const code = encode(from, HASH);
  const r = decode(code);
  assert.equal(r.ok, true);
  assert.equal(typeof r.data.k, 'string');
  const to = empty();
  const n = merge(to, r.data, cardKnown);
  assert.equal(n.cards, 4);
  assert.equal(n.cardAdd, 1);
  assert.deepEqual(to.cards, from.cards);
  assert.deepEqual(to.cardAdd, from.cardAdd);
  assert.deepEqual(to.cardNew, [0, 0], "today's new-card count stays on its device");
  assert.match(summary(n), /plus 1 quiz score, 1 draft and 4 flashcard reviews\.$/);
  assert.deepEqual(unpack(pack(from.cards, HASH)).length, 4);
});

test('merging a schedule keeps the later due day, and the newer review on a tie', () => {
  const st = empty();
  st.cards = {
    'basics.quiz.a': [3, D],        // due D+7: keeps, theirs is due D+3
    'basics.key.b': [1, D + 2],     // due D+3: theirs [2, D] is also due D+3 but reviewed earlier: mine stays
    'joins.gotcha.c': [2, D],       // due D+3: theirs [1, D+2] is due D+3 and newer: theirs wins
    'p175.trap1': [1, D],           // due D+1: theirs due D+16 wins
  };
  const theirs = { 'basics.quiz.a': [2, D], 'basics.key.b': [2, D], 'joins.gotcha.c': [1, D + 2], 'p175.trap1': [4, D], 'p175.approach': [5, D] };
  const n = merge(st, decode(encode({ cards: theirs }, HASH)).data, cardKnown);
  assert.equal(n.cards, 5);
  assert.deepEqual(st.cards, {
    'basics.quiz.a': [3, D], 'basics.key.b': [1, D + 2], 'joins.gotcha.c': [1, D + 2], 'p175.trap1': [4, D], 'p175.approach': [5, D],
  });
  for (const [id, e] of Object.entries(st.cards)) assert.ok(L.due(e) >= L.due(theirs[id] || e), `${id} moved earlier`);
  const again = structuredClone(st);
  merge(st, decode(encode(st, HASH)).data, cardKnown);
  assert.deepEqual(st, again, 'importing your own code changes nothing');
});

test('card ids this build does not know are ignored, and so are modules it does not have', () => {
  const st = empty();
  const k = pack({ 'basics.quiz.a': [2, D] }, HASH) + ',' + D.toString(36) + '3' + 'ZZZZZ' + 'YYYYY';
  const n = merge(st, { k, cardAdd: { nosuch: 5, joins: 6, basics: 'x' } }, cardKnown);
  assert.equal(n.cards, 1);
  assert.deepEqual(st.cards, { 'basics.quiz.a': [2, D] });
  assert.deepEqual(st.cardAdd, { joins: 6 });
  // Local entries for cards this build doesn't know are left alone.
  st.cards['old.card.id'] = [4, D];
  merge(st, { k }, cardKnown);
  assert.deepEqual(st.cards['old.card.id'], [4, D]);
  assert.equal(encode(st, HASH).includes('old.card.id'), false);
});

test('an SQ1 code from before flashcards imports cleanly', () => {
  const st = empty();
  st.cards = { 'basics.quiz.a': [2, D] };
  const r = decode(codeOf(FULL, 'SQ1:'));
  assert.equal(r.ok, true);
  const n = merge(st, r.data, cardKnown);
  assert.deepEqual(n, { ...N0, solved: 2, tried: 2, done: 1, quiz: 1, drafts: 1 });
  assert.deepEqual(st.cards, { 'basics.quiz.a': [2, D] }, 'the schedule already here is untouched');
  assert.equal(summary(n), 'Imported 2 solved problems and 1 finished module, plus 1 quiz score and 1 draft.');
});

test('a code from a newer version says so', () => {
  for (const pre of ['SQ3:', 'SQ10:']) {
    const r = decode(codeOf(FULL, pre));
    assert.equal(r.ok, false);
    assert.match(r.message, /newer version of SELECT Again\. Download the page again/);
  }
});

test('a schedule cut short or garbled refuses the whole code', () => {
  const cards = Object.fromEntries(IDS.map((id, i) => [id, [1 + (i % 6), D - i]]));
  const code = encode(Object.assign(empty(), structuredClone(FULL), { cards }), HASH);
  const whole = decode(code).data;
  for (let cut = PREFIX.length; cut < code.length; cut++) {
    const r = decode(code.slice(0, cut));
    if (r.ok) { assert.match(code.slice(cut), /^=+$/); assert.deepEqual(r.data, whole); } else assert.match(r.message, INCOMPLETE);
  }
  for (const k of ['abc', 'kq01', 'kq07AAAAA', 'kq01AAAA', 'kq01AAAAA,', 42, ['kq01AAAAA']]) {
    assert.match(decode(codeOf({ k })).message, INCOMPLETE, String(k));
  }
  assert.equal(decode(codeOf({ k: '' })).ok, true);
});

test('saved schedule entries are checked one by one', () => {
  const raw = JSON.stringify({ cards: { a: [2, D], b: [7, D], c: 'x', d: [1], e: [1, -1], f: [6, D] }, cardAdd: { joins: 5, sets: 'no' }, cardNew: [D, 'x'] });
  const st = load(raw, DEFAULTS());
  assert.deepEqual(st.cards, { a: [2, D], f: [6, D] });
  assert.deepEqual(st.cardAdd, { joins: 5 });
  assert.deepEqual(st.cardNew, [0, 0]);
  assert.deepEqual(load(JSON.stringify({ cardNew: [D, 3] }), DEFAULTS()).cardNew, [D, 3]);
});

test('a full deck adds a few KB to the code', () => {
  // Every card of a 400-card deck reviewed, spread over 60 review days and all six boxes.
  const ids = Array.from({ length: 400 }, (_, i) => `m${i % 15}.kind.card-number-${i}`);
  const hashOf = new Map(ids.map((id, i) => [id, ('0000' + i.toString(36)).slice(-4) + 'Q']));
  const all = Object.assign(empty(), structuredClone(FULL));
  const base = encode(all, hashOf).length;
  all.cards = Object.fromEntries(ids.map((id, i) => [id, [1 + (i % 6), D - (i % 60)]]));
  all.cardAdd = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`m${i}`, 1727300400000]));
  const full = encode(all, hashOf).length;
  const extra = full - base;
  console.log(`# full deck: +${extra} characters (${(extra / 400).toFixed(1)} per card)`);
  assert.ok(extra < 4500, `a full deck adds ${extra} characters`);
  assert.equal(unpack(decode(encode(all, hashOf)).data.k).length, 400);
});

test('the schedule backup brings back what an older copy of the page dropped', () => {
  const st = Object.assign(empty(), { cards: { 'basics.quiz.a': [2, D], 'joins.gotcha.c': [5, D - 30] }, cardAdd: { joins: 7 }, cardNew: [D, 6] });
  const backup = backupOf(st);
  assert.deepEqual(Object.keys(JSON.parse(backup)), ['cards', 'cardAdd', 'cardNew'], 'only the schedule is backed up');
  // An older page saved: the main save lost the flashcard keys but kept a new solved problem.
  const older = JSON.stringify({ solved: { 175: 9 }, tried: {}, drafts: {}, done: {}, quiz: {}, last: '', play: '', playDb: 'sample' });
  const back = load(older, DEFAULTS());
  assert.deepEqual(back.cards, {});
  assert.equal(restoreBackup(back, backup), 2);
  assert.deepEqual([back.cards, back.cardAdd, back.cardNew], [st.cards, st.cardAdd, st.cardNew]);
  assert.deepEqual(back.solved, { 175: 9 }, 'what the older page saved is kept');
});

test('restoring the backup never moves a card earlier, and ignores a broken backup', () => {
  const st = Object.assign(empty(), { cards: { a: [4, D], b: [1, D] }, cardAdd: { sets: 1 }, cardNew: [D + 1, 2] });
  const n = restoreBackup(st, JSON.stringify({ cards: { a: [2, D], b: [3, D - 1], c: [9, D], d: 'x' }, cardAdd: { sets: 5, joins: 6, x: 'no' }, cardNew: [D, 19] }));
  assert.equal(n, 1);
  assert.deepEqual(st.cards, { a: [4, D], b: [3, D - 1] }, 'a stays (due later here), b moves to the later due day');
  assert.deepEqual(st.cardAdd, { sets: 1, joins: 6 });
  assert.deepEqual(st.cardNew, [D + 1, 2], 'an older day count does not replace a newer one');
  for (const raw of [null, '', '{', '[]', '"x"', '{"cards":[1]}']) {
    const s2 = Object.assign(empty(), { cards: { a: [1, D] } });
    restoreBackup(s2, raw);
    assert.deepEqual(s2.cards, { a: [1, D] }, String(raw));
  }
});
