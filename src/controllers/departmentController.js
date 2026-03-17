/**
 * Department Controller
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
 * List departments
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { ispublic } = req.query;

  let sql = `
    SELECT d.*,
           p.name as parent_name,
           s.firstname, s.lastname,
           sla.name as sla_name
    FROM ${db.table('department')} d
    LEFT JOIN ${db.table('department')} p ON d.pid = p.id
    LEFT JOIN ${db.table('staff')} s ON d.manager_id = s.staff_id
    LEFT JOIN ${db.table('sla')} sla ON d.sla_id = sla.id
    WHERE 1=1
  `;
  const params = [];

  // Filter by public visibility for non-staff
  if (req.auth?.type !== 'staff' && req.auth?.type !== 'apikey') {
    sql += ` AND d.ispublic = 1`;
  } else if (ispublic !== undefined) {
    sql += ` AND d.ispublic = ?`;
    params.push(ispublic === 'true' || ispublic === '1' ? 1 : 0);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add pagination
  sql += ` ORDER BY d.name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const departments = await db.query(sql, params);

  res.json({
    success: true,
    data: departments.map(d => ({
      id: d.id,
      pid: d.pid,
      name: d.name,
      path: d.path,
      ispublic: !!d.ispublic,
      flags: d.flags,
      parent: d.pid ? { id: d.pid, name: d.parent_name } : null,
      manager: d.manager_id ? {
        staff_id: d.manager_id,
        name: `${d.firstname || ''} ${d.lastname || ''}`.trim()
      } : null,
      sla: d.sla_id ? { id: d.sla_id, name: d.sla_name } : null,
      created: d.created
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
 * Get department details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const dept = await db.queryOne(`
    SELECT d.*,
           p.name as parent_name,
           s.staff_id as manager_staff_id, s.firstname, s.lastname, s.email as manager_email,
           sla.name as sla_name, sla.grace_period
    FROM ${db.table('department')} d
    LEFT JOIN ${db.table('department')} p ON d.pid = p.id
    LEFT JOIN ${db.table('staff')} s ON d.manager_id = s.staff_id
    LEFT JOIN ${db.table('sla')} sla ON d.sla_id = sla.id
    WHERE d.id = ?
  `, [id]);

  if (!dept) {
    throw ApiError.notFound('Department not found');
  }

  // Get staff count
  const staffCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = ? AND isactive = 1
  `, [id]);

  // Get ticket count
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} t
    JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    WHERE t.dept_id = ? AND ts.state = 'open'
  `, [id]);

  res.json({
    success: true,
    data: {
      id: dept.id,
      pid: dept.pid,
      name: dept.name,
      path: dept.path,
      signature: dept.signature,
      ispublic: !!dept.ispublic,
      flags: dept.flags,
      ticket_auto_response: !!dept.ticket_auto_response,
      message_auto_response: !!dept.message_auto_response,
      parent: dept.pid ? { id: dept.pid, name: dept.parent_name } : null,
      manager: dept.manager_staff_id ? {
        staff_id: dept.manager_staff_id,
        name: `${dept.firstname || ''} ${dept.lastname || ''}`.trim(),
        email: dept.manager_email
      } : null,
      sla: dept.sla_id ? {
        id: dept.sla_id,
        name: dept.sla_name,
        grace_period: dept.grace_period
      } : null,
      staffCount: parseInt(staffCount || 0, 10),
      ticketCount: parseInt(ticketCount || 0, 10),
      created: dept.created,
      updated: dept.updated
    }
  });
};

/**
 * Get department staff
 */
const getStaff = async (req, res) => {
  const { id } = req.params;

  // Primary members
  const primary = await db.query(`
    SELECT s.*, r.name as role_name
    FROM ${db.table('staff')} s
    LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
    WHERE s.dept_id = ? AND s.isactive = 1
  `, [id]);

  // Extended access members
  const extended = await db.query(`
    SELECT s.*, sda.role_id as access_role_id, r.name as role_name
    FROM ${db.table('staff_dept_access')} sda
    JOIN ${db.table('staff')} s ON sda.staff_id = s.staff_id
    LEFT JOIN ${db.table('role')} r ON sda.role_id = r.id
    WHERE sda.dept_id = ? AND s.isactive = 1
  `, [id]);

  const staff = [
    ...primary.map(s => ({
      staff_id: s.staff_id,
      username: s.username,
      name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
      email: s.email,
      role: s.role_name,
      isPrimary: true,
      onvacation: !!s.onvacation
    })),
    ...extended.map(s => ({
      staff_id: s.staff_id,
      username: s.username,
      name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
      email: s.email,
      role: s.role_name,
      isPrimary: false,
      onvacation: !!s.onvacation
    }))
  ];

  res.json({
    success: true,
    data: staff
  });
};

/**
 * Get department tickets
 */
