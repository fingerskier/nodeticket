/**
 * Staff Service — business logic for staff member operations
 * @module sdk/services/staff
 */

const { ValidationError, NotFoundError, ConflictError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Staff service methods
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
   * List staff members with optional filters and pagination.
   *
   * @param {Object} [filters={}]
   * @param {number|string} [filters.dept_id] - Filter by primary department
   * @param {boolean|string} [filters.isactive] - Filter by active status
   * @param {number|string} [filters.page=1]
   * @param {number|string} [filters.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await staff.list({ dept_id: 1, isactive: true });
   */
  const list = async (filters = {}) => {
    const { dept_id, isactive } = filters;
    const { page, limit, offset } = paginate(filters.page, filters.limit);

    let sql = `
      SELECT s.*, d.name as dept_name, r.name as role_name
      FROM ${conn.table('staff')} s
      LEFT JOIN ${conn.table('department')} d ON s.dept_id = d.id
      LEFT JOIN ${conn.table('role')} r ON s.role_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (dept_id) { sql += ` AND s.dept_id = ?`; params.push(dept_id); }
    if (isactive !== undefined) {
      sql += ` AND s.isactive = ?`;
      params.push(isactive === true || isactive === 'true' || isactive === '1' ? 1 : 0);
    }

    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
    const countResult = await conn.queryOne(countSql, params);
    const total = parseInt(countResult?.count || 0, 10);

    sql += ` ORDER BY s.lastname, s.firstname LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await conn.query(sql, params);

    return {
      data: rows.map((s) => ({
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
        created: s.created,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get staff member details by ID.
   *
   * @param {number|string} id - Staff ID
   * @returns {Promise<Object>} Staff detail with department access and team memberships
   * @throws {NotFoundError} If the staff member does not exist
   *
   * @example
   * const member = await staff.get(1);
   */
  const get = async (id) => {
    const s = await conn.queryOne(`
      SELECT s.*, d.name as dept_name, r.name as role_name, r.permissions as role_permissions
      FROM ${conn.table('staff')} s
      LEFT JOIN ${conn.table('department')} d ON s.dept_id = d.id
      LEFT JOIN ${conn.table('role')} r ON s.role_id = r.id
      WHERE s.staff_id = ?
    `, [id]);

    if (!s) throw new NotFoundError('Staff member not found');

    const deptAccess = await conn.query(`
      SELECT sda.*, d.name as dept_name, r.name as role_name
      FROM ${conn.table('staff_dept_access')} sda
      JOIN ${conn.table('department')} d ON sda.dept_id = d.id
      LEFT JOIN ${conn.table('role')} r ON sda.role_id = r.id
      WHERE sda.staff_id = ?
    `, [id]);

    const teams = await conn.query(`
      SELECT t.team_id, t.name, tm.flags
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('team')} t ON tm.team_id = t.team_id
      WHERE tm.staff_id = ?
    `, [id]);

    return {
      staff_id: s.staff_id,
      username: s.username,
      firstname: s.firstname,
      lastname: s.lastname,
      name: `${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username,
      email: s.email,
      phone: s.phone,
      phone_ext: s.phone_ext,
      mobile: s.mobile,
      signature: s.signature,
      timezone: s.timezone,
      dept_id: s.dept_id,
      department: { id: s.dept_id, name: s.dept_name },
      role: {
        id: s.role_id,
        name: s.role_name,
        permissions: s.role_permissions ? JSON.parse(s.role_permissions) : {},
      },
      departments: [
        { id: s.dept_id, name: s.dept_name, isPrimary: true },
        ...deptAccess.map((da) => ({
          id: da.dept_id,
          name: da.dept_name,
          role: da.role_name,
          isPrimary: false,
        })),
      ],
      teams: teams.map((t) => ({ team_id: t.team_id, name: t.name })),
      isactive: !!s.isactive,
      isadmin: !!s.isadmin,
      isvisible: !!s.isvisible,
      onvacation: !!s.onvacation,
      assigned_only: !!s.assigned_only,
      lastlogin: s.lastlogin,
      created: s.created,
    };
  };

  /**
   * Get paginated tickets assigned to a staff member.
   *
   * @param {number|string} staffId - Staff ID
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await staff.getTickets(1, { page: 1, limit: 10 });
   */
  const getTickets = async (staffId, options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    const tickets = await conn.query(`
      SELECT t.*,
             ts.name as status_name, ts.state as status_state,
             d.name as dept_name,
             tc.subject
      FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${conn.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE t.staff_id = ?
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?
    `, [staffId, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE staff_id = ?`, [staffId]) || 0,
      10,
    );

    return {
      data: tickets.map((t) => ({
        ticket_id: t.ticket_id,
        number: t.number,
        subject: t.subject,
        status: { id: t.status_id, name: t.status_name, state: t.status_state },
        department: { id: t.dept_id, name: t.dept_name },
        isoverdue: !!t.isoverdue,
        created: t.created,
        updated: t.updated,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get a staff member's departments (primary + extended access).
   *
   * @param {number|string} staffId - Staff ID
   * @returns {Promise<Array<Object>>} Department list with isPrimary flag
   * @throws {NotFoundError} If the staff member does not exist
   *
   * @example
   * const depts = await staff.getDepartments(1);
   */
  const getDepartments = async (staffId) => {
    const s = await conn.queryOne(
      `SELECT dept_id FROM ${conn.table('staff')} WHERE staff_id = ?`, [staffId]
    );
    if (!s) throw new NotFoundError('Staff member not found');

    const primary = await conn.queryOne(
      `SELECT * FROM ${conn.table('department')} WHERE id = ?`, [s.dept_id]
    );

    const extended = await conn.query(`
      SELECT d.*, sda.role_id
      FROM ${conn.table('staff_dept_access')} sda
      JOIN ${conn.table('department')} d ON sda.dept_id = d.id
      WHERE sda.staff_id = ?
    `, [staffId]);

    const departments = [];
    if (primary) {
      departments.push({ id: primary.id, name: primary.name, path: primary.path, isPrimary: true });
    }
    extended.forEach((d) => {
      departments.push({ id: d.id, name: d.name, path: d.path, isPrimary: false });
    });

    return departments;
  };

  /**
   * Get a staff member's team memberships.
   *
   * @param {number|string} staffId - Staff ID
   * @returns {Promise<Array<Object>>} Team list with isLead flag
   *
   * @example
   * const teams = await staff.getTeams(1);
   */
  const getTeams = async (staffId) => {
    const teams = await conn.query(`
      SELECT t.*, tm.flags,
             CASE WHEN t.lead_id = ? THEN 1 ELSE 0 END as is_lead
      FROM ${conn.table('team_member')} tm
      JOIN ${conn.table('team')} t ON tm.team_id = t.team_id
      WHERE tm.staff_id = ?
    `, [staffId, staffId]);

    return teams.map((t) => ({
      team_id: t.team_id,
      name: t.name,
      isLead: !!t.is_lead,
      created: t.created,
    }));
  };

  /**
   * Create a new staff member.
   *
   * @param {Object} params
   * @param {string} params.username - Username (3-32 chars)
   * @param {string} params.firstname - First name
   * @param {string} params.lastname - Last name
   * @param {string} params.email - Email address
   * @param {string} params.password - Password (min 8 chars)
   * @param {number|string} params.dept_id - Primary department ID
   * @param {number|string} params.role_id - Role ID
   * @param {string} [params.phone] - Phone number
   * @param {boolean} [params.isadmin=false] - Admin flag
   * @param {boolean} [params.isactive=true] - Active flag
   * @param {string} [params.signature] - Email signature
   * @param {string} [params.timezone] - Timezone
   * @param {Array<{dept_id: number, role_id?: number}>} [params.departments] - Extended dept access
   * @returns {Promise<Object>} Created staff summary
   * @throws {ValidationError} If required fields are missing or invalid
   * @throws {ConflictError} If username already exists
   *
   * @example
   * const member = await staff.create({
   *   username: 'jdoe', firstname: 'John', lastname: 'Doe',
   *   email: 'jdoe@example.com', password: 'secret123',
   *   dept_id: 1, role_id: 1
   * });
   */
  const create = async ({ username, firstname, lastname, email, password, dept_id, role_id, phone, isadmin, isactive, signature, timezone, departments }) => {
    if (!username || username.length < 3 || username.length > 32) {
      throw new ValidationError('Username is required (3-32 characters)');
    }
    if (!firstname) throw new ValidationError('First name is required');
    if (!lastname) throw new ValidationError('Last name is required');
    if (!email) throw new ValidationError('Email is required');
    if (!password || password.length < 8) throw new ValidationError('Password is required (min 8 characters)');
    if (!dept_id) throw new ValidationError('Department is required');
    if (!role_id) throw new ValidationError('Role is required');

    const existing = await conn.queryOne(
      `SELECT staff_id FROM ${conn.table('staff')} WHERE username = ?`, [username]
    );
    if (existing) throw new ConflictError('A staff member with this username already exists');

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date();
    let result;

    await conn.transaction(async (txQuery) => {
      const insertResult = await txQuery(`
        INSERT INTO ${conn.table('staff')} (
          username, firstname, lastname, email, passwd,
          dept_id, role_id, phone, isadmin, isactive,
          signature, timezone, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        username.trim(), firstname.trim(), lastname.trim(), email.trim(), hashedPassword,
        dept_id, role_id, phone || null, isadmin ? 1 : 0,
        isactive !== undefined ? (isactive ? 1 : 0) : 1,
        signature || null, timezone || null, now, now,
      ]);

      const staffId = insertResult.insertId;

      if (departments && Array.isArray(departments)) {
        for (const dept of departments) {
          await txQuery(`
            INSERT INTO ${conn.table('staff_dept_access')} (staff_id, dept_id, role_id, flags)
            VALUES (?, ?, ?, 0)
          `, [staffId, dept.dept_id, dept.role_id || role_id]);
        }
      }

      result = {
        staff_id: staffId,
        username: username.trim(),
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        email: email.trim(),
        dept_id,
        role_id,
        created: now,
      };
    });

    return result;
  };

  /**
   * Update a staff member.
   *
   * @param {number|string} id - Staff ID
   * @param {Object} changes
   * @param {string} [changes.username] - Username (3-32 chars)
   * @param {string} [changes.firstname] - First name
   * @param {string} [changes.lastname] - Last name
   * @param {string} [changes.email] - Email address
   * @param {string} [changes.password] - New password (min 8 chars)
   * @param {number} [changes.dept_id] - Primary department
   * @param {number} [changes.role_id] - Role
   * @param {string} [changes.phone] - Phone
   * @param {boolean} [changes.isadmin] - Admin flag
   * @param {boolean} [changes.isactive] - Active flag
   * @param {string} [changes.signature] - Signature
   * @param {string} [changes.timezone] - Timezone
   * @param {Array<{dept_id: number, role_id?: number}>} [changes.departments] - Replaces extended dept access
   * @returns {Promise<void>}
   * @throws {NotFoundError} If the staff member does not exist
   * @throws {ValidationError} If no fields provided or validation fails
   * @throws {ConflictError} If username is taken
   *
   * @example
   * await staff.update(1, { firstname: 'Jane', isactive: true });
   */
  const update = async (id, changes = {}) => {
    const s = await conn.queryOne(
      `SELECT staff_id FROM ${conn.table('staff')} WHERE staff_id = ?`, [id]
    );
    if (!s) throw new NotFoundError('Staff member not found');

    const { username, firstname, lastname, email, password, dept_id, role_id, phone, isadmin, isactive, signature, timezone, departments } = changes;

    if (username !== undefined) {
      if (username.length < 3 || username.length > 32) {
        throw new ValidationError('Username must be 3-32 characters');
      }
      const existing = await conn.queryOne(
        `SELECT staff_id FROM ${conn.table('staff')} WHERE username = ? AND staff_id != ?`, [username, id]
      );
      if (existing) throw new ConflictError('A staff member with this username already exists');
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
      if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
      const bcrypt = require('bcryptjs');
      const hashed = await bcrypt.hash(password, 10);
      updates.push('passwd = ?'); params.push(hashed);
    }

    if (updates.length === 0 && !departments) {
      throw new ValidationError('No fields to update');
    }

    await conn.transaction(async (txQuery) => {
      if (updates.length > 0) {
        updates.push('updated = ?');
        params.push(new Date());
        params.push(id);
        await txQuery(
          `UPDATE ${conn.table('staff')} SET ${updates.join(', ')} WHERE staff_id = ?`, params
        );
      }

      if (departments && Array.isArray(departments)) {
        await txQuery(`DELETE FROM ${conn.table('staff_dept_access')} WHERE staff_id = ?`, [id]);
        for (const dept of departments) {
          await txQuery(`
            INSERT INTO ${conn.table('staff_dept_access')} (staff_id, dept_id, role_id, flags)
            VALUES (?, ?, ?, 0)
          `, [id, dept.dept_id, dept.role_id || 0]);
        }
      }
    });
  };

  /**
   * Delete a staff member.
   *
   * @param {number|string} id - Staff ID
   * @returns {Promise<void>}
   * @throws {NotFoundError} If the staff member does not exist
   * @throws {ConflictError} If staff has assigned tickets, is a dept manager, or team lead
   *
   * @example
   * await staff.remove(1);
   */
  const remove = async (id) => {
    const s = await conn.queryOne(
      `SELECT staff_id FROM ${conn.table('staff')} WHERE staff_id = ?`, [id]
    );
    if (!s) throw new NotFoundError('Staff member not found');

    const ticketCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE staff_id = ?`, [id]) || 0, 10
    );
    if (ticketCount > 0) {
      throw new ConflictError('Cannot delete staff: tickets are assigned to this staff member');
    }

    const deptManagerCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('department')} WHERE manager_id = ?`, [id]) || 0, 10
    );
    if (deptManagerCount > 0) {
      throw new ConflictError('Cannot delete staff: staff member is a department manager');
    }

    const teamLeadCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('team')} WHERE lead_id = ?`, [id]) || 0, 10
    );
    if (teamLeadCount > 0) {
      throw new ConflictError('Cannot delete staff: staff member is a team lead');
    }

    await conn.transaction(async (txQuery) => {
      await txQuery(`DELETE FROM ${conn.table('staff_dept_access')} WHERE staff_id = ?`, [id]);
      await txQuery(`DELETE FROM ${conn.table('team_member')} WHERE staff_id = ?`, [id]);
      await txQuery(`DELETE FROM ${conn.table('staff')} WHERE staff_id = ?`, [id]);
    });
  };

  return {
    list,
    get,
    getTickets,
    getDepartments,
    getTeams,
    create,
    update,
    remove,
  };
};
