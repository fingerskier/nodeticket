/**
 * MCP Ticket Tools
 *
 * Provides ticket-related tools for MCP clients.
 * Delegates to SDK ticket service for all business logic.
 */

const { z } = require('zod');
const { getSdk } = require('../../lib/sdk');

/**
 * Register all ticket tools on an McpServer instance.
 */
const registerTicketTools = (server, userAuth) => {

  // ── list_tickets ──
  server.tool(
    'list_tickets',
    'List tickets with optional filters and pagination. Users see only their own tickets; staff see all.',
    {
      status: z.string().optional().describe('Filter by status state (open, closed, archived)'),
      dept_id: z.number().optional().describe('Filter by department ID'),
      staff_id: z.number().optional().describe('Filter by assigned staff ID'),
      search: z.string().optional().describe('Search ticket number or subject'),
      page: z.number().optional().default(1).describe('Page number'),
      limit: z.number().optional().default(25).describe('Results per page (max 100)')
    },
    async (params) => {
      try {
        const sdk = getSdk();
        const filters = {
          status: params.status,
          dept_id: params.dept_id,
          staff_id: params.staff_id,
          search: params.search,
          page: params.page,
          limit: params.limit,
        };

        // User access restriction
        if (userAuth?.type === 'user') {
          filters.user_id = userAuth.id;
        }

        const result = await sdk.tickets.list(filters);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tickets: result.data,
              pagination: result.pagination
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error listing tickets: ${err.message}` }], isError: true };
      }
    }
  );

  // ── search_tickets ──
  server.tool(
    'search_tickets',
    'Full-text search across ticket subjects and message bodies.',
    {
      query: z.string().describe('Search query'),
      status: z.string().optional().describe('Filter by status state'),
      limit: z.number().optional().default(20).describe('Max results (max 50)')
    },
    async (params) => {
      try {
        const sdk = getSdk();
        const conn = sdk.connection;
        const limit = Math.min(50, Math.max(1, params.limit || 20));
        const term = `%${params.query}%`;

        // Full-text search across subjects and thread entry bodies
        // requires direct SQL since SDK list() only searches number/subject
        let sql = `
          SELECT DISTINCT t.ticket_id, t.number, t.created, t.updated,
                 ts.name as status_name, ts.state as status_state,
                 tc.subject,
                 t.status_id, t.dept_id, t.user_id, t.staff_id, t.topic_id,
                 d.name as dept_name,
                 u.name as user_name,
                 CONCAT(s.firstname, ' ', s.lastname) as staff_name
          FROM ${conn.table('ticket')} t
          LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
          LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
          LEFT JOIN ${conn.table('department')} d ON t.dept_id = d.id
          LEFT JOIN ${conn.table('user')} u ON t.user_id = u.id
          LEFT JOIN ${conn.table('staff')} s ON t.staff_id = s.staff_id
          LEFT JOIN ${conn.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
          LEFT JOIN ${conn.table('thread_entry')} te ON te.thread_id = th.id
          WHERE (tc.subject LIKE ? OR te.body LIKE ?)
        `;
        const sqlParams = [term, term];

        if (params.status) { sql += ` AND ts.state = ?`; sqlParams.push(params.status); }

        if (userAuth?.type === 'user') {
          sql += ` AND t.user_id = ?`;
          sqlParams.push(userAuth.id);
        }

        sql += ` ORDER BY t.updated DESC LIMIT ?`;
        sqlParams.push(limit);

        const tickets = await conn.query(sql, sqlParams);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ results: tickets.map(t => ({
              ticket_id: t.ticket_id,
              number: t.number,
              subject: t.subject,
              status: t.status_name,
              department: t.dept_name,
              user: t.user_name,
              staff: t.staff_name,
              created: t.created,
              updated: t.updated
            }))}, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error searching tickets: ${err.message}` }], isError: true };
      }
    }
  );

  // ── read_ticket ──
  server.tool(
    'read_ticket',
    'Get full ticket detail, optionally including the message thread.',
    {
      ticket_id: z.number().describe('Ticket ID'),
      include_thread: z.boolean().optional().default(true).describe('Include message thread')
    },
    async (params) => {
      try {
        const sdk = getSdk();
        const ticket = await sdk.tickets.get(params.ticket_id);

        // Access control
        if (userAuth?.type === 'user' && ticket.user_id !== userAuth.id) {
          return { content: [{ type: 'text', text: 'Access denied' }], isError: true };
        }

        const result = {
          ticket_id: ticket.ticket_id,
          number: ticket.number,
          subject: ticket.subject,
          status: ticket.status,
          department: ticket.department,
          topic: ticket.topic,
          priority: ticket.priority,
          user: ticket.user,
          staff: ticket.staff,
          team: ticket.team,
          sla: ticket.sla,
          isoverdue: ticket.isoverdue,
          isanswered: ticket.isanswered,
          created: ticket.created,
          updated: ticket.updated
        };

        if (params.include_thread && ticket.thread?.id) {
          const threadResult = await sdk.tickets.getThread(params.ticket_id, { limit: 100 });
          result.thread = threadResult.data.map(e => ({
            id: e.id,
            type: e.type,
            poster: e.poster,
            body: e.body,
            created: e.created
          }));
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error reading ticket: ${err.message}` }], isError: true };
      }
    }
  );

  // ── create_ticket ──
  server.tool(
    'create_ticket',
    'Create a new ticket. Requires user authentication (not staff).',
    {
      topic_id: z.number().describe('Help topic ID'),
      subject: z.string().describe('Ticket subject'),
      message: z.string().describe('Initial message body')
    },
    async (params) => {
      if (userAuth?.type !== 'user') {
        return { content: [{ type: 'text', text: 'Only users can create tickets' }], isError: true };
      }

      try {
        const sdk = getSdk();
        const result = await sdk.tickets.create({
          userId: userAuth.id,
          topicId: params.topic_id,
          subject: params.subject,
          body: params.message,
          source: 'MCP',
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error creating ticket: ${err.message}` }], isError: true };
      }
    }
  );

  // ── update_ticket ──
  server.tool(
    'update_ticket',
    'Update ticket properties. Requires staff authentication.',
    {
      ticket_id: z.number().describe('Ticket ID to update'),
      status_id: z.number().optional().describe('New status ID'),
      staff_id: z.number().optional().describe('Assign to staff ID'),
      dept_id: z.number().optional().describe('Move to department ID'),
      team_id: z.number().optional().describe('Assign to team ID')
    },
    async (params) => {
      if (userAuth?.type !== 'staff' && userAuth?.type !== 'apikey') {
        return { content: [{ type: 'text', text: 'Staff access required' }], isError: true };
      }

      try {
        const sdk = getSdk();
        const changes = {};
        if (params.status_id !== undefined) changes.status_id = params.status_id;
        if (params.staff_id !== undefined) changes.staff_id = params.staff_id;
        if (params.dept_id !== undefined) changes.dept_id = params.dept_id;
        if (params.team_id !== undefined) changes.team_id = params.team_id;

        if (Object.keys(changes).length === 0) {
          return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };
        }

        const result = await sdk.tickets.update(params.ticket_id, changes, {
          staffId: userAuth?.id || 0,
          username: userAuth?.name || '',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ ticket_id: result.ticket_id, updated: true }) }]
        };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error updating ticket: ${err.message}` }], isError: true };
      }
    }
  );

  // ── reply_to_ticket ──
  server.tool(
    'reply_to_ticket',
    'Post a reply to a ticket thread.',
    {
      ticket_id: z.number().describe('Ticket ID'),
      message: z.string().describe('Reply message body'),
      format: z.string().optional().default('text').describe('Message format (text or html)')
    },
    async (params) => {
      try {
        const sdk = getSdk();

        // Access control for users
        if (userAuth?.type === 'user') {
          const ticket = await sdk.tickets.get(params.ticket_id);
          if (ticket.user_id !== userAuth.id) {
            return { content: [{ type: 'text', text: 'Access denied' }], isError: true };
          }
        }

        const isStaff = userAuth?.type === 'staff' || userAuth?.type === 'apikey';
        const result = await sdk.tickets.reply(params.ticket_id, {
          staffId: isStaff ? (userAuth?.id || 0) : null,
          userId: !isStaff ? (userAuth?.id || 0) : null,
          body: params.message,
          format: params.format || 'text',
          poster: userAuth?.name || (isStaff ? 'Staff' : 'User'),
          source: 'MCP',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            entry_id: result.id, thread_id: result.thread_id, type: result.type, poster: result.poster, created: result.created
          }, null, 2) }]
        };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error replying to ticket: ${err.message}` }], isError: true };
      }
    }
  );

  // ── add_note ──
  server.tool(
    'add_note',
    'Add an internal note to a ticket. Requires staff authentication.',
    {
      ticket_id: z.number().describe('Ticket ID'),
      note: z.string().describe('Note content'),
      title: z.string().optional().describe('Optional note title')
    },
    async (params) => {
      if (userAuth?.type !== 'staff' && userAuth?.type !== 'apikey') {
        return { content: [{ type: 'text', text: 'Staff access required' }], isError: true };
      }

      try {
        const sdk = getSdk();
        const result = await sdk.tickets.addNote(params.ticket_id, {
          staffId: userAuth?.id || 0,
          title: params.title || null,
          body: params.note,
          poster: userAuth?.name || 'Staff',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            entry_id: result.id, thread_id: result.thread_id, type: 'N', poster: result.poster, created: result.created
          }, null, 2) }]
        };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error adding note: ${err.message}` }], isError: true };
      }
    }
  );

  // ── merge_tickets ──
  server.tool(
    'merge_tickets',
    'Merge a source ticket into a target ticket. Moves all thread entries and closes the source. Requires staff authentication.',
    {
      source_ticket_id: z.number().describe('Ticket ID to merge from (will be closed)'),
      target_ticket_id: z.number().describe('Ticket ID to merge into (receives entries)')
    },
    async (params) => {
      if (userAuth?.type !== 'staff' && userAuth?.type !== 'apikey') {
        return { content: [{ type: 'text', text: 'Staff access required' }], isError: true };
      }

      if (params.source_ticket_id === params.target_ticket_id) {
        return { content: [{ type: 'text', text: 'Cannot merge a ticket into itself' }], isError: true };
      }

      try {
        const sdk = getSdk();

        // Get ticket numbers for the response before merge
        const source = await sdk.tickets.get(params.source_ticket_id);
        const target = await sdk.tickets.get(params.target_ticket_id);

        await sdk.tickets.merge(params.source_ticket_id, {
          targetTicketId: params.target_ticket_id,
          staffId: userAuth?.id || 0,
          username: userAuth?.name || 'Staff',
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            merged: true,
            source: { ticket_id: params.source_ticket_id, number: source.number, status: 'closed' },
            target: { ticket_id: params.target_ticket_id, number: target.number }
          }, null, 2) }]
        };
      } catch (err) {
        if (err.code === 'NOT_FOUND') {
          const msg = err.message.includes('Source') ? 'Source ticket not found' :
                      err.message.includes('Target') ? 'Target ticket not found' : err.message;
          return { content: [{ type: 'text', text: msg }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error merging tickets: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerTicketTools };
