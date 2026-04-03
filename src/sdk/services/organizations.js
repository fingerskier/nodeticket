/**
 * Organization Service — business logic for organization operations
 * @module sdk/services/organizations
 */

const { ValidationError, NotFoundError, ConflictError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Organization service methods
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
   * List organizations with optional search and pagination.
   *
   * @param {Object} [filters={}]
   * @param {string} [filters.search] - Search by name or domain
   * @param {number|string} [filters.page=1]
   * @param {number|string} [filters.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await organizations.list({ search: 'acme', page: 1 });
   */
  const list = async (filters = {}) => {
    const { search } = filters;
    const { page, limit, offset } = paginate(filters.page, filters.limit);

    let sql = `
      SELECT o.*,
             (SELECT COUNT(*) FROM ${conn.table('user')} WHERE org_id = o.id) as user_count
      FROM ${conn.table('organization')} o
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (o.name LIKE ? OR o.domain LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term);
    }

    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
    const countResult = await conn.queryOne(countSql, params);
    const total = parseInt(countResult?.count || 0, 10);

    sql += ` ORDER BY o.name LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const orgs = await conn.query(sql, params);

    return {
      data: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        domain: o.domain,
        status: o.status,
        userCount: parseInt(o.user_count || 0, 10),
        created: o.created,
        updated: o.updated,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get organization details by ID.
   *
   * @param {number|string} id - Organization ID
   * @returns {Promise<Object>} Organization detail with user/ticket counts and manager
   * @throws {NotFoundError} If the organization does not exist
   *
   * @example
   * const org = await organizations.get(1);
   */
  const get = async (id) => {
    const org = await conn.queryOne(
      `SELECT * FROM ${conn.table('organization')} WHERE id = ?`, [id]
    );
    if (!org) throw new NotFoundError('Organization not found');

    const userCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('user')} WHERE org_id = ?`, [id]) || 0, 10
    );

    const ticketCount = parseInt(
      await conn.queryValue(`
        SELECT COUNT(*) FROM ${conn.table('ticket')} t
        JOIN ${conn.table('user')} u ON t.user_id = u.id
        WHERE u.org_id = ?
      `, [id]) || 0, 10
    );

    // Parse manager field (format: "s:ID" for staff, "t:ID" for team)
    let manager = null;
    if (org.manager) {
      const [type, managerId] = org.manager.split(':');
      if (type === 's' && managerId) {
        const staff = await conn.queryOne(
          `SELECT staff_id, firstname, lastname, email FROM ${conn.table('staff')} WHERE staff_id = ?`,
          [managerId],
        );
        if (staff) {
          manager = {
            type: 'staff',
            staff_id: staff.staff_id,
            name: `${staff.firstname || ''} ${staff.lastname || ''}`.trim(),
            email: staff.email,
          };
        }
      }
    }

    return {
      id: org.id,
      name: org.name,
      domain: org.domain,
      status: org.status,
      manager,
      extra: org.extra ? JSON.parse(org.extra) : null,
      userCount,
      ticketCount,
      created: org.created,
      updated: org.updated,
    };
  };

  /**
   * Get paginated users in an organization.
   *
   * @param {number|string} orgId - Organization ID
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await organizations.getUsers(1, { page: 1 });
   */
  const getUsers = async (orgId, options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    const users = await conn.query(`
      SELECT u.*, ue.address as email
      FROM ${conn.table('user')} u
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      WHERE u.org_id = ?
      ORDER BY u.name
      LIMIT ? OFFSET ?
    `, [orgId, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('user')} WHERE org_id = ?`, [orgId]) || 0, 10
    );

    return {
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        status: u.status,
        created: u.created,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get paginated tickets from users in an organization.
   *
   * @param {number|string} orgId - Organization ID
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await organizations.getTickets(1, { page: 1 });
   */
  const getTickets = async (orgId, options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    const tickets = await conn.query(`
      SELECT t.*,
             ts.name as status_name, ts.state as status_state,
             d.name as dept_name,
             u.name as user_name,
             tc.subject
      FROM ${conn.table('ticket')} t
      JOIN ${conn.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${conn.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE u.org_id = ?
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?
    `, [orgId, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`
        SELECT COUNT(*) FROM ${conn.table('ticket')} t
        JOIN ${conn.table('user')} u ON t.user_id = u.id
        WHERE u.org_id = ?
      `, [orgId]) || 0, 10
    );

    return {
      data: tickets.map((t) => ({
        ticket_id: t.ticket_id,
        number: t.number,
        subject: t.subject,
        user_name: t.user_name,
        status: { id: t.status_id, name: t.status_name, state: t.status_state },
        department: { id: t.dept_id, name: t.dept_name },
        isoverdue: !!t.isoverdue,
        created: t.created,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Create a new organization.
   *
   * @param {Object} params
   * @param {string} params.name - Organization name (1-128 chars)
   * @param {string} [params.domain] - Domain
   * @param {number} [params.status=0] - Status
   * @param {string} [params.manager] - Manager reference (e.g. "s:5")
   * @param {Object} [params.extra] - Extra metadata (stored as JSON)
   * @returns {Promise<Object>} Created organization summary
   * @throws {ValidationError} If name is missing or invalid
   * @throws {ConflictError} If name already exists
   *
   * @example
   * const org = await organizations.create({ name: 'Acme Corp', domain: 'acme.com' });
   */
  const create = async ({ name, domain, status, manager, extra }) => {
    if (!name || name.length < 1 || name.length > 128) {
      throw new ValidationError('Name is required (1-128 characters)');
    }

    const existing = await conn.queryOne(
      `SELECT id FROM ${conn.table('organization')} WHERE name = ?`, [name]
    );
    if (existing) throw new ConflictError('An organization with this name already exists');

    const now = new Date();
    const result = await conn.query(`
      INSERT INTO ${conn.table('organization')} (name, domain, status, manager, extra, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      name.trim(), domain || null, status || 0,
      manager || null, extra ? JSON.stringify(extra) : null,
      now, now,
    ]);

    return {
      id: result.insertId,
      name: name.trim(),
      domain: domain || null,
      status: status || 0,
      created: now,
    };
  };

  /**
   * Update an organization.
   *
   * @param {number|string} id - Organization ID
   * @param {Object} changes
   * @param {string} [changes.name] - Name (1-128 chars)
   * @param {string} [changes.domain] - Domain
   * @param {number} [changes.status] - Status
   * @param {string} [changes.manager] - Manager reference
   * @param {Object} [changes.extra] - Extra metadata
   * @returns {Promise<void>}
   * @throws {NotFoundError} If organization not found
   * @throws {ValidationError} If no fields provided or name invalid
   * @throws {ConflictError} If name is taken
   *
   * @example
   * await organizations.update(1, { name: 'Acme Inc' });
   */
  const update = async (id, changes = {}) => {
    const { name, domain, status, manager, extra } = changes;

    const org = await conn.queryOne(
      `SELECT id FROM ${conn.table('organization')} WHERE id = ?`, [id]
    );
    if (!org) throw new NotFoundError('Organization not found');

    if (name !== undefined) {
      if (name.length < 1 || name.length > 128) {
        throw new ValidationError('Name must be 1-128 characters');
      }
      const existing = await conn.queryOne(
        `SELECT id FROM ${conn.table('organization')} WHERE name = ? AND id != ?`, [name, id]
      );
      if (existing) throw new ConflictError('An organization with this name already exists');
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (domain !== undefined) { updates.push('domain = ?'); params.push(domain); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (manager !== undefined) { updates.push('manager = ?'); params.push(manager); }
    if (extra !== undefined) { updates.push('extra = ?'); params.push(JSON.stringify(extra)); }

    if (updates.length === 0) throw new ValidationError('No fields to update');

    updates.push('updated = ?');
    params.push(new Date());
    params.push(id);

    await conn.query(
      `UPDATE ${conn.table('organization')} SET ${updates.join(', ')} WHERE id = ?`, params
    );
  };

  /**
   * Delete an organization.
   *
   * @param {number|string} id - Organization ID
   * @returns {Promise<void>}
   * @throws {NotFoundError} If organization not found
   * @throws {ConflictError} If users are assigned to the organization
   *
   * @example
   * await organizations.remove(1);
   */
  const remove = async (id) => {
    const org = await conn.queryOne(
      `SELECT id FROM ${conn.table('organization')} WHERE id = ?`, [id]
    );
    if (!org) throw new NotFoundError('Organization not found');

    const userCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('user')} WHERE org_id = ?`, [id]) || 0, 10
    );
    if (userCount > 0) {
      throw new ConflictError('Cannot delete organization: users are assigned to it');
    }

    await conn.query(`DELETE FROM ${conn.table('organization')} WHERE id = ?`, [id]);
  };

  return {
    list,
    get,
    getUsers,
    getTickets,
    create,
    update,
    remove,
  };
};
