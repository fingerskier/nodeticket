/**
 * Ticket Controller — thin HTTP adapter delegating to SDK
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

/**
 * List tickets
 */
const list = async (req, res) => {
  const filters = { ...req.query };

  // User access restriction — HTTP-layer concern
  if (req.auth?.type === 'user') {
    filters.user_id = req.auth.id;
  }

  const result = await getSdk().tickets.list(filters);

  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get ticket details
 */
const get = async (req, res) => {
  const data = await getSdk().tickets.get(req.params.id);
  res.json({ success: true, data });
};

/**
 * Get ticket thread entries
 */
const getThread = async (req, res) => {
  const result = await getSdk().tickets.getThread(req.params.id, req.query);
  res.json({ success: true, data: result.data, pagination: result.pagination });
};

/**
 * Get ticket events
 */
const getEvents = async (req, res) => {
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

  const data = await getSdk().tickets.create({
    userId,
    topicId: req.body.topic_id,
    subject: req.body.subject,
    body: req.body.message,
    source: 'Web',
  });

  res.status(201).json({ success: true, message: 'Ticket created successfully', data });
};

/**
 * Update ticket
 */
const update = async (req, res) => {
  const { id } = req.params;
  const { status_id, staff_id, dept_id, team_id, topic_id, sla_id, duedate, isoverdue } = req.body;
  const isStaff = req.auth?.type === 'staff' || req.auth?.type === 'apikey';

  // Users can only close their own tickets — HTTP-layer access control
  if (!isStaff) {
    if (status_id === undefined) {
      throw ApiError.forbidden('Users can only update ticket status');
    }
    // Delegate close to the SDK (it finds closed status)
    const data = await getSdk().tickets.close(id, {
      staffId: null,
      username: req.auth?.name || '',
    });
    return res.json({ success: true, message: 'Ticket updated', data });
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

  const staffId = req.auth?.type === 'staff' ? req.auth.id : null;
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
  const isStaff = req.auth?.type === 'staff' || req.auth?.type === 'apikey';
  const poster = req.auth?.name || req.auth?.username || (isStaff ? 'Staff' : 'User');

  const data = await getSdk().tickets.reply(id, {
    staffId: isStaff ? (req.auth?.id || 0) : null,
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

  const data = await getSdk().tickets.addNote(id, {
    staffId: req.auth?.id || 0,
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
  const staffId = req.auth?.id || 0;
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
};
