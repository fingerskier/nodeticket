/**
 * CLI lifecycle runner.
 * Initializes the SDK, invokes the command handler, and ensures the
 * connection is closed. Maps SDK errors to exit codes.
 */
const config = require('../config');
const nodeticket = require('../sdk');
const { ValidationError, NotFoundError, ConflictError, ConnectionError } = nodeticket.errors;

async function run(handler, args) {
  let nt;
  try {
    nt = await nodeticket.init({
      dialect: config.db.dialect,
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      prefix: config.db.prefix,
      pool: config.db.pool,
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
