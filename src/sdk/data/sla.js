/**
 * SLA data access
 * @module sdk/data/sla
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} SLA data operations
 */
module.exports = (conn) => {
  const TABLE = 'sla';
  const PK = 'id';

  /**
   * Find SLA plans matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of SLA rows
   * @example
   * const plans = await sla.find({ where: { isactive: 1 } });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find an SLA plan by primary key.
   * @param {number|string} id - The SLA id
   * @returns {Promise<Object|null>} SLA row or null
   * @example
   * const plan = await sla.findById(1);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count SLA plans matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await sla.count({ isactive: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new SLA plan.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const plan = await sla.create({ name: 'Priority', grace_period: 8, isactive: 1 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update an SLA plan by primary key.
   * @param {number|string} id - The SLA id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await sla.update(1, { grace_period: 4 });
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
   * Delete an SLA plan by primary key.
   * @param {number|string} id - The SLA id
   * @returns {Promise<void>}
   * @example
   * await sla.remove(1);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
