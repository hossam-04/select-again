(function () {
  'use strict';

  const COURSE = JSON.parse(document.getElementById('course-data').textContent);
  const SQLJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/sql-asm.js';
  const STEPS = ['FROM', 'WHERE', 'GROUP BY', 'HAVING', 'SELECT', 'DISTINCT', 'ORDER BY', 'LIMIT'];
  const main = document.getElementById('main');
  const sidebar = document.getElementById('sidebar');
  const modules = COURSE.modules;
  const moduleById = Object.fromEntries(modules.map((m) => [m.id, m]));
  const problems = COURSE.problems;
  const problemOrder = modules.flatMap((m) => m.problems);
  const exampleById = {};
  const quizById = {};
  for (const m of modules) {
    for (const ex of m.examples) exampleById[ex.id] = { ex, module: m };
    for (const q of m.quizzes) quizById[q.id] = q;
  }
  const pad2 = (n) => String(n).padStart(2, '0');

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inlineCode = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const ICONS = {
    play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    alert: '<path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 18v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    circle: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>',
    half: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    done: '<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12.5l3 3 5-6" fill="none" stroke="var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    load: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const icon = (name, size) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'icon');
    s.setAttribute('aria-hidden', 'true');
    if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
    s.innerHTML = ICONS[name];
    return s;
  };

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function copyText(text, fallbackEl) {
    const ok = () => toast('Copied to clipboard');
    try {
      navigator.clipboard.writeText(text).then(ok, () => selectFallback(fallbackEl));
    } catch (e) {
      selectFallback(fallbackEl);
    }
  }
  function selectFallback(node) {
    if (!node) return;
    const r = document.createRange();
    r.selectNodeContents(node);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    toast('Selected — press Ctrl+C to copy');
  }

  // ------------------------------------------------------------------ storage (this browser only)
  const store = (() => {
    const KEY = 'select-again:v1';
    const P = window.ProgressCode;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage unavailable: progress lasts for this visit only */ }
    // quiz: quiz id -> { right, total, at } from the last time it was finished.
    const state = P.load(raw, { solved: {}, tried: {}, drafts: {}, done: {}, quiz: {}, last: '', play: '', playDb: 'sample' });
    let timer;
    const write = () => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    };
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(write, 250);
    };
    const saveNow = () => {
      clearTimeout(timer);
      write();
    };
    const known = { problems: new Set(Object.keys(problems)), modules: new Set(Object.keys(moduleById)), quizzes: new Set(Object.keys(quizById)) };
    const exportCode = () => P.encode(state);
    function importCode(text) {
      const r = P.decode(text);
      if (!r.ok) return r;
      const n = P.merge(state, r.data, known);
      saveNow();
      return { ok: true, message: P.summary(n) };
    }
    return { state, save, saveNow, exportCode, importCode };
  })();

  // ------------------------------------------------------------------ engine
  const Engine = (() => {
    let promise = null;
    let api = null;
    const cache = new Map();
    const pill = document.getElementById('engine-pill');
    function setPill(state, label, title) {
      pill.dataset.state = state;
      pill.querySelector('.label').textContent = label;
      if (title) pill.title = title;
    }
    function load() {
      if (promise) return promise;
      setPill('loading', 'Loading engine');
      promise = new Promise((resolve, reject) => {
        const init = () => {
          if (typeof window.initSqlJs !== 'function') { reject(new Error('sql.js missing')); return; }
          window.initSqlJs().then((SQL) => {
            api = window.SQLEngine.createEngine(SQL);
            setPill('ready', 'Engine ready', 'SQLite 3.49 with a MySQL compatibility layer, running inside this page');
            resolve(api);
          }, reject);
        };
        if (typeof window.initSqlJs === 'function') { init(); return; }
        const s = document.createElement('script');
        s.src = SQLJS_URL;
        s.async = true;
        s.onload = init;
        s.onerror = () => reject(new Error('network'));
        document.head.appendChild(s);
      }).catch((e) => {
        setPill('error', 'Engine offline', 'The SQL engine could not be loaded. Outputs shown were computed in advance.');
        promise = null;
        throw e;
      });
      return promise;
    }
    function fresh(setup) {
      let bytes = cache.get(setup);
      if (!bytes) {
        const db = api.open(setup);
        bytes = db.export();
        db.close();
        cache.set(setup, bytes);
      }
      return api.openBytes(bytes);
    }
    return { load, fresh, get api() { return api; } };
  })();

  const engineErrorBox = () => msgBox('error', 'The SQL engine could not load.',
    'It is a script from cdnjs.cloudflare.com — check your connection and reload. Everything shown on the page was computed in advance, so you can keep reading.');

  // ------------------------------------------------------------------ results
  function fmtVal(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    return String(v);
  }
  function renderGrid(res, opts) {
    opts = opts || {};
    const wrap = el('div', { class: 'result' + (opts.tall ? ' tall' : '') });
    const cols = res.columns || [];
    const rows = res.rows || [];
    const numeric = cols.map((c, i) => rows.some((r) => typeof r[i] === 'number') && rows.every((r) => r[i] === null || typeof r[i] === 'number'));
    const thead = el('thead', null, el('tr', null, cols.map((c, i) => el('th', { class: numeric[i] ? 'num' : null, scope: 'col' }, c))));
    const tbody = el('tbody');
    const limit = opts.limit || 500;
    rows.slice(0, limit).forEach((r, ri) => {
      const tr = el('tr', { class: opts.rowClass ? opts.rowClass(r, ri) : (res.explain ? 'plan' : null) });
      r.forEach((v, i) => {
        tr.append(v === null ? el('td', { class: numeric[i] ? 'num' : null }, el('span', { class: 'null' }, 'NULL')) : el('td', { class: numeric[i] ? 'num' : null }, fmtVal(v)));
      });
      tbody.append(tr);
    });
    wrap.append(el('table', { class: 'grid' }, thead, tbody));
    return wrap;
  }
  function resultFoot(n, ms, extra) {
    const txt = n === 0 ? 'Empty set' : `${n} row${n === 1 ? '' : 's'} in set`;
    return el('div', { class: 'result-foot' }, el('span', null, txt + (typeof ms === 'number' ? ` (${(ms / 1000).toFixed(3)} sec)` : '')), extra ? el('span', null, extra) : null);
  }
  function msgBox(kind, text, hint) {
    const ic = kind === 'error' ? 'x' : kind === 'warning' ? 'alert' : 'info';
    return el('div', { class: `out-msg ${kind}` }, icon(ic), el('div', null, el('span', { html: inlineCode(text) }), hint ? el('span', { class: 'hint', html: inlineCode(hint) }) : null));
  }
  function toOutput(r) {
    return {
      columns: r.last ? r.last.columns : [], rows: r.last ? r.last.rows : [], explain: !!(r.last && r.last.explain),
      error: r.error, warnings: r.warnings || [], notes: r.notes || [], ms: r.ms,
      summary: (r.results || []).filter((x) => !x.columns.length && x.changes !== null && x.changes !== undefined)
        .map((x) => `${x.statement} — Query OK, ${x.changes} row${x.changes === 1 ? '' : 's'} affected`),
    };
  }
  function renderOutput(host, o, opts) {
    opts = opts || {};
    host.replaceChildren();
    if (opts.caption) host.append(el('div', { class: 'out-msg note' }, icon('info'), el('div', { html: opts.caption })));
    if (o.error) host.append(msgBox('error', o.error.message, o.error.hint));
    for (const w of o.warnings || []) host.append(msgBox('warning', w));
    for (const n of o.notes || []) host.append(msgBox('note', n));
    for (const s of o.summary || []) host.append(el('div', { class: 'out-ok' }, s.replace(/^(\w+): (\d+) rows? affected$/, (m, st, n) => `${st} — Query OK, ${n} row${n === '1' ? '' : 's'} affected`)));
    if (o.columns && o.columns.length) {
      host.append(renderGrid(o, { tall: opts.tall }));
      const total = o.total !== undefined ? o.total : o.rows.length;
      host.append(resultFoot(total, o.ms, total > 500 ? 'showing the first 500' : null));
    } else if (!o.error && !(o.summary || []).length) {
      host.append(el('div', { class: 'out-ok' }, 'Query OK'));
    }
  }

  // ------------------------------------------------------------------ editor
  function makeEditor(host, value, opts) {
    opts = opts || {};
    const keys = {};
    const run = () => { if (opts.onRun) opts.onRun(); };
    const check = () => { if (opts.onCheck) opts.onCheck(); else run(); };
    if (window.CodeMirror) {
      keys['Ctrl-Enter'] = run; keys['Cmd-Enter'] = run;
      keys['Shift-Ctrl-Enter'] = check; keys['Shift-Cmd-Enter'] = check;
      keys.Tab = (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('  ', 'end'));
      keys['Shift-Tab'] = (cm) => cm.indentSelection('subtract');
      keys.Esc = (cm) => cm.getInputField().blur();
      const cm = window.CodeMirror(host, {
        value, mode: 'text/x-mysql', matchBrackets: true, autoCloseBrackets: true, indentUnit: 2, tabSize: 2,
        viewportMargin: Infinity, lineWrapping: true, scrollbarStyle: 'null', placeholder: opts.placeholder || '', extraKeys: keys,
        inputStyle: 'contenteditable', spellcheck: false,
      });
      cm.getInputField().setAttribute('aria-label', opts.label || 'SQL editor');
      if (opts.onChange) cm.on('change', () => opts.onChange(cm.getValue()));
      return {
        getValue: () => cm.getValue(), setValue: (v) => cm.setValue(v), focus: () => cm.focus(), refresh: () => cm.refresh(),
        insert: (t) => { cm.replaceSelection(t); cm.focus(); },
      };
    }
    const ta = el('textarea', { class: 'fallback', spellcheck: 'false', 'aria-label': opts.label || 'SQL editor' });
    ta.value = value;
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) check(); else run(); }
    });
    if (opts.onChange) ta.addEventListener('input', () => opts.onChange(ta.value));
    host.append(ta);
    return {
      getValue: () => ta.value, setValue: (v) => { ta.value = v; }, focus: () => ta.focus(), refresh() {},
      insert: (t) => { const s = ta.selectionStart; ta.setRangeText(t, s, ta.selectionEnd, 'end'); ta.focus(); },
    };
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const kbd = (combo) => el('span', { class: 'kbd' }, combo.replace('Mod', isMac ? '⌘' : 'Ctrl'));

  // ------------------------------------------------------------------ progress helpers
  const isSolved = (id) => !!store.state.solved[id];
  function moduleProgress(m) {
    const solved = m.problems.filter(isSolved).length;
    return { solved, total: m.problems.length };
  }
  function diffChip(d) {
    const level = { Easy: 1, Medium: 2, Hard: 3 }[d] || 1;
    return el('span', { class: 'chip diff', 'data-level': level, title: `${d} on LeetCode` }, el('span', { class: 'bars', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), d);
  }
  function statusIcon(id) {
    if (isSolved(id)) return el('span', { class: 'st solved', title: 'Solved' }, icon('done'), el('span', { class: 'sr' }, 'Solved'));
    if (store.state.tried[id]) return el('span', { class: 'st tried', title: 'Attempted' }, icon('half'), el('span', { class: 'sr' }, 'Attempted'));
    return el('span', { class: 'st', title: 'Not started' }, icon('circle'), el('span', { class: 'sr' }, 'Not started'));
  }

  // ------------------------------------------------------------------ sidebar
  let openModule = null;
  function renderSidebar(page) {
    const total = problemOrder.length;
    const solved = problemOrder.filter(isSolved).length;
    const doneMods = modules.filter((m) => store.state.done[m.id]).length;
    const activeModule = moduleById[page] ? page : /^p\d+$/.test(page) && problems[page.slice(1)] ? problems[page.slice(1)].module : null;
    openModule = activeModule;
    const frag = document.createDocumentFragment();
    frag.append(el('div', { class: 'side-progress' },
      el('div', { class: 'row' }, el('span', null, 'Problems solved'), el('b', null, `${solved} / ${total}`)),
      el('div', { class: 'meter', role: 'img', 'aria-label': `${solved} of ${total} problems solved` }, el('i', { style: `width:${total ? (100 * solved) / total : 0}%` })),
      el('div', { class: 'row' }, el('span', null, 'Modules finished'), el('b', null, `${doneMods} / ${modules.length}`)),
      el('div', { class: 'meter', role: 'img', 'aria-label': `${doneMods} of ${modules.length} modules finished` }, el('i', { style: `width:${(100 * doneMods) / modules.length}%` })),
    ));
    const links = el('nav', { class: 'side-block side-links', 'aria-label': 'Pages' },
      [['home', 'Home'], ['problems', 'All problems'], ['playground', 'Playground'], ['cheatsheet', 'Cheat sheet']].map(([id, label]) =>
        el('a', { href: `#${id}`, 'aria-current': page === id || (id === 'home' && !page) ? 'page' : null }, label)));
    frag.append(links);
    const list = el('nav', { class: 'side-block', 'aria-label': 'Modules' }, el('div', { class: 'side-label' }, 'Modules'));
    for (const m of modules) {
      const pr = moduleProgress(m);
      const done = !!store.state.done[m.id];
      list.append(el('a', { class: 'side-mod' + (done ? ' done' : ''), href: `#${m.id}`, 'aria-current': page === m.id ? 'page' : null },
        el('span', { class: 'num' }, pad2(m.num)), el('span', { class: 't' }, m.title),
        el('span', { class: 'state', title: done ? 'Finished' : `${pr.solved} of ${pr.total} problems solved` }, done ? '✓' : pr.total ? `${pr.solved}/${pr.total}` : '')));
      if (m.id === activeModule && m.problems.length) {
        list.append(el('div', { class: 'side-probs' }, m.problems.map((id) => el('a', { href: `#p${id}`, 'aria-current': page === `p${id}` ? 'page' : null },
          el('span', { class: 'pn' + (isSolved(id) ? ' ok' : '') }, (isSolved(id) ? '✓ ' : '') + id), el('span', null, problems[id].title)))));
      }
    }
    frag.append(list);
    sidebar.replaceChildren(frag);
    const cur = sidebar.querySelector('[aria-current="page"]');
    if (cur && cur.scrollIntoView && !isInView(cur, sidebar)) cur.scrollIntoView({ block: 'center' });
  }
  function isInView(node, container) {
    const a = node.getBoundingClientRect(), b = container.getBoundingClientRect();
    return a.top >= b.top && a.bottom <= b.bottom;
  }
  const menuBtn = document.getElementById('menu-btn');
  const scrim = document.getElementById('scrim');
  function setDrawer(open) {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false); });

  // ------------------------------------------------------------------ examples & quizzes
  function setupForExample(ex, m) {
    if (ex.db === 'sample') return COURSE.sampleDb.setup;
    if (ex.db === 'empty') return '';
    return m.dbs[ex.db] || '';
  }
  function hydrateExample(host) {
    const found = exampleById[host.dataset.ex];
    if (!found) return;
    const { ex, module: m } = found;
    const codeWrap = el('div', { class: 'ex-code' });
    const pre = el('pre', { class: 'code sql', title: 'Double-click to edit' }, el('code', { html: window.SQLTok.highlight(ex.sql) }));
    codeWrap.append(pre);
    const out = el('div', { class: 'out' });
    let editor = null;
    const runBtn = el('button', { class: 'btn primary small', type: 'button' }, icon('play', 14), 'Run');
    const editBtn = el('button', { class: 'btn small', type: 'button' }, 'Edit');
    const resetBtn = el('button', { class: 'btn ghost small', type: 'button', hidden: true }, icon('reset', 14), 'Reset');
    const dbLabel = ex.db === 'sample' ? 'sample shop database' : ex.db === 'empty' ? 'empty database' : `data: ${ex.db}`;
    const bar = el('div', { class: 'ex-bar' }, runBtn, editBtn, resetBtn, el('span', { class: 'spacer' }), el('span', { class: 'db' }, dbLabel));
    if (ex.title) host.append(el('div', { class: 'ex-title' }, ex.title));
    host.append(codeWrap, bar, out);
    renderOutput(out, ex.output);
    const edit = () => {
      if (editor) { editor.focus(); return; }
      pre.remove();
      editor = makeEditor(codeWrap, ex.sql, { onRun: run, label: 'Example SQL' });
      editBtn.hidden = true;
      resetBtn.hidden = false;
      editor.focus();
    };
    async function run() {
      runBtn.disabled = true;
      try {
        await Engine.load();
      } catch (e) {
        out.replaceChildren(engineErrorBox());
        runBtn.disabled = false;
        return;
      }
      const db = Engine.fresh(setupForExample(ex, m));
      const r = Engine.api.run(db, editor ? editor.getValue() : ex.sql);
      db.close();
      renderOutput(out, toOutput(r));
      runBtn.disabled = false;
    }
    runBtn.addEventListener('click', run);
    editBtn.addEventListener('click', edit);
    pre.addEventListener('dblclick', edit);
    resetBtn.addEventListener('click', () => { editor.setValue(ex.sql); renderOutput(out, ex.output); });
  }

  function hydrateQuiz(host) {
    const quiz = quizById[host.dataset.quiz];
    if (!quiz) return;
    let answered = 0, right = 0;
    const n = quiz.questions.length;
    const score = el('div', { class: 'quiz-score', 'aria-live': 'polite' }, `0 of ${n} answered`);
    const prev = store.state.quiz[quiz.id];
    quiz.questions.forEach((q, qi) => {
      const block = el('div', { class: 'quiz-q' });
      block.append(el('div', { class: 'qtext' }, el('span', { class: 'qnum' }, `Q${qi + 1}`), el('span', { html: q.q })));
      const opts = el('div', { class: 'quiz-opts' });
      const explain = el('div', { class: 'quiz-explain', hidden: true, html: q.explain });
      q.options.forEach((o, oi) => {
        const b = el('button', { class: 'quiz-opt', type: 'button' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { html: o }));
        b.addEventListener('click', () => {
          [...opts.children].forEach((x, xi) => {
            x.disabled = true;
            if (xi === q.answer) { x.classList.add('correct'); x.querySelector('.mark').textContent = '✓'; }
          });
          if (oi !== q.answer) { b.classList.add('wrong'); b.querySelector('.mark').textContent = '✕'; } else right++;
          b.setAttribute('aria-label', (oi === q.answer ? 'Correct: ' : 'Incorrect: ') + b.textContent);
          answered++;
          explain.hidden = false;
          score.textContent = answered === n ? `${right} of ${n} correct` : `${answered} of ${n} answered · ${right} correct`;
          if (answered === n) {
            store.state.quiz[quiz.id] = { right, total: n, at: Date.now() };
            store.saveNow();
          }
        });
        opts.append(b);
      });
      block.append(opts, explain);
      host.append(block);
    });
    if (window.ProgressCode.isQuizScore(prev)) host.append(el('div', { class: 'quiz-prev' }, `Last time: ${prev.right} of ${prev.total} correct.`));
    host.append(score);
  }

  const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  function hydrateProse(root, pageId) {
    root.querySelectorAll('.example[data-ex]').forEach(hydrateExample);
    root.querySelectorAll('.quiz[data-quiz]').forEach(hydrateQuiz);
    const used = new Set();
    root.querySelectorAll('h2, h3').forEach((h) => {
      let id = slug(h.textContent);
      while (used.has(id)) id += '-x';
      used.add(id);
      h.id = `${pageId}.${id}`;
      h.append(el('a', { class: 'anchor', href: `#${pageId}.${id}`, 'aria-label': 'Link to this section' }, '#'));
    });
  }

  function clauseTrail(clauses) {
    if (!clauses || !clauses.length) return null;
    const on = new Set(clauses.map((c) => c.toUpperCase()));
    const parts = [];
    STEPS.forEach((s, i) => {
      if (i) parts.push(el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));
      parts.push(el('span', { class: on.has(s) ? 'on' : null }, s));
    });
    return el('div', { class: 'clause-trail', 'aria-label': `Evaluation order; this module covers ${clauses.join(', ')}` }, parts);
  }

  // ------------------------------------------------------------------ views
  function setTitle(t) { document.title = t ? `${t} · SELECT Again` : 'SELECT Again'; }

  function progressPanel() {
    const box = el('textarea', { id: 'progress-code', 'aria-label': 'Progress code', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Paste a progress code here to import it.' });
    const msg = el('span', { class: 'msg', 'aria-live': 'polite' });
    const copied = () => { msg.textContent = 'Progress code copied. Paste it into the other copy of the course and press Import.'; };
    // The artifact viewer's frame may refuse clipboard access (Safari on iPad does): select the code for a manual copy.
    const manual = () => {
      box.focus();
      box.setSelectionRange(0, box.value.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* not allowed here either */ }
      if (ok) copied();
      else msg.textContent = `Copying isn’t allowed here, so the code is selected in the box: press ${isMac ? '⌘' : 'Ctrl'}+C, or tap and hold it and choose Copy.`;
    };
    const copyBtn = el('button', { class: 'btn small', type: 'button' }, icon('copy', 14), 'Copy progress code');
    copyBtn.addEventListener('click', () => {
      box.value = store.exportCode();
      try {
        navigator.clipboard.writeText(box.value).then(copied, manual);
      } catch (e) {
        manual();
      }
    });
    const importBtn = el('button', { class: 'btn small import', type: 'button' }, icon('load', 14), 'Import');
    importBtn.addEventListener('click', () => {
      const r = store.importCode(box.value);
      if (!r.ok) { msg.textContent = r.message; return; }
      // Redraw with the imported progress, then say what came in through the new panel's live region.
      renderSidebar('home');
      renderHome();
      const again = main.querySelector('.progress-io');
      again.querySelector('.import').focus({ preventScroll: true });
      requestAnimationFrame(() => { again.querySelector('.msg').textContent = r.message; });
    });
    return el('div', { class: 'progress-io' },
      el('p', null, 'Progress is saved in this browser only. To move it, for example from the downloaded file to the online version, copy your progress code here, paste it into the other copy and press Import there. Importing adds to the progress already in that browser and never removes any.'),
      box,
      el('div', { class: 'row' }, copyBtn, importBtn, msg));
  }

  function renderHome() {
    setTitle('');
    const byDiff = { Easy: [0, 0], Medium: [0, 0], Hard: [0, 0] };
    for (const id of problemOrder) {
      const d = problems[id].difficulty;
      byDiff[d][1]++;
      if (isSolved(id)) byDiff[d][0]++;
    }
    const all = [problemOrder.filter(isSolved).length, problemOrder.length];
    const last = store.state.last && store.state.last !== 'home' ? store.state.last : '';
    const lastLabel = (() => {
      const pg = last.split('.')[0];
      if (moduleById[pg]) return `Continue: ${moduleById[pg].title}`;
      if (/^p\d+$/.test(pg) && problems[pg.slice(1)]) return `Continue: #${pg.slice(1)} ${problems[pg.slice(1)].title}`;
      return null;
    })();
    const exCount = modules.reduce((n, m) => n + m.examples.length, 0);
    const statRow = (label, [s, t]) => el('tr', null, el('td', null, label), el('td', { class: 'num' }, s), el('td', { class: 'num' }, t),
      el('td', null, el('span', { class: 'bar', role: 'img', 'aria-label': `${Math.round((100 * s) / Math.max(t, 1))}%` }, el('i', { style: `width:${(100 * s) / Math.max(t, 1)}%` }))));
    const hero = el('section', { class: 'hero' },
      el('div', null,
        el('div', { class: 'kicker' }, 'A MySQL refresher, with practice'),
        el('h1', { html: 'Get your SQL back by <span class="kw">running</span> it.' }),
        el('p', { class: 'lede' }, `For people who knew SQL once. ${modules.length} short modules, ${exCount} examples you can edit and run, and all ${problemOrder.length} free LeetCode SQL problems — graded right here, in MySQL syntax.`),
        el('div', { class: 'actions' },
          lastLabel ? el('a', { class: 'btn primary', href: `#${last}` }, lastLabel) : el('a', { class: 'btn primary', href: `#${modules[0].id}` }, 'Start with the warm-up'),
          el('a', { class: 'btn', href: '#problems' }, 'Browse problems'),
          el('a', { class: 'btn ghost', href: '#cheatsheet' }, 'Cheat sheet'))),
      el('div', { class: 'stats' },
        el('div', { class: 'q', html: '<span class="t-k">SELECT</span> difficulty, solved, total\n<span class="t-k">FROM</span> my_progress;' }),
        el('div', { class: 'result' }, el('table', { class: 'grid' },
          el('thead', null, el('tr', null, el('th', null, 'difficulty'), el('th', { class: 'num' }, 'solved'), el('th', { class: 'num' }, 'total'), el('th', null, ''))),
          el('tbody', null, statRow('Easy', byDiff.Easy), statRow('Medium', byDiff.Medium), statRow('Hard', byDiff.Hard), statRow('All', all)))),
        resultFoot(4, null, 'saved in this browser')));
    const mapRows = modules.map((m) => {
      const pr = moduleProgress(m);
      const done = !!store.state.done[m.id];
      const tr = el('tr', { class: 'link' },
        el('td', { class: 'n' }, pad2(m.num)),
        el('td', { class: 'm' }, el('a', { href: `#${m.id}` }, m.title), el('small', null, m.summary)),
        el('td', { class: 'c' }, m.kicker),
        el('td', { class: 'p' }, done ? el('span', { class: 'status solved' }, icon('done', 16), pr.total ? `${pr.solved}/${pr.total}` : 'done') : pr.total ? `${pr.solved}/${pr.total}` : el('span', { class: 'null' }, '—')));
      tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = m.id; });
      return tr;
    });
    const map = el('div', { class: 'course-map' },
      el('div', { class: 'q', html: '<span class="t-k">SELECT</span> n, module, covers, problems\n<span class="t-k">FROM</span> course\n<span class="t-k">ORDER BY</span> n;' }),
      el('div', { class: 'result tall' }, el('table', { class: 'grid' },
        el('thead', null, el('tr', null, el('th', null, 'n'), el('th', null, 'module'), el('th', { class: 'c' }, 'covers'), el('th', { class: 'num' }, 'problems'))),
        el('tbody', null, mapRows))),
      resultFoot(modules.length, null));
    const how = el('div', { class: 'how' },
      el('div', null, el('h3', null, 'It runs in your browser'), el('p', null, `Every example and problem runs on SQLite ${COURSE.meta.sqliteVersion} compiled to JavaScript, loaded once from a CDN. Nothing you type leaves this page.`)),
      el('div', null, el('h3', null, 'It speaks MySQL'), el('p', null, 'A compatibility layer adds MySQL functions and syntax (IF, DATE_ADD … INTERVAL, GROUP_CONCAT … SEPARATOR, REGEXP, decimal division) and warns when MySQL would reject a query that runs here.')),
      el('div', null, el('h3', null, 'Checked like LeetCode'), el('p', null, 'Check runs your query on the example data plus hidden edge cases — ties, NULLs, empty tables — and shows exactly which rows are missing or extra.')),
      el('div', null, el('h3', null, 'Progress stays here'), el('p', null, 'Solved problems, finished modules, quiz scores and your drafts are saved in this browser only. Another browser or a private window starts fresh; a progress code, below, carries them over.')));
    main.replaceChildren(el('div', { class: 'home' }, hero,
      el('div', { class: 'section-head' }, el('h2', null, 'The course'), el('p', null, 'Work top to bottom, or jump to what feels rusty.')), map,
      el('div', { class: 'section-head' }, el('h2', null, 'How this page works')), how,
      el('div', { class: 'section-head' }, el('h2', null, 'Your progress')), progressPanel()));
  }

  function renderModule(m, section) {
    setTitle(m.title);
    const pr = moduleProgress(m);
    const doneBtn = el('button', { class: 'btn small', type: 'button', 'aria-pressed': String(!!store.state.done[m.id]) });
    const syncDone = () => {
      const d = !!store.state.done[m.id];
      doneBtn.replaceChildren(d ? icon('done', 14) : icon('circle', 14), d ? 'Finished' : 'Mark as finished');
      doneBtn.setAttribute('aria-pressed', String(d));
    };
    syncDone();
    doneBtn.addEventListener('click', () => {
      if (store.state.done[m.id]) delete store.state.done[m.id]; else store.state.done[m.id] = Date.now();
      store.saveNow();
      syncDone();
      renderSidebar(m.id);
    });
    const head = el('header', { class: 'lesson-head' },
      el('div', { class: 'kicker' }, `Module ${pad2(m.num)}${m.kicker ? ' · ' + m.kicker : ''}`),
      el('h1', { class: 'title' }, m.title),
      m.summary ? el('p', { class: 'lede' }, m.summary) : null,
      el('div', { class: 'meta' },
        el('span', null, el('b', null, `~${m.minutes} min`)),
        m.examples.length ? el('span', null, el('b', null, m.examples.length), ' runnable examples') : null,
        m.problems.length ? el('span', null, el('b', null, `${pr.solved}/${pr.total}`), ' problems solved') : null,
        doneBtn),
      clauseTrail(m.clauses));
    const prose = el('div', { class: 'prose', html: m.html });
    const parts = [head, prose];
    if (m.problems.length) {
      parts.push(el('section', { class: 'practice', id: `${m.id}.practice` },
        el('h2', null, 'Practice on LeetCode problems'),
        el('p', null, 'Each one opens with the tables, an editor and a Check button. Solve here, then submit the same query on LeetCode if you like.'),
        problemList(m.problems)));
    }
    const i = modules.indexOf(m);
    const prev = modules[i - 1], next = modules[i + 1];
    parts.push(el('nav', { class: 'pager', 'aria-label': 'Module navigation' },
      prev ? el('a', { href: `#${prev.id}` }, el('small', null, 'Previous'), prev.title) : el('span'),
      next ? el('a', { class: 'next', href: `#${next.id}` }, el('small', null, 'Next'), next.title) : el('span')));
    main.replaceChildren(el('article', { class: 'lesson' }, parts));
    hydrateProse(prose, m.id);
    if (section) {
      const target = document.getElementById(`${m.id}.${section}`);
      if (target) requestAnimationFrame(() => target.scrollIntoView());
    }
  }

  function problemList(ids) {
    return el('ol', { class: 'plist' }, ids.map((id) => {
      const p = problems[id];
      return el('li', null, el('a', { href: `#p${id}` },
        statusIcon(id),
        el('span', { class: 'pnum' }, `#${id}`),
        el('span', { class: 'ptitle' }, p.title, el('span', { class: 'ptags' }, p.patterns.join(' · '))),
        diffChip(p.difficulty)));
    }));
  }

  // ------------------------------------------------------------------ problem page
  function schemaCard(t, rows) {
    return el('div', { class: 'tcard' },
      el('div', { class: 'tcard-head' }, el('span', { class: 'tname' }, t.name), el('span', { class: 'tcount' }, `${rows.length} row${rows.length === 1 ? '' : 's'}`)),
      el('div', { class: 'schema-cols' }, t.columns.map((c) => el('span', { class: 'col' }, el('b', null, c.name), c.pk ? el('span', { class: 'pk', title: 'primary key' }, 'PK') : null, ' ', el('i', null, c.type.toLowerCase())))),
      rows.length ? renderGrid({ columns: t.columns.map((c) => c.name), rows }) : el('div', { class: 'placeholder', style: 'padding:10px 14px;color:var(--ink-3);font-size:14px' }, 'empty table'));
  }

  function execute(p, sql, setup, args) {
    const api = Engine.api;
    const db = Engine.fresh(setup);
    try {
      if (p.kind === 'function') return api.callFunction(db, sql, p.fn.name, args);
      const r = api.run(db, sql);
      if (!r.error && p.kind === 'dml') {
        const after = api.run(db, p.after);
        after.results = r.results.filter((x) => !x.columns.length).concat(after.results);
        after.warnings = r.warnings;
        after.notes = r.notes;
        after.ms = r.ms + after.ms;
        return after;
      }
      return r;
    } finally {
      db.close();
    }
  }

  function starterFor(p) {
    const head = `-- #${p.id} ${p.title}\n`;
    if (p.starter) return head + p.starter;
    if (p.kind === 'dml') return head + '-- Write the UPDATE / DELETE statement. Run shows the table afterwards.\n\n';
    return head + '-- Write your MySQL query. Mod+Enter runs it, Shift+Mod+Enter checks it.\n\n'.replace(/Mod/g, isMac ? '⌘' : 'Ctrl');
  }

  function renderProblem(id) {
    const p = problems[id];
    if (!p) return renderNotFound();
    setTitle(`#${p.id} ${p.title}`);
    const m = moduleById[p.module];
    const ds0 = p.datasets[0];
    const run0 = ds0.runs[0];
    const idx = problemOrder.indexOf(p.id);
    const prevId = problemOrder[idx - 1], nextId = problemOrder[idx + 1];
    const status = el('span', { class: 'status' + (isSolved(id) ? ' solved' : '') });
    const syncStatus = () => {
      status.className = 'status' + (isSolved(id) ? ' solved' : '');
      status.replaceChildren(isSolved(id) ? icon('done', 16) : store.state.tried[id] ? icon('half', 16) : icon('circle', 16),
        isSolved(id) ? 'Solved' : store.state.tried[id] ? 'Attempted' : 'Not started');
    };
    syncStatus();

    // --- description
    const fnNote = p.kind === 'function' ? el('p', { class: 'meta', style: 'margin-top:8px' }, `Expected for ${p.fn.name}(${run0.args.join(', ')}) on the example data:`) : null;
    const top = el('div', { class: 'p-top' },
      el('div', { class: 'p-head' },
        el('div', { class: 'kicker' }, m ? `Module ${pad2(m.num)} · ${m.title}` : 'Problem'),
        el('h1', { class: 'title' }, el('span', { class: 'p-num' }, `#${p.id} `), p.title),
        el('div', { class: 'row' },
          diffChip(p.difficulty),
          p.sql50 ? el('span', { class: 'chip accent', title: 'Part of LeetCode’s SQL 50 study plan' }, 'SQL 50') : null,
          p.patterns.map((t) => el('span', { class: 'chip' }, t)),
          status,
          el('a', { class: 'btn ghost small', href: `https://leetcode.com/problems/${p.slug}/`, target: '_blank', rel: 'noopener' }, 'Open on LeetCode', icon('ext', 14)))),
      el('section', { class: 'p-section' }, el('h2', null, 'Task'), el('div', { class: 'p-task', html: p.taskHtml })),
      el('section', { class: 'p-section' }, el('h2', null, p.schema.length > 1 ? 'Tables (example data)' : 'Table (example data)'),
        p.schema.map((t, i) => schemaCard(t, (ds0.tables[i] && ds0.tables[i].rows) || []))),
      el('section', { class: 'p-section' }, el('h2', null, 'Expected output'), fnNote,
        el('div', { class: 'tcard' }, renderGrid(run0.expected), resultFoot(run0.expected.rows.length, null, p.order ? 'order matters' : 'any row order'))));

    // --- workspace
    const draft = store.state.drafts[id];
    const edHost = el('div', { class: 'editor-host' });
    const out = el('div', { class: 'work-out' }, el('div', { class: 'placeholder' }, 'Run shows your result on the example data. Check also runs hidden test cases.'));
    const saved = el('span', null, draft ? 'draft restored' : 'MySQL');
    const editor = makeEditor(edHost, draft || starterFor(p), {
      label: `SQL for problem ${p.id}`,
      onRun: () => runUser(), onCheck: () => checkUser(),
      onChange: (v) => { store.state.drafts[id] = v; store.save(); saved.textContent = 'draft saved'; },
    });
    const runBtn = el('button', { class: 'btn', type: 'button' }, icon('play', 14), 'Run', kbd('Mod+↵'));
    const checkBtn = el('button', { class: 'btn primary', type: 'button' }, icon('check', 14), 'Check', kbd('⇧Mod+↵'));
    const resetBtn = el('button', { class: 'btn ghost small', type: 'button', title: 'Replace your draft with the starter text' }, icon('reset', 14), 'Reset');
    const work = el('div', { class: 'p-work' }, el('div', { class: 'work-card' },
      el('div', { class: 'work-title' }, el('span', null, 'Your query'), saved),
      edHost,
      el('div', { class: 'work-bar' }, runBtn, checkBtn, el('span', { class: 'spacer' }), resetBtn),
      out));
    let resetArmed = false;
    resetBtn.addEventListener('click', () => {
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.replaceChildren(icon('reset', 14), 'Click again to reset');
        setTimeout(() => { resetArmed = false; resetBtn.replaceChildren(icon('reset', 14), 'Reset'); }, 3000);
        return;
      }
      resetArmed = false;
      editor.setValue(starterFor(p));
      delete store.state.drafts[id];
      store.save();
      resetBtn.replaceChildren(icon('reset', 14), 'Reset');
      saved.textContent = 'MySQL';
    });

    async function ready() {
      try { await Engine.load(); return true; } catch (e) { out.replaceChildren(engineErrorBox()); return false; }
    }
    function markTried() {
      if (!store.state.tried[id]) { store.state.tried[id] = Date.now(); store.save(); syncStatus(); }
    }
    async function runUser(sqlOverride, caption) {
      runBtn.disabled = true;
      if (!(await ready())) { runBtn.disabled = false; return; }
      const r = execute(p, sqlOverride || editor.getValue(), ds0.setup, run0.args);
      renderOutput(out, toOutput(r), { caption: caption || (p.kind === 'dml' ? `Table after your statement (example data): <code>${esc(p.after)}</code>` : p.kind === 'function' ? `Result of ${esc(p.fn.name)}(${run0.args.join(', ')}) on the example data` : 'Result on the example data') });
      if (!sqlOverride) markTried();
      runBtn.disabled = false;
    }
    async function checkUser() {
      checkBtn.disabled = true;
      if (!(await ready())) { checkBtn.disabled = false; return; }
      const sql = editor.getValue();
      markTried();
      const tests = [];
      p.datasets.forEach((ds) => ds.runs.forEach((run) => tests.push({ ds, run })));
      const badges = [];
      let fail = null, lastWarnings = [], notes = [], totalMs = 0;
      for (const [i, t] of tests.entries()) {
        const r = execute(p, sql, t.ds.setup, t.run.args);
        totalMs += r.ms || 0;
        lastWarnings = r.warnings || [];
        if (r.error) { fail = { i, t, r, c: null }; badges.push('fail'); break; }
        const c = window.ResultCheck.compare(t.run.expected, r.last, { ordered: p.order });
        notes = notes.concat(c.notes || []);
        if (!c.ok) { fail = { i, t, r, c }; badges.push('fail'); break; }
        badges.push('pass');
      }
      while (badges.length < tests.length) badges.push('skip');
      const badgeRow = el('div', { class: 'tests' }, badges.map((b, i) => el('span', { class: b === 'skip' ? null : b, title: tests[i].ds.name }, `${b === 'pass' ? '✓' : b === 'fail' ? '✕' : '·'} test ${i + 1}`)));
      out.replaceChildren();
      if (!fail && lastWarnings.length) {
        out.append(el('div', { class: 'verdict bad' }, el('h3', null, icon('alert', 20), 'Right result — but MySQL would reject this'),
          el('p', null, 'Your output matches on every test, but LeetCode runs real MySQL. Fix the issues below, then check again.'), badgeRow));
        lastWarnings.forEach((w) => out.append(msgBox('warning', w)));
        return done();
      }
      if (!fail) {
        const first = !isSolved(id);
        store.state.solved[id] = store.state.solved[id] || Date.now();
        store.saveNow();
        syncStatus();
        renderSidebar(`p${id}`);
        out.append(el('div', { class: 'verdict ok' }, el('h3', null, icon('done', 20), 'Accepted'),
          el('p', null, `Passed all ${tests.length} test${tests.length === 1 ? '' : 's'} in ${(totalMs / 1000).toFixed(3)} sec.${first ? ' Nice — marked as solved.' : ''} Compare with the solutions below; there is often a neater way.`), badgeRow));
        [...new Set(notes)].forEach((n) => out.append(msgBox('note', n)));
        if (first) toast(`Solved #${id}`);
        return done();
      }
      const { t, r, c } = fail;
      const hidden = t.ds !== ds0;
      const title = r.error ? 'Error' : c.reason === 'order' ? 'Wrong order' : c.reason === 'columns' ? 'Wrong columns' : c.reason === 'noresult' ? 'No result' : 'Wrong answer';
      out.append(el('div', { class: 'verdict bad' }, el('h3', null, icon('x', 20), title),
        el('p', { html: `Failed on test ${fail.i + 1}: <b>${esc(t.ds.name)}</b>${hidden ? ' (a hidden test)' : ''}. ${r.error ? '' : esc(c.message)}` }), badgeRow));
      if (r.error) out.append(msgBox('error', r.error.message, r.error.hint));
      (r.warnings || []).forEach((w) => out.append(msgBox('warning', w)));
      if (!r.error && r.last) {
        const missing = new Set((c.missing || []).map((x) => JSON.stringify(x)));
        const extra = new Set((c.extra || []).map((x) => JSON.stringify(x)));
        const cmp = el('div', { class: 'compare' },
          el('div', null, el('h4', null, 'Expected'), renderGrid(t.run.expected, { rowClass: (row) => (missing.has(JSON.stringify(row)) ? 'missing' : null) })),
          el('div', null, el('h4', null, 'Your output'), renderGrid(r.last, { rowClass: (row) => (extra.has(JSON.stringify(row)) ? 'extra' : null) })));
        if (missing.size || extra.size) {
          out.append(el('div', { class: 'legend' },
            missing.size ? el('span', null, el('i', { style: 'background:var(--ok-soft);outline:1px solid var(--ok)' }), 'expected but missing') : null,
            extra.size ? el('span', null, el('i', { style: 'background:var(--bad-soft);outline:1px solid var(--bad)' }), 'in yours but not expected') : null));
        }
        out.append(cmp);
      }
      if (hidden) {
        const det = el('details', { class: 'setup', style: 'margin:12px 14px' }, el('summary', null, 'Show the data for this test'));
        p.schema.forEach((tab, i) => det.append(schemaCard(tab, (t.ds.tables[i] && t.ds.tables[i].rows) || [])));
        out.append(det);
      }
      done();
      function done() { checkBtn.disabled = false; }
    }
    runBtn.addEventListener('click', () => runUser());
    checkBtn.addEventListener('click', () => checkUser());

    // --- hints, solutions, traps
    const bottom = el('div', { class: 'p-bottom' });
    if (p.hints.length) {
      const hintsBox = el('div', { class: 'hints' });
      let shown = 0;
      const more = el('button', { class: 'btn small', type: 'button' });
      const sync = () => {
        more.textContent = `Show hint ${shown + 1} of ${p.hints.length}`;
        more.hidden = shown >= p.hints.length;
      };
      more.addEventListener('click', () => {
        hintsBox.insertBefore(el('div', { class: 'hint' }, el('div', { class: 'hl' }, `Hint ${shown + 1}`), el('div', { html: p.hints[shown] })), more);
        shown++;
        sync();
      });
      sync();
      hintsBox.append(more);
      bottom.append(el('section', { class: 'p-section' }, el('h2', null, 'Hints'), hintsBox));
    }
    const solHost = el('div');
    const reveal = el('div', { class: 'reveal' }, el('p', null, 'Try it first — a solution sticks better after you have wrestled with the problem.'),
      el('button', { class: 'btn', type: 'button', onclick: () => { reveal.remove(); solHost.append(solutionsView()); } }, 'Show solutions'));
    solHost.append(reveal);
    bottom.append(el('section', { class: 'p-section' }, el('h2', null, 'Solutions'), solHost));
    function solBlock(kind, title, sql, html, extraBtns) {
      const pre = el('pre', { class: 'code sql' }, el('code', { html: window.SQLTok.highlight(sql) }));
      return el('div', { class: 'sol' + (kind === 'trap' ? ' trap' : '') },
        el('div', { class: 'sol-head' }, el('b', null, title), el('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, extraBtns,
          el('button', { class: 'btn ghost small', type: 'button', onclick: () => copyText(sql, pre) }, icon('copy', 14), 'Copy'))),
        pre, html ? el('div', { class: 'sol-body', html }) : null);
    }
    function loadBtn(sql) {
      return el('button', { class: 'btn small', type: 'button', onclick: () => { editor.setValue(sql); editor.focus(); toast('Loaded into the editor — Ctrl+Z undoes it'); } }, icon('load', 14), 'Load into editor');
    }
    function solutionsView() {
      const box = el('div');
      box.append(solBlock('main', 'Solution', p.solution.sql, p.solution.html, loadBtn(p.solution.sql)));
      p.alternatives.forEach((a) => box.append(solBlock('alt', `Alternative: ${a.title}`, a.sql, a.html, loadBtn(a.sql))));
      if (p.traps.length) {
        box.append(el('h3', { style: 'font:600 13px var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin:26px 0 12px' }, 'Common wrong answers'));
        p.traps.forEach((t, i) => box.append(solBlock('trap', `Wrong answer ${i + 1}`, t.sql, t.html,
          el('button', { class: 'btn small', type: 'button', onclick: () => runUser(t.sql, 'Output of the <b>wrong answer</b> on the example data — compare with the expected output') }, icon('play', 14), 'Run it'))));
      }
      return box;
    }
    if (p.notesHtml) bottom.append(el('section', { class: 'p-section p-notes' }, el('h2', null, 'Notes'), el('div', { class: 'prose', html: p.notesHtml })));
    bottom.append(el('nav', { class: 'p-nav', 'aria-label': 'Problem navigation' },
      prevId ? el('a', { class: 'btn', href: `#p${prevId}` }, `← #${prevId}`) : el('span'),
      m ? el('a', { class: 'btn ghost', href: `#${m.id}.practice` }, `All ${m.title} problems`) : null,
      nextId ? el('a', { class: 'btn', href: `#p${nextId}` }, `#${nextId} →`) : el('span')));

    main.replaceChildren(el('div', { class: 'problem' }, top, work, bottom));
    requestAnimationFrame(() => editor.refresh());
  }

  // ------------------------------------------------------------------ problems index
  const filterState = { q: '', diff: 'All', status: 'All', sql50: false };
  function renderProblems() {
    setTitle('Problems');
    const solved = problemOrder.filter(isSolved).length;
    const search = el('input', { type: 'search', id: 'problem-search', placeholder: 'Search by number, title or pattern', 'aria-label': 'Search problems', value: filterState.q });
    const seg = (key, values) => el('div', { class: 'seg', role: 'group', 'aria-label': key }, values.map((v) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(filterState[key] === v) }, v);
      b.addEventListener('click', () => { filterState[key] = v; seg.parent && null; draw(); b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      return b;
    }));
    const sql50Btn = el('button', { class: 'btn small', type: 'button', 'aria-pressed': String(filterState.sql50) }, 'SQL 50 only');
    sql50Btn.addEventListener('click', () => {
      filterState.sql50 = !filterState.sql50;
      sql50Btn.setAttribute('aria-pressed', String(filterState.sql50));
      sql50Btn.classList.toggle('primary', filterState.sql50);
      draw();
    });
    if (filterState.sql50) sql50Btn.classList.add('primary');
    const tbody = el('tbody');
    const count = el('p', { class: 'meta' });
    function draw() {
      const q = filterState.q.trim().toLowerCase();
      const ids = problemOrder.filter((id) => {
        const p = problems[id];
        if (filterState.diff !== 'All' && p.difficulty !== filterState.diff) return false;
        if (filterState.status === 'Solved' && !isSolved(id)) return false;
        if (filterState.status === 'To do' && isSolved(id)) return false;
        if (filterState.sql50 && !p.sql50) return false;
        if (q && !(`${id} ${p.title} ${p.patterns.join(' ')} ${moduleById[p.module].title}`.toLowerCase().includes(q))) return false;
        return true;
      });
      tbody.replaceChildren(...ids.map((id) => {
        const p = problems[id];
        return el('tr', null,
          el('td', null, statusIcon(id)),
          el('td', { class: 'id' }, id),
          el('td', null, el('a', { href: `#p${id}` }, p.title), p.sql50 ? el('span', { class: 'chip accent', style: 'margin-left:8px;padding:3px 6px;font-size:11px' }, 'SQL 50') : null),
          el('td', null, diffChip(p.difficulty)),
          el('td', { class: 'mod' }, `${pad2(moduleById[p.module].num)} ${moduleById[p.module].title}`),
          el('td', { class: 'pat' }, p.patterns.join(' · ')));
      }));
      if (!ids.length) tbody.append(el('tr', null, el('td', { colspan: '6', class: 'empty' }, 'No problems match these filters.')));
      count.replaceChildren(el('span', null, el('b', null, ids.length), ` of ${problemOrder.length} shown`), el('span', null, el('b', null, solved), ' solved'));
    }
    search.addEventListener('input', () => { filterState.q = search.value; draw(); });
    main.replaceChildren(el('div', { class: 'home' },
      el('div', { class: 'kicker' }, 'Practice'),
      el('h1', { class: 'title' }, 'All problems'),
      el('p', { class: 'lede' }, `Every free LeetCode SQL problem from #175 to #2356, plus #3482 for recursive CTEs, grouped by the module that teaches the idea. Descriptions and data are this course's own; the numbers link to LeetCode.`),
      el('div', { class: 'filters' }, search, seg('diff', ['All', 'Easy', 'Medium', 'Hard']), seg('status', ['All', 'To do', 'Solved']), sql50Btn),
      count,
      el('div', { class: 'ptable-wrap' }, el('table', { class: 'ptable' },
        el('thead', null, el('tr', null, el('th', null, el('span', { class: 'sr' }, 'Status')), el('th', null, '#'), el('th', null, 'Problem'), el('th', null, 'Level'), el('th', { class: 'mod' }, 'Module'), el('th', { class: 'pat' }, 'Patterns'))),
        tbody))));
    draw();
  }

  // ------------------------------------------------------------------ playground
  let playDb = null;
  let playDbName = store.state.playDb || 'sample';
  function renderPlayground() {
    setTitle('Playground');
    const dbSelect = el('select', { id: 'play-db', 'aria-label': 'Database' },
      el('option', { value: 'sample', selected: playDbName === 'sample' }, 'Sample shop database'),
      el('option', { value: 'empty', selected: playDbName === 'empty' }, 'Empty database'));
    const resetDb = el('button', { class: 'btn small', type: 'button' }, icon('reset', 14), 'Reset data');
    const tablesHost = el('div');
    const out = el('div', { class: 'work-out' }, el('div', { class: 'placeholder' }, 'Tables you create here stay until you reset or reload the page.'));
    const defaultSql = `-- Scratchpad on the sample shop database. Mod+Enter runs.\nSELECT c.name, COUNT(o.order_id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id, c.name\nORDER BY orders DESC, c.name;\n`.replace('Mod', isMac ? '⌘' : 'Ctrl');
    const edHost = el('div', { class: 'editor-host' });
    const editor = makeEditor(edHost, store.state.play || defaultSql, {
      label: 'Playground SQL', onRun: () => run(), onChange: (v) => { store.state.play = v; store.save(); },
    });
    const runBtn = el('button', { class: 'btn primary', type: 'button' }, icon('play', 14), 'Run', kbd('Mod+↵'));
    function drawSchema(schema) {
      tablesHost.replaceChildren();
      const names = Object.keys(schema);
      if (!names.length) { tablesHost.append(el('div', { class: 'sb-empty' }, 'No tables yet. Try CREATE TABLE …')); return; }
      names.forEach((name, i) => {
        tablesHost.append(el('details', { open: i < 2 ? true : null },
          el('summary', null, el('span', null, name), el('small', null, `${schema[name].length} cols`)),
          el('ul', null, schema[name].map((c) => el('li', null, el('button', { type: 'button', title: 'Insert into the editor', onclick: () => editor.insert(c) }, c))))));
      });
    }
    const staticSchema = () => {
      if (playDbName === 'empty') return {};
      return Object.fromEntries(COURSE.sampleDb.tables.map((t) => [t.name, t.columns.map((c) => c.name)]));
    };
    drawSchema(playDb ? Engine.api.schema(playDb) : staticSchema());
    async function ensureDb() {
      await Engine.load();
      if (!playDb) playDb = Engine.fresh(playDbName === 'sample' ? COURSE.sampleDb.setup : '');
      return playDb;
    }
    async function run() {
      runBtn.disabled = true;
      try { await ensureDb(); } catch (e) { out.replaceChildren(engineErrorBox()); runBtn.disabled = false; return; }
      const r = Engine.api.run(playDb, editor.getValue());
      renderOutput(out, toOutput(r), { tall: true });
      drawSchema(Engine.api.schema(playDb));
      runBtn.disabled = false;
    }
    function resetData() {
      if (playDb) { playDb.close(); playDb = null; }
      drawSchema(staticSchema());
      out.replaceChildren(el('div', { class: 'placeholder' }, playDbName === 'sample' ? 'Sample data restored.' : 'Empty database ready.'));
    }
    runBtn.addEventListener('click', run);
    resetDb.addEventListener('click', resetData);
    dbSelect.addEventListener('change', () => { playDbName = dbSelect.value; store.state.playDb = playDbName; store.save(); resetData(); });
    main.replaceChildren(el('div', null,
      el('div', { class: 'kicker' }, 'Free practice'),
      el('h1', { class: 'title' }, 'Playground'),
      el('p', { class: 'lede', style: 'margin-bottom:24px' }, 'Write anything: explore the sample shop, or start from an empty database and CREATE your own tables. MySQL syntax, run locally.'),
      el('div', { class: 'play' },
        el('aside', { class: 'schema-browser', 'aria-label': 'Schema' },
          el('div', { class: 'sb-head' }, dbSelect, el('div', null, resetDb)),
          tablesHost),
        el('div', { class: 'work-card' },
          el('div', { class: 'work-title' }, el('span', null, 'Query'), el('span', null, playDbName === 'sample' ? 'sample shop' : 'empty db')),
          edHost,
          el('div', { class: 'work-bar' }, runBtn, el('span', { class: 'spacer' }), el('span', { class: 'kbd', style: 'border:0' }, 'click a column name to insert it')),
          out))));
    requestAnimationFrame(() => editor.refresh());
  }

  // ------------------------------------------------------------------ cheat sheet & 404
  function renderCheatsheet() {
    setTitle('Cheat sheet');
    const grid = el('div', { class: 'sheet-grid', html: COURSE.cheatsheet || '' });
    main.replaceChildren(el('div', { class: 'sheet' },
      el('div', { class: 'kicker' }, 'Reference'),
      el('h1', { class: 'title' }, 'MySQL cheat sheet'),
      el('p', { class: 'lede' }, 'The syntax and patterns from the course on one page. Tables like t, a and b are placeholders; try the ideas on the sample shop in the Playground.'),
      grid));
  }
  function renderNotFound() {
    setTitle('Not found');
    main.replaceChildren(el('div', { class: 'lesson' }, el('div', { class: 'kicker' }, 'Empty set (0.00 sec)'), el('h1', { class: 'title' }, 'Nothing at this address'),
      el('p', { class: 'lede' }, 'That link doesn’t match a module or problem.'), el('p', null, el('a', { class: 'btn', href: '#home' }, 'Go to the course home'))));
  }

  // ------------------------------------------------------------------ router
  function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    const [page, section] = hash.split('.');
    setDrawer(false);
    if (!page || page === 'home') renderHome();
    else if (/^p\d+$/.test(page)) renderProblem(Number(page.slice(1)));
    else if (page === 'problems') renderProblems();
    else if (page === 'playground') renderPlayground();
    else if (page === 'cheatsheet') renderCheatsheet();
    else if (moduleById[page]) renderModule(moduleById[page], section);
    else renderNotFound();
    renderSidebar(page || 'home');
    document.querySelectorAll('.toplinks a').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === page ? 'page' : 'false'));
    if (!section) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    if (page && page !== 'home') { store.state.last = hash; store.save(); }
  }
  window.addEventListener('hashchange', route);
  route();
  // warm the engine up once the page is idle, so the first Run is instant
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 800));
  idle(() => Engine.load().catch(() => {}));
})();