const getTickets = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  const tickets = await db.query(`
    SELECT t.*,
           ts.name as status_name, ts.state as status_state,
           u.name as user_name,
           CONCAT(s.firstname, ' ', s.lastname) as staff_name,
           tc.subject
    FROM ${db.table('ticket')} t
    LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
    LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
    LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
    WHERE t.dept_id = ?
    ORDER BY t.created DESC
    LIMIT ? OFFSET ?
  `, [id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE dept_id = ?
  `, [id]);

  res.json({
    success: true,
    data: tickets.map(t => ({
      ticket_id: t.ticket_id,
      number: t.number,
      subject: t.subject,
      user_name: t.user_name,
      staff_name: t.staff_name,
      status: {
        id: t.status_id,
        name: t.status_name,
        state: t.status_state
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
 * Create department
 */
const create = async (req, res) => {
  const { name, pid, manager_id, sla_id, ispublic, signature, flags } = req.body;

  if (!name || name.length < 1) {
    throw ApiError.badRequest('Name is required');
  }

  // Build path from parent
  let path = `/${name}`;
  if (pid) {
    const parent = await db.queryOne(`
      SELECT id, path FROM ${db.table('department')} WHERE id = ?
    `, [pid]);
    if (!parent) {
      throw ApiError.badRequest('Parent department not found');
    }
    path = `${parent.path}/${name}`;
  }

  const now = new Date();
  const result = await db.query(`
    INSERT INTO ${db.table('department')} (pid, name, path, manager_id, sla_id, ispublic, signature, flags, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    pid || 0,
    name.trim(),
    path,
    manager_id || 0,
    sla_id || 0,
    ispublic !== undefined ? (ispublic ? 1 : 0) : 1,
    signature || null,
    flags || 0,
    now,
    now
  ]);

  res.status(201).json({
    success: true,
    data: {
      id: result.insertId,
      name: name.trim(),
      path,
      pid: pid || 0,
      created: now
    }
  });
};

/**
 * Update department
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { name, pid, manager_id, sla_id, ispublic, signature, flags } = req.body;

  const dept = await db.queryOne(`
    SELECT * FROM ${db.table('department')} WHERE id = ?
  `, [id]);

  if (!dept) {
    throw ApiError.notFound('Department not found');
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (manager_id !== undefined) { updates.push('manager_id = ?'); params.push(manager_id); }
  if (sla_id !== undefined) { updates.push('sla_id = ?'); params.push(sla_id); }
  if (ispublic !== undefined) { updates.push('ispublic = ?'); params.push(ispublic ? 1 : 0); }
  if (signature !== undefined) { updates.push('signature = ?'); params.push(signature); }
  if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }

  // If pid or name changes, recalculate path
  let descendantUpdates = [];
  if (pid !== undefined || name !== undefined) {
    const newPid = pid !== undefined ? pid : dept.pid;
    const newName = name !== undefined ? name.trim() : dept.name;

    let newPath = `/${newName}`;
    if (newPid) {
      const parent = await db.queryOne(`
        SELECT path FROM ${db.table('department')} WHERE id = ?
      `, [newPid]);
      if (parent) {
        newPath = `${parent.path}/${newName}`;
      }
    }

    if (pid !== undefined) { updates.push('pid = ?'); params.push(pid); }
    updates.push('path = ?');
    params.push(newPath);

    // Prepare descendant path updates
    const oldPath = dept.path;
    if (newPath !== oldPath) {
      const descendants = await db.query(`
        SELECT id, path FROM ${db.table('department')} WHERE path LIKE ?
      `, [`${oldPath}/%`]);

      descendantUpdates = descendants.map(desc => ({
        id: desc.id,
        path: desc.path.replace(oldPath, newPath)
      }));
    }
  }

  if (updates.length === 0) {
    throw ApiError.badRequest('No fields to update');
  }

  updates.push('updated = ?');
  params.push(new Date());
  params.push(id);

  // Wrap main update + descendant path updates in a transaction
  await db.transaction(async (txQuery) => {
    await txQuery(`
      UPDATE ${db.table('department')} SET ${updates.join(', ')} WHERE id = ?
    `, params);

    for (const desc of descendantUpdates) {
      await txQuery(`
        UPDATE ${db.table('department')} SET path = ? WHERE id = ?
      `, [desc.path, desc.id]);
    }
  });

  res.json({ success: true, message: 'Department updated' });
};

/**
 * Delete department
 */
const remove = async (req, res) => {
  const { id } = req.params;

  const dept = await db.queryOne(`
    SELECT id FROM ${db.table('department')} WHERE id = ?
  `, [id]);

  if (!dept) {
    throw ApiError.notFound('Department not found');
  }

  // Check child departments
  const childCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('department')} WHERE pid = ?
  `, [id]);
  if (parseInt(childCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete department: has child departments');
  }

  // Check staff
  const staffCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = ?
  `, [id]);
  if (parseInt(staffCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete department: staff members are assigned');
  }

  // Check tickets
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} WHERE dept_id = ?
  `, [id]);
  if (parseInt(ticketCount || 0, 10) > 0) {
    throw ApiError.conflict('Cannot delete department: tickets are assigned');
  }

  await db.query(`DELETE FROM ${db.table('department')} WHERE id = ?`, [id]);

  res.json({ success: true, message: 'Department deleted' });
};

module.exports = {
  list,
  get,
  getStaff,
  getTickets,
  create,
  update,
  remove
};
