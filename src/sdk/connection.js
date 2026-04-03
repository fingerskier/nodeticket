/**
 * Nodeticket SDK — Database Connection
 *
 * Manages connection pooling, dialect abstraction, and query primitives
 * for MySQL and PostgreSQL. Each call to {@link createConnection} returns
 * an independent instance (no global singleton).
 *
 * @module sdk/connection
 */

const { ConnectionError } = require('./errors');

/**
 * Create a new database connection instance.
 *
 * @param {Object} options
 * @param {string} [options.dialect='mysql'] - Database dialect ('mysql' or 'postgres')
 * @param {string} [options.host='localhost'] - Database host
 * @param {number} [options.port] - Database port (defaults: mysql=3306, postgres=5432)
 * @param {string} options.database - Database name
 * @param {string} [options.user='root'] - Database user
 * @param {string} [options.password=''] - Database password
 * @param {string} [options.prefix='ost_'] - Table name prefix
 * @param {Object} [options.pool] - Connection pool options
 * @param {number} [options.pool.min=2] - Minimum pool connections
 * @param {number} [options.pool.max=10] - Maximum pool connections
 * @returns {Promise<Connection>} Initialized connection instance
 *
 * @example
 * const conn = await createConnection({
 *   dialect: 'mysql',
 *   host: 'localhost',
 *   database: 'osticket',
 *   user: 'root',
 *   password: 'secret',
 *   prefix: 'ost_',
 * });
 */
