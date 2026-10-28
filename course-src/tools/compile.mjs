// Compiles lessons + problems into build/course.json, executing and verifying everything.
//   node tools/compile.mjs            compile + verify (exit 1 on any problem)
//   node tools/compile.mjs --only 175 compile, but verify only the listed problems/modules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { engine, SQLTok } from '../lib/engine-node.mjs';
import '../lib/checker.js';
import { loadProblem } from './leetcode.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTENT = path.join(ROOT, 'content');
const { compare } = globalThis.ResultCheck;
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? new Set(process.argv.slice(i + 1).join(',').split(',').filter(Boolean)) : null;
})();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAMPLE_DB = fs.readFileSync(path.join(CONTENT, 'sample-db.sql'), 'utf8');

// ---------------------------------------------------------------- problems
async function loadProblems() {
  const dir = path.join(CONTENT, 'problems');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort() : [];
  const list = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href + '?t=' + Date.now());
    for (const p of mod.default) list.push({ ...p, file: f });
  }
  return list;
}

function parseSchema(ddl) {
  // [{ name, columns: [{ name, type, pk }] }] from our MySQL DDL (display only)
  const tables = [];
  for (const stmt of ddl.split(';')) {
    const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*)\)\s*$/i.exec(stmt.trim());
    if (!m) continue;
    const toks = SQLTok.tokenize(m[2]);
    const cols = [];
    let pkCols = [];
    for (const [a, b] of SQLTok.splitCommas(toks, 0, toks.length)) {
      const part = SQLTok.text(toks, a, b).trim();
      const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part);
      if (pk) { pkCols = pk[1].split(',').map((s) => s.trim().replace(/[`"]/g, '')); continue; }
      if (/^(UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK)\b/i.test(part)) continue;
      const cm = /^[`"]?(\w+)[`"]?\s+(\w+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)([\s\S]*)$/i.exec(part);
      if (!cm) continue;
      cols.push({ name: cm[1], type: cm[2].replace(/\s+/g, ' ').toUpperCase().replace(/^(ENUM|SET)\((.*)\)$/i, (x, t, v) => `${t}(${v})`), pk: /PRIMARY\s+KEY/i.test(cm[3]) });
    }
    for (const c of cols) if (pkCols.includes(c.name)) c.pk = true;
    tables.push({ name: m[1], columns: cols });
  }
  return tables;
}

function tableDump(db, name) {
  const r = engine.run(db, `SELECT * FROM \`${name}\``);
  if (r.error) throw new Error(r.error.message);
  return r.last ? r.last.rows : [];
}

function execFor(p, setup, sql, args) {
  const db = engine.open(setup);
  try {
    let r;
    if (p.kind === 'function') r = engine.callFunction(db, sql, p.fn.name, args);
    else {
      r = engine.run(db, sql);
      if (!r.error && p.kind === 'dml') {
        const after = engine.run(db, p.after);
        if (after.error) throw new Error('after-query failed: ' + after.error.message);
        after.warnings = r.warnings;
        r = after;
      }
    }
    return r;
  } finally {
    db.close();
  }
}

function lcSetup(p, schemaTables, example) {
  // our DDL + LeetCode's example rows
  let sql = p.schema + '\n';
  const lit = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
  for (const [table, headers] of Object.entries(example.headers)) {
    const ours = schemaTables.find((t) => t.name.toLowerCase() === table.toLowerCase());
    if (!ours) throw new Error(`LeetCode table ${table} missing from our schema`);
    const ourCols = ours.columns.map((c) => c.name);
    for (const h of headers) if (!ourCols.includes(h)) throw new Error(`column ${table}.${h} missing (ours: ${ourCols.join(', ')})`);
    const types = headers.map((h) => (ours.columns.find((c) => c.name === h) || {}).type || '');
    const F = globalThis.MySQLFunctions;
    const fix = (v, i) => {
      if (typeof v !== 'string' || !/^(DATE|DATETIME|TIMESTAMP)/.test(types[i])) return v;
      const t = F.parseDT(v);
      return t ? F.fmtDT(t, /^(DATETIME|TIMESTAMP)/.test(types[i]) && t.hasTime) : v;
    };
    const rows = (example.rows[table] || []).map((r) => r.map(fix));
    if (rows.length) sql += `INSERT INTO ${ours.name} (${headers.join(', ')}) VALUES ${rows.map((r) => '(' + r.map(lit).join(', ') + ')').join(', ')};\n`;
  }
  return sql;
}

