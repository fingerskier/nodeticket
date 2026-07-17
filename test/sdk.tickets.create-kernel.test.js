/**
 * Unit tests for transactional ticket create / entry / event SQL shape (A1).
 * Uses an in-memory fake connection — no live MySQL required.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const createTicketService = require('../src/sdk/services/tickets');
const { ValidationError, NotFoundError } = require('../src/sdk/errors');

/**
 * Minimal fake MySQL connection with transaction support.
 */
function makeFakeConn(seed = {}) {
  const calls = [];
  let nextId = seed.nextId || 100;

  const tables = {
    help_topic: seed.topic || {
      topic_id: 2,
      ispublic: 1,
      flags: 1,
      dept_id: 3,
      staff_id: 0,
      team_id: 0,
      sla_id: 7,
      status_id: 0,
      sequence_id: 1,
      number_format: '####',
      topic: 'General',
      dept_name: 'Support',
    },
    user: seed.user || { id: 5, name: 'Alice', default_email_id: 9 },
    ticket_status: seed.statuses || [
      { id: 1, state: 'open', sort: 1 },
      { id: 2, state: 'closed', sort: 1 },
    ],
    sla: seed.sla || { id: 7, grace_period: 24 },
    sequence: Object.prototype.hasOwnProperty.call(seed, 'sequence')
      ? seed.sequence
      : { id: 1, next: 42, increment: 1, padding: '0' },
    event: {
      created: { id: 10, name: 'created' },
      message: { id: 11, name: 'message' },
      note: { id: 12, name: 'note' },
    },
  };

  const runQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/FROM .*help_topic/i.test(s) && /SELECT/i.test(s)) {
      return [tables.help_topic];
    }
    if (/FROM .*user\b/i.test(s) && /default_email_id/i.test(s)) {
      return [tables.user];
    }
    if (/FROM .*ticket_status/i.test(s)) {
      if (/WHERE id = \?/i.test(s)) {
        const row = tables.ticket_status.find((r) => r.id === params[0]);
        return row ? [row] : [];
      }
      // state may be bound (?) or a SQL string literal ('open')
      let state = params[0];
      const lit = s.match(/state\s*=\s*'(\w+)'/i);
      if (lit) state = lit[1];
      if (state) {
        const row = tables.ticket_status.find((r) => r.state === state);
        return row ? [row] : [];
      }
      return tables.ticket_status.slice(0, 1);
    }
    if (/FROM .*sla\b/i.test(s)) {
      return tables.sla && tables.sla.id === params[0] ? [tables.sla] : [];
    }
    if (/FROM .*sequence/i.test(s) && /FOR UPDATE/i.test(s)) {
      return tables.sequence ? [tables.sequence] : [];
    }
    if (/UPDATE .*sequence/i.test(s)) {
      if (tables.sequence) tables.sequence.next = params[0];
      return { affectedRows: 1 };
    }
    if (/INSERT INTO .*ticket\b/i.test(s) && !/thread/i.test(s) && !/cdata/i.test(s)) {
      const id = nextId++;
      return { insertId: id, affectedRows: 1 };
    }
    if (/INSERT INTO .*ticket__cdata/i.test(s)) {
      return { insertId: 0, affectedRows: 1 };
    }
    if (/INSERT INTO .*thread\b/i.test(s) && !/entry/i.test(s) && !/event/i.test(s)) {
      const id = nextId++;
      return { insertId: id, affectedRows: 1 };
    }
    if (/INSERT INTO .*thread_entry\b/i.test(s)) {
      const id = nextId++;
      return { insertId: id, affectedRows: 1 };
    }
    if (/INSERT INTO .*thread_event\b/i.test(s)) {
      return { insertId: nextId++, affectedRows: 1 };
    }
    if (/FROM .*event\b/i.test(s) && /name = \?/i.test(s)) {
      const name = params[0];
      const row = Object.values(tables.event).find((e) => e.name === name);
      return row ? [row] : [];
    }
    if (/FROM .*ticket\b/i.test(s) && /thread_id/i.test(s)) {
      return [{
        ticket_id: params[0],
        dept_id: 3,
        team_id: 0,
        topic_id: 2,
        thread_id: 50,
      }];
    }
    if (/UPDATE .*thread\b/i.test(s) || /UPDATE .*ticket\b/i.test(s)) {
      return { affectedRows: 1 };
    }

    return [];
  };

  const query = async (sql, params) => {
    const result = await runQuery(sql, params);
    // SELECT path returns array; INSERT returns header-like object
    if (Array.isArray(result)) return result;
    return result;
  };

  const queryOne = async (sql, params) => {
    const rows = await runQuery(sql, params);
    if (Array.isArray(rows)) return rows[0] || null;
    return rows;
  };

  const queryValue = async () => null;

  const transaction = async (fn) => {
    const txQuery = async (sql, params) => runQuery(sql, params);
    const txQueryOne = async (sql, params) => {
      const rows = await runQuery(sql, params);
      if (Array.isArray(rows)) return rows[0] || null;
      return rows;
    };
    return fn(txQuery, txQueryOne);
  };

  return {
    calls,
    table: (name) => `ost_${name}`,
    query,
    queryOne,
    queryValue,
    transaction,
  };
}

