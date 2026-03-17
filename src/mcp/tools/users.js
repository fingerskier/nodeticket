/**
 * MCP User Tools
 */

const { z } = require('zod');
const db = require('../../lib/db');

const requireStaff = (userAuth) => {
  if (userAuth?.type !== 'staff' && userAuth?.type !== 'apikey') {
    return { content: [{ type: 'text', text: 'Staff access required' }], isError: true };
  }
  return null;
};

const requireAdmin = (userAuth) => {
  if (userAuth?.type === 'apikey') return null;
  if (userAuth?.type !== 'staff' || !userAuth?.isAdmin) {
    return { content: [{ type: 'text', text: 'Admin access required' }], isError: true };
  }
  return null;
};

const registerUserTools = (server, userAuth) => {

  server.tool(
    'list_users',
    'List users with optional filters and pagination. Requires staff access.',
    {
      org_id: z.number().optional().describe('Filter by organization ID'),
      search: z.string().optional().describe('Search by name or email'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(25)
    },
    async (params) => {
      const staffCheck = requireStaff(userAuth); if (staffCheck) return staffCheck;
      try {
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 25));
        const offset = (page - 1) * limit;

        let sql = `
          SELECT u.*, ue.address as email, o.name as org_name
          FROM ${db.table('user')} u
          LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
          LEFT JOIN ${db.table('organization')} o ON u.org_id = o.id
          WHERE 1=1
        `;
        const sqlParams = [];

        if (params.org_id) { sql += ` AND u.org_id = ?`; sqlParams.push(params.org_id); }
        if (params.search) {
          sql += ` AND (u.name LIKE ? OR ue.address LIKE ?)`;
          const term = `%${params.search}%`;
          sqlParams.push(term, term);
        }

        const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
        const countResult = await db.queryOne(countSql, sqlParams);
        const total = parseInt(countResult?.count || 0, 10);

        sql += ` ORDER BY u.created DESC LIMIT ? OFFSET ?`;
        sqlParams.push(limit, offset);

        const users = await db.query(sql, sqlParams);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            users: users.map(u => ({ id: u.id, name: u.name, email: u.email, org_name: u.org_name, status: u.status, created: u.created })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
          }, null, 2) }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_user',
    'Create a new user. Requires admin access.',
    {
      name: z.string().describe('User name'),
      email: z.string().describe('User email'),
      org_id: z.number().optional().describe('Organization ID'),
      username: z.string().optional().describe('Login username'),
      password: z.string().optional().describe('Login password (min 8 chars)')
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const existing = await db.queryOne(`SELECT id FROM ${db.table('user_email')} WHERE address = ?`, [params.email]);
        if (existing) return { content: [{ type: 'text', text: 'Email already exists' }], isError: true };

        const now = new Date();
        let userId;

        await db.transaction(async (txQuery) => {
          const userResult = await txQuery(`
            INSERT INTO ${db.table('user')} (org_id, default_email_id, name, status, created, updated)
            VALUES (?, 0, ?, 0, ?, ?)
          `, [params.org_id || 0, params.name.trim(), now, now]);
          userId = userResult.insertId;

          const emailResult = await txQuery(`
            INSERT INTO ${db.table('user_email')} (user_id, address, flags) VALUES (?, ?, 0)
          `, [userId, params.email.trim()]);

          await txQuery(`UPDATE ${db.table('user')} SET default_email_id = ? WHERE id = ?`, [emailResult.insertId, userId]);

          if (params.username && params.password) {
            if (params.password.length < 8) throw new Error('Password must be at least 8 characters');
            const bcrypt = require('bcryptjs');
            const hash = await bcrypt.hash(params.password, 10);
            await txQuery(`INSERT INTO ${db.table('user_account')} (user_id, username, passwd, status) VALUES (?, ?, ?, 1)`, [userId, params.username, hash]);
          }
        });

        return { content: [{ type: 'text', text: JSON.stringify({ id: userId, name: params.name, email: params.email, created: now }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_user',
    'Update a user. Requires admin access.',
    {
      user_id: z.number().describe('User ID'),
      name: z.string().optional(),
      org_id: z.number().optional(),
      status: z.number().optional()
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const user = await db.queryOne(`SELECT id FROM ${db.table('user')} WHERE id = ?`, [params.user_id]);
        if (!user) return { content: [{ type: 'text', text: 'User not found' }], isError: true };

        const updates = [];
        const sqlParams = [];
        if (params.name !== undefined) { updates.push('name = ?'); sqlParams.push(params.name.trim()); }
        if (params.org_id !== undefined) { updates.push('org_id = ?'); sqlParams.push(params.org_id); }
        if (params.status !== undefined) { updates.push('status = ?'); sqlParams.push(params.status); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };

        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.user_id);
        await db.query(`UPDATE ${db.table('user')} SET ${updates.join(', ')} WHERE id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ user_id: params.user_id, updated: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_user',
    'Delete a user. Refuses if tickets exist. Requires admin access.',
    {
      user_id: z.number().describe('User ID to delete')
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?`, [params.user_id]);
        if (parseInt(ticketCount || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: user has tickets' }], isError: true };

        await db.transaction(async (txQuery) => {
          await txQuery(`DELETE FROM ${db.table('user_account')} WHERE user_id = ?`, [params.user_id]);
          await txQuery(`DELETE FROM ${db.table('user_email')} WHERE user_id = ?`, [params.user_id]);
          await txQuery(`DELETE FROM ${db.table('user')} WHERE id = ?`, [params.user_id]);
        });
        return { content: [{ type: 'text', text: JSON.stringify({ user_id: params.user_id, deleted: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerUserTools };
