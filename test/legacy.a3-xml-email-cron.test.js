const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseTicketXml } = require('../src/lib/legacyTicketXml');
const {
  parseTicketEmail,
  extractTicketNumberFromSubject,
  parseFrom,
  cleanMessageId,
} = require('../src/lib/legacyTicketEmail');
const { parseLegacyCreateBody } = require('../src/lib/legacyTicketApi');
const { runTicketMonitor, runAllCronJobs } = require('../src/lib/cron');

describe('legacy XML parse', () => {
  test('parses stock-like ticket XML', () => {
    const xml = `<?xml version="1.0"?>
      <ticket>
        <name>Jane Doe</name>
        <email>jane@example.com</email>
        <subject>Need help</subject>
        <message type="text/plain">Printer is broken</message>
        <topicId>2</topicId>
        <source>API</source>
        <alert>false</alert>
        <attachments>
          <file name="note.txt" type="text/plain" encoding="base64">SGk=</file>
        </attachments>
      </ticket>`;

    const r = parseTicketXml(xml);
    assert.equal(r.ok, true);
    assert.equal(r.data.email, 'jane@example.com');
    assert.equal(r.data.name, 'Jane Doe');
    assert.equal(r.data.subject, 'Need help');
    assert.equal(r.data.message, 'Printer is broken');
    assert.equal(r.data.topicId, '2');
    assert.equal(r.data.alert, false);
    assert.equal(r.data.attachments.length, 1);
    assert.equal(r.data.attachments[0].name, 'note.txt');

    const validated = parseLegacyCreateBody(r.data);
    assert.equal(validated.ok, true);
    assert.equal(validated.data.topicId, 2);
  });

  test('rejects empty/invalid XML', () => {
    assert.equal(parseTicketXml('').ok, false);
    assert.equal(parseTicketXml('<ticket><name>x</name>').ok, false);
  });
});

describe('legacy email parse', () => {
  test('parses simple text email', () => {
    const raw = [
      'From: "Alice" <alice@example.com>',
      'Subject: Help me',
      'Message-ID: <abc123@mail.example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'My laptop will not boot.',
    ].join('\r\n');

    const r = parseTicketEmail(raw);
    assert.equal(r.ok, true);
    assert.equal(r.data.email, 'alice@example.com');
    assert.equal(r.data.name, 'Alice');
    assert.equal(r.data.subject, 'Help me');
    assert.match(r.data.message, /laptop/i);
    assert.equal(r.data.mid, 'abc123@mail.example.com');
    assert.equal(r.data.source, 'Email');
  });

  test('extracts ticket number from subject', () => {
    assert.equal(extractTicketNumberFromSubject('[#0042] Re: Help'), '0042');
    assert.equal(extractTicketNumberFromSubject('[Ticket#ABC12] reply'), 'ABC12');
    assert.equal(extractTicketNumberFromSubject('Re: Ticket #99'), '99');
  });

  test('parseFrom and cleanMessageId', () => {
    assert.deepEqual(parseFrom('Bob <bob@x.com>'), { name: 'Bob', email: 'bob@x.com' });
    assert.equal(cleanMessageId('<id@host>'), 'id@host');
  });

  test('multipart with attachment', () => {
    const raw = [
      'From: user@example.com',
      'Subject: With attach',
      'Content-Type: multipart/mixed; boundary="BOUND"',
      '',
      '--BOUND',
      'Content-Type: text/plain',
      '',
      'See attached',
      '--BOUND',
      'Content-Type: text/plain; name="a.txt"',
      'Content-Disposition: attachment; filename="a.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      'SGk=',
      '--BOUND--',
    ].join('\r\n');

    const r = parseTicketEmail(raw);
    assert.equal(r.ok, true);
    assert.match(r.data.message, /See attached/);
    assert.equal(r.data.attachments.length, 1);
    assert.equal(r.data.attachments[0].name, 'a.txt');
  });
});

describe('cron TicketMonitor', () => {
  test('runTicketMonitor issues overdue update SQL', async () => {
    const calls = [];
    const conn = {
      table: (n) => `ost_${n}`,
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { affectedRows: 3 };
      },
    };
    const result = await runTicketMonitor(conn);
    assert.equal(result.name, 'TicketMonitor');
    assert.equal(result.status, 'ok');
    assert.equal(result.updated, 3);
    assert.ok(calls[0].sql.includes('isoverdue'));
    assert.ok(calls[0].sql.includes('duedate'));
  });

  test('runAllCronJobs returns TicketMonitor + skipped jobs', async () => {
    const conn = {
      table: (n) => `ost_${n}`,
      query: async () => ({ affectedRows: 0 }),
    };
    const { tasks, elapsedMs } = await runAllCronJobs(conn);
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.some((t) => t.name === 'TicketMonitor'));
    assert.ok(tasks.some((t) => t.name === 'MailFetcher' && t.status === 'skipped'));
    assert.equal(typeof elapsedMs, 'number');
  });
});
