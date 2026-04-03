/**
 * Roles data access
 * @module sdk/data/roles
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Role data operations
 */
module.exports = (conn) => {
  const TABLE = 'role';
  const PK = 'id';

  /**
   * Find roles matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of role rows
   * @example
   * const roles = await roles.find({ orderBy: 'name ASC' });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a role by primary key.
   * @param {number|string} id - The role id
   * @returns {Promise<Object|null>} Role row or null
   * @example
   * const role = await roles.findById(2);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count roles matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await roles.count();
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new role.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const role = await roles.create({ name: 'Agent', permissions: '{}' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a role by primary key.
   * @param {number|string} id - The role id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await roles.update(2, { name: 'Senior Agent' });
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
   * Delete a role by primary key.
   * @param {number|string} id - The role id
   * @returns {Promise<void>}
   * @example
   * await roles.remove(2);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
