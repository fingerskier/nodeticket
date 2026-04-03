/**
 * Teams data access (team, team_member)
 * @module sdk/data/teams
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Team data operations
 */
module.exports = (conn) => {
  const TABLE = 'team';
  const PK = 'team_id';

  // ── Team CRUD ────────────────────────────────────────────────

  /**
   * Find teams matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of team rows
   * @example
   * const teams = await teams.find({ where: { isenabled: 1 } });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a team by primary key.
   * @param {number|string} id - The team_id
   * @returns {Promise<Object|null>} Team row or null
   * @example
   * const team = await teams.findById(3);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count teams matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await teams.count({ isenabled: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new team.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with team_id
   * @example
   * const team = await teams.create({ name: 'Level 2', isenabled: 1 });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a team by primary key.
   * @param {number|string} id - The team_id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await teams.update(3, { name: 'Level 2 Support' });
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
   * Delete a team by primary key.
   * @param {number|string} id - The team_id
   * @returns {Promise<void>}
   * @example
   * await teams.remove(3);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  // ── Team Members ─────────────────────────────────────────────

  /**
   * Find members of a team (joins team_member with staff).
   * @param {number|string} teamId - The team_id
   * @returns {Promise<Array<Object>>} Array of staff rows with membership info
   * @example
   * const members = await teams.findMembers(3);
   */
  const findMembers = async (teamId) => {
    const sql = `
      SELECT s.*, tm.team_id
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('staff')} s ON s.staff_id = tm.staff_id
      WHERE tm.team_id = ?
    `;
    return conn.query(sql, [teamId]);
  };

  /**
   * Add a staff member to a team.
   * @param {number|string} teamId - The team_id
   * @param {number|string} staffId - The staff_id
   * @returns {Promise<void>}
   * @example
   * await teams.addMember(3, 5);
   */
  const addMember = async (teamId, staffId) => {
    await conn.query(
      `INSERT INTO ${conn.table('team_member')} (team_id, staff_id) VALUES (?, ?)`,
      [teamId, staffId],
    );
  };

  /**
   * Remove a staff member from a team.
   * @param {number|string} teamId - The team_id
   * @param {number|string} staffId - The staff_id
   * @returns {Promise<void>}
   * @example
   * await teams.removeMember(3, 5);
   */
  const removeMember = async (teamId, staffId) => {
    await conn.query(
      `DELETE FROM ${conn.table('team_member')} WHERE team_id = ? AND staff_id = ?`,
      [teamId, staffId],
    );
  };

  return { find, findById, count, create, update, remove, findMembers, addMember, removeMember };
};
