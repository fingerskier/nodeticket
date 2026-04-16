/**
 * Seed default email template group and templates on startup.
 * Idempotent: fast-path exits if Default group + expected templates present.
 * Also seeds bulk event types used by bulk ticket operations.
 */

const db = require('./db');

const DEFAULT_TEMPLATES = [
  { code_name: 'ticket.created', subject: 'Ticket #{{ticket.number}} — {{ticket.subject}}', body: '<p>Hi {{user.name}},</p><p>Your ticket #{{ticket.number}} was created.</p><p>{{ticket.url}}</p>' },
  { code_name: 'ticket.reply', subject: 'Re: #{{ticket.number}} {{ticket.subject}}', body: '<p>Hi {{user.name}},</p><p>New reply on ticket #{{ticket.number}}.</p><p>{{ticket.url}}</p>' },
  { code_name: 'ticket.assigned', subject: 'Ticket #{{ticket.number}} assigned', body: '<p>Ticket #{{ticket.number}} has been assigned to {{staff.name}}.</p>' },
  { code_name: 'ticket.closed', subject: 'Ticket #{{ticket.number}} closed', body: '<p>Hi {{user.name}},</p><p>Your ticket #{{ticket.number}} has been closed.</p>' },
  { code_name: 'ticket.overdue', subject: 'Ticket #{{ticket.number}} overdue', body: '<p>Ticket #{{ticket.number}} is overdue.</p>' },
  { code_name: 'password.reset', subject: 'Password reset', body: '<p>Hi {{user.name}},</p><p>Use this link to reset your password: {{reset.url}}</p>' },
  { code_name: 'email.verify', subject: 'Verify your email', body: '<p>Hi {{user.name}},</p><p>Please verify your email: {{verify.url}}</p>' },
];

const BULK_EVENTS = [
  { name: 'bulk_assign', description: 'Bulk assign operation' },
  { name: 'bulk_close', description: 'Bulk close operation' },
  { name: 'bulk_delete', description: 'Bulk delete operation' },
];

async function seedEmailTemplates() {
  try {
    // Fast path: check if "Default" group exists and has expected templates
    const group = await db.queryOne(
      `SELECT tpl_id FROM ${db.table('email_template_group')} WHERE name = ?`,
      ['Default']
    );

    if (group) {
      const countRow = await db.queryOne(
        `SELECT COUNT(*) as count FROM ${db.table('email_template')} WHERE tpl_id = ?`,
        [group.tpl_id]
      );
      const existingCount = parseInt(countRow?.count || 0, 10);
      if (existingCount >= DEFAULT_TEMPLATES.length) {
        return; // Fast path exit
      }
    }

    const now = new Date();
    let groupId = group?.tpl_id;

    if (!groupId) {
      const result = await db.query(
        `INSERT INTO ${db.table('email_template_group')} (isactive, name, lang, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?)`,
        [1, 'Default', 'en_US', 'Default email template set', now, now]
      );
      groupId = result?.insertId || result?.lastInsertId || result?.id;
    }

    for (const tpl of DEFAULT_TEMPLATES) {
      const exists = await db.queryOne(
        `SELECT id FROM ${db.table('email_template')} WHERE tpl_id = ? AND code_name = ?`,
        [groupId, tpl.code_name]
      );
      if (!exists) {
        await db.query(
          `INSERT INTO ${db.table('email_template')} (tpl_id, code_name, subject, body, notes, created, updated)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [groupId, tpl.code_name, tpl.subject, tpl.body, null, now, now]
        );
      }
    }

    console.log(`Seeded ${DEFAULT_TEMPLATES.length} email templates in Default group`);
  } catch (e) {
    console.warn('Email template seeding skipped:', e.message);
  }
}

async function seedBulkEvents() {
  try {
    for (const ev of BULK_EVENTS) {
      const exists = await db.queryOne(
        `SELECT id FROM ${db.table('event')} WHERE name = ?`,
        [ev.name]
      );
      if (!exists) {
        await db.query(
          `INSERT INTO ${db.table('event')} (name, description) VALUES (?, ?)`,
          [ev.name, ev.description]
        );
      }
    }
  } catch (e) {
    console.warn('Bulk event seeding skipped:', e.message);
  }
}

async function seed() {
  await seedEmailTemplates();
  await seedBulkEvents();
}

module.exports = { seed, seedEmailTemplates, seedBulkEvents };
