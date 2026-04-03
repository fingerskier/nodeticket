/**
 * Staff data access (staff, staff_dept_access, team_member)
 * @module sdk/data/staff
 */

/**
 * @param {import('../connection')} conn
 * @returns {Object} Staff data operations
 */
module.exports = (conn) => {
  const TABLE = 'staff';
  const PK = 'staff_id';

  // ── Staff CRUD ───────────────────────────────────────────────

  /**
   * Find staff matching the given criteria.
   * @param {Object} [options] - Query options
   * @param {Object} [options.where] - WHERE conditions
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - Maximum rows
   * @param {number} [options.offset] - Rows to skip
   * @returns {Promise<Array<Object>>} Array of staff rows
   * @example
   * const agents = await staff.find({ where: { dept_id: 1 }, limit: 25 });
   */
  const find = async (options = {}) => {
    return conn.find(TABLE, options);
  };

  /**
   * Find a staff member by primary key.
   * @param {number|string} id - The staff_id
   * @returns {Promise<Object|null>} Staff row or null
   * @example
   * const agent = await staff.findById(5);
   */
  const findById = async (id) => {
    return conn.findById(TABLE, id, PK);
  };

  /**
   * Count staff matching optional conditions.
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<number>} Row count
   * @example
   * const total = await staff.count({ isactive: 1 });
   */
  const count = async (where = {}) => {
    return conn.count(TABLE, where);
  };

  /**
   * Create a new staff member.
   * @param {Object} data - Column values to insert
   * @returns {Promise<Object>} Inserted data with staff_id
   * @example
   * const agent = await staff.create({ firstname: 'John', lastname: 'Doe', dept_id: 1, email: 'john@example.com' });
   */
  const create = async (data) => {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${conn.table(TABLE)} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await conn.query(sql, Object.values(data));
    return { ...data, [PK]: result.insertId };
  };

  /**
   * Update a staff member by primary key.
   * @param {number|string} id - The staff_id
   * @param {Object} data - Column values to update
   * @returns {Promise<void>}
   * @example
   * await staff.update(5, { dept_id: 2 });
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
   * Delete a staff member by primary key.
   * @param {number|string} id - The staff_id
   * @returns {Promise<void>}
   * @example
   * await staff.remove(5);
   */
  const remove = async (id) => {
    await conn.query(`DELETE FROM ${conn.table(TABLE)} WHERE ${PK} = ?`, [id]);
  };

  // ── Department Access ────────────────────────────────────────

  /**
   * Find department access entries for a staff member.
   * @param {number|string} staffId - The staff_id
   * @returns {Promise<Array<Object>>} Array of staff_dept_access rows
   * @example
   * const depts = await staff.findDeptAccess(5);
   */
  const findDeptAccess = async (staffId) => {
    return conn.find('staff_dept_access', { where: { staff_id: staffId } });
  };

  /**
   * Replace all department access entries for a staff member.
   * Deletes existing entries then inserts the new set within a transaction.
   * @param {number|string} staffId - The staff_id
   * @param {Array<number>} departments - Array of department ids to grant access
   * @returns {Promise<void>}
   * @example
   * await staff.setDeptAccess(5, [1, 2, 4]);
   */
  const setDeptAccess = async (staffId, departments) => {
    await conn.transaction(async (txQuery) => {
      await txQuery(
        `DELETE FROM ${conn.table('staff_dept_access')} WHERE staff_id = ?`,
        [staffId],
      );
      for (const deptId of departments) {
        await txQuery(
          `INSERT INTO ${conn.table('staff_dept_access')} (staff_id, dept_id) VALUES (?, ?)`,
          [staffId, deptId],
        );
      }
    });
  };

  /**
   * Find team memberships for a staff member (joins team_member with team).
   * @param {number|string} staffId - The staff_id
   * @returns {Promise<Array<Object>>} Array of team rows with membership info
   * @example
   * const teams = await staff.findTeamMemberships(5);
   */
  const findTeamMemberships = async (staffId) => {
    const sql = `
      SELECT t.*, tm.staff_id
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('team')} t ON t.team_id = tm.team_id
      WHERE tm.staff_id = ?
    `;
    return conn.query(sql, [staffId]);
  };

  return {
    find,
    findById,
    count,
    create,
    update,
    remove,
    findDeptAccess,
    setDeptAccess,
    findTeamMemberships,
  };
};
