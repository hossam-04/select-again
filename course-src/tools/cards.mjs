// Flashcards, derived at build time from content the build already checks. Pure functions: no files, no engine.
// Card ids come from the source (module id, block kind, a slug of the question or title; problem id plus trap
// index), never from a position on the page, so editing one module leaves every other card's id alone.
import '../lib/slug.js';
import '../lib/cardlist.js';

const { slug } = globalThis.Slug;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// The text a browser would show for a fragment of our own HTML (what `textContent` returns).
export function textOf(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : all;
    });
}
const plain = (html) => textOf(html).replace(/\s+/g, ' ').trim();

// 30 bits of FNV-1a as 5 base64url characters (lib/cardlist.js, shared with the page).
export const hash30 = (id) => globalThis.CardList.hash30(id);

// Which callouts become cards unless a block says {card} or {nocard}, and the question each kind asks.
export const CARD_KINDS = { gotcha: true, key: true, dialect: true, work: true, tip: false, interview: false, note: false };
export const PROMPTS = {
  gotcha: 'What’s the catch?',
  key: 'Explain it, and why it holds.',
  dialect: 'How does MySQL compare with other databases?',
  work: 'What should you know when it comes up at work?',
};
// "What does this return?" only for examples whose data you can see on the card.
export const OUT_LIMITS = { setupRows: 12, rows: 8, cols: 5 };

export const calloutId = (module, kind, titleHtml) => `${module}.${kind}.${slug(plain(titleHtml))}`;
export const quizCardId = (module, qHtml) => `${module}.quiz.${slug(plain(qHtml))}`;
export const outCardId = (module, ex) => `${module}.out.${slug(ex.title || ex.sql.replace(/^\s*--.*$/gm, '').trim().slice(0, 40))}`;

// Parses a callout's `:::kind Title {card} {ask: …}` line. Returns the title without its markers.
export function calloutMarkers(kind, rawTitle) {
  let title = rawTitle || '';
  let ask = '';
  let carded = CARD_KINDS[kind] === true;
  title = title.replace(/\{ask:\s*([^}]*)\}/, (m, q) => { ask = q.trim(); return ''; });
  title = title.replace(/\{(no)?card\}/, (m, no) => { carded = !no; return ''; });
  return { title: title.trim(), ask, carded };
}

export function outEligible(ex) {
  const o = ex.output;
  if (ex.nocard || !o || o.error || (o.warnings && o.warnings.length) || o.explain) return false;
  if (!o.columns.length || o.columns.length > OUT_LIMITS.cols || o.total > OUT_LIMITS.rows) return false;
  if (ex.db === 'empty') return true;
  return ex.db !== 'sample' && typeof ex.setupRows === 'number' && ex.setupRows <= OUT_LIMITS.setupRows;
}

// Cheat-sheet sections -> cards: one per table row, and one per bullet or paragraph with a {{hidden}} part.
// sections: [{ title, anchor, module, html }] with hidden parts already rendered as <span class="cloze">.
export function sheetCards(sections) {
  const cards = [];
  const errors = [];
  for (const sec of sections) {
    const where = `cheat sheet "${sec.title}"`;
    const base = `sheet.${slug(sec.title)}`;
    const found = [];
    if (/\{\{|\}\}/.test(sec.html)) errors.push(`${where}: a {{…}} mark was not turned into a hidden part (unmatched, or inside a code span)`);
    for (const t of sec.html.matchAll(/<table class="md"><thead><tr>([\s\S]*?)<\/tr><\/thead><tbody>([\s\S]*?)<\/tbody><\/table>/g)) {
      const cells = (row) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]);
      const head = cells(t[1]);
      for (const r of t[2].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const c = cells(r[1]);
        const front = `${c[0]} <span class="arrow" aria-hidden="true">→</span> ${head.slice(1).map(plain).join(' / ')}?`;
        const back = c.length > 2 ? c.slice(1).map((v, i) => `<b>${head[i + 1]}</b>: ${v}`).join('<br>') : c[1];
        found.push({ key: plain(c[0]), front, back });
      }
    }
    const withoutLists = sec.html.replace(/<ul>[\s\S]*?<\/ul>/g, '');
    const items = [...sec.html.matchAll(/<li>([\s\S]*?)<\/li>/g), ...withoutLists.matchAll(/<p>([\s\S]*?)<\/p>/g)];
    for (const it of items) {
      const inner = it[1];
      const hidden = [...inner.matchAll(/<span class="cloze">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
      if (!hidden.length) continue;
      if (hidden.some((h) => !plain(h))) { errors.push(`${where}: empty {{}} mark`); continue; }
      const front = inner.replace(/<span class="cloze">[\s\S]*?<\/span>/g, '<span class="blank" role="img" aria-label="blank">_____</span>');
      const back = inner.replace(/<span class="cloze">([\s\S]*?)<\/span>/g, '<mark>$1</mark>');
      found.push({ key: hidden.map(plain).join(' '), front, back });
    }
    for (const f of found) {
      cards.push({ id: `${base}.${slug(f.key)}`, k: 'sheet', m: sec.module, s: sec.anchor, f: f.front, b: f.back });
    }
  }
  return { cards, errors };
}

