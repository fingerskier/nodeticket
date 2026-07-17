/**
 * Ticket edit locks — osTicket-compatible soft lock helpers.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCK_MODE,
  getLockConfig,
  getActiveLock,
  acquireLock,
  softTouchOnWrite,
  releaseLock,
  cleanupExpiredLocks,
  isExpired,
} = require('../src/lib/ticketLocks');

function mockConn(opts = {}) {
  const state = {
    config: opts.config || {
      ticket_lock: String(LOCK_MODE.ON_ACTIVITY),
      autolock_minutes: '5',
    },
    tickets: opts.tickets || { 1: { ticket_id: 1, lock_id: 0 } },
    locks: opts.locks || {},
    nextLockId: opts.nextLockId || 1,
    calls: [],
  };

  const conn = {
    table: (n) => `ost_${n}`,
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ');

      if (/FROM ost_config/i.test(s) && /ticket_lock|autolock/i.test(s)) {
        return Object.entries(state.config).map(([key, value]) => ({ key, value }));
      }

      if (/INSERT INTO ost_lock/i.test(s)) {
        const id = state.nextLockId++;
        const staffId = params[0];
        const minutes = params[1];
        const code = params[2];
        const created = params[3];
        const expire = new Date(Date.now() + minutes * 60 * 1000);
        state.locks[id] = {
          lock_id: id,
          staff_id: staffId,
          expire,
          code,
          created,
        };
        return { insertId: id, affectedRows: 1 };
      }

      if (/UPDATE ost_lock SET expire/i.test(s)) {
        const minutes = params[0];
        const lockId = params[1];
        if (state.locks[lockId]) {
          state.locks[lockId].expire = new Date(Date.now() + minutes * 60 * 1000);
        }
        return { affectedRows: 1 };
      }

      if (/UPDATE ost_ticket SET lock_id/i.test(s) && /ticket_id/i.test(s)) {
        // variants: set lock_id = ?, or set lock_id = 0
        if (/lock_id = 0/i.test(s)) {
          const ticketId = params[0];
          if (state.tickets[ticketId]) state.tickets[ticketId].lock_id = 0;
        } else {
          const lockId = params[0];
          const ticketId = params[1];
          if (state.tickets[ticketId]) state.tickets[ticketId].lock_id = lockId;
        }
        return { affectedRows: 1 };
      }

      if (/DELETE FROM ost_lock WHERE lock_id/i.test(s)) {
        delete state.locks[params[0]];
        return { affectedRows: 1 };
      }

      if (/DELETE FROM ost_lock WHERE expire/i.test(s)) {
        let n = 0;
        for (const [id, l] of Object.entries(state.locks)) {
          if (isExpired(l.expire)) {
            delete state.locks[id];
            n++;
          }
        }
        return { affectedRows: n };
      }

      if (/UPDATE ost_ticket t[\s\S]*INNER JOIN ost_lock/i.test(s) || /INNER JOIN.*lock/i.test(s)) {
        for (const t of Object.values(state.tickets)) {
          const l = state.locks[t.lock_id];
          if (l && isExpired(l.expire)) t.lock_id = 0;
        }
        return { affectedRows: 0 };
      }

      return { affectedRows: 0 };
    },
    async queryOne(sql, params = []) {
      state.calls.push({ sql, params, one: true });
      const s = sql.replace(/\s+/g, ' ');

      if (/FROM ost_ticket t[\s\S]*LEFT JOIN ost_lock/i.test(s) || /LEFT JOIN.*ost_lock/i.test(s)) {
        const ticketId = params[0];
        const t = state.tickets[ticketId];
        if (!t) return null;
        const l = t.lock_id ? state.locks[t.lock_id] : null;
        if (!l) {
          return {
            ticket_id: ticketId,
            ticket_lock_id: t.lock_id,
            lock_id: null,
            staff_id: null,
            expire: null,
            code: null,
            created: null,
            staff_name: null,
            username: null,
          };
        }
        return {
          ticket_id: ticketId,
          ticket_lock_id: t.lock_id,
          lock_id: l.lock_id,
          staff_id: l.staff_id,
          expire: l.expire,
          code: l.code,
          created: l.created,
          staff_name: l.staff_id === 1 ? 'Ada Admin' : 'Other Agent',
          username: l.staff_id === 1 ? 'admin' : 'agent',
        };
      }

      if (/SELECT ticket_id, lock_id FROM ost_ticket/i.test(s)) {
        const t = state.tickets[params[0]];
        return t ? { ticket_id: t.ticket_id, lock_id: t.lock_id } : null;
      }

      if (/SELECT \* FROM ost_lock WHERE lock_id/i.test(s)) {
        return state.locks[params[0]] || null;
      }

      return null;
    },
  };

  return conn;
}

describe('ticketLocks config', () => {
  test('defaults to on-activity when config empty', async () => {
    const conn = mockConn({ config: {} });
    // empty config returns no rows → defaults
    conn.query = async () => [];
    const cfg = await getLockConfig(conn);
    assert.equal(cfg.mode, LOCK_MODE.ON_ACTIVITY);
    assert.equal(cfg.minutes, 3);
    assert.equal(cfg.enabled, true);
  });

  test('disabled when minutes 0', async () => {
    const conn = mockConn({
      config: { ticket_lock: '2', autolock_minutes: '0' },
    });
    const cfg = await getLockConfig(conn);
    assert.equal(cfg.enabled, false);
  });
});

describe('ticketLocks acquire / soft / release', () => {
  test('first writer acquires lock', async () => {
    const conn = mockConn();
    const r = await acquireLock(conn, 1, 1);
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'acquired');
    assert.ok(r.lock);
    assert.equal(r.lock.staff_id, 1);
    assert.equal(conn.state.tickets[1].lock_id, r.lock.lock_id);
  });

  test('same staff renews lock', async () => {
    const conn = mockConn();
    await acquireLock(conn, 1, 1);
    const r2 = await acquireLock(conn, 1, 1);
    assert.equal(r2.ok, true);
    assert.equal(r2.reason, 'renewed');
  });

  test('other staff cannot acquire — soft warning', async () => {
    const conn = mockConn();
    await acquireLock(conn, 1, 1);
    const r = await acquireLock(conn, 1, 2);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'held');
    assert.match(r.warning, /locked by/i);

    const soft = await softTouchOnWrite(conn, 1, 2);
    assert.equal(soft.touched, false);
    assert.ok(soft.warning);
  });

  test('soft touch acquires when free', async () => {
    const conn = mockConn();
    const soft = await softTouchOnWrite(conn, 1, 1);
    assert.equal(soft.touched, true);
    assert.equal(soft.warning, null);
    assert.ok(soft.lock);
  });

  test('owner can release', async () => {
    const conn = mockConn();
    await acquireLock(conn, 1, 1);
    const rel = await releaseLock(conn, 1, 1);
    assert.equal(rel.ok, true);
    assert.equal(rel.released, true);
    assert.equal(conn.state.tickets[1].lock_id, 0);
  });

  test('non-owner cannot release', async () => {
    const conn = mockConn();
    await acquireLock(conn, 1, 1);
    const rel = await releaseLock(conn, 1, 2);
    assert.equal(rel.ok, false);
    assert.equal(rel.reason, 'not_owner');
  });

  test('cleanup removes expired locks', async () => {
    const past = new Date(Date.now() - 60_000);
    const conn = mockConn({
      tickets: { 1: { ticket_id: 1, lock_id: 9 } },
      locks: {
        9: { lock_id: 9, staff_id: 1, expire: past, code: 'x', created: past },
      },
    });
    // getActiveLock should treat as free
    const active = await getActiveLock(conn, 1);
    assert.equal(active, null);

    const cleaned = await cleanupExpiredLocks(conn);
    assert.ok(cleaned.deleted >= 1);
  });
});
