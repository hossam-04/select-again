// Node entry point: loads the shared scripts and sql.js (the same asm build the page uses).
import { createRequire } from 'node:module';
import './sqltok.js';
import './mysql-udf.js';
import './mysql-compat.js';
import './engine-core.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-asm.js');
const SQL = await initSqlJs();

export const engine = globalThis.SQLEngine.createEngine(SQL);
export const { SQLTok, SQLCompat, MySQLFunctions, SQLEngine } = globalThis;
