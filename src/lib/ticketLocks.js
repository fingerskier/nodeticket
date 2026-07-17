/**
 * Ticket edit locks (osTicket-compatible semantics).
 *
 * Stock modes (config `ticket_lock`):
 *   0 = disabled, 1 = on view, 2 = on activity (default)
 * Duration: `autolock_minutes` (minutes).
 *
 * Nodeticket soft policy (product choice):
 *   - Acquire/renew on staff write (activity mode), not on view
 *   - Never hard-block writes; surface held-by warnings instead
 *
 * @module lib/ticketLocks
 */

const crypto = require('crypto');

const LOCK_MODE = {
  DISABLED: 0,
  ON_VIEW: 1,
  ON_ACTIVITY: 2,
};

/**
 * @param {Object} conn
 * @returns {Promise<{ enabled: boolean, mode: number, minutes: number }>}
 */
async function getLockConfig(conn) {
  let mode = LOCK_MODE.ON_ACTIVITY;
  let minutes = 3;

  try {
    const rows = await conn.query(
      `SELECT \`key\`, value FROM ${conn.table('config')}
       WHERE namespace = 'core' AND \`key\` IN ('ticket_lock', 'autolock_minutes', 'ticket_autolock')`
    );
    const map = {};
    for (const r of rows || []) map[r.key] = r.value;

    if (map.ticket_lock != null && map.ticket_lock !== '') {
      mode = parseInt(map.ticket_lock, 10);
      if (Number.isNaN(mode)) mode = LOCK_MODE.ON_ACTIVITY;
    } else if (map.ticket_autolock === '0' || map.ticket_autolock === 'false') {
      mode = LOCK_MODE.DISABLED;
    } else if (map.ticket_autolock === '1' || map.ticket_autolock === 'true') {
      mode = LOCK_MODE.ON_ACTIVITY;
    }

    if (map.autolock_minutes != null && map.autolock_minutes !== '') {
      const m = parseInt(map.autolock_minutes, 10);
      if (!Number.isNaN(m) && m >= 0) minutes = m;
    }
  } catch {
    // missing config table → defaults
  }

  const enabled = mode !== LOCK_MODE.DISABLED && minutes > 0;
  return { enabled, mode, minutes };
}