describe('ticket create kernel (A1)', () => {
  test('create is transactional and uses sequence + full ticket columns', async () => {
    const conn = makeFakeConn();
    const tickets = createTicketService(conn, {});

    const result = await tickets.create({
      userId: 5,
      topicId: 2,
      subject: 'Printer broken',
      body: 'It will not print',
      source: 'Web',
    });

    assert.equal(result.number, '0042'); // number_format #### + next 42
    assert.ok(result.ticket_id);
    assert.equal(result.subject, 'Printer broken');
    assert.equal(result.sla_id, 7);
    assert.ok(result.duedate instanceof Date);

    const ticketInsert = conn.calls.find((c) =>
      /INSERT INTO ost_ticket\b/.test(c.sql) && !/cdata|thread/.test(c.sql)
    );
    assert.ok(ticketInsert, 'should INSERT into ost_ticket');
    assert.match(ticketInsert.sql, /user_email_id/);
    assert.match(ticketInsert.sql, /lastupdate/);
    assert.match(ticketInsert.sql, /sla_id/);
    assert.match(ticketInsert.sql, /staff_id/);
    assert.match(ticketInsert.sql, /team_id/);

    const entryInsert = conn.calls.find((c) => /INSERT INTO ost_thread_entry/.test(c.sql));
    assert.ok(entryInsert);
    assert.match(entryInsert.sql, /updated/);
    assert.match(entryInsert.sql, /ip_address/);
    assert.match(entryInsert.sql, /flags/);

    const eventInsert = conn.calls.find((c) => /INSERT INTO ost_thread_event/.test(c.sql));
    assert.ok(eventInsert);
    assert.match(eventInsert.sql, /thread_type/);
    assert.match(eventInsert.sql, /dept_id/);
    assert.match(eventInsert.sql, /topic_id/);
    assert.match(eventInsert.sql, /annulled/);
    assert.match(eventInsert.sql, /uid_type/);

    const seqUpdate = conn.calls.find((c) => /UPDATE ost_sequence/.test(c.sql));
    assert.ok(seqUpdate, 'should advance sequence');
    assert.equal(seqUpdate.params[0], 43);
  });

  test('create rejects missing subject/body/user', async () => {
    const tickets = createTicketService(makeFakeConn(), {});
    await assert.rejects(
      () => tickets.create({ userId: 5, topicId: 2, subject: '', body: 'x' }),
      ValidationError
    );
    await assert.rejects(
      () => tickets.create({ userId: null, topicId: 2, subject: 's', body: 'b' }),
      ValidationError
    );
  });

  test('create rolls back when transaction throws (cdata failure)', async () => {
    const conn = makeFakeConn();
    const origTx = conn.transaction;
    let rolledBack = false;
    conn.transaction = async (fn) => {
      try {
        return await origTx(async (txQuery, txQueryOne) => {
          const wrapped = async (sql, params) => {
            if (/ticket__cdata/.test(sql)) {
              throw new Error('Table ost_ticket__cdata does not exist');
            }
            return txQuery(sql, params);
          };
          return fn(wrapped, txQueryOne);
        });
      } catch (e) {
        rolledBack = true;
        throw e;
      }
    };

    const tickets = createTicketService(conn, {});
    await assert.rejects(
      () => tickets.create({
        userId: 5,
        topicId: 2,
        subject: 'S',
        body: 'B',
      }),
      /custom data|ticket__cdata/i
    );
    assert.equal(rolledBack, true);
  });

  test('reply writes updated column and event context', async () => {
    const conn = makeFakeConn();
    const tickets = createTicketService(conn, {});

    const entry = await tickets.reply(10, {
      staffId: 1,
      body: 'Working on it',
      poster: 'Agent',
    });

    assert.equal(entry.type, 'R');
    const entryInsert = conn.calls.find((c) => /INSERT INTO ost_thread_entry/.test(c.sql));
    assert.ok(entryInsert);
    assert.match(entryInsert.sql, /updated/);
    const eventInsert = conn.calls.find((c) => /INSERT INTO ost_thread_event/.test(c.sql));
    assert.ok(eventInsert);
    assert.match(eventInsert.sql, /dept_id/);
  });

  test('addNote writes type N with updated', async () => {
    const conn = makeFakeConn();
    const tickets = createTicketService(conn, {});

    const note = await tickets.addNote(10, {
      staffId: 1,
      title: 'Internal',
      body: 'Escalate to L2',
    });

    assert.equal(note.type, 'N');
    const entryInsert = conn.calls.find((c) => /INSERT INTO ost_thread_entry/.test(c.sql));
    assert.ok(entryInsert);
    assert.ok(entryInsert.params.includes('N'));
    assert.match(entryInsert.sql, /updated/);
  });

  test('reply missing ticket → NotFoundError', async () => {
    const conn = makeFakeConn();
    const orig = conn.queryOne;
    conn.queryOne = async (sql, params) => {
      if (/thread_id/i.test(sql) && /ticket/i.test(sql)) return null;
      return orig(sql, params);
    };
    // also break the transaction path
    conn.transaction = async (fn) => {
      const txQuery = conn.query;
      const txQueryOne = async () => null;
      return fn(txQuery, txQueryOne);
    };
    // Override the ticket lookup used by reply
    conn.queryOne = async (sql) => {
      if (/SELECT t\.ticket_id/.test(sql) || /thread_id/.test(sql)) return null;
      return null;
    };

    const tickets = createTicketService(conn, {});
    await assert.rejects(
      () => tickets.reply(999, { userId: 1, body: 'hi' }),
      NotFoundError
    );
  });

  test('fallback number when no sequence rows', async () => {
    const conn = makeFakeConn({ sequence: null });
    // sequence SELECT returns empty
    const tickets = createTicketService(conn, {});
    const result = await tickets.create({
      userId: 5,
      topicId: 2,
      subject: 'No seq',
      body: 'Body',
    });
    assert.ok(result.number);
    assert.ok(result.number.length >= 4);
    // not zero-padded sequence format
    assert.notEqual(result.number, '0042');
  });
});
