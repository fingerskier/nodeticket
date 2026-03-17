/**
 * MCP Admin Tools - CRUD for orgs, depts, teams, roles + team member management
 */

const { z } = require('zod');
const db = require('../../lib/db');

const registerAdminTools = (server, userAuth) => {

  const requireAdmin = () => {
    if (userAuth?.type === 'apikey') return null;
    if (userAuth?.type !== 'staff' || !userAuth?.isAdmin) {
      return { content: [{ type: 'text', text: 'Admin access required' }], isError: true };
    }
    return null;
  };

  // ── Roles ──

  server.tool(
    'list_roles',
    'List all roles with permissions.',
    {},
    async () => {
      const check = requireAdmin(); if (check) return check;
      try {
        const roles = await db.query(`SELECT * FROM ${db.table('role')} ORDER BY name`);
        return { content: [{ type: 'text', text: JSON.stringify(roles.map(r => ({
          id: r.id, name: r.name, permissions: r.permissions ? JSON.parse(r.permissions) : {}, flags: r.flags
        })), null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'create_role',
    'Create a new role.',
    { name: z.string().describe('Role name (1-64 chars)'), permissions: z.record(z.any()).optional(), flags: z.number().optional(), notes: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT id FROM ${db.table('role')} WHERE name = ?`, [params.name]);
        if (existing) return { content: [{ type: 'text', text: 'Role name already exists' }], isError: true };
        const now = new Date();
        const result = await db.query(`INSERT INTO ${db.table('role')} (name, permissions, flags, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?)`,
          [params.name, params.permissions ? JSON.stringify(params.permissions) : null, params.flags || 0, params.notes || null, now, now]);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.insertId, name: params.name, created: now }, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_role',
    'Update a role.',
    { role_id: z.number(), name: z.string().optional(), permissions: z.record(z.any()).optional(), flags: z.number().optional(), notes: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const role = await db.queryOne(`SELECT id FROM ${db.table('role')} WHERE id = ?`, [params.role_id]);
        if (!role) return { content: [{ type: 'text', text: 'Role not found' }], isError: true };
        const updates = []; const sqlParams = [];
        if (params.name !== undefined) { updates.push('name = ?'); sqlParams.push(params.name); }
        if (params.permissions !== undefined) { updates.push('permissions = ?'); sqlParams.push(JSON.stringify(params.permissions)); }
        if (params.flags !== undefined) { updates.push('flags = ?'); sqlParams.push(params.flags); }
        if (params.notes !== undefined) { updates.push('notes = ?'); sqlParams.push(params.notes); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.role_id);
        await db.query(`UPDATE ${db.table('role')} SET ${updates.join(', ')} WHERE id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ role_id: params.role_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_role',
    'Delete a role. Checks for staff references.',
    { role_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const staffCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('staff')} WHERE role_id = ?`, [params.role_id]);
        if (parseInt(staffCount || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: role has staff' }], isError: true };
        await db.query(`DELETE FROM ${db.table('role')} WHERE id = ?`, [params.role_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ role_id: params.role_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Organizations ──

  server.tool(
    'create_organization',
    'Create an organization.',
    { name: z.string(), domain: z.string().optional(), status: z.number().optional(), manager: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT id FROM ${db.table('organization')} WHERE name = ?`, [params.name]);
        if (existing) return { content: [{ type: 'text', text: 'Organization name exists' }], isError: true };
        const now = new Date();
        const result = await db.query(`INSERT INTO ${db.table('organization')} (name, domain, status, manager, created, updated) VALUES (?, ?, ?, ?, ?, ?)`,
          [params.name, params.domain || null, params.status || 0, params.manager || null, now, now]);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.insertId, name: params.name }, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_organization',
    'Update an organization.',
    { org_id: z.number(), name: z.string().optional(), domain: z.string().optional(), status: z.number().optional(), manager: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const org = await db.queryOne(`SELECT id FROM ${db.table('organization')} WHERE id = ?`, [params.org_id]);
        if (!org) return { content: [{ type: 'text', text: 'Organization not found' }], isError: true };
        const updates = []; const sqlParams = [];
        if (params.name !== undefined) { updates.push('name = ?'); sqlParams.push(params.name); }
        if (params.domain !== undefined) { updates.push('domain = ?'); sqlParams.push(params.domain); }
        if (params.status !== undefined) { updates.push('status = ?'); sqlParams.push(params.status); }
        if (params.manager !== undefined) { updates.push('manager = ?'); sqlParams.push(params.manager); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.org_id);
        await db.query(`UPDATE ${db.table('organization')} SET ${updates.join(', ')} WHERE id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ org_id: params.org_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_organization',
    'Delete an organization. Refuses if users are assigned.',
    { org_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const userCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = ?`, [params.org_id]);
        if (parseInt(userCount || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: org has users' }], isError: true };
        await db.query(`DELETE FROM ${db.table('organization')} WHERE id = ?`, [params.org_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ org_id: params.org_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Departments ──

  server.tool(
    'create_department',
    'Create a department.',
    { name: z.string(), pid: z.number().optional(), manager_id: z.number().optional(), sla_id: z.number().optional(), ispublic: z.boolean().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        let path = `/${params.name}`;
        if (params.pid) {
          const parent = await db.queryOne(`SELECT path FROM ${db.table('department')} WHERE id = ?`, [params.pid]);
          if (parent) path = `${parent.path}/${params.name}`;
        }
        const now = new Date();
        const result = await db.query(`INSERT INTO ${db.table('department')} (pid, name, path, manager_id, sla_id, ispublic, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [params.pid || 0, params.name, path, params.manager_id || 0, params.sla_id || 0, params.ispublic !== false ? 1 : 0, now, now]);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.insertId, name: params.name, path }, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_department',
    'Update a department.',
    { dept_id: z.number(), name: z.string().optional(), pid: z.number().optional(), manager_id: z.number().optional(), sla_id: z.number().optional(), ispublic: z.boolean().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const dept = await db.queryOne(`SELECT id FROM ${db.table('department')} WHERE id = ?`, [params.dept_id]);
        if (!dept) return { content: [{ type: 'text', text: 'Department not found' }], isError: true };
        const updates = []; const sqlParams = [];
        if (params.name !== undefined) { updates.push('name = ?'); sqlParams.push(params.name); }
        if (params.pid !== undefined) { updates.push('pid = ?'); sqlParams.push(params.pid); }
        if (params.manager_id !== undefined) { updates.push('manager_id = ?'); sqlParams.push(params.manager_id); }
        if (params.sla_id !== undefined) { updates.push('sla_id = ?'); sqlParams.push(params.sla_id); }
        if (params.ispublic !== undefined) { updates.push('ispublic = ?'); sqlParams.push(params.ispublic ? 1 : 0); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.dept_id);
        await db.query(`UPDATE ${db.table('department')} SET ${updates.join(', ')} WHERE id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ dept_id: params.dept_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_department',
    'Delete a department. Checks for children, staff, and tickets.',
    { dept_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const children = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('department')} WHERE pid = ?`, [params.dept_id]);
        if (parseInt(children || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: has child departments' }], isError: true };
        const staff = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = ?`, [params.dept_id]);
        if (parseInt(staff || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: has staff' }], isError: true };
        const tickets = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE dept_id = ?`, [params.dept_id]);
        if (parseInt(tickets || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: has tickets' }], isError: true };
        await db.query(`DELETE FROM ${db.table('department')} WHERE id = ?`, [params.dept_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ dept_id: params.dept_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Teams ──

  server.tool(
    'create_team',
    'Create a team.',
    { name: z.string(), lead_id: z.number().optional(), notes: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const now = new Date();
        const result = await db.query(`INSERT INTO ${db.table('team')} (name, lead_id, flags, notes, created, updated) VALUES (?, ?, 0, ?, ?, ?)`,
          [params.name, params.lead_id || 0, params.notes || null, now, now]);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: result.insertId, name: params.name }, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_team',
    'Update a team.',
    { team_id: z.number(), name: z.string().optional(), lead_id: z.number().optional(), notes: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const team = await db.queryOne(`SELECT team_id FROM ${db.table('team')} WHERE team_id = ?`, [params.team_id]);
        if (!team) return { content: [{ type: 'text', text: 'Team not found' }], isError: true };
        const updates = []; const sqlParams = [];
        if (params.name !== undefined) { updates.push('name = ?'); sqlParams.push(params.name); }
        if (params.lead_id !== undefined) { updates.push('lead_id = ?'); sqlParams.push(params.lead_id); }
        if (params.notes !== undefined) { updates.push('notes = ?'); sqlParams.push(params.notes); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.push('updated = ?'); sqlParams.push(new Date()); sqlParams.push(params.team_id);
        await db.query(`UPDATE ${db.table('team')} SET ${updates.join(', ')} WHERE team_id = ?`, sqlParams);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_team',
    'Delete a team. Refuses if tickets are assigned.',
    { team_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const tickets = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE team_id = ?`, [params.team_id]);
        if (parseInt(tickets || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete: has tickets' }], isError: true };
        await db.transaction(async (txQuery) => {
          await txQuery(`DELETE FROM ${db.table('team_member')} WHERE team_id = ?`, [params.team_id]);
          await txQuery(`DELETE FROM ${db.table('team')} WHERE team_id = ?`, [params.team_id]);
        });
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Team Members ──

  server.tool(
    'add_team_member',
    'Add a staff member to a team.',
    { team_id: z.number(), staff_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT staff_id FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?`, [params.team_id, params.staff_id]);
        if (existing) return { content: [{ type: 'text', text: 'Already a member' }], isError: true };
        await db.query(`INSERT INTO ${db.table('team_member')} (team_id, staff_id, flags) VALUES (?, ?, 0)`, [params.team_id, params.staff_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, staff_id: params.staff_id, added: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'remove_team_member',
    'Remove a staff member from a team.',
    { team_id: z.number(), staff_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        await db.query(`DELETE FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?`, [params.team_id, params.staff_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, staff_id: params.staff_id, removed: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );
};

module.exports = { registerAdminTools };
