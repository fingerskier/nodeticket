/**
 * change-password — admin reset of a user's password.
 *
 * Usage:
 *   nodeticket change-password --user-id <id> --password <new>
 *   nodeticket change-password --email <addr> --password <new>
 */
const { ValidationError, NotFoundError } = require('../../sdk/errors');

const describe = "Reset a user's password (admin override)";

const help = `
Usage: nodeticket change-password [options]

Options:
  --user-id <id>     User ID to reset
  --email <addr>     Resolve user by email address
  --password <new>   New password (min 8 chars)

Exactly one of --user-id or --email is required.
`.trim();

/**
 * Resolve a user id by email address.
 *
 * `nt.users.list`'s `search` filter performs a name-OR-email LIKE match,
 * so multiple rows may come back for a given needle. This pages through
 * results (100/page) and picks the first exact case-insensitive email
 * match on `user.email` (the default_email_id join from user_email).
 *
 * @param {Object} nt - initialized SDK instance
 * @param {string} email - exact email address to look up
 * @returns {Promise<number>} matching user id
 * @throws {NotFoundError} if no user matches
 */
async function resolveUserIdByEmail(nt, email) {
  let page = 1;
  while (true) {
    const { data, pagination } = await nt.users.list({ search: email, page, limit: 100 });
    const hit = data.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (page >= pagination.totalPages) break;
    page++;
  }
  throw new NotFoundError(`No user found with email ${email}`);
}

async function handler(nt, args) {
  if (args.help || args.h) {
    process.stdout.write(help + '\n');
    return;
  }

  const password = args.password;
  if (!password) throw new ValidationError('--password is required');

  const userIdArg = args['user-id'];
  const email = args.email;

  if ((userIdArg && email) || (!userIdArg && !email)) {
    throw new ValidationError('Provide exactly one of --user-id or --email');
  }

  let userId;
  if (userIdArg) {
    userId = parseInt(userIdArg, 10);
    if (!Number.isFinite(userId)) throw new ValidationError('--user-id must be an integer');
    // Confirm user exists (throws NotFoundError otherwise)
    await nt.users.get(userId);
  } else {
    userId = await resolveUserIdByEmail(nt, email);
  }

  await nt.auth.setPassword('user', userId, password);
  process.stdout.write(`ok user=${userId}\n`);
}

/** @type {import('./').CliCommand} */
module.exports = { describe, help, handler };
