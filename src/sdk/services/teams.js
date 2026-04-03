/**
 * Team Service — business logic for team operations
 * @module sdk/services/teams
 */

const { ValidationError, NotFoundError, ConflictError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Team service methods
 */
module.exports = (conn, data) => {
  /**
   * Normalize pagination parameters.
   * @param {number|string} [page=1]
   * @param {number|string} [limit=25]
   * @returns {{ page: number, limit: number, offset: number }}
   */
  const paginate = (page, limit) => {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    return { page: p, limit: l, offset: (p - 1) * l };
  };

  /**
   * List teams with lead info and member count.
   *
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await teams.list({ page: 1, limit: 10 });
   */
  const list = async (options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    let sql = `
      SELECT t.*, s.firstname, s.lastname, s.email as lead_email,
             (SELECT COUNT(*) FROM ${conn.table('team_member')} WHERE team_id = t.team_id) as member_count
      FROM ${conn.table('team')} t
      LEFT JOIN ${conn.table('staff')} s ON t.lead_id = s.staff_id
      WHERE 1=1
    `;
    const params = [];

    const countResult = await conn.queryOne(
      `SELECT COUNT(*) as count FROM ${conn.table('team')}`
    );
    const total = parseInt(countResult?.count || 0, 10);

    sql += ` ORDER BY t.name LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const teams = await conn.query(sql, params);

    return {
      data: teams.map((t) => ({
        team_id: t.team_id,
        name: t.name,
        lead: t.lead_id ? {
          staff_id: t.lead_id,
          name: `${t.firstname || ''} ${t.lastname || ''}`.trim(),
          email: t.lead_email,
        } : null,
        flags: t.flags,
        memberCount: parseInt(t.member_count || 0, 10),
        created: t.created,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get team details by ID, including members.
   *
   * @param {number|string} id - Team ID
   * @returns {Promise<Object>} Team detail with members
   * @throws {NotFoundError} If the team does not exist
   *
   * @example
   * const team = await teams.get(1);
   */
  const get = async (id) => {
    const team = await conn.queryOne(`
      SELECT t.*, s.firstname, s.lastname, s.email as lead_email
      FROM ${conn.table('team')} t
      LEFT JOIN ${conn.table('staff')} s ON t.lead_id = s.staff_id
      WHERE t.team_id = ?
    `, [id]);

    if (!team) throw new NotFoundError('Team not found');

    const members = await conn.query(`
      SELECT s.staff_id, s.username, s.firstname, s.lastname, s.email, tm.flags
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('staff')} s ON tm.staff_id = s.staff_id
      WHERE tm.team_id = ? AND s.isactive = 1
    `, [id]);

    return {
      team_id: team.team_id,
      name: team.name,
      notes: team.notes,
      flags: team.flags,
      lead: team.lead_id ? {
        staff_id: team.lead_id,
        name: `${team.firstname || ''} ${team.lastname || ''}`.trim(),
        email: team.lead_email,
      } : null,
      members: members.map((m) => ({
        staff_id: m.staff_id,
        username: m.username,
        name: `${m.firstname || ''} ${m.lastname || ''}`.trim() || m.username,
        email: m.email,
        isLead: m.staff_id === team.lead_id,
      })),
      created: team.created,
      updated: team.updated,
    };
  };

  /**
   * Get team members with department info.
   *
   * @param {number|string} teamId - Team ID
   * @returns {Promise<Array<Object>>} Member list
   * @throws {NotFoundError} If the team does not exist
   *
   * @example
   * const members = await teams.getMembers(1);
   */
  const getMembers = async (teamId) => {
    const team = await conn.queryOne(
      `SELECT team_id, lead_id FROM ${conn.table('team')} WHERE team_id = ?`, [teamId]
    );
    if (!team) throw new NotFoundError('Team not found');

    const members = await conn.query(`
      SELECT s.*, tm.flags, d.name as dept_name
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('staff')} s ON tm.staff_id = s.staff_id
      LEFT JOIN ${conn.table('department')} d ON s.dept_id = d.id
      WHERE tm.team_id = ?
    `, [teamId]);

    return members.map((m) => ({
      staff_id: m.staff_id,
      username: m.username,
      name: `${m.firstname || ''} ${m.lastname || ''}`.trim() || m.username,
      email: m.email,
      department: { id: m.dept_id, name: m.dept_name },
      isLead: m.staff_id === team.lead_id,
      isactive: !!m.isactive,
      onvacation: !!m.onvacation,
    }));
  };

  /**
   * Create a new team.
   *
   * @param {Object} params
   * @param {string} params.name - Team name
   * @param {number|string} [params.lead_id=0] - Team lead staff ID
   * @param {number} [params.flags=0] - Team flags
   * @param {string} [params.notes] - Team notes
   * @returns {Promise<Object>} Created team summary
   * @throws {ValidationError} If name is missing
   *
   * @example
   * const team = await teams.create({ name: 'Tier 1', lead_id: 3 });
   */
  const create = async ({ name, lead_id, flags, notes }) => {
    if (!name || name.length < 1) throw new ValidationError('Name is required');

    const now = new Date();
    const result = await conn.query(`
      INSERT INTO ${conn.table('team')} (name, lead_id, flags, notes, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name.trim(), lead_id || 0, flags || 0, notes || null, now, now]);

    return {
      team_id: result.insertId,
      name: name.trim(),
      lead_id: lead_id || 0,
      created: now,
    };
  };

  /**
   * Update a team.
   *
   * @param {number|string} id - Team ID
   * @param {Object} changes
   * @param {string} [changes.name] - Team name
   * @param {number} [changes.lead_id] - Team lead staff ID
   * @param {number} [changes.flags] - Flags
   * @param {string} [changes.notes] - Notes
   * @returns {Promise<void>}
   * @throws {NotFoundError} If team not found
   * @throws {ValidationError} If no fields provided
   *
   * @example
   * await teams.update(1, { name: 'Tier 2' });
   */
  const update = async (id, changes = {}) => {
    const { name, lead_id, flags, notes } = changes;

    const team = await conn.queryOne(
      `SELECT team_id FROM ${conn.table('team')} WHERE team_id = ?`, [id]
    );
    if (!team) throw new NotFoundError('Team not found');

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (lead_id !== undefined) { updates.push('lead_id = ?'); params.push(lead_id); }
    if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length === 0) throw new ValidationError('No fields to update');

    updates.push('updated = ?');
    params.push(new Date());
    params.push(id);

    await conn.query(
      `UPDATE ${conn.table('team')} SET ${updates.join(', ')} WHERE team_id = ?`, params
    );
  };

  /**
   * Delete a team and its memberships.
   *
   * @param {number|string} id - Team ID
   * @returns {Promise<void>}
   * @throws {NotFoundError} If team not found
   * @throws {ConflictError} If tickets are assigned to this team
   *
   * @example
   * await teams.remove(1);
   */
  const remove = async (id) => {
    const team = await conn.queryOne(
      `SELECT team_id FROM ${conn.table('team')} WHERE team_id = ?`, [id]
    );
    if (!team) throw new NotFoundError('Team not found');

    const ticketCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE team_id = ?`, [id]) || 0, 10
    );
    if (ticketCount > 0) throw new ConflictError('Cannot delete team: tickets are assigned');

    await conn.transaction(async (txQuery) => {
      await txQuery(`DELETE FROM ${conn.table('team_member')} WHERE team_id = ?`, [id]);
      await txQuery(`DELETE FROM ${conn.table('team')} WHERE team_id = ?`, [id]);
    });
  };

  /**
   * Add a staff member to a team.
   *
   * @param {number|string} teamId - Team ID
   * @param {number|string} staffId - Staff ID to add
   * @returns {Promise<void>}
   * @throws {NotFoundError} If team or staff not found
   * @throws {ConflictError} If staff is already a member
   *
   * @example
   * await teams.addMember(1, 5);
   */
  const addMember = async (teamId, staffId) => {
    if (!staffId) throw new ValidationError('staffId is required');

    const team = await conn.queryOne(
      `SELECT team_id FROM ${conn.table('team')} WHERE team_id = ?`, [teamId]
    );
    if (!team) throw new NotFoundError('Team not found');

    const s = await conn.queryOne(
      `SELECT staff_id FROM ${conn.table('staff')} WHERE staff_id = ?`, [staffId]
    );
    if (!s) throw new NotFoundError('Staff member not found');

    const existing = await conn.queryOne(
      `SELECT staff_id FROM ${conn.table('team_member')} WHERE team_id = ? AND staff_id = ?`,
      [teamId, staffId],
    );
    if (existing) throw new ConflictError('Staff member is already on this team');

    await conn.query(
      `INSERT INTO ${conn.table('team_member')} (team_id, staff_id, flags) VALUES (?, ?, 0)`,
      [teamId, staffId],
    );
  };

  /**
   * Remove a staff member from a team.
   *
   * @param {number|string} teamId - Team ID
   * @param {number|string} staffId - Staff ID to remove
   * @returns {Promise<void>}
   * @throws {NotFoundError} If the membership does not exist
   *
   * @example
   * await teams.removeMember(1, 5);
   */
  const removeMember = async (teamId, staffId) => {
    const result = await conn.query(
      `DELETE FROM ${conn.table('team_member')} WHERE team_id = ? AND staff_id = ?`,
      [teamId, staffId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundError('Team member not found');
    }
  };

  return {
    list,
    get,
    getMembers,
    create,
    update,
    remove,
    addMember,
    removeMember,
  };
};