function renderMd(md) {
  return mdParser.parse(md);
}

function compileProblem(p) {
  const where = `#${p.id}`;
  const lc = loadProblem(p.id);
  if (!lc) { err(where, 'not in LeetCode cache'); return null; }
  if (lc.paidOnly) warn(where, 'premium problem');
  p.kind = p.kind || 'query';
  const schemaTables = parseSchema(p.schema);
  const datasets = [{ name: 'Example data', data: p.data, args: p.fn ? p.fn.args : undefined }, ...(p.tests || [])];
  const out = {
    id: p.id, title: lc.title, slug: lc.slug, difficulty: lc.difficulty, module: p.module, patterns: p.patterns || [],
    sql50: !!p.sql50, order: !!p.order, kind: p.kind,
    taskHtml: renderMd(p.task), notesHtml: p.notes ? renderMd(p.notes) : '',
    hints: (p.hints || []).map(renderMd),
    solution: { sql: p.solution.sql.trim(), html: renderMd(p.solution.explain || '') },
    alternatives: (p.alternatives || []).map((a) => ({ title: a.title, sql: a.sql.trim(), html: renderMd(a.explain || '') })),
    traps: (p.traps || []).map((t) => ({ sql: t.sql.trim(), html: renderMd(t.why) })),
    fn: p.fn || null, after: p.after || null, starter: p.starter || null,
    schema: schemaTables, datasets: [],
  };
  if (!p.hints || p.hints.length < 2) warn(where, 'fewer than 2 hints');
  const verify = !only || only.has(String(p.id)) || only.has(p.module);
  datasets.forEach((ds, i) => {
    const setup = p.schema + '\n' + (ds.data || '');
    const argsList = p.kind === 'function' ? (ds.argsList || [ds.args || p.fn.args]) : [undefined];
    const expectedList = [];
    for (const args of argsList) {
      const main = execFor(p, setup, p.solution.sql, args);
      if (main.error || !main.last) { err(where, `solution fails on "${ds.name}": ${main.error ? main.error.message + ' | ' + (main.error.raw || '') : 'no result'}`); return; }
      if (main.warnings.length) err(where, `solution triggers MySQL warnings: ${main.warnings.join(' / ')}`);
      expectedList.push({ args, expected: { columns: main.last.columns, rows: main.last.rows } });
      if (!verify) continue;
      for (const [ai, alt] of out.alternatives.entries()) {
        const r = execFor(p, setup, alt.sql, args);
        if (r.error) { err(where, `alternative ${ai + 1} errors on "${ds.name}": ${r.error.message}`); continue; }
        const c = compare(main.last, r.last, { ordered: p.order });
        if (!c.ok) err(where, `alternative ${ai + 1} disagrees on "${ds.name}": ${c.message} missing=${JSON.stringify(c.missing)} extra=${JSON.stringify(c.extra)}`);
        if (r.warnings.length) err(where, `alternative ${ai + 1} triggers MySQL warnings: ${r.warnings.join(' / ')}`);
      }
    }
    const db = engine.open(setup);
    const tables = schemaTables.map((t) => ({ name: t.name, rows: tableDump(db, t.name) }));
    db.close();
    out.datasets.push({ name: ds.name, setup, tables, runs: expectedList });
    if (i === 0 && tables.every((t) => t.rows.length === 0)) err(where, 'example data is empty');
  });
  if (verify) {
    // traps must fail somewhere
    for (const [ti, trap] of out.traps.entries()) {
      let caught = false;
      for (const ds of out.datasets) {
        for (const run of ds.runs) {
          const r = execFor(p, ds.setup, trap.sql, run.args);
          if (r.error || (r.warnings && r.warnings.length) || !compare(run.expected, r.last, { ordered: p.order }).ok) caught = true;
        }
      }
      if (!caught) err(where, `trap ${ti + 1} is not caught by any dataset: ${trap.sql.slice(0, 80)}`);
    }
    // LeetCode's own examples
    if (p.lcSkipExample) warn(where, `LeetCode example check skipped: ${p.lcSkipExample}`);
    if (!p.lcSkipExample) lc.examples.forEach((ex, i) => {
      const expected = lc.outputs[i];
      let setup;
      try { setup = lcSetup(p, schemaTables, ex); } catch (e) { err(where, `LeetCode example ${i + 1}: ${e.message}`); return; }
      const r = execFor(p, setup, p.solution.sql, ex.argument !== undefined ? [ex.argument] : p.fn ? p.fn.args : undefined);
      if (r.error) { err(where, `LeetCode example ${i + 1} errors: ${r.error.message}`); return; }
      const got = r.last;
      if (got.columns.join('|') !== expected.headers.join('|')) err(where, `LeetCode example ${i + 1}: columns ${got.columns.join(',')} vs LeetCode ${expected.headers.join(',')}`);
      const F = globalThis.MySQLFunctions;
      const normDate = (v) => {
        if (typeof v !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}( \d{1,2}:\d{1,2}(:\d{1,2})?)?$/.test(v)) return v;
        const t = F.parseDT(v);
        return t ? F.fmtDT(t) : v;
      };
      const lower = (rows) => rows.map((r) => r.map((v) => (p.lcIgnoreCase && typeof v === 'string' ? v.toLowerCase() : normDate(v))));
      const c = compare({ columns: expected.headers, rows: lower(expected.rows) }, { columns: got.columns, rows: lower(got.rows) }, { ordered: p.order });
      if (!c.ok) err(where, `LeetCode example ${i + 1} mismatch: ${c.message} missing=${JSON.stringify(c.missing)} extra=${JSON.stringify(c.extra)}`);
    });
    const firstRun = out.datasets[0] && out.datasets[0].runs[0];
    if (firstRun && firstRun.expected.rows.length === 0 && p.kind !== 'dml') warn(where, 'expected output on example data is empty');
  }
  return out;
}

