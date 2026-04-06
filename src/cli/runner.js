/**
 * CLI lifecycle runner.
 *
 * Initializes the SDK, invokes the command handler, and guarantees the
 * DB pool is closed — even on error. Maps SDK error classes to CLI exit
 * codes so each command can simply throw.
 *
 * Exit code contract:
 *   0 — success
 *   1 — unexpected / unclassified error
 *   2 — ValidationError (bad input)
 *   3 — NotFoundError
 *   4 — ConflictError
 *   5 — ConnectionError
 *
 * On error, the message goes to stderr. Set `DEBUG=1` in the environment
 * to also print the full stack.
 *
 * Note: we assign `process.exitCode` rather than calling `process.exit()`
 * so the `finally` block can `await nt.close()` cleanly before Node exits.
 *
 * @module cli/runner
 */
const config = require('../config');
const defaultSdk = require('../sdk');

/**
 * Run a CLI command handler with SDK lifecycle + error mapping.
 *
 * @param {(nt: Object, args: Object) => Promise<void>} handler
 *   Command body. Receives the initialized SDK and parsed argv.
 * @param {Object} args - parsed argv (from `src/cli/args.js`)
 * @param {Object} [deps] - injection seam for tests
 * @param {Object} [deps.sdk=defaultSdk] - the nodeticket SDK module
 * @param {Object} [deps.cfg=config.db] - DB config block
 * @returns {Promise<void>}
 */
async function run(handler, args, deps = {}) {
  const sdk = deps.sdk || defaultSdk;
  const cfg = deps.cfg || config.db;
  const { ValidationError, NotFoundError, ConflictError, ConnectionError } = sdk.errors;

  let nt;
  try {
    nt = await sdk.init({
      dialect: cfg.dialect,
      host: cfg.host,
      port: cfg.port,
      database: cfg.name,
      user: cfg.user,
      password: cfg.password,
      prefix: cfg.prefix,
      pool: cfg.pool,
    });
    await handler(nt, args);
    process.exitCode = 0;
  } catch (err) {
    let code = 1;
    if (err instanceof ValidationError) code = 2;
    else if (err instanceof NotFoundError) code = 3;
    else if (err instanceof ConflictError) code = 4;
    else if (err instanceof ConnectionError) code = 5;

    process.stderr.write(`error: ${err.message}\n`);
    if (process.env.DEBUG === '1' && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exitCode = code;
  } finally {
    if (nt) {
      try { await nt.close(); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { run };
