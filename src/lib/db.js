/**
 * Database Connection Layer
 *
 * Backward-compatible wrapper around the SDK connection module.
 * Provides the same interface as the original db.js, but delegates
 * to sdk/connection internally. This allows the Express app to
 * continue using `require('../lib/db')` unchanged during migration.
 */

const config = require('../config');
const { createConnection } = require('../sdk/connection');

let conn = null;

/**
 * Initialize the database connection pool
 */
const initialize = async () => {
  if (conn) return conn;

  conn = await createConnection({
    dialect: config.db.dialect,
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    prefix: config.db.prefix,
    pool: config.db.pool,
  });

  console.log(`${config.db.dialect === 'postgres' ? 'PostgreSQL' : 'MySQL'} connection pool initialized`);
  return conn;
};

/**
 * Get the table name with prefix
 */
const table = (name) => {
  if (conn) return conn.table(name);
  return `${config.db.prefix}${name}`;
};

/**
 * Execute a query
 */
const query = async (sql, params = []) => {
  if (!conn) await initialize();
  return conn.query(sql, params);
};

/**
 * Execute a query and return the first row
 */
const queryOne = async (sql, params = []) => {
  if (!conn) await initialize();
  return conn.queryOne(sql, params);
};

/**
 * Execute a query and return a single value
 */
const queryValue = async (sql, params = []) => {
  if (!conn) await initialize();
  return conn.queryValue(sql, params);
};

/**
 * Build a simple SELECT query
 */
const select = (tableName, options = {}) => {
  if (!conn) {
    // Fallback: build inline if connection not yet initialized
    // This shouldn't happen in practice, but maintains backward compat
    const { createConnection: _ } = require('../sdk/connection');
    throw new Error('Database not initialized. Call initialize() first.');
  }
  return conn.select(tableName, options);
};

/**
 * Execute a SELECT query with simple options
 */
const find = async (tableName, options = {}) => {
  if (!conn) await initialize();
  return conn.find(tableName, options);
};

/**
 * Find one record
 */
const findOne = async (tableName, where = {}) => {
  if (!conn) await initialize();
  return conn.findOne(tableName, where);
};

/**
 * Find by ID
 */
const findById = async (tableName, id, idColumn = 'id') => {
  if (!conn) await initialize();
  return conn.findById(tableName, id, idColumn);
};

/**
 * Count records
 */
const count = async (tableName, where = {}) => {
  if (!conn) await initialize();
  return conn.count(tableName, where);
};

/**
 * Execute a function within a database transaction
 */
const transaction = async (fn) => {
  if (!conn) await initialize();
  return conn.transaction(fn);
};

/**
 * Close the database connection pool
 */
const close = async () => {
  if (conn) {
    await conn.close();
    conn = null;
    console.log('Database connection pool closed');
  }
};

/**
 * Get the current dialect
 */
const getDialect = () => config.db.dialect;

/**
 * Get the table prefix
 */
const getPrefix = () => config.db.prefix;

/**
 * Get the underlying SDK connection instance (for SDK consumers)
 */
const getConnection = () => conn;

module.exports = {
  initialize,
  table,
  query,
  queryOne,
  queryValue,
  find,
  findOne,
  findById,
  count,
  close,
  getDialect,
  getPrefix,
  select,
  transaction,
  getConnection,
};