// ---------------------------------------------------------------- lessons
let mdParser;
let exampleSink = null;
let problemIndex = {};

function makeParser() {
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      code({ text, lang }) {
        const info = (lang || '').trim().split(/\s+/);
        const kind = info[0];
        const opts = Object.fromEntries(info.slice(1).map((w) => { const [k, v] = w.split('='); return [k, v === undefined ? true : v]; }));
        if (kind === 'sql' && opts.run && exampleSink) {
          const ex = { id: `${exampleSink.module}-ex${exampleSink.examples.length + 1}`, sql: text.replace(/\s+$/, ''), db: opts.db || 'sample', expectError: !!opts.error, expectWarning: !!opts.warn, title: opts.title ? String(opts.title).replace(/_/g, ' ') : '' };
          exampleSink.examples.push(ex);
          return `<div class="example" data-ex="${ex.id}"></div>\n`;
        }
        if (kind === 'sql' && opts.setup && exampleSink) {
          const name = opts.name;
          exampleSink.dbs[name] = { base: opts.base || null, sql: text };
          return `<details class="setup"><summary>Data for these examples: <code>${esc(name)}</code></summary><pre class="code sql"><code>${SQLTok.highlight(text)}</code></pre></details>\n`;
        }
        if (kind === 'sql') return `<pre class="code sql"><code>${SQLTok.highlight(text.replace(/\s+$/, ''))}</code></pre>\n`;
        return `<pre class="code plain"><code>${esc(text.replace(/\s+$/, ''))}</code></pre>\n`;
      },
      table(token) {
        // keep tables scrollable on phones
        const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const body = token.rows.map((r) => '<tr>' + r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('') + '</tr>').join('');
        return `<div class="tablewrap"><table class="md"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  return m;
}

function inlineRefs(md, where) {
  return md.replace(/\[\[(p|m):([\w-]+)(?:\|([^\]]+))?\]\]/g, (all, kind, id, label) => {
    if (kind === 'p') {
      const p = problemIndex[id];
      if (!p) { err(where, `unknown problem ref ${id}`); return all; }
      return `<a class="pref" href="#p${id}"><span class="pnum">#${id}</span> ${esc(label || p.title)}</a>`;
    }
    return `<a class="mref" href="#${id}">${esc(label || id)}</a>`;
  });
}

