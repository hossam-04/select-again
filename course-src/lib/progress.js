// Saved progress and progress codes: loading a save, encoding, decoding and merging. No storage, no DOM.
// Plain script: attaches `ProgressCode` to globalThis.
(function (root) {
  'use strict';

  const PREFIX = 'SQ1:';
  const KEYS = ['solved', 'tried', 'done', 'quiz', 'drafts'];
  const INCOMPLETE = 'This progress code is incomplete. Copy the whole code again and paste it here.';

  const sameShape = (a, b) => typeof a === typeof b && Array.isArray(a) === Array.isArray(b) && (a === null) === (b === null);
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isCount = (v) => Number.isInteger(v) && v >= 0;
  const isQuizScore = (v) => isMap(v) && isCount(v.right) && isCount(v.total) && v.total > 0 && v.right <= v.total && isTime(v.at);

  // A save from localStorage over the defaults: each key whose type matches its default replaces it, the rest is
  // ignored, so one bad value never wipes the others. Saves from before a key existed keep its default.
  function load(raw, defaults) {
    const state = Object.assign({}, defaults);
    let saved = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch (e) { /* unreadable save: start from the defaults */ }
    if (!isMap(saved)) return state;
    for (const k of Object.keys(state)) if (saved[k] !== undefined && sameShape(saved[k], state[k])) state[k] = saved[k];
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

  function encode(state) {
    const data = {};
    for (const k of KEYS) data[k] = isMap(state[k]) ? state[k] : {};
    return PREFIX + toBase64(JSON.stringify(data));
  }

  // { ok: true, data } or { ok: false, message }. Whitespace is dropped first: a code pasted on a phone often
  // picks up line breaks.
  function decode(text) {
    const s = String(text === null || text === undefined ? '' : text).replace(/\s+/g, '');
    if (!s) return { ok: false, message: 'Paste a progress code into the box first.' };
    if (s.startsWith('SA1:')) return { ok: false, message: 'That code is from Sorted Again, the DSA course. SELECT Again codes start with SQ1:.' };
    if (!s.startsWith(PREFIX)) return { ok: false, message: 'That is not a progress code from this course. Codes start with SQ1:.' };
    let data;
    try { data = JSON.parse(fromBase64(s.slice(PREFIX.length))); } catch (e) { return { ok: false, message: INCOMPLETE }; }
    return isMap(data) ? { ok: true, data } : { ok: false, message: INCOMPLETE };
  }

  // Adds a decoded code's progress to `state` without losing anything already there: solved problems, attempts,
  // finished modules and drafts already here are kept, and a quiz keeps whichever score is more recent. Entries
  // with the wrong type, or for ids this course doesn't have, are skipped. `known` holds Sets of this course's
  // ids as strings: { problems, modules, quizzes }. Returns how many valid entries of each kind the code carried.
  function merge(state, data, known) {
    const n = { solved: 0, tried: 0, done: 0, quiz: 0, drafts: 0 };
    const rules = {
      solved: [known.problems, isTime],
      tried: [known.problems, isTime],
      done: [known.modules, isTime],
      drafts: [known.problems, (v) => typeof v === 'string'],
      quiz: [known.quizzes, isQuizScore],
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
    return n;
  }

  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function summary(n) {
    const extra = [n.quiz ? count(n.quiz, 'quiz score') : '', n.drafts ? count(n.drafts, 'draft') : ''].filter(Boolean);
    return `Imported ${count(n.solved, 'solved problem')} and ${count(n.done, 'finished module')}${extra.length ? `, plus ${extra.join(' and ')}` : ''}.`;
  }

  root.ProgressCode = { PREFIX, sameShape, isQuizScore, load, encode, decode, merge, summary };
})(typeof globalThis !== 'undefined' ? globalThis : window);
