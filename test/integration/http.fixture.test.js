/**
 * HTTP integration tests against the Docker MySQL fixture.
 *
 * Setup:
 *   npm run fixture:up
 *   npm run fixture:bootstrap
 *   npm run test:http
 *
 * Skips cleanly when MySQL fixture is not reachable.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  fixtureAvailable,
  startTestServer,
  stopTestServer,
  jsonFetch,
  FIXTURE_API_KEY,
} = require('./helpers');

let enabled = false;
let server;
let baseUrl;

before(async () => {
  enabled = await fixtureAvailable();
  if (!enabled) {
    console.log(
      'SKIP integration: MySQL fixture not available. Run: npm run fixture:up && npm run fixture:bootstrap'
    );
    return;
  }
  ({ server, baseUrl } = await startTestServer());
});

after(async () => {
  await stopTestServer(server);
});

function skipIfNoFixture(t) {
  if (!enabled) {
    t.skip('fixture unavailable');
    return true;
  }
  return false;
}

describe('fixture HTTP: auth', () => {
  test('customer login returns JWT + user', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await jsonFetch(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'customer', password: 'password123', type: 'user' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.success, true);
    assert.ok(res.json.token);
    assert.equal(res.json.user.type, 'user');
    assert.equal(res.json.user.id, 1);
  });

  test('staff login returns admin principal', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await jsonFetch(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'admin', password: 'password123', type: 'staff' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.type, 'staff');
    assert.equal(res.json.user.isAdmin, true);
  });

  test('bad password → 401', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await jsonFetch(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'customer', password: 'wrong', type: 'user' },
    });
    assert.equal(res.status, 401);
  });
});

describe('fixture HTTP: native tickets', () => {
  let userToken;
  let staffToken;
  let createdId;

  test('user creates ticket', async (t) => {
    if (skipIfNoFixture(t)) return;
    const login = await jsonFetch(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'customer', password: 'password123', type: 'user' },
    });
    userToken = login.json.token;

    const res = await jsonFetch(baseUrl, 'POST', '/api/v1/tickets', {
      token: userToken,
      body: {
        topic_id: 1,
        subject: 'Integration test ticket',
        message: 'Please help with fixture create.',
      },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.success, true);
    assert.ok(res.json.data.ticket_id);
    assert.ok(res.json.data.number);
    createdId = res.json.data.ticket_id;
  });

  test('user lists own tickets', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await jsonFetch(baseUrl, 'GET', '/api/v1/tickets', {
      token: userToken,
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.data));
    assert.ok(res.json.data.some((x) => x.ticket_id === createdId));
  });

  test('user replies and closes via named action', async (t) => {
    if (skipIfNoFixture(t)) return;
    const reply = await jsonFetch(baseUrl, 'POST', `/api/v1/tickets/${createdId}/reply`, {
      token: userToken,
      body: { message: 'Following up on my ticket.' },
    });
    assert.equal(reply.status, 201, reply.text);

    const thread = await jsonFetch(baseUrl, 'GET', `/api/v1/tickets/${createdId}/thread`, {
      token: userToken,
    });
    assert.equal(thread.status, 200, thread.text);
    // Customer must not see internal notes (none yet) — types only M/R
    for (const e of thread.json.data || []) {
      assert.notEqual(e.type, 'N');
    }

    const close = await jsonFetch(baseUrl, 'PUT', `/api/v1/tickets/${createdId}`, {
      token: userToken,
      body: { action: 'close' },
    });
    assert.equal(close.status, 200, close.text);

    const reopen = await jsonFetch(baseUrl, 'PUT', `/api/v1/tickets/${createdId}`, {
      token: userToken,
      body: { action: 'reopen' },
    });
    assert.equal(reopen.status, 200, reopen.text);
  });

  test('staff note not visible to customer thread', async (t) => {
    if (skipIfNoFixture(t)) return;
    const login = await jsonFetch(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'admin', password: 'password123', type: 'staff' },
    });
    staffToken = login.json.token;

    const note = await jsonFetch(baseUrl, 'POST', `/api/v1/tickets/${createdId}/note`, {
      token: staffToken,
      body: { title: 'Internal', note: 'Secret staff note' },
    });
    // empty role permissions => unrestricted agent (hasPermission)
    assert.ok([201, 403].includes(note.status), note.text);
    if (note.status === 201) {
      const staffThread = await jsonFetch(baseUrl, 'GET', `/api/v1/tickets/${createdId}/thread`, {
        token: staffToken,
      });
      assert.ok((staffThread.json.data || []).some((e) => e.type === 'N'));

      const userThread = await jsonFetch(baseUrl, 'GET', `/api/v1/tickets/${createdId}/thread`, {
        token: userToken,
      });
      assert.ok(!(userThread.json.data || []).some((e) => e.type === 'N'));
    }
  });
});

describe('fixture HTTP: official API', () => {
  test('POST /api/tickets.json with key creates ticket, bare number body', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await fetch(`${baseUrl}/api/tickets.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': FIXTURE_API_KEY,
      },
      body: JSON.stringify({
        name: 'API User',
        email: 'api-user@fixture.test',
        subject: 'Legacy JSON create',
        message: 'Created via official path',
        topicId: 1,
        source: 'API',
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    assert.ok(text.trim().length > 0);
    assert.ok(!text.trim().startsWith('{'), 'expected bare ticket number, not JSON');
  });

  test('POST /api/tickets.json without key → 401 plain text', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await fetch(`${baseUrl}/api/tickets.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'X',
        email: 'x@y.z',
        subject: 'No',
        message: 'Key',
      }),
    });
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.match(text, /API key/i);
  });

  test('POST /api/tickets.xml creates ticket', async (t) => {
    if (skipIfNoFixture(t)) return;
    const xml = `<?xml version="1.0"?>
      <ticket>
        <name>XML User</name>
        <email>xml-user@fixture.test</email>
        <subject>XML create</subject>
        <message>From XML path</message>
        <topicId>1</topicId>
      </ticket>`;
    const res = await fetch(`${baseUrl}/api/tickets.xml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'X-API-Key': FIXTURE_API_KEY,
      },
      body: xml,
    });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    assert.ok(text.trim().length > 0);
  });

  test('POST /api/tasks/cron returns Completed', async (t) => {
    if (skipIfNoFixture(t)) return;
    const res = await fetch(`${baseUrl}/api/tasks/cron`, {
      method: 'POST',
      headers: { 'X-API-Key': FIXTURE_API_KEY },
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.equal(text.trim(), 'Completed');
  });
});

describe('fixture HTTP: purpose token isolation', () => {
  test('password-reset JWT cannot call /auth/me', async (t) => {
    if (skipIfNoFixture(t)) return;
    const { signPurposeToken, TOKEN_USE } = require('../../src/lib/tokens');
    // Ensure config secrets match running app (set in helpers applyFixtureEnv)
    const token = signPurposeToken(
      { id: 1, type: 'user' },
      TOKEN_USE.PASSWORD_RESET,
      '1h'
    );
    const res = await jsonFetch(baseUrl, 'GET', '/api/v1/auth/me', { token });
    assert.equal(res.status, 401, res.text);
  });
});
