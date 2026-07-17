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
 * - Users: create for themselves (requireVerified on route)
 * - Staff: create on behalf of user_id (A4.4)
 */
const create = async (req, res) => {
  const authId = req.auth?.id;
  const userType = req.auth?.type;

  if (!authId || (userType !== 'user' && userType !== 'staff')) {
    throw ApiError.forbidden('Authentication required');
  }

  let userId = authId;
  let source = 'Web';
  let allowPrivateTopic = false;

  if (userType === 'staff') {
    const onBehalf = req.body.user_id != null ? parseInt(req.body.user_id, 10) : null;
    if (!onBehalf) {
      throw ApiError.badRequest('Staff must provide user_id when creating a ticket on behalf of a user');
    }
    userId = onBehalf;
    source = req.body.source || 'API';
    allowPrivateTopic = true;
  }

  const sdk = getSdk();
  const conn = sdk.connection;

  // Load topic defaults so filter can see/override them
  const topic = await conn.queryOne(
    `SELECT ht.topic_id, ht.dept_id, ht.priority_id, ht.sla_id
     FROM ${conn.table('help_topic')} ht WHERE ht.topic_id = ?`,
    [req.body.topic_id]
  );

  // Load owner email for filter evaluation + notifications
  let userEmail = userType === 'user' ? (req.auth?.email || '') : '';
  let userName = userType === 'user' ? (req.auth?.name || '') : '';
  if (!userEmail || !userName) {
    const ue = await conn.queryOne(
      `SELECT u.name, ue.address FROM ${conn.table('user')} u
       LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
       WHERE u.id = ?`, [userId]
    );
    userEmail = userEmail || ue?.address || '';
    userName = userName || ue?.name || '';
  }

  const ticketData = {
    subject: req.body.subject,
    body: req.body.message,
    email: userEmail,
    dept_id: topic?.dept_id || 0,
    topic_id: req.body.topic_id,
    priority_id: topic?.priority_id || 0,
    source,
  };

  const filterResult = await applyFilters(ticketData);
  if (filterResult?._rejected) {
    throw ApiError.badRequest(filterResult._rejectMessage || 'Rejected by filter');
  }

  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];

  const data = await sdk.tickets.create({
    userId,
    topicId: req.body.topic_id,
    subject: req.body.subject,
    body: req.body.message,
    source,
    allowPrivateTopic,
    poster: userName || undefined,
    attachments,
  });

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

  // Outbound auto-response (best-effort)
  let notification = null;
  try {
    const { notifyTicketCreated } = require('../lib/ticketNotifications');
    notification = await notifyTicketCreated(conn, {
      ticket: { ...data, subject: req.body.subject },
      userEmail,
      userName,
    });
  } catch (err) {
    notification = { sent: false, reason: err.message };
  }

  res.status(201).json({
    success: true,
    message: 'Ticket created successfully',
    data,
    notification,
  });
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
  const { message, format, attachments } = req.body;
  const isStaff = req.auth?.type === 'staff';
  const poster = req.auth?.name || req.auth?.username || (isStaff ? 'Staff' : 'User');
  const sdk = getSdk();

  const data = await sdk.tickets.reply(id, {
    staffId: isStaff ? req.auth.id : null,
    userId: !isStaff ? req.auth?.id : null,
    body: message,
    format: format || 'text',
    poster,
    source: 'API',
  });

  if (Array.isArray(attachments) && attachments.length > 0) {
    await sdk.tickets.addAttachments(id, { attachments, entryId: data.id });
  }

  // Notify customer on staff reply (best-effort)
  let notification = null;
  try {
    const conn = sdk.connection;
    const owner = await conn.queryOne(
      `SELECT u.name, ue.address as email, t.number, tc.subject
       FROM ${conn.table('ticket')} t
       JOIN ${conn.table('user')} u ON u.id = t.user_id
       LEFT JOIN ${conn.table('user_email')} ue ON u.default_email_id = ue.id
       LEFT JOIN ${conn.table('ticket__cdata')} tc ON tc.ticket_id = t.ticket_id
       WHERE t.ticket_id = ?`,
      [id]
    );
    if (owner) {
      const { notifyTicketReply } = require('../lib/ticketNotifications');
      notification = await notifyTicketReply(conn, {
        ticket: {
          ticket_id: id,
          number: owner.number,
          subject: owner.subject,
        },
        userEmail: owner.email,
        userName: owner.name,
        isStaffReply: isStaff,
      });
    }
  } catch (err) {
    notification = { sent: false, reason: err.message };
  }

  res.status(201).json({ success: true, message: 'Reply added', data, notification });
};

