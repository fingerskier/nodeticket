const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionError } = require('../src/sdk/errors');
const { createConnection } = require('../src/sdk/connection');
const { render, notifyTicketCreated } = require('../src/lib/ticketNotifications');
const createTicketService = require('../src/sdk/services/tickets');

describe('A4.10 PostgreSQL fail-fast', () => {
  test('createConnection rejects postgres dialect', async () => {
    await assert.rejects(
      () => createConnection({ dialect: 'postgres', database: 'osticket' }),
      (e) => e instanceof ConnectionError && /not supported/i.test(e.message)
    );
    await assert.rejects(
      () => createConnection({ dialect: 'pg', database: 'osticket' }),
      ConnectionError
    );
  });
});

describe('A4.2 ticket notification templates', () => {
  test('render replaces nested placeholders', () => {
    const out = render('Hi {{user.name}} — #{{ticket.number}}', {
      user: { name: 'Ada' },
      ticket: { number: '42' },
    });
    assert.equal(out, 'Hi Ada — #42');
  });

  test('notifyTicketCreated uses send path without throwing', async () => {
    const conn = {
      table: (n) => `ost_${n}`,
      queryOne: async () => ({
        subject: 'Ticket #{{ticket.number}}',
        body: '<p>{{user.name}}</p>',
      }),
    };
    // No AWS keys → sendEmail logs mock
    const result = await notifyTicketCreated(conn, {
      ticket: { ticket_id: 1, number: '9', subject: 'S' },
      userEmail: 'a@b.co',
      userName: 'Pat',
    });
    assert.equal(result.sent, true);
  });
});

describe('A4.1 attachment list/add on ticket service', () => {
  function makeConn() {
    const calls = [];
    let nextId = 1;
    const run = async (sql, params = []) => {
      calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM .*thread\b/i.test(s) && /SELECT th.id/i.test(s)) {
        return [{ id: 10 }];
      }
      if (/FROM .*attachment/i.test(s) && /SELECT a.id/i.test(s)) {
        return [{
          attachment_id: 1,
          file_id: 2,
          attach_name: 'a.txt',
          file_name: 'a.txt',
          mime_type: 'text/plain',
          size: 2,
          entry_id: 5,
          entry_type: 'M',
          inline: 0,
          created: new Date(),
        }];
      }
      if (/SELECT id FROM .*thread_entry/i.test(s)) return [{ id: 5 }];
      if (/INSERT INTO .*file\b/i.test(s)) return { insertId: nextId++ };
      if (/INSERT INTO .*file_chunk/i.test(s)) return { insertId: 0 };
      if (/INSERT INTO .*attachment/i.test(s)) return { insertId: nextId++ };
      return [];
    };
    return {
      calls,
      table: (n) => `ost_${n}`,
      query: run,
      queryOne: async (sql, params) => {
        const rows = await run(sql, params);
        return Array.isArray(rows) ? rows[0] || null : rows;
      },
      queryValue: async () => null,
      transaction: async (fn) => fn(run, async (sql, params) => {
        const rows = await run(sql, params);
        return Array.isArray(rows) ? rows[0] || null : rows;
      }),
    };
  }

  test('listAttachments returns mapped rows', async () => {
    const conn = makeConn();
    const tickets = createTicketService(conn, {});
    const list = await tickets.listAttachments(1);
    assert.equal(list.length, 1);
    assert.equal(list[0].file_id, 2);
    assert.equal(list[0].name, 'a.txt');
  });

  test('addAttachments stores files on latest entry', async () => {
    const conn = makeConn();
    const tickets = createTicketService(conn, {});
    await tickets.addAttachments(1, {
      attachments: [{ name: 'hi.txt', data: 'data:text/plain;base64,SGk=' }],
    });
    assert.ok(conn.calls.some((c) => /INSERT INTO ost_file\b/.test(c.sql)));
    assert.ok(conn.calls.some((c) => /INSERT INTO ost_attachment/.test(c.sql)));
  });
});

describe('A4.4 staff create on behalf (create options)', () => {
  test('create accepts userId + allowPrivateTopic for staff path kernel', async () => {
    // Ensure create still works when called with staff-like options (kernel only)
    const calls = [];
    let nextId = 100;
    const topic = {
      topic_id: 1,
      ispublic: 1,
      flags: 1,
      dept_id: 1,
      staff_id: 0,
      team_id: 0,
      sla_id: 0,
      status_id: 0,
      sequence_id: 0,
      number_format: null,
      dept_name: 'Support',
    };
    const run = async (sql, params = []) => {
      calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ');
      if (/help_topic/i.test(s)) return [topic];
      if (/ticket_status/i.test(s)) return [{ id: 1, state: 'open' }];
      if (/FROM .*user\b/i.test(s)) return [{ id: 55, name: 'Customer', default_email_id: 1 }];
      if (/sequence/i.test(s)) return [];
      if (/INSERT INTO .*ticket\b/i.test(s) && !/cdata|thread/i.test(s)) return { insertId: nextId++ };
      if (/ticket__cdata/i.test(s)) return { insertId: 0 };
      if (/INSERT INTO .*thread\b/i.test(s) && !/entry|event/i.test(s)) return { insertId: nextId++ };
      if (/thread_entry/i.test(s)) return { insertId: nextId++ };
      if (/thread_event/i.test(s)) return { insertId: nextId++ };
      if (/FROM .*event\b/i.test(s)) return [{ id: 1, name: 'created' }];
      return [];
    };
    const conn = {
      table: (n) => `ost_${n}`,
      query: run,
      queryOne: async (sql, params) => {
        const rows = await run(sql, params);
        return Array.isArray(rows) ? rows[0] || null : rows;
      },
      queryValue: async () => null,
      transaction: async (fn) => fn(run, async (sql, params) => {
        const rows = await run(sql, params);
        return Array.isArray(rows) ? rows[0] || null : rows;
      }),
    };
    const tickets = createTicketService(conn, {});
    const result = await tickets.create({
      userId: 55,
      topicId: 1,
      subject: 'On behalf',
      body: 'Opened by agent',
      source: 'API',
      allowPrivateTopic: true,
      poster: 'Agent',
    });
    assert.ok(result.ticket_id);
    assert.equal(result.subject, 'On behalf');
  });
});
