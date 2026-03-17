/**
 * Team Controller
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Helper to build pagination
 */
const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * List teams
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);

  let sql = `
    SELECT t.*, s.firstname, s.lastname, s.email as lead_email,
           (SELECT COUNT(*) FROM ${db.table('team_member')} WHERE team_id = t.team_id) as member_count
    FROM ${db.table('team')} t
    LEFT JOIN ${db.table('staff')} s ON t.lead_id = s.staff_id
    WHERE 1=1
  `;
  const params = [];

  // Get total count
  const countSql = `SELECT COUNT(*) as count FROM ${db.table('team')}`;
  const countResult = await db.queryOne(countSql);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY t.name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const teams = await db.query(sql, params);

  res.json({
    success: true,
    data: teams.map(t => ({
      team_id: t.team_id,
      name: t.name,
      lead: t.lead_id ? {
        staff_id: t.lead_id,
        name: `${t.firstname || ''} ${t.lastname || ''}`.trim(),
        email: t.lead_email
      } : null,
      flags: t.flags,
      memberCount: parseInt(t.member_count || 0, 10),
      created: t.created
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get team details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const team = await db.queryOne(`
    SELECT t.*, s.firstname, s.lastname, s.email as lead_email
    FROM ${db.table('team')} t
    LEFT JOIN ${db.table('staff')} s ON t.lead_id = s.staff_id
    WHERE t.team_id = ?
  `, [id]);

  if (!team) {
    throw ApiError.notFound('Team not found');
  }

  // Get members
  const members = await db.query(`
    SELECT s.staff_id, s.username, s.firstname, s.lastname, s.email, tm.flags
    FROM ${db.table('team_member')} tm
    JOIN ${db.table('staff')} s ON tm.staff_id = s.staff_id
    WHERE tm.team_id = ? AND s.isactive = 1
  `, [id]);

  res.json({
    success: true,
    data: {
      team_id: team.team_id,
      name: team.name,
      notes: team.notes,
      flags: team.flags,
      lead: team.lead_id ? {
        staff_id: team.lead_id,
        name: `${team.firstname || ''} ${team.lastname || ''}`.trim(),
        email: team.lead_email
      } : null,
      members: members.map(m => ({
        staff_id: m.staff_id,
        username: m.username,
        name: `${m.firstname || ''} ${m.lastname || ''}`.trim() || m.username,
        email: m.email,
        isLead: m.staff_id === team.lead_id
      })),
      created: team.created,
      updated: team.updated
    }
  });
};

/**
 * Get team members
 */
const getMembers = async (req, res) => {
  const { id } = req.params;

  const team = await db.queryOne(`
    SELECT team_id, lead_id FROM ${db.table('team')} WHERE team_id = ?
  `, [id]);

  if (!team) {
    throw ApiError.notFound('Team not found');
  }

  const members = await db.query(`
    SELECT s.*, tm.flags, d.name as dept_name
    FROM ${db.table('team_member')} tm
    JOIN ${db.table('staff')} s ON tm.staff_id = s.staff_id
    LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
    WHERE tm.team_id = ?
  `, [id]);

  res.json({
    success: true,
    data: members.map(m => ({
      staff_id: m.staff_id,
      username: m.username,
      name: `${m.firstname || ''} ${m.lastname || ''}`.trim() || m.username,
      email: m.email,
      department: { id: m.dept_id, name: m.dept_name },
      isLead: m.staff_id === team.lead_id,
      isactive: !!m.isactive,
      onvacation: !!m.onvacation
    }))
  });
};

/**
 * Create team
 */
const create = async (req, res) => {
  const { name, lead_id, flags, notes } = req.body;

  if (!name || name.length < 1) {
    throw ApiError.badRequest('Name is required');
  }

  const now = new Date();
  const result = await db.query(`
    INSERT INTO ${db.table('team')} (name, lead_id, flags, notes, created, updated)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    name.trim(),
    lead_id || 0,
    flags || 0,
    notes || null,
    now,
    now
  ]);

  res.status(201).json({
    success: true,
    data: {
      team_id: result.insertId,
      name: name.trim(),
      lead_id: lead_id || 0,
      created: now
    }
  });
};

/**
 * Update team
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { name, lead_id, flags, notes } = req.body;

  const team = await db.queryOne(`
    SELECT team_id FROM ${db.table('team')} WHERE team_id = ?
  `, [id]);

  if (!team) {
    throw ApiError.notFound('Team not found');
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (lead_id !== undefined) { updates.push('lead_id = ?'); params.push(lead_id); }
  if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(id);

  await db.query(`
    UPDATE ${db.table('team')} SET ${updates.join(', ')} WHERE team_id = ?
  `, params);

  res.json({ success: true, message: 'Team updated' });
};

/**
 * Delete team
 */
const remove = async (req, res) => {
  const { id } = req.params;

  const team = await db.queryOne(`
    SELECT team_id FROM ${db.table('team')} WHERE team_id = ?
  `, [id]);

  if (!team) {
    throw ApiError.notFound('Team not found');
  }

  // Check tickets
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE team_id = ?
  `, [id]);

  if (parseInt(ticketCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete team: tickets are assigned');
  }

  // Cascade delete members + team in transaction
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('team_member')} WHERE team_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('team')} WHERE team_id = ?`, [id]);
  });

  res.json({ success: true, message: 'Team deleted' });
};

/**
 * Add member to team
 */
const addMember = async (req, res) => {
  const { id } = req.params;
  const { staff_id } = req.body;

  if (!staff_id) {
    throw ApiError.badRequest('staff_id is required');
  }

  const team = await db.queryOne(`
    SELECT team_id FROM ${db.table('team')} WHERE team_id = ?
  `, [id]);

  if (!team) {
    throw ApiError.notFound('Team not found');
  }

  // Validate staff exists
  const staff = await db.queryOne(`
    SELECT staff_id FROM ${db.table('staff')} WHERE staff_id = ?
  `, [staff_id]);

  if (!staff) {
    throw ApiError.badRequest('Staff member not found');
  }

  // Check duplicate
  const existing = await db.queryOne(`
    SELECT staff_id FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?
  `, [id, staff_id]);

  if (existing) {
    throw ApiError.conflict('Staff member is already on this team');
  }

  await db.query(`
    INSERT INTO ${db.table('team_member')} (team_id, staff_id, flags) VALUES (?, ?, 0)
  `, [id, staff_id]);

  res.status(201).json({ success: true, message: 'Member added to team' });
};

/**
 * Remove member from team
 */
const removeMember = async (req, res) => {
  const { id, staffId } = req.params;

  const result = await db.query(`
    DELETE FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?
  `, [id, staffId]);

  if (result.affectedRows === 0) {
    throw ApiError.notFound('Team member not found');
  }

  res.json({ success: true, message: 'Member removed from team' });
};

module.exports = {
  list,
  get,
  getMembers,
  create,
  update,
  remove,
  addMember,
  removeMember
};
