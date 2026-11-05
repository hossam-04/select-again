import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../lib/leitner.js';

const L = globalThis.Leitner;
const LIB = fileURLToPath(new URL('../lib/leitner.js', import.meta.url));
const T = 20400; // a day number (2025-11-07); tests count from here
const blank = () => ({ solved: {}, done: {}, cardAdd: {}, cards: {}, cardNew: [0, 0] });
const card = (id, m, extra) => ({ id, m, ...extra });

test('box moves: Again to box 1, Good up one, Easy up two, capped at box 6', () => {
  assert.deepEqual(L.INTERVALS, [1, 3, 7, 16, 35, 80]);
  // A new card counts as box 1.
  assert.deepEqual(L.rate(undefined, L.AGAIN, T), [1, T]);
  assert.deepEqual(L.rate(undefined, L.GOOD, T), [2, T]);
  assert.deepEqual(L.rate(undefined, L.EASY, T), [3, T]);
  for (let box = 1; box <= 6; box++) {
    const e = [box, T - 50];
    assert.deepEqual(L.rate(e, L.AGAIN, T), [1, T], `Again from ${box}`);
    assert.deepEqual(L.rate(e, L.GOOD, T), [Math.min(6, box + 1), T], `Good from ${box}`);
    assert.deepEqual(L.rate(e, L.EASY, T), [Math.min(6, box + 2), T], `Easy from ${box}`);
  }
  assert.equal(L.due([1, T]), T + 1);
  assert.equal(L.due([6, T]), T + 80);
  assert.equal(L.intervalAfter(undefined, L.GOOD), 3);
  assert.equal(L.intervalAfter([5, T], L.EASY), 80);
});

test('a late review is scheduled from the day it happened', () => {
  const st = blank();
  const c = card('a', 'joins');
  st.cards.a = [3, T];            // due T + 7
  const e = L.review(st, c, L.GOOD, T + 20);
  assert.deepEqual(e, [4, T + 20]);
  assert.equal(L.due(e), T + 36);
});

test('due days across midnight follow the local calendar date', () => {
  const late = new Date(2026, 0, 14, 23, 59, 30).getTime();
  const early = new Date(2026, 0, 15, 0, 0, 30).getTime();
  assert.equal(L.dayOf(early) - L.dayOf(late), 1);
  const st = blank();
  const c = card('a', 'joins');
  st.done.joins = 1;
  L.review(st, c, L.GOOD, L.dayOf(late));
  const day = L.dayOf(late);
  assert.equal(L.queue([c], st, day + 2).due.length, 0, 'not due a minute before the third midnight');
  assert.equal(L.queue([c], st, day + 3).due.length, 1, 'due on the third day');
});

