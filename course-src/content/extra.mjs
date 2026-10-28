// Extra page data for the course: the cheat sheet, one card per "## " section.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export default function extra(md) {
  const src = fs.readFileSync(path.join(DIR, 'cheatsheet.md'), 'utf8');
  const cards = src.split(/^## /m).slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const title = part.slice(0, nl).trim();
    return `<section class="sheet-card"><h2>${title}</h2>${md.parse(part.slice(nl + 1))}</section>`;
  });
  return { cheatsheet: cards.join('\n') };
}
