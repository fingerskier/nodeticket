/**
 * Bootstrap the local MySQL fixture for integration tests.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.fixture.yml up -d
 *
 * Usage:
 *   node scripts/fixture-bootstrap.js
 *
 * Env overrides:
 *   FIXTURE_HOST (default 127.0.0.1)
 *   FIXTURE_PORT (default 3307)
 *   FIXTURE_USER (default root)
 *   FIXTURE_PASSWORD (default root)
 *   FIXTURE_DATABASE (default osticket)
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const HOST = process.env.FIXTURE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.FIXTURE_PORT || '3307', 10);
const USER = process.env.FIXTURE_USER || 'root';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'root';
const DATABASE = process.env.FIXTURE_DATABASE || 'osticket';

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'docs', 'mysql.sql');
const EXTRA = path.join(ROOT, 'test', 'fixture', 'extra-schema.sql');

async function waitForMysql(maxAttempts = 40) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const conn = await mysql.createConnection({
        host: HOST,
        port: PORT,
        user: USER,
        password: PASSWORD,
        multipleStatements: true,
      });
      await conn.query('SELECT 1');
      await conn.end();
      return;
    } catch (err) {
      if (i === maxAttempts) throw err;
      console.log(`Waiting for MySQL ${HOST}:${PORT} (${i}/${maxAttempts})…`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function runSqlFile(conn, filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skip missing SQL file: ${filePath}`);
    return;
  }
  const sql = fs.readFileSync(filePath, 'utf8');
  // Strip simple comments and run as multi-statement
  const cleaned = sql
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('--')) return '';
      return line;
    })
    .join('\n');
  await conn.query(cleaned);
  console.log(`Applied ${path.relative(ROOT, filePath)}`);
}

async function seed(conn) {
  const now = new Date();
  const passwordHash = await bcrypt.hash('password123', 10);
  // Fixed test API key (48 hex-ish chars)
  const apiKey = 'NTFIXTURETESTKEY00000000000000000000000000000001';

  // Wipe seed-able tables (order matters for FKs if any)
  const wipe = [
    'thread_entry_email', 'thread_entry', 'thread_event', 'thread_collaborator',
    'attachment', 'file_chunk', 'file',
    'ticket__cdata', 'ticket', 'thread',
    'user_account', 'user_email', 'user',
    'staff_dept_access', 'staff',
    'help_topic', 'department', 'role',
    'ticket_status', 'ticket_priority', 'sla', 'sequence',
    'event', 'api_key', 'email_template', 'email_template_group',
  ];
  for (const t of wipe) {
    try {
      await conn.query(`DELETE FROM ost_${t}`);
    } catch {
      // table may not exist yet
    }
  }

  await conn.query(`
    INSERT INTO ost_ticket_status (id, name, state, mode, flags, sort, properties, created, updated)
    VALUES
      (1, 'Open', 'open', 1, 0, 1, '{}', ?, ?),
      (2, 'Closed', 'closed', 1, 0, 2, '{}', ?, ?)
  `, [now, now, now, now]);

  await conn.query(`
    INSERT INTO ost_ticket_priority (priority_id, priority, priority_desc, priority_color, priority_urgency, ispublic)
    VALUES (1, 'Normal', 'Normal', '#777777', 2, 1)
  `);

  await conn.query(`
    INSERT INTO ost_department (id, pid, name, signature, ispublic, path, flags, created, updated)
    VALUES (1, NULL, 'Support', '', 1, '/Support', 1, ?, ?)
  `, [now, now]);

  await conn.query(`
    INSERT INTO ost_role (id, flags, name, permissions, notes, created, updated)
    VALUES (1, 1, 'Admin', NULL, 'Fixture admin role', ?, ?)
  `, [now, now]);

  await conn.query(`
    INSERT INTO ost_staff (
      staff_id, dept_id, role_id, username, firstname, lastname, passwd, email,
      phone, mobile, signature, isactive, isadmin, assigned_only, created, updated
    ) VALUES (
      1, 1, 1, 'admin', 'Ada', 'Admin', ?, 'admin@fixture.test',
      '', '', '', 1, 1, 0, ?, ?
    )
  `, [passwordHash, now, now]);

  await conn.query(`
    INSERT INTO ost_user (id, org_id, default_email_id, status, name, created, updated)
    VALUES (1, 0, 0, 0, 'Casey Customer', ?, ?)
  `, [now, now]);

  await conn.query(`
    INSERT INTO ost_user_email (id, user_id, flags, address)
    VALUES (1, 1, 0, 'customer@fixture.test')
  `);

  await conn.query(`UPDATE ost_user SET default_email_id = 1 WHERE id = 1`);

  await conn.query(`
    INSERT INTO ost_user_account (user_id, status, username, passwd, registered)
    VALUES (1, 1, 'customer', ?, ?)
  `, [passwordHash, now]);

  await conn.query(`
    INSERT INTO ost_sla (id, schedule_id, flags, grace_period, name, notes, created, updated)
    VALUES (1, 0, 3, 24, 'Default SLA', NULL, ?, ?)
  `, [now, now]);

  await conn.query(`
    INSERT INTO ost_sequence (id, name, flags, next, increment, padding, updated)
    VALUES (1, 'default', 0, 1000, 1, '0', ?)
  `, [now]);

  await conn.query(`
    INSERT INTO ost_help_topic (
      topic_id, topic_pid, ispublic, noautoresp, flags, status_id, priority_id,
      dept_id, staff_id, team_id, sla_id, page_id, sequence_id, sort, topic,
      number_format, notes, created, updated
    ) VALUES (
      1, 0, 1, 0, 1, 1, 1,
      1, 0, 0, 1, 0, 1, 1, 'General Inquiry',
      '####', NULL, ?, ?
    )
  `, [now, now]);

  const events = [
    'created', 'closed', 'reopened', 'assigned', 'transferred',
    'message', 'note', 'merged', 'bulk_assign', 'bulk_close', 'bulk_delete',
  ];
  for (const name of events) {
    await conn.query(
      `INSERT INTO ost_event (name, description) VALUES (?, ?)`,
      [name, name]
    );
  }

  await conn.query(`
    INSERT INTO ost_api_key (
      id, isactive, ipaddr, apikey, can_create_tickets, can_exec_cron, notes, created, updated
    ) VALUES (
      1, 1, '0.0.0.0', ?, 1, 1, 'Fixture integration key', ?, ?
    )
  `, [apiKey, now, now]);

  // Dynamic cdata table used by create kernel
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ost_ticket__cdata (
      ticket_id INT(11) UNSIGNED NOT NULL,
      subject VARCHAR(255) DEFAULT NULL,
      PRIMARY KEY (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('Seeded fixture identities:');
  console.log('  staff:    admin / password123');
  console.log('  customer: customer / password123');
  console.log(`  api key:  ${apiKey}`);
  console.log('  topic_id: 1 (General Inquiry)');
}

async function main() {
  console.log(`Bootstrapping fixture ${USER}@${HOST}:${PORT}/${DATABASE}`);
  await waitForMysql();

  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    multipleStatements: true,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DATABASE}\``);

  // Drop all ost_ tables for clean slate
  const [tables] = await conn.query(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = ? AND table_name LIKE 'ost\\_%'`,
    [DATABASE]
  );
  if (tables.length) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) {
      const name = row.t || row.TABLE_NAME || Object.values(row)[0];
      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Dropped ${tables.length} existing ost_* tables`);
  }

  await runSqlFile(conn, SCHEMA);
  await runSqlFile(conn, EXTRA);
  await seed(conn);

  // Grant osticket user full access (compose creates user for empty DB only)
  try {
    await conn.query(
      `CREATE USER IF NOT EXISTS 'osticket'@'%' IDENTIFIED BY 'osticket'`
    );
  } catch { /* exists */ }
  try {
    await conn.query(`GRANT ALL ON \`${DATABASE}\`.* TO 'osticket'@'%'`);
    await conn.query('FLUSH PRIVILEGES');
  } catch (e) {
    console.warn('Grant warning:', e.message);
  }

  await conn.end();
  console.log('Fixture bootstrap complete.');
}

main().catch((err) => {
  console.error('Fixture bootstrap failed:', err);
  process.exit(1);
});
