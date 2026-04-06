/**
 * User Service — business logic for user operations
 * @module sdk/services/users
 */

const { ValidationError, NotFoundError, ConflictError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} User service methods
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
   * List users with optional filters and pagination.
   *
   * @param {Object} [filters={}]
   * @param {number|string} [filters.org_id] - Filter by organization
   * @param {string} [filters.search] - Search by name or email
   * @param {number|string} [filters.page=1]
   * @param {number|string} [filters.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await users.list({ search: 'john', page: 1 });
   */
  const list = async (filters = {}) => {
    const { org_id, search } = filters;
    const { page, limit, offset } = paginate(filters.page, filters.limit);

    let sql = `
      SELECT u.*, ue.address as email, o.name as org_name
      FROM ${conn.table('user')} u
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      LEFT JOIN ${conn.table('organization')} o ON u.org_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (org_id) { sql += ` AND u.org_id = ?`; params.push(org_id); }
    if (search) {
      sql += ` AND (u.name LIKE ? OR ue.address LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term);
    }

    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
    const countResult = await conn.queryOne(countSql, params);
    const total = parseInt(countResult?.count || 0, 10);

    sql += ` ORDER BY u.created DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = await conn.query(sql, params);

    return {
      data: users.map((u) => ({
        id: u.id,
        org_id: u.org_id,
        name: u.name,
        email: u.email,
        organization: u.org_name ? { id: u.org_id, name: u.org_name } : null,
        status: u.status,
        created: u.created,
        updated: u.updated,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get user details by ID.
   *
   * @param {number|string} id - User ID
   * @returns {Promise<Object>} User detail with emails, org, ticket count
   * @throws {NotFoundError} If the user does not exist
   *
   * @example
   * const user = await users.get(5);
   */
  const get = async (id) => {
    const user = await conn.queryOne(`
      SELECT u.*, o.id as org_id, o.name as org_name, o.domain as org_domain
      FROM ${conn.table('user')} u
      LEFT JOIN ${conn.table('organization')} o ON u.org_id = o.id
      WHERE u.id = ?
    `, [id]);

    if (!user) throw new NotFoundError('User not found');

    const emails = await conn.query(
      `SELECT id, address, flags FROM ${conn.table('user_email')} WHERE user_id = ?`, [id]
    );

    const ticketCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE user_id = ?`, [id]) || 0,
      10,
    );

    return {
      id: user.id,
      name: user.name,
      status: user.status,
      organization: user.org_id ? {
        id: user.org_id,
        name: user.org_name,
        domain: user.org_domain,
      } : null,
      emails: emails.map((e) => ({
        id: e.id,
        address: e.address,
        flags: e.flags,
        isDefault: e.id === user.default_email_id,
      })),
      ticketCount,
      created: user.created,
      updated: user.updated,
    };
  };

  /**
   * Get paginated tickets for a user.
   *
   * @param {number|string} userId - User ID
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   *
   * @example
   * const result = await users.getTickets(5, { page: 1, limit: 10 });
   */
  const getTickets = async (userId, options = {}) => {
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
      WHERE t.user_id = ?
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE user_id = ?`, [userId]) || 0,
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
   * Get the organization(s) for a user.
   *
   * @param {number|string} userId - User ID
   * @returns {Promise<Array<Object>>} Array of organization records (0 or 1)
   *
   * @example
   * const orgs = await users.getOrganizations(5);
   */
  const getOrganizations = async (userId) => {
    const user = await conn.queryOne(
      `SELECT org_id FROM ${conn.table('user')} WHERE id = ?`, [userId]
    );

    if (!user || !user.org_id) return [];

    const org = await conn.queryOne(
      `SELECT * FROM ${conn.table('organization')} WHERE id = ?`, [user.org_id]
    );

    return org ? [{
      id: org.id,
      name: org.name,
      domain: org.domain,
      status: org.status,
    }] : [];
  };

  /**
   * Create a new user with email and optional account credentials.
   *
   * @param {Object} params
   * @param {string} params.name - User display name
   * @param {string} params.email - Primary email address
   * @param {number|string} [params.org_id=0] - Organization ID
   * @param {string} [params.username] - Account username (creates user_account if provided with password)
   * @param {string} [params.password] - Account password (min 8 chars)
   * @returns {Promise<Object>} Created user summary
   * @throws {ValidationError} If required fields are missing or password too short
   * @throws {ConflictError} If email already exists
   *
   * @example
   * const user = await users.create({ name: 'John', email: 'john@example.com' });
   */
  const create = async ({ name, email, org_id, username, password }) => {
    if (!name || name.length < 1) throw new ValidationError('Name is required');
    if (!email) throw new ValidationError('Email is required');

    // Check email uniqueness
    const existingEmail = await conn.queryOne(
      `SELECT id FROM ${conn.table('user_email')} WHERE address = ?`, [email]
    );
    if (existingEmail) throw new ConflictError('A user with this email already exists');

    const now = new Date();
    let result;

    await conn.transaction(async (txQuery) => {
      const userResult = await txQuery(`
        INSERT INTO ${conn.table('user')} (org_id, default_email_id, name, status, created, updated)
        VALUES (?, 0, ?, 0, ?, ?)
      `, [org_id || 0, name.trim(), now, now]);

      const userId = userResult.insertId;

      const emailResult = await txQuery(`
        INSERT INTO ${conn.table('user_email')} (user_id, address, flags) VALUES (?, ?, 0)
      `, [userId, email.trim()]);

      await txQuery(`
        UPDATE ${conn.table('user')} SET default_email_id = ? WHERE id = ?
      `, [emailResult.insertId, userId]);

      if (username && password) {
        if (password.length < 8) {
          throw new ValidationError('Password must be at least 8 characters');
        }
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        await txQuery(`
          INSERT INTO ${conn.table('user_account')} (user_id, username, passwd, status)
          VALUES (?, ?, ?, 1)
        `, [userId, username, hashedPassword]);
      }

      result = {
        id: userId,
        name: name.trim(),
        email: email.trim(),
        org_id: org_id || 0,
        created: now,
      };
    });

    return result;
  };

  /**
   * Update user fields.
   *
   * @param {number|string} id - User ID
   * @param {Object} changes
   * @param {string} [changes.name] - Display name
   * @param {number|string} [changes.org_id] - Organization ID
   * @param {number} [changes.status] - User status
   * @returns {Promise<void>}
   * @throws {NotFoundError} If the user does not exist
   * @throws {ValidationError} If no fields are provided
   *
   * @example
   * await users.update(5, { name: 'Jane Doe' });
   */
  const update = async (id, { name, org_id, status } = {}) => {
    const user = await conn.queryOne(
      `SELECT id FROM ${conn.table('user')} WHERE id = ?`, [id]
    );
    if (!user) throw new NotFoundError('User not found');

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (org_id !== undefined) { updates.push('org_id = ?'); params.push(org_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length === 0) throw new ValidationError('No fields to update');

    updates.push('updated = ?');
    params.push(new Date());
    params.push(id);

    await conn.query(
      `UPDATE ${conn.table('user')} SET ${updates.join(', ')} WHERE id = ?`, params
    );
  };

  /**
   * Delete a user and associated email/account records.
   *
   * @param {number|string} id - User ID
   * @returns {Promise<void>}
   * @throws {NotFoundError} If the user does not exist
   * @throws {ConflictError} If the user has associated tickets
   *
   * @example
   * await users.remove(5);
   */
  const remove = async (id) => {
    const user = await conn.queryOne(
      `SELECT id FROM ${conn.table('user')} WHERE id = ?`, [id]
    );
    if (!user) throw new NotFoundError('User not found');

    const ticketCount = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE user_id = ?`, [id]) || 0,
      10,
    );
    if (ticketCount > 0) {
      throw new ConflictError('Cannot delete user: tickets are associated with this user');
    }

    await conn.transaction(async (txQuery) => {
      await txQuery(`DELETE FROM ${conn.table('user_account')} WHERE user_id = ?`, [id]);
      await txQuery(`DELETE FROM ${conn.table('user_email')} WHERE user_id = ?`, [id]);
      await txQuery(`DELETE FROM ${conn.table('user')} WHERE id = ?`, [id]);
    });
  };

  /**
   * Bulk-fetch contact info (phone, address) from osTicket dynamic form entries
   * for the given user IDs. Returns a Map keyed by user id.
   *
   * osTicket stores user form data in form_entry (object_type='U', object_id=user.id)
   * and form_entry_values keyed by form_field.
   *
   * @param {Array<number|string>} userIds
   * @returns {Promise<Map<number, { phone: string, address: string }>>}
   */
  const getContactInfoBulk = async (userIds) => {
    const out = new Map();
    if (!userIds || userIds.length === 0) return out;

    const placeholders = userIds.map(() => '?').join(',');
    const rows = await conn.query(
      `
      SELECT fe.object_id AS user_id, ff.name AS field_name, fev.value
      FROM ${conn.table('form_entry')} fe
      JOIN ${conn.table('form_entry_values')} fev ON fev.entry_id = fe.id
      JOIN ${conn.table('form_field')} ff ON fev.field_id = ff.id
      WHERE fe.object_type = 'U'
        AND fe.object_id IN (${placeholders})
        AND ff.name IN ('phone', 'address')
      `,
      userIds,
    );

    for (const id of userIds) out.set(Number(id), { phone: '', address: '' });
    for (const r of rows) {
      const entry = out.get(Number(r.user_id)) || { phone: '', address: '' };
      if (r.field_name === 'phone') entry.phone = r.value || '';
      else if (r.field_name === 'address') entry.address = r.value || '';
      out.set(Number(r.user_id), entry);
    }
    return out;
  };

  /**
   * List all dynamic form fields used by user form entries.
   *
   * Discovery is schema-agnostic: we find every distinct form_id that
   * has at least one form_entry with object_type='U', then return all
   * fields belonging to those forms. This works regardless of whether
   * the install uses form.type='U', a custom form, or multiple forms.
   *
   * As a fallback (e.g. brand-new DB with no user entries yet), we
   * also include forms with type='U' if the discovery query is empty.
   *
   * @returns {Promise<Array<{ id: number, name: string, label: string, type: string, form_id: number, sort: number }>>}
   */
  const listUserFormFields = async () => {
    // Step 1: discover form_ids actually attached to users
    const formIdRows = await conn.query(`
      SELECT DISTINCT form_id
      FROM ${conn.table('form_entry')}
      WHERE object_type = 'U'
    `);
    let formIds = formIdRows.map((r) => r.form_id).filter((id) => id != null);

    // Step 2: fallback to type='U' if nothing found
    if (formIds.length === 0) {
      const typeRows = await conn.query(
        `SELECT id FROM ${conn.table('form')} WHERE type = 'U'`,
      );
      formIds = typeRows.map((r) => r.id);
    }

    if (formIds.length === 0) return [];

    const placeholders = formIds.map(() => '?').join(',');
    const rows = await conn.query(
      `
      SELECT id, form_id, name, label, type, sort
      FROM ${conn.table('form_field')}
      WHERE form_id IN (${placeholders})
      ORDER BY form_id, sort, id
      `,
      formIds,
    );

    return rows.map((r) => ({
      id: r.id,
      form_id: r.form_id,
      name: r.name || '',
      label: r.label || '',
      type: r.type || '',
      sort: r.sort,
    }));
  };

  /**
   * Bulk-fetch values for the given dynamic form field NAMES across the given user IDs.
   * Returns Map<userId, Map<fieldName, value>>.
   *
   * @param {Array<number|string>} userIds
   * @param {Array<string>} fieldNames - form_field.name values (machine names)
   * @returns {Promise<Map<number, Map<string, string>>>}
   */
  const getFormValuesBulk = async (userIds, fieldNames) => {
    const out = new Map();
    if (!userIds || userIds.length === 0) return out;
    if (!fieldNames || fieldNames.length === 0) {
      for (const id of userIds) out.set(Number(id), new Map());
      return out;
    }

    const userPlaceholders = userIds.map(() => '?').join(',');
    const fieldPlaceholders = fieldNames.map(() => '?').join(',');

    const rows = await conn.query(
      `
      SELECT fe.object_id AS user_id, ff.name AS field_name, fev.value
      FROM ${conn.table('form_entry')} fe
      JOIN ${conn.table('form_entry_values')} fev ON fev.entry_id = fe.id
      JOIN ${conn.table('form_field')} ff ON fev.field_id = ff.id
      WHERE fe.object_type = 'U'
        AND fe.object_id IN (${userPlaceholders})
        AND ff.name IN (${fieldPlaceholders})
      `,
      [...userIds, ...fieldNames],
    );

    for (const id of userIds) out.set(Number(id), new Map());
    for (const r of rows) {
      const m = out.get(Number(r.user_id));
      if (m) m.set(r.field_name, r.value || '');
    }
    return out;
  };

  return {
    list,
    get,
    getTickets,
    getOrganizations,
    getContactInfoBulk,
    listUserFormFields,
    getFormValuesBulk,
    create,
    update,
    remove,
  };
};
