/**
 * Ticket Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');
const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');
const { applyFilters } = require('./filterController');
const { publicTicketDetail } = require('../lib/authz');

/**
 * List tickets
 */
const list = async (req, res) => {
  const filters = { ...req.query };

  // User access restriction — HTTP-layer concern
  if (req.auth?.type === 'user') {
    filters.user_id = req.auth.id;
  }

  // Staff department / assignment visibility
  if (req.auth?.type === 'staff') {
    filters.staff_scope = req.auth;
  }

  // API keys cannot list native tickets
  if (req.auth?.type === 'apikey') {
    throw ApiError.forbidden('Access denied');
  }

  const result = await getSdk().tickets.list(filters);

  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get ticket details
 */
const get = async (req, res) => {
  let data = await getSdk().tickets.get(req.params.id);
  if (req.auth?.type === 'user') {
    data = publicTicketDetail(data);
  }
  res.json({ success: true, data });
};

/**
 * Get ticket thread entries
 */
const getThread = async (req, res) => {
  const publicOnly = req.auth?.type === 'user';
  const result = await getSdk().tickets.getThread(req.params.id, {
    ...req.query,
    publicOnly,
  });
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get ticket events — staff only (internal audit stream)
 */
const getEvents = async (req, res) => {
  if (req.auth?.type !== 'staff') {
    throw ApiError.forbidden('Staff access required');
  }
  const data = await getSdk().tickets.getEvents(req.params.id);
  res.json({ success: true, data });
};

/**
 * Create ticket
 */
const create = async (req, res) => {
  const userId = req.auth?.id;
  const userType = req.auth?.type;

  if (!userId || userType !== 'user') {
    throw ApiError.forbidden('Only users can create tickets');
  }

  const sdk = getSdk();
  const conn = sdk.connection;

  // Load topic defaults so filter can see/override them
  // Use flags/ispublic (osTicket v1.18) — not nonexistent isactive column
  const topic = await conn.queryOne(
    `SELECT ht.topic_id, ht.dept_id, ht.priority_id, ht.sla_id
     FROM ${conn.table('help_topic')} ht WHERE ht.topic_id = ?`,
    [req.body.topic_id]
  );

  // Load user email for filter evaluation
  let userEmail = req.auth?.email || '';
  if (!userEmail) {
    const ue = await conn.queryOne(
      `SELECT ue.address FROM ${conn.table('user')} u
       LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
       WHERE u.id = ?`, [userId]
    );
    userEmail = ue?.address || '';
  }

  const ticketData = {
    subject: req.body.subject,
    body: req.body.message,
    email: userEmail,
    dept_id: topic?.dept_id || 0,
    topic_id: req.body.topic_id,
    priority_id: topic?.priority_id || 0,
    source: 'Web',
  };

  // Run filter engine — reject or collect field updates
  const filterResult = await applyFilters(ticketData);
  if (filterResult?._rejected) {
    throw ApiError.badRequest(filterResult._rejectMessage || 'Rejected by filter');
  }

  const data = await sdk.tickets.create({
    userId,
    topicId: req.body.topic_id,
    subject: req.body.subject,
    body: req.body.message,
    source: 'Web',
  });

  // Apply any non-reject filter field updates (only known ticket columns)
  const allowedFilterCols = new Set([
    'dept_id', 'topic_id', 'sla_id', 'staff_id', 'team_id', 'status_id', 'duedate', 'isoverdue',
  ]);
  const updateFields = {};
  for (const [k, v] of Object.entries(filterResult || {})) {
    if (!k.startsWith('_') && allowedFilterCols.has(k)) updateFields[k] = v;
  }
  if (Object.keys(updateFields).length > 0) {
    const cols = [];
    const args = [];
    for (const [col, val] of Object.entries(updateFields)) {
      cols.push(`${col} = ?`); args.push(val);
    }
    args.push(data.ticket_id);
    await db.query(`UPDATE ${db.table('ticket')} SET ${cols.join(', ')}, updated = NOW() WHERE ticket_id = ?`, args);
  }

  res.status(201).json({ success: true, message: 'Ticket created successfully', data });
};

/**
 * Update ticket
 *
 * Customers: only named actions close | reopen (never arbitrary status_id).
 * Staff: field updates as before.
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { status_id, staff_id, dept_id, team_id, topic_id, sla_id, duedate, isoverdue, action } = req.body;
  const isStaff = req.auth?.type === 'staff';

  // Users — named close/reopen only
  if (!isStaff) {
    if (req.auth?.type !== 'user') {
      throw ApiError.forbidden('Access denied');
    }

    const named = action === 'close' || action === 'reopen'
      ? action
      : null;

    // Reject bare status_id without action to prevent reopen-as-close bugs
    if (!named) {
      throw ApiError.badRequest('Users must specify action: "close" or "reopen"');
    }

    const username = req.auth?.name || '';
    if (named === 'close') {
      const data = await getSdk().tickets.close(id, { staffId: null, username });
      return res.json({ success: true, message: 'Ticket closed', data });
    }

    const data = await getSdk().tickets.reopen(id, { staffId: null, username });
    return res.json({ success: true, message: 'Ticket reopened', data });
  }

  const changes = {};
  if (status_id !== undefined) changes.status_id = status_id;
  if (staff_id !== undefined) changes.staff_id = staff_id;
  if (dept_id !== undefined) changes.dept_id = dept_id;
  if (team_id !== undefined) changes.team_id = team_id;
  if (topic_id !== undefined) changes.topic_id = topic_id;
  if (sla_id !== undefined) changes.sla_id = sla_id;
  if (duedate !== undefined) changes.duedate = duedate;
  if (isoverdue !== undefined) changes.isoverdue = isoverdue;

  // Named staff actions
  if (action === 'close') {
    const data = await getSdk().tickets.close(id, {
      staffId: req.auth.id,
      username: req.auth?.name || req.auth?.username || '',
    });
    return res.json({ success: true, message: 'Ticket closed', data });
  }
  if (action === 'reopen') {
    const data = await getSdk().tickets.reopen(id, {
      staffId: req.auth.id,
      username: req.auth?.name || req.auth?.username || '',
    });
    return res.json({ success: true, message: 'Ticket reopened', data });
  }

  const staffId = req.auth.id;
  const username = req.auth?.name || req.auth?.username || '';

  const data = await getSdk().tickets.update(id, changes, { staffId, username });
  res.json({ success: true, message: 'Ticket updated', data });
};

/**
 * Reply to ticket
 */
const reply = async (req, res) => {
  const { id } = req.params;
  const { message, format } = req.body;
  const isStaff = req.auth?.type === 'staff';
  const poster = req.auth?.name || req.auth?.username || (isStaff ? 'Staff' : 'User');

  const data = await getSdk().tickets.reply(id, {
    staffId: isStaff ? req.auth.id : null,
    userId: !isStaff ? req.auth?.id : null,
    body: message,
    format: format || 'text',
    poster,
    source: 'API',
  });

  res.status(201).json({ success: true, message: 'Reply added', data });
};

/**
 * Add internal note to ticket (staff only)
 */
const addNote = async (req, res) => {
  const { id } = req.params;
  const { title, note } = req.body;
  const poster = req.auth?.name || req.auth?.username || 'Staff';

  if (req.auth?.type !== 'staff') {
    throw ApiError.forbidden('Staff access required');
  }

  const data = await getSdk().tickets.addNote(id, {
    staffId: req.auth.id,
    title,
    body: note,
    poster,
  });

  res.status(201).json({ success: true, message: 'Note added', data });
};

/**
 * Merge duplicate tickets (staff only)
 */
const merge = async (req, res) => {
  const { id } = req.params;
  const { target_ticket_id } = req.body;

  if (req.auth?.type !== 'staff') {
    throw ApiError.forbidden('Staff access required');
  }

  const staffId = req.auth.id;
  const username = req.auth?.name || req.auth?.username || 'Staff';

  const data = await getSdk().tickets.merge(id, {
    targetTicketId: target_ticket_id,
    staffId,
    username,
  });

  res.json({ success: true, message: 'Tickets merged', data });
};

/**
 * Create ticket - legacy interoperability format
 */
const createLegacy = async (req, res) => {
  throw ApiError.badRequest('Write operations not yet implemented');
};

/**
 * Bulk action on tickets (admin): assign, close, delete. Max 100 tickets per call.
 */
const bulkAction = async (req, res) => {
  const { action, ticketIds, data } = req.body;

  if (!action || !['assign', 'close', 'delete'].includes(action)) {
    throw ApiError.badRequest('Invalid action. Must be: assign, close, delete');
  }
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    throw ApiError.badRequest('No tickets selected');
  }
  if (ticketIds.length > 100) {
    throw ApiError.badRequest('Maximum 100 tickets per bulk operation');
  }

  const ids = ticketIds.map(i => parseInt(i, 10)).filter(n => !isNaN(n));
  if (ids.length !== ticketIds.length) throw ApiError.badRequest('Invalid ticket ID');

  const staffId = req.auth?.id;
  const staffName = req.auth?.name || 'System';

  await db.transaction(async (txQuery, txQueryOne) => {
    const placeholders = ids.map(() => '?').join(',');

    if (action === 'assign') {
      if (!data?.staff_id && !data?.team_id) {
        throw ApiError.badRequest('Must specify staff_id or team_id for assign');
      }
      const updates = [];
      const params = [];
      if (data.staff_id) { updates.push('staff_id = ?'); params.push(data.staff_id); }
      if (data.team_id) { updates.push('team_id = ?'); params.push(data.team_id); }
      updates.push('updated = ?');
      params.push(new Date());

      await txQuery(
        `UPDATE ${db.table('ticket')} SET ${updates.join(', ')} WHERE ticket_id IN (${placeholders})`,
        [...params, ...ids]
      );
    }

    if (action === 'close') {
      const closedStatus = await txQueryOne(
        `SELECT id FROM ${db.table('ticket_status')} WHERE state = 'closed' LIMIT 1`
      );
      if (!closedStatus) throw ApiError.badRequest('No closed status defined');
      const now = new Date();
      await txQuery(
        `UPDATE ${db.table('ticket')} SET status_id = ?, closed = ?, updated = ? WHERE ticket_id IN (${placeholders})`,
        [closedStatus.id, now, now, ...ids]
      );
    }

    if (action === 'delete') {
      const deletedStatus = await txQueryOne(
        `SELECT id FROM ${db.table('ticket_status')} WHERE state = 'deleted' LIMIT 1`
      );
      if (!deletedStatus) throw ApiError.badRequest('No deleted status defined');
      await txQuery(
        `UPDATE ${db.table('ticket')} SET status_id = ?, updated = ? WHERE ticket_id IN (${placeholders})`,
        [deletedStatus.id, new Date(), ...ids]
      );
    }

    // Audit trail — batch insert thread_event rows
    const eventName = `bulk_${action}`;
    const event = await txQueryOne(
      `SELECT id FROM ${db.table('event')} WHERE name = ?`,
      [eventName]
    );

    if (event) {
      const threads = await txQuery(
        `SELECT id, object_id FROM ${db.table('thread')} WHERE object_id IN (${placeholders}) AND object_type = 'T'`,
        ids
      );

      if (threads.length > 0) {
        const now = new Date();
        const values = threads.map(() => `(?, ?, ?, ?, ?, 'S', ?)`).join(', ');
        const params = threads.flatMap(t => [t.id, event.id, staffId, staffName, staffId, now]);
        await txQuery(
          `INSERT INTO ${db.table('thread_event')} (thread_id, event_id, staff_id, username, uid, uid_type, timestamp) VALUES ${values}`,
          params
        );
      }
    }
  });

  res.json({ success: true, data: { affected: ids.length, action } });
};

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
  createLegacy,
  bulkAction,
};
