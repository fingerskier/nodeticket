/**
 * MCP Admin Tools - CRUD for orgs, depts, teams, roles + team member management
 *
 * Delegates to SDK services for organizations, departments, teams.
 * Uses SDK data layer directly for roles (no service layer exists).
 */

const { z } = require('zod');
const { getSdk } = require('../../lib/sdk');
const db = require('../../lib/db');

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

  // ── Help Topics ──

  server.tool(
    'create_help_topic',
    'Create a help topic.',
    {
      topic: z.string().describe('Topic name (1-128 chars)'),
      topic_pid: z.number().optional().describe('Parent topic id (0 for top-level)'),
      dept_id: z.number().optional(),
      priority_id: z.number().optional(),
      sla_id: z.number().optional(),
      ispublic: z.boolean().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const parentId = params.topic_pid || 0;
        const dup = await db.queryOne(
          `SELECT topic_id FROM ${db.table('help_topic')} WHERE LOWER(topic) = LOWER(?) AND topic_pid = ?`,
          [params.topic.trim(), parentId]
        );
        if (dup) return { content: [{ type: 'text', text: 'A topic with that name already exists in this scope' }], isError: true };

        const now = new Date();
        const result = await db.query(
          `INSERT INTO ${db.table('help_topic')}
           (topic_pid, topic, ispublic, noautoresp, flags, sort, dept_id, priority_id, sla_id, staff_id, team_id, notes, created, updated)
           VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, 0, 0, ?, ?, ?)`,
          [parentId, params.topic.trim(), params.ispublic === false ? 0 : 1, 0,
           params.dept_id || 0, params.priority_id || 0, params.sla_id || 0,
           params.notes || null, now, now]
        );
        const id = result?.insertId || result?.lastInsertId || result?.id;
        return { content: [{ type: 'text', text: JSON.stringify({ topic_id: id, topic: params.topic.trim() }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_help_topic',
    'Update a help topic.',
    {
      topic_id: z.number(),
      topic: z.string().optional(),
      topic_pid: z.number().optional(),
      dept_id: z.number().optional(),
      priority_id: z.number().optional(),
      sla_id: z.number().optional(),
      ispublic: z.boolean().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT * FROM ${db.table('help_topic')} WHERE topic_id = ?`, [params.topic_id]);
        if (!existing) return { content: [{ type: 'text', text: 'Help topic not found' }], isError: true };

        const updates = [];
        const vals = [];
        if (params.topic !== undefined) { updates.push('topic = ?'); vals.push(params.topic.trim()); }
        if (params.topic_pid !== undefined) {
          if (params.topic_pid === params.topic_id) return { content: [{ type: 'text', text: 'Topic cannot be its own parent' }], isError: true };
          updates.push('topic_pid = ?'); vals.push(params.topic_pid || 0);
        }
        if (params.dept_id !== undefined) { updates.push('dept_id = ?'); vals.push(params.dept_id || 0); }
        if (params.priority_id !== undefined) { updates.push('priority_id = ?'); vals.push(params.priority_id || 0); }
        if (params.sla_id !== undefined) { updates.push('sla_id = ?'); vals.push(params.sla_id || 0); }
        if (params.ispublic !== undefined) { updates.push('ispublic = ?'); vals.push(params.ispublic ? 1 : 0); }
        if (params.notes !== undefined) { updates.push('notes = ?'); vals.push(params.notes); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };

        updates.push('updated = ?'); vals.push(new Date()); vals.push(params.topic_id);
        await db.query(`UPDATE ${db.table('help_topic')} SET ${updates.join(', ')} WHERE topic_id = ?`, vals);
        return { content: [{ type: 'text', text: JSON.stringify({ topic_id: params.topic_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_help_topic',
    'Delete a help topic. Fails if topic has children or tickets.',
    { topic_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT topic_id FROM ${db.table('help_topic')} WHERE topic_id = ?`, [params.topic_id]);
        if (!existing) return { content: [{ type: 'text', text: 'Help topic not found' }], isError: true };

        const children = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('help_topic')} WHERE topic_pid = ?`, [params.topic_id]);
        if (parseInt(children?.count || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete — topic has child topics' }], isError: true };

        const tickets = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('ticket')} WHERE topic_id = ?`, [params.topic_id]);
        if (parseInt(tickets?.count || 0, 10) > 0) return { content: [{ type: 'text', text: 'Cannot delete — topic has existing tickets' }], isError: true };

        await db.query(`DELETE FROM ${db.table('help_topic')} WHERE topic_id = ?`, [params.topic_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ topic_id: params.topic_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── SLA Plans ──

  server.tool(
    'create_sla',
    'Create an SLA plan.',
    {
      name: z.string().describe('SLA name (1-64 chars)'),
      grace_period: z.number().optional().describe('Grace period in hours'),
      flags: z.number().optional().describe('Bitmask: 1=active, 2=escalate, 4=noalerts, 8=transient'),
      notes: z.string().optional(),
    },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const dup = await sdk.data.sla.find({ where: { name: params.name.trim() } });
        if (dup.length > 0) return { content: [{ type: 'text', text: 'SLA name already exists' }], isError: true };
        const now = new Date();
        const result = await sdk.data.sla.create({
          name: params.name.trim(),
          grace_period: params.grace_period !== undefined ? params.grace_period : 24,
          flags: params.flags !== undefined ? params.flags : 1,
          schedule_id: 0,
          notes: params.notes || null,
          created: now,
          updated: now,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: params.name.trim() }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_sla',
    'Update an SLA plan.',
    {
      sla_id: z.number(),
      name: z.string().optional(),
      grace_period: z.number().optional(),
      flags: z.number().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const existing = await sdk.data.sla.findById(params.sla_id);
        if (!existing) return { content: [{ type: 'text', text: 'SLA plan not found' }], isError: true };

        const updates = {};
        if (params.name !== undefined) updates.name = params.name.trim();
        if (params.grace_period !== undefined) updates.grace_period = params.grace_period;
        if (params.flags !== undefined) updates.flags = params.flags;
        if (params.notes !== undefined) updates.notes = params.notes;
        if (Object.keys(updates).length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.updated = new Date();

        await sdk.data.sla.update(params.sla_id, updates);
        return { content: [{ type: 'text', text: JSON.stringify({ sla_id: params.sla_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'delete_sla',
    'Delete an SLA plan. Fails if referenced by departments, topics, or tickets.',
    { sla_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const sdk = getSdk();
        const existing = await sdk.data.sla.findById(params.sla_id);
        if (!existing) return { content: [{ type: 'text', text: 'SLA plan not found' }], isError: true };

        const conn = sdk.connection;
        const d = parseInt(await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('department')} WHERE sla_id = ?`, [params.sla_id]) || 0, 10);
        if (d > 0) return { content: [{ type: 'text', text: `Cannot delete — referenced by ${d} department(s)` }], isError: true };

        const t = parseInt(await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('help_topic')} WHERE sla_id = ?`, [params.sla_id]) || 0, 10);
        if (t > 0) return { content: [{ type: 'text', text: `Cannot delete — referenced by ${t} help topic(s)` }], isError: true };

        const k = parseInt(await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE sla_id = ?`, [params.sla_id]) || 0, 10);
        if (k > 0) return { content: [{ type: 'text', text: `Cannot delete — referenced by ${k} ticket(s)` }], isError: true };

        await sdk.data.sla.remove(params.sla_id);
        return { content: [{ type: 'text', text: JSON.stringify({ sla_id: params.sla_id, deleted: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Email Templates ──

  server.tool(
    'list_email_templates',
    'List email templates, optionally filtered by template group ID.',
    { tpl_id: z.number().optional().describe('Filter by template group ID') },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        let sql = `SELECT et.*, etg.name as group_name FROM ${db.table('email_template')} et
                   LEFT JOIN ${db.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id`;
        const args = [];
        if (params.tpl_id) { sql += ` WHERE et.tpl_id = ?`; args.push(params.tpl_id); }
        sql += ` ORDER BY etg.name, et.code_name`;
        const rows = await db.query(sql, args);
        return { content: [{ type: 'text', text: JSON.stringify(rows.map(r => ({
          id: r.id, tpl_id: r.tpl_id, code_name: r.code_name, subject: r.subject, group_name: r.group_name,
        })), null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'get_email_template',
    'Get a single email template with subject, body, and group info.',
    { template_id: z.number() },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const tpl = await db.queryOne(
          `SELECT et.*, etg.name as group_name FROM ${db.table('email_template')} et
           LEFT JOIN ${db.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id
           WHERE et.id = ?`,
          [params.template_id]
        );
        if (!tpl) return { content: [{ type: 'text', text: 'Template not found' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(tpl, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_email_template',
    'Update an email template subject, body, or notes.',
    {
      template_id: z.number(),
      subject: z.string().optional(),
      body: z.string().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        const existing = await db.queryOne(`SELECT id FROM ${db.table('email_template')} WHERE id = ?`, [params.template_id]);
        if (!existing) return { content: [{ type: 'text', text: 'Template not found' }], isError: true };
        const updates = [];
        const vals = [];
        if (params.subject !== undefined) { updates.push('subject = ?'); vals.push(params.subject); }
        if (params.body !== undefined) { updates.push('body = ?'); vals.push(params.body); }
        if (params.notes !== undefined) { updates.push('notes = ?'); vals.push(params.notes); }
        if (updates.length === 0) return { content: [{ type: 'text', text: 'No updates' }], isError: true };
        updates.push('updated = ?'); vals.push(new Date()); vals.push(params.template_id);
        await db.query(`UPDATE ${db.table('email_template')} SET ${updates.join(', ')} WHERE id = ?`, vals);
        return { content: [{ type: 'text', text: JSON.stringify({ template_id: params.template_id, updated: true }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  // ── Settings ──

  server.tool(
    'get_settings',
    'Get all system settings with current values.',
    {},
    async () => {
      const check = requireAdmin(); if (check) return check;
      try {
        const rows = await db.query(`SELECT \`key\`, value FROM ${db.table('config')} ORDER BY \`key\``);
        const settings = {};
        for (const row of rows) settings[row.key] = row.value;
        return { content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );

  server.tool(
    'update_settings',
    'Update system settings. Pass key-value pairs.',
    { settings: z.record(z.string(), z.string()).describe('Object of setting key-value pairs, e.g. {"helpdesk_title": "My Helpdesk"}') },
    async (params) => {
      const check = requireAdmin(); if (check) return check;
      try {
        for (const [key, value] of Object.entries(params.settings)) {
          const existing = await db.queryOne(`SELECT id FROM ${db.table('config')} WHERE \`key\` = ?`, [key]);
          if (existing) {
            await db.query(`UPDATE ${db.table('config')} SET value = ?, updated = ? WHERE \`key\` = ?`, [value, new Date(), key]);
          } else {
            await db.query(`INSERT INTO ${db.table('config')} (\`namespace\`, \`key\`, value, updated) VALUES (?, ?, ?, ?)`, ['core', key, value, new Date()]);
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ updated: Object.keys(params.settings).length }) }] };
      } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
    }
  );
};

module.exports = { registerAdminTools };
