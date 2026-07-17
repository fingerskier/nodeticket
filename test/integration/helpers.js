/**
 * Shared helpers for HTTP integration tests against the MySQL fixture.
 */

const path = require('path');

// Point config at fixture before app/config load
function applyFixtureEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DB_DIALECT = 'mysql';
  process.env.DB_HOST = process.env.FIXTURE_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.FIXTURE_PORT || '3307';
  process.env.DB_NAME = process.env.FIXTURE_DATABASE || 'osticket';
  process.env.DB_USER = process.env.FIXTURE_USER_APP || 'osticket';
  process.env.DB_PASSWORD = process.env.FIXTURE_PASSWORD_APP || 'osticket';
  process.env.TABLE_PREFIX = 'ost_';
  process.env.SESSION_SECRET = 'fixture-session-secret';
  process.env.JWT_SECRET = 'fixture-jwt-secret';
  process.env.MCP_ENABLED = 'false';
  process.env.PORT = '0'; // unused when we bind random port
}

const FIXTURE_API_KEY = 'NTFIXTURETESTKEY00000000000000000000000000000001';

async function fixtureAvailable() {
  applyFixtureEnv();
  const mysql = require('mysql2/promise');
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 2000,
    });
    await conn.query('SELECT 1 FROM ost_ticket_status LIMIT 1');
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

async function startTestServer() {
  applyFixtureEnv();
  // Clear cached config modules so env is picked up
  const roots = [
    path.join(__dirname, '..', '..', 'src', 'config', 'index.js'),
    path.join(__dirname, '..', '..', 'src', 'lib', 'db.js'),
    path.join(__dirname, '..', '..', 'src', 'lib', 'sdk.js'),
    path.join(__dirname, '..', '..', 'src', 'app.js'),
  ];
  for (const r of roots) {
    try {
      delete require.cache[require.resolve(r)];
    } catch { /* ignore */ }
  }

  const { start } = require('../../src/app');
  const { server, port } = await start({
    port: 0,
    host: '127.0.0.1',
    quiet: true,
    seed: true,
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, port, baseUrl };
}

async function stopTestServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
  try {
    const db = require('../../src/lib/db');
    await db.close();
  } catch { /* ignore */ }
}

async function jsonFetch(baseUrl, method, pathname, { body, headers = {}, token } = {}) {
  const h = { ...headers };
  if (body != null && !h['Content-Type']) {
    h['Content-Type'] = 'application/json';
  }
  if (token) h.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: h,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

module.exports = {
  applyFixtureEnv,
  fixtureAvailable,
  startTestServer,
  stopTestServer,
  jsonFetch,
  FIXTURE_API_KEY,
};
