const { test } = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../src/cli/commands/export-users');
const { csvEscape, csvRow, formatDate, BUILTIN_ACCESSORS } = __test;

test('csvEscape: plain string passthrough', () => {
  assert.equal(csvEscape('hello'), 'hello');
});

test('csvEscape: null and undefined → empty string', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('csvEscape: number and boolean coerced to string', () => {
  assert.equal(csvEscape(42), '42');
  assert.equal(csvEscape(true), 'true');
});

test('csvEscape: comma triggers quoting', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
});

test('csvEscape: embedded quote is doubled and wrapped', () => {
  assert.equal(csvEscape('he said "hi"'), '"he said ""hi"""');
});

test('csvEscape: CR, LF, CRLF all trigger quoting', () => {
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(csvEscape('line1\rline2'), '"line1\rline2"');
  assert.equal(csvEscape('line1\r\nline2'), '"line1\r\nline2"');
});

test('csvRow joins with commas and terminates with newline', () => {
  assert.equal(csvRow(['a', 'b', 'c']), 'a,b,c\n');
});

test('csvRow quotes individual fields as needed', () => {
  assert.equal(csvRow(['id', 'a,b', 'c']), 'id,"a,b",c\n');
});

test('formatDate: Date instance → ISO string', () => {
  const d = new Date('2026-04-06T23:16:20.000Z');
  assert.equal(formatDate(d), '2026-04-06T23:16:20.000Z');
});

test('formatDate: string passthrough', () => {
  assert.equal(formatDate('2026-04-06'), '2026-04-06');
});

test('formatDate: null/undefined → empty', () => {
  assert.equal(formatDate(null), '');
  assert.equal(formatDate(undefined), '');
});

test('BUILTIN_ACCESSORS.org handles null organization', () => {
  assert.equal(BUILTIN_ACCESSORS.org({ organization: null }), '');
  assert.equal(
    BUILTIN_ACCESSORS.org({ organization: { name: 'Acme' } }),
    'Acme',
  );
});

test('BUILTIN_ACCESSORS.phone/address handle missing _contact', () => {
  assert.equal(BUILTIN_ACCESSORS.phone({}), '');
  assert.equal(BUILTIN_ACCESSORS.address({}), '');
  assert.equal(
    BUILTIN_ACCESSORS.phone({ _contact: { phone: '555', address: '' } }),
    '555',
  );
});
