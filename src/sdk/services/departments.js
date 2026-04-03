/**
 * Department Service — business logic for department operations
 * @module sdk/services/departments
 */

const { ValidationError, NotFoundError, ConflictError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Department service methods
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
   * List departments with optional filters and pagination.
   *
   * @param {Object} [filters={}]
   * @param {boolean|string} [filters.ispublic] - Filter by public visibility
   * @param {number|string} [filters.page=1]
   * @param {number|string} [filters.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await departments.list({ ispublic: true, page: 1 });
   */
  const list = async (filters = {}) => {
    const { ispublic } = filters;
    const { page, limit, offset } = paginate(filters.page, filters.limit);

    let sql = `
      SELECT d.*,
             p.name as parent_name,
             s.firstname, s.lastname,
             sla.name as sla_name
      FROM ${conn.table('department')} d
      LEFT JOIN ${conn.table('department')} p ON d.pid = p.id
      LEFT JOIN ${conn.table('staff')} s ON d.manager_id = s.staff_id
      LEFT JOIN ${conn.table('sla')} sla ON d.sla_id = sla.id
      WHERE 1=1
    `;
    const params = [];

    if (ispublic !== undefined) {
      sql += ` AND d.ispublic = ?`;
      params.push(ispublic === true || ispublic === 'true' || ispublic === '1' ? 1 : 0);
    }

    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
    const countResult = await conn.queryOne(countSql, params);
    const total = parseInt(countResult?.count || 0, 10);

    sql += ` ORDER BY d.name LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const departments = await conn.query(sql, params);

    return {
      data: departments.map((d) => ({
        id: d.id,
        pid: d.pid,
        name: d.name,
        path: d.path,
        ispublic: !!d.ispublic,
        flags: d.flags,
        parent: d.pid ? { id: d.pid, name: d.parent_name } : null,
        manager: d.manager_id ? {
          staff_id: d.manager_id,
          name: `${d.firstname || ''} ${d.lastname || ''}`.trim(),
        } : null,
        sla: d.sla_id ? { id: d.sla_id, name: d.sla_name } : null,
        created: d.created,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get department details by ID.
   *
   * @param {number|string} id - Department ID
   * @returns {Promise<Object>} Department detail with staff/ticket counts
   * @throws {NotFoundError} If the department does not exist
   *
   * @example
   * const dept = await departments.get(1);
   */
  const get = async (id) => {
    const dept = await conn.queryOne(`
      SELECT d.*,
             p.name as parent_name,
             s.staff_id as manager_staff_id, s.firstname, s.lastname, s.email as manager_email,
             sla.name as sla_name, sla.grace_period
      FROM ${conn.table('department')} d
      LEFT JOIN ${conn.table('department')} p ON d.pid = p.id
      LEFT JOIN ${conn.table('staff')} s ON d.manager_id = s.staff_id
      LEFT JOIN ${conn.table('sla')} sla ON d.sla_id = sla.id
      WHERE d.id = ?
    `, [id]);

    if (!dept) throw new NotFoundError('Department not found');

    const staffCount = parseInt(
      await conn.queryValue(
        `SELECT COUNT(*) FROM ${conn.table('staff')} WHERE dept_id = ? AND isactive = 1`, [id]
      ) || 0, 10,
    );

    const ticketCount = parseInt(
      await conn.queryValue(`
        SELECT COUNT(*) FROM ${conn.table('ticket')} t
        JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
        WHERE t.dept_id = ? AND ts.state = 'open'
      `, [id]) || 0, 10,
    );

    return {
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
        email: dept.manager_email,
      } : null,
      sla: dept.sla_id ? {
        id: dept.sla_id,
        name: dept.sla_name,
        grace_period: dept.grace_period,
      } : null,
      staffCount,
      ticketCount,
      created: dept.created,
      updated: dept.updated,
    };
  };

  /**
   * Get staff members in a department (primary + extended access).
   *
   * @param {number|string} id - Department ID
   * @returns {Promise<Array<Object>>} Staff list with isPrimary flag
   *
   * @example
   * const staff = await departments.getStaff(1);
   */
  const getStaff = async (id) => {
    const primary = await conn.query(`
      SELECT s.*, r.name as role_name
      FROM ${conn.table('staff')} s
      LEFT JOIN ${conn.table('role')} r ON s.role_id = r.id
      WHERE s.dept_id = ? AND s.isactive = 1
    `, [id]);

    const extended = await conn.query(`
      SELECT s.*, sda.role_id as access_role_id, r.name as role_name
      FROM ${conn.table('staff_dept_access')} sda
      JOIN ${conn.table('staff')} s ON sda.staff_id = s.staff_id
      LEFT JOIN ${conn.table('role')} r ON sda.role_id = r.id
      WHERE sda.dept_id = ? AND s.isactive = 1
    `, [id]);

    return [
      ...primary.map((s) => ({
        staff_id: s.staff_id,
        username: s.username,
        name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
        email: s.email,
        role: s.role_name,
        isPrimary: true,
        onvacation: !!s.onvacation,
      })),
      ...extended.map((s) => ({
        staff_id: s.staff_id,
        username: s.username,
        name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
        email: s.email,
        role: s.role_name,
        isPrimary: false,
        onvacation: !!s.onvacation,
      })),
    ];
  };

  /**
   * Get paginated tickets for a department.
   *
   * @param {number|string} deptId - Department ID
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await departments.getTickets(1, { page: 1, limit: 10 });
   */
  const getTickets = async (deptId, options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    const tickets = await conn.query(`
      SELECT t.*,
             ts.name as status_name, ts.state as status_state,
             u.name as user_name,
             CONCAT(s.firstname, ' ', s.lastname) as staff_name,
             tc.subject
      FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${conn.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${conn.table('staff')} s ON t.staff_id = s.staff_id
      LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE t.dept_id = ?
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?
    `, [deptId, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE dept_id = ?`, [deptId]) || 0, 10,
    );

    return {
      data: tickets.map((t) => ({
        ticket_id: t.ticket_id,
        number: t.number,
        subject: t.subject,
        user_name: t.user_name,
        staff_name: t.staff_name,
        status: { id: t.status_id, name: t.status_name, state: t.status_state },
        isoverdue: !!t.isoverdue,
        created: t.created,
        updated: t.updated,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Create a new department.
   *
   * @param {Object} params
   * @param {string} params.name - Department name
   * @param {number|string} [params.pid=0] - Parent department ID
   * @param {number|string} [params.manager_id=0] - Manager staff ID
   * @param {number|string} [params.sla_id=0] - SLA ID
   * @param {boolean} [params.ispublic=true] - Public visibility
   * @param {string} [params.signature] - Department email signature
   * @param {number} [params.flags=0] - Department flags
   * @returns {Promise<Object>} Created department summary
   * @throws {ValidationError} If name is missing or parent not found
   *
   * @example
   * const dept = await departments.create({ name: 'Support', ispublic: true });
   */
  const create = async ({ name, pid, manager_id, sla_id, ispublic, signature, flags }) => {
    if (!name || name.length < 1) throw new ValidationError('Name is required');

    let path = `/${name.trim()}`;
    if (pid) {
      const parent = await conn.queryOne(
        `SELECT id, path FROM ${conn.table('department')} WHERE id = ?`, [pid]
      );
      if (!parent) throw new ValidationError('Parent department not found');
      path = `${parent.path}/${name.trim()}`;
    }

    const now = new Date();
    const result = await conn.query(`
      INSERT INTO ${conn.table('department')} (pid, name, path, manager_id, sla_id, ispublic, signature, flags, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pid || 0, name.trim(), path, manager_id || 0, sla_id || 0,
      ispublic !== undefined ? (ispublic ? 1 : 0) : 1,
      signature || null, flags || 0, now, now,
    ]);

    return {
      id: result.insertId,
      name: name.trim(),
      path,
      pid: pid || 0,
      created: now,
    };
  };

  /**
   * Update a department. Recalculates path and descendant paths when name or pid changes.
   *
   * @param {number|string} id - Department ID
   * @param {Object} changes
   * @param {string} [changes.name] - Department name
   * @param {number} [changes.pid] - Parent department ID
   * @param {number} [changes.manager_id] - Manager staff ID
   * @param {number} [changes.sla_id] - SLA ID
   * @param {boolean} [changes.ispublic] - Public visibility
   * @param {string} [changes.signature] - Signature
   * @param {number} [changes.flags] - Flags
   * @returns {Promise<void>}
   * @throws {NotFoundError} If department not found
   * @throws {ValidationError} If no fields provided
   *
   * @example
   * await departments.update(1, { name: 'Engineering', ispublic: false });
   */
  const update = async (id, changes = {}) => {
    const { name, pid, manager_id, sla_id, ispublic, signature, flags } = changes;

    const dept = await conn.queryOne(
      `SELECT * FROM ${conn.table('department')} WHERE id = ?`, [id]
    );
    if (!dept) throw new NotFoundError('Department not found');

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (manager_id !== undefined) { updates.push('manager_id = ?'); params.push(manager_id); }
    if (sla_id !== undefined) { updates.push('sla_id = ?'); params.push(sla_id); }
    if (ispublic !== undefined) { updates.push('ispublic = ?'); params.push(ispublic ? 1 : 0); }
    if (signature !== undefined) { updates.push('signature = ?'); params.push(signature); }
    if (flags !== undefined) { updates.push('flags = ?'); params.push(flags); }

    // Recalculate path if pid or name changes
    let descendantUpdates = [];
    if (pid !== undefined || name !== undefined) {
      const newPid = pid !== undefined ? pid : dept.pid;
      const newName = name !== undefined ? name.trim() : dept.name;

      let newPath = `/${newName}`;
      if (newPid) {
        const parent = await conn.queryOne(
          `SELECT path FROM ${conn.table('department')} WHERE id = ?`, [newPid]
        );
        if (parent) newPath = `${parent.path}/${newName}`;
      }

      if (pid !== undefined) { updates.push('pid = ?'); params.push(pid); }
      updates.push('path = ?');
      params.push(newPath);

      const oldPath = dept.path;
      if (newPath !== oldPath) {
        const descendants = await conn.query(
          `SELECT id, path FROM ${conn.table('department')} WHERE path LIKE ?`, [`${oldPath}/%`]
        );
        descendantUpdates = descendants.map((desc) => ({
          id: desc.id,
          path: desc.path.replace(oldPath, newPath),
        }));
      }
    }

    if (updates.length === 0) throw new ValidationError('No fields to update');

    updates.push('updated = ?');
    params.push(new Date());
    params.push(id);

    await conn.transaction(async (txQuery) => {
      await txQuery(
        `UPDATE ${conn.table('department')} SET ${updates.join(', ')} WHERE id = ?`, params
      );
      for (const desc of descendantUpdates) {
        await txQuery(
          `UPDATE ${conn.table('department')} SET path = ? WHERE id = ?`, [desc.path, desc.id]
        );
      }
    });
  };

  /**
   * Delete a department.
   *
   * @param {number|string} id - Department ID
   * @returns {Promise<void>}
   * @throws {NotFoundError} If department not found
   * @throws {ConflictError} If department has children, staff, or tickets
   *
   * @example
   * await departments.remove(1);
   */
  const remove = async (id) => {
    const dept = await conn.queryOne(
      `SELECT id FROM ${conn.table('department')} WHERE id = ?`, [id]
    );
    if (!dept) throw new NotFoundError('Department not found');

    const childCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('department')} WHERE pid = ?`, [id]) || 0, 10
    );
    if (childCount > 0) throw new ConflictError('Cannot delete department: has child departments');

    const staffCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('staff')} WHERE dept_id = ?`, [id]) || 0, 10
    );
    if (staffCount > 0) throw new ConflictError('Cannot delete department: staff members are assigned');

    const ticketCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE dept_id = ?`, [id]) || 0, 10
    );
    if (ticketCount > 0) throw new ConflictError('Cannot delete department: tickets are assigned');

    await conn.query(`DELETE FROM ${conn.table('department')} WHERE id = ?`, [id]);
  };

  return {
    list,
    get,
    getStaff,
    getTickets,
    create,
    update,
    remove,
  };
};
