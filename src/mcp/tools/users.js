/**
 * MCP User Tools
 *
 * Delegates to SDK user service for all business logic.
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
        const sdk = getSdk();
        const result = await sdk.users.list({
          org_id: params.org_id,
          search: params.search,
          page: params.page,
          limit: params.limit,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            users: result.data.map(u => ({
              id: u.id, name: u.name, email: u.email,
              org_name: u.organization?.name || null,
              status: u.status, created: u.created
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
        const sdk = getSdk();
        const result = await sdk.users.create({
          name: params.name,
          email: params.email,
          org_id: params.org_id,
          username: params.username,
          password: params.password,
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') {
          return { content: [{ type: 'text', text: 'Email already exists' }], isError: true };
        }
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
        const sdk = getSdk();
        const changes = {};
        if (params.name !== undefined) changes.name = params.name;
        if (params.org_id !== undefined) changes.org_id = params.org_id;
        if (params.status !== undefined) changes.status = params.status;

        if (Object.keys(changes).length === 0) {
          return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };
        }

        await sdk.users.update(params.user_id, changes);
        return { content: [{ type: 'text', text: JSON.stringify({ user_id: params.user_id, updated: true }) }] };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'User not found' }], isError: true };
        }
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
        const sdk = getSdk();
        await sdk.users.remove(params.user_id);
        return { content: [{ type: 'text', text: JSON.stringify({ user_id: params.user_id, deleted: true }) }] };
      } catch (err) {
        if (err.code === 'CONFLICT') {
          return { content: [{ type: 'text', text: 'Cannot delete: user has tickets' }], isError: true };
        }
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'User not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerUserTools };
