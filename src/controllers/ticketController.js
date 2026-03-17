/**
 * Ticket Controller
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Helper to build pagination
 */
const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * List tickets
 */
const list = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status, dept_id, staff_id, user_id, topic_id, priority_id, isoverdue, search, sort, order } = req.query;

  // Build query
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
  const params = [];

  // Apply filters
  if (status) {
    sql += ` AND ts.state = ?`;
    params.push(status);
  }

  if (dept_id) {
    sql += ` AND t.dept_id = ?`;
    params.push(dept_id);
  }

  if (staff_id) {
    sql += ` AND t.staff_id = ?`;
    params.push(staff_id);
  }

  if (user_id) {
    sql += ` AND t.user_id = ?`;
    params.push(user_id);
  }

  if (topic_id) {
    sql += ` AND t.topic_id = ?`;
    params.push(topic_id);
  }

  if (priority_id) {
    sql += ` AND ht.priority_id = ?`;
    params.push(priority_id);
  }

  if (isoverdue === 'true' || isoverdue === '1') {
    sql += ` AND t.isoverdue = 1`;
  }

  if (search) {
    sql += ` AND (t.number LIKE ? OR tc.subject LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  // User access restriction
  if (req.auth?.type === 'user') {
    sql += ` AND t.user_id = ?`;
    params.push(req.auth.id);
  }

  // Get total count
  const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
  const countResult = await db.queryOne(countSql, params);
  const total = parseInt(countResult?.count || 0, 10);

  // Add sorting
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

  // Add pagination
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const tickets = await db.query(sql, params);

  res.json({
    success: true,
    data: tickets.map(formatTicket),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get ticket details
 */
const get = async (req, res) => {
  const { id } = req.params;

  // Support lookup by ID or ticket number
  const whereClause = isNaN(id) ? 't.number = ?' : 't.ticket_id = ?';

  const ticket = await db.queryOne(`
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
    WHERE ${whereClause}
  `, [id]);

  if (!ticket) {
    throw ApiError.notFound('Ticket not found');
  }

  // Get collaborators
  const collaborators = await db.query(`
    SELECT tc.*, u.name, ue.address as email
    FROM ${db.table('thread_collaborator')} tc
    JOIN ${db.table('user')} u ON tc.user_id = u.id
    LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
    WHERE tc.thread_id = ?
  `, [ticket.thread_id]);

  res.json({
    success: true,
    data: formatTicketDetail(ticket, collaborators)
  });
};

/**
 * Get ticket thread entries
 */
const getThread = async (req, res) => {
  const { id } = req.params;
  const { page, limit, offset } = paginate(req.query);

  // Get thread ID
  const thread = await db.queryOne(`
    SELECT th.id FROM ${db.table('thread')} th
    JOIN ${db.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
    WHERE t.ticket_id = ?
  `, [id]);

  if (!thread) {
    throw ApiError.notFound('Ticket not found');
  }

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
    LIMIT ? OFFSET ?
  `, [thread.id, limit, offset]);

  const total = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('thread_entry')} WHERE thread_id = ?
  `, [thread.id]);

  res.json({
    success: true,
    data: entries.map(formatThreadEntry),
    pagination: {
      page,
      limit,
      total: parseInt(total || 0, 10),
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get ticket events
 */
const getEvents = async (req, res) => {
  const { id } = req.params;

  const thread = await db.queryOne(`
    SELECT th.id FROM ${db.table('thread')} th
    JOIN ${db.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
    WHERE t.ticket_id = ?
  `, [id]);

  if (!thread) {
    throw ApiError.notFound('Ticket not found');
  }

  const events = await db.query(`
    SELECT te.*, e.name as event_name
    FROM ${db.table('thread_event')} te
    LEFT JOIN ${db.table('event')} e ON te.event_id = e.id
    WHERE te.thread_id = ?
    ORDER BY te.timestamp DESC
  `, [thread.id]);

  res.json({
    success: true,
    data: events.map(e => ({
      id: e.id,
      thread_id: e.thread_id,
      event_id: e.event_id,
      event_name: e.event_name,
      staff_id: e.staff_id,
      username: e.username,
      data: e.data ? JSON.parse(e.data) : null,
      timestamp: e.timestamp
    }))
  });
};

/**
 * Create ticket
 */
const create = async (req, res) => {
  const { topic_id, subject, message } = req.body;

  // Validate required fields
  if (!topic_id) {
    throw ApiError.badRequest('Help topic is required');
  }
  if (!subject || !subject.trim()) {
    throw ApiError.badRequest('Subject is required');
  }
  if (!message || !message.trim()) {
    throw ApiError.badRequest('Message is required');
  }

  // Get user info from auth
  const userId = req.auth?.id;
  const userType = req.auth?.type;

  if (!userId || userType !== 'user') {
    throw ApiError.forbidden('Only users can create tickets');
  }

  // Verify topic exists and get its department/priority
  const topic = await db.queryOne(`
    SELECT ht.*, d.id as dept_id, d.name as dept_name
    FROM ${db.table('help_topic')} ht
    LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
    WHERE ht.topic_id = ? AND ht.isactive = 1 AND ht.ispublic = 1
  `, [topic_id]);

  if (!topic) {
    throw ApiError.badRequest('Invalid help topic');
  }

  // Generate ticket number
  const ticketNumber = generateTicketNumber();

  // Get default status (open)
  const defaultStatus = await db.queryOne(`
    SELECT id FROM ${db.table('ticket_status')}
    WHERE state = 'open' AND mode = 1
    ORDER BY sort ASC LIMIT 1
  `);

  if (!defaultStatus) {
    throw ApiError.serverError('Unable to find default ticket status');
  }

  // Get user's email
  const userEmail = await db.queryOne(`
    SELECT ue.address as email
    FROM ${db.table('user')} u
    LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
    WHERE u.id = ?
  `, [userId]);

  // Create the ticket
  const now = new Date();
  const ticketResult = await db.query(`
    INSERT INTO ${db.table('ticket')} (
      number, user_id, dept_id, topic_id, status_id, source,
      isoverdue, isanswered, duedate, est_duedate,
      created, updated
    ) VALUES (?, ?, ?, ?, ?, 'Web', 0, 0, NULL, NULL, ?, ?)
  `, [
    ticketNumber,
    userId,
    topic.dept_id,
    topic_id,
    defaultStatus.id,
    now,
    now
  ]);

  const ticketId = ticketResult.insertId;

  // Create ticket custom data (subject)
  await db.query(`
    INSERT INTO ${db.table('ticket__cdata')} (ticket_id, subject)
    VALUES (?, ?)
  `, [ticketId, subject.trim().substring(0, 255)]);

  // Create thread for the ticket
  const threadResult = await db.query(`
    INSERT INTO ${db.table('thread')} (
      object_id, object_type, lastmessage, created
    ) VALUES (?, 'T', ?, ?)
  `, [ticketId, now, now]);

  const threadId = threadResult.insertId;

  // Create thread entry (first message)
  await db.query(`
    INSERT INTO ${db.table('thread_entry')} (
      thread_id, user_id, type, poster, source, body, format, created
    ) VALUES (?, ?, 'M', ?, 'Web', ?, 'text', ?)
  `, [
    threadId,
    userId,
    req.auth?.name || userEmail?.email || 'User',
    message.trim(),
    now
  ]);

  // Return the created ticket
  res.status(201).json({
    success: true,
    message: 'Ticket created successfully',
    data: {
      ticket_id: ticketId,
      number: ticketNumber,
      subject: subject.trim(),
      status: 'open',
      department: topic.dept_name,
      created: now
    }
  });
};

/**
 * Generate a unique ticket number
 */
const generateTicketNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${timestamp}${random}`.substring(0, 11);
};

