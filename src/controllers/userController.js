/**
 * User Controller
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
 * List users
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { org_id, search } = req.query;

  let sql = `
    SELECT u.*, ue.address as email, o.name as org_name
    FROM ${db.table('user')} u
    LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
    LEFT JOIN ${db.table('organization')} o ON u.org_id = o.id
    WHERE 1=1
  `;
  const params = [];

  if (org_id) {
    sql += ` AND u.org_id = ?`;
    params.push(org_id);
  }

  if (search) {
    sql += ` AND (u.name LIKE ? OR ue.address LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY u.created DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const users = await db.query(sql, params);

  res.json({
    success: true,
    data: users.map(u => ({
      id: u.id,
      org_id: u.org_id,
      name: u.name,
      email: u.email,
      organization: u.org_name ? { id: u.org_id, name: u.org_name } : null,
      status: u.status,
      created: u.created,
      updated: u.updated
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
 * Get user details
 */
const get = async (req, res) => {
  const { id } = req.params;

  // User can only access their own profile
  if (req.auth?.type === 'user' && req.auth.id !== parseInt(id, 10)) {
    throw ApiError.forbidden('Access denied');
  }

  const user = await db.queryOne(`
    SELECT u.*, o.id as org_id, o.name as org_name, o.domain as org_domain
    FROM ${db.table('user')} u
    LEFT JOIN ${db.table('organization')} o ON u.org_id = o.id
    WHERE u.id = ?
  `, [id]);

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Get all emails
  const emails = await db.query(`
    SELECT id, address, flags FROM ${db.table('user_email')} WHERE user_id = ?
  `, [id]);

  // Get ticket count
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?
  `, [id]);

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      status: user.status,
      organization: user.org_id ? {
        id: user.org_id,
        name: user.org_name,
        domain: user.org_domain
      } : null,
      emails: emails.map(e => ({
        id: e.id,
        address: e.address,
        flags: e.flags,
        isDefault: e.id === user.default_email_id
      })),
      ticketCount: parseInt(ticketCount || 0, 10),
      created: user.created,
      updated: user.updated
    }
  });
};

/**
 * Get user's tickets
 */
const getTickets = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  // User can only access their own tickets
  if (req.auth?.type === 'user' && req.auth.id !== parseInt(id, 10)) {
    throw ApiError.forbidden('Access denied');
  }

  const tickets = await db.query(`
    SELECT t.*,
           ts.name as status_name, ts.state as status_state,
           d.name as dept_name,
           tc.subject
    FROM ${db.table('ticket')} t
    LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
    LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
    WHERE t.user_id = ?
    ORDER BY t.created DESC
    LIMIT ? OFFSET ?
  `, [id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?
  `, [id]);

  res.json({
    success: true,
    data: tickets.map(t => ({
      ticket_id: t.ticket_id,
      number: t.number,
      subject: t.subject,
      status: {
        id: t.status_id,
        name: t.status_name,
        state: t.status_state
      },
      department: {
        id: t.dept_id,
        name: t.dept_name
      },
      isoverdue: !!t.isoverdue,
      created: t.created,
      updated: t.updated
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
 * Get user's organizations
 */
const getOrganizations = async (req, res) => {
  const { id } = req.params;

  const user = await db.queryOne(`
    SELECT org_id FROM ${db.table('user')} WHERE id = ?
  `, [id]);

  if (!user || !user.org_id) {
    return res.json({
      success: true,
      data: []
    });
  }

  const org = await db.queryOne(`
    SELECT * FROM ${db.table('organization')} WHERE id = ?
  `, [user.org_id]);

  res.json({
    success: true,
    data: org ? [{
      id: org.id,
      name: org.name,
      domain: org.domain,
      status: org.status
    }] : []
  });
};

module.exports = {
  list,
  get,
  getTickets,
  getOrganizations
};
