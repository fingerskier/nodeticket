/**
 * Staff Controller
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
 * List staff members
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { dept_id, isactive } = req.query;

  let sql = `
    SELECT s.*, d.name as dept_name, r.name as role_name
    FROM ${db.table('staff')} s
    LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
    LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
    WHERE 1=1
  `;
  const params = [];

  if (dept_id) {
    sql += ` AND s.dept_id = ?`;
    params.push(dept_id);
  }

  if (isactive !== undefined) {
    sql += ` AND s.isactive = ?`;
    params.push(isactive === 'true' || isactive === '1' ? 1 : 0);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY s.lastname, s.firstname LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const staff = await db.query(sql, params);

  res.json({
    success: true,
    data: staff.map(s => ({
      staff_id: s.staff_id,
      username: s.username,
      firstname: s.firstname,
      lastname: s.lastname,
      name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
      email: s.email,
      phone: s.phone,
      dept_id: s.dept_id,
      department: { id: s.dept_id, name: s.dept_name },
      role_id: s.role_id,
      role: { id: s.role_id, name: s.role_name },
      isactive: !!s.isactive,
      isadmin: !!s.isadmin,
      onvacation: !!s.onvacation,
      created: s.created
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
 * Get staff details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const staff = await db.queryOne(`
    SELECT s.*, d.name as dept_name, r.name as role_name, r.permissions as role_permissions
    FROM ${db.table('staff')} s
    LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
    LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
    WHERE s.staff_id = ?
  `, [id]);

  if (!staff) {
    throw ApiError.notFound('Staff member not found');
  }

  // Get extended department access
  const deptAccess = await db.query(`
    SELECT sda.*, d.name as dept_name, r.name as role_name
    FROM ${db.table('staff_dept_access')} sda
    JOIN ${db.table('department')} d ON sda.dept_id = d.id
    LEFT JOIN ${db.table('role')} r ON sda.role_id = r.id
    WHERE sda.staff_id = ?
  `, [id]);

  // Get team memberships
  const teams = await db.query(`
    SELECT t.team_id, t.name, tm.flags
    FROM ${db.table('team_member')} tm
    JOIN ${db.table('team')} t ON tm.team_id = t.team_id
    WHERE tm.staff_id = ?
  `, [id]);

  res.json({
    success: true,
    data: {
      staff_id: staff.staff_id,
      username: staff.username,
      firstname: staff.firstname,
      lastname: staff.lastname,
      name: `${staff.firstname || ''} ${staff.lastname || ''}`.trim() || staff.username,
      email: staff.email,
      phone: staff.phone,
      phone_ext: staff.phone_ext,
      mobile: staff.mobile,
      signature: staff.signature,
      timezone: staff.timezone,
      dept_id: staff.dept_id,
      department: { id: staff.dept_id, name: staff.dept_name },
      role: {
        id: staff.role_id,
        name: staff.role_name,
        permissions: staff.role_permissions ? JSON.parse(staff.role_permissions) : {}
      },
      departments: [
        { id: staff.dept_id, name: staff.dept_name, isPrimary: true },
        ...deptAccess.map(da => ({
          id: da.dept_id,
          name: da.dept_name,
          role: da.role_name,
          isPrimary: false
        }))
      ],
      teams: teams.map(t => ({
        team_id: t.team_id,
        name: t.name
      })),
      isactive: !!staff.isactive,
      isadmin: !!staff.isadmin,
      isvisible: !!staff.isvisible,
      onvacation: !!staff.onvacation,
      assigned_only: !!staff.assigned_only,
      lastlogin: staff.lastlogin,
      created: staff.created
    }
  });
};

/**
 * Get staff's assigned tickets
 */
