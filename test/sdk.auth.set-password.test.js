const { test } = require('node:test');
const assert = require('node:assert/strict');
const createAuthService = require('../src/sdk/services/auth');
const { ValidationError, NotFoundError } = require('../src/sdk/errors');

function makeFakeConn({ accountExists = true } = {}) {
  const calls = [];
  return {
    calls,
    table: (name) => `ost_${name}`,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return {};
    },
    queryOne: async (sql, params = []) => {
      calls.push({ sql, params });
      return accountExists ? { user_id: params[0], staff_id: params[0] } : null;
    },
    queryValue: async () => null,
  };
}

test('setPassword: missing password → ValidationError', async () => {
  const auth = createAuthService(makeFakeConn(), {});
  await assert.rejects(
    () => auth.setPassword('user', 1, ''),
    (e) => e instanceof ValidationError && /required/i.test(e.message),
  );
});

test('setPassword: password under 8 chars → ValidationError', async () => {
  const auth = createAuthService(makeFakeConn(), {});
  await assert.rejects(
    () => auth.setPassword('user', 1, 'short'),
    (e) => e instanceof ValidationError && /8 characters/.test(e.message),
  );
});

test('setPassword: missing account → NotFoundError', async () => {
  const auth = createAuthService(makeFakeConn({ accountExists: false }), {});
  await assert.rejects(
    () => auth.setPassword('user', 999, 'longenough123'),
    (e) => e instanceof NotFoundError,
  );
});

test('setPassword (user): writes to user_account.passwd', async () => {
  const conn = makeFakeConn();
  const auth = createAuthService(conn, {});
  await auth.setPassword('user', 42, 'longenough123');

  const update = conn.calls.find((c) => c.sql.includes('UPDATE ost_user_account'));
  assert.ok(update, 'should UPDATE user_account');
  assert.ok(update.sql.includes('SET passwd = ?'));
  assert.ok(update.sql.includes('WHERE user_id = ?'));
  // [hashedPassword, userId]
  assert.equal(update.params[1], 42);
  // Hashed (bcrypt), not plaintext
  assert.notEqual(update.params[0], 'longenough123');
  assert.ok(update.params[0].startsWith('$2'), 'should be a bcrypt hash');
});

test('setPassword (staff): writes to staff.passwd with updated timestamp', async () => {
  const conn = makeFakeConn();
  const auth = createAuthService(conn, {});
  await auth.setPassword('staff', 7, 'longenough123');

  const update = conn.calls.find((c) => c.sql.includes('UPDATE ost_staff'));
  assert.ok(update);
  assert.ok(update.sql.includes('passwd = ?'));
  assert.ok(update.sql.includes('updated = ?'));
  assert.ok(update.sql.includes('WHERE staff_id = ?'));
});