function parseQuiz(body, where) {
  const qs = [];
  let cur = null;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('? ')) { cur = { q: line.slice(2), options: [], answer: -1, explain: '' }; qs.push(cur); continue; }
    if (!cur) continue;
    const opt = /^- \[( |x)\] (.*)$/.exec(line);
    if (opt) { if (opt[1] === 'x') cur.answer = cur.options.length; cur.options.push(opt[2]); continue; }
    if (line.startsWith('> ')) cur.explain += (cur.explain ? '\n' : '') + line.slice(2);
  }
  for (const q of qs) {
    if (q.answer < 0) err(where, `quiz question without a correct option: ${q.q}`);
    if (q.options.length < 2) err(where, `quiz question needs 2+ options: ${q.q}`);
    if (!q.explain) warn(where, `quiz question without explanation: ${q.q}`);
  }
  return qs.map((q) => ({ q: mdParser.parseInline(q.q), options: q.options.map((o) => mdParser.parseInline(o)), answer: q.answer, explain: mdParser.parse(q.explain) }));
}

function renderBlocks(md, ctx, where) {
  // :::kind title  …  ::: (nesting not supported); quiz blocks become data
  const lines = md.split('\n');
  const out = [];
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^:::(\w+)\s*(.*)$/.exec(lines[i]);
    if (!open) { out.push(lines[i]); continue; }
    const [, kind, title] = open;
    const body = [];
    i++;
    while (i < lines.length && lines[i].trim() !== ':::') body.push(lines[i++]);
    if (i >= lines.length) err(where, `unclosed :::${kind}`);
    let html;
    if (kind === 'quiz') {
      const id = `${ctx.module}-q${ctx.quizzes.length + 1}`;
      ctx.quizzes.push({ id, questions: parseQuiz(body.join('\n'), where) });
      html = `<div class="quiz" data-quiz="${id}"></div>`;
    } else {
      const label = { gotcha: 'Gotcha', tip: 'Tip', note: 'Note', dialect: 'Other databases', interview: 'Interview angle', work: 'On the job', key: 'Key idea' }[kind] || kind;
      html = `<aside class="callout ${kind}"><div class="callout-label">${esc(label)}${title ? ` <span>· ${mdParser.parseInline(title)}</span>` : ''}</div>${mdParser.parse(body.join('\n'))}</aside>`;
    }
    blocks.push(html);
    out.push('', `<!--BLOCK:${blocks.length - 1}-->`, '');
  }
  let html = mdParser.parse(out.join('\n'));
  html = html.replace(/<!--BLOCK:(\d+)-->/g, (m, n) => blocks[+n]);
  return html;
}

function parseFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: src.slice(m[0].length) };
}

function runExample(ex, dbs, where) {
  const setupOf = (name) => {
    if (name === 'sample') return SAMPLE_DB;
    if (name === 'empty') return '';
    const d = dbs[name];
    if (!d) { err(where, `unknown db ${name} in ${ex.id}`); return ''; }
    return (d.base ? setupOf(d.base) + '\n' : '') + d.sql;
  };
  const setup = setupOf(ex.db);
  const db = engine.open(setup);
  const r = engine.run(db, ex.sql);
  db.close();
  if (r.error && !ex.expectError) err(where, `example ${ex.id} fails: ${r.error.message} (${r.error.raw || ''})\n${ex.sql}`);
  if (!r.error && ex.expectError) err(where, `example ${ex.id} was expected to fail but ran`);
  const summary = r.results.filter((x) => !x.columns.length && x.changes !== null).map((x) => `${x.statement}: ${x.changes} row${x.changes === 1 ? '' : 's'} affected`);
  return {
    columns: r.last ? r.last.columns : [], rows: r.last ? r.last.rows.slice(0, 200) : [], total: r.last ? r.last.rows.length : 0,
    explain: !!(r.last && r.last.explain), error: r.error, warnings: r.warnings, notes: r.notes, summary,
  };
}

