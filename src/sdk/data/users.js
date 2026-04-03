/**
 * Users data access (user, user_email, user_account)
 * @module sdk/data/users
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} User data operations
 */
module.exports = (conn) => {
  const TABLE = 'user';
  const PK = 'id';

  // ── User CRUD ────────────────────────────────────────────────

  /**
   * Find users matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of user rows
   * @example
   * const users = await users.find({ where: { org_id: 3 }, limit: 50 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a user by primary key.
   * @param {number|string} id - The user id
   * @returns {Promise<Object|null>} User row or null
   * @example
   * const user = await users.findById(12);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count users matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await users.count({ org_id: 3 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new user.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const user = await users.create({ name: 'Jane Doe', org_id: 3 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a user by primary key.
   * @param {number|string} id - The user id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await users.update(12, { name: 'Jane Smith' });
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
   * Delete a user by primary key.
   * @param {number|string} id - The user id
   * @returns {Promise<void>}
   * @example
   * await users.remove(12);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  // ── User Emails ──────────────────────────────────────────────

  /**
   * Find all email addresses for a user.
   * @param {number|string} userId - The user id
   * @returns {Promise<Array<Object>>} Array of user_email rows
   * @example
   * const emails = await users.findEmails(12);
   */
  const findEmails = async (userId) => {
    return conn.find('user_email', { where: { user_id: userId } });
  };

  /**
   * Create a new user email record.
   * @param {Object} data - Column values (must include user_id, address)
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const email = await users.createEmail({ user_id: 12, address: 'jane@example.com' });
   */
  const createEmail = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table('user_email')} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, id: result.insertId };
  };

  /**
   * Remove all email addresses for a user.
   * @param {number|string} userId - The user id
   * @returns {Promise<void>}
   * @example
   * await users.removeEmails(12);
   */
  const removeEmails = async (userId) => {
    await conn.query(
      `DELETE FROM ${conn.table('user_email')} WHERE user_id = ?`,
      [userId],
    );
  };

  // ── User Account ─────────────────────────────────────────────

  /**
   * Find the account record for a user.
   * @param {number|string} userId - The user id
   * @returns {Promise<Object|null>} user_account row or null
   * @example
   * const account = await users.findAccount(12);
   */
  const findAccount = async (userId) => {
    return conn.findOne('user_account', { user_id: userId });
  };

  /**
   * Create a user account record.
   * @param {Object} data - Column values (must include user_id)
   * @returns {Promise<Object>} Inserted data with id
   * @example
   * const account = await users.createAccount({ user_id: 12, username: 'jdoe', passwd: '...' });
   */
  const createAccount = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table('user_account')} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, id: result.insertId };
  };

  /**
   * Update the account record for a user.
   * @param {number|string} userId - The user id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await users.updateAccount(12, { username: 'janedoe' });
   */
  const updateAccount = async (userId, data) => {
    const keys = Object.keys(data);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    await conn.query(
      `UPDATE ${conn.table('user_account')} SET ${sets} WHERE user_id = ?`,
      [...Object.values(data), userId],
    );
  };

  /**
   * Delete the account record for a user.
   * @param {number|string} userId - The user id
   * @returns {Promise<void>}
   * @example
   * await users.removeAccount(12);
   */
  const removeAccount = async (userId) => {
    await conn.query(
      `DELETE FROM ${conn.table('user_account')} WHERE user_id = ?`,
      [userId],
    );
  };

  return {
    find,
    findById,
    count,
    create,
    update,
    remove,
    findEmails,
    createEmail,
    removeEmails,
    findAccount,
    createAccount,
    updateAccount,
    removeAccount,
  };
};