function randLockCode(len = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function isExpired(expire) {
  if (!expire) return true;
  return new Date(expire).getTime() <= Date.now();
}

/**
 * Load active (non-expired) lock for a ticket, if any.
 * @param {Object} conn
 * @param {number|string} ticketId
 */
async function getActiveLock(conn, ticketId) {
  const row = await conn.queryOne(
    `SELECT t.ticket_id, t.lock_id as ticket_lock_id,
            l.lock_id, l.staff_id, l.expire, l.code, l.created,
            CONCAT(s.firstname, ' ', s.lastname) as staff_name, s.username
     FROM ${conn.table('ticket')} t
     LEFT JOIN ${conn.table('lock')} l ON l.lock_id = t.lock_id AND t.lock_id > 0
     LEFT JOIN ${conn.table('staff')} s ON s.staff_id = l.staff_id
     WHERE t.ticket_id = ?`,
    [ticketId]
  );
  if (!row) return null;
  if (!row.lock_id || isExpired(row.expire)) return null;
  return {
    lock_id: row.lock_id,
    staff_id: row.staff_id,
    staff_name: (row.staff_name || '').trim() || row.username || `Staff #${row.staff_id}`,
    expire: row.expire,
    code: row.code,
    created: row.created,
    seconds_remaining: Math.max(0, Math.floor((new Date(row.expire).getTime() - Date.now()) / 1000)),
  };
}

/**
 * Status payload for API/UI.
 */
async function getLockStatus(conn, ticketId, staffId = null) {
  const config = await getLockConfig(conn);
  const lock = await getActiveLock(conn, ticketId);
  const heldByOther = !!(lock && staffId != null && Number(lock.staff_id) !== Number(staffId));
  const heldBySelf = !!(lock && staffId != null && Number(lock.staff_id) === Number(staffId));
  return {
    enabled: config.enabled,
    mode: config.mode,
    minutes: config.minutes,
    lock,
    held_by_other: heldByOther,
    held_by_self: heldBySelf,
    warning: heldByOther
      ? `Currently locked by ${lock.staff_name}`
      : null,
  };
}

/**
 * Acquire or renew lock for staff (stock Ticket::acquireLock).
 * Returns null if disabled, or held by someone else.
 *
 * @param {Object} conn
 * @param {number|string} ticketId
 * @param {number} staffId
 * @param {{ minutes?: number }} [opts]
 */
async function acquireLock(conn, ticketId, staffId, opts = {}) {
  const config = await getLockConfig(conn);
  if (!config.enabled) return { ok: false, reason: 'disabled', lock: null };

  const minutes = opts.minutes != null ? opts.minutes : config.minutes;
  if (!staffId || !minutes) return { ok: false, reason: 'disabled', lock: null };

  const existing = await getActiveLock(conn, ticketId);
  if (existing) {
    if (Number(existing.staff_id) !== Number(staffId)) {
      return {
        ok: false,
        reason: 'held',
        lock: existing,
        warning: `Currently locked by ${existing.staff_name}`,
      };
    }
    // Renew own lock
    await conn.query(
      `UPDATE ${conn.table('lock')} SET expire = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE lock_id = ?`,
      [minutes, existing.lock_id]
    );
    const renewed = await getActiveLock(conn, ticketId);
    return { ok: true, reason: 'renewed', lock: renewed };
  }

  // Create new lock (stock: insert lock, set ticket.lock_id)
  const code = randLockCode(10);
  const now = new Date();
  const result = await conn.query(
    `INSERT INTO ${conn.table('lock')} (staff_id, expire, code, created)
     VALUES (?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?)`,
    [staffId, minutes, code, now]
  );
  const lockId = result.insertId;
  await conn.query(
    `UPDATE ${conn.table('ticket')} SET lock_id = ?, updated = NOW() WHERE ticket_id = ?`,
    [lockId, ticketId]
  );
  const lock = await getActiveLock(conn, ticketId);
  return { ok: true, reason: 'acquired', lock };
}

/**
 * Soft touch on staff write: try acquire/renew; never blocks.
 * Returns status including optional warning when held by another agent.
 */
async function softTouchOnWrite(conn, ticketId, staffId) {
  const config = await getLockConfig(conn);
  if (!config.enabled) {
    return { enabled: false, lock: null, warning: null, touched: false };
  }
  // On-activity mode (and treat ON_VIEW the same for write paths: touch on write only)
  if (config.mode === LOCK_MODE.DISABLED) {
    return { enabled: false, lock: null, warning: null, touched: false };
  }

  const result = await acquireLock(conn, ticketId, staffId);
  if (result.ok) {
    return {
      enabled: true,
      lock: result.lock,
      warning: null,
      touched: true,
      reason: result.reason,
    };
  }
  if (result.reason === 'held') {
    return {
      enabled: true,
      lock: result.lock,
      warning: result.warning,
      touched: false,
      reason: 'held',
    };
  }
  return { enabled: true, lock: null, warning: null, touched: false, reason: result.reason };
}

/**
 * Release lock if owned by staff (or any if staffId omitted / admin force).
 */
async function releaseLock(conn, ticketId, staffId = null) {
  const ticket = await conn.queryOne(
    `SELECT ticket_id, lock_id FROM ${conn.table('ticket')} WHERE ticket_id = ?`,
    [ticketId]
  );
  if (!ticket || !ticket.lock_id) return { ok: true, released: false };

  const lock = await conn.queryOne(
    `SELECT * FROM ${conn.table('lock')} WHERE lock_id = ?`,
    [ticket.lock_id]
  );
  if (!lock) {
    await conn.query(
      `UPDATE ${conn.table('ticket')} SET lock_id = 0, updated = NOW() WHERE ticket_id = ?`,
      [ticketId]
    );
    return { ok: true, released: true };
  }

  if (staffId != null && Number(lock.staff_id) !== Number(staffId)) {
    return { ok: false, reason: 'not_owner', released: false };
  }

  await conn.query(`DELETE FROM ${conn.table('lock')} WHERE lock_id = ?`, [lock.lock_id]);
  await conn.query(
    `UPDATE ${conn.table('ticket')} SET lock_id = 0, updated = NOW() WHERE ticket_id = ? AND lock_id = ?`,
    [ticketId, lock.lock_id]
  );
  return { ok: true, released: true };
}

/**
 * Cron: remove expired locks and clear ticket.lock_id (stock Lock::cleanup + hygiene).
 */
async function cleanupExpiredLocks(conn) {
  let deleted = 0;
  try {
    // Clear ticket pointers for expired locks first
    await conn.query(`
      UPDATE ${conn.table('ticket')} t
      INNER JOIN ${conn.table('lock')} l ON l.lock_id = t.lock_id
      SET t.lock_id = 0, t.updated = NOW()
      WHERE t.lock_id > 0 AND l.expire IS NOT NULL AND l.expire < NOW()
    `);
    const result = await conn.query(
      `DELETE FROM ${conn.table('lock')} WHERE expire IS NOT NULL AND expire < NOW()`
    );
    deleted = result?.affectedRows != null ? result.affectedRows : 0;
  } catch (err) {
    return { deleted: 0, error: err.message };
  }
  return { deleted };
}

module.exports = {
  LOCK_MODE,
  getLockConfig,
  getActiveLock,
  getLockStatus,
  acquireLock,
  softTouchOnWrite,
  releaseLock,
  cleanupExpiredLocks,
  randLockCode,
  isExpired,
};
