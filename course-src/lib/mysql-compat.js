// MySQL -> SQLite rewriting, lint warnings and friendly error messages.
// Plain script: attaches `SQLCompat` to globalThis. Needs SQLTok and MySQLFunctions loaded first.
(function (root) {
  'use strict';
  const T = root.SQLTok;
  const F = root.MySQLFunctions;
  const { isSig, isWord, isOp, nextSig, prevSig, matchParen, matchParenBack, splitCommas } = T;
  const text = T.text;

  class CompatError extends Error {
    constructor(message, hint) {
      super(message);
      this.hint = hint || '';
      this.compat = true;
    }
  }

  const tokM = (s) => T.tokenize(s);
  const tokS = (s) => T.tokenize(s, { sqlite: true });
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const UNITS = new Set(F.UNITS);
  const NOT_FUNC = new Set(`IN EXISTS AND OR NOT ON USING VALUES AS THEN ELSE WHEN CASE SELECT FROM WHERE JOIN BY HAVING
    UNION ALL ANY SOME INTERVAL OVER RETURN WITH RECURSIVE LIMIT OFFSET IS LIKE BETWEEN DISTINCT INTO TABLE SET KEY INDEX
    UNIQUE CHECK DEFAULT REFERENCES WINDOW PARTITION ROWS RANGE FILTER ESCAPE REGEXP GLOB MATCH DIV MOD XOR EXCEPT
    INTERSECT LATERAL`.split(/\s+/));
  const RESERVED = new Set(`SELECT FROM WHERE AND OR NOT NULL TRUE FALSE CASE WHEN THEN ELSE END AS ON IN IS LIKE BETWEEN
    DISTINCT JOIN GROUP ORDER BY HAVING LIMIT UNION ALL EXISTS INTERVAL DIV MOD XOR REGEXP RLIKE BINARY ESCAPE COLLATE
    SEPARATOR DESC ASC INTO FOR WITH OVER PARTITION ROWS RANGE INNER LEFT RIGHT CROSS OUTER NATURAL USING`.split(/\s+/));
  const OPERATOR_WORDS = new Set([...RESERVED, 'DATE', 'TIME', 'TIMESTAMP']);
  const LIST_END = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'INTO', 'FOR', 'LOCK']);
  const SELECT_MODS = new Set(['DISTINCT', 'ALL', 'DISTINCTROW', 'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_SMALL_RESULT',
    'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT', 'SQL_NO_CACHE', 'SQL_CACHE', 'SQL_CALC_FOUND_ROWS']);
  const TEXT_TYPES = new Set(['CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'NCHAR', 'NVARCHAR', 'ENUM', 'SET']);

  // ======================================================================
  // 1. literals: MySQL lexical form -> SQLite lexical form
  // ======================================================================
  function unescapeMySQL(body, quote) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\\' && i + 1 < body.length) {
        const n = body[++i];
        out += { 0: '', "'": "'", '"': '"', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', '\\': '\\', '%': '\\%', _: '\\_' }[n] ?? n;
      } else if (c === quote && body[i + 1] === quote) {
        out += quote;
        i++;
      } else out += c;
    }
    return out;
  }

  function normalizeLiterals(src) {
    const toks = tokM(src);
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'str' || t.type === 'dstr') {
        const body = t.unterminated ? t.text.slice(1) : t.text.slice(1, -1);
        let value = unescapeMySQL(body, t.text[0]);
        const p = prevSig(toks, k);
        const pp = p >= 0 ? prevSig(toks, p) : -1;
        if (isWord(toks[p], 'BINARY') && isWord(toks[pp], 'REGEXP', 'RLIKE')) value = F.CS + value;
        out += q(value);
        if (value.includes('\\') && isWord(toks[p], 'LIKE') && !isWord(toks[nextSig(toks, k)], 'ESCAPE')) out += " ESCAPE '\\'";
        continue;
      }
      if (t.type === 'comment' && t.hash) { out += '--' + t.text.slice(1); continue; }
      if (isWord(t, 'BINARY')) {
        const p = prevSig(toks, k), nx = nextSig(toks, k);
        if (isWord(toks[p], 'REGEXP', 'RLIKE') && nx >= 0 && (toks[nx].type === 'str' || toks[nx].type === 'dstr')) continue;
      }
      out += t.text;
    }
    return out;
  }

  // ======================================================================
  // 2. expression-level rewrites (SQLite lexical form in, SQLite out)
  // ======================================================================
  function qualifiedStart(toks, j) {
    for (;;) {
      const p = prevSig(toks, j);
      if (p >= 0 && isOp(toks[p], '.')) {
        const pp = prevSig(toks, p);
        if (pp >= 0 && (toks[pp].type === 'word' || toks[pp].type === 'bq' || toks[pp].type === 'dstr')) { j = pp; continue; }
      }
      return j;
    }
  }
  function primaryBackward(toks, j) {
    const t = toks[j];
    if (isOp(t, ')')) {
      const k = matchParenBack(toks, j);
      const p = prevSig(toks, k);
      if (p >= 0 && (toks[p].type === 'word' || toks[p].type === 'bq') && !NOT_FUNC.has(toks[p].upper)) return qualifiedStart(toks, p);
      return k;
    }
    if (isWord(t, 'END')) {
      let depth = 0;
      for (let k = j; k >= 0; k--) {
        if (isWord(toks[k], 'END')) depth++;
        else if (isWord(toks[k], 'CASE') && --depth === 0) return k;
      }
    }
    if (t.type === 'word' || t.type === 'bq' || t.type === 'dstr') return qualifiedStart(toks, j);
    return j;
  }
  function primaryForward(toks, i) {
    const t = toks[i];
    if (!t) return i;
    if (isOp(t, '-') || isOp(t, '+')) return primaryForward(toks, nextSig(toks, i));
    if (isOp(t, '(')) return matchParen(toks, i);
    if (isWord(t, 'CASE')) {
      let depth = 0;
      for (let k = i; k < toks.length; k++) {
        if (isWord(toks[k], 'CASE')) depth++;
        else if (isWord(toks[k], 'END') && --depth === 0) return k;
      }
      return toks.length - 1;
    }
    if (t.type === 'word' || t.type === 'bq' || t.type === 'dstr') {
      let j = i;
      for (;;) {
        const d = nextSig(toks, j);
        if (d >= 0 && isOp(toks[d], '.')) {
          const n2 = nextSig(toks, d);
          if (n2 >= 0 && (toks[n2].type === 'word' || toks[n2].type === 'bq' || isOp(toks[n2], '*'))) { j = n2; continue; }
        }
        break;
      }
      const nx = nextSig(toks, j);
      if (nx >= 0 && isOp(toks[nx], '(') && !NOT_FUNC.has(t.upper)) return matchParen(toks, nx);
      return j;
    }
    return i;
  }

  function findTopWord(toks, from, to, word) {
    let depth = 0;
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (depth === 0 && isWord(t, word)) return k;
    }
    return -1;
  }
  function lastTopWord(toks, from, to, word) {
    let depth = 0, found = -1;
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (depth === 0 && isWord(t, word)) found = k;
    }
    return found;
  }
  const trimText = (toks, a, b) => text(toks, a, b).trim();

  function castType(typeText) {
    const tt = typeText.replace(/\s+/g, ' ').trim().toUpperCase();
    const m = /^([A-Z]+)(?: ([A-Z]+))?\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?/.exec(tt);
    if (!m) throw new CompatError(`Unknown type in CAST: ${typeText}`);
    const [, name, second, , scale] = m;
    switch (name) {
      case 'SIGNED': case 'UNSIGNED': case 'INTEGER': case 'INT': case 'BIGINT': case 'YEAR': return (e) => `CAST(mysql_cast_int(${e}) AS INTEGER)`;
      case 'DECIMAL': case 'NUMERIC': case 'DEC': case 'FIXED': return (e) => `mysql_cast_decimal(${e}, ${scale || 0})`;
      case 'CHAR': case 'VARCHAR': case 'NCHAR': case 'TEXT': return (e) => `concat(${e})`;
      case 'DATE': return (e) => `mysql_cast_date(${e})`;
      case 'DATETIME': case 'TIMESTAMP': return (e) => `mysql_cast_datetime(${e})`;
      case 'TIME': return (e) => `mysql_cast_time(${e})`;
      case 'DOUBLE': case 'FLOAT': case 'REAL': return (e) => `CAST(${e} AS REAL)`;
      case 'BINARY': case 'JSON': return (e) => `(${e})`;
      default:
        if (second) return castType(second);
        throw new CompatError(`Unsupported type in CAST: ${typeText}`);
    }
  }

  // Window specs whose frame uses RANGE ... INTERVAL: order by julianday() and use day counts.
  function rewriteRangeInterval(toks, open, close, notes) {
    const orderIdx = findTopWord(toks, open + 1, close, 'ORDER');
    const rangeIdx = findTopWord(toks, open + 1, close, 'RANGE');
    const byIdx = orderIdx >= 0 ? nextSig(toks, orderIdx) : -1;
    if (orderIdx < 0 || rangeIdx < 0 || !isWord(toks[byIdx], 'BY')) return null;
    let exprEnd = rangeIdx;
    let dir = '';
    const lastBefore = prevSig(toks, rangeIdx);
    if (isWord(toks[lastBefore], 'ASC', 'DESC')) { dir = ' ' + toks[lastBefore].upper; exprEnd = lastBefore; }
    const orderExpr = trimText(toks, byIdx + 1, exprEnd);
    let frame = '';
    for (let k = rangeIdx; k < close; k++) {
      if (isWord(toks[k], 'INTERVAL')) {
        let u = nextSig(toks, k);
        while (u >= 0 && u < close && !(toks[u].type === 'word' && UNITS.has(toks[u].upper))) u = nextSig(toks, u);
        if (u < 0 || u >= close) throw new CompatError('INTERVAL needs a unit, e.g. INTERVAL 6 DAY');
        const amount = trimText(toks, k + 1, u);
        const unit = toks[u].upper;
        const days = { DAY: `(${amount})`, WEEK: `(${amount}) * 7`, HOUR: `(${amount}) / 24.0`, MINUTE: `(${amount}) / 1440.0`, SECOND: `(${amount}) / 86400.0` }[unit];
        if (!days) throw new CompatError(`RANGE frames with ${unit} intervals aren't supported here`, 'Use DAY/WEEK/HOUR units, or a self-join on a date range.');
        frame += days;
        k = u;
        continue;
      }
      frame += toks[k].text;
    }
    notes.push('RANGE … INTERVAL frame emulated by ordering on julianday()');
    return text(toks, open + 1, orderIdx) + `ORDER BY julianday(${orderExpr})${dir} ` + frame;
  }

  function rewriteXor(src) {
    for (let guard = 0; guard < 50; guard++) {
      const toks = tokS(src);
      const i = toks.findIndex((t) => isOp(t, '^'));
      if (i < 0) return src;
      const lp = prevSig(toks, i), rn = nextSig(toks, i);
      if (lp < 0 || rn < 0) throw new CompatError('`^` needs a value on both sides.');
      const l = primaryBackward(toks, lp), r = primaryForward(toks, rn);
      src = text(toks, 0, l) + `mysql_bxor(${text(toks, l, lp + 1)}, ${text(toks, rn, r + 1)})` + text(toks, r + 1, toks.length);
    }
    return src;
  }


  // Start of the left operand of a comparison operator at opIdx (comparisons bind looser than arithmetic).
  const CMP_BOUNDARY = new Set(['AND', 'OR', 'NOT', 'XOR', 'WHERE', 'HAVING', 'ON', 'WHEN', 'THEN', 'ELSE', 'SELECT', 'CASE',
    'SET', 'RETURN', 'BETWEEN', 'IN', 'IS', 'LIKE']);
  function comparisonLeftStart(toks, opIdx) {
    let start = opIdx;
    for (let j = opIdx - 1; j >= 0; j--) {
      const t = toks[j];
      if (!isSig(t)) continue;
      if (isOp(t, ')')) { j = matchParenBack(toks, j); start = j; continue; }
      if (isOp(t, '(') || isOp(t, ',') || isOp(t, ';')) break;
      if (t.type === 'word' && CMP_BOUNDARY.has(t.upper)) break;
      if (isOp(t, '=', '<>', '!=', '<', '<=', '>', '>=')) break;
      start = j;
    }
    return start;
  }

  // Arithmetic operators, and whether the token at j can end an operand (so a following +/- is binary).
  const isArith = (t) => !!t && ((t.type === 'op' && ['+', '-', '*', '/', '%'].includes(t.text)) || isWord(t, 'DIV', 'MOD'));
  function operandEndsAt(toks, j) {
    const t = toks[j];
    if (!t) return false;
    if (isOp(t, ')') || t.type === 'num' || t.type === 'str' || t.type === 'bq' || t.type === 'dstr') return true;
    return t.type === 'word' && (!RESERVED.has(t.upper) || ['END', 'NULL', 'TRUE', 'FALSE'].includes(t.upper));
  }

  // Temporal operands: a DATE/DATETIME/TIME column, or a function that returns one. In MySQL
  // arithmetic turns them into numbers (DATE '2024-01-31' + 1 = 20240132), not the next day.
  const DATE_FUNCS = new Set(['DATE', 'CURDATE', 'CURRENT_DATE', 'NOW', 'CURRENT_TIMESTAMP', 'SYSDATE', 'LOCALTIME',
    'LOCALTIMESTAMP', 'UTC_DATE', 'UTC_TIMESTAMP', 'DATE_ADD', 'DATE_SUB', 'ADDDATE', 'SUBDATE', 'LAST_DAY', 'STR_TO_DATE',
    'MAKEDATE', 'FROM_DAYS', 'TIMESTAMP', 'FROM_UNIXTIME', 'CURTIME', 'CURRENT_TIME', 'UTC_TIME', 'TIME', 'SEC_TO_TIME',
    'MAKETIME', 'TIMESTAMPADD']);
  const DATE_WORDS = new Set(['CURRENT_DATE', 'CURRENT_TIMESTAMP', 'CURRENT_TIME', 'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_DATE',
    'UTC_TIME', 'UTC_TIMESTAMP']);
  function isDateOperand(toks, s, e, ctx) {
    if (s < 0 || e < s || !toks[s] || !toks[e]) return false;
    const last = toks[e];
    if (isOp(last, ')')) {
      const open = matchParenBack(toks, e);
      const fn = prevSig(toks, open);
      if (fn !== s || toks[fn].type !== 'word') return false;
      const U = toks[fn].upper;
      if (DATE_FUNCS.has(U)) return true;
      if (U === 'CAST') return isWord(toks[prevSig(toks, e)], 'DATE', 'DATETIME', 'TIME', 'TIMESTAMP');
      if (U === 'MIN' || U === 'MAX' || U === 'ANY_VALUE') {
        let a = nextSig(toks, open);
        if (isWord(toks[a], 'DISTINCT')) a = nextSig(toks, a);
        const b = prevSig(toks, e);
        return a >= 0 && a <= b && primaryForward(toks, a) === b && isDateOperand(toks, a, b, ctx);
      }
      return false;
    }
    if (last.type !== 'word' && last.type !== 'bq' && last.type !== 'dstr') return false;
    for (let j = s; j < e; j++) {
      const t = toks[j];
      if (isSig(t) && !isOp(t, '.') && t.type !== 'word' && t.type !== 'bq' && t.type !== 'dstr') return false;
    }
    if (s === e && last.type === 'word' && DATE_WORDS.has(last.upper)) return true;
    if (last.type === 'word' && RESERVED.has(last.upper)) return false;
    return !!(ctx.dateCols && ctx.dateCols.has(last.text.replace(/^[`"]|[`"]$/g, '').toLowerCase()));
  }

  // MySQL functions that return integers. sql.js hands every function result back as a REAL, which
  // shows up in text (GROUP_CONCAT → "30.0", CAST AS CHAR, LIKE) and breaks DIV, so calls are cast back.
  const INT_FUNCS = new Set(['DATEDIFF', 'YEAR', 'MONTH', 'DAY', 'DAYOFMONTH', 'DAYOFWEEK', 'WEEKDAY', 'DAYOFYEAR', 'WEEK',
    'WEEKOFYEAR', 'YEARWEEK', 'QUARTER', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'TO_DAYS', 'TIME_TO_SEC', 'LOCATE', 'INSTR',
    'CHAR_LENGTH', 'CHARACTER_LENGTH', 'LENGTH', 'ASCII', 'FIELD', 'FIND_IN_SET', 'STRCMP', 'CEIL', 'CEILING', 'FLOOR',
    'REGEXP_LIKE', 'REGEXP_INSTR']);
  const asInt = (e) => `CAST(${e} AS INTEGER)`;

  function rx(src, ctx) {
    src = rewriteXor(src);
    const toks = tokS(src);
    const out = [];
    const emit = (k, s) => out.push({ k, s });
    const closers = new Map();
    let k = 0;
    while (k < toks.length) {
      const t = toks[k];
      const nx = nextSig(toks, k);
      const nt = nx >= 0 ? toks[nx] : null;

      if (closers.has(k)) { emit(k, closers.get(k)); k++; continue; }

      if (t.type === 'var') {
        throw new CompatError(`User variables like ${t.text} aren't supported in this page's engine.`,
          'For ranking or running totals use window functions (ROW_NUMBER, SUM() OVER); inside the #177 function exercise, use DECLARE/SET.');
      }

      // date/time operands of arithmetic become numbers (INTERVAL arithmetic is handled below)
      if (isArith(t) && !isWord(nt, 'INTERVAL') && operandEndsAt(toks, prevSig(toks, k))) {
        const p = prevSig(toks, k);
        const ls = primaryBackward(toks, p);
        if (isDateOperand(toks, ls, p, ctx)) {
          const popped = [];
          while (out.length && out[out.length - 1].k >= ls) popped.unshift(out.pop());
          emit(ls, asInt(`mysql_datenum(${popped.map((c) => c.s).join('').trim()})`));
        }
        const re = nx >= 0 ? primaryForward(toks, nx) : -1;
        if (nx >= 0 && isDateOperand(toks, nx, re, ctx)) {
          const opText = { '/': ' * 1.0 /', DIV: ' / ', MOD: ' % ' }[t.type === 'word' ? t.upper : t.text] || t.text;
          emit(k, opText);
          emit(nx, asInt(`mysql_datenum(${rx(text(toks, nx, re + 1), ctx).trim()})`));
          k = re + 1;
          continue;
        }
      }

      if (isOp(t, '(')) {
        const close = matchParen(toks, k);
        if (close < 0) { emit(k, t.text); k++; continue; }
        const first = nextSig(toks, k);
        const p = prevSig(toks, k);
        const after = nextSig(toks, close);
        const setOp = (i) => i >= 0 && isWord(toks[i], 'UNION', 'INTERSECT', 'EXCEPT');
        const setOpBefore = setOp(p) || (isWord(toks[p], 'ALL', 'DISTINCT') && setOp(prevSig(toks, p)));
        // (SELECT ...) UNION (SELECT ...)  ->  SELECT * FROM (SELECT ...) UNION ...
        const atElementStart = p < 0 || isOp(toks[p], ';') || isOp(toks[p], '(');
        if (isWord(toks[first], 'SELECT', 'WITH') && (setOpBefore || (setOp(after) && atElementStart) ||
            ((p < 0 || isOp(toks[p], ';')) && (after < 0 || isOp(toks[after], ';') || isWord(toks[after], 'ORDER', 'LIMIT'))))) {
          emit(k, `SELECT * FROM (${rx(text(toks, k + 1, close), ctx)})`);
          k = close + 1;
          continue;
        }
        // window spec with RANGE ... INTERVAL
        if (findTopWord(toks, k + 1, close, 'RANGE') >= 0 && findTopWord(toks, k + 1, close, 'INTERVAL') >= 0) {
          const inner = rewriteRangeInterval(toks, k, close, ctx.notes);
          if (inner !== null) { emit(k, '(' + rx(inner, ctx) + ')'); k = close + 1; continue; }
        }
        emit(k, t.text);
        k++;
        continue;
      }

      if (t.type === 'word') {
        const U = t.upper;
        const isCall = nt && isOp(nt, '(');
        const close = isCall ? matchParen(toks, nx) : -1;

        if (isCall && close > 0) {
          const a = nx + 1, b = close;
          if (U === 'CAST' || U === 'CONVERT') {
            let asIdx = U === 'CAST' ? lastTopWord(toks, a, b, 'AS') : -1;
            const usingIdx = U === 'CONVERT' ? findTopWord(toks, a, b, 'USING') : -1;
            if (usingIdx >= 0) { emit(k, `(${rx(text(toks, a, usingIdx), ctx)})`); k = close + 1; continue; }
            let exprText, typeText;
            if (U === 'CAST') {
              if (asIdx < 0) throw new CompatError('CAST needs AS <type>, e.g. CAST(x AS SIGNED)');
              exprText = text(toks, a, asIdx); typeText = text(toks, asIdx + 1, b);
            } else {
              const parts = splitCommas(toks, a, b);
              if (parts.length !== 2) throw new CompatError('CONVERT needs two arguments, e.g. CONVERT(x, SIGNED)');
              exprText = text(toks, parts[0][0], parts[0][1]); typeText = text(toks, parts[1][0], parts[1][1]);
            }
            emit(k, castType(typeText)(rx(exprText, ctx).trim()));
            k = close + 1;
            continue;
          }
          if (U === 'GROUP_CONCAT') {
            let start = a;
            const f = nextSig(toks, a - 1);
            const distinct = isWord(toks[f], 'DISTINCT');
            if (distinct) start = f + 1;
            const oIdx = findTopWord(toks, start, b, 'ORDER');
            const sIdx = findTopWord(toks, start, b, 'SEPARATOR');
            const exprEnd = Math.min(...[oIdx, sIdx, b].filter((x) => x >= 0));
            const exprs = splitCommas(toks, start, exprEnd).map(([x, y]) => rx(text(toks, x, y), ctx).trim());
            const value = exprs.length > 1 ? `concat(${exprs.join(', ')})` : exprs[0];
            const order = oIdx >= 0 ? ' ' + rx(text(toks, oIdx, sIdx > oIdx ? sIdx : b), ctx).trim() : '';
            let sep = "','";
            if (sIdx >= 0) {
              const st = nextSig(toks, sIdx);
              if (!toks[st] || toks[st].type !== 'str') throw new CompatError("SEPARATOR must be followed by a string, e.g. SEPARATOR ','");
              sep = toks[st].text;
            }
            if (distinct) emit(k, sep === "','" ? `group_concat(DISTINCT ${value}${order})` : `mysql_gc_distinct(${value}, ${sep}${order})`);
            else emit(k, `group_concat(${value}, ${sep}${order})`);
            k = close + 1;
            continue;
          }
          if (U === 'COUNT') {
            const f = nextSig(toks, nx);
            if (isWord(toks[f], 'DISTINCT')) {
              const parts = splitCommas(toks, f + 1, b);
              if (parts.length > 1) {
                const exprs = parts.map(([x, y]) => rx(text(toks, x, y), ctx).trim());
                const nulls = exprs.map((e) => `(${e}) IS NULL`).join(' OR ');
                emit(k, `COUNT(DISTINCT CASE WHEN ${nulls} THEN NULL ELSE lower(concat_ws(char(31), ${exprs.join(', ')})) END)`);
                k = close + 1;
                continue;
              }
            }
          }
          if (U === 'EXTRACT') {
            const unitIdx = nextSig(toks, nx);
            const fromIdx = findTopWord(toks, a, b, 'FROM');
            if (fromIdx < 0 || !toks[unitIdx] || toks[unitIdx].type !== 'word') throw new CompatError('EXTRACT needs the form EXTRACT(unit FROM date)');
            emit(k, asInt(`mysql_extract('${toks[unitIdx].upper}', ${rx(text(toks, fromIdx + 1, b), ctx).trim()})`));
            k = close + 1;
            continue;
          }
          if (U === 'TIMESTAMPDIFF' || U === 'TIMESTAMPADD') {
            const unitIdx = nextSig(toks, nx);
            if (toks[unitIdx] && toks[unitIdx].type === 'word') {
              const rest = rx(text(toks, unitIdx + 1, b), ctx);
              const call = `${U.toLowerCase()}('${toks[unitIdx].upper.replace(/^SQL_TSI_/, '')}'${rest})`;
              emit(k, U === 'TIMESTAMPDIFF' ? asInt(call) : call);
              k = close + 1;
              continue;
            }
          }
          if (U === 'POSITION') {
            const inIdx = findTopWord(toks, a, b, 'IN');
            if (inIdx >= 0) {
              emit(k, asInt(`locate(${rx(text(toks, a, inIdx), ctx).trim()}, ${rx(text(toks, inIdx + 1, b), ctx).trim()})`));
              k = close + 1;
              continue;
            }
          }
          if (U === 'TRIM') {
            const fromIdx = findTopWord(toks, a, b, 'FROM');
            if (fromIdx >= 0) {
              let s = nextSig(toks, nx);
              let mode = 'BOTH';
              if (isWord(toks[s], 'LEADING', 'TRAILING', 'BOTH')) { mode = toks[s].upper; s = nextSig(toks, s); }
              const rem = s < fromIdx ? rx(text(toks, s, fromIdx), ctx).trim() : 'NULL';
              emit(k, `mysql_trim('${mode}', ${rem}, ${rx(text(toks, fromIdx + 1, b), ctx).trim()})`);
              k = close + 1;
              continue;
            }
          }
          if (U === 'SUBSTRING' || U === 'SUBSTR' || U === 'MID') {
            const fromIdx = findTopWord(toks, a, b, 'FROM');
            if (fromIdx >= 0) {
              const forIdx = findTopWord(toks, fromIdx, b, 'FOR');
              const s = rx(text(toks, a, fromIdx), ctx).trim();
              const pos = rx(text(toks, fromIdx + 1, forIdx >= 0 ? forIdx : b), ctx).trim();
              const len = forIdx >= 0 ? ', ' + rx(text(toks, forIdx + 1, b), ctx).trim() : '';
              emit(k, `substring(${s}, ${pos}${len})`);
              k = close + 1;
              continue;
            }
          }
          if (U === 'ISNULL') { emit(k, 'mysql_isnull'); k++; continue; }
          if (U === 'LAST_INSERT_ID') { emit(k, 'last_insert_rowid'); k++; continue; }
          if (U === 'INSERT' && prevSig(toks, k) >= 0 && !isOp(toks[prevSig(toks, k)], ';')) { emit(k, 'mysql_insert'); k++; continue; }
          if ((U === 'MAX' || U === 'MIN') && splitCommas(toks, a, b).length > 1) {
            emit(k, U === 'MAX' ? 'greatest' : 'least');
            k++;
            continue;
          }
          if (['CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP'].includes(U) && nextSig(toks, nx) === close) {
            emit(k, U);
            k = close + 1;
            continue;
          }
          const pk = prevSig(toks, k);
          const args = splitCommas(toks, a, b);
          const roundsToInt = (U === 'ROUND' && (args.length === 1 || /^\s*0\s*$/.test(text(toks, args[1][0], args[1][1])))) ||
            (U === 'TRUNCATE' && args.length === 2 && /^\s*0\s*$/.test(text(toks, args[1][0], args[1][1])));
          if ((INT_FUNCS.has(U) || roundsToInt) && !(pk >= 0 && isOp(toks[pk], '.'))) {
            emit(k, `CAST(${t.text}`);
            closers.set(close, ') AS INTEGER)');
            k++;
            continue;
          }
        }

        if (['LOCALTIME', 'LOCALTIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP'].includes(U)) {
          const fn = { LOCALTIME: 'mysql_now()', LOCALTIMESTAMP: 'mysql_now()', UTC_DATE: 'utc_date()', UTC_TIME: 'curtime()', UTC_TIMESTAMP: 'utc_timestamp()' }[U];
          emit(k, fn);
          k = isCall && nextSig(toks, nx) === close ? close + 1 : k + 1;
          continue;
        }

        if (U === 'INTERVAL') {
          let u = nextSig(toks, k);
          let depth = 0;
          for (; u >= 0; u = nextSig(toks, u)) {
            const tu = toks[u];
            if (isOp(tu, '(')) depth++;
            else if (isOp(tu, ')')) { if (depth === 0) { u = -1; break; } depth--; }
            else if (depth === 0 && tu.type === 'word' && UNITS.has(tu.upper) && !isOp(toks[prevSig(toks, u)], '.')) break;
          }
          if (u < 0 || u === nextSig(toks, k)) throw new CompatError('INTERVAL needs an amount and a unit, e.g. INTERVAL 1 DAY');
          const amount = rx(text(toks, k + 1, u), ctx).trim();
          const iv = `mysql_interval(${amount}, '${toks[u].upper}')`;
          const p = prevSig(toks, k);
          const afterUnit = nextSig(toks, u);
          if (p >= 0 && (isOp(toks[p], '+') || isOp(toks[p], '-'))) {
            const opnd = prevSig(toks, p);
            const start = primaryBackward(toks, opnd);
            const popped = [];
            while (out.length && out[out.length - 1].k >= start) popped.unshift(out.pop());
            const operand = popped.filter((c) => c.k <= opnd).map((c) => c.s).join('').trim();
            emit(start, `${isOp(toks[p], '+') ? 'date_add' : 'date_sub'}(${operand}, ${iv})`);
            k = u + 1;
            continue;
          }
          if (afterUnit >= 0 && isOp(toks[afterUnit], '+')) {
            const s = nextSig(toks, afterUnit);
            const e = primaryForward(toks, s);
            emit(k, `date_add(${rx(text(toks, s, e + 1), ctx).trim()}, ${iv})`);
            k = e + 1;
            continue;
          }
          emit(k, iv);
          k = u + 1;
          continue;
        }

        if (U === 'DIV') { emit(k, '/'); k++; continue; }
        if (U === 'MOD' && !isCall) { emit(k, '%'); k++; continue; }
        if (U === 'RLIKE') { emit(k, 'REGEXP'); k++; continue; }
        if (U === 'XOR') throw new CompatError("XOR isn't supported in this page's engine.", 'Rewrite a XOR b as (a AND NOT b) OR (NOT a AND b).');
        if ((U === 'DATE' || U === 'TIME' || U === 'TIMESTAMP') && nt && nt.type === 'str') { k = nx; continue; }
        if (U === 'FROM' && isWord(nt, 'DUAL')) { k = nx + 1; continue; }
        if (U === 'BINARY' && !isWord(toks[prevSig(toks, k)], 'COLLATE', 'AS')) {
          const e = primaryForward(toks, nx);
          emit(k, `(${rx(text(toks, nx, e + 1), ctx).trim()} COLLATE BINARY)`);
          k = e + 1;
          continue;
        }
        if (U === 'COLLATE' && nt) {
          const name = nt.text.replace(/['"`]/g, '');
          emit(k, `COLLATE ${/_bin$|_cs$|^binary$/i.test(name) ? 'BINARY' : /^rtrim$/i.test(name) ? 'RTRIM' : 'NOCASE'}`);
          k = nx + 1;
          continue;
        }
        if (['SQL_NO_CACHE', 'SQL_CACHE', 'SQL_CALC_FOUND_ROWS', 'HIGH_PRIORITY', 'SQL_SMALL_RESULT', 'SQL_BIG_RESULT', 'SQL_BUFFER_RESULT'].includes(U)) { k++; continue; }
        if (U === 'STRAIGHT_JOIN') { if (!isWord(toks[prevSig(toks, k)], 'SELECT')) emit(k, 'JOIN'); k++; continue; }
        if ((U === 'USE' || U === 'FORCE' || U === 'IGNORE') && isWord(nt, 'INDEX', 'KEY')) {
          let j = nextSig(toks, nx);
          while (j >= 0 && !isOp(toks[j], '(')) j = nextSig(toks, j);
          if (j >= 0) { k = matchParen(toks, j) + 1; continue; }
        }
        if (U === 'FOR' && isWord(nt, 'UPDATE', 'SHARE')) {
          let j = nx + 1;
          const n2 = nextSig(toks, nx);
          if (isWord(toks[n2], 'NOWAIT')) j = n2 + 1;
          if (isWord(toks[n2], 'SKIP')) j = nextSig(toks, n2) + 1;
          ctx.notes.push('Row locks (FOR UPDATE / FOR SHARE) are ignored in this single-user sandbox');
          k = j;
          continue;
        }
        if (U === 'LOCK' && isWord(nt, 'IN')) {
          let j = nx;
          for (let c = 0; c < 3; c++) j = nextSig(toks, j);
          ctx.notes.push('Row locks (LOCK IN SHARE MODE) are ignored in this single-user sandbox');
          k = j + 1;
          continue;
        }
        if (U === 'WITH' && isWord(nt, 'ROLLUP')) throw new CompatError("WITH ROLLUP isn't supported in this page's engine.", 'Add a total row with UNION ALL instead.');
      }

      if (t.type === 'op' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(t.text) && isWord(nt, 'ANY', 'SOME', 'ALL')) {
        const open = nextSig(toks, nx);
        if (open >= 0 && isOp(toks[open], '(') && isWord(toks[nextSig(toks, open)], 'SELECT', 'WITH')) {
          const close = matchParen(toks, open);
          const start = comparisonLeftStart(toks, k);
          const popped = [];
          while (out.length && out[out.length - 1].k >= start) popped.unshift(out.pop());
          const left = popped.map((c) => c.s).join('').trim();
          if (!left) throw new CompatError(`${nt.upper} needs a value on its left, e.g. price > ALL (SELECT …)`);
          const inner = rx(text(toks, open + 1, close), ctx);
          emit(start, `mysql_quantified(${left}, '${t.text}', (WITH _q(v) AS (${inner}) SELECT json_group_array(v) FROM _q), ${nt.upper === 'ALL' ? 1 : 0})`);
          k = close + 1;
          continue;
        }
      }

      if (t.type === 'op') {
        if (t.text === '/') { emit(k, ' * 1.0 /'); k++; continue; }
        if (t.text === '<=>') { emit(k, ' IS '); k++; continue; }
        if (t.text === '&&') { emit(k, ' AND '); k++; continue; }
        if (t.text === '||') { emit(k, ' OR '); k++; continue; }
        if (t.text === '!' ) { emit(k, ' NOT '); k++; continue; }
        if (t.text === '::') throw new CompatError('`::` casts are PostgreSQL syntax.', 'In MySQL use CAST(x AS type), e.g. CAST(x AS DECIMAL(10,2)).');
      }

      emit(k, t.text);
      k++;
    }
    return out.map((c) => c.s).join('');
  }

  // ======================================================================
  // 3. statement-level rewrites
  // ======================================================================
  function splitStatements(src) {
    const toks = tokS(src);
    const stmts = [];
    let start = 0, depth = 0, inTrigger = false, blockDepth = 0;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (isWord(t, 'TRIGGER') && !inTrigger) {
        const first = nextSig(toks, start - 1);
        if (isWord(toks[first], 'CREATE')) inTrigger = true;
      } else if (inTrigger && isWord(t, 'BEGIN')) blockDepth++;
      else if (inTrigger && isWord(t, 'END') && blockDepth > 0) { blockDepth--; if (blockDepth === 0) inTrigger = false; }
      else if (depth <= 0 && !inTrigger && isOp(t, ';')) {
        stmts.push(text(toks, start, k + 1));
        start = k + 1;
        depth = 0;
      }
    }
    if (start < toks.length) stmts.push(text(toks, start, toks.length));
    return stmts;
  }

  function sigWords(toks, n) {
    const out = [];
    for (let k = 0; k < toks.length && out.length < n; k++) if (isSig(toks[k])) out.push({ k, t: toks[k], u: toks[k].upper || toks[k].text });
    return out;
  }
  const bare = (s) => s.replace(/^[`"']|[`"']$/g, '');

  function describeSql(table) {
    const t = q(bare(table));
    return `SELECT name AS Field, type AS Type, CASE "notnull" WHEN 1 THEN 'NO' ELSE 'YES' END AS "Null", ` +
      `CASE WHEN pk > 0 THEN 'PRI' ELSE '' END AS "Key", dflt_value AS "Default" FROM pragma_table_info(${t})`;
  }

  // table refs parser: [{ table, alias, joinType, on: [a,b) | null, derived }]
  function tableRefs(toks, from, to) {
    const refs = [];
    let k = nextSig(toks, from - 1);
    let joinType = null;
    while (k >= 0 && k < to) {
      const t = toks[k];
      if (isOp(t, ',')) { joinType = ','; k = nextSig(toks, k); continue; }
      if (isWord(t, 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'NATURAL', 'OUTER', 'STRAIGHT_JOIN', 'FULL')) {
        joinType = (joinType && joinType !== ',' ? joinType + ' ' : '') + t.upper;
        k = nextSig(toks, k);
        continue;
      }
      const ref = { joinType: joinType || '', table: null, alias: null, on: null, using: null, start: k };
      if (isOp(t, '(')) { const c = matchParen(toks, k); ref.derived = text(toks, k, c + 1); k = nextSig(toks, c); }
      else {
        let e = k;
        let d = nextSig(toks, e);
        while (d >= 0 && isOp(toks[d], '.')) { e = nextSig(toks, d); d = nextSig(toks, e); }
        ref.table = text(toks, k, e + 1);
        k = nextSig(toks, e);
      }
      if (k >= 0 && k < to && isWord(toks[k], 'AS')) k = nextSig(toks, k);
      if (k >= 0 && k < to && (toks[k].type === 'word' || toks[k].type === 'bq') && !RESERVED.has(toks[k].upper) &&
          !isWord(toks[k], 'JOIN', 'STRAIGHT_JOIN', 'SET', 'WHERE', 'USE', 'FORCE', 'IGNORE')) {
        ref.alias = toks[k].text;
        k = nextSig(toks, k);
      }
      if (k >= 0 && k < to && isWord(toks[k], 'ON')) {
        const s = k + 1;
        let depth = 0, e = s;
        for (; e < to; e++) {
          const x = toks[e];
          if (isOp(x, '(')) depth++;
          else if (isOp(x, ')')) depth--;
          else if (depth === 0 && (isOp(x, ',') || isWord(x, 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN', 'FULL'))) break;
        }
        ref.on = [s, e];
        k = e < to ? e : -1;
      } else if (k >= 0 && k < to && isWord(toks[k], 'USING')) {
        const o = nextSig(toks, k);
        const c = matchParen(toks, o);
        ref.using = text(toks, o, c + 1);
        k = nextSig(toks, c);
      }
      ref.end = k;
      refs.push(ref);
      joinType = null;
    }
    return refs;
  }
  const refName = (r) => bare(r.alias || r.table.split('.').pop());

  function rewriteMultiDelete(toks, w) {
    // DELETE [mods] target[.*] FROM refs [WHERE ...]
    let i = 1;
    while (w[i] && ['LOW_PRIORITY', 'QUICK', 'IGNORE'].includes(w[i].u)) i++;
    if (!w[i] || w[i].u === 'FROM') return null;
    const fromIdx = findTopWord(toks, w[i].k, toks.length, 'FROM');
    if (fromIdx < 0) return null;
    const targets = splitCommas(toks, w[i].k, fromIdx).map(([a, b]) => bare(text(toks, a, b).trim().replace(/\.\*$/, '')));
    if (targets.length !== 1) throw new CompatError('Deleting from several tables in one statement isn\'t supported here.', 'Use one DELETE per table.');
    let end = toks.length;
    const semi = toks.findIndex((t, idx) => idx > fromIdx && isOp(t, ';'));
    if (semi >= 0) end = semi;
    const whereIdx = findTopWord(toks, fromIdx, end, 'WHERE');
    const refsEnd = whereIdx >= 0 ? whereIdx : end;
    const refs = tableRefs(toks, fromIdx + 1, refsEnd);
    const target = refs.find((r) => r.table && refName(r).toLowerCase() === targets[0].toLowerCase());
    if (!target) throw new CompatError(`Couldn't find the table for DELETE target ${targets[0]}.`);
    const where = whereIdx >= 0 ? ' ' + text(toks, whereIdx, end).trim() : '';
    return `DELETE FROM ${target.table} WHERE rowid IN (SELECT ${targets[0]}.rowid FROM ${text(toks, fromIdx + 1, refsEnd).trim()}${where})` +
      (semi >= 0 ? ';' : '');
  }

  function rewriteMultiUpdate(toks, w) {
    let i = 1;
    while (w[i] && ['LOW_PRIORITY', 'IGNORE'].includes(w[i].u)) i++;
    const setIdx = findTopWord(toks, w[i].k, toks.length, 'SET');
    if (setIdx < 0) return null;
    const refs = tableRefs(toks, w[i].k, setIdx);
    if (refs.length < 2) return null;
    if (refs.some((r) => /LEFT|RIGHT|FULL/.test(r.joinType))) {
      throw new CompatError("UPDATE with an outer join isn't supported here.", 'Use a correlated subquery in SET, e.g. SET x = (SELECT ... WHERE ...).');
    }
    const target = refs[0];
    if (!target.table) throw new CompatError('The first table in a multi-table UPDATE must be a real table.');
    const tName = refName(target).toLowerCase();
    let end = toks.length;
    const semi = toks.findIndex((t, idx) => idx > setIdx && isOp(t, ';'));
    if (semi >= 0) end = semi;
    const whereIdx = findTopWord(toks, setIdx, end, 'WHERE');
    const setEnd = whereIdx >= 0 ? whereIdx : end;
    const assigns = splitCommas(toks, setIdx + 1, setEnd).map(([a, b]) => {
      const s = text(toks, a, b).trim();
      const m = /^([`"]?[\w$]+[`"]?)\s*\.\s*([`"]?[\w$]+[`"]?)\s*=([\s\S]*)$/.exec(s);
      if (m) {
        if (bare(m[1]).toLowerCase() !== tName) throw new CompatError('This engine can only change one table per UPDATE.', 'Split it into one UPDATE per table.');
        return `${m[2]} =${m[3]}`;
      }
      return s;
    });
    const conds = [];
    const others = refs.slice(1).map((r) => {
      if (r.on) conds.push('(' + text(toks, r.on[0], r.on[1]).trim() + ')');
      if (r.using) throw new CompatError('JOIN … USING in a multi-table UPDATE isn\'t supported here; use ON.');
      return (r.derived || r.table) + (r.alias ? ' AS ' + r.alias : '');
    });
    if (target.on) conds.push('(' + text(toks, target.on[0], target.on[1]).trim() + ')');
    if (whereIdx >= 0) conds.push('(' + text(toks, whereIdx + 1, end).trim() + ')');
    return `UPDATE ${target.table}${target.alias ? ' AS ' + target.alias : ''} SET ${assigns.join(', ')} FROM ${others.join(', ')}` +
      (conds.length ? ' WHERE ' + conds.join(' AND ') : '') + (semi >= 0 ? ';' : '');
  }

  function rewriteInsert(toks, w) {
    let s = text(toks, 0, toks.length);
    let changed = false;
    if (w[1] && w[1].u === 'IGNORE') {
      s = text(toks, 0, w[1].k) + 'OR IGNORE' + text(toks, w[1].k + 1, toks.length);
      changed = true;
    }
    const t2 = tokS(s);
    const on = t2.findIndex((t, i) => isWord(t, 'ON') && isWord(t2[nextSig(t2, i)], 'DUPLICATE'));
    if (on < 0) return changed ? s : null;
    const updIdx = findTopWord(t2, on, t2.length, 'UPDATE');
    let head = text(t2, 0, on);
    let rowAlias = null;
    const ht = tokS(head);
    const lastAs = lastTopWord(ht, 0, ht.length, 'AS');
    if (lastAs >= 0 && findTopWord(ht, lastAs, ht.length, 'SELECT') < 0) {
      rowAlias = ht[nextSig(ht, lastAs)].text;
      head = text(ht, 0, lastAs);
    }
    let assigns = text(t2, updIdx + 1, t2.length);
    const semi = /;\s*$/.test(assigns);
    assigns = assigns.replace(/;\s*$/, '');
    assigns = assigns.replace(/\bVALUES\s*\(\s*([`"]?[\w$]+[`"]?)\s*\)/gi, 'excluded.$1');
    if (rowAlias) assigns = assigns.replace(new RegExp('\\b' + bare(rowAlias) + '\\s*\\.', 'gi'), 'excluded.');
    const hTok = tokS(head);
    const selIdx = findTopWord(hTok, 0, hTok.length, 'SELECT');
    if (selIdx >= 0 && findTopWord(hTok, selIdx, hTok.length, 'WHERE') < 0 && findTopWord(hTok, selIdx, hTok.length, 'FROM') >= 0) head = head.trimEnd() + ' WHERE true ';
    return `${head.trimEnd()} ON CONFLICT DO UPDATE SET${assigns}${semi ? ';' : ''}`;
  }

  function columnDef(defText, tableName, notes) {
    const toks = tokS(defText);
    const sig = toks.map((t, i) => (isSig(t) ? i : -1)).filter((i) => i >= 0);
    if (sig.length < 2) return defText;
    const name = toks[sig[0]].text;
    const typeTok = toks[sig[1]];
    let k = sig[1] + 1;
    let typeText = typeTok.text;
    let typeArgs = '';
    let n = nextSig(toks, sig[1]);
    if (n >= 0 && isOp(toks[n], '(')) {
      const c = matchParen(toks, n);
      typeArgs = text(toks, n, c + 1);
      k = c + 1;
    }
    const upperType = (typeTok.upper || '').toUpperCase();
    let rest = '';
    let hasCollate = false, autoInc = false;
    const restToks = toks.slice(k);
    for (let i = 0; i < restToks.length; i++) {
      const t = restToks[i];
      const u = t.upper;
      const nxt = restToks[nextSig(restToks, i)];
      if (u === 'UNSIGNED' || u === 'SIGNED' || u === 'ZEROFILL' || u === 'INVISIBLE' || u === 'VISIBLE') continue;
      if (u === 'AUTO_INCREMENT') { autoInc = true; continue; }
      if (u === 'COMMENT') { i = nextSig(restToks, i); continue; }
      if (u === 'CHARACTER' && isWord(nxt, 'SET')) { i = nextSig(restToks, nextSig(restToks, i)); continue; }
      if (u === 'CHARSET') { i = nextSig(restToks, i); continue; }
      if (u === 'ON' && isWord(nxt, 'UPDATE')) {
        let j = nextSig(restToks, nextSig(restToks, i));
        const after = nextSig(restToks, j);
        if (after >= 0 && isOp(restToks[after], '(')) j = matchParen(restToks, after);
        i = j;
        continue;
      }
      if (u === 'COLLATE') {
        hasCollate = true;
        const nm = nxt ? nxt.text.replace(/['"`]/g, '') : '';
        rest += `COLLATE ${/_bin$|_cs$|^binary$/i.test(nm) ? 'BINARY' : 'NOCASE'}`;
        i = nextSig(restToks, i);
        continue;
      }
      if (u === 'KEY' && !isWord(restToks[prevSig(restToks, i)], 'PRIMARY', 'UNIQUE')) { rest += 'PRIMARY KEY'; continue; }
      if (u === 'KEY' && isWord(restToks[prevSig(restToks, i)], 'UNIQUE')) continue;
      if (u === 'DEFAULT' && nxt && nxt.type === 'word' && ['NOW', 'CURRENT_TIMESTAMP', 'LOCALTIMESTAMP', 'CURDATE', 'CURRENT_DATE'].includes(nxt.upper)) {
        const j = nextSig(restToks, i);
        let end = j;
        const p = nextSig(restToks, j);
        if (p >= 0 && isOp(restToks[p], '(')) end = matchParen(restToks, p);
        rest += `DEFAULT ${/DATE/.test(nxt.upper) ? 'CURRENT_DATE' : 'CURRENT_TIMESTAMP'}`;
        i = end;
        continue;
      }
      if (u === 'ENFORCED' || (u === 'NOT' && isWord(nxt, 'ENFORCED'))) { if (u === 'NOT') i = nextSig(restToks, i); continue; }
      rest += t.text;
    }
    let type = typeText + typeArgs;
    let check = '';
    if (upperType === 'ENUM' || upperType === 'SET') {
      type = 'TEXT';
      if (upperType === 'ENUM') check = ` CHECK (${name} IN ${typeArgs})`;
    }
    if (autoInc) type = 'INTEGER';
    if (upperType === 'SERIAL') type = 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const collate = TEXT_TYPES.has(upperType) && !hasCollate ? ' COLLATE NOCASE' : '';
    return `${text(toks, 0, sig[0])}${name} ${type}${collate}${rest.replace(/\s+$/, '')}${check}`.replace(/\s+/g, ' ').trim();
  }

  function createTable(toks, notes) {
    const open = toks.findIndex((t) => isOp(t, '('));
    const likeIdx = findTopWord(toks, 0, toks.length, 'LIKE');
    const nameIdx = (() => {
      const t = findTopWord(toks, 0, toks.length, 'TABLE');
      let n = nextSig(toks, t);
      if (isWord(toks[n], 'IF')) n = nextSig(toks, nextSig(toks, nextSig(toks, n)));
      return n;
    })();
    const tableName = toks[nameIdx].text;
    if (likeIdx >= 0 && (open < 0 || likeIdx < open)) {
      const src = toks[nextSig(toks, likeIdx)].text;
      return `${text(toks, 0, nameIdx + 1)} AS SELECT * FROM ${src} WHERE 0`;
    }
    if (open < 0 || findTopWord(toks, 0, open, 'SELECT') >= 0) return null;
    const close = matchParen(toks, open);
    const defs = splitCommas(toks, open + 1, close);
    const out = [];
    const indexes = [];
    for (const [a, b] of defs) {
      const d = tokS(text(toks, a, b));
      const first = d[nextSig(d, -1)];
      if (!first) continue;
      const U = first.upper;
      const dtext = text(toks, a, b).trim();
      if (U === 'KEY' || U === 'INDEX' || ((U === 'FULLTEXT' || U === 'SPATIAL'))) {
        const m = /^(?:FULLTEXT|SPATIAL)?\s*(?:KEY|INDEX)?\s*([`"]?[\w$]+[`"]?)?\s*(?:USING\s+\w+\s*)?\(([\s\S]*)\)/i.exec(dtext);
        if (m && U !== 'FULLTEXT' && U !== 'SPATIAL') {
          const cols = m[2].replace(/\(\s*\d+\s*\)/g, '');
          const nm = m[1] ? bare(m[1]) : `idx_${bare(tableName)}_${cols.replace(/[^\w]+/g, '_')}`;
          indexes.push(`CREATE INDEX ${nm} ON ${tableName} (${cols})`);
        } else notes.push(`${U} index skipped (not supported by this engine)`);
        continue;
      }
      if (U === 'PRIMARY' || U === 'UNIQUE' || U === 'CONSTRAINT' || U === 'FOREIGN' || U === 'CHECK') {
        let s = dtext
          .replace(/\bUSING\s+(BTREE|HASH)\b/gi, '')
          .replace(/\bUNIQUE\s+(KEY|INDEX)\s*([`"]?[\w$]+[`"]?)?\s*\(/i, 'UNIQUE (')
          .replace(/\bFOREIGN\s+KEY\s+([`"]?[\w$]+[`"]?)\s*\(/i, 'FOREIGN KEY (')
          .replace(/\bNOT\s+ENFORCED\b|\bENFORCED\b/gi, '');
        s = s.replace(/(\w|`)\s*\(\s*\d+\s*\)/g, '$1');
        out.push(s.trim());
        continue;
      }
      out.push(columnDef(dtext, tableName, notes));
    }
    const head = text(toks, 0, open);
    return [`${head}(\n  ${out.join(',\n  ')}\n)`, ...indexes].join(';\n') + (toks.some((t) => isOp(t, ';')) ? ';' : '');
  }

  function statementLevel(stmt, ctx) {
    const toks = tokS(stmt);
    const w = sigWords(toks, 8);
    if (!w.length) return stmt;
    const U = w.map((x) => x.u);
    const tail = (i) => text(toks, w[i] ? w[i].k : toks.length, toks.length);
    const endSemi = /;\s*$/.test(stmt) ? ';' : '';

    if (U[0] === 'SHOW') {
      if (U[1] === 'TABLES' || (U[1] === 'FULL' && U[2] === 'TABLES')) {
        return "SELECT name AS Tables FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name" + endSemi;
      }
      if ((U[1] === 'COLUMNS' || U[1] === 'FIELDS') && (U[2] === 'FROM' || U[2] === 'IN')) return describeSql(w[3].t.text) + endSemi;
      if (['INDEX', 'INDEXES', 'KEYS'].includes(U[1]) && (U[2] === 'FROM' || U[2] === 'IN')) {
        return `SELECT ${q(bare(w[3].t.text))} AS "Table", name AS Key_name, CASE "unique" WHEN 1 THEN 0 ELSE 1 END AS Non_unique, ` +
          `origin AS Origin FROM pragma_index_list(${q(bare(w[3].t.text))})` + endSemi;
      }
      if (U[1] === 'CREATE' && U[2] === 'TABLE') {
        return `SELECT name AS "Table", sql AS "Create Table" FROM sqlite_master WHERE name = ${q(bare(w[3].t.text))}` + endSemi;
      }
      if (U[1] === 'DATABASES') return "SELECT 'course' AS \"Database\"" + endSemi;
      throw new CompatError(`SHOW ${U[1] || ''} isn't supported here.`, 'Try SHOW TABLES or DESCRIBE table_name.');
    }
    if ((U[0] === 'DESCRIBE' || U[0] === 'DESC') && w[1]) return describeSql(w[1].t.text) + endSemi;
    if (U[0] === 'EXPLAIN') {
      if (w[1] && (w[1].t.type === 'word' || w[1].t.type === 'bq') && !['SELECT', 'WITH', 'UPDATE', 'DELETE', 'INSERT', 'REPLACE', 'ANALYZE', 'FORMAT'].includes(U[1])) {
        return describeSql(w[1].t.text) + endSemi;
      }
      let i = 1;
      if (U[1] === 'ANALYZE') i = 2;
      if (U[i] === 'FORMAT') i += 3;
      ctx.notes.push('EXPLAIN shows SQLite\'s query plan here; MySQL prints a table with type/key/rows columns instead');
      return 'EXPLAIN QUERY PLAN ' + tail(i);
    }
    if (U[0] === 'START' && U[1] === 'TRANSACTION') return 'BEGIN' + endSemi;
    if (U[0] === 'BEGIN' && (U[1] === 'WORK' || !U[1] || U[1] === ';')) return 'BEGIN' + endSemi;
    if ((U[0] === 'COMMIT' || U[0] === 'ROLLBACK') && U[1] === 'WORK') return U[0] + endSemi;
    if (U[0] === 'SET') {
      if (w[1] && w[1].t.type === 'var') {
        throw new CompatError(`User variables like ${w[1].t.text} aren't supported in this page's engine.`,
          'MySQL user variables are an old trick for ranking/running totals. Use window functions (ROW_NUMBER, SUM() OVER) or a CTE instead.');
      }
      ctx.notes.push(`Ignored: ${stmt.trim().replace(/;$/, '')} (session settings don't apply to this sandbox)`);
      return '';
    }
    if (U[0] === 'USE' || (U[0] === 'LOCK' && U[1] === 'TABLES') || (U[0] === 'UNLOCK' && U[1] === 'TABLES')) {
      ctx.notes.push(`Ignored: ${stmt.trim().replace(/;$/, '')}`);
      return '';
    }
    if (U[0] === 'DELIMITER' || (U[0] === 'CREATE' && (U[1] === 'FUNCTION' || U[1] === 'PROCEDURE' || (U[1] === 'DEFINER')))) {
      throw new CompatError("Stored functions and procedures only run in the #177 exercise here.",
        'Write a plain query instead (use a CTE for intermediate steps).');
    }
    if (U[0] === 'TRUNCATE') return 'DELETE FROM ' + text(toks, (U[1] === 'TABLE' ? w[2] : w[1]).k, toks.length).trim();
    if (U[0] === 'CREATE') {
      let i = 1;
      if (U[1] === 'OR' && U[2] === 'REPLACE') {
        if (U[3] === 'VIEW') {
          const name = w[4].t.text;
          return `DROP VIEW IF EXISTS ${name}; CREATE VIEW ${tail(4)}`;
        }
        i = 3;
      }
      if (U[i] === 'TEMPORARY') i++;
      if (U[i] === 'TABLE') { const r = createTable(toks, ctx.notes); if (r !== null) return r; }
      if (['UNIQUE', 'FULLTEXT', 'SPATIAL', 'INDEX'].includes(U[i]) && U.includes('INDEX')) {
        let s = stmt.replace(/\b(FULLTEXT|SPATIAL)\s+INDEX/i, 'INDEX').replace(/\bUSING\s+(BTREE|HASH)\b/gi, '');
        const st = tokS(s);
        const on = findTopWord(st, 0, st.length, 'ON');
        const o = st.findIndex((t, idx) => idx > on && isOp(t, '('));
        if (o > 0) {
          const c = matchParen(st, o);
          s = text(st, 0, o) + text(st, o, c + 1).replace(/([\w`"])\s*\(\s*\d+\s*\)/g, '$1') + text(st, c + 1, st.length);
        }
        return s;
      }
    }
    if (U[0] === 'ALTER' && U[1] === 'TABLE') {
      const table = w[2].t.text;
      const act = U[3];
      const rest = text(toks, w[4] ? w[4].k : toks.length, toks.length).trim().replace(/;$/, '');
      if (act === 'ADD' && (['INDEX', 'KEY', 'UNIQUE', 'FULLTEXT'].includes(U[4]))) {
        const m = /^(UNIQUE\s+)?(?:FULLTEXT\s+)?(?:INDEX|KEY)?\s*([`"]?[\w$]+[`"]?)?\s*\(([\s\S]*)\)$/i.exec(rest);
        if (!m) throw new CompatError('Could not read the index definition.');
        const cols = m[3].replace(/\(\s*\d+\s*\)/g, '');
        const nm = m[2] ? bare(m[2]) : `idx_${bare(table)}_${cols.replace(/[^\w]+/g, '_')}`;
        return `CREATE ${m[1] ? 'UNIQUE ' : ''}INDEX ${nm} ON ${table} (${cols})${endSemi}`;
      }
      if (act === 'DROP' && (U[4] === 'INDEX' || U[4] === 'KEY')) return `DROP INDEX ${w[5].t.text}${endSemi}`;
      if (act === 'ADD' && U[4] !== 'CONSTRAINT' && U[4] !== 'PRIMARY' && U[4] !== 'FOREIGN') {
        const def = U[4] === 'COLUMN' ? text(toks, w[5].k, toks.length).replace(/;\s*$/, '') : rest;
        return `ALTER TABLE ${table} ADD COLUMN ${columnDef(def, table, ctx.notes)}${endSemi}`;
      }
      if (['MODIFY', 'CHANGE', 'ALTER'].includes(act) || (act === 'ADD' && ['CONSTRAINT', 'PRIMARY', 'FOREIGN'].includes(U[4]))) {
        throw new CompatError(`ALTER TABLE … ${act}${act === 'ADD' ? ' ' + U[4] : ''} isn't supported by this page's engine.`,
          'Recreate the table instead: CREATE TABLE new (...); INSERT INTO new SELECT ... FROM old;');
      }
    }
    if (U[0] === 'DROP' && U[1] === 'INDEX') {
      const on = findTopWord(toks, 0, toks.length, 'ON');
      if (on >= 0) return text(toks, 0, on).trim() + endSemi;
    }
    if (U[0] === 'DROP' && U[1] === 'TABLE') {
      let i = 2;
      let ifExists = '';
      if (U[2] === 'IF' && U[3] === 'EXISTS') { i = 4; ifExists = 'IF EXISTS '; }
      const names = splitCommas(toks, w[i].k, toks.length).map(([a, b]) => text(toks, a, b).replace(/;\s*$/, '').trim());
      if (names.length > 1) return names.map((n) => `DROP TABLE ${ifExists}${n};`).join(' ');
    }
    if (U[0] === 'DELETE') { const r = rewriteMultiDelete(toks, w); if (r) return r; }
    if (U[0] === 'UPDATE') { const r = rewriteMultiUpdate(toks, w); if (r) return r; }
    if (U[0] === 'INSERT') { const r = rewriteInsert(toks, w); if (r) return r; }
    return stmt;
  }

  // ======================================================================
  // 4. keep MySQL column names for expressions the rewrite changes
  // ======================================================================
  function hasAlias(toks, sig) {
    if (sig.length < 2) return false;
    const last = toks[sig[sig.length - 1]];
    const prev = toks[sig[sig.length - 2]];
    if (isWord(prev, 'AS')) return true;
    const lastIsName = last.type === 'bq' || last.type === 'str' || last.type === 'dstr' || (last.type === 'word' && !RESERVED.has(last.upper));
    const prevEnds = isOp(prev, ')') || prev.type === 'num' || prev.type === 'str' || prev.type === 'dstr' || prev.type === 'bq' ||
      (prev.type === 'word' && !OPERATOR_WORDS.has(prev.upper));
    if (!lastIsName || !prevEnds) return false;
    if (last.type === 'word' && UNITS.has(last.upper) && sig.some((i) => isWord(toks[i], 'INTERVAL'))) return false;
    return true;
  }
  function changes(itemText, ctx, aliases) {
    try {
      const n = normalizeLiterals(itemText);
      return n !== itemText || unsignedChecks(n, aliases) !== n || mixedComparisons(n, ctx) !== n ||
        rx(n, { notes: [], dateCols: ctx.dateCols }) !== n;
    } catch (e) {
      return false;
    }
  }
  function preserveAliases(src, ctx) {
    const toks = tokM(src);
    const aliases = rankAliases(toks);
    const inserts = new Map();
    for (let k = 0; k < toks.length; k++) {
      if (!isWord(toks[k], 'SELECT')) continue;
      let depth = 0, end = toks.length;
      for (let j = k + 1; j < toks.length; j++) {
        const t = toks[j];
        if (isOp(t, '(')) depth++;
        else if (isOp(t, ')')) { if (depth === 0) { end = j; break; } depth--; }
        else if (depth === 0 && (isOp(t, ';') || (t.type === 'word' && LIST_END.has(t.upper)))) { end = j; break; }
      }
      let start = k + 1;
      for (;;) {
        const n = nextSig(toks, start - 1);
        if (n >= 0 && n < end && toks[n].type === 'word' && SELECT_MODS.has(toks[n].upper)) start = n + 1;
        else break;
      }
      for (const [a, b] of splitCommas(toks, start, end)) {
        const sig = [];
        for (let j = a; j < b; j++) if (isSig(toks[j])) sig.push(j);
        if (!sig.length || hasAlias(toks, sig)) continue;
        const itemText = text(toks, sig[0], sig[sig.length - 1] + 1);
        if (itemText === '*' || /\.\s*\*$/.test(itemText)) continue;
        if (!changes(itemText, ctx, aliases)) continue;
        inserts.set(sig[sig.length - 1], ' AS `' + itemText.replace(/`/g, '``') + '`');
      }
    }
    if (!inserts.size) return src;
    return toks.map((t, i) => t.text + (inserts.get(i) || '')).join('');
  }


  // MySQL resolves a name in HAVING to a SELECT alias before a table column; SQLite does the
  // opposite. Replace alias references in HAVING with the aliased expression.
  function expandHavingAliases(src) {
    const toks = tokS(src);
    const edits = new Map();
    for (let k = 0; k < toks.length; k++) {
      if (!isWord(toks[k], 'SELECT')) continue;
      const info = selectInfo(toks, k);
      const h = info.clauses.HAVING;
      if (h === undefined) continue;
      const cl = info.clauses;
      const endOf = (names) => Math.min(...names.map((c) => (cl[c] !== undefined ? cl[c] : info.end)));
      const listEnd = endOf(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW']);
      let start = k + 1;
      for (;;) {
        const n = nextSig(toks, start - 1);
        if (n >= 0 && n < listEnd && toks[n].type === 'word' && SELECT_MODS.has(toks[n].upper)) start = n + 1; else break;
      }
      const aliases = new Map();
      for (const [a, b] of splitCommas(toks, start, listEnd)) {
        const sig = [];
        for (let j = a; j < b; j++) if (isSig(toks[j])) sig.push(j);
        if (sig.length < 2 || !hasAlias(toks, sig)) continue;
        const end = isWord(toks[sig[sig.length - 2]], 'AS') ? sig[sig.length - 2] : sig[sig.length - 1];
        aliases.set(bare(toks[sig[sig.length - 1]].text).toLowerCase(), text(toks, sig[0], end).trim());
      }
      if (!aliases.size) continue;
      const hEnd = endOf(['ORDER', 'LIMIT', 'WINDOW']);
      for (let j = h + 1; j < hEnd; j++) {
        const t = toks[j];
        if (isOp(t, '(') && isWord(toks[nextSig(toks, j)], 'SELECT')) { j = matchParen(toks, j); continue; }
        if (!(t.type === 'word' || t.type === 'bq' || t.type === 'dstr')) continue;
        const key = bare(t.text).toLowerCase();
        if (!aliases.has(key)) continue;
        const p = prevSig(toks, j), n = nextSig(toks, j);
        if ((p >= 0 && isOp(toks[p], '.')) || (n >= 0 && (isOp(toks[n], '(') || isOp(toks[n], '.')))) continue;
        edits.set(j, '(' + aliases.get(key) + ')');
      }
    }
    if (!edits.size) return src;
    return toks.map((t, i) => (edits.has(i) ? edits.get(i) : t.text)).join('');
  }

  // ======================================================================
  // public: rewrite
  // ======================================================================
  // ======================================================================
  // ROW_NUMBER(), RANK(), DENSE_RANK() and NTILE() return BIGINT UNSIGNED in MySQL, so integer
  // arithmetic with them (or with a derived column holding one) fails with error 1690 when the
  // result would be negative. Wrap each such +/- expression in a runtime check.
  // ======================================================================
  const RANK_FUNCS = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE']);
  function rankCallEnd(toks, i) {
    const open = nextSig(toks, i);
    if (open < 0 || !isOp(toks[open], '(')) return -1;
    const over = nextSig(toks, matchParen(toks, open));
    if (over < 0 || !isWord(toks[over], 'OVER')) return -1;
    const w = nextSig(toks, over);
    if (w < 0) return -1;
    return isOp(toks[w], '(') ? matchParen(toks, w) : w;
  }
  // names given to a bare ranking call in a select list: `ROW_NUMBER() OVER (…) AS rn`
  function rankAliases(toks) {
    const names = new Set();
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'word' || !RANK_FUNCS.has(toks[i].upper)) continue;
      const e = rankCallEnd(toks, i);
      if (e < 0) continue;
      const p = prevSig(toks, i);
      if (!(p >= 0 && (isOp(toks[p], ',') || isWord(toks[p], 'SELECT') || (toks[p].type === 'word' && SELECT_MODS.has(toks[p].upper))))) continue;
      let a = nextSig(toks, e);
      if (isWord(toks[a], 'AS')) a = nextSig(toks, a);
      const t = toks[a];
      if (t && (t.type === 'bq' || t.type === 'dstr' || (t.type === 'word' && !RESERVED.has(t.upper) && !LIST_END.has(t.upper)))) {
        names.add(bare(t.text).toLowerCase());
      }
    }
    return names;
  }
  function operandForward(toks, s) {
    let e = primaryForward(toks, s);
    const o = nextSig(toks, e);
    if (o >= 0 && isWord(toks[o], 'OVER')) {
      const w = nextSig(toks, o);
      if (w >= 0) e = isOp(toks[w], '(') ? matchParen(toks, w) : w;
    }
    return e;
  }
  function operandBackward(toks, e) {
    let s = primaryBackward(toks, e);
    const p = prevSig(toks, s);
    if (isWord(toks[s], 'OVER')) s = primaryBackward(toks, prevSig(toks, s));
    else if (p >= 0 && isWord(toks[p], 'OVER')) s = primaryBackward(toks, prevSig(toks, p));
    return s;
  }
  function unsignedChecks(src, aliases) {
    const toks = tokS(src);
    const names = aliases || rankAliases(toks);
    const spans = [];
    let covered = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (i <= covered || (t.type !== 'word' && t.type !== 'bq')) continue;
      let cs = i, ce = -1;
      if (t.type === 'word' && RANK_FUNCS.has(t.upper)) {
        ce = rankCallEnd(toks, i);
      } else if (names.has(bare(t.text).toLowerCase())) {
        const n = nextSig(toks, i), p = prevSig(toks, i);
        if ((n >= 0 && (isOp(toks[n], '(') || isOp(toks[n], '.'))) || (p >= 0 && isWord(toks[p], 'AS'))) continue;
        cs = qualifiedStart(toks, i);
        ce = i;
      }
      if (ce < 0) continue;
      let L = cs, R = ce;
      const ops = [];
      for (;;) {
        const op = prevSig(toks, L);
        if (op < 0 || !isArith(toks[op])) break;
        const pe = prevSig(toks, op);
        if (!operandEndsAt(toks, pe)) break;
        ops.push(toks[op].text);
        L = operandBackward(toks, pe);
      }
      for (;;) {
        const op = nextSig(toks, R);
        if (op < 0 || !isArith(toks[op])) break;
        const s = nextSig(toks, op);
        if (s < 0 || isWord(toks[s], 'INTERVAL')) break;
        ops.push(toks[op].text);
        R = operandForward(toks, s);
      }
      covered = Math.max(covered, R);
      if (ops.some((o) => o === '+' || o === '-') && !ops.includes('/')) spans.push([L, R]);
    }
    if (!spans.length) return src;
    let out = '', k = 0;
    for (const [L, R] of spans) {
      const expr = text(toks, L, R + 1);
      out += text(toks, k, L) + `mysql_unsigned(${expr}, ${q(expr.replace(/\s+/g, ' ').trim())})`;
      k = R + 1;
    }
    return out + text(toks, k, toks.length);
  }

  // ======================================================================
  // Mixed string/number comparisons. MySQL compares a string with a number as numbers
  // (YEAR(d) = '2024' is true, DATE_FORMAT(d, '%Y') = 2024 is true). SQLite never finds a TEXT
  // value equal to a number unless a column's affinity converts one side, so convert the side
  // that needs it with `+ 0` (a date operand then becomes YYYYMMDD, as in MySQL).
  // ======================================================================
  const NUM_FUNCS = new Set([...INT_FUNCS, 'ROUND', 'TRUNCATE', 'ABS', 'SIGN', 'MOD', 'POW', 'POWER', 'SQRT', 'EXP', 'LN',
    'LOG', 'LOG2', 'LOG10', 'PI', 'RAND', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'DEGREES', 'RADIANS', 'COUNT',
    'SUM', 'AVG', 'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP', 'TIMESTAMPDIFF', 'EXTRACT',
    'UNIX_TIMESTAMP', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'PERCENT_RANK', 'CUME_DIST', 'ISNULL']);
  const TEXT_FUNCS = new Set(['LEFT', 'RIGHT', 'SUBSTRING', 'SUBSTR', 'MID', 'CONCAT', 'CONCAT_WS', 'DATE_FORMAT', 'TIME_FORMAT',
    'LPAD', 'RPAD', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'UPPER', 'LOWER', 'UCASE', 'LCASE', 'REVERSE', 'REPEAT',
    'SUBSTRING_INDEX', 'FORMAT', 'HEX', 'BIN', 'MONTHNAME', 'DAYNAME', 'ELT', 'INSERT', 'GROUP_CONCAT', 'SPACE', 'QUOTE',
    'REGEXP_SUBSTR', 'REGEXP_REPLACE']);
  const CMP_OPS = ['=', '<>', '!=', '<', '<=', '>', '>=', '<=>'];
  const CMP_RIGHT_STOP = new Set(['AND', 'OR', 'XOR', 'THEN', 'ELSE', 'WHEN', 'END', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT',
    'FROM', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'UNION', 'INTERSECT', 'EXCEPT', 'AS', 'IS', 'IN', 'NOT', 'LIKE',
    'BETWEEN', 'REGEXP', 'RLIKE', 'ASC', 'DESC', 'WINDOW', 'USING', 'SEPARATOR', 'ESCAPE', 'COLLATE', 'FOR', 'INTO', 'SET',
    'VALUES', 'OFFSET']);
  function comparisonRightEnd(toks, opIdx) {
    let end = opIdx;
    for (let j = nextSig(toks, opIdx); j >= 0; j = nextSig(toks, j)) {
      const t = toks[j];
      if (isOp(t, '(')) { j = matchParen(toks, j); if (j < 0) break; end = j; continue; }
      if (isOp(t, ')') || isOp(t, ',') || isOp(t, ';') || (t.type === 'op' && CMP_OPS.includes(t.text))) break;
      if (isWord(t, 'CASE')) {
        let depth = 0, m = j;
        for (; m < toks.length; m++) {
          if (isWord(toks[m], 'CASE')) depth++;
          else if (isWord(toks[m], 'END') && --depth === 0) break;
        }
        j = end = Math.min(m, toks.length - 1);
        continue;
      }
      if (t.type === 'word' && CMP_RIGHT_STOP.has(t.upper) && !((t.upper === 'LEFT' || t.upper === 'RIGHT') && isOp(toks[nextSig(toks, j)], '('))) break;
      end = j;
    }
    return end;
  }
  function mixedLeftStart(toks, opIdx) {
    let start = opIdx;
    for (let j = prevSig(toks, opIdx); j >= 0; j = prevSig(toks, j)) {
      const t = toks[j];
      if (isOp(t, ')')) { j = matchParenBack(toks, j); if (j < 0) break; start = j; continue; }
      if (isWord(t, 'END')) {
        let depth = 0, m = j;
        for (; m >= 0; m--) {
          if (isWord(toks[m], 'END')) depth++;
          else if (isWord(toks[m], 'CASE') && --depth === 0) break;
        }
        if (m < 0) break;
        j = start = m;
        continue;
      }
      if (isOp(t, '(') || isOp(t, ',') || isOp(t, ';') || (t.type === 'op' && CMP_OPS.includes(t.text))) break;
      const fnName = (t.upper === 'LEFT' || t.upper === 'RIGHT' || t.upper === 'INSERT') && isOp(toks[nextSig(toks, j)], '(');
      if (t.type === 'word' && !fnName && (CMP_BOUNDARY.has(t.upper) || CMP_RIGHT_STOP.has(t.upper) || t.upper === 'BY' || t.upper === 'SELECT')) break;
      start = j;
    }
    return start;
  }
  // 'num' | 'str' | 'column' | 'datecol' | 'numexpr' | 'text' | 'date' | 'unknown'
  function operandKind(toks, s, e, ctx) {
    const sig = [];
    for (let j = s; j <= e; j++) if (toks[j] && isSig(toks[j])) sig.push(j);
    if (!sig.length) return 'unknown';
    const first = toks[sig[0]], last = toks[sig[sig.length - 1]];
    if (sig.length === 1 && first.type === 'num') return 'num';
    if (sig.length === 2 && (isOp(first, '-') || isOp(first, '+')) && last.type === 'num') return 'num';
    if (sig.length === 1 && first.type === 'str') return 'str';
    if (sig.every((j) => isOp(toks[j], '.') || toks[j].type === 'word' || toks[j].type === 'bq' || toks[j].type === 'dstr')) {
      if (sig.length === 1 && first.type === 'word' && DATE_WORDS.has(first.upper)) return 'date';
      if (last.type === 'word' && RESERVED.has(last.upper)) return 'unknown';
      return ctx.dateCols && ctx.dateCols.has(bare(last.text).toLowerCase()) ? 'datecol' : 'column';
    }
    const open = nextSig(toks, sig[0]);
    if (first.type === 'word' && open >= 0 && isOp(toks[open], '(') && matchParen(toks, open) === sig[sig.length - 1]) {
      const U = first.upper;
      if (U === 'CAST' || U === 'CONVERT') {
        const w = toks[prevSig(toks, sig[sig.length - 1])];
        if (isWord(w, 'CHAR', 'VARCHAR', 'NCHAR', 'TEXT')) return 'text';
        if (isWord(w, 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME')) return 'date';
        return isWord(w, 'SIGNED', 'UNSIGNED', 'INTEGER', 'INT', 'BIGINT', 'DOUBLE', 'FLOAT', 'REAL') || isOp(w, ')') ? 'numexpr' : 'unknown';
      }
      if (NUM_FUNCS.has(U)) return 'numexpr';
      if (TEXT_FUNCS.has(U)) return 'text';
      if (DATE_FUNCS.has(U)) return 'date';
      return 'unknown';
    }
    let depth = 0, arith = false;
    for (const j of sig) {
      const t = toks[j];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) depth--;
      else if (isWord(t, 'INTERVAL')) return 'unknown';
      else if (depth === 0 && isArith(t) && operandEndsAt(toks, prevSig(toks, j))) arith = true;
    }
    return arith ? 'numexpr' : 'unknown';
  }
  function mixedComparisons(src, ctx) {
    const toks = tokS(src);
    const before = new Map(), after = new Map();
    const wrap = ([s, e]) => {
      before.set(s, (before.get(s) || '') + '(');
      after.set(e, ' + 0)' + (after.get(e) || ''));
    };
    const TEXTY = new Set(['str', 'text', 'date', 'datecol']);
    // compare one operand with a set of others; convert whichever side MySQL would treat as a number
    const reconcile = (left, others) => {
      const lk = operandKind(toks, left[0], left[1], ctx);
      const kinds = others.map((o) => operandKind(toks, o[0], o[1], ctx));
      if (TEXTY.has(lk) && kinds.includes('num')) wrap(left);
      else if (lk !== 'str' && TEXTY.has(lk) && kinds.includes('numexpr')) wrap(left);
      others.forEach((o, i) => {
        if (lk === 'num' && TEXTY.has(kinds[i])) wrap(o);
        else if (lk === 'numexpr' && TEXTY.has(kinds[i])) wrap(o);
      });
    };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'op' && CMP_OPS.includes(t.text)) {
        const p = prevSig(toks, k), n = nextSig(toks, k);
        if (p < 0 || n < 0 || isWord(toks[n], 'ANY', 'SOME', 'ALL')) continue;
        const ls = mixedLeftStart(toks, k), re = comparisonRightEnd(toks, k);
        if (ls <= p && re >= n) reconcile([ls, p], [[n, re]]);
      } else if (isWord(t, 'IN', 'BETWEEN')) {
        const pv = prevSig(toks, k);
        const opIdx = pv >= 0 && isWord(toks[pv], 'NOT') ? pv : k;
        const ls = mixedLeftStart(toks, opIdx), le = prevSig(toks, opIdx);
        if (le < 0 || ls > le) continue;
        if (t.upper === 'IN') {
          const open = nextSig(toks, k);
          if (open < 0 || !isOp(toks[open], '(') || isWord(toks[nextSig(toks, open)], 'SELECT', 'WITH')) continue;
          const close = matchParen(toks, open);
          if (close < 0) continue;
          const items = splitCommas(toks, open + 1, close).map(([a, b]) => [a, b - 1]);
          reconcile([ls, le], items);
        } else {
          const andIdx = findTopWord(toks, k + 1, toks.length, 'AND');
          if (andIdx < 0) continue;
          const lo = [nextSig(toks, k), prevSig(toks, andIdx)], hi = [nextSig(toks, andIdx), comparisonRightEnd(toks, andIdx)];
          if (lo[0] < 0 || hi[0] < 0) continue;
          reconcile([ls, le], [lo, hi]);
        }
      }
    }
    if (!before.size) return src;
    return toks.map((tk, i) => (before.get(i) || '') + tk.text + (after.get(i) || '')).join('');
  }

  function rewrite(src, opts) {
    const ctx = { notes: [], dateCols: new Set((opts && opts.dateCols) || []) };
    const withAliases = preserveAliases(src, ctx);
    const normalized = normalizeLiterals(withAliases);
    const out = [];
    for (const stmt of splitStatements(normalized)) {
      const s = statementLevel(stmt, ctx);
      out.push(s === '' ? '' : rx(mixedComparisons(unsignedChecks(expandHavingAliases(s)), ctx), ctx));
    }
    return { sql: out.join(''), notes: ctx.notes };
  }

  // ======================================================================
  // 5. lint: things MySQL would reject or treat differently
  // ======================================================================
  const SQLITE_ONLY = {
    STRFTIME: 'DATE_FORMAT(date, format)', JULIANDAY: 'DATEDIFF() or TO_DAYS()', IIF: 'IF(cond, a, b)',
    PRINTF: 'FORMAT() or CONCAT()', TYPEOF: 'no MySQL equivalent', TOTAL: 'SUM()', UNIXEPOCH: 'UNIX_TIMESTAMP()',
    DATETIME: 'TIMESTAMP() or DATE_FORMAT()', MEDIAN: 'window functions (MySQL has no MEDIAN)', STRING_AGG: 'GROUP_CONCAT()',
    GLOB: 'LIKE or REGEXP', RANDOM: 'RAND()', ZEROBLOB: 'no MySQL equivalent', LIKELIHOOD: 'no MySQL equivalent',
  };

  function selectInfo(toks, k) {
    // for SELECT at k: items [{sig, alias}], clause bounds at same depth
    let depth = 0, end = toks.length;
    const clauses = {};
    for (let j = k + 1; j < toks.length; j++) {
      const t = toks[j];
      if (isOp(t, '(')) depth++;
      else if (isOp(t, ')')) { if (depth === 0) { end = j; break; } depth--; }
      else if (depth === 0 && isOp(t, ';')) { end = j; break; }
      else if (depth === 0 && t.type === 'word' && ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW'].includes(t.upper)) {
        if (['UNION', 'INTERSECT', 'EXCEPT'].includes(t.upper)) { end = j; break; }
        if (!(t.upper in clauses)) clauses[t.upper] = j;
      }
    }
    return { end, clauses };
  }


  // ONLY_FULL_GROUP_BY (error 1055) and aggregate-without-GROUP-BY (error 1140), conservatively:
  // warn only for real table columns we can resolve, honouring functional dependence on a primary key.
  const AGGS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP',
    'VARIANCE', 'VAR_POP', 'VAR_SAMP', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'ANY_VALUE']);
  const NON_COLUMN = new Set([...F.UNITS, 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP',
    'UNSIGNED', 'SIGNED', 'DECIMAL', 'CHAR', 'INTEGER', 'INT', 'DATE', 'DATETIME', 'TIME', 'TIMESTAMP', 'PRECEDING',
    'FOLLOWING', 'CURRENT', 'ROW', 'UNBOUNDED', 'DUAL', 'LEADING', 'TRAILING', 'BOTH']);
  const normExpr = (s) => s.replace(/[`"\s]/g, '').toLowerCase();
  const sigText = (toks, a, b) => toks.slice(a, b).filter(isSig).map((t) => t.text).join(' ');

  function groupByCheck(toks, k, tables, add) {
    const info = selectInfo(toks, k);
    const cl = info.clauses;
    const endOf = (names) => Math.min(...names.map((c) => (cl[c] !== undefined ? cl[c] : info.end)));
    const listEnd = endOf(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW']);
    let start = k + 1;
    for (;;) {
      const n = nextSig(toks, start - 1);
      if (n >= 0 && n < listEnd && toks[n].type === 'word' && SELECT_MODS.has(toks[n].upper)) start = n + 1; else break;
    }
    const items = splitCommas(toks, start, listEnd).map(([a, b]) => {
      const sig = [];
      for (let j = a; j < b; j++) if (isSig(toks[j])) sig.push(j);
      const aliased = sig.length >= 2 && hasAlias(toks, sig);
      const end = aliased ? (isWord(toks[sig[sig.length - 2]], 'AS') ? sig[sig.length - 2] : sig[sig.length - 1]) : b;
      return { a, end, alias: aliased ? bare(toks[sig[sig.length - 1]].text).toLowerCase() : null, text: normExpr(sigText(toks, a, end)) };
    });
    const has = (it, pred) => {
      for (let j = it.a; j < it.end; j++) {
        if (isOp(toks[j], '(') && isWord(toks[nextSig(toks, j)], 'SELECT')) { j = matchParen(toks, j); continue; }
        if (pred(toks[j], j)) return true;
      }
      return false;
    };
    const isAgg = (t, j) => {
      if (!(t.type === 'word' && AGGS.has(t.upper))) return false;
      const o = nextSig(toks, j);
      if (!isOp(toks[o], '(')) return false;
      return !isWord(toks[nextSig(toks, matchParen(toks, o))], 'OVER');   // COUNT(*) OVER (...) is a window function
    };
    const hasGroup = cl.GROUP !== undefined;
    const anyAgg = items.some((it) => has(it, isAgg)) || cl.HAVING !== undefined;
    if (!hasGroup && !anyAgg) return;
    let groupExprs = [];
    if (hasGroup) {
      const by = nextSig(toks, cl.GROUP);
      groupExprs = splitCommas(toks, by + 1, endOf(['HAVING', 'ORDER', 'LIMIT', 'WINDOW']))
        .map(([a, b]) => normExpr(sigText(toks, a, b)).replace(/withrollup$/, '')).filter(Boolean);
      groupExprs = groupExprs.flatMap((g) => {
        const it = /^\d+$/.test(g) ? items[Number(g) - 1] : items.find((i) => i.alias === g);
        return it ? [g, it.text] : [g];
      });
    }
    const gset = new Set(groupExprs);
    const gNames = new Set(groupExprs.map((g) => g.split('.').pop()));
    const refs = cl.FROM !== undefined ? tableRefs(toks, cl.FROM + 1, endOf(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW'])) : [];
    const aliasMap = {};
    const fromTables = [];
    for (const r of refs) {
      if (!r.table) continue;
      const tn = bare(r.table.split('.').pop()).toLowerCase();
      aliasMap[refName(r).toLowerCase()] = tn;
      fromTables.push(tn);
    }
    const pkGrouped = (tn) => tables[tn] && tables[tn].pk.length > 0 && tables[tn].pk.every((c) => gNames.has(c));
    for (const it of items) {
      if (!it.text || it.text === '*' || /\.\*$/.test(it.text)) continue;
      if (has(it, isAgg) || has(it, (t) => isWord(t, 'OVER')) || gset.has(it.text)) continue;
      for (let j = it.a; j < it.end; j++) {
        const t = toks[j];
        if (isOp(t, '(') && isWord(toks[nextSig(toks, j)], 'SELECT')) { j = matchParen(toks, j); continue; }
        if (!(t.type === 'word' || t.type === 'bq')) continue;
        if (t.type === 'word' && (RESERVED.has(t.upper) || NON_COLUMN.has(t.upper))) continue;
        const nx = nextSig(toks, j);
        if (nx >= 0 && (isOp(toks[nx], '(') || isOp(toks[nx], '.'))) continue;
        const p = prevSig(toks, j);
        const qual = p >= 0 && isOp(toks[p], '.') ? bare(toks[prevSig(toks, p)].text).toLowerCase() : null;
        const name = bare(t.text).toLowerCase();
        const full = (qual ? qual + '.' : '') + name;
        if (gset.has(full) || gset.has(name) || gNames.has(name)) continue;
        let tn = qual ? aliasMap[qual] : null;
        if (!qual) {
          const cands = fromTables.filter((x) => tables[x] && tables[x].cols.includes(name));
          if (cands.length !== 1) continue;
          tn = cands[0];
        }
        if (!tn || !tables[tn] || !tables[tn].cols.includes(name) || pkGrouped(tn)) continue;
        if (!hasGroup) {
          add(`MySQL rejects \`${full}\` here (error 1140): the query aggregates, so every other selected column must be inside an aggregate such as MAX() — or add a GROUP BY.`);
        } else {
          add(`MySQL rejects \`${full}\` in SELECT (ONLY_FULL_GROUP_BY, error 1055): it is neither in GROUP BY nor inside an aggregate. Add it to GROUP BY, or wrap it in MAX() / ANY_VALUE().`);
        }
        break;
      }
    }
  }

  const WINDOW_RESERVED = new Set(['RANK', 'DENSE_RANK', 'ROW_NUMBER', 'LAG', 'LEAD', 'NTILE', 'CUME_DIST', 'PERCENT_RANK',
    'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE']);
  function lint(src, opts) {
    const columns = (opts && opts.columns) || new Set();
    const tables = (opts && opts.tables) || {};
    const warnings = [];
    const add = (w) => { if (!warnings.includes(w)) warnings.push(w); };
    let toks;
    try { toks = tokM(src); } catch (e) { return warnings; }
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const nx = nextSig(toks, k);
      const nt = toks[nx];
      if (isWord(t, 'FULL') && (isWord(nt, 'JOIN') || (isWord(nt, 'OUTER') && isWord(toks[nextSig(toks, nx)], 'JOIN')))) {
        add('MySQL has no FULL OUTER JOIN — it ran here because this engine has one. On LeetCode, combine LEFT JOIN … UNION … RIGHT JOIN.');
      }
      if (t.type === 'word' && WINDOW_RESERVED.has(t.upper) && !(nt && isOp(nt, '(')) && !isOp(toks[prevSig(toks, k)], '.')) {
        add(`\`${t.text}\` is a reserved word in MySQL 8 (it names a window function), so MySQL rejects it as a name. Quote it with backticks: \`${t.text.toLowerCase()}\`.`);
      }
      if (isWord(t, 'REGEXP', 'RLIKE') && isWord(nt, 'BINARY')) {
        add("MySQL 8.0.22+ rejects `REGEXP BINARY` (error 3995: binary and text can't mix). For a case-sensitive match use REGEXP_LIKE(str, pattern, 'c').");
      }
      if (isWord(t, 'NULLS') && isWord(nt, 'FIRST', 'LAST')) add("MySQL doesn't support NULLS FIRST/LAST. Sort on an extra key instead, e.g. ORDER BY x IS NULL, x.");
      if (isOp(t, '||')) add('In MySQL `||` means OR, not string concatenation. Use CONCAT(a, b).');
      if (t.type === 'word' && nt && isOp(nt, '(') && SQLITE_ONLY[t.upper] && !isOp(toks[prevSig(toks, k)], '.')) {
        add(`${t.upper}() is SQLite, not MySQL — LeetCode will reject it. Use ${SQLITE_ONLY[t.upper]}.`);
      }
      if (isWord(t, 'MAX', 'MIN') && nt && isOp(nt, '(')) {
        const c = matchParen(toks, nx);
        if (c > 0 && splitCommas(toks, nx + 1, c).length > 1) add(`${t.upper}(a, b) with several arguments is SQLite. In MySQL use ${t.upper === 'MAX' ? 'GREATEST' : 'LEAST'}(a, b).`);
      }
      if (isWord(t, 'IN') && nt && isOp(nt, '(') && isWord(toks[nextSig(toks, nx)], 'SELECT')) {
        const c = matchParen(toks, nx);
        if (findTopWord(toks, nx + 1, c, 'LIMIT') >= 0) add("MySQL rejects LIMIT inside an IN (…) subquery (error 1235). Wrap it: IN (SELECT x FROM (SELECT … LIMIT n) t).");
      }
      if (isWord(t, 'LIMIT', 'OFFSET')) {
        let j = nx, bad = false;
        while (j >= 0 && toks[j] && !isOp(toks[j], ';') && !isOp(toks[j], ')') && !(toks[j].type === 'word' && ['UNION', 'FOR', 'LOCK', 'INTO', 'OFFSET'].includes(toks[j].upper))) {
          if (!(toks[j].type === 'num' || isOp(toks[j], ','))) { bad = true; break; }
          j = nextSig(toks, j);
        }
        if (bad) add('MySQL only accepts plain numbers in LIMIT/OFFSET (no expressions). Compute the value first, or use ROW_NUMBER().');
      }
      if (t.type === 'dstr' && /^"[A-Za-z_][\w]*"$/.test(t.text) && !isWord(toks[prevSig(toks, k)], 'AS')) {
        const inner = t.text.slice(1, -1).toLowerCase();
        if (columns.has(inner)) add(`In MySQL "${t.text.slice(1, -1)}" is a string, not a column. Use backticks for names: \`${t.text.slice(1, -1)}\`.`);
      }
      // aliases used in WHERE
      if (isWord(t, 'SELECT')) {
        groupByCheck(toks, k, tables, add);
        const info = selectInfo(toks, k);
        const listEnd = Math.min(...['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW'].map((c) => info.clauses[c] ?? info.end));
        const aliases = new Map();
        let start = k + 1;
        for (;;) {
          const n = nextSig(toks, start - 1);
          if (n >= 0 && n < listEnd && toks[n].type === 'word' && SELECT_MODS.has(toks[n].upper)) start = n + 1; else break;
        }
        for (const [a, b] of splitCommas(toks, start, listEnd)) {
          const sig = [];
          for (let j = a; j < b; j++) if (isSig(toks[j])) sig.push(j);
          if (sig.length >= 2 && hasAlias(toks, sig)) {
            const al = bare(toks[sig[sig.length - 1]].text);
            const exprLast = toks[sig[sig.length - (isWord(toks[sig[sig.length - 2]], 'AS') ? 3 : 2)]];
            if (!columns.has(al.toLowerCase()) && !(exprLast && bare(exprLast.text).toLowerCase() === al.toLowerCase())) aliases.set(al.toLowerCase(), al);
          }
        }
        const wIdx = info.clauses.WHERE;
        if (wIdx !== undefined && aliases.size) {
          const wEnd = Math.min(...['GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW'].map((c) => info.clauses[c] ?? info.end));
          let depth = 0;
          for (let j = wIdx + 1; j < wEnd; j++) {
            const x = toks[j];
            if (isOp(x, '(')) depth++;
            else if (isOp(x, ')')) depth--;
            if (depth !== 0) continue;
            if ((x.type === 'word' || x.type === 'bq') && aliases.has(bare(x.text).toLowerCase())) {
              const p = prevSig(toks, j), n2 = nextSig(toks, j);
              if (!isOp(toks[p], '.') && !isOp(toks[n2], '(') && !isOp(toks[n2], '.')) {
                const al = aliases.get(bare(x.text).toLowerCase());
                add(`\`${al}\` is a SELECT alias. MySQL rejects it in WHERE (Unknown column '${al}' in 'where clause') because WHERE runs before SELECT. Repeat the expression, or filter in an outer query / HAVING.`);
              }
            }
          }
        }
      }
    }
    // error 1093: a DELETE/UPDATE whose subquery selects from the target table (checked per statement)
    const bounds = [];
    {
      let depth = 0, st = 0;
      toks.forEach((t, i) => {
        if (isOp(t, '(')) depth++;
        else if (isOp(t, ')')) depth--;
        else if (depth === 0 && isOp(t, ';')) { bounds.push([st, i]); st = i + 1; }
      });
      bounds.push([st, toks.length]);
    }
    for (const [s0, s1] of bounds) {
      const w = [];
      for (let i = s0; i < s1 && w.length < 3; i++) if (isSig(toks[i])) w.push(toks[i]);
      let target = null;
      if (isWord(w[0], 'DELETE') && isWord(w[1], 'FROM') && w[2]) target = bare(w[2].text).toLowerCase();
      if (isWord(w[0], 'UPDATE') && w[1] && !isWord(w[1], 'LOW_PRIORITY', 'IGNORE')) target = bare(w[1].text).toLowerCase();
      if (!target) continue;
      for (let k = s0; k < s1; k++) {
        if (!isWord(toks[k], 'SELECT')) continue;
        // only subqueries: find the enclosing '(' within this statement; skip derived tables (FROM ( … ) / JOIN ( … ))
        let depth = 0, open = -1;
        for (let j = k - 1; j >= s0; j--) {
          if (isOp(toks[j], ')')) depth++;
          else if (isOp(toks[j], '(')) { if (depth === 0) { open = j; break; } depth--; }
        }
        if (open < 0) continue;
        let derived = false;
        for (let j = k - 1, d = 0; j >= s0; j--) {
          if (isOp(toks[j], ')')) d++;
          else if (isOp(toks[j], '(')) {
            if (d === 0) { if (isWord(toks[prevSig(toks, j)], 'FROM', 'JOIN')) { derived = true; break; } } else d--;
          }
        }
        if (derived) continue;
        const info = selectInfo(toks, k);
        const fromIdx = info.clauses.FROM;
        if (fromIdx === undefined) continue;
        const fEnd = Math.min(...['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW'].map((c) => info.clauses[c] ?? info.end));
        const refs = tableRefs(toks, fromIdx + 1, fEnd);
        if (refs.some((r) => r.table && bare(r.table).toLowerCase() === target)) {
          add(`MySQL rejects this with error 1093: you can't select from '${target}' in a subquery while deleting/updating it. Wrap the subquery in a derived table: … IN (SELECT id FROM (SELECT … FROM ${target} …) AS t).`);
          break;
        }
      }
    }
    return warnings;
  }

  // ======================================================================
  // 6. friendly errors
  // ======================================================================
  const FOREIGN_FUNCS = {
    DATE_TRUNC: "PostgreSQL. In MySQL use DATE_FORMAT(d, '%Y-%m-01') for months, or DATE(d) for days.",
    TO_CHAR: 'PostgreSQL/Oracle. In MySQL use DATE_FORMAT(d, format) or FORMAT(n, decimals).',
    TO_DATE: "Oracle/PostgreSQL. In MySQL use STR_TO_DATE(s, '%Y-%m-%d').",
    DATEADD: 'SQL Server. In MySQL use DATE_ADD(d, INTERVAL n DAY).',
    DATEPART: 'SQL Server. In MySQL use YEAR(d), MONTH(d), DAY(d) or EXTRACT(unit FROM d).',
    GETDATE: 'SQL Server. In MySQL use NOW() or CURDATE().',
    LEN: 'SQL Server. In MySQL use CHAR_LENGTH(s).',
    CHARINDEX: 'SQL Server. In MySQL use LOCATE(sub, s) or INSTR(s, sub).',
    NVL: 'Oracle. In MySQL use IFNULL(x, fallback) or COALESCE().',
    AGE: 'PostgreSQL. In MySQL use TIMESTAMPDIFF(YEAR, birth, CURDATE()).',
    GENERATE_SERIES: 'PostgreSQL. In MySQL build a series with a recursive CTE.',
    ARRAY_AGG: 'PostgreSQL. In MySQL use GROUP_CONCAT() or JSON_ARRAYAGG().',
    SPLIT_PART: 'PostgreSQL. In MySQL use SUBSTRING_INDEX(s, delim, n).',
    INITCAP: "PostgreSQL. In MySQL combine UPPER(LEFT(s,1)) and LOWER(SUBSTRING(s,2)).",
    STRPOS: 'PostgreSQL. In MySQL use LOCATE(sub, s).',
    MYSQL_ISNULL: 'In MySQL ISNULL(x) takes one argument and returns 1/0. For a fallback value use IFNULL(x, fallback).',
  };
  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }
  function closest(name, candidates) {
    let best = null, bestD = Infinity;
    for (const c of candidates) {
      const d = levenshtein(name.toLowerCase(), c.toLowerCase());
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
  }

  function translateError(message, info) {
    const msg = String(message || '');
    const schema = (info && info.schema) || {};
    const allCols = Object.values(schema).flat();
    const tables = Object.keys(schema);
    let m;
    if ((m = /no such function: (\w+)/i.exec(msg))) {
      const name = m[1].toUpperCase();
      return { message: `FUNCTION ${name} does not exist`, hint: FOREIGN_FUNCS[name] ? `${name} is ${FOREIGN_FUNCS[name]}` : 'This page supports the MySQL functions LeetCode problems use — see Cheat sheet › Functions.' };
    }
    if ((m = /wrong number of arguments to function (\w+)/i.exec(msg)) || (m = /Incorrect parameter count in the call to native function '(\w+)'/i.exec(msg))) {
      const name = m[1].toUpperCase();
      return { message: `Incorrect parameter count in the call to native function '${name}'`, hint: FOREIGN_FUNCS[name] || `Check the arguments of ${name}().` };
    }
    if ((m = /no such column: (\S+)/i.exec(msg))) {
      const col = m[1].replace(/^\w+\./, '');
      const guess = closest(col, allCols);
      return { message: `Unknown column '${m[1]}'`, hint: guess ? `Did you mean \`${guess}\`?` : 'Check the spelling and which table the column belongs to (see the schema above).' };
    }
    if ((m = /no such table: (\S+)/i.exec(msg))) {
      const guess = closest(m[1].replace(/^main\./, ''), tables);
      return { message: `Table '${m[1]}' doesn't exist`, hint: guess ? `Did you mean \`${guess}\`?` : tables.length ? `Tables here: ${tables.join(', ')}.` : 'Create it first.' };
    }
    if ((m = /ambiguous column name: (\S+)/i.exec(msg))) {
      return { message: `Column '${m[1]}' is ambiguous`, hint: `More than one table has \`${m[1]}\`. Prefix it with a table alias, e.g. \`e.${m[1]}\`.` };
    }
    if ((m = /BIGINT UNSIGNED value is out of range in '(.*)'/i.exec(msg))) {
      return { message: `BIGINT UNSIGNED value is out of range in '${m[1]}'`, hint: "MySQL error 1690: ROW_NUMBER(), RANK(), DENSE_RANK() and NTILE() return BIGINT UNSIGNED, so arithmetic with them can't go below zero. Subtract the other way round (id - ROW_NUMBER() …), or wrap the call: CAST(ROW_NUMBER() OVER (…) AS SIGNED)." };
    }
    if (/misuse of window function/i.test(msg)) {
      return { message: msg, hint: "Window functions can't go in WHERE, GROUP BY or HAVING — they're computed after those clauses. Compute the window value in a subquery or CTE, then filter it in the outer query." };
    }
    if (/misuse of aggregate/i.test(msg)) {
      return { message: 'Invalid use of group function', hint: "Aggregates like SUM/COUNT can't be used in WHERE (it filters rows before grouping). Use HAVING, or aggregate in a subquery." };
    }
    if (/aggregate functions are not allowed in the GROUP BY clause/i.test(msg)) {
      return { message: "Can't group on an aggregate", hint: 'GROUP BY the raw columns; put aggregates in SELECT or HAVING.' };
    }
    if (/do not have the same number of result columns/i.test(msg)) {
      return { message: 'The used SELECT statements have a different number of columns', hint: 'Every SELECT in a UNION / INTERSECT / EXCEPT must return the same number of columns (MySQL error 1222).' };
    }
    if ((m = /sub-select returns (\d+) columns - expected 1/i.exec(msg))) {
      return { message: 'Operand should contain 1 column(s)', hint: `The subquery returns ${m[1]} columns where one value is expected. Select a single column, or compare a row: (a, b) IN (SELECT a, b …).` };
    }
    if (/row value misused/i.test(msg)) return { message: 'Operand should contain 1 column(s)', hint: 'A (a, b) row value can only be compared with another row value or used with IN (SELECT a, b …).' };
    if (/UNIQUE constraint failed: (\S+)/i.test(msg)) return { message: `Duplicate entry for key '${/UNIQUE constraint failed: (\S+)/i.exec(msg)[1]}'`, hint: 'MySQL error 1062: a row with that key already exists. Use INSERT IGNORE or ON DUPLICATE KEY UPDATE to handle it.' };
    if (/NOT NULL constraint failed: (\S+)/i.test(msg)) return { message: `Column '${/NOT NULL constraint failed: (\S+)/i.exec(msg)[1]}' cannot be null`, hint: 'MySQL error 1048: this column is declared NOT NULL.' };
    if (/CHECK constraint failed/i.test(msg)) return { message: 'Check constraint is violated', hint: 'MySQL error 3819: the value breaks a CHECK (or ENUM) rule on this table.' };
    if (/FOREIGN KEY constraint failed/i.test(msg)) return { message: 'Cannot add or update a child row: a foreign key constraint fails', hint: 'MySQL error 1452: the referenced parent row must exist first.' };
    if (/ORDER BY term does not match any column in the result set/i.test(msg)) {
      return { message: msg, hint: 'After UNION, ORDER BY can only use output column names (or positions) of the combined result.' };
    }
    if (/incomplete input/i.test(msg)) return { message: 'Unexpected end of query', hint: 'Something is left open — check for a missing closing parenthesis, quote, or END.' };
    if ((m = /near "([^"]*)": syntax error/i.exec(msg))) {
      const near = m[1];
      const hints = {
        ILIKE: "ILIKE is PostgreSQL. MySQL's LIKE is already case-insensitive.",
        TOP: 'TOP is SQL Server. In MySQL put LIMIT n at the end.',
        FETCH: 'Use LIMIT n (and OFFSET m) in MySQL.',
        QUALIFY: "QUALIFY isn't MySQL. Compute the window function in a subquery/CTE and filter in the outer query.",
        LATERAL: "LATERAL joins aren't supported by this engine.",
        ROLLUP: "WITH ROLLUP isn't supported by this engine.",
        MERGE: "MERGE isn't MySQL. Use INSERT … ON DUPLICATE KEY UPDATE.",
        RETURNING: "MySQL doesn't support RETURNING.",
      };
      const key = near.toUpperCase();
      if (hints[key]) return { message: `You have an error in your SQL syntax near '${near}'`, hint: hints[key] };
      if (/^(WHERE|GROUP|ORDER|HAVING|LIMIT)$/i.test(near)) return { message: `You have an error in your SQL syntax near '${near}'`, hint: `Check the clause order: SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT. Also look for a trailing comma before ${near.toUpperCase()}.` };
      if (near === ')') return { message: `You have an error in your SQL syntax near ')'`, hint: 'Look for a trailing comma or a missing expression before the closing parenthesis.' };
      if (near === ',') return { message: `You have an error in your SQL syntax near ','`, hint: 'Look for a doubled comma, or a comma right after SELECT.' };
      return { message: `You have an error in your SQL syntax near '${near}'`, hint: 'Check commas, parentheses, quotes and keyword spelling around that spot.' };
    }
    if (/unsafe use of/i.test(msg)) return { message: msg, hint: 'Functions from the MySQL layer can’t be used inside views or table definitions here. Use them in queries instead.' };
    return { message: msg, hint: '' };
  }

  // ======================================================================
  // 7. stored function harness (LeetCode 177)
  // ======================================================================
  function parseFunction(src) {
    const cleaned = src.replace(/^\s*DELIMITER\s+\S+\s*$/gim, '').replace(/\$\$|\/\/\s*$/gm, '');
    const toks = tokM(cleaned);
    const c = toks.findIndex((t, i) => isWord(t, 'CREATE') && isWord(toks[nextSig(toks, i)], 'FUNCTION'));
    if (c < 0) throw new CompatError('Keep the CREATE FUNCTION wrapper.', 'This problem is graded by calling your function, e.g. getNthHighestSalary(2). Put your query inside RETURN ( … ).');
    const nameIdx = nextSig(toks, nextSig(toks, c));
    const name = bare(toks[nameIdx].text);
    const po = nextSig(toks, nameIdx);
    const pc = matchParen(toks, po);
    const params = splitCommas(toks, po + 1, pc).map(([a, b]) => {
      const f = nextSig(toks, a - 1);
      return f >= 0 && f < b ? bare(toks[f].text) : null;
    }).filter(Boolean);
    let bodyStart = findTopWord(toks, pc + 1, toks.length, 'BEGIN');
    let bodyEnd;
    if (bodyStart >= 0) {
      bodyEnd = lastTopWord(toks, bodyStart, toks.length, 'END');
      if (bodyEnd < 0) throw new CompatError('The function body has BEGIN but no END.');
      bodyStart += 1;
    } else {
      bodyStart = findTopWord(toks, pc + 1, toks.length, 'RETURN');
      if (bodyStart < 0) throw new CompatError('The function needs a RETURN.');
      bodyEnd = toks.length;
    }
    return { name, params, body: toks.slice(bodyStart, bodyEnd) };
  }

  // Split body tokens into statements; IF … END IF blocks are kept as nested lists.
  function parseBlock(toks, i, stopWords) {
    const stmts = [];
    let cur = [];
    while (i < toks.length) {
      const t = toks[i];
      const firstOfStmt = !cur.some(isSig);
      if (firstOfStmt && t.type === 'word' && stopWords.includes(t.upper)) {
        if (t.upper !== 'END' || isWord(toks[nextSig(toks, i)], 'IF')) break;
      }
      if (firstOfStmt && isWord(t, 'IF') && !isOp(toks[nextSig(toks, i)], '(')) {
        const node = { type: 'if', branches: [], elseBody: null };
        let j = i + 1;
        for (;;) {
          const thenIdx = findTopWord(toks, j, toks.length, 'THEN');
          if (thenIdx < 0) throw new CompatError('IF needs THEN.');
          const cond = toks.slice(j, thenIdx);
          const r = parseBlock(toks, thenIdx + 1, ['ELSEIF', 'ELSE', 'END']);
          node.branches.push({ cond, body: r.stmts });
          j = r.next;
          if (isWord(toks[j], 'ELSEIF')) { j++; continue; }
          if (isWord(toks[j], 'ELSE')) {
            const r2 = parseBlock(toks, j + 1, ['END']);
            node.elseBody = r2.stmts;
            j = r2.next;
          }
          break;
        }
        // END IF ;
        j = nextSig(toks, nextSig(toks, j - 1));
        j = nextSig(toks, j);
        if (isOp(toks[j], ';')) j++;
        stmts.push(node);
        i = j;
        continue;
      }
      if (isOp(t, ';')) {
        if (cur.some(isSig)) stmts.push({ type: 'stmt', toks: cur });
        cur = [];
        i++;
        continue;
      }
      cur.push(t);
      i++;
    }
    if (cur.some(isSig)) stmts.push({ type: 'stmt', toks: cur });
    return { stmts, next: i };
  }

  root.SQLCompat = {
    rewrite, lint, translateError, parseFunction, parseBlock, normalizeLiterals, CompatError, splitStatements,
    _internals: { rx, statementLevel, preserveAliases, tableRefs },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
