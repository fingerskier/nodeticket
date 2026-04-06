const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli/runner');

// Build a fake SDK module shaped like real one.
function makeFakeSdk() {
  class NodeticketError extends Error {}
  class ValidationError extends NodeticketError {}
  class NotFoundError extends NodeticketError {}
  class ConflictError extends NodeticketError {}
  class ConnectionError extends NodeticketError {}

  const state = { closed: false, initCalled: 0 };
  const sdk = {
    errors: { ValidationError, NotFoundError, ConflictError, ConnectionError },
    init: async () => {
      state.initCalled++;
      return { close: async () => { state.closed = true; } };
    },
    __state: state,
    __errors: { ValidationError, NotFoundError, ConflictError, ConnectionError },
  };
  return sdk;
}

const fakeCfg = {
  dialect: 'mysql', host: 'h', port: 3306, name: 'db', user: 'u',
  password: 'p', prefix: 'ost_', pool: { min: 1, max: 2 },
};

test('success → exitCode 0 and close() called', async () => {
  const sdk = makeFakeSdk();
  let handlerRan = false;
  await run(async () => { handlerRan = true; }, {}, { sdk, cfg: fakeCfg });
  assert.equal(handlerRan, true);
  assert.equal(process.exitCode, 0);
  assert.equal(sdk.__state.closed, true);
});

test('ValidationError → exitCode 2', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new sdk.__errors.ValidationError('bad'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(process.exitCode, 2);
  assert.equal(sdk.__state.closed, true);
});

test('NotFoundError → exitCode 3', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new sdk.__errors.NotFoundError('nope'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(process.exitCode, 3);
});

test('ConflictError → exitCode 4', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new sdk.__errors.ConflictError('dup'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(process.exitCode, 4);
});

test('ConnectionError → exitCode 5', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new sdk.__errors.ConnectionError('down'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(process.exitCode, 5);
});

test('unknown error → exitCode 1', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new Error('boom'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(process.exitCode, 1);
});

test('close() still called when handler throws', async () => {
  const sdk = makeFakeSdk();
  await run(async () => { throw new Error('x'); }, {}, { sdk, cfg: fakeCfg });
  assert.equal(sdk.__state.closed, true);
});

test('init is called exactly once per run', async () => {
  const sdk = makeFakeSdk();
  await run(async () => {}, {}, { sdk, cfg: fakeCfg });
  assert.equal(sdk.__state.initCalled, 1);
});