const getTickets = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  const tickets = await db.query(`
    SELECT t.*,
           ts.name as status_name, ts.state as status_state,
           d.name as dept_name,
           tc.subject
    FROM ${db.table('ticket')} t
    LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
    LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
    WHERE t.staff_id = ?
    ORDER BY t.created DESC
    LIMIT ? OFFSET ?
  `, [id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE staff_id = ?
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
      department: { id: t.dept_id, name: t.dept_name },
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
 * Get staff's departments
 */
const getDepartments = async (req, res) => {
  const { id } = req.params;

  const staff = await db.queryOne(`
    SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?
  `, [id]);

  if (!staff) {
    throw ApiError.notFound('Staff member not found');
  }

  // Primary department
  const primary = await db.queryOne(`
    SELECT * FROM ${db.table('department')} WHERE id = ?
  `, [staff.dept_id]);

  // Extended access
  const extended = await db.query(`
    SELECT d.*, sda.role_id
    FROM ${db.table('staff_dept_access')} sda
    JOIN ${db.table('department')} d ON sda.dept_id = d.id
    WHERE sda.staff_id = ?
  `, [id]);

  const departments = [];
  if (primary) {
    departments.push({
      id: primary.id,
      name: primary.name,
      path: primary.path,
      isPrimary: true
    });
  }

  extended.forEach(d => {
    departments.push({
      id: d.id,
      name: d.name,
      path: d.path,
      isPrimary: false
    });
  });

  res.json({
    success: true,
    data: departments
  });
};

/**
 * Get staff's teams
 */
const getTeams = async (req, res) => {
  const { id } = req.params;

  const teams = await db.query(`
    SELECT t.*, tm.flags,
           CASE WHEN t.lead_id = ? THEN 1 ELSE 0 END as is_lead
    FROM ${db.table('team_member')} tm
    JOIN ${db.table('team')} t ON tm.team_id = t.team_id
    WHERE tm.staff_id = ?
  `, [id, id]);

  res.json({
    success: true,
    data: teams.map(t => ({
      team_id: t.team_id,
      name: t.name,
      isLead: !!t.is_lead,
      created: t.created
    }))
  });
};

/**
 * Create staff member
 */
const create = async (req, res) => {
  const {
    username, firstname, lastname, email, password,
    dept_id, role_id, phone, isadmin, isactive,
    signature, timezone, departments
  } = req.body;

  if (!username || username.length < 3 || username.length > 32) {
    throw ApiError.badRequest('Username is required (3-32 characters)');
  }
  if (!firstname) throw ApiError.badRequest('First name is required');
  if (!lastname) throw ApiError.badRequest('Last name is required');
  if (!email) throw ApiError.badRequest('Email is required');
  if (!password || password.length < 8) throw ApiError.badRequest('Password is required (min 8 characters)');
  if (!dept_id) throw ApiError.badRequest('Department is required');
  if (!role_id) throw ApiError.badRequest('Role is required');

  // Check username uniqueness
  const existing = await db.queryOne(`
    SELECT staff_id FROM ${db.table('staff')} WHERE username = ?
  `, [username]);

  if (existing) {
    throw ApiError.conflict('A staff member with this username already exists');
  }

  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 10);
  const now = new Date();

  await db.transaction(async (txQuery) => {
    const result = await txQuery(`
      INSERT INTO ${db.table('staff')} (
        username, firstname, lastname, email, passwd,
        dept_id, role_id, phone, isadmin, isactive,
        signature, timezone, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      username.trim(),
      firstname.trim(),
      lastname.trim(),
      email.trim(),
      hashedPassword,
      dept_id,
      role_id,
      phone || null,
      isadmin ? 1 : 0,
      isactive !== undefined ? (isactive ? 1 : 0) : 1,
      signature || null,
      timezone || null,
      now,
      now
    ]);

    const staffId = result.insertId;

    // Add extended department access
    if (departments && Array.isArray(departments)) {
      for (const dept of departments) {
        await txQuery(`
          INSERT INTO ${db.table('staff_dept_access')} (staff_id, dept_id, role_id, flags)
          VALUES (?, ?, ?, 0)
        `, [staffId, dept.dept_id, dept.role_id || role_id]);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        staff_id: staffId,
        username: username.trim(),
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        email: email.trim(),
        dept_id,
        role_id,
        created: now
      }
    });
  });
};

/**
 * Update staff member
 */
const update = async (req, res) => {
  const { id } = req.params;
  const {
    username, firstname, lastname, email, password,
    dept_id, role_id, phone, isadmin, isactive,
    signature, timezone, departments
  } = req.body;

  const staff = await db.queryOne(`
    SELECT staff_id FROM ${db.table('staff')} WHERE staff_id = ?
  `, [id]);

  if (!staff) {
    throw ApiError.notFound('Staff member not found');
  }

  if (username !== undefined) {
    if (username.length < 3 || username.length > 32) {
      throw ApiError.badRequest('Username must be 3-32 characters');
    }
    const existing = await db.queryOne(`
      SELECT staff_id FROM ${db.table('staff')} WHERE username = ? AND staff_id != ?
    `, [username, id]);
    if (existing) {
      throw ApiError.conflict('A staff member with this username already exists');
    }
  }

  const updates = [];
  const params = [];

  if (username !== undefined) { updates.push('username = ?'); params.push(username.trim()); }
  if (firstname !== undefined) { updates.push('firstname = ?'); params.push(firstname.trim()); }
  if (lastname !== undefined) { updates.push('lastname = ?'); params.push(lastname.trim()); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.trim()); }
  if (dept_id !== undefined) { updates.push('dept_id = ?'); params.push(dept_id); }
  if (role_id !== undefined) { updates.push('role_id = ?'); params.push(role_id); }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
  if (isadmin !== undefined) { updates.push('isadmin = ?'); params.push(isadmin ? 1 : 0); }
  if (isactive !== undefined) { updates.push('isactive = ?'); params.push(isactive ? 1 : 0); }
  if (signature !== undefined) { updates.push('signature = ?'); params.push(signature); }
  if (timezone !== undefined) { updates.push('timezone = ?'); params.push(timezone); }

  if (password !== undefined) {
    if (password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters');
    }
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    updates.push('passwd = ?');
    params.push(hashedPassword);
  }

  if (updates.length === 0 && !departments) {
    throw ApiError.badRequest('No fields to update');
  }

  await db.transaction(async (txQuery) => {
    if (updates.length > 0) {
      updates.push('updated = ?');
      params.push(new Date());
      params.push(id);
      await txQuery(`
        UPDATE ${db.table('staff')} SET ${updates.join(', ')} WHERE staff_id = ?
      `, params);
    }

    // Replace department access if provided
    if (departments && Array.isArray(departments)) {
      await txQuery(`DELETE FROM ${db.table('staff_dept_access')} WHERE staff_id = ?`, [id]);
      for (const dept of departments) {
        await txQuery(`
          INSERT INTO ${db.table('staff_dept_access')} (staff_id, dept_id, role_id, flags)
          VALUES (?, ?, ?, 0)
        `, [id, dept.dept_id, dept.role_id || 0]);
      }
    }
  });

  res.json({ success: true, message: 'Staff member updated' });
};

/**
 * Delete staff member
 */
const remove = async (req, res) => {
  const { id } = req.params;

  const staff = await db.queryOne(`
    SELECT staff_id FROM ${db.table('staff')} WHERE staff_id = ?
  `, [id]);

  if (!staff) {
    throw ApiError.notFound('Staff member not found');
  }

  // Check ticket assignments
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE staff_id = ?
  `, [id]);
  if (parseInt(ticketCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete staff: tickets are assigned to this staff member');
  }

  // Check department manager
  const deptManagerCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('department')} WHERE manager_id = ?
  `, [id]);
  if (parseInt(deptManagerCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete staff: staff member is a department manager');
  }

  // Check team lead
  const teamLeadCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('team')} WHERE lead_id = ?
  `, [id]);
  if (parseInt(teamLeadCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete staff: staff member is a team lead');
  }

  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('staff_dept_access')} WHERE staff_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('team_member')} WHERE staff_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('staff')} WHERE staff_id = ?`, [id]);
  });

  res.json({ success: true, message: 'Staff member deleted' });
};

module.exports = {
  list,
  get,
  getTickets,
  getDepartments,
  getTeams,
  create,
  update,
  remove
};
