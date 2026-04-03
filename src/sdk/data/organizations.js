/**
 * Organizations data access
 * @module sdk/data/organizations
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Organization data operations
 */
module.exports = (conn) => {
  const TABLE = 'organization';
  const PK = 'id';

  /**
   * Find organizations matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of organization rows
   * @example
   * const orgs = await organizations.find({ orderBy: 'name ASC', limit: 50 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find an organization by primary key.
   * @param {number|string} id - The organization id
   * @returns {Promise<Object|null>} Organization row or null
   * @example
   * const org = await organizations.findById(10);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count organizations matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await organizations.count();
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new organization.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const org = await organizations.create({ name: 'Acme Corp' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update an organization by primary key.
   * @param {number|string} id - The organization id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await organizations.update(10, { name: 'Acme Corporation' });
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
   * Delete an organization by primary key.
   * @param {number|string} id - The organization id
   * @returns {Promise<void>}
   * @example
   * await organizations.remove(10);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  return { find, findById, count, create, update, remove };
};
