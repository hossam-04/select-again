import test from 'node:test';
import assert from 'node:assert/strict';
import '../lib/checker.js';

const { compare } = globalThis.ResultCheck;
const E = { columns: ['name', 'bonus'], rows: [['Brad', null], ['John', null], ['Dan', 500]] };

test('accepts the same rows in any order when order is not required', () => {
  const r = compare(E, { columns: ['name', 'bonus'], rows: [['Dan', 500], ['Brad', null], ['John', null]] });
  assert.equal(r.ok, true);
});

test('requires order when asked', () => {
  const r = compare(E, { columns: ['name', 'bonus'], rows: [['Dan', 500], ['Brad', null], ['John', null]] }, { ordered: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'order');
});

test('reports missing and extra rows', () => {
  const r = compare(E, { columns: ['name', 'bonus'], rows: [['Dan', 500], ['Thomas', 2000]] });
  assert.equal(r.reason, 'rows');
  assert.deepEqual(r.missing, [['Brad', null], ['John', null]]);
  assert.deepEqual(r.extra, [['Thomas', 2000]]);
});

test('duplicates count (multiset, not set)', () => {
  const r = compare({ columns: ['x'], rows: [[1], [1]] }, { columns: ['x'], rows: [[1]] });
  assert.equal(r.ok, false);
});

test('column names: case-insensitive match passes with a note, different names fail', () => {
  const r = compare(E, { columns: ['Name', 'BONUS'], rows: E.rows });
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
  const r2 = compare(E, { columns: ['name', 'amount'], rows: E.rows });
  assert.equal(r2.reason, 'columns');
});

test('numbers: tolerance for float noise, numeric strings, but 0.33 != 0.333', () => {
  assert.equal(compare({ columns: ['p'], rows: [[0.33]] }, { columns: ['p'], rows: [[0.33000000001]] }).ok, true);
  assert.equal(compare({ columns: ['p'], rows: [[2.5]] }, { columns: ['p'], rows: [['2.50']] }).ok, true);
  assert.equal(compare({ columns: ['p'], rows: [[0.33]] }, { columns: ['p'], rows: [[0.333]] }).ok, false);
  assert.equal(compare({ columns: ['p'], rows: [[null]] }, { columns: ['p'], rows: [[0]] }).ok, false);
});

test('no result table', () => {
  assert.equal(compare(E, null).reason, 'noresult');
});
