/**
 * MCP Staff Tools
 *
 * Delegates to SDK staff service for all business logic.
 */

const { z } = require('zod');
const { getSdk } = require('../../lib/sdk');

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
        const sdk = getSdk();
        const result = await sdk.staff.list({
          dept_id: params.dept_id,
          isactive: params.isactive,
          page: params.page,
          limit: params.limit,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            staff: result.data.map(s => ({
              staff_id: s.staff_id, username: s.username,
              name: s.name,
              email: s.email, dept_name: s.department?.name, role_name: s.role?.name,
              isactive: s.isactive, isadmin: s.isadmin
            })),
            pagination: result.pagination
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
        const sdk = getSdk();
        const result = await sdk.staff.create({
          username: params.username,
          firstname: params.firstname,
          lastname: params.lastname,
          email: params.email,
          password: params.password,
          dept_id: params.dept_id,
          role_id: params.role_id,
          isadmin: params.isadmin,
          isactive: params.isactive,
        });

        return { content: [{ type: 'text', text: JSON.stringify({
          staff_id: result.staff_id, username: result.username, created: result.created
        }, null, 2) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') {
          return { content: [{ type: 'text', text: 'Username already exists' }], isError: true };
        }
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
        const sdk = getSdk();
        const changes = {};
        if (params.firstname !== undefined) changes.firstname = params.firstname;
        if (params.lastname !== undefined) changes.lastname = params.lastname;
        if (params.email !== undefined) changes.email = params.email;
        if (params.dept_id !== undefined) changes.dept_id = params.dept_id;
        if (params.role_id !== undefined) changes.role_id = params.role_id;
        if (params.isadmin !== undefined) changes.isadmin = params.isadmin;
        if (params.isactive !== undefined) changes.isactive = params.isactive;
        if (params.password !== undefined) changes.password = params.password;

        if (Object.keys(changes).length === 0) {
          return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };
        }

        await sdk.staff.update(params.staff_id, changes);
        return { content: [{ type: 'text', text: JSON.stringify({ staff_id: params.staff_id, updated: true }) }] };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Staff member not found' }], isError: true };
        }
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
        const sdk = getSdk();
        await sdk.staff.remove(params.staff_id);
        return { content: [{ type: 'text', text: JSON.stringify({ staff_id: params.staff_id, deleted: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') {
          // Preserve the specific conflict message from the service
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Staff member not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerStaffTools };
