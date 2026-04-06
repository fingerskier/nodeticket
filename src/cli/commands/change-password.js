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

async function resolveUserIdByEmail(nt, email) {
  // users.list supports a `search` filter that matches name OR email LIKE.
  // Page through results and exact-match on email to be safe.
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

module.exports = { describe, help, handler };