function compileModule(file, index) {
  const src = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontMatter(src);
  const id = meta.id;
  const where = `module ${id}`;
  const ctx = { module: id, examples: [], dbs: {}, quizzes: [] };
  exampleSink = ctx;
  const html = renderBlocks(inlineRefs(body, where), ctx, where);
  exampleSink = null;
  const dbSetups = {};
  const resolve = (name) => (name === 'sample' ? SAMPLE_DB : name === 'empty' ? '' : (ctx.dbs[name].base ? resolve(ctx.dbs[name].base) + '\n' : '') + ctx.dbs[name].sql);
  for (const name of Object.keys(ctx.dbs)) dbSetups[name] = resolve(name);
  for (const ex of ctx.examples) {
    ex.output = runExample(ex, ctx.dbs, where);
    if (ex.expectWarning && !ex.output.warnings.length) err(where, `${ex.id} was expected to raise a MySQL warning but did not`);
    if (!ex.expectWarning && ex.output.warnings.length) err(where, `${ex.id} raised warnings: ${ex.output.warnings.join(' / ')}`);
  }
  const words = body.replace(/```[\s\S]*?```/g, '').split(/\s+/).length;
  return {
    id, num: index, title: meta.title, summary: meta.summary || '', clauses: (meta.clauses || '').split(/\s*,\s*/).filter(Boolean),
    kicker: meta.kicker || '', minutes: Math.max(5, Math.round(words / 180) + ctx.examples.length), html,
    examples: ctx.examples, dbs: dbSetups, quizzes: ctx.quizzes, problems: [],
  };
}

// ---------------------------------------------------------------- main
async function main() {
  mdParser = makeParser();
  const problems = await loadProblems();
  const lcCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'catalog-all.json'), 'utf8'));
  for (const p of problems) {
    const c = lcCatalog.find((q) => Number(q.questionFrontendId) === p.id);
    problemIndex[p.id] = { title: c ? c.title : '?' };
  }
  const moduleFiles = fs.readdirSync(path.join(CONTENT, 'modules')).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const modules = moduleFiles.map((f, i) => compileModule(path.join(CONTENT, 'modules', f), i));
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  const seen = new Set();
  const outProblems = {};
  for (const p of problems) {
    if (seen.has(p.id)) err(`#${p.id}`, 'defined twice');
    seen.add(p.id);
    if (!byId[p.module]) err(`#${p.id}`, `unknown module ${p.module}`);
    const c = compileProblem(p);
    if (c) {
      outProblems[p.id] = c;
      if (byId[p.module]) byId[p.module].problems.push(p.id);
    }
  }
  // sample db description for the schema browser
  const sdb = engine.open(SAMPLE_DB);
  const sampleTables = parseSchema(SAMPLE_DB).map((t) => ({ ...t, count: tableDump(sdb, t.name).length }));
  const sqliteVersion = sdb.exec('SELECT sqlite_version()')[0].values[0][0];
  sdb.close();
  let extra = {};
  const extraFile = path.join(CONTENT, 'extra.mjs');
  if (fs.existsSync(extraFile)) extra = (await import(pathToFileURL(extraFile).href + '?t=' + Date.now())).default(mdParser, SQLTok);
  const course = {
    meta: { builtAt: new Date().toISOString(), sqliteVersion, problemCount: Object.keys(outProblems).length },
    sampleDb: { setup: SAMPLE_DB, tables: sampleTables },
    modules, problems: outProblems, ...extra,
  };
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'course.json'), JSON.stringify(course));
  const exCount = modules.reduce((n, m) => n + m.examples.length, 0);
  console.log(`modules ${modules.length}, examples ${exCount}, problems ${Object.keys(outProblems).length}, ` +
    `solutions+alternatives ${Object.values(outProblems).reduce((n, p) => n + 1 + p.alternatives.length, 0)}, traps ${Object.values(outProblems).reduce((n, p) => n + p.traps.length, 0)}`);
  for (const w of warnings) console.log('warn  ' + w);
  for (const e of errors) console.log('ERROR ' + e);
  console.log(errors.length ? `\n${errors.length} error(s)` : '\nall checks passed');
  process.exitCode = errors.length ? 1 : 0;
}

await main();
