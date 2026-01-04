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

module.exports = {
  list,
  get,
  getMembers
};
