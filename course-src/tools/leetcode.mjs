// Fetches LeetCode metadata for the free database problems and caches it.
// Used only to VERIFY our own solutions (schema names, example input -> output).
// Nothing fetched here is copied into the course page.
//
//   node tools/leetcode.mjs            fetch anything missing from cache/lc/
//   node tools/leetcode.mjs show 577   print a problem's statement as plain text

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'cache', 'lc');
fs.mkdirSync(CACHE, { recursive: true });

const QUERY = `query q($s: String!) { question(titleSlug: $s) {
  questionFrontendId title titleSlug difficulty isPaidOnly content metaData exampleTestcaseList
  topicTags { name } } }`;

export function catalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'catalog-all.json'), 'utf8'));
}

async function fetchOne(slug) {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: `https://leetcode.com/problems/${slug}/` },
    body: JSON.stringify({ query: QUERY, variables: { s: slug } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${slug}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.question;
}

const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function htmlToText(html) {
  return decode(
    html
      .replace(/<li>/g, '\n  - ')
      .replace(/<\/p>|<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

function parseCell(s) {
  const t = s.trim();
  if (t.toLowerCase() === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

// Parse the ASCII result tables that follow each "Output:" marker.
export function parseExampleOutputs(content) {
  const text = decode(content.replace(/<[^>]+>/g, ''));
  const outputs = [];
  const re = /Output:\s*\n?((?:[ \t]*[+|].*\n?)+)/g;
  let m;
  while ((m = re.exec(text))) {
    const lines = m[1].split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && !/^\|[-\s|:]+\|?$/.test(l));
    if (!lines.length) continue;
    const split = (l) => l.slice(1, l.lastIndexOf('|')).split('|');
    const headers = split(lines[0]).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => split(l).map(parseCell));
    outputs.push({ headers, rows });
  }
  return outputs;
}

export function loadProblem(id) {
  const file = path.join(CACHE, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = JSON.parse(q.metaData);
  return {
    id: Number(q.questionFrontendId),
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty,
    paidOnly: q.isPaidOnly,
    schema: meta.database_schema || {},
    mysql: meta.mysql || [],
    examples: (q.exampleTestcaseList || []).map((s) => JSON.parse(s)),
    outputs: parseExampleOutputs(q.content || ''),
    text: htmlToText(q.content || ''),
    tags: (q.topicTags || []).map((t) => t.name),
  };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'show') {
    const p = loadProblem(arg);
    if (!p) throw new Error(`not cached: ${arg}`);
    console.log(`#${p.id} ${p.title} (${p.difficulty}) https://leetcode.com/problems/${p.slug}/`);
    console.log(p.text);
    console.log('\nschema:', JSON.stringify(p.schema));
    console.log('examples:', p.examples.length, 'parsed outputs:', p.outputs.length);
    return;
  }
  const free = catalog().filter((q) => !q.isPaidOnly);
  let fetched = 0;
  for (const q of free) {
    const file = path.join(CACHE, `${q.questionFrontendId}.json`);
    if (fs.existsSync(file)) continue;
    const data = await fetchOne(q.titleSlug);
    fs.writeFileSync(file, JSON.stringify(data));
    fetched++;
    await new Promise((r) => setTimeout(r, 600));
  }
  const ids = free.map((q) => q.questionFrontendId);
  let bad = 0;
  for (const id of ids) {
    const p = loadProblem(id);
    if (p.outputs.length !== p.examples.length) {
      bad++;
      console.log(`#${id}: ${p.examples.length} example inputs but ${p.outputs.length} parsed outputs`);
    }
  }
  console.log(`fetched ${fetched}, cached ${ids.length}, output/example count mismatches: ${bad}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
