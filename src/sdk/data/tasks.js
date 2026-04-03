/**
 * Tasks data access
 * @module sdk/data/tasks
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Task data operations
 */
module.exports = (conn) => {
  const TABLE = 'task';
  const PK = 'id';

  /**
   * Find tasks matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of task rows
   * @example
   * const tasks = await tasks.find({ where: { staff_id: 5 }, limit: 25 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a task by primary key.
   * @param {number|string} id - The task id
   * @returns {Promise<Object|null>} Task row or null
   * @example
   * const task = await tasks.findById(9);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count tasks matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await tasks.count({ flags: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new task.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const task = await tasks.create({ dept_id: 1, staff_id: 5, title: 'Follow up' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a task by primary key.
   * @param {number|string} id - The task id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await tasks.update(9, { flags: 0 });
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
   * Delete a task by primary key.
   * @param {number|string} id - The task id
   * @returns {Promise<void>}
   * @example
   * await tasks.remove(9);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
