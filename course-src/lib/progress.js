// Saved progress and progress codes: loading a save, encoding, decoding and merging. No storage, no DOM.
// Plain script: attaches `ProgressCode` to globalThis. Needs `Leitner` (lib/leitner.js) for flashcard due days.
//   SQ2: base64 of JSON { solved, tried, done, quiz, drafts, cardAdd, k }. `k` is the flashcard schedule, packed:
//   comma-separated groups, one per (review day, box): 3 base36 characters of day, 1 digit of box, then the
//   5-character hash of each card reviewed that day into that box. SQ1: is the same without cardAdd and k.
(function (root) {
  'use strict';

  const PREFIX = 'SQ2:';
  const OLDER = ['SQ1:'];
  const KEYS = ['solved', 'tried', 'done', 'quiz', 'drafts', 'cardAdd'];
  const INCOMPLETE = 'This progress code is incomplete. Copy the whole code again and paste it here.';
  const NEWER = 'This code is from a newer version of SELECT Again. Download the page again (sql-course.html), then import it there.';

  const sameShape = (a, b) => typeof a === typeof b && Array.isArray(a) === Array.isArray(b) && (a === null) === (b === null);
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isCount = (v) => Number.isInteger(v) && v >= 0;
  const isQuizScore = (v) => isMap(v) && isCount(v.right) && isCount(v.total) && v.total > 0 && v.right <= v.total && isTime(v.at);
  const isEntry = (v) => root.Leitner.isEntry(v);
  // Saved values checked entry by entry: one bad entry is dropped, the rest of its map is kept.
  const ENTRIES = { cards: isEntry, cardAdd: isTime };
  const isNewCount = (v) => Array.isArray(v) && v.length === 2 && isCount(v[0]) && isCount(v[1]);

  // A save from localStorage over the defaults: each key whose type matches its default replaces it, the rest is
  // ignored, so one bad value never wipes the others. Saves from before a key existed keep its default.
  function load(raw, defaults) {
    const state = Object.assign({}, defaults);
    let saved = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch (e) { /* unreadable save: start from the defaults */ }
    if (!isMap(saved)) return state;
    for (const k of Object.keys(state)) if (saved[k] !== undefined && sameShape(saved[k], state[k])) state[k] = saved[k];
    for (const [k, valid] of Object.entries(ENTRIES)) {
      if (!isMap(state[k]) || state[k] === defaults[k]) continue;
      state[k] = Object.fromEntries(Object.entries(state[k]).filter(([, v]) => valid(v)));
    }
    if ('cardNew' in state && !isNewCount(state.cardNew)) state.cardNew = defaults.cardNew;
    return state;
  }

  // UTF-8 safe base64, so drafts with accents, Arabic or emoji survive the trip.
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  // The schedule as `k`. `hashOf` maps card ids to their 5-character hashes; ids it doesn't know are left out.
  const B36 = (n) => n.toString(36).padStart(3, '0');
  function pack(cards, hashOf) {
    const groups = new Map();
    for (const [id, e] of Object.entries(isMap(cards) ? cards : {})) {
      const h = hashOf && hashOf.get(id);
      if (!h || !isEntry(e) || e[1] >= 36 ** 3) continue;
      const key = B36(e[1]) + e[0];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(h);
    }
    return [...groups.keys()].sort().map((key) => key + groups.get(key).sort().join('')).join(',');
  }
  // [[hash, box, day]] from `k`, or null if any group is malformed.
  function unpack(k) {
    if (k === undefined || k === '') return [];
    if (typeof k !== 'string') return null;
    const out = [];
    for (const g of k.split(',')) {
      if (!/^[0-9a-z]{3}[1-6](?:[A-Za-z0-9_-]{5})+$/.test(g)) return null;
      const day = parseInt(g.slice(0, 3), 36);
      const box = Number(g[3]);
      for (let i = 4; i < g.length; i += 5) out.push([g.slice(i, i + 5), box, day]);
    }
    return out;
  }

  function encode(state, hashOf) {
    const data = {};
    for (const k of KEYS) data[k] = isMap(state[k]) ? state[k] : {};
    data.k = pack(state.cards, hashOf);
    return PREFIX + toBase64(JSON.stringify(data));
  }

  // { ok: true, data } or { ok: false, message }. Whitespace is dropped first: a code pasted on a phone often
  // picks up line breaks.
  function decode(text) {
    const s = String(text === null || text === undefined ? '' : text).replace(/\s+/g, '');
    if (!s) return { ok: false, message: 'Paste a progress code into the box first.' };
    if (s.startsWith('SA1:')) return { ok: false, message: 'That code is from Sorted Again, the DSA course. SELECT Again codes start with SQ2:.' };
    const v = /^SQ(\d+):/.exec(s);
    if (v && Number(v[1]) > Number(PREFIX.slice(2, -1))) return { ok: false, message: NEWER };
    const prefix = [PREFIX, ...OLDER].find((p) => s.startsWith(p));
    if (!prefix) return { ok: false, message: 'That is not a progress code from this course. Codes start with SQ2: (or SQ1: from older copies).' };
    let data;
    try { data = JSON.parse(fromBase64(s.slice(prefix.length))); } catch (e) { return { ok: false, message: INCOMPLETE }; }
    if (!isMap(data)) return { ok: false, message: INCOMPLETE };
    // A schedule cut short or garbled refuses the whole code rather than importing part of it.
    if (unpack(data.k) === null) return { ok: false, message: INCOMPLETE };
    return { ok: true, data };
  }

  // Adds a decoded code's progress to `state` without losing anything already there: solved problems, attempts,
  // finished modules and drafts already here are kept, and a quiz keeps whichever score is more recent. Entries
  // with the wrong type, or for ids this course doesn't have, are skipped. `known` holds Sets of this course's
  // ids as strings: { problems, modules, quizzes }, and `cards`, a Map from card hash to card id.
  // Flashcards: each card keeps the entry with the later due day; on a tie, the later review; on a full tie, the
  // one already here. Modules added early are a union. Returns how many valid entries of each kind the code carried.
  function merge(state, data, known) {
    const n = { solved: 0, tried: 0, done: 0, quiz: 0, drafts: 0, cardAdd: 0, cards: 0 };
    const rules = {
      solved: [known.problems, isTime],
      tried: [known.problems, isTime],
      done: [known.modules, isTime],
      drafts: [known.problems, (v) => typeof v === 'string'],
      quiz: [known.quizzes, isQuizScore],
      cardAdd: [known.modules, isTime],
    };
    for (const [k, [ids, valid]] of Object.entries(rules)) {
      if (!isMap(data[k])) continue;
      if (!isMap(state[k])) state[k] = {};
      for (const [id, v] of Object.entries(data[k])) {
        if (!ids.has(id) || !valid(v)) continue;
        n[k]++;
        if (k === 'quiz') {
          const mine = state.quiz[id];
          if (!isQuizScore(mine) || v.at > mine.at) state.quiz[id] = { right: v.right, total: v.total, at: v.at };
        } else if (!state[k][id]) state[k][id] = v;
      }
    }
    const hashes = known.cards || new Map();
    if (!isMap(state.cards)) state.cards = {};
    for (const [h, box, day] of unpack(data.k) || []) {
      const id = hashes.get(h);
      if (!id) continue;
      n.cards++;
      const theirs = [box, day];
      const mine = state.cards[id];
      const L = root.Leitner;
      if (!isEntry(mine) || L.due(theirs) > L.due(mine) || (L.due(theirs) === L.due(mine) && day > mine[1])) state.cards[id] = theirs;
    }
    return n;
  }

  // The flashcard schedule is also saved under its own key, because copies of the page from before flashcards
  // keep only the keys they know and drop the schedule from the main save when they write it.
  const BACKUP_KEYS = ['cards', 'cardAdd', 'cardNew'];
  const backupOf = (state) => JSON.stringify(Object.fromEntries(BACKUP_KEYS.map((k) => [k, state[k]])));
  // Merges a backup into a loaded state with the import rules (later due day wins, modules are a union), and
  // takes its new-card count when the save has none for that day or a lower one. Returns how many cards it added
  // or moved later.
  function restoreBackup(state, raw) {
    let b = null;
    try { b = raw ? JSON.parse(raw) : null; } catch (e) { return 0; }
    if (!isMap(b)) return 0;
    const L = root.Leitner;
    let n = 0;
    if (!isMap(state.cards)) state.cards = {};
    if (isMap(b.cards)) {
      for (const [id, e] of Object.entries(b.cards)) {
        if (!isEntry(e)) continue;
        const mine = state.cards[id];
        if (!isEntry(mine) || L.due(e) > L.due(mine) || (L.due(e) === L.due(mine) && e[1] > mine[1])) { state.cards[id] = [e[0], e[1]]; n++; }
      }
    }
    if (!isMap(state.cardAdd)) state.cardAdd = {};
    if (isMap(b.cardAdd)) for (const [id, t] of Object.entries(b.cardAdd)) if (isTime(t) && !state.cardAdd[id]) state.cardAdd[id] = t;
    if (isNewCount(b.cardNew)) {
      const mine = isNewCount(state.cardNew) ? state.cardNew : [0, 0];
      if (b.cardNew[0] > mine[0] || (b.cardNew[0] === mine[0] && b.cardNew[1] > mine[1])) state.cardNew = [b.cardNew[0], b.cardNew[1]];
    }
    return n;
  }

  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function summary(n) {
    const extra = [n.quiz ? count(n.quiz, 'quiz score') : '', n.drafts ? count(n.drafts, 'draft') : '', n.cards ? count(n.cards, 'flashcard review') : ''].filter(Boolean);
    const list = extra.length > 2 ? `${extra.slice(0, -1).join(', ')} and ${extra[extra.length - 1]}` : extra.join(' and ');
    return `Imported ${count(n.solved, 'solved problem')} and ${count(n.done, 'finished module')}${extra.length ? `, plus ${list}` : ''}.`;
  }

  root.ProgressCode = { PREFIX, sameShape, isQuizScore, load, encode, decode, merge, summary, pack, unpack, backupOf, restoreBackup };
})(typeof globalThis !== 'undefined' ? globalThis : window);