const createConnection = async (options = {}) => {
  const dialect = options.dialect || 'mysql';
  const host = options.host || 'localhost';
  const port = options.port || (dialect === 'postgres' ? 5432 : 3306);
  const database = options.database;
  const user = options.user || 'root';
  const password = options.password || '';
  const prefix = options.prefix || 'ost_';
  const poolMin = options.pool?.min ?? 2;
  const poolMax = options.pool?.max ?? 10;

  if (!database) {
    throw new ConnectionError('database is required');
  }

  let pool;

  if (dialect === 'postgres') {
    const { Pool } = require('pg');
    pool = new Pool({ host, port, database, user, password, min: poolMin, max: poolMax });

    try {
      const client = await pool.connect();
      client.release();
    } catch (err) {
      throw new ConnectionError(`Failed to connect to PostgreSQL: ${err.message}`);
    }
  } else {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host,
      port,
      database,
      user,
      password,
      waitForConnections: true,
      connectionLimit: poolMax,
      queueLimit: 0,
    });

    try {
      const connection = await pool.getConnection();
      connection.release();
    } catch (err) {
      throw new ConnectionError(`Failed to connect to MySQL: ${err.message}`);
    }
  }

  // ---- Query primitives ----

  /**
   * Get the prefixed table name.
   * @param {string} name - Base table name
   * @returns {string} Prefixed table name
   */
  const table = (name) => `${prefix}${name}`;

  /**
   * Execute a SQL query.
   * @param {string} sql - SQL string (use ? for MySQL, $1 for PostgreSQL)
   * @param {Array} [params=[]] - Bind parameters
   * @returns {Promise<Array<Object>>} Result rows
   */
  const query = async (sql, params = []) => {
    try {
      if (dialect === 'postgres') {
        const result = await pool.query(sql, params);
        return result.rows;
      } else {
        const [rows] = await pool.query(sql, params);
        return rows;
      }
    } catch (err) {
      console.error('Database query error:', err.message);
      console.error('Query:', sql);
      throw err;
    }
  };

  /**
   * Execute a query and return the first row.
   * @param {string} sql
   * @param {Array} [params=[]]
   * @returns {Promise<Object|null>}
   */
  const queryOne = async (sql, params = []) => {
    const rows = await query(sql, params);
    return rows[0] || null;
  };

  /**
   * Execute a query and return the first column of the first row.
   * @param {string} sql
   * @param {Array} [params=[]]
   * @returns {Promise<*>}
   */
  const queryValue = async (sql, params = []) => {
    const row = await queryOne(sql, params);
    if (!row) return null;
    return Object.values(row)[0];
  };

  /**
   * Build a SELECT query from options.
   * @param {string} tableName - Unprefixed table name
   * @param {Object} [options]
   * @param {string} [options.columns='*']
   * @param {Object} [options.where={}]
   * @param {string|null} [options.orderBy]
   * @param {number|null} [options.limit]
   * @param {number|null} [options.offset]
   * @returns {{ sql: string, params: Array }}
   */
  const select = (tableName, options = {}) => {
    const { columns = '*', where = {}, orderBy = null, limit = null, offset = null } = options;
    const params = [];
    let sql = `SELECT ${columns} FROM ${table(tableName)}`;

    const conditions = Object.entries(where).map(([key, value]) => {
      if (value === null) return `${key} IS NULL`;
      params.push(value);
      return dialect === 'postgres' ? `${key} = $${params.length}` : `${key} = ?`;
    });

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (orderBy) sql += ` ORDER BY ${orderBy}`;

    if (limit !== null) {
      params.push(limit);
      sql += dialect === 'postgres' ? ` LIMIT $${params.length}` : ` LIMIT ?`;
    }

    if (offset !== null) {
      params.push(offset);
      sql += dialect === 'postgres' ? ` OFFSET $${params.length}` : ` OFFSET ?`;
    }

    return { sql, params };
  };

  /**
   * Find records matching options.
   * @param {string} tableName - Unprefixed table name
   * @param {Object} [options] - Same as {@link select}
   * @returns {Promise<Array<Object>>}
   */
  const find = async (tableName, options = {}) => {
    const { sql, params } = select(tableName, options);
    return query(sql, params);
  };

  /**
   * Find a single record.
   * @param {string} tableName
   * @param {Object} [where={}]
   * @returns {Promise<Object|null>}
   */
  const findOne = async (tableName, where = {}) => {
    const results = await find(tableName, { where, limit: 1 });
    return results[0] || null;
  };

  /**
   * Find a record by its primary key.
   * @param {string} tableName
   * @param {*} id
   * @param {string} [idColumn='id']
   * @returns {Promise<Object|null>}
   */
  const findById = async (tableName, id, idColumn = 'id') => {
    return findOne(tableName, { [idColumn]: id });
  };

  /**
   * Count records matching a filter.
   * @param {string} tableName
   * @param {Object} [where={}]
   * @returns {Promise<number>}
   */
  const count = async (tableName, where = {}) => {
    const { sql, params } = select(tableName, { columns: 'COUNT(*) as count', where });
    const result = await queryOne(sql, params);
    return parseInt(result?.count || 0, 10);
  };

  /**
   * Execute a function within a database transaction.
   * @param {Function} fn - async (txQuery, txQueryOne) => result
   * @returns {Promise<*>}
   */
  const transaction = async (fn) => {
    if (dialect === 'postgres') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txQuery = async (sql, params = []) => {
          const result = await client.query(sql, params);
          return result.rows;
        };
        const txQueryOne = async (sql, params = []) => {
          const rows = await txQuery(sql, params);
          return rows[0] || null;
        };
        const result = await fn(txQuery, txQueryOne);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const txQuery = async (sql, params = []) => {
          const [rows] = await connection.query(sql, params);
          return rows;
        };
        const txQueryOne = async (sql, params = []) => {
          const rows = await txQuery(sql, params);
          return rows[0] || null;
        };
        const result = await fn(txQuery, txQueryOne);
        await connection.commit();
        return result;
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }
  };

  /**
   * Close the connection pool.
   * @returns {Promise<void>}
   */
  const close = async () => {
    await pool.end();
  };

  /**
   * @returns {string} Current dialect
   */
  const getDialect = () => dialect;

  /**
   * @returns {string} Current table prefix
   */
  const getPrefix = () => prefix;

  return {
    table,
    query,
    queryOne,
    queryValue,
    select,
    find,
    findOne,
    findById,
    count,
    transaction,
    close,
    getDialect,
    getPrefix,
  };
};

module.exports = { createConnection };