// All cards, in study order: module by module, the module's own blocks in page order, then its cheat-sheet cards,
// then each of its problems (approach first, then the traps).
// modules: compiled modules plus build-only `callouts` [{ id, kind, titleHtml, bodyHtml, ask, carded, section, order }];
//   quizzes carry `section` and `order`, questions may carry `showOptions`; examples carry `section`, `order`,
//   `setupRows`, `nocard`.
// problems: { id: { id, module, traps } }. sheet: cards from sheetCards().
export function buildCards({ modules, problems, sheet }) {
  const cards = [];
  for (const m of modules) {
    const own = [];
    for (const c of m.callouts || []) {
      if (!c.carded) continue;
      own.push({ order: c.order, card: { id: c.id, k: 'callout', m: m.id, s: c.section, a: c.ask || PROMPTS[c.kind] || '' } });
    }
    for (const qz of m.quizzes) {
      qz.questions.forEach((q, i) => {
        const card = { id: quizCardId(m.id, q.q), k: 'quiz', m: m.id, s: qz.section, q: [qz.id, i] };
        if (q.showOptions) card.o = 1;
        own.push({ order: qz.order + i / 100, card });
      });
    }
    for (const ex of m.examples) {
      if (outEligible(ex)) own.push({ order: ex.order, card: { id: outCardId(m.id, ex), k: 'out', m: m.id, s: ex.section, ex: ex.id } });
    }
    own.sort((a, b) => a.order - b.order);
    cards.push(...own.map((x) => x.card));
    cards.push(...sheet.filter((c) => c.m === m.id));
    for (const pid of m.problems) {
      const p = problems[pid];
      if (!p) continue;
      cards.push({ id: `p${p.id}.approach`, k: 'approach', m: m.id, p: p.id });
      p.traps.forEach((t, i) => cards.push({ id: `p${p.id}.trap${i + 1}`, k: 'trap', m: m.id, p: p.id, t: i }));
    }
  }
  for (const c of cards) c.h = hash30(c.id);
  return cards;
}

// What a card shows, as plain text, plus the SQL on it: for the build's checks.
export function cardText(card, { moduleById, problems, calloutById, exampleById }) {
  const m = moduleById[card.m];
  if (card.k === 'quiz') {
    const q = m.quizzes.find((z) => z.id === card.q[0]).questions[card.q[1]];
    return { front: plain(q.q), back: plain(q.options[q.answer]) + ' ' + plain(q.explain), sql: [] };
  }
  if (card.k === 'callout') {
    const c = calloutById[card.id];
    return { front: plain(c.titleHtml) + ' ' + plain(card.a), back: plain(c.bodyHtml), sql: [], html: [c.bodyHtml] };
  }
  if (card.k === 'sheet') return { front: plain(card.f), back: plain(card.b), sql: [], html: [card.f, card.b] };
  if (card.k === 'out') {
    const ex = exampleById[card.ex];
    const setup = ex.db !== 'empty' ? [m.dbs[ex.db]] : [];
    return { front: plain(ex.sql), back: ex.output.columns.join(' '), sql: [ex.sql, ...setup] };
  }
  const p = problems[card.p];
  if (card.k === 'trap') {
    const t = p.traps[card.t];
    return { front: plain(p.taskHtml) + ' ' + t.sql, back: plain(t.html) + ' ' + p.solution.sql, sql: [t.sql, p.solution.sql] };
  }
  return { front: plain(p.taskHtml), back: p.patterns.join(' ') + ' ' + plain(p.solution.html), sql: [p.solution.sql] };
}

// Where a card links back to, as a hash route.
export function cardLink(card) {
  if (card.k === 'trap' || card.k === 'approach') return `#p${card.p}`;
  if (card.k === 'sheet') return `#cheatsheet.${card.s}`;
  return card.s ? `#${card.m}.${card.s}` : `#${card.m}`;
}
