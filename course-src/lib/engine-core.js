// Runs MySQL-flavoured SQL on sql.js: rewrite -> execute -> normalised results.
// Shared by the build (Node) and the page. Plain script: attaches `SQLEngine` to globalThis.
(function (root) {
  'use strict';
  const C = root.SQLCompat;
  const F = root.MySQLFunctions;
  const T = root.SQLTok;
  const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

  // Real numbers are rounded to 15 significant digits so 0.1 + 0.2 shows (and compares) as 0.3.
  function normValue(v) {
    if (typeof v === 'number' && !Number.isInteger(v)) return +v.toPrecision(15);
    if (v instanceof Uint8Array) return '0x' + Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return v;
  }

  function explainTree(rows) {
    const depth = new Map();
    const lines = rows.map(([id, parent, , detail]) => {
      const d = parent === 0 || !depth.has(parent) ? 0 : depth.get(parent) + 1;
      depth.set(id, d);
      return ['  '.repeat(d) + detail];
    });
    return { columns: ['QUERY PLAN'], rows: lines, explain: true };
  }

  function createEngine(SQL) {
    function open(setupSql) {
      const db = new SQL.Database();
      F.register(db);
      db.exec('PRAGMA foreign_keys = ON;');
      if (setupSql) db.exec(C.rewrite(setupSql).sql);
      return db;
    }

    // Reopen a database from db.export() bytes (much faster than replaying the setup SQL).
    function openBytes(bytes) {
      const db = new SQL.Database(bytes);
      F.register(db);
      db.exec('PRAGMA foreign_keys = ON;');
      return db;
    }

    function schema(db) {
      const out = {};
      const r = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      if (!r.length) return out;
      for (const [name] of r[0].values) {
        const cols = db.exec(`SELECT name FROM pragma_table_info('${String(name).replace(/'/g, "''")}')`);
        out[name] = cols.length ? cols[0].values.map((v) => v[0]) : [];
      }
      return out;
    }

    // { table: { cols: [...], pk: [...] } } (lower-case), for the MySQL lint
    function tableInfo(db) {
      const out = {};
      const r = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'");
      if (!r.length) return out;
      for (const [name] of r[0].values) {
        const info = db.exec(`SELECT name, pk, type FROM pragma_table_info('${String(name).replace(/'/g, "''")}')`);
        const rows = info.length ? info[0].values : [];
        out[String(name).toLowerCase()] = {
          cols: rows.map((v) => String(v[0]).toLowerCase()),
          pk: rows.filter((v) => v[1] > 0).map((v) => String(v[0]).toLowerCase()),
          types: rows.map((v) => String(v[2] || '').toUpperCase()),
        };
      }
      return out;
    }

    function run(db, sql) {
      const t0 = now();
      const res = { results: [], last: null, warnings: [], notes: [], error: null, rewritten: '', ms: 0 };
      let sch = {};
      try { sch = schema(db); } catch (e) { /* schema is only used for hints */ }
      let tinfo = {};
      try { tinfo = tableInfo(db); } catch (e) { /* lint is best-effort */ }
      const columns = new Set(Object.values(tinfo).flatMap((t) => t.cols));
      try { res.warnings = C.lint(sql, { columns, tables: tinfo }); } catch (e) { /* lint is best-effort */ }
      // column names that hold dates/times in every table that has them (for MySQL date arithmetic)
      const dateCols = new Set(), otherCols = new Set();
      for (const t of Object.values(tinfo)) {
        t.cols.forEach((c, i) => (/^(DATE|DATETIME|TIMESTAMP|TIME)\b/.test(t.types[i]) ? dateCols : otherCols).add(c));
      }
      for (const c of otherCols) dateCols.delete(c);
      let rw;
      try {
        rw = C.rewrite(sql, { dateCols });
      } catch (e) {
        if (!e.compat) throw e;
        res.error = { message: e.message, hint: e.hint };
        res.ms = now() - t0;
        return res;
      }
      res.rewritten = rw.sql;
      res.notes = rw.notes;
      try {
        for (const stmt of db.iterateStatements(rw.sql)) {
          const cols = stmt.getColumnNames();
          const text = stmt.getSQL();
          const rows = [];
          while (stmt.step()) rows.push(stmt.get().map(normValue));
          if (cols.length) {
            res.results.push(/^\s*EXPLAIN\s+QUERY\s+PLAN/i.test(text) ? explainTree(rows) : { columns: cols, rows });
          } else {
            const dml = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(text);
            res.results.push({ columns: [], rows: [], statement: text.trim().split(/\s+/)[0].toUpperCase(), changes: dml ? db.getRowsModified() : null });
          }
        }
      } catch (e) {
        res.error = C.translateError(e.message, { schema: sch });
        res.error.raw = e.message;
      }
      for (let i = res.results.length - 1; i >= 0; i--) {
        if (res.results[i].columns.length) { res.last = res.results[i]; break; }
      }
      res.ms = now() - t0;
      return res;
    }

    // LeetCode 177: interpret CREATE FUNCTION … BEGIN DECLARE/SET/IF/RETURN … END, then call it.
    function callFunction(db, sql, fnName, args) {
      const t0 = now();
      const res = { results: [], last: null, warnings: [], notes: [], error: null, ms: 0 };
      const fail = (e) => {
        res.error = { message: e.message, hint: e.hint || '' };
        res.ms = now() - t0;
        return res;
      };
      let fn;
      try { fn = C.parseFunction(sql); } catch (e) { if (!e.compat) throw e; return fail(e); }
      if (fn.name.toLowerCase() !== fnName.toLowerCase()) {
        return fail({ message: `Keep the function name ${fnName}`, hint: `The checker calls ${fnName}(N).` });
      }
      const vars = new Map();
      fn.params.forEach((p, i) => vars.set(p.toLowerCase(), args[i] === undefined ? null : args[i]));
      const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
      const subst = (toks) => toks.map((t, i) => {
        if (t.type === 'word' && vars.has(t.text.toLowerCase())) {
          const p = T.prevSig(toks, i);
          if (!(p >= 0 && T.isOp(toks[p], '.'))) return lit(vars.get(t.text.toLowerCase()));
        }
        return t.text;
      }).join('');
      const evalToks = (toks) => {
        const r = run(db, 'SELECT (' + subst(toks) + ')');
        res.warnings.push(...r.warnings.filter((w) => !res.warnings.includes(w) && !/LIMIT\/OFFSET/.test(w)));
        if (r.error) throw Object.assign(new Error(r.error.message), { hint: r.error.hint });
        return r.last.rows[0][0];
      };
      const truthy = (v) => v !== null && F.toNum(v) !== 0;
      const checkLimit = (toks) => {
        for (let i = 0; i < toks.length; i++) {
          if (!T.isWord(toks[i], 'LIMIT', 'OFFSET')) continue;
          for (let j = T.nextSig(toks, i); j >= 0; j = T.nextSig(toks, j)) {
            const t = toks[j];
            if (T.isOp(t, ',') || t.type === 'num' || (t.type === 'word' && vars.has(t.text.toLowerCase()))) continue;
            if (T.isOp(t, ')') || T.isOp(t, ';') || T.isWord(t, 'OFFSET', 'UNION')) break;
            throw Object.assign(new Error("MySQL doesn't allow expressions in LIMIT/OFFSET, even inside a function"),
              { hint: 'Compute the value first — e.g. SET N = N - 1; then … LIMIT 1 OFFSET N.' });
          }
        }
      };
      let returned;
      let done = false;
      const exec = (stmts) => {
        for (const s of stmts) {
          if (done) return;
          if (s.type === 'if') {
            let ran = false;
            for (const br of s.branches) {
              if (truthy(evalToks(br.cond))) { exec(br.body); ran = true; break; }
            }
            if (!ran && s.elseBody) exec(s.elseBody);
            continue;
          }
          const toks = s.toks;
          const f = T.nextSig(toks, -1);
          const U = toks[f].upper;
          const rest = toks.slice(f + 1);
          if (U === 'DECLARE') {
            const parts = T.splitCommas(rest, 0, rest.length);
            const lastPart = rest.slice(parts[parts.length - 1][0], parts[parts.length - 1][1]);
            const defIdx = lastPart.findIndex((t) => T.isWord(t, 'DEFAULT'));
            const value = defIdx >= 0 ? evalToks(lastPart.slice(defIdx + 1)) : null;
            for (const [a, b] of parts) {
              const nameTok = rest.slice(a, b).find(T.isSig);
              if (nameTok) vars.set(nameTok.text.toLowerCase(), value);
            }
          } else if (U === 'SET') {
            for (const [a, b] of T.splitCommas(rest, 0, rest.length)) {
              const part = rest.slice(a, b);
              const eq = part.findIndex((t) => T.isOp(t, '=') || T.isOp(t, ':='));
              if (eq < 0) throw Object.assign(new Error('SET needs name = value'), { hint: '' });
              const nameTok = part.slice(0, eq).find(T.isSig);
              vars.set(nameTok.text.toLowerCase(), evalToks(part.slice(eq + 1)));
            }
          } else if (U === 'RETURN') {
            checkLimit(rest);
            returned = evalToks(rest);
            done = true;
          } else {
            throw Object.assign(new Error(`${U} isn't supported inside functions here`), { hint: 'Use DECLARE, SET, IF … THEN … END IF and RETURN.' });
          }
        }
      };
      try {
        const block = C.parseBlock(fn.body, 0, []);
        exec(block.stmts);
      } catch (e) {
        if (!('hint' in e) && !e.compat) throw e;
        return fail(e);
      }
      if (!done) return fail({ message: 'The function ended without RETURN', hint: 'Every path must RETURN a value.' });
      res.last = { columns: [`${fnName}(${args.join(', ')})`], rows: [[normValue(returned === undefined ? null : returned)]] };
      res.results.push(res.last);
      res.ms = now() - t0;
      return res;
    }

    return { open, openBytes, run, callFunction, schema, SQL };
  }

  root.SQLEngine = { createEngine, normValue };
})(typeof globalThis !== 'undefined' ? globalThis : window);
