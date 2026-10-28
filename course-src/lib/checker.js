// Compares a query result with the expected result, LeetCode-style.
// Plain script: attaches `ResultCheck` to globalThis.
(function (root) {
  'use strict';

  const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;
  function canon(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && NUMERIC.test(v)) return Number(v);
    return String(v);
  }
  function same(a, b) {
    a = canon(a);
    b = canon(b);
    if (a === null || b === null) return a === b;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
    return String(a) === String(b);
  }
  function key(row) {
    return JSON.stringify(row.map((v) => {
      const c = canon(v);
      return typeof c === 'number' ? 'n:' + String(Math.round(c * 1e6) / 1e6) : c === null ? null : 's:' + c;
    }));
  }
  const rowsEqual = (a, b) => a.length === b.length && a.every((v, i) => same(v, b[i]));

  function compare(expected, actual, opts) {
    const ordered = !!(opts && opts.ordered);
    const out = { ok: false, reason: null, message: '', missing: [], extra: [], notes: [] };
    if (!actual || !actual.columns || !actual.columns.length) {
      out.reason = 'noresult';
      out.message = "Your SQL didn't return a result table. End with a SELECT.";
      return out;
    }
    const ec = expected.columns, ac = actual.columns;
    const lower = (c) => String(c).toLowerCase();
    if (ec.length !== ac.length || ec.some((c, i) => lower(c) !== lower(ac[i]))) {
      out.reason = 'columns';
      out.message = ec.length !== ac.length
        ? `Expected ${ec.length} column${ec.length === 1 ? '' : 's'} (${ec.join(', ')}), got ${ac.length} (${ac.join(', ')}).`
        : `Column names or order differ: expected (${ec.join(', ')}), got (${ac.join(', ')}).`;
      return out;
    }
    if (ec.some((c, i) => c !== ac[i])) out.notes.push(`Column names match except for letter case (${ac.join(', ')} vs ${ec.join(', ')}). Use the exact names to be safe on LeetCode.`);

    // multiset comparison
    const counts = new Map();
    for (const r of expected.rows) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
    const extra = [];
    for (const r of actual.rows) {
      const k = key(r);
      if (counts.get(k)) counts.set(k, counts.get(k) - 1);
      else extra.push(r);
    }
    const missing = [];
    const left = new Map(counts);
    for (const r of expected.rows) {
      const k = key(r);
      if (left.get(k) > 0) { missing.push(r); left.set(k, left.get(k) - 1); }
    }
    if (missing.length || extra.length) {
      out.reason = 'rows';
      out.missing = missing.slice(0, 50);
      out.extra = extra.slice(0, 50);
      const parts = [];
      if (expected.rows.length !== actual.rows.length) parts.push(`Expected ${expected.rows.length} row${expected.rows.length === 1 ? '' : 's'}, got ${actual.rows.length}.`);
      if (missing.length) parts.push(`${missing.length} expected row${missing.length === 1 ? ' is' : 's are'} missing.`);
      if (extra.length) parts.push(`${extra.length} row${extra.length === 1 ? ' is' : 's are'} unexpected.`);
      out.message = parts.join(' ');
      return out;
    }
    if (ordered && !expected.rows.every((r, i) => rowsEqual(r, actual.rows[i]))) {
      out.reason = 'order';
      out.message = 'All the right rows, but in the wrong order. This problem asks for a specific ORDER BY.';
      return out;
    }
    out.ok = true;
    out.message = 'Accepted';
    return out;
  }

  root.ResultCheck = { compare, same, canon };
})(typeof globalThis !== 'undefined' ? globalThis : window);