/**
 * List attachments on a ticket
 */
const listAttachments = async (req, res) => {
  const data = await getSdk().tickets.listAttachments(req.params.id);
  // Customers never see notes; attachment list already only on thread entries — OK
  res.json({ success: true, data });
};

/**
 * Download attachment file (must belong to this ticket)
 */
const downloadAttachment = async (req, res) => {
  const file = await getSdk().tickets.getAttachmentFile(req.params.id, req.params.fileId);
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', file.data.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${String(file.name).replace(/"/g, '')}"`
  );
  res.send(file.data);
};

/**
 * Upload attachments onto the latest (or given) thread entry
 */
const uploadAttachments = async (req, res) => {
  const { attachments, entry_id } = req.body || {};
  const data = await getSdk().tickets.addAttachments(req.params.id, {
    attachments,
    entryId: entry_id || null,
  });
  res.status(201).json({ success: true, data });
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

const {
  parseLegacyCreateBody,
  formatLegacyCreateError,
} = require('../lib/legacyTicketApi');
const { parseTicketXml } = require('../lib/legacyTicketXml');
const { parseTicketEmail } = require('../lib/legacyTicketEmail');

/**
 * Stock-compatible plain-text error for official API routes.
 */
function legacyError(res, status, message) {
  return res.status(status).type('text/plain').send(message);
}

/**
 * Shared official create kernel from a validated legacy payload.
 * @returns {Promise<{ number: string, ticket_id: number, entry_id?: number }>}
 */
async function createFromLegacyData(fields) {
  const {
    email,
    name,
    subject,
    message,
    topicId,
    source,
    ip,
    phone,
    notes,
    staffId,
    slaId,
    duedate,
    priorityId,
    attachments,
  } = fields;

  const sdk = getSdk();
  const conn = sdk.connection;

  let user = await conn.queryOne(
    `SELECT u.id, u.name, u.default_email_id, ue.address as email
     FROM ${conn.table('user_email')} ue
     JOIN ${conn.table('user')} u ON u.id = ue.user_id
     WHERE ue.address = ?`,
    [email]
  );

  if (!user) {
    user = await sdk.users.create({ name, email });
  }

  const ticketData = {
    subject,
    body: message,
    email,
    name,
    phone,
    notes,
    dept_id: 0,
    topic_id: topicId || 0,
    priority_id: priorityId || 0,
    source,
  };

  if (topicId) {
    const topic = await conn.queryOne(
      `SELECT topic_id, dept_id, priority_id, sla_id FROM ${conn.table('help_topic')} WHERE topic_id = ?`,
      [topicId]
    );
    if (topic) {
      ticketData.dept_id = topic.dept_id || 0;
      ticketData.priority_id = priorityId || topic.priority_id || 0;
    }
  }

  const filterResult = await applyFilters(ticketData);
  if (filterResult?._rejected) {
    const err = ApiError.forbidden(filterResult._rejectMessage || 'Rejected by filter');
    err.status = 403;
    throw err;
  }

  const allowedFilterCols = {
    dept_id: 'deptId',
    topic_id: 'topicId',
    sla_id: 'slaId',
    staff_id: 'staffId',
    team_id: 'teamId',
    status_id: 'statusId',
  };
  const overrides = {};
  for (const [col, key] of Object.entries(allowedFilterCols)) {
    if (filterResult && filterResult[col] != null) {
      overrides[key] = filterResult[col];
    }
  }

  if (staffId != null && overrides.staffId == null) overrides.staffId = staffId;
  if (slaId != null && overrides.slaId == null) overrides.slaId = slaId;
  if (duedate != null && overrides.duedate == null) overrides.duedate = duedate;
  if (topicId != null && overrides.topicId == null) overrides.topicId = topicId;

  return sdk.tickets.create({
    userId: user.id,
    topicId: overrides.topicId != null ? overrides.topicId : topicId,
    subject,
    body: message,
    source,
    ipAddress: ip,
    poster: name,
    allowPrivateTopic: true,
    deptId: overrides.deptId,
    staffId: overrides.staffId,
    teamId: overrides.teamId,
    slaId: overrides.slaId,
    statusId: overrides.statusId,
    duedate: overrides.duedate,
    attachments: attachments || [],
  });
}

function handleLegacyCreateError(res, err) {
  if (err instanceof ApiError) {
    return legacyError(res, err.status || 400, formatLegacyCreateError(err.message));
  }
  const { ValidationError, ConflictError } = require('../sdk/errors');
  if (err instanceof ValidationError || err instanceof ConflictError) {
    return legacyError(res, 400, formatLegacyCreateError(err.message));
  }
  console.error('legacy create error:', err);
  return legacyError(res, 500, formatLegacyCreateError(err.message || 'unknown error'));
}

/**
 * Official osTicket FOSS create — POST /api/tickets.json
 */
const createLegacy = async (req, res) => {
  const parsed = parseLegacyCreateBody(req.body || {}, { ip: req.ip });
  if (!parsed.ok) {
    return legacyError(res, parsed.status, parsed.message);
  }

  try {
    const data = await createFromLegacyData(parsed.data);
    res.status(201).type('text/plain').send(String(data.number));
  } catch (err) {
    return handleLegacyCreateError(res, err);
  }
};

/**
 * Official create — POST /api/tickets.xml
 * Body is raw XML (express.text).
 */
const createLegacyXml = async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : '';
  const xmlResult = parseTicketXml(raw);
  if (!xmlResult.ok) {
    return legacyError(res, 400, xmlResult.message || 'Invalid XML');
  }

  const parsed = parseLegacyCreateBody(xmlResult.data, { ip: req.ip });
  if (!parsed.ok) {
    return legacyError(res, parsed.status, parsed.message);
  }

  try {
    const data = await createFromLegacyData(parsed.data);
    res.status(201).type('text/plain').send(String(data.number));
  } catch (err) {
    return handleLegacyCreateError(res, err);
  }
};

/**
 * Record Message-ID on a thread entry for dedup / reply threading.
 */
async function recordEmailHeaders(conn, entryId, mid, headersText) {
  if (!entryId || !mid) return;
  try {
    await conn.query(
      `INSERT INTO ${conn.table('thread_entry_email')}
        (thread_entry_id, email_id, mid, headers)
       VALUES (?, NULL, ?, ?)`,
      [entryId, mid, headersText || null]
    );
  } catch (err) {
    // Non-fatal if table missing or duplicate mid unique index
    console.warn('thread_entry_email insert skipped:', err.message);
  }
}

/**
 * Official create/reply — POST /api/tickets.email
 * Body is raw MIME (express.text / raw).
 */
const createLegacyEmail = async (req, res) => {
  const raw = typeof req.body === 'string'
    ? req.body
    : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');

  const emailResult = parseTicketEmail(raw);
  if (!emailResult.ok) {
    return legacyError(res, 400, emailResult.message || 'Unable to read email request');
  }

  const mail = emailResult.data;
  const sdk = getSdk();
  const conn = sdk.connection;

  try {
    // Dedup by Message-ID
    if (mail.mid) {
      const seen = await conn.queryOne(
        `SELECT tee.mid, te.id as entry_id, th.object_id as ticket_id, t.number
         FROM ${conn.table('thread_entry_email')} tee
         JOIN ${conn.table('thread_entry')} te ON te.id = tee.thread_entry_id
         JOIN ${conn.table('thread')} th ON th.id = te.thread_id AND th.object_type = 'T'
         JOIN ${conn.table('ticket')} t ON t.ticket_id = th.object_id
         WHERE tee.mid = ?
         LIMIT 1`,
        [mail.mid]
      );
      if (seen?.number) {
        // Already processed — return existing ticket number (stock silent success path)
        return res.status(201).type('text/plain').send(String(seen.number));
      }
    }

    // Reply threading: In-Reply-To / References → existing thread
    const threadRefs = [mail.inReplyTo, ...(mail.references || [])].filter(Boolean);
    let replyTicket = null;
    for (const ref of threadRefs) {
      const hit = await conn.queryOne(
        `SELECT th.object_id as ticket_id, t.number, t.user_id
         FROM ${conn.table('thread_entry_email')} tee
         JOIN ${conn.table('thread_entry')} te ON te.id = tee.thread_entry_id
         JOIN ${conn.table('thread')} th ON th.id = te.thread_id AND th.object_type = 'T'
         JOIN ${conn.table('ticket')} t ON t.ticket_id = th.object_id
         WHERE tee.mid = ?
         LIMIT 1`,
        [ref]
      );
      if (hit) {
        replyTicket = hit;
        break;
      }
    }

    // Subject ticket number fallback
    if (!replyTicket && mail.ticketNumber) {
      const byNum = await conn.queryOne(
        `SELECT ticket_id, number, user_id FROM ${conn.table('ticket')} WHERE number = ? LIMIT 1`,
        [mail.ticketNumber]
      );
      if (byNum) replyTicket = byNum;
    }

    if (replyTicket) {
      let user = null;
      if (mail.email) {
        user = await conn.queryOne(
          `SELECT u.id FROM ${conn.table('user_email')} ue
           JOIN ${conn.table('user')} u ON u.id = ue.user_id
           WHERE ue.address = ?`,
          [mail.email]
        );
      }
      const reply = await sdk.tickets.reply(replyTicket.ticket_id || replyTicket.ticket_id, {
        userId: user?.id || replyTicket.user_id || null,
        body: mail.message,
        poster: mail.name || mail.email || 'Email User',
        source: 'Email',
        format: 'text',
      });

      await recordEmailHeaders(
        conn,
        reply.id,
        mail.mid,
        raw.slice(0, 4000)
      );

      return res.status(201).type('text/plain').send(String(replyTicket.number));
    }

    // New ticket from email
    const parsed = parseLegacyCreateBody(
      {
        email: mail.email,
        name: mail.name,
        subject: mail.subject,
        message: mail.message,
        source: 'Email',
        attachments: mail.attachments,
      },
      { ip: req.ip }
    );
    if (!parsed.ok) {
      return legacyError(res, parsed.status, parsed.message);
    }

    const data = await createFromLegacyData(parsed.data);
    await recordEmailHeaders(conn, data.entry_id, mail.mid, raw.slice(0, 4000));
    res.status(201).type('text/plain').send(String(data.number));
  } catch (err) {
    return handleLegacyCreateError(res, err);
  }
};

/**
 * Official cron — POST /api/tasks/cron
 * Auth: can_exec_cron. Success: HTTP 200 body "Completed"
 */
const runLegacyCron = async (req, res) => {
  try {
    const { runAllCronJobs } = require('../lib/cron');
    const sdk = getSdk();
    await runAllCronJobs(sdk.connection);
    res.status(200).type('text/plain').send('Completed');
  } catch (err) {
    console.error('legacy cron error:', err);
    res.status(500).type('text/plain').send(err.message || 'Cron failed');
  }
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
  listAttachments,
  downloadAttachment,
  uploadAttachments,
  createLegacy,
  createLegacyXml,
  createLegacyEmail,
  runLegacyCron,
  bulkAction,
};
