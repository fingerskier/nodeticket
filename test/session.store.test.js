/**
 * Session store factory — Memory default; Redis only when peers + env set.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('createSessionStore', () => {
  let prevStore;
  let prevUrl;

  before(() => {
    prevStore = process.env.SESSION_STORE;
    prevUrl = process.env.REDIS_URL;
  });

  after(() => {
    if (prevStore === undefined) delete process.env.SESSION_STORE;
    else process.env.SESSION_STORE = prevStore;
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
    // Clear module cache so env re-reads if anything cached later
    delete require.cache[require.resolve('../src/lib/sessionStore')];
  });

  test('default is memory with no store instance', () => {
    delete process.env.SESSION_STORE;
    delete process.env.REDIS_URL;
    delete require.cache[require.resolve('../src/lib/sessionStore')];
    const { createSessionStore } = require('../src/lib/sessionStore');
    const r = createSessionStore();
    assert.equal(r.name, 'memory');
    assert.equal(r.store, null);
    assert.equal(r.warning, undefined);
  });

  test('SESSION_STORE=redis without REDIS_URL falls back with warning', () => {
    process.env.SESSION_STORE = 'redis';
    delete process.env.REDIS_URL;
    delete require.cache[require.resolve('../src/lib/sessionStore')];
    const { createSessionStore } = require('../src/lib/sessionStore');
    const r = createSessionStore();
    assert.equal(r.name, 'memory');
    assert.equal(r.store, null);
    assert.match(r.warning || '', /REDIS_URL/);
  });

  test('SESSION_STORE=redis with URL but no peers falls back with install hint', () => {
    process.env.SESSION_STORE = 'redis';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    delete require.cache[require.resolve('../src/lib/sessionStore')];
    const { createSessionStore } = require('../src/lib/sessionStore');
    const r = createSessionStore();
    // Without peers installed in this workspace, expect memory + warning
    if (r.name === 'memory') {
      assert.equal(r.store, null);
      assert.match(r.warning || '', /peer|install|redis/i);
    } else {
      // Peers installed in environment — still valid
      assert.equal(r.name, 'redis');
      assert.ok(r.store);
    }
  });
});
