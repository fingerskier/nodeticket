const { test } = require('node:test');
const assert = require('node:assert/strict');
const parseArgs = require('../src/cli/args');

test('parses --flag value form', () => {
  const r = parseArgs(['--out', 'users.csv']);
  assert.equal(r.out, 'users.csv');
  assert.deepEqual(r._, []);
});

test('parses --flag=value form', () => {
  const r = parseArgs(['--out=users.csv']);
  assert.equal(r.out, 'users.csv');
});

test('trailing bare flag becomes true', () => {
  const r = parseArgs(['--all-fields']);
  assert.equal(r['all-fields'], true);
});

test('bare flag followed by another flag becomes true', () => {
  const r = parseArgs(['--all-fields', '--out', 'f.csv']);
  assert.equal(r['all-fields'], true);
  assert.equal(r.out, 'f.csv');
});

test('--flag= with empty rhs yields empty string, not true', () => {
  const r = parseArgs(['--x=']);
  assert.equal(r.x, '');
});

test('collects positional args in _', () => {
  const r = parseArgs(['one', '--flag', 'v', 'two']);
  assert.deepEqual(r._, ['one', 'two']);
  assert.equal(r.flag, 'v');
});

test('later value overwrites earlier for same flag', () => {
  const r = parseArgs(['--x', 'a', '--x', 'b']);
  assert.equal(r.x, 'b');
});

test('mixed realistic export-users invocation', () => {
  const r = parseArgs([
    '--fields', 'id,name,email',
    '--all-fields',
    '--out', './tmp/u.csv',
    '--limit=5',
  ]);
  assert.equal(r.fields, 'id,name,email');
  assert.equal(r['all-fields'], true);
  assert.equal(r.out, './tmp/u.csv');
  assert.equal(r.limit, '5');
});

test('empty argv returns only empty _', () => {
  const r = parseArgs([]);
  assert.deepEqual(r, { _: [] });
});
