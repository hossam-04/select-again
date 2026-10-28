// Assembles the single-file course from build/course.json + template + shared libs.
//   node tools/compile.mjs && node build.mjs
// Writes ../sql-course.html (standalone document) and build/artifact.html (body-only, for publishing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const course = read('build/course.json');
const LIBS = ['lib/sqltok.js', 'lib/mysql-udf.js', 'lib/mysql-compat.js', 'lib/engine-core.js', 'lib/checker.js', 'lib/progress.js'];
const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
// Function replacements: the payloads contain `$` sequences that string replacement would interpret.
const page = read('template/page.html')
  .replace('/*{{CM_CSS}}*/', () => read('node_modules/codemirror/lib/codemirror.css'))
  .replace('/*{{STYLES}}*/', () => read('template/styles.css'))
  .replace('/*{{COURSE_JSON}}*/', () => course.replace(/</g, '\\u003c'))
  .replace('/*{{LIB}}*/', () => scriptSafe(LIBS.map(read).join('\n')))
  .replace('/*{{APP}}*/', () => scriptSafe(read('template/app.js')));

if (/\{\{[A-Z_]+\}\}/.test(page)) throw new Error('unfilled template placeholder');
const [head, body] = page.split('<!--BODY-->');

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
const artifact = head.trim() + '\n' + body.trim() + '\n';

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '..', 'sql-course.html'), standalone);
fs.writeFileSync(path.join(ROOT, 'build', 'artifact.html'), artifact);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`sql-course.html ${kb(standalone)} (course data ${kb(course)})`);
