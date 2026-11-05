// Extra page data for the course: the cheat sheet, one card per "## " section.
// `## Title {module=id}` assigns the section's flashcards to a module; `{{…}}` marks the part a flashcard hides.
// The page shows neither marker: the hidden part renders as plain text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export default function extra(md, SQLTok, slug) {
  const src = fs.readFileSync(path.join(DIR, 'cheatsheet.md'), 'utf8');
  const sections = src.split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    let module = '';
    const title = part.slice(0, nl).replace(/\s*\{module=([\w-]+)\}\s*$/, (m, id) => { module = id; return ''; }).trim();
    const body = part.slice(nl + 1).replace(/\{\{(.+?)\}\}/g, '<span class="cloze">$1</span>');
    return { title, module, anchor: slug(title), html: md.parse(body) };
  });
  const cards = sections.map((s) => `<section class="sheet-card"><h2 id="cheatsheet.${s.anchor}">${s.title}</h2>${s.html}</section>`);
  return { cheatsheet: cards.join('\n'), sheetSections: sections };
}