/**
 * Log a thread event
 */
const logEvent = async (threadId, eventName, staffId, username, data) => {
  const event = await db.queryOne(
    `SELECT id FROM ${db.table('event')} WHERE name = ?`, [eventName]
  );
  if (!event) return;

  await db.query(`
    INSERT INTO ${db.table('thread_event')}
    (thread_id, event_id, staff_id, username, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [threadId, event.id, staffId || 0, username || '', JSON.stringify(data), new Date()]);
};

/**
 * Get thread ID for a ticket
 */
const getThreadId = async (ticketId) => {
  const thread = await db.queryOne(`
    SELECT th.id FROM ${db.table('thread')} th
    JOIN ${db.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
    WHERE t.ticket_id = ?
  `, [ticketId]);
  return thread?.id;
};

/**
 * Update ticket
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { status_id, staff_id, dept_id, team_id, topic_id, sla_id, duedate, isoverdue } = req.body;

  // Fetch current ticket
  const ticket = await db.queryOne(
    `SELECT t.*, th.id as thread_id FROM ${db.table('ticket')} t
     LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
     WHERE t.ticket_id = ?`, [id]
  );
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isStaff = req.auth?.type === 'staff' || req.auth?.type === 'apikey';

  // Users can only close their own tickets
  if (!isStaff) {
    if (status_id === undefined) {
      throw ApiError.forbidden('Users can only update ticket status');
    }
    const newStatus = await db.queryOne(
      `SELECT id, state FROM ${db.table('ticket_status')} WHERE id = ?`, [status_id]
    );
    if (!newStatus || newStatus.state !== 'closed') {
      throw ApiError.forbidden('Users can only close their own tickets');
    }
  }

  const updates = [];
  const params = [];
  const staffId = req.auth?.type === 'staff' ? req.auth.id : null;
  const username = req.auth?.name || req.auth?.username || '';

  // Validate and build updates
  if (status_id !== undefined) {
    const status = await db.queryOne(
      `SELECT id, state FROM ${db.table('ticket_status')} WHERE id = ?`, [status_id]
    );
    if (!status) throw ApiError.badRequest('Invalid status_id');
    updates.push('status_id = ?'); params.push(status_id);

    if (status.state === 'closed') {
      updates.push('closed = ?'); params.push(new Date());
      if (ticket.thread_id) {
        await logEvent(ticket.thread_id, 'closed', staffId, username, { status_id });
      }
    } else if (ticket.status_id !== status_id) {
      // Check if reopening (was closed, now not)
      const oldStatus = await db.queryOne(
        `SELECT state FROM ${db.table('ticket_status')} WHERE id = ?`, [ticket.status_id]
      );
      if (oldStatus?.state === 'closed') {
        updates.push('closed = ?'); params.push(null);
        if (ticket.thread_id) {
          await logEvent(ticket.thread_id, 'reopened', staffId, username, { status_id });
        }
      }
    }
  }

  if (staff_id !== undefined && isStaff) {
    if (staff_id !== null) {
      const staff = await db.queryOne(
        `SELECT staff_id FROM ${db.table('staff')} WHERE staff_id = ?`, [staff_id]
      );
      if (!staff) throw ApiError.badRequest('Invalid staff_id');
    }
    updates.push('staff_id = ?'); params.push(staff_id);
    if (ticket.thread_id) {
      await logEvent(ticket.thread_id, 'assigned', staffId, username, { staff_id });
    }
  }

  if (dept_id !== undefined && isStaff) {
    const dept = await db.queryOne(
      `SELECT id FROM ${db.table('department')} WHERE id = ?`, [dept_id]
    );
    if (!dept) throw ApiError.badRequest('Invalid dept_id');
    updates.push('dept_id = ?'); params.push(dept_id);
    if (ticket.thread_id) {
      await logEvent(ticket.thread_id, 'transferred', staffId, username, { dept_id });
    }
  }

  if (team_id !== undefined && isStaff) {
    if (team_id !== null) {
      const team = await db.queryOne(
        `SELECT team_id FROM ${db.table('team')} WHERE team_id = ?`, [team_id]
      );
      if (!team) throw ApiError.badRequest('Invalid team_id');
    }
    updates.push('team_id = ?'); params.push(team_id);
    if (ticket.thread_id) {
      await logEvent(ticket.thread_id, 'assigned', staffId, username, { team_id });
    }
  }

  if (topic_id !== undefined && isStaff) {
    const topic = await db.queryOne(
      `SELECT topic_id FROM ${db.table('help_topic')} WHERE topic_id = ?`, [topic_id]
    );
    if (!topic) throw ApiError.badRequest('Invalid topic_id');
    updates.push('topic_id = ?'); params.push(topic_id);
  }

  if (sla_id !== undefined && isStaff) {
    if (sla_id !== null) {
      const sla = await db.queryOne(
        `SELECT id FROM ${db.table('sla')} WHERE id = ?`, [sla_id]
      );
      if (!sla) throw ApiError.badRequest('Invalid sla_id');
    }
    updates.push('sla_id = ?'); params.push(sla_id);
  }

  if (duedate !== undefined && isStaff) {
    updates.push('duedate = ?'); params.push(duedate);
  }

  if (isoverdue !== undefined && isStaff) {
    updates.push('isoverdue = ?'); params.push(isoverdue ? 1 : 0);
  }

  if (updates.length === 0) {
    throw ApiError.badRequest('No valid updates provided');
  }

  updates.push('updated = ?'); params.push(new Date());
  params.push(id);

  await db.query(
    `UPDATE ${db.table('ticket')} SET ${updates.join(', ')} WHERE ticket_id = ?`,
    params
  );

  // Log general edit event
  if (ticket.thread_id && !updates.some(u => u.startsWith('status_id') || u.startsWith('staff_id') || u.startsWith('dept_id') || u.startsWith('team_id'))) {
    await logEvent(ticket.thread_id, 'edited', staffId, username, req.body);
  }

  res.json({ success: true, message: 'Ticket updated', data: { ticket_id: parseInt(id, 10) } });
};

/**
 * Reply to ticket
 */
const reply = async (req, res) => {
  const { id } = req.params;
  const { message, format } = req.body;

  if (!message || !message.trim()) {
    throw ApiError.badRequest('Message is required');
  }

  const threadId = await getThreadId(id);
  if (!threadId) throw ApiError.notFound('Ticket not found');

  const isStaff = req.auth?.type === 'staff' || req.auth?.type === 'apikey';
  const now = new Date();

  const entryType = isStaff ? 'R' : 'M';
  const poster = req.auth?.name || req.auth?.username || (isStaff ? 'Staff' : 'User');
  const staffId = isStaff ? (req.auth?.id || 0) : null;
  const userId = !isStaff ? req.auth?.id : null;

  const result = await db.query(`
    INSERT INTO ${db.table('thread_entry')}
    (thread_id, staff_id, user_id, type, poster, source, body, format, created)
    VALUES (?, ?, ?, ?, ?, 'API', ?, ?, ?)
  `, [threadId, staffId || 0, userId || 0, entryType, poster, message.trim(), format || 'text', now]);

  // Update thread timestamps
  if (isStaff) {
    await db.query(
      `UPDATE ${db.table('thread')} SET lastresponse = ? WHERE id = ?`, [now, threadId]
    );
    // Mark ticket as answered
    await db.query(
      `UPDATE ${db.table('ticket')} SET isanswered = 1, updated = ? WHERE ticket_id = ?`, [now, id]
    );
  } else {
    await db.query(
      `UPDATE ${db.table('thread')} SET lastmessage = ? WHERE id = ?`, [now, threadId]
    );
    await db.query(
      `UPDATE ${db.table('ticket')} SET updated = ? WHERE ticket_id = ?`, [now, id]
    );
  }

  await logEvent(threadId, 'message', staffId, poster, { type: entryType });

  res.status(201).json({
    success: true,
    message: 'Reply added',
    data: {
      id: result.insertId,
      thread_id: threadId,
      type: entryType,
      poster,
      body: message.trim(),
      created: now
    }
  });
};

/**
 * Add internal note to ticket (staff only)
 */
const addNote = async (req, res) => {
  const { id } = req.params;
  const { title, note } = req.body;

  if (!note || !note.trim()) {
    throw ApiError.badRequest('Note content is required');
  }

  const threadId = await getThreadId(id);
  if (!threadId) throw ApiError.notFound('Ticket not found');

  const now = new Date();
  const staffId = req.auth?.id || 0;
  const poster = req.auth?.name || req.auth?.username || 'Staff';

  const result = await db.query(`
    INSERT INTO ${db.table('thread_entry')}
    (thread_id, staff_id, type, poster, title, source, body, format, created)
    VALUES (?, ?, 'N', ?, ?, 'API', ?, 'text', ?)
  `, [threadId, staffId, poster, title || null, note.trim(), now]);

  await db.query(
    `UPDATE ${db.table('ticket')} SET updated = ? WHERE ticket_id = ?`, [now, id]
  );

  await logEvent(threadId, 'note', staffId, poster, { title: title || null });

  res.status(201).json({
    success: true,
    message: 'Note added',
    data: {
      id: result.insertId,
      thread_id: threadId,
      type: 'N',
      poster,
      title: title || null,
      body: note.trim(),
      created: now
    }
  });
};

/**
 * Log a thread event using transaction-bound query functions
 */
const logEventTx = async (txQuery, txQueryOne, threadId, eventName, staffId, username, data) => {
  const event = await txQueryOne(
    `SELECT id FROM ${db.table('event')} WHERE name = ?`, [eventName]
  );
  if (!event) return;
  await txQuery(`
    INSERT INTO ${db.table('thread_event')}
    (thread_id, event_id, staff_id, username, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [threadId, event.id, staffId || 0, username || '', JSON.stringify(data), new Date()]);
};

/**
 * Merge duplicate tickets (staff only)
 */
const merge = async (req, res) => {
  const { id } = req.params;
  const { target_ticket_id } = req.body;

  if (!target_ticket_id) throw ApiError.badRequest('target_ticket_id is required');
  if (parseInt(id, 10) === parseInt(target_ticket_id, 10)) {
    throw ApiError.badRequest('Cannot merge a ticket into itself');
  }

  // Validate both tickets exist (outside transaction — read-only)
  const sourceTicket = await db.queryOne(
    `SELECT t.ticket_id, t.number, th.id as thread_id FROM ${db.table('ticket')} t
     LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
     WHERE t.ticket_id = ?`, [id]
  );
  if (!sourceTicket) throw ApiError.notFound('Source ticket not found');

  const targetTicket = await db.queryOne(
    `SELECT t.ticket_id, t.number, th.id as thread_id FROM ${db.table('ticket')} t
     LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
     WHERE t.ticket_id = ?`, [target_ticket_id]
  );
  if (!targetTicket) throw ApiError.notFound('Target ticket not found');

  const now = new Date();
  const staffId = req.auth?.id || 0;
  const username = req.auth?.name || req.auth?.username || 'Staff';

  await db.transaction(async (txQuery, txQueryOne) => {
    // Move thread entries from source to target
    if (sourceTicket.thread_id && targetTicket.thread_id) {
      await txQuery(
        `UPDATE ${db.table('thread_entry')} SET thread_id = ? WHERE thread_id = ?`,
        [targetTicket.thread_id, sourceTicket.thread_id]
      );

      // Move collaborators
      await txQuery(
        `UPDATE ${db.table('thread_collaborator')} SET thread_id = ? WHERE thread_id = ?`,
        [targetTicket.thread_id, sourceTicket.thread_id]
      );
    }

    // Close source ticket - find a closed status
    const closedStatus = await txQueryOne(
      `SELECT id FROM ${db.table('ticket_status')} WHERE state = 'closed' ORDER BY sort ASC LIMIT 1`
    );
    if (closedStatus) {
      await txQuery(
        `UPDATE ${db.table('ticket')} SET status_id = ?, closed = ?, updated = ? WHERE ticket_id = ?`,
        [closedStatus.id, now, now, id]
      );
    }

    // Log events
    if (targetTicket.thread_id) {
      await logEventTx(txQuery, txQueryOne, targetTicket.thread_id, 'merged', staffId, username, {
        merged_from: sourceTicket.number, source_ticket_id: parseInt(id, 10)
      });
    }
    if (sourceTicket.thread_id) {
      await logEventTx(txQuery, txQueryOne, sourceTicket.thread_id, 'merged', staffId, username, {
        merged_into: targetTicket.number, target_ticket_id: parseInt(target_ticket_id, 10)
      });
    }
  });

  res.json({
    success: true,
    message: `Ticket #${sourceTicket.number} merged into #${targetTicket.number}`,
    data: { target_ticket_id: parseInt(target_ticket_id, 10) }
  });
};

/**
 * Create ticket - legacy interoperability format
 */
const createLegacy = async (req, res) => {
  throw ApiError.badRequest('Write operations not yet implemented');
};

/**
 * Format ticket for list response
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
    state: t.status_state
  },
  dept_id: t.dept_id,
  department: {
    id: t.dept_id,
    name: t.dept_name
  },
  topic_id: t.topic_id,
  topic: t.topic_name ? {
    topic_id: t.topic_id,
    topic: t.topic_name
  } : null,
  priority: {
    priority_id: t.priority_id,
    priority: t.priority_name,
    priority_color: t.priority_color
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
  updated: t.updated
});

/**
 * Format ticket for detail response
 */
const formatTicketDetail = (t, collaborators) => ({
  ...formatTicket(t),
  user: {
    id: t.user_id,
    name: t.user_name,
    email: t.user_email
  },
  staff: t.staff_id ? {
    staff_id: t.staff_id,
    name: `${t.firstname || ''} ${t.lastname || ''}`.trim(),
    email: t.staff_email
  } : null,
  team: t.team_id ? {
    team_id: t.team_id,
    name: t.team_name
  } : null,
  sla: t.sla_id ? {
    id: t.sla_id,
    name: t.sla_name,
    grace_period: t.grace_period
  } : null,
  priority: {
    priority_id: t.priority_id,
    priority: t.priority_name,
    priority_color: t.priority_color,
    priority_urgency: t.priority_urgency
  },
  thread: {
    id: t.thread_id,
    lastresponse: t.lastresponse,
    lastmessage: t.lastmessage
  },
  collaborators: collaborators.map(c => ({
    id: c.id,
    user_id: c.user_id,
    name: c.name,
    email: c.email,
    role: c.role
  }))
});

/**
 * Format thread entry
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
  created: e.created
});

module.exports = {
  list,
  get,
  getThread,
  getEvents,
  create,
  update,
  reply,
  addNote,
  merge,
  createLegacy
};
