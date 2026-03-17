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
  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
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

/**
 * Create user (admin)
 */
const create = async (req, res) => {
  const { name, email, org_id, username, password } = req.body;

  if (!name || name.length < 1) {
    throw ApiError.badRequest('Name is required');
  }
  if (!email) {
    throw ApiError.badRequest('Email is required');
  }

  // Check email uniqueness
  const existingEmail = await db.queryOne(`
    SELECT id FROM ${db.table('user_email')} WHERE address = ?
  `, [email]);

  if (existingEmail) {
    throw ApiError.conflict('A user with this email already exists');
  }

  const now = new Date();
  const bcrypt = require('bcryptjs');

  await db.transaction(async (txQuery, txQueryOne) => {
    // Insert user
    const userResult = await txQuery(`
      INSERT INTO ${db.table('user')} (org_id, default_email_id, name, status, created, updated)
      VALUES (?, 0, ?, 0, ?, ?)
    `, [org_id || 0, name.trim(), now, now]);

    const userId = userResult.insertId;

    // Insert user email
    const emailResult = await txQuery(`
      INSERT INTO ${db.table('user_email')} (user_id, address, flags) VALUES (?, ?, 0)
    `, [userId, email.trim()]);

    // Update default_email_id
    await txQuery(`
      UPDATE ${db.table('user')} SET default_email_id = ? WHERE id = ?
    `, [emailResult.insertId, userId]);

    // Optionally create user account
    if (username && password) {
      if (password.length < 8) {
        throw ApiError.badRequest('Password must be at least 8 characters');
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await txQuery(`
        INSERT INTO ${db.table('user_account')} (user_id, username, passwd, status)
        VALUES (?, ?, ?, 1)
      `, [userId, username, hashedPassword]);
    }

    res.status(201).json({
      success: true,
      data: {
        id: userId,
        name: name.trim(),
        email: email.trim(),
        org_id: org_id || 0,
        created: now
      }
    });
  });
};

/**
 * Update user (admin)
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { name, org_id, status } = req.body;

  const user = await db.queryOne(`
    SELECT id FROM ${db.table('user')} WHERE id = ?
  `, [id]);

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (org_id !== undefined) { updates.push('org_id = ?'); params.push(org_id); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(id);

  await db.query(`
    UPDATE ${db.table('user')} SET ${updates.join(', ')} WHERE id = ?
  `, params);

  res.json({ success: true, message: 'User updated' });
};

/**
 * Delete user (admin)
 */
const remove = async (req, res) => {
  const { id } = req.params;

  const user = await db.queryOne(`
    SELECT id FROM ${db.table('user')} WHERE id = ?
  `, [id]);

  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?
  `, [id]);

  if (parseInt(ticketCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete user: tickets are associated with this user');
  }

  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('user_account')} WHERE user_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('user_email')} WHERE user_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('user')} WHERE id = ?`, [id]);
  });

  res.json({ success: true, message: 'User deleted' });
};

/**
 * Update own profile (self-service)
 */
const updateProfile = async (req, res) => {
  const userId = req.auth.id;
  const { name, timezone, lang } = req.body;

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (timezone !== undefined) { updates.push('timezone = ?'); params.push(timezone); }
  if (lang !== undefined) { updates.push('lang = ?'); params.push(lang); }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(userId);

  await db.query(`
    UPDATE ${db.table('user')} SET ${updates.join(', ')} WHERE id = ?
  `, params);

  res.json({ success: true, message: 'Profile updated' });
};

/**
 * Change own password (self-service)
 */
const changePassword = async (req, res) => {
  const userId = req.auth.id;
  const authType = req.auth.type;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    throw ApiError.badRequest('Current password and new password are required');
  }

  if (new_password.length < 8) {
    throw ApiError.badRequest('New password must be at least 8 characters');
  }

  const bcrypt = require('bcryptjs');

  let account;
  if (authType === 'staff') {
    account = await db.queryOne(`
      SELECT passwd FROM ${db.table('staff')} WHERE staff_id = ?
    `, [userId]);
  } else {
    account = await db.queryOne(`
      SELECT passwd FROM ${db.table('user_account')} WHERE user_id = ?
    `, [userId]);
  }

  if (!account) {
    throw ApiError.notFound('Account not found');
  }

  const valid = await bcrypt.compare(current_password, account.passwd);
  if (!valid) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  const hashedPassword = await bcrypt.hash(new_password, 10);

  if (authType === 'staff') {
    await db.query(`
      UPDATE ${db.table('staff')} SET passwd = ?, updated = ? WHERE staff_id = ?
    `, [hashedPassword, new Date(), userId]);
  } else {
    await db.query(`
      UPDATE ${db.table('user_account')} SET passwd = ? WHERE user_id = ?
    `, [hashedPassword, userId]);
  }

  res.json({ success: true, message: 'Password changed' });
};

module.exports = {
  list,
  get,
  getTickets,
  getOrganizations,
  create,
  update,
  remove,
  updateProfile,
  changePassword
};
