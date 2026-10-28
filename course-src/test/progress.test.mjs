import test from 'node:test';
import assert from 'node:assert/strict';
import '../lib/progress.js';

const { load, encode, decode, merge, summary, PREFIX } = globalThis.ProgressCode;
const known = {
  problems: new Set(['175', '176', '177', '1757']),
  modules: new Set(['basics', 'filtering', 'joins']),
  quizzes: new Set(['basics-q1', 'joins-q1']),
};
const DEFAULTS = () => ({ solved: {}, tried: {}, drafts: {}, done: {}, quiz: {}, last: '', play: '', playDb: 'sample' });
const empty = () => load(null, DEFAULTS());
const codeOf = (data) => PREFIX + Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
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
  assert.ok(code.startsWith('SQ1:'));
  const r = decode(code);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data).sort(), ['done', 'drafts', 'quiz', 'solved', 'tried'], 'page position and scratchpad are not progress');
  const to = empty();
  const n = merge(to, r.data, known);
  assert.deepEqual(n, { solved: 2, tried: 2, done: 1, quiz: 1, drafts: 1 });
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
  assert.match(encode({ drafts }), /^SQ1:[A-Za-z0-9+/]+=*$/, 'the code is plain ASCII');
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
  for (const other of ['hello', 'SQ2:' + encode(FULL).slice(4), 'sq1:abc', JSON.stringify(FULL)]) {
    const r = decode(other);
    assert.equal(r.ok, false, other.slice(0, 12));
    assert.match(r.message, /not a progress code from this course\. Codes start with SQ1:/);
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
  assert.deepEqual(n, { solved: 1, tried: 0, done: 1, quiz: 0, drafts: 0 });
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
  assert.deepEqual(n, { solved: 0, tried: 0, done: 0, quiz: 0, drafts: 1 });
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
  assert.deepEqual(odd, { solved: {}, tried: {}, drafts: {}, done: { basics: 1 }, quiz: {}, last: '', play: 'kept', playDb: 'sample' });

  for (const raw of [null, '', '{', 'null', '[]', '"str"', '7']) assert.deepEqual(load(raw, DEFAULTS()), DEFAULTS(), String(raw));
  const defaults = DEFAULTS();
  load(v1, defaults);
  assert.deepEqual(defaults, DEFAULTS(), 'the defaults object is not changed');
});
