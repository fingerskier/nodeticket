const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLegacyCreateBody,
  formatLegacyCreateError,
} = require('../src/lib/legacyTicketApi');
const createTicketService = require('../src/sdk/services/tickets');

describe('parseLegacyCreateBody', () => {
  test('accepts stock core fields', () => {
    const r = parseLegacyCreateBody({
      email: 'user@example.com',
      name: 'Jane Doe',
      subject: 'Help',
      message: 'Broken printer',
      topicId: 3,
      source: 'API',
      alert: false,
      autorespond: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.email, 'user@example.com');
    assert.equal(r.data.topicId, 3);
    assert.equal(r.data.alert, false);
    assert.equal(r.data.autorespond, true);
  });

  test('rejects missing email/name/subject/message', () => {
    assert.equal(parseLegacyCreateBody({ name: 'A', subject: 'S', message: 'M' }).ok, false);
    assert.equal(parseLegacyCreateBody({ email: 'a@b.c', subject: 'S', message: 'M' }).ok, false);
    assert.equal(parseLegacyCreateBody({ email: 'a@b.c', name: 'A', message: 'M' }).ok, false);
    assert.equal(parseLegacyCreateBody({ email: 'a@b.c', name: 'A', subject: 'S' }).ok, false);
  });

  test('rejects invalid email', () => {
    const r = parseLegacyCreateBody({
      email: 'not-an-email',
      name: 'A',
      subject: 'S',
      message: 'M',
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.message, /valid email/i);
  });

  test('maps snake_case aliases and default source', () => {
    const r = parseLegacyCreateBody({
      email: 'a@b.co',
      name: 'A',
      subject: 'S',
      body: 'Message via body alias',
      topic_id: 9,
      staff_id: 2,
      sla_id: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.message, 'Message via body alias');
    assert.equal(r.data.topicId, 9);
    assert.equal(r.data.staffId, 2);
    assert.equal(r.data.slaId, 1);
    assert.equal(r.data.source, 'API');
  });

  test('parses data-URL and list attachments as array', () => {
    const r = parseLegacyCreateBody({
      email: 'a@b.co',
      name: 'A',
      subject: 'S',
      message: 'M',
      attachments: [
        { name: 'a.txt', data: 'data:text/plain;base64,SGk=' },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.attachments.length, 1);
  });

  test('formatLegacyCreateError prefix', () => {
    assert.equal(
      formatLegacyCreateError('boom'),
      'Unable to create new ticket : boom'
    );
  });
});

describe('tickets.create for official API options', () => {
  function makeConn(opts = {}) {
    const calls = [];
    let nextId = 50;
    const topic = opts.topic || {
      topic_id: 2,
      ispublic: 0,
      flags: 1,
      dept_id: 1,
      staff_id: 4,
      team_id: 0,
      sla_id: 0,
      status_id: 0,
      sequence_id: 0,
      number_format: null,
      dept_name: 'Private',
    };

    const run = async (sql, params = []) => {
      calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM .*help_topic/i.test(s)) {
        if (opts.noTopic) return [];
        return [topic];
      }
      if (/FROM .*user\b/i.test(s) && /default_email/i.test(s)) {
        return [{ id: 5, name: 'Alice', default_email_id: 1 }];
      }
      if (/FROM .*ticket_status/i.test(s)) {
        return [{ id: 1, state: 'open', sort: 1 }];
      }
      if (/FROM .*sequence/i.test(s)) return [];
      if (/INSERT INTO .*ticket\b/i.test(s) && !/cdata|thread/i.test(s)) {
        return { insertId: nextId++ };
      }
      if (/INSERT INTO .*ticket__cdata/i.test(s)) return { insertId: 0 };
      if (/INSERT INTO .*thread\b/i.test(s) && !/entry|event/i.test(s)) {
        return { insertId: nextId++ };
      }
      if (/INSERT INTO .*thread_entry/i.test(s)) return { insertId: nextId++ };
      if (/INSERT INTO .*thread_event/i.test(s)) return { insertId: nextId++ };
      if (/INSERT INTO .*file\b/i.test(s)) return { insertId: nextId++ };
      if (/INSERT INTO .*file_chunk/i.test(s)) return { insertId: 0 };
      if (/INSERT INTO .*attachment/i.test(s)) return { insertId: nextId++ };
      if (/FROM .*event\b/i.test(s)) return [{ id: 10, name: 'created' }];
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
      transaction: async (fn) => {
        const txQuery = run;
        const txQueryOne = async (sql, params) => {
          const rows = await run(sql, params);
          return Array.isArray(rows) ? rows[0] || null : rows;
        };
        return fn(txQuery, txQueryOne);
      },
    };
  }

  test('create without topicId succeeds', async () => {
    const conn = makeConn({ noTopic: true });
    // when topicId omitted, help_topic is not queried — noTopic only matters if queried
    const tickets = createTicketService(conn, {});
    const result = await tickets.create({
      userId: 5,
      subject: 'No topic',
      body: 'Hello',
      source: 'API',
      allowPrivateTopic: true,
    });
    assert.ok(result.number);
    assert.equal(result.topic_id, null);
  });

  test('create allowPrivateTopic uses private topic', async () => {
    const conn = makeConn();
    const tickets = createTicketService(conn, {});
    const result = await tickets.create({
      userId: 5,
      topicId: 2,
      subject: 'Private topic',
      body: 'Body',
      allowPrivateTopic: true,
    });
    assert.equal(result.staff_id, 4);
    assert.equal(result.department, 'Private');
    // private path SQL must not require ispublic = 1 only when allowPrivateTopic
    const topicQuery = conn.calls.find((c) => /help_topic/i.test(c.sql));
    assert.ok(topicQuery);
    assert.ok(!/ispublic = 1/.test(topicQuery.sql) || topicQuery.sql.includes('flags'));
  });

  test('create stores RFC2397 attachment', async () => {
    const conn = makeConn();
    const tickets = createTicketService(conn, {});
    await tickets.create({
      userId: 5,
      topicId: 2,
      subject: 'With file',
      body: 'See attach',
      allowPrivateTopic: true,
      attachments: [
        { name: 'hi.txt', data: 'data:text/plain;base64,SGk=' },
      ],
    });
    assert.ok(conn.calls.some((c) => /INSERT INTO ost_file\b/.test(c.sql)));
    assert.ok(conn.calls.some((c) => /INSERT INTO ost_file_chunk/.test(c.sql)));
    assert.ok(conn.calls.some((c) => /INSERT INTO ost_attachment/.test(c.sql)));
  });
});
