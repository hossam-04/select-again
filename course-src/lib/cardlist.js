// The flashcard list as the page ships it, and the card hash. Plain script: attaches `CardList` to globalThis.
// The build makes every card (tools/cards.mjs) and checks that expand(compact(cards)) gives them back exactly.
//   A problem card ships as its id alone ("p584.trap1", "p584.approach"): the rest follows from the problem.
//   Other cards drop what their id already says (kind and module) and their hash.
(function (root) {
  'use strict';

  // 30 bits of FNV-1a as 5 base64url characters: the card's name inside a progress code.
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function hash30(id) {
    let h = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(id)) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h >>>= 2;
    let s = '';
    for (let i = 0; i < 5; i++) { s = B64URL[h & 63] + s; h >>>= 6; }
    return s;
  }

  const CALLOUT_KINDS = ['gotcha', 'key', 'dialect', 'work', 'tip', 'interview', 'note'];
  const PROBLEM_ID = /^p(\d+)\.(approach|trap(\d+))$/;
  // What an id says about its card: { k, m } for module cards, { k } for cheat-sheet cards.
  function fromId(id) {
    const [first, second] = id.split('.');
    if (first === 'sheet') return { k: 'sheet' };
    if (second === 'quiz' || second === 'out') return { k: second, m: first };
    if (CALLOUT_KINDS.includes(second)) return { k: 'callout', m: first };
    return {};
  }

  function compact(cards) {
    return cards.map((c) => {
      if (c.k === 'trap' || c.k === 'approach') return c.id;
      const out = {};
      const implied = fromId(c.id);
      for (const [k, v] of Object.entries(c)) if (k !== 'h' && implied[k] !== v) out[k] = v;
      return out;
    });
  }

  // problems: { id: { module } }
  function expand(list, problems) {
    return list.map((entry) => {
      if (typeof entry === 'string') {
        const m = PROBLEM_ID.exec(entry);
        const p = Number(m[1]);
        const card = { id: entry, k: m[3] ? 'trap' : 'approach', m: problems[p].module, p };
        if (m[3]) card.t = Number(m[3]) - 1;
        card.h = hash30(entry);
        return card;
      }
      const card = Object.assign({}, entry, fromId(entry.id), entry);
      card.h = hash30(card.id);
      return card;
    });
  }

  root.CardList = { hash30, compact, expand };
})(typeof globalThis !== 'undefined' ? globalThis : window);
