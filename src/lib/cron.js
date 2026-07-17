/**
 * Scheduled / cron job runners for official and native cron endpoints.
 * @module lib/cron
 */

/**
 * Mark open tickets past due as overdue.
 * @param {Object} conn - SDK connection (table/query helpers)
 * @returns {Promise<{ name: string, status: string, updated: number, message?: string }>}
 */
async function runTicketMonitor(conn) {
  try {
    // Open (or reopened) tickets with duedate in the past, not already overdue
    const result = await conn.query(`
      UPDATE ${conn.table('ticket')} t
      INNER JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      SET t.isoverdue = 1, t.updated = NOW()
      WHERE t.isoverdue = 0
        AND t.duedate IS NOT NULL
        AND t.duedate < NOW()
        AND ts.state IN ('open')
    `);

    const updated = result?.affectedRows != null
      ? result.affectedRows
      : (Array.isArray(result) ? 0 : (result?.affectedRows || 0));

    return {
      name: 'TicketMonitor',
      status: 'ok',
      updated: typeof updated === 'number' ? updated : 0,
      message: `Marked ${typeof updated === 'number' ? updated : 0} ticket(s) overdue`,
    };
  } catch (err) {
    return {
      name: 'TicketMonitor',
      status: 'error',
      updated: 0,
      message: err.message,
    };
  }
}

/**
 * Run all implemented cron jobs.
 * @param {Object} conn
 * @returns {Promise<{ tasks: Array, elapsedMs: number }>}
 */
/**
 * Cleanup expired ticket edit locks (stock Lock::cleanup).
 * @param {Object} conn
 */
async function runLockCleanup(conn) {
  try {
    const { cleanupExpiredLocks } = require('./ticketLocks');
    const result = await cleanupExpiredLocks(conn);
    if (result.error) {
      return {
        name: 'LockCleanup',
        status: 'error',
        updated: 0,
        message: result.error,
      };
    }
    return {
      name: 'LockCleanup',
      status: 'ok',
      updated: result.deleted || 0,
      message: `Removed ${result.deleted || 0} expired lock(s)`,
    };
  } catch (err) {
    return {
      name: 'LockCleanup',
      status: 'error',
      updated: 0,
      message: err.message,
    };
  }
}

async function runAllCronJobs(conn) {
  const started = Date.now();
  const tasks = [];

  tasks.push(await runTicketMonitor(conn));
  tasks.push(await runLockCleanup(conn));

  // Placeholders — real implementations land with inbound mail / session store
  tasks.push({
    name: 'MailFetcher',
    status: 'skipped',
    message: 'Inbound email fetch not implemented (use POST /api/tickets.email)',
  });
  tasks.push({
    name: 'CleanExpiredSessions',
    status: 'skipped',
    message: 'Session store cleanup not implemented (memory store)',
  });

  return {
    tasks,
    elapsedMs: Date.now() - started,
  };
}

module.exports = {
  runTicketMonitor,
  runLockCleanup,
  runAllCronJobs,
};
