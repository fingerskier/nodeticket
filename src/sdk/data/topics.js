/**
 * Help Topics data access
 * @module sdk/data/topics
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Help topic data operations
 */
module.exports = (conn) => {
  const TABLE = 'help_topic';
  const PK = 'topic_id';

  /**
   * Find help topics matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of help_topic rows
   * @example
   * const topics = await topics.find({ where: { isactive: 1 }, orderBy: 'topic ASC' });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a help topic by primary key.
   * @param {number|string} id - The topic_id
   * @returns {Promise<Object|null>} Help topic row or null
   * @example
   * const topic = await topics.findById(4);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count help topics matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await topics.count({ isactive: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new help topic.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with topic_id
   * @example
   * const topic = await topics.create({ topic: 'General Inquiry', isactive: 1 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a help topic by primary key.
   * @param {number|string} id - The topic_id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await topics.update(4, { topic: 'Billing Inquiry' });
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
   * Delete a help topic by primary key.
   * @param {number|string} id - The topic_id
   * @returns {Promise<void>}
   * @example
   * await topics.remove(4);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
