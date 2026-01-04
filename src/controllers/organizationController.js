/**
 * Organization Controller
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
 * List organizations
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { search } = req.query;

  let sql = `
    SELECT o.*,
           (SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = o.id) as user_count
    FROM ${db.table('organization')} o
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (o.name LIKE ? OR o.domain LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY o.name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const orgs = await db.query(sql, params);

  res.json({
    success: true,
    data: orgs.map(o => ({
      id: o.id,
      name: o.name,
      domain: o.domain,
      status: o.status,
      userCount: parseInt(o.user_count || 0, 10),
      created: o.created,
      updated: o.updated
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
 * Get organization details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const org = await db.queryOne(`
    SELECT * FROM ${db.table('organization')} WHERE id = ?
  `, [id]);

  if (!org) {
    throw ApiError.notFound('Organization not found');
  }

  // Get user count
  const userCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = ?
  `, [id]);

  // Get ticket count
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} t
    JOIN ${db.table('user')} u ON t.user_id = u.id
    WHERE u.org_id = ?
  `, [id]);

  // Parse manager if present
  let manager = null;
  if (org.manager) {
    // Manager format: "s:ID" for staff, "t:ID" for team
    const [type, managerId] = org.manager.split(':');
    if (type === 's' && managerId) {
      const staff = await db.queryOne(`
        SELECT staff_id, firstname, lastname, email FROM ${db.table('staff')} WHERE staff_id = ?
      `, [managerId]);
      if (staff) {
        manager = {
          type: 'staff',
          staff_id: staff.staff_id,
          name: `${staff.firstname || ''} ${staff.lastname || ''}`.trim(),
          email: staff.email
        };
      }
    }
  }

  res.json({
    success: true,
    data: {
      id: org.id,
      name: org.name,
      domain: org.domain,
      status: org.status,
      manager,
      extra: org.extra ? JSON.parse(org.extra) : null,
      userCount: parseInt(userCount || 0, 10),
      ticketCount: parseInt(ticketCount || 0, 10),
      created: org.created,
      updated: org.updated
    }
  });
};

/**
 * Get organization users
 */
const getUsers = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  const users = await db.query(`
    SELECT u.*, ue.address as email
    FROM ${db.table('user')} u
    LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
    WHERE u.org_id = ?
    ORDER BY u.name
    LIMIT ? OFFSET ?
  `, [id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = ?
  `, [id]);

  res.json({
    success: true,
    data: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      status: u.status,
      created: u.created
    })),
    pagination: {
      page,
      limit,
      total: parseInt(total || 0, 10),
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get organization tickets
 */
const getTickets = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  const tickets = await db.query(`
    SELECT t.*,
           ts.name as status_name, ts.state as status_state,
           d.name as dept_name,
           u.name as user_name,
           tc.subject
    FROM ${db.table('ticket')} t
    JOIN ${db.table('user')} u ON t.user_id = u.id
    LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
    LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
    WHERE u.org_id = ?
    ORDER BY t.created DESC
    LIMIT ? OFFSET ?
  `, [id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} t
    JOIN ${db.table('user')} u ON t.user_id = u.id
    WHERE u.org_id = ?
  `, [id]);

  res.json({
    success: true,
    data: tickets.map(t => ({
      ticket_id: t.ticket_id,
      number: t.number,
      subject: t.subject,
      user_name: t.user_name,
      status: {
        id: t.status_id,
        name: t.status_name,
        state: t.status_state
      },
      department: { id: t.dept_id, name: t.dept_name },
      isoverdue: !!t.isoverdue,
      created: t.created
    })),
    pagination: {
      page,
      limit,
      total: parseInt(total || 0, 10),
      totalPages: Math.ceil(total / limit)
    }
  });
};

module.exports = {
  list,
  get,
  getUsers,
  getTickets
};
