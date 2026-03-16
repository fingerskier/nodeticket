/**
 * MCP Ticket Tools
 *
 * Provides ticket-related tools for MCP clients.
 * SQL patterns adapted from src/controllers/ticketController.js.
 */

const { z } = require('zod');
const db = require('../../lib/db');

/**
 * Format ticket for MCP response
 */
const formatTicket = (t) => ({
  ticket_id: t.ticket_id,
  number: t.number,
  subject: t.subject,
  user_id: t.user_id,
  user_name: t.user_name,
  status: { id: t.status_id, name: t.status_name, state: t.status_state },
  department: { id: t.dept_id, name: t.dept_name },
  topic: t.topic_name ? { topic_id: t.topic_id, topic: t.topic_name } : null,
  priority: { priority_id: t.priority_id, priority: t.priority_name, priority_color: t.priority_color },
  staff_id: t.staff_id,
  staff_name: t.staff_name,
  isoverdue: !!t.isoverdue,
  isanswered: !!t.isanswered,
  created: t.created,
  updated: t.updated
});

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
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 25));
        const offset = (page - 1) * limit;

        let sql = `
          SELECT t.*,
                 ts.name as status_name, ts.state as status_state,
                 d.name as dept_name,
                 ht.topic as topic_name,
                 tp.priority_id, tp.priority as priority_name, tp.priority_color,
                 u.name as user_name,
                 CONCAT(s.firstname, ' ', s.lastname) as staff_name,
                 tc.subject
          FROM ${db.table('ticket')} t
          LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
          LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
          LEFT JOIN ${db.table('help_topic')} ht ON t.topic_id = ht.topic_id
          LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
          LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
          LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
          LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
          WHERE 1=1
        `;
        const sqlParams = [];

        if (params.status) { sql += ` AND ts.state = ?`; sqlParams.push(params.status); }
        if (params.dept_id) { sql += ` AND t.dept_id = ?`; sqlParams.push(params.dept_id); }
        if (params.staff_id) { sql += ` AND t.staff_id = ?`; sqlParams.push(params.staff_id); }
        if (params.search) {
          sql += ` AND (t.number LIKE ? OR tc.subject LIKE ?)`;
          const term = `%${params.search}%`;
          sqlParams.push(term, term);
        }

        // User access restriction
        if (userAuth?.type === 'user') {
          sql += ` AND t.user_id = ?`;
          sqlParams.push(userAuth.id);
        }

        // Count
        const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
        const countResult = await db.queryOne(countSql, sqlParams);
        const total = parseInt(countResult?.count || 0, 10);

        sql += ` ORDER BY t.created DESC LIMIT ? OFFSET ?`;
        sqlParams.push(limit, offset);

        const tickets = await db.query(sql, sqlParams);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tickets: tickets.map(formatTicket),
              pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
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
        const limit = Math.min(50, Math.max(1, params.limit || 20));
        const term = `%${params.query}%`;

        let sql = `
          SELECT DISTINCT t.ticket_id, t.number, t.created, t.updated,
                 ts.name as status_name, ts.state as status_state,
                 tc.subject,
                 t.status_id, t.dept_id, t.user_id, t.staff_id, t.topic_id,
                 d.name as dept_name,
                 u.name as user_name,
                 CONCAT(s.firstname, ' ', s.lastname) as staff_name
          FROM ${db.table('ticket')} t
          LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
          LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
          LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
          LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
          LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
          LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
          LEFT JOIN ${db.table('thread_entry')} te ON te.thread_id = th.id
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

        const tickets = await db.query(sql, sqlParams);

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
        const ticket = await db.queryOne(`
          SELECT t.*,
                 ts.name as status_name, ts.state as status_state,
                 d.name as dept_name,
                 ht.topic as topic_name,
                 tp.priority_id, tp.priority as priority_name, tp.priority_color,
                 u.name as user_name, ue.address as user_email,
                 CONCAT(s.firstname, ' ', s.lastname) as staff_name, s.email as staff_email,
                 tm.name as team_name,
                 sla.name as sla_name,
                 tc.subject,
                 th.id as thread_id
          FROM ${db.table('ticket')} t
          LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
          LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
          LEFT JOIN ${db.table('help_topic')} ht ON t.topic_id = ht.topic_id
          LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
          LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
          LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
          LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
          LEFT JOIN ${db.table('team')} tm ON t.team_id = tm.team_id
          LEFT JOIN ${db.table('sla')} sla ON t.sla_id = sla.id
          LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
          LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
          WHERE t.ticket_id = ?
        `, [params.ticket_id]);

        if (!ticket) {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }

        // Access control
        if (userAuth?.type === 'user' && ticket.user_id !== userAuth.id) {
          return { content: [{ type: 'text', text: 'Access denied' }], isError: true };
        }

        const result = {
          ticket_id: ticket.ticket_id,
          number: ticket.number,
          subject: ticket.subject,
          status: { id: ticket.status_id, name: ticket.status_name, state: ticket.status_state },
          department: { id: ticket.dept_id, name: ticket.dept_name },
          topic: ticket.topic_name,
          priority: { priority_id: ticket.priority_id, name: ticket.priority_name, color: ticket.priority_color },
          user: { id: ticket.user_id, name: ticket.user_name, email: ticket.user_email },
          staff: ticket.staff_id ? { id: ticket.staff_id, name: ticket.staff_name, email: ticket.staff_email } : null,
          team: ticket.team_id ? { id: ticket.team_id, name: ticket.team_name } : null,
          sla: ticket.sla_id ? { name: ticket.sla_name } : null,
          isoverdue: !!ticket.isoverdue,
          isanswered: !!ticket.isanswered,
          created: ticket.created,
          updated: ticket.updated
        };

        if (params.include_thread && ticket.thread_id) {
          const entries = await db.query(`
            SELECT te.*,
                   s.firstname, s.lastname, s.email as staff_email,
                   u.name as user_name, ue.address as user_email
            FROM ${db.table('thread_entry')} te
            LEFT JOIN ${db.table('staff')} s ON te.staff_id = s.staff_id
            LEFT JOIN ${db.table('user')} u ON te.user_id = u.id
            LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
            WHERE te.thread_id = ?
            ORDER BY te.created ASC
          `, [ticket.thread_id]);

          result.thread = entries.map(e => ({
            id: e.id,
            type: e.type,
            poster: e.poster || (e.staff_id ? `${e.firstname || ''} ${e.lastname || ''}`.trim() : e.user_name),
            body: e.body,
            created: e.created
          }));
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
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
        const topic = await db.queryOne(`
          SELECT ht.*, d.id as dept_id, d.name as dept_name
          FROM ${db.table('help_topic')} ht
          LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
          WHERE ht.topic_id = ? AND ht.isactive = 1 AND ht.ispublic = 1
        `, [params.topic_id]);

        if (!topic) {
          return { content: [{ type: 'text', text: 'Invalid help topic' }], isError: true };
        }

        const defaultStatus = await db.queryOne(`
          SELECT id FROM ${db.table('ticket_status')}
          WHERE state = 'open' AND mode = 1
          ORDER BY sort ASC LIMIT 1
        `);

        if (!defaultStatus) {
          return { content: [{ type: 'text', text: 'Unable to find default ticket status' }], isError: true };
        }

        // Generate ticket number
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        const ticketNumber = `${timestamp}${random}`.substring(0, 11);

        const now = new Date();

        const ticketResult = await db.query(`
          INSERT INTO ${db.table('ticket')} (
            number, user_id, dept_id, topic_id, status_id, source,
            isoverdue, isanswered, duedate, est_duedate, created, updated
          ) VALUES (?, ?, ?, ?, ?, 'MCP', 0, 0, NULL, NULL, ?, ?)
        `, [ticketNumber, userAuth.id, topic.dept_id, params.topic_id, defaultStatus.id, now, now]);

        const ticketId = ticketResult.insertId;

        await db.query(`
          INSERT INTO ${db.table('ticket__cdata')} (ticket_id, subject) VALUES (?, ?)
        `, [ticketId, params.subject.trim().substring(0, 255)]);

        const threadResult = await db.query(`
          INSERT INTO ${db.table('thread')} (object_id, object_type, lastmessage, created) VALUES (?, 'T', ?, ?)
        `, [ticketId, now, now]);

        const threadId = threadResult.insertId;

        await db.query(`
          INSERT INTO ${db.table('thread_entry')} (
            thread_id, user_id, type, poster, source, body, format, created
          ) VALUES (?, ?, 'M', ?, 'MCP', ?, 'text', ?)
        `, [threadId, userAuth.id, userAuth.name || 'User', params.message.trim(), now]);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ticket_id: ticketId,
              number: ticketNumber,
              subject: params.subject.trim(),
              status: 'open',
              department: topic.dept_name,
              created: now
            }, null, 2)
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
        const ticket = await db.queryOne(
          `SELECT ticket_id FROM ${db.table('ticket')} WHERE ticket_id = ?`,
          [params.ticket_id]
        );

        if (!ticket) {
          return { content: [{ type: 'text', text: 'Ticket not found' }], isError: true };
        }

        const updates = [];
        const sqlParams = [];

        if (params.status_id !== undefined) { updates.push('status_id = ?'); sqlParams.push(params.status_id); }
        if (params.staff_id !== undefined) { updates.push('staff_id = ?'); sqlParams.push(params.staff_id); }
        if (params.dept_id !== undefined) { updates.push('dept_id = ?'); sqlParams.push(params.dept_id); }
        if (params.team_id !== undefined) { updates.push('team_id = ?'); sqlParams.push(params.team_id); }

        if (updates.length === 0) {
          return { content: [{ type: 'text', text: 'No updates provided' }], isError: true };
        }

        updates.push('updated = ?');
        sqlParams.push(new Date());
        sqlParams.push(params.ticket_id);

        await db.query(
          `UPDATE ${db.table('ticket')} SET ${updates.join(', ')} WHERE ticket_id = ?`,
          sqlParams
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({ ticket_id: params.ticket_id, updated: true }) }]
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error updating ticket: ${err.message}` }], isError: true };
      }
    }
  );
};

module.exports = { registerTicketTools };
