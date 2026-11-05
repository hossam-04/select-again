// Flashcard scheduling with Leitner boxes. No storage, no DOM, no clock: callers pass `today`, a day number.
// Plain script: attaches `Leitner` to globalThis.
//   A schedule entry is [box, reviewDay]: the box (1-6) after the last review and the day of that review.
//   Due day = reviewDay + INTERVALS[box - 1]. A card with no entry is new, and counts as being in box 1.
(function (root) {
  'use strict';

  const INTERVALS = [1, 3, 7, 16, 35, 80];
  const MAX_BOX = INTERVALS.length;
  const NEW_PER_DAY = 20;
  const AGAIN = 1, GOOD = 2, EASY = 3;

  // The local calendar date as a day number: built from the local date fields, so DST changes and time zones
  // never split or merge a day (milliseconds / 86400000 would).
  function dayOf(ms) {
    const d = new Date(ms);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  // A day number back to a date (UTC fields), for labels.
  const dateOf = (day) => new Date(day * 86400000);

  const isDay = (v) => Number.isInteger(v) && v >= 0 && v < 1e6;
  const isEntry = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && v[0] >= 1 && v[0] <= MAX_BOX && isDay(v[1]);
  const due = (entry) => entry[1] + INTERVALS[entry[0] - 1];

  function nextBox(entry, grade) {
    const box = isEntry(entry) ? entry[0] : 1;
    if (grade === AGAIN) return 1;
    return Math.min(MAX_BOX, box + (grade === EASY ? 2 : 1));
  }
  const rate = (entry, grade, today) => [nextBox(entry, grade), today];
  const intervalAfter = (entry, grade) => INTERVALS[nextBox(entry, grade) - 1];

  const entryOf = (state, card) => {
    const e = state.cards && state.cards[card.id];
    return isEntry(e) ? e : null;
  };
  // In the deck: reviewed before, or its module was finished or added, or (problem cards) its problem is solved.
  function inDeck(card, state) {
    if (entryOf(state, card)) return true;
    if (card.p !== undefined) return !!(state.solved && state.solved[card.p]);
    return !!((state.done && state.done[card.m]) || (state.cardAdd && state.cardAdd[card.m]));
  }

  const newToday = (state, today) => (Array.isArray(state.cardNew) && state.cardNew[0] === today ? state.cardNew[1] : 0);
  const newLeft = (state, today) => Math.max(0, NEW_PER_DAY - newToday(state, today));

  // The cards to show now: due ones first (earliest due day first, then deck order), then new ones in deck order.
  // `module` narrows to one module. `study` lifts the daily limit on new cards (studying one module on purpose).
  function queue(cards, state, today, opts) {
    opts = opts || {};
    const pool = opts.module ? cards.filter((c) => c.m === opts.module) : cards;
    const dueCards = [];
    const fresh = [];
    pool.forEach((c, i) => {
      const e = entryOf(state, c);
      if (e) { if (due(e) <= today) dueCards.push({ c, d: due(e), i }); } else if (inDeck(c, state)) fresh.push(c);
    });
    dueCards.sort((a, b) => a.d - b.d || a.i - b.i);
    return { due: dueCards.map((x) => x.c), fresh: opts.study ? fresh : fresh.slice(0, newLeft(state, today)) };
  }

  function counts(cards, state, today, module) {
    const pool = module ? cards.filter((c) => c.m === module) : cards;
    const q = queue(pool, state, today);
    let deck = 0, unseen = 0, next = null;
    for (const c of pool) {
      if (!inDeck(c, state)) continue;
      deck++;
      const e = entryOf(state, c);
      if (!e) unseen++;
      else if (due(e) > today && (next === null || due(e) < next)) next = due(e);
    }
    return { due: q.due.length, fresh: q.fresh.length, deck, unseen, outside: pool.length - deck, next, total: pool.length };
  }

  // Records a rating. Returns the new entry. A first review counts toward today's new cards.
  function review(state, card, grade, today) {
    if (!state.cards || typeof state.cards !== 'object') state.cards = {};
    const before = entryOf(state, card);
    const entry = rate(before, grade, today);
    state.cards[card.id] = entry;
    if (!before) state.cardNew = [today, newToday(state, today) + 1];
    return entry;
  }

  // Forget every review, the modules added early and today's new-card count. Finished modules and solved
  // problems still bring their cards back, as new.
  function reset(state) {
    state.cards = {};
    state.cardAdd = {};
    state.cardNew = [0, 0];
  }

  root.Leitner = { INTERVALS, MAX_BOX, NEW_PER_DAY, AGAIN, GOOD, EASY, dayOf, dateOf, isEntry, due, rate, intervalAfter, inDeck, newLeft, queue, counts, review, reset };
})(typeof globalThis !== 'undefined' ? globalThis : window);