// Each time zone runs in its own process: TZ is read when the process starts.
function inZone(tz, code) {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)});const L=globalThis.Leitner;${code}`], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('day numbers in other time zones and across DST changes', () => {
  const code = `
    const out = {};
    const midnight = (y, m, d) => new Date(y, m, d).getTime();
    // consecutive local midnights are always exactly one day apart, including the DST days
    out.steps = [[2026, 2, 7], [2026, 2, 8], [2026, 2, 29], [2026, 3, 5], [2026, 9, 25], [2026, 10, 1], [2026, 8, 27]]
      .map(([y, m, d]) => L.dayOf(midnight(y, m, d + 1)) - L.dayOf(midnight(y, m, d)));
    out.lastMs = L.dayOf(midnight(2026, 2, 9) - 1) - L.dayOf(midnight(2026, 2, 8));
    out.noonUtc = L.dayOf(Date.UTC(2026, 5, 1, 12));
    out.lateUtc = L.dayOf(Date.UTC(2026, 5, 1, 23, 30));
    out.calendar = L.dayOf(new Date(2026, 5, 1, 12).getTime());
    console.log(JSON.stringify(out));`;
  const june1 = Date.UTC(2026, 5, 1) / 86400000;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Europe/London', 'Asia/Kolkata']) {
    const r = inZone(tz, code);
    assert.deepEqual(r.steps, [1, 1, 1, 1, 1, 1, 1], tz);
    assert.equal(r.lastMs, 0, `${tz}: 23:59:59.999 is still the same day`);
    assert.equal(r.calendar, june1, `${tz}: noon on 1 June local is day ${june1}`);
    // The same instant is a different local date in different zones.
    if (tz === 'UTC') assert.deepEqual([r.noonUtc, r.lateUtc], [june1, june1]);
    if (tz === 'Pacific/Auckland') assert.deepEqual([r.noonUtc, r.lateUtc], [june1 + 1, june1 + 1]);
    if (tz === 'America/Los_Angeles') assert.deepEqual([r.noonUtc, r.lateUtc], [june1, june1]);
    if (tz === 'Asia/Kolkata') assert.deepEqual([r.noonUtc, r.lateUtc], [june1, june1 + 1]);
  }
});

test('at most 20 new cards a day; studying a module goes past it but still counts', () => {
  const cards = Array.from({ length: 30 }, (_, i) => card(`a${i}`, i < 25 ? 'joins' : 'sets'));
  const st = blank();
  st.done.joins = 1;
  st.done.sets = 1;
  let q = L.queue(cards, st, T);
  assert.equal(q.fresh.length, 20);
  assert.deepEqual(q.fresh.map((c) => c.id), cards.slice(0, 20).map((c) => c.id), 'deck order');
  for (const c of q.fresh.slice(0, 15)) L.review(st, c, L.GOOD, T);
  assert.equal(L.newLeft(st, T), 5);
  assert.equal(L.queue(cards, st, T).fresh.length, 5);
  // Studying "sets" shows all of its new cards; they count toward today's 20.
  const study = L.queue(cards, st, T, { module: 'sets', study: true });
  assert.equal(study.fresh.length, 5);
  for (const c of study.fresh) L.review(st, c, L.GOOD, T);
  assert.equal(L.newLeft(st, T), 0);
  assert.equal(L.queue(cards, st, T).fresh.length, 0);
  assert.equal(L.queue(cards, st, T, { module: 'joins', study: true }).fresh.length, 10, 'study ignores the limit');
  // A new day starts a new count. Re-reviewing a card is not a new card.
  assert.equal(L.newLeft(st, T + 1), 20);
  L.review(st, cards[0], L.AGAIN, T + 1);
  assert.equal(L.newLeft(st, T + 1), 20);
});

test('due cards come first, earliest due first, and the module filter narrows both', () => {
  const cards = [card('x', 'joins'), card('y', 'joins'), card('z', 'sets'), card('n', 'sets')];
  const st = blank();
  st.done.joins = 1;
  st.done.sets = 1;
  st.cards = { x: [2, T - 1], y: [1, T - 5], z: [1, T - 1] };   // due T+2, T-4, T
  let q = L.queue(cards, st, T);
  assert.deepEqual(q.due.map((c) => c.id), ['y', 'z']);
  assert.deepEqual(q.fresh.map((c) => c.id), ['n']);
  q = L.queue(cards, st, T, { module: 'sets' });
  assert.deepEqual([q.due.map((c) => c.id), q.fresh.map((c) => c.id)], [['z'], ['n']]);
  const n = L.counts(cards, st, T);
  assert.deepEqual(n, { due: 2, fresh: 1, deck: 4, unseen: 1, outside: 0, next: T + 2, total: 4 });
});

test('which cards are in the deck', () => {
  const mod = card('m1', 'joins');
  const prob = card('p175.trap1', 'joins', { p: 175 });
  const st = blank();
  assert.equal(L.inDeck(mod, st), false);
  st.cardAdd.joins = 5;
  assert.equal(L.inDeck(mod, st), true, 'module added early');
  assert.equal(L.inDeck(prob, st), false, 'problem cards wait for the problem to be solved');
  st.solved[175] = 9;
  assert.equal(L.inDeck(prob, st), true);
  delete st.cardAdd.joins;
  st.done.joins = 7;
  assert.equal(L.inDeck(mod, st), true, 'finished module');
  delete st.done.joins;
  assert.equal(L.inDeck(mod, st), false, 'un-finishing drops cards not reviewed yet');
  st.cards.m1 = [2, T];
  assert.equal(L.inDeck(mod, st), true, 'a reviewed card stays');
  // Broken entries are ignored one by one, never crash the queue.
  st.cards = { m1: [9, T], x: 'junk', y: [2] };
  assert.equal(L.inDeck(mod, st), false);
  assert.deepEqual(L.queue([mod], st, T).due, []);
  // Entries for cards this build doesn't have are ignored (and left alone).
  st.cards.gone = [1, T - 9];
  assert.equal(L.counts([mod], st, T).due, 0);
  assert.ok(st.cards.gone);
});

test('reset forgets reviews, early-added modules and the new-card count', () => {
  const cards = [card('a', 'joins'), card('b', 'sets')];
  const st = blank();
  st.done.joins = 1;
  st.cardAdd.sets = 2;
  L.review(st, cards[0], L.EASY, T);
  L.review(st, cards[1], L.GOOD, T);
  L.reset(st);
  assert.deepEqual([st.cards, st.cardAdd, st.cardNew], [{}, {}, [0, 0]]);
  assert.equal(L.newLeft(st, T), 20);
  const q = L.queue(cards, st, T);
  assert.deepEqual(q.fresh.map((c) => c.id), ['a'], 'finished modules still bring their cards, as new');
  assert.equal(st.done.joins, 1, 'finished modules are untouched');
});
