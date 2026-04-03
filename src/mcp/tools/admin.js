/**
 * MCP Admin Tools - CRUD for orgs, depts, teams, roles + team member management
 *
 * Delegates to SDK services for organizations, departments, teams.
 * Uses SDK data layer directly for roles (no service layer exists).
 */

const { z } = require('zod');
const { getSdk } = require('../../lib/sdk');

const registerAdminTools = (server, userAuth) => {

  const requireAdmin = () => {
    if (userAuth?.type === 'apikey') return null;
    if (userAuth?.type !== 'staff' || !userAuth?.isAdmin) {
      return { content: [{ type: 'text', text: 'Admin access required' }], isError: true };
    }
    return null;
  };

  // ── Roles (via data layer — no service exists) ──

  server.tool(
    'list_roles',
    'List all roles with permissions.',
    {},
    async () => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const roles = await sdk.data.roles.find({ orderBy: 'name ASC' });
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
        const sdk = getSdk();
        const existing = await sdk.data.roles.find({ where: { name: params.name } });
        if (existing.length > 0) return { content: [{ type: 'text', text: 'Role name already exists' }], isError: true };
        const now = new Date();
        const result = await sdk.data.roles.create({
          name: params.name,
          permissions: params.permissions ? JSON.stringify(params.permissions) : null,
          flags: params.flags || 0,
          notes: params.notes || null,
          created: now,
          updated: now,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: params.name, created: now }, null, 2) }] };
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
        const sdk = getSdk();
        const role = await sdk.data.roles.findById(params.role_id);
        if (!role) return { content: [{ type: 'text', text: 'Role not found' }], isError: true };
        const updates = {};
        if (params.name !== undefined) updates.name = params.name;
        if (params.permissions !== undefined) updates.permissions = JSON.stringify(params.permissions);
        if (params.flags !== undefined) updates.flags = params.flags;
        if (params.notes !== undefined) updates.notes = params.notes;
        if (Object.keys(updates).length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.updated = new Date();
        await sdk.data.roles.update(params.role_id, updates);
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
        const sdk = getSdk();
        const staffCount = await sdk.data.staff.count({ role_id: params.role_id });
        if (staffCount > 0) return { content: [{ type: 'text', text: 'Cannot delete: role has staff' }], isError: true };
        await sdk.data.roles.remove(params.role_id);
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
        const sdk = getSdk();
        const result = await sdk.organizations.create({
          name: params.name,
          domain: params.domain,
          status: params.status,
          manager: params.manager,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.name }, null, 2) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') return { content: [{ type: 'text', text: 'Organization name exists' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_organization',
    'Update an organization.',
    { org_id: z.number(), name: z.string().optional(), domain: z.string().optional(), status: z.number().optional(), manager: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const changes = {};
        if (params.name !== undefined) changes.name = params.name;
        if (params.domain !== undefined) changes.domain = params.domain;
        if (params.status !== undefined) changes.status = params.status;
        if (params.manager !== undefined) changes.manager = params.manager;
        if (Object.keys(changes).length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        await sdk.organizations.update(params.org_id, changes);
        return { content: [{ type: 'text', text: JSON.stringify({ org_id: params.org_id, updated: true }) }] };
      } catch (err) {
        if (err.code === 'NOT_FOUND') return { content: [{ type: 'text', text: 'Organization not found' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_organization',
    'Delete an organization. Refuses if users are assigned.',
    { org_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        await sdk.organizations.remove(params.org_id);
        return { content: [{ type: 'text', text: JSON.stringify({ org_id: params.org_id, deleted: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') return { content: [{ type: 'text', text: 'Cannot delete: org has users' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
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
        const sdk = getSdk();
        const result = await sdk.departments.create({
          name: params.name,
          pid: params.pid,
          manager_id: params.manager_id,
          sla_id: params.sla_id,
          ispublic: params.ispublic,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.name, path: result.path }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_department',
    'Update a department.',
    { dept_id: z.number(), name: z.string().optional(), pid: z.number().optional(), manager_id: z.number().optional(), sla_id: z.number().optional(), ispublic: z.boolean().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const changes = {};
        if (params.name !== undefined) changes.name = params.name;
        if (params.pid !== undefined) changes.pid = params.pid;
        if (params.manager_id !== undefined) changes.manager_id = params.manager_id;
        if (params.sla_id !== undefined) changes.sla_id = params.sla_id;
        if (params.ispublic !== undefined) changes.ispublic = params.ispublic;
        if (Object.keys(changes).length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        await sdk.departments.update(params.dept_id, changes);
        return { content: [{ type: 'text', text: JSON.stringify({ dept_id: params.dept_id, updated: true }) }] };
      } catch (err) {
        if (err.code === 'NOT_FOUND') return { content: [{ type: 'text', text: 'Department not found' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_department',
    'Delete a department. Checks for children, staff, and tickets.',
    { dept_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        await sdk.departments.remove(params.dept_id);
        return { content: [{ type: 'text', text: JSON.stringify({ dept_id: params.dept_id, deleted: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') return { content: [{ type: 'text', text: err.message }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
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
        const sdk = getSdk();
        const result = await sdk.teams.create({
          name: params.name,
          lead_id: params.lead_id,
          notes: params.notes,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: result.team_id, name: result.name }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_team',
    'Update a team.',
    { team_id: z.number(), name: z.string().optional(), lead_id: z.number().optional(), notes: z.string().optional() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const changes = {};
        if (params.name !== undefined) changes.name = params.name;
        if (params.lead_id !== undefined) changes.lead_id = params.lead_id;
        if (params.notes !== undefined) changes.notes = params.notes;
        if (Object.keys(changes).length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        await sdk.teams.update(params.team_id, changes);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, updated: true }) }] };
      } catch (err) {
        if (err.code === 'NOT_FOUND') return { content: [{ type: 'text', text: 'Team not found' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_team',
    'Delete a team. Refuses if tickets are assigned.',
    { team_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        await sdk.teams.remove(params.team_id);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, deleted: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') return { content: [{ type: 'text', text: err.message }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
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
        const sdk = getSdk();
        await sdk.teams.addMember(params.team_id, params.staff_id);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, staff_id: params.staff_id, added: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') return { content: [{ type: 'text', text: 'Already a member' }], isError: true };
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'remove_team_member',
    'Remove a staff member from a team.',
    { team_id: z.number(), staff_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        await sdk.teams.removeMember(params.team_id, params.staff_id);
        return { content: [{ type: 'text', text: JSON.stringify({ team_id: params.team_id, staff_id: params.staff_id, removed: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerAdminTools };
