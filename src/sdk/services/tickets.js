/**
 * Ticket Service — business logic for ticket operations
 * @module sdk/services/tickets
 */

const { ValidationError, NotFoundError } = require('../errors');

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} Ticket service methods
 */
module.exports = (conn, data) => {
  // ── Internal helpers ────────────────────────────────────────

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
   * Generate a unique ticket number (timestamp + random, base-36, max 11 chars).
   * @returns {string}
   */
  const generateTicketNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${timestamp}${random}`.substring(0, 11);
  };

  /**
   * Get the thread.id for a given ticket.
   * @param {number|string} ticketId
   * @returns {Promise<number|null>}
   */
  const getThreadId = async (ticketId) => {
    const thread = await conn.queryOne(`
      SELECT th.id FROM ${conn.table('thread')} th
      JOIN ${conn.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [ticketId]);
    return thread?.id || null;
  };

  /**
   * Insert a thread_event row.
   * @param {number} threadId
   * @param {string} eventName
   * @param {number|null} staffId
   * @param {string} username
   * @param {*} eventData
   * @param {Function} [queryFn] - optional txQuery override
   * @param {Function} [queryOneFn] - optional txQueryOne override
   */
  const logEvent = async (threadId, eventName, staffId, username, eventData, queryFn, queryOneFn) => {
    const qOne = queryOneFn || conn.queryOne;
    const q = queryFn || conn.query;

    const event = await qOne(
      `SELECT id FROM ${conn.table('event')} WHERE name = ?`, [eventName]
    );
    if (!event) return;

    await q(`
      INSERT INTO ${conn.table('thread_event')}
      (thread_id, event_id, staff_id, username, data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [threadId, event.id, staffId || 0, username || '', JSON.stringify(eventData), new Date()]);
  };

  /**
   * Format a ticket row for list responses.
   * @param {Object} t
   * @returns {Object}
   */
  const formatTicket = (t) => ({
    ticket_id: t.ticket_id,
    number: t.number,
    subject: t.subject,
    user_id: t.user_id,
    user_name: t.user_name,
    status_id: t.status_id,
    status: {
      id: t.status_id,
      name: t.status_name,
      state: t.status_state,
    },
    dept_id: t.dept_id,
    department: {
      id: t.dept_id,
      name: t.dept_name,
    },
    topic_id: t.topic_id,
    topic: t.topic_name ? { topic_id: t.topic_id, topic: t.topic_name } : null,
    priority: {
      priority_id: t.priority_id,
      priority: t.priority_name,
      priority_color: t.priority_color,
    },
    staff_id: t.staff_id,
    staff_name: t.staff_name,
    team_id: t.team_id,
    source: t.source,
    isoverdue: !!t.isoverdue,
    isanswered: !!t.isanswered,
    duedate: t.duedate,
    est_duedate: t.est_duedate,
    closed: t.closed,
    created: t.created,
    updated: t.updated,
  });

  /**
   * Format a ticket row for detail responses.
   * @param {Object} t
   * @param {Array} collaborators
   * @returns {Object}
   */
  const formatTicketDetail = (t, collaborators) => ({
    ...formatTicket(t),
    user: {
      id: t.user_id,
      name: t.user_name,
      email: t.user_email,
    },
    staff: t.staff_id ? {
      staff_id: t.staff_id,
      name: `${t.firstname || ''} ${t.lastname || ''}`.trim(),
      email: t.staff_email,
    } : null,
    team: t.team_id ? {
      team_id: t.team_id,
      name: t.team_name,
    } : null,
    sla: t.sla_id ? {
      id: t.sla_id,
      name: t.sla_name,
      grace_period: t.grace_period,
    } : null,
    priority: {
      priority_id: t.priority_id,
      priority: t.priority_name,
      priority_color: t.priority_color,
      priority_urgency: t.priority_urgency,
    },
    thread: {
      id: t.thread_id,
      lastresponse: t.lastresponse,
      lastmessage: t.lastmessage,
    },
    collaborators: collaborators.map((c) => ({
      id: c.id,
      user_id: c.user_id,
      name: c.name,
      email: c.email,
      role: c.role,
    })),
  });

  /**
   * Format a thread entry row.
   * @param {Object} e
   * @returns {Object}
   */
  const formatThreadEntry = (e) => ({
    id: e.id,
    thread_id: e.thread_id,
    staff_id: e.staff_id,
    user_id: e.user_id,
    type: e.type,
    poster: e.poster || (e.staff_id ? `${e.firstname || ''} ${e.lastname || ''}`.trim() : e.user_name),
    email: e.staff_id ? e.staff_email : e.user_email,
    title: e.title,
    body: e.body,
    format: e.format,
    source: e.source,
    created: e.created,
  });

  // ── Public methods ──────────────────────────────────────────

  /**
   * List tickets with filters and pagination.
   *
   * @param {Object} [filters={}]
   * @param {string} [filters.status] - Filter by status state (e.g. 'open', 'closed')
   * @param {number|string} [filters.dept_id] - Filter by department
   * @param {number|string} [filters.staff_id] - Filter by assigned staff
   * @param {number|string} [filters.user_id] - Filter by ticket owner
   * @param {number|string} [filters.topic_id] - Filter by help topic
   * @param {number|string} [filters.priority_id] - Filter by priority
   * @param {boolean|string} [filters.isoverdue] - Filter overdue tickets
   * @param {string} [filters.search] - Search ticket number or subject
   * @param {string} [filters.sort='created'] - Sort field
   * @param {string} [filters.order='DESC'] - Sort direction
   * @param {number|string} [filters.page=1] - Page number
   * @param {number|string} [filters.limit=25] - Page size (max 100)
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   * @throws {ValidationError} If an invalid sort field is provided
   *
   * @example
   * const result = await tickets.list({ status: 'open', page: 1, limit: 10 });
   * // result.data[0].ticket_id, result.pagination.total
   */
  const list = async (filters = {}) => {
    const { status, dept_id, staff_id, user_id, topic_id, priority_id, isoverdue, search, sort, order } = filters;
    const { page, limit, offset } = paginate(filters.page, filters.limit);

    let sql = `
      SELECT t.*,
             ts.name as status_name, ts.state as status_state,
             d.name as dept_name,
             ht.topic as topic_name,
             tp.priority_id, tp.priority as priority_name, tp.priority_color,
             u.name as user_name,
             CONCAT(s.firstname, ' ', s.lastname) as staff_name,
             tc.subject
      FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${conn.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${conn.table('help_topic')} ht ON t.topic_id = ht.topic_id
      LEFT JOIN ${conn.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
      LEFT JOIN ${conn.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${conn.table('staff')} s ON t.staff_id = s.staff_id
      LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE 1=1
    `;
    const params = [];

    if (status) { sql += ` AND ts.state = ?`; params.push(status); }
    if (dept_id) { sql += ` AND t.dept_id = ?`; params.push(dept_id); }
    if (staff_id) { sql += ` AND t.staff_id = ?`; params.push(staff_id); }
    if (user_id) { sql += ` AND t.user_id = ?`; params.push(user_id); }
    if (topic_id) { sql += ` AND t.topic_id = ?`; params.push(topic_id); }
    if (priority_id) { sql += ` AND ht.priority_id = ?`; params.push(priority_id); }
    if (isoverdue === true || isoverdue === 'true' || isoverdue === '1') {
      sql += ` AND t.isoverdue = 1`;
    }
    if (search) {
      sql += ` AND (t.number LIKE ? OR tc.subject LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term);
    }

    // Total count
    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
    const countResult = await conn.queryOne(countSql, params);
    const total = parseInt(countResult?.count || 0, 10);

    // Sorting
    const sortField = sort || 'created';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const allowedSortFields = ['ticket_id', 'number', 'created', 'updated', 'duedate', 'status_id'];
    if (sortField === 'priority_id' || sortField === 'priority') {
      sql += ` ORDER BY tp.priority_urgency ${sortOrder}`;
    } else if (allowedSortFields.includes(sortField)) {
      sql += ` ORDER BY t.${sortField} ${sortOrder}`;
    } else {
      sql += ` ORDER BY t.created DESC`;
    }

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const tickets = await conn.query(sql, params);

    return {
      data: tickets.map(formatTicket),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get a single ticket by ID or ticket number.
   *
   * @param {number|string} id - Ticket ID (numeric) or ticket number (string)
   * @returns {Promise<Object>} Formatted ticket detail
   * @throws {NotFoundError} If the ticket does not exist
   *
   * @example
   * const ticket = await tickets.get(42);
   * const ticket = await tickets.get('LK3RF9ZA');
   */
  const get = async (id) => {
    const whereClause = isNaN(id) ? 't.number = ?' : 't.ticket_id = ?';

    const ticket = await conn.queryOne(`
      SELECT t.*,
             ts.name as status_name, ts.state as status_state,
             d.id as dept_id, d.name as dept_name,
             ht.topic_id, ht.topic as topic_name,
             tp.priority_id, tp.priority as priority_name, tp.priority_color, tp.priority_urgency,
             u.id as user_id, u.name as user_name,
             ue.address as user_email,
             s.staff_id, s.firstname, s.lastname, s.email as staff_email,
             tm.team_id, tm.name as team_name,
             sla.id as sla_id, sla.name as sla_name, sla.grace_period,
             tc.subject,
             th.id as thread_id, th.lastresponse, th.lastmessage
      FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${conn.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${conn.table('help_topic')} ht ON t.topic_id = ht.topic_id
      LEFT JOIN ${conn.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
      LEFT JOIN ${conn.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      LEFT JOIN ${conn.table('staff')} s ON t.staff_id = s.staff_id
      LEFT JOIN ${conn.table('team')} tm ON t.team_id = tm.team_id
      LEFT JOIN ${conn.table('sla')} sla ON t.sla_id = sla.id
      LEFT JOIN ${conn.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      LEFT JOIN ${conn.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE ${whereClause}
    `, [id]);

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    // Collaborators
    const collaborators = await conn.query(`
      SELECT tc.*, u.name, ue.address as email
      FROM ${conn.table('thread_collaborator')} tc
      JOIN ${conn.table('user')} u ON tc.user_id = u.id
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      WHERE tc.thread_id = ?
    `, [ticket.thread_id]);

    return formatTicketDetail(ticket, collaborators);
  };

  /**
   * Get paginated thread entries for a ticket.
   *
   * @param {number|string} ticketId - The ticket_id
   * @param {Object} [options={}]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=25]
   * @returns {Promise<{ data: Array<Object>, pagination: Object }>}
   * @throws {NotFoundError} If the ticket/thread does not exist
   *
   * @example
   * const thread = await tickets.getThread(42, { page: 1, limit: 10 });
   */
  const getThread = async (ticketId, options = {}) => {
    const { page, limit, offset } = paginate(options.page, options.limit);

    const thread = await conn.queryOne(`
      SELECT th.id FROM ${conn.table('thread')} th
      JOIN ${conn.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [ticketId]);

    if (!thread) {
      throw new NotFoundError('Ticket not found');
    }

    const entries = await conn.query(`
      SELECT te.*,
             s.firstname, s.lastname, s.email as staff_email,
             u.name as user_name, ue.address as user_email
      FROM ${conn.table('thread_entry')} te
      LEFT JOIN ${conn.table('staff')} s ON te.staff_id = s.staff_id
      LEFT JOIN ${conn.table('user')} u ON te.user_id = u.id
      LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
      WHERE te.thread_id = ?
      ORDER BY te.created ASC
      LIMIT ? OFFSET ?
    `, [thread.id, limit, offset]);

    const total = parseInt(
      await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('thread_entry')} WHERE thread_id = ?`, [thread.id]) || 0,
      10,
    );

    return {
      data: entries.map(formatThreadEntry),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  };

  /**
   * Get the event log for a ticket.
   *
   * @param {number|string} ticketId - The ticket_id
   * @returns {Promise<Array<Object>>} Array of event records
   * @throws {NotFoundError} If the ticket does not exist
   *
   * @example
   * const events = await tickets.getEvents(42);
   */
  const getEvents = async (ticketId) => {
    const thread = await conn.queryOne(`
      SELECT th.id FROM ${conn.table('thread')} th
      JOIN ${conn.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [ticketId]);

    if (!thread) {
      throw new NotFoundError('Ticket not found');
    }

    const events = await conn.query(`
      SELECT te.*, e.name as event_name
      FROM ${conn.table('thread_event')} te
      LEFT JOIN ${conn.table('event')} e ON te.event_id = e.id
      WHERE te.thread_id = ?
      ORDER BY te.timestamp DESC
    `, [thread.id]);

    return events.map((e) => ({
      id: e.id,
      thread_id: e.thread_id,
      event_id: e.event_id,
      event_name: e.event_name,
      staff_id: e.staff_id,
      username: e.username,
      data: e.data ? JSON.parse(e.data) : null,
      timestamp: e.timestamp,
    }));
  };

  /**
   * Create a new ticket.
   *
   * @param {Object} params
   * @param {number|string} params.userId - The user who owns the ticket
   * @param {number|string} params.topicId - Help topic ID
   * @param {string} params.subject - Ticket subject
   * @param {string} params.body - Initial message body
   * @param {string} [params.source='API'] - Creation source
   * @returns {Promise<Object>} Created ticket summary
   * @throws {ValidationError} If required fields are missing or topic is invalid
   *
   * @example
   * const ticket = await tickets.create({
   *   userId: 5, topicId: 2, subject: 'Help me', body: 'Details here'
   * });
   */
  const create = async ({ userId, topicId, subject, body, source = 'API' }) => {
    if (!userId) throw new ValidationError('userId is required');
    if (!topicId) throw new ValidationError('topicId is required');
    if (!subject || !subject.trim()) throw new ValidationError('Subject is required');
    if (!body || !body.trim()) throw new ValidationError('Message body is required');

    // Verify topic
    const topic = await conn.queryOne(`
      SELECT ht.*, d.id as dept_id, d.name as dept_name
      FROM ${conn.table('help_topic')} ht
      LEFT JOIN ${conn.table('department')} d ON ht.dept_id = d.id
      WHERE ht.topic_id = ? AND ht.isactive = 1 AND ht.ispublic = 1
    `, [topicId]);

    if (!topic) {
      throw new ValidationError('Invalid or inactive help topic');
    }

    const ticketNumber = generateTicketNumber();

    // Default open status
    const defaultStatus = await conn.queryOne(`
      SELECT id FROM ${conn.table('ticket_status')}
      WHERE state = 'open' AND mode = 1
      ORDER BY sort ASC LIMIT 1
    `);

    if (!defaultStatus) {
      throw new ValidationError('Unable to find default open ticket status');
    }

    const now = new Date();

    const ticketResult = await conn.query(`
      INSERT INTO ${conn.table('ticket')} (
        number, user_id, dept_id, topic_id, status_id, source,
        isoverdue, isanswered, duedate, est_duedate,
        created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?, ?)
    `, [ticketNumber, userId, topic.dept_id, topicId, defaultStatus.id, source, now, now]);

    const ticketId = ticketResult.insertId;

    // Custom data (subject)
    await conn.query(`
      INSERT INTO ${conn.table('ticket__cdata')} (ticket_id, subject) VALUES (?, ?)
    `, [ticketId, subject.trim().substring(0, 255)]);

    // Thread
    const threadResult = await conn.query(`
      INSERT INTO ${conn.table('thread')} (object_id, object_type, lastmessage, created)
      VALUES (?, 'T', ?, ?)
    `, [ticketId, now, now]);

    const threadId = threadResult.insertId;

    // First message entry
    await conn.query(`
      INSERT INTO ${conn.table('thread_entry')} (
        thread_id, user_id, type, poster, source, body, format, created
      ) VALUES (?, ?, 'M', ?, ?, ?, 'text', ?)
    `, [threadId, userId, 'User', source, body.trim(), now]);

    return {
      ticket_id: ticketId,
      number: ticketNumber,
      subject: subject.trim(),
      status: 'open',
      department: topic.dept_name,
      created: now,
    };
  };

  /**
   * Update ticket metadata.
   *
   * @param {number|string} ticketId - The ticket_id
   * @param {Object} changes - Fields to update
   * @param {number} [changes.status_id] - New status ID
   * @param {number|null} [changes.staff_id] - Assigned staff ID
   * @param {number} [changes.dept_id] - Department ID
   * @param {number|null} [changes.team_id] - Team ID
   * @param {number} [changes.topic_id] - Help topic ID
   * @param {number|null} [changes.sla_id] - SLA ID
   * @param {string|null} [changes.duedate] - Due date
   * @param {boolean|number} [changes.isoverdue] - Overdue flag
   * @param {Object} [options={}]
   * @param {number|null} [options.staffId] - Staff performing the update
   * @param {string} [options.username] - Username for event logging
   * @returns {Promise<{ ticket_id: number }>}
   * @throws {NotFoundError} If the ticket is not found
   * @throws {ValidationError} If referenced entities are invalid or no changes provided
   *
   * @example
   * await tickets.update(42, { status_id: 3 }, { staffId: 1, username: 'admin' });
   */
  const update = async (ticketId, changes = {}, { staffId = null, username = '' } = {}) => {
    const ticket = await conn.queryOne(`
      SELECT t.*, th.id as thread_id FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [ticketId]);

    if (!ticket) throw new NotFoundError('Ticket not found');

    const updates = [];
    const params = [];
    const { status_id, staff_id, dept_id, team_id, topic_id, sla_id, duedate, isoverdue } = changes;

    // Status
    if (status_id !== undefined) {
      const status = await conn.queryOne(
        `SELECT id, state FROM ${conn.table('ticket_status')} WHERE id = ?`, [status_id]
      );
      if (!status) throw new ValidationError('Invalid status_id');
      updates.push('status_id = ?'); params.push(status_id);

      if (status.state === 'closed') {
        updates.push('closed = ?'); params.push(new Date());
        if (ticket.thread_id) {
          await logEvent(ticket.thread_id, 'closed', staffId, username, { status_id });
        }
      } else if (ticket.status_id !== status_id) {
        const oldStatus = await conn.queryOne(
          `SELECT state FROM ${conn.table('ticket_status')} WHERE id = ?`, [ticket.status_id]
        );
        if (oldStatus?.state === 'closed') {
          updates.push('closed = ?'); params.push(null);
          if (ticket.thread_id) {
            await logEvent(ticket.thread_id, 'reopened', staffId, username, { status_id });
          }
        }
      }
    }

    // Staff assignment
    if (staff_id !== undefined) {
      if (staff_id !== null) {
        const s = await conn.queryOne(
          `SELECT staff_id FROM ${conn.table('staff')} WHERE staff_id = ?`, [staff_id]
        );
        if (!s) throw new ValidationError('Invalid staff_id');
      }
      updates.push('staff_id = ?'); params.push(staff_id);
      if (ticket.thread_id) {
        await logEvent(ticket.thread_id, 'assigned', staffId, username, { staff_id });
      }
    }

    // Department transfer
    if (dept_id !== undefined) {
      const dept = await conn.queryOne(
        `SELECT id FROM ${conn.table('department')} WHERE id = ?`, [dept_id]
      );
      if (!dept) throw new ValidationError('Invalid dept_id');
      updates.push('dept_id = ?'); params.push(dept_id);
      if (ticket.thread_id) {
        await logEvent(ticket.thread_id, 'transferred', staffId, username, { dept_id });
      }
    }

    // Team assignment
    if (team_id !== undefined) {
      if (team_id !== null) {
        const team = await conn.queryOne(
          `SELECT team_id FROM ${conn.table('team')} WHERE team_id = ?`, [team_id]
        );
        if (!team) throw new ValidationError('Invalid team_id');
      }
      updates.push('team_id = ?'); params.push(team_id);
      if (ticket.thread_id) {
        await logEvent(ticket.thread_id, 'assigned', staffId, username, { team_id });
      }
    }

    // Topic
    if (topic_id !== undefined) {
      const tp = await conn.queryOne(
        `SELECT topic_id FROM ${conn.table('help_topic')} WHERE topic_id = ?`, [topic_id]
      );
      if (!tp) throw new ValidationError('Invalid topic_id');
      updates.push('topic_id = ?'); params.push(topic_id);
    }

    // SLA
    if (sla_id !== undefined) {
      if (sla_id !== null) {
        const sla = await conn.queryOne(
          `SELECT id FROM ${conn.table('sla')} WHERE id = ?`, [sla_id]
        );
        if (!sla) throw new ValidationError('Invalid sla_id');
      }
      updates.push('sla_id = ?'); params.push(sla_id);
    }

    if (duedate !== undefined) { updates.push('duedate = ?'); params.push(duedate); }
    if (isoverdue !== undefined) { updates.push('isoverdue = ?'); params.push(isoverdue ? 1 : 0); }

    if (updates.length === 0) {
      throw new ValidationError('No valid updates provided');
    }

    updates.push('updated = ?'); params.push(new Date());
    params.push(ticketId);

    await conn.query(
      `UPDATE ${conn.table('ticket')} SET ${updates.join(', ')} WHERE ticket_id = ?`,
      params,
    );

    return { ticket_id: parseInt(ticketId, 10) };
  };

  /**
   * Add a reply to a ticket thread.
   *
   * @param {number|string} ticketId - The ticket_id
   * @param {Object} params
   * @param {number|null} [params.staffId] - Staff ID (if staff reply)
   * @param {number|null} [params.userId] - User ID (if user message)
   * @param {string} params.body - Reply content
   * @param {string} [params.format='text'] - Body format ('text' or 'html')
   * @param {string} [params.poster] - Display name of poster
   * @param {string} [params.source='API'] - Entry source
   * @returns {Promise<Object>} Created thread entry summary
   * @throws {NotFoundError} If the ticket does not exist
   * @throws {ValidationError} If body is empty
   *
   * @example
   * await tickets.reply(42, { staffId: 1, body: 'Working on it', poster: 'Admin' });
   */
  const reply = async (ticketId, { staffId = null, userId = null, body, format = 'text', poster, source = 'API' }) => {
    if (!body || !body.trim()) throw new ValidationError('Message body is required');

    const threadId = await getThreadId(ticketId);
    if (!threadId) throw new NotFoundError('Ticket not found');

    const isStaff = !!staffId;
    const entryType = isStaff ? 'R' : 'M';
    const displayPoster = poster || (isStaff ? 'Staff' : 'User');
    const now = new Date();

    const result = await conn.query(`
      INSERT INTO ${conn.table('thread_entry')}
      (thread_id, staff_id, user_id, type, poster, source, body, format, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [threadId, staffId || 0, userId || 0, entryType, displayPoster, source, body.trim(), format, now]);

    // Update thread/ticket timestamps
    if (isStaff) {
      await conn.query(
        `UPDATE ${conn.table('thread')} SET lastresponse = ? WHERE id = ?`, [now, threadId]
      );
      await conn.query(
        `UPDATE ${conn.table('ticket')} SET isanswered = 1, updated = ? WHERE ticket_id = ?`, [now, ticketId]
      );
    } else {
      await conn.query(
        `UPDATE ${conn.table('thread')} SET lastmessage = ? WHERE id = ?`, [now, threadId]
      );
      await conn.query(
        `UPDATE ${conn.table('ticket')} SET updated = ? WHERE ticket_id = ?`, [now, ticketId]
      );
    }

    await logEvent(threadId, 'message', staffId, displayPoster, { type: entryType });

    return {
      id: result.insertId,
      thread_id: threadId,
      type: entryType,
      poster: displayPoster,
      body: body.trim(),
      created: now,
    };
  };

  /**
   * Add an internal note to a ticket (staff-only content).
   *
   * @param {number|string} ticketId - The ticket_id
   * @param {Object} params
   * @param {number} params.staffId - Staff ID adding the note
   * @param {string} [params.title] - Note title
   * @param {string} params.body - Note content
   * @param {string} [params.poster] - Display name
   * @returns {Promise<Object>} Created note summary
   * @throws {NotFoundError} If the ticket does not exist
   * @throws {ValidationError} If body is empty
   *
   * @example
   * await tickets.addNote(42, { staffId: 1, title: 'Internal', body: 'Escalating...' });
   */
  const addNote = async (ticketId, { staffId, title, body, poster }) => {
    if (!body || !body.trim()) throw new ValidationError('Note content is required');

    const threadId = await getThreadId(ticketId);
    if (!threadId) throw new NotFoundError('Ticket not found');

    const now = new Date();
    const displayPoster = poster || 'Staff';

    const result = await conn.query(`
      INSERT INTO ${conn.table('thread_entry')}
      (thread_id, staff_id, type, poster, title, source, body, format, created)
      VALUES (?, ?, 'N', ?, ?, 'API', ?, 'text', ?)
    `, [threadId, staffId || 0, displayPoster, title || null, body.trim(), now]);

    await conn.query(
      `UPDATE ${conn.table('ticket')} SET updated = ? WHERE ticket_id = ?`, [now, ticketId]
    );

    await logEvent(threadId, 'note', staffId, displayPoster, { title: title || null });

    return {
      id: result.insertId,
      thread_id: threadId,
      type: 'N',
      poster: displayPoster,
      title: title || null,
      body: body.trim(),
      created: now,
    };
  };

  /**
   * Close a ticket.
   *
   * @param {number|string} ticketId - The ticket_id
   * @param {Object} [options={}]
   * @param {number|null} [options.staffId] - Staff performing the close
   * @param {string} [options.username] - Username for event log
   * @returns {Promise<{ ticket_id: number }>}
   * @throws {NotFoundError} If the ticket does not exist
   * @throws {ValidationError} If no closed status exists in the system
   *
   * @example
   * await tickets.close(42, { staffId: 1, username: 'admin' });
   */
  const close = async (ticketId, { staffId = null, username = '' } = {}) => {
    const closedStatus = await conn.queryOne(
      `SELECT id FROM ${conn.table('ticket_status')} WHERE state = 'closed' ORDER BY sort ASC LIMIT 1`
    );
    if (!closedStatus) throw new ValidationError('No closed status configured');

    return update(ticketId, { status_id: closedStatus.id }, { staffId, username });
  };

  /**
   * Merge a source ticket into a target ticket.
   *
   * Thread entries and collaborators are moved from source to target.
   * The source ticket is closed.
   *
   * @param {number|string} sourceTicketId - Ticket to merge from (will be closed)
   * @param {Object} params
   * @param {number|string} params.targetTicketId - Ticket to merge into
   * @param {number|null} [params.staffId] - Staff performing the merge
   * @param {string} [params.username] - Username for event log
   * @returns {Promise<{ target_ticket_id: number }>}
   * @throws {NotFoundError} If either ticket does not exist
   * @throws {ValidationError} If merging a ticket into itself
   *
   * @example
   * await tickets.merge(10, { targetTicketId: 20, staffId: 1, username: 'admin' });
   */
  const merge = async (sourceTicketId, { targetTicketId, staffId = null, username = '' }) => {
    if (!targetTicketId) throw new ValidationError('targetTicketId is required');
    if (parseInt(sourceTicketId, 10) === parseInt(targetTicketId, 10)) {
      throw new ValidationError('Cannot merge a ticket into itself');
    }

    // Validate both tickets (reads outside transaction)
    const sourceTicket = await conn.queryOne(`
      SELECT t.ticket_id, t.number, th.id as thread_id FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [sourceTicketId]);
    if (!sourceTicket) throw new NotFoundError('Source ticket not found');

    const targetTicket = await conn.queryOne(`
      SELECT t.ticket_id, t.number, th.id as thread_id FROM ${conn.table('ticket')} t
      LEFT JOIN ${conn.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [targetTicketId]);
    if (!targetTicket) throw new NotFoundError('Target ticket not found');

    const now = new Date();

    await conn.transaction(async (txQuery, txQueryOne) => {
      // Move thread entries and collaborators
      if (sourceTicket.thread_id && targetTicket.thread_id) {
        await txQuery(
          `UPDATE ${conn.table('thread_entry')} SET thread_id = ? WHERE thread_id = ?`,
          [targetTicket.thread_id, sourceTicket.thread_id],
        );
        await txQuery(
          `UPDATE ${conn.table('thread_collaborator')} SET thread_id = ? WHERE thread_id = ?`,
          [targetTicket.thread_id, sourceTicket.thread_id],
        );
      }

      // Close source
      const closedStatus = await txQueryOne(
        `SELECT id FROM ${conn.table('ticket_status')} WHERE state = 'closed' ORDER BY sort ASC LIMIT 1`
      );
      if (closedStatus) {
        await txQuery(
          `UPDATE ${conn.table('ticket')} SET status_id = ?, closed = ?, updated = ? WHERE ticket_id = ?`,
          [closedStatus.id, now, now, sourceTicketId],
        );
      }

      // Log events on both tickets
      if (targetTicket.thread_id) {
        await logEvent(targetTicket.thread_id, 'merged', staffId, username, {
          merged_from: sourceTicket.number, source_ticket_id: parseInt(sourceTicketId, 10),
        }, txQuery, txQueryOne);
      }
      if (sourceTicket.thread_id) {
        await logEvent(sourceTicket.thread_id, 'merged', staffId, username, {
          merged_into: targetTicket.number, target_ticket_id: parseInt(targetTicketId, 10),
        }, txQuery, txQueryOne);
      }
    });

    return { target_ticket_id: parseInt(targetTicketId, 10) };
  };

  return {
    list,
    get,
    getThread,
    getEvents,
    create,
    update,
    reply,
    addNote,
    close,
    merge,
  };
};
