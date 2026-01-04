/**
 * Database Connection Layer
 *
 * Provides a unified interface for MySQL and PostgreSQL connections
 * with connection pooling and query abstraction.
 */

const config = require('../config');

let pool = null;

/**
 * Initialize the database connection pool
 */
const initialize = async () => {
  if (pool) return pool;

  const { dialect, host, port, name, user, password } = config.db;

  if (dialect === 'postgres') {
    const { Pool } = require('pg');
    pool = new Pool({
      host,
      port,
      database: name,
      user,
      password,
      min: config.db.pool.min,
      max: config.db.pool.max
    });

    // Test connection
    try {
      const client = await pool.connect();
      client.release();
      console.log('PostgreSQL connection pool initialized');
    } catch (err) {
      console.error('Failed to connect to PostgreSQL:', err.message);
      throw err;
    }
  } else {
    // MySQL (default)
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host,
      port,
      database: name,
      user,
      password,
      waitForConnections: true,
      connectionLimit: config.db.pool.max,
      queueLimit: 0
    });

    // Test connection
    try {
      const connection = await pool.getConnection();
      connection.release();
      console.log('MySQL connection pool initialized');
    } catch (err) {
      console.error('Failed to connect to MySQL:', err.message);
      throw err;
    }
  }

  return pool;
};

/**
 * Get the table name with prefix
 */
const table = (name) => `${config.db.prefix}${name}`;

/**
 * Execute a query
 * @param {string} sql - SQL query (use ? for MySQL, $1 for PostgreSQL)
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
const query = async (sql, params = []) => {
  if (!pool) {
    await initialize();
  }

  const dialect = config.db.dialect;

  try {
    if (dialect === 'postgres') {
      const result = await pool.query(sql, params);
      return result.rows;
    } else {
      const [rows] = await pool.execute(sql, params);
      return rows;
    }
  } catch (err) {
    console.error('Database query error:', err.message);
    console.error('Query:', sql);
    throw err;
  }
};

/**
 * Execute a query and return the first row
 */
const queryOne = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows[0] || null;
};

/**
 * Execute a query and return a single value
 */
const queryValue = async (sql, params = []) => {
  const row = await queryOne(sql, params);
  if (!row) return null;
  return Object.values(row)[0];
};

/**
 * Build a simple SELECT query
 */
const select = (tableName, options = {}) => {
  const {
    columns = '*',
    where = {},
    orderBy = null,
    limit = null,
    offset = null
  } = options;

  const dialect = config.db.dialect;
  const params = [];
  let sql = `SELECT ${columns} FROM ${table(tableName)}`;

  // Build WHERE clause
  const conditions = Object.entries(where).map(([key, value], index) => {
    if (value === null) {
      return `${key} IS NULL`;
    }
    params.push(value);
    return dialect === 'postgres'
      ? `${key} = $${params.length}`
      : `${key} = ?`;
  });

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  // ORDER BY
  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }

  // LIMIT and OFFSET
  if (limit !== null) {
    params.push(limit);
    sql += dialect === 'postgres'
      ? ` LIMIT $${params.length}`
      : ` LIMIT ?`;
  }

  if (offset !== null) {
    params.push(offset);
    sql += dialect === 'postgres'
      ? ` OFFSET $${params.length}`
      : ` OFFSET ?`;
  }

  return { sql, params };
};

/**
 * Execute a SELECT query with simple options
 */
const find = async (tableName, options = {}) => {
  const { sql, params } = select(tableName, options);
  return query(sql, params);
};

/**
 * Find one record
 */
const findOne = async (tableName, where = {}) => {
  const results = await find(tableName, { where, limit: 1 });
  return results[0] || null;
};

/**
 * Find by ID
 */
const findById = async (tableName, id, idColumn = 'id') => {
  return findOne(tableName, { [idColumn]: id });
};

/**
 * Count records
 */
const count = async (tableName, where = {}) => {
  const { sql, params } = select(tableName, {
    columns: 'COUNT(*) as count',
    where
  });
  const result = await queryOne(sql, params);
  return parseInt(result?.count || 0, 10);
};

/**
 * Close the database connection pool
 */
const close = async () => {
  if (pool) {
    if (config.db.dialect === 'postgres') {
      await pool.end();
    } else {
      await pool.end();
    }
    pool = null;
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
  select
};
