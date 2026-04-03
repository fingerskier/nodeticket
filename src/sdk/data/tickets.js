/**
 * Tickets data access
 * @module sdk/data/tickets
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Ticket data operations
 */
module.exports = (conn) => {
  const TABLE = 'ticket';
  const PK = 'ticket_id';

  /**
   * Find tickets matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions as key-value pairs
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows to return
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of ticket rows
   * @example
   * const open = await tickets.find({ where: { status_id: 1 }, limit: 25 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a ticket by its primary key.
   * @param {number|string} id - The ticket_id
   * @returns {Promise<Object|null>} Ticket row or null
   * @example
   * const ticket = await tickets.findById(42);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Find a ticket by its display number.
   * @param {string} number - The ticket number string
   * @returns {Promise<Object|null>} Ticket row or null
   * @example
   * const ticket = await tickets.findByNumber('123456');
   */
  const findByNumber = async (number) => {
    return conn.findOne(TABLE, { number });
  };

  /**
   * Count tickets matching optional conditions.
   * @param {Object} [where] - WHERE conditions as key-value pairs
   * @returns {Promise<number>} Row count
   * @example
   * const total = await tickets.count({ status_id: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new ticket.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with ticket_id
   * @example
   * const ticket = await tickets.create({ number: '100001', user_id: 5, dept_id: 1 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a ticket by its primary key.
   * @param {number|string} id - The ticket_id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await tickets.update(42, { status_id: 3 });
   */
  const update = async (id, data) => {
    const keys = Object.keys(data);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    await conn.query(
      `UPDATE ${conn.table(TABLE)} SET ${sets} WHERE ${PK} = ?`,
      [...Object.values(data), id],
    );
  };

  /**
   * Delete a ticket by its primary key.
   * @param {number|string} id - The ticket_id
   * @returns {Promise<void>}
   * @example
   * await tickets.remove(42);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, findByNumber, count, create, update, remove };
};
