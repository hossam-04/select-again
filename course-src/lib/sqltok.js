// SQL tokenizer (MySQL lexical rules) + tiny token helpers + HTML highlighter.
// Plain script: attaches `SQLTok` to globalThis so the same file runs in Node and in the page.
(function (root) {
  'use strict';

  const OPS = ['<=>', '->>', '<=', '>=', '<>', '!=', '||', '&&', ':=', '::', '->', '<<', '>>'];

  // Every token keeps its exact source text, so joining token texts reproduces the input.
  // types: ws, comment, str ('..'), dstr (".."), bq (`..`), num, word, var (@x), op
  // opts.sqlite: SQLite lexical rules (no backslash escapes in strings, no # comments).
  function tokenize(src, opts) {
    const sqlite = !!(opts && opts.sqlite);
    const toks = [];
    let i = 0;
    const n = src.length;
    const push = (type, start, end, extra) => {
      const t = { type, text: src.slice(start, end), start, end };
      if (type === 'word') t.upper = t.text.toUpperCase();
      if (extra) Object.assign(t, extra);
      toks.push(t);
    };
    while (i < n) {
      const c = src[i];
      const start = i;
      if (/\s/.test(c)) {
        while (i < n && /\s/.test(src[i])) i++;
        push('ws', start, i);
      } else if (c === '-' && src[i + 1] === '-') {
        while (i < n && src[i] !== '\n') i++;
        push('comment', start, i, { line: true });
      } else if (c === '#' && !sqlite) {
        while (i < n && src[i] !== '\n') i++;
        push('comment', start, i, { line: true, hash: true });
      } else if (c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        i = close === -1 ? n : close + 2;
        push('comment', start, i, { unterminated: close === -1 });
      } else if (c === "'" || c === '"' || c === '`') {
        i++;
        let closed = false;
        while (i < n) {
          const ch = src[i];
          if (ch === '\\' && c !== '`' && !sqlite) { i += 2; continue; }
          if (ch === c) {
            if (src[i + 1] === c) { i += 2; continue; }
            i++;
            closed = true;
            break;
          }
          i++;
        }
        if (i > n) i = n;
        push(c === "'" ? 'str' : c === '"' ? 'dstr' : 'bq', start, i, closed ? null : { unterminated: true });
      } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X') && /[0-9a-fA-F]/.test(src[i + 2] || '')) {
          i += 2;
          while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        } else {
          while (i < n && /[0-9]/.test(src[i])) i++;
          if (src[i] === '.') { i++; while (i < n && /[0-9]/.test(src[i])) i++; }
          if ((src[i] === 'e' || src[i] === 'E') && /[0-9+-]/.test(src[i + 1] || '')) {
            const save = i;
            i++;
            if (src[i] === '+' || src[i] === '-') i++;
            if (/[0-9]/.test(src[i] || '')) { while (i < n && /[0-9]/.test(src[i])) i++; } else i = save;
          }
        }
        // identifiers may start with digits in MySQL (e.g. 1st_col) — treat as a word
        if (i < n && /[A-Za-z_$]/.test(src[i])) {
          while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
          push('word', start, i);
        } else push('num', start, i);
      } else if (/[A-Za-z_\u0080-\uffff]/.test(c)) {
        while (i < n && /[A-Za-z0-9_$\u0080-\uffff]/.test(src[i])) i++;
        push('word', start, i);
      } else if (c === '@') {
        i++;
        if (src[i] === '@') i++;
        while (i < n && /[A-Za-z0-9_$.]/.test(src[i])) i++;
        push('var', start, i);
      } else {
        const op = OPS.find((o) => src.startsWith(o, i));
        i += op ? op.length : 1;
        push('op', start, i);
      }
    }
    return toks;
  }

  const isSig = (t) => t && t.type !== 'ws' && t.type !== 'comment';
  const isWord = (t, ...words) => !!t && t.type === 'word' && (words.length === 0 || words.includes(t.upper));
  const isOp = (t, ...ops) => !!t && t.type === 'op' && (ops.length === 0 || ops.includes(t.text));

  function nextSig(toks, i) {
    for (let k = i + 1; k < toks.length; k++) if (isSig(toks[k])) return k;
    return -1;
  }
  function prevSig(toks, i) {
    for (let k = i - 1; k >= 0; k--) if (isSig(toks[k])) return k;
    return -1;
  }
  function matchParen(toks, i) {
    let depth = 0;
    for (let k = i; k < toks.length; k++) {
      if (isOp(toks[k], '(')) depth++;
      else if (isOp(toks[k], ')')) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }
  function matchParenBack(toks, j) {
    let depth = 0;
    for (let k = j; k >= 0; k--) {
      if (isOp(toks[k], ')')) depth++;
      else if (isOp(toks[k], '(')) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }
  // Indices of significant tokens in [from, to) at paren depth 0 relative to `from`.
  function topLevel(toks, from, to) {
    const out = [];
    let depth = 0;
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (!isSig(t)) continue;
      if (isOp(t, '(')) { if (depth === 0) out.push(k); depth++; continue; }
      if (isOp(t, ')')) { depth--; continue; }
      if (depth === 0) out.push(k);
    }
    return out;
  }
  // Split [from, to) on top-level commas -> array of [start, end) ranges.
  function splitCommas(toks, from, to) {
    const ranges = [];
    let depth = 0;
    let s = from;
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (depth === 0 && isOp(t, ',')) { ranges.push([s, k]); s = k + 1; }
    }
    ranges.push([s, to]);
    return ranges;
  }
  const text = (toks, from, to) => toks.slice(from, to).map((t) => t.text).join('');

  // ---------- highlighting (static code blocks) ----------
  const KEYWORDS = new Set(`ADD ALL ALTER AND ANY AS ASC AUTO_INCREMENT BEGIN BETWEEN BINARY BY CASCADE CASE CHECK COLLATE
    COLUMN COMMIT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DECLARE DEFAULT
    DELETE DESC DESCRIBE DISTINCT DIV DROP DUAL DUPLICATE ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FIRST FOLLOWING
    FOR FOREIGN FROM FULL FUNCTION GROUP GROUPS HAVING IF IGNORE IN INDEX INNER INSERT INTERSECT INTERVAL INTO IS JOIN KEY LAST
    LATERAL LEFT LIKE LIMIT LOCK MOD NATURAL NOT NULL NULLS OF OFFSET ON OR ORDER OUTER OVER PARTITION PRECEDING PRIMARY
    RANGE RECURSIVE REFERENCES REGEXP RLIKE RENAME REPLACE RETURN RETURNS RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SEPARATOR
    SET SHOW START TABLE TABLES TEMPORARY THEN TO TRANSACTION TRIGGER TRUE TRUNCATE UNBOUNDED UNION UNIQUE UNSIGNED UPDATE
    USE USING VALUES VIEW WHEN WHERE WINDOW WITH XOR ISOLATION LEVEL READ COMMITTED UNCOMMITTED REPEATABLE SERIALIZABLE
    SHARE WORK CONFLICT DO NOTHING EXCLUDED ANALYZE ENGINE`.split(/\s+/));
  const TYPES = new Set(`INT INTEGER TINYINT SMALLINT MEDIUMINT BIGINT DECIMAL NUMERIC FLOAT DOUBLE REAL BIT BOOL BOOLEAN
    CHAR VARCHAR TEXT TINYTEXT MEDIUMTEXT LONGTEXT BLOB DATE DATETIME TIMESTAMP TIME YEAR ENUM JSON SIGNED`.split(/\s+/));

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlight(src) {
    const toks = tokenize(src);
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      let cls = '';
      if (t.type === 'comment') cls = 'c';
      else if (t.type === 'str' || t.type === 'dstr') cls = 's';
      else if (t.type === 'num') cls = 'n';
      else if (t.type === 'bq' || t.type === 'var') cls = 'v';
      else if (t.type === 'word') {
        const nx = toks[nextSig(toks, k)];
        if (nx && isOp(nx, '(') && !KEYWORDS.has(t.upper)) cls = 'f';
        else if (KEYWORDS.has(t.upper)) cls = 'k';
        else if (TYPES.has(t.upper)) cls = 't';
      } else if (t.type === 'op') cls = 'o';
      out += cls ? `<span class="t-${cls}">${esc(t.text)}</span>` : esc(t.text);
    }
    return out;
  }

  root.SQLTok = {
    tokenize, isSig, isWord, isOp, nextSig, prevSig, matchParen, matchParenBack, topLevel, splitCommas, text,
    highlight, KEYWORDS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
