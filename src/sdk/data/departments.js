/**
 * Departments data access
 * @module sdk/data/departments
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Department data operations
 */
module.exports = (conn) => {
  const TABLE = 'department';
  const PK = 'id';

  /**
   * Find departments matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of department rows
   * @example
   * const depts = await departments.find({ orderBy: 'name ASC' });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a department by primary key.
   * @param {number|string} id - The department id
   * @returns {Promise<Object|null>} Department row or null
   * @example
   * const dept = await departments.findById(1);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count departments matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await departments.count({ ispublic: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new department.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const dept = await departments.create({ name: 'Support', sla_id: 1 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a department by primary key.
   * @param {number|string} id - The department id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await departments.update(1, { name: 'Technical Support' });
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
   * Delete a department by primary key.
   * @param {number|string} id - The department id
   * @returns {Promise<void>}
   * @example
   * await departments.remove(1);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
