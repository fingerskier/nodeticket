/**
 * MCP Staff Tools
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

const registerStaffTools = (server, userAuth) => {

  server.tool(
    'list_staff',
    'List staff members with optional filters. Requires staff access.',
    {
      dept_id: z.number().optional().describe('Filter by department ID'),
      isactive: z.boolean().optional().describe('Filter by active status'),
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
          SELECT s.*, d.name as dept_name, r.name as role_name
          FROM ${db.table('staff')} s
          LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
          LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
          WHERE 1=1
        `;
        const sqlParams = [];

        if (params.dept_id) { sql += ` AND s.dept_id = ?`; sqlParams.push(params.dept_id); }
        if (params.isactive !== undefined) { sql += ` AND s.isactive = ?`; sqlParams.push(params.isactive ? 1 : 0); }

        const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
        const countResult = await db.queryOne(countSql, sqlParams);
        const total = parseInt(countResult?.count || 0, 10);

        sql += ` ORDER BY s.lastname, s.firstname LIMIT ? OFFSET ?`;
        sqlParams.push(limit, offset);

        const staff = await db.query(sql, sqlParams);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            staff: staff.map(s => ({
              staff_id: s.staff_id, username: s.username,
              name: `${s.firstname || ''} ${s.lastname || ''}`.trim(),
              email: s.email, dept_name: s.dept_name, role_name: s.role_name,
              isactive: !!s.isactive, isadmin: !!s.isadmin
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
          }, null, 2) }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_staff',
    'Create a new staff member. Requires admin access.',
    {
      username: z.string().describe('Username (3-32 chars)'),
      firstname: z.string().describe('First name'),
      lastname: z.string().describe('Last name'),
      email: z.string().describe('Email'),
      password: z.string().describe('Password (min 8 chars)'),
      dept_id: z.number().describe('Primary department ID'),
      role_id: z.number().describe('Role ID'),
      isadmin: z.boolean().optional().default(false),
      isactive: z.boolean().optional().default(true)
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const existing = await db.queryOne(`SELECT staff_id FROM ${db.table('staff')} WHERE username = ?`, [params.username]);
        if (existing) return { content: [{ type: 'text', text: 'Username already exists' }], isError: true };
        if (params.password.length < 8) return { content: [{ type: 'text', text: 'Password must be at least 8 characters' }], isError: true };

        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash(params.password, 10);
        const now = new Date();

        const result = await db.query(`
          INSERT INTO ${db.table('staff')} (username, firstname, lastname, email, passwd, dept_id, role_id, isadmin, isactive, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [params.username, params.firstname, params.lastname, params.email, hash, params.dept_id, params.role_id, params.isadmin ? 1 : 0, params.isactive ? 1 : 0, now, now]);

        return { content: [{ type: 'text', text: JSON.stringify({ staff_id: result.insertId, username: params.username, created: now }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_staff',
    'Update a staff member. Requires admin access.',
    {
      staff_id: z.number().describe('Staff ID'),
      firstname: z.string().optional(),
      lastname: z.string().optional(),
      email: z.string().optional(),
      dept_id: z.number().optional(),
      role_id: z.number().optional(),
      isadmin: z.boolean().optional(),
      isactive: z.boolean().optional(),
      password: z.string().optional().describe('New password (min 8 chars)')
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const staff = await db.queryOne(`SELECT staff_id FROM ${db.table('staff')} WHERE staff_id = ?`, [params.staff_id]);
        if (!staff) return { content: [{ type: 'text', text: 'Staff member not found' }], isError: true };

        const updates = [];
        const sqlParams = [];

        if (params.firstname !== undefined) { updates.push('firstname = ?'); sqlParams.push(params.firstname); }
        if (params.lastname !== undefined) { updates.push('lastname = ?'); sqlParams.push(params.lastname); }
        if (params.email !== undefined) { updates.push('email = ?'); sqlParams.push(params.email); }
        if (params.dept_id !== undefined) { updates.push('dept_id = ?'); sqlParams.push(params.dept_id); }
        if (params.role_id !== undefined) { updates.push('role_id = ?'); sqlParams.push(params.role_id); }
        if (params.isadmin !== undefined) { updates.push('isadmin = ?'); sqlParams.push(params.isadmin ? 1 : 0); }
        if (params.isactive !== undefined) { updates.push('isactive = ?'); sqlParams.push(params.isactive ? 1 : 0); }
        if (params.password !== undefined) {
          if (params.password.length < 8) return { content: [{ type: 'text', text: 'Password must be at least 8 characters' }], isError: true };
          const bcrypt = require('bcryptjs');
          const hash = await bcrypt.hash(params.password, 10);
          updates.push('passwd = ?'); sqlParams.push(hash);
        }

        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };

        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.staff_id);
        await db.query(`UPDATE ${db.table('staff')} SET ${updates.join(', ')} WHERE staff_id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ staff_id: params.staff_id, updated: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_staff',
    'Delete a staff member. Checks for ticket/department/team references. Requires admin access.',
    {
      staff_id: z.number().describe('Staff ID to delete')
    },
    async (params) => {
      const adminCheck = requireAdmin(userAuth); if (adminCheck) return adminCheck;
      try {
        const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE staff_id = ?`, [params.staff_id]);
        if (parseInt(ticketCount || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: staff has assigned tickets' }], isError: true };

        const deptMgr = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('department')} WHERE manager_id = ?`, [params.staff_id]);
        if (parseInt(deptMgr || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: staff is a department manager' }], isError: true };

        const teamLead = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('team')} WHERE lead_id = ?`, [params.staff_id]);
        if (parseInt(teamLead || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: staff is a team lead' }], isError: true };

        await db.transaction(async (txQuery) => {
          await txQuery(`DELETE FROM ${db.table('staff_dept_access')} WHERE staff_id = ?`, [params.staff_id]);
          await txQuery(`DELETE FROM ${db.table('team_member')} WHERE staff_id = ?`, [params.staff_id]);
          await txQuery(`DELETE FROM ${db.table('staff')} WHERE staff_id = ?`, [params.staff_id]);
        });
        return { content: [{ type: 'text', text: JSON.stringify({ staff_id: params.staff_id, deleted: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerStaffTools };
