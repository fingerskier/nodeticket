const { test } = require('node:test');
const assert = require('node:assert/strict');
const createUsersService = require('../src/sdk/services/users');

/**
 * Fake connection. Records every SQL call and returns queued responses
 * keyed by a matcher function. This lets us assert not only the return
 * value but the shape of the SQL (critical for regression guards).
 */
function makeFakeConn(queryHandler) {
  const calls = [];
  return {
    calls,
    table: (name) => `ost_${name}`,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return queryHandler({ sql, params }) ?? [];
    },
    queryOne: async () => null,
    queryValue: async () => null,
  };
}

test('listUserFormFields: discovers via form_entry first', async () => {
  let discoveryQueried = false;
  let fallbackQueried = false;
  const conn = makeFakeConn(({ sql }) => {
    if (sql.includes('DISTINCT form_id') && sql.includes('form_entry')) {
      discoveryQueried = true;
      return [{ form_id: 1 }];
    }
    if (sql.includes("WHERE type = 'U'")) {
      fallbackQueried = true;
      return [];
    }
    if (sql.includes('FROM ost_form_field')) {
      return [
        { id: 36, form_id: 1, name: 'franchID', label: 'Franchise ID #', type: 'text', sort: 1 },
        { id: 202, form_id: 1, name: 'CenterPhone', label: 'Center Phone', type: 'phone', sort: 2 },
      ];
    }
    return [];
  });

  const users = createUsersService(conn, {});
  const fields = await users.listUserFormFields();

  assert.equal(discoveryQueried, true, 'should try form_entry discovery first');
  assert.equal(fallbackQueried, false, 'should NOT fall back when discovery succeeds');
  assert.equal(fields.length, 2);
  assert.equal(fields[0].name, 'franchID');
  assert.equal(fields[1].name, 'CenterPhone');
});

test('listUserFormFields: falls back to form.type="U" when discovery is empty', async () => {
  let fallbackQueried = false;
  const conn = makeFakeConn(({ sql }) => {
    if (sql.includes('DISTINCT form_id') && sql.includes('form_entry')) {
      return [];
    }
    if (sql.includes('FROM ost_form') && sql.includes("type = 'U'")) {
      fallbackQueried = true;
      return [{ id: 2 }];
    }
    if (sql.includes('FROM ost_form_field')) {
      return [{ id: 7, form_id: 2, name: 'x', label: 'X', type: 'text', sort: 0 }];
    }
    return [];
  });

  const users = createUsersService(conn, {});
  const fields = await users.listUserFormFields();

  assert.equal(fallbackQueried, true);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].name, 'x');
});

test('listUserFormFields: returns empty array when nothing at all', async () => {
  const conn = makeFakeConn(() => []);
  const users = createUsersService(conn, {});
  const fields = await users.listUserFormFields();
  assert.deepEqual(fields, []);
});

// Regression guard for BUG #1487: discovery must NOT require form.type='U'.
// On the OsteoStrong install, the user form did not have type='U'.
test('REGRESSION: listUserFormFields does not JOIN form ON type="U" during discovery', async () => {
  const conn = makeFakeConn(({ sql }) => {
    if (sql.includes('DISTINCT form_id') && sql.includes('form_entry')) {
      return [{ form_id: 1 }];
    }
    if (sql.includes('FROM ost_form_field')) {
      return [{ id: 1, form_id: 1, name: 'a', label: 'A', type: 'text', sort: 0 }];
    }
    return [];
  });
  const users = createUsersService(conn, {});
  await users.listUserFormFields();

  // Neither the discovery nor the field-list query may filter on form.type.
  // (object_type='U' on form_entry is fine and required.)
  const forbidsFormType = (sql) =>
    !/\bf\.type\s*=/.test(sql) && !/\bform\.type\s*=/.test(sql);

  assert.ok(
    forbidsFormType(conn.calls[0].sql),
    'discovery query must not filter on form.type',
  );
  assert.ok(
    forbidsFormType(conn.calls[1].sql),
    'field-list query must not filter on form.type',
  );
});

test('getFormValuesBulk: empty userIds → empty map, no SQL', async () => {
  const conn = makeFakeConn(() => []);
  const users = createUsersService(conn, {});
  const m = await users.getFormValuesBulk([], ['x']);
  assert.equal(m.size, 0);
  assert.equal(conn.calls.length, 0);
});

test('getFormValuesBulk: empty fieldNames → empty inner maps, no SQL', async () => {
  const conn = makeFakeConn(() => []);
  const users = createUsersService(conn, {});
  const m = await users.getFormValuesBulk([1, 2], []);
  assert.equal(m.size, 2);
  assert.equal(m.get(1).size, 0);
  assert.equal(m.get(2).size, 0);
  assert.equal(conn.calls.length, 0);
});

test('getFormValuesBulk: maps rows by user id and field name', async () => {
  const conn = makeFakeConn(() => [
    { user_id: 1, field_name: 'franchID', value: '00123' },
    { user_id: 1, field_name: 'CenterPhone', value: '555-0100' },
    { user_id: 2, field_name: 'franchID', value: '00456' },
  ]);
  const users = createUsersService(conn, {});
  const m = await users.getFormValuesBulk([1, 2, 3], ['franchID', 'CenterPhone']);

  assert.equal(m.get(1).get('franchID'), '00123');
  assert.equal(m.get(1).get('CenterPhone'), '555-0100');
  assert.equal(m.get(2).get('franchID'), '00456');
  assert.equal(m.get(2).get('CenterPhone'), undefined);
  // User 3 had no form entries but should still be represented.
  assert.equal(m.get(3).size, 0);
});

// Regression: this SQL must NOT JOIN form ON type='U' either.
test('REGRESSION: getFormValuesBulk does not filter on form.type', async () => {
  const conn = makeFakeConn(() => []);
  const users = createUsersService(conn, {});
  await users.getFormValuesBulk([1], ['x']);
  const sql = conn.calls[0].sql;
  assert.ok(!/\bf\.type\s*=/.test(sql), 'must not filter on form.type');
  assert.ok(!/\bform\.type\s*=/.test(sql), 'must not filter on form.type');
  assert.ok(sql.includes("object_type = 'U'"), 'must still scope to users');
});

test('getContactInfoBulk: normalizes phone and address, empty defaults', async () => {
  const conn = makeFakeConn(() => [
    { user_id: 1, field_name: 'phone', value: '555' },
    { user_id: 2, field_name: 'address', value: '1 Main' },
  ]);
  const users = createUsersService(conn, {});
  const m = await users.getContactInfoBulk([1, 2, 3]);
  assert.deepEqual(m.get(1), { phone: '555', address: '' });
  assert.deepEqual(m.get(2), { phone: '', address: '1 Main' });
  assert.deepEqual(m.get(3), { phone: '', address: '' });
});

test('getContactInfoBulk: empty ids → empty map', async () => {
  const conn = makeFakeConn(() => []);
  const users = createUsersService(conn, {});
  const m = await users.getContactInfoBulk([]);
  assert.equal(m.size, 0);
});
