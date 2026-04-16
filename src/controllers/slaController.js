/**
 * SLA Controller — thin HTTP adapter using SDK data layer
 */

const { getSdk } = require('../lib/sdk');
const { ApiError } = require('../middleware/errorHandler');

// SLA Flags
const FLAGS = {
  ACTIVE: 1,
  ESCALATE: 2,
  NOALERTS: 4,
  TRANSIENT: 8,
};

/**
 * Format an SLA row for response
 */
const formatSla = (s) => ({
  id: s.id,
  name: s.name,
  grace_period: s.grace_period,
  flags: s.flags,
  isActive: !!(s.flags & FLAGS.ACTIVE),
  escalate: !!(s.flags & FLAGS.ESCALATE),
  noAlerts: !!(s.flags & FLAGS.NOALERTS),
  isTransient: !!(s.flags & FLAGS.TRANSIENT),
  created: s.created,
  updated: s.updated,
});

/**
 * List SLA plans
 */
const list = async (req, res) => {
  const slas = await getSdk().data.sla.find({ orderBy: 'name ASC' });
  res.json({ success: true, data: slas.map(formatSla) });
};

/**
 * Get SLA details
 */
const get = async (req, res) => {
  const { id } = req.params;
  const sdk = getSdk();

  const sla = await sdk.data.sla.findById(id);
  if (!sla) throw ApiError.notFound('SLA plan not found');

  // Get usage statistics via connection
  const conn = sdk.connection;
  const ticketCount = parseInt(
    await conn.queryValue(`
      SELECT COUNT(*) FROM ${conn.table('ticket')} t
      JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
      WHERE t.sla_id = ? AND ts.state = 'open'
    `, [id]) || 0, 10,
  );

  const deptCount = parseInt(
    await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('department')} WHERE sla_id = ?`, [id]) || 0, 10,
  );

  const topicCount = parseInt(
    await conn.queryValue(`SELECT COUNT(*) FROM ${conn.table('help_topic')} WHERE sla_id = ?`, [id]) || 0, 10,
  );

  res.json({
    success: true,
    data: {
      ...formatSla(sla),
      notes: sla.notes,
      usage: {
        openTickets: ticketCount,
        departments: deptCount,
        helpTopics: topicCount,
      },
    },
  });
};

/**
 * Create SLA plan (admin)
 */
const create = async (req, res) => {
  const sdk = getSdk();
  const { name, grace_period, flags, notes, schedule_id } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw ApiError.badRequest('SLA name is required');
  }
  if (name.length > 64) throw ApiError.badRequest('SLA name must be 64 chars or less');

  const gp = grace_period === undefined ? 24 : parseInt(grace_period, 10);
  if (isNaN(gp) || gp < 0) throw ApiError.badRequest('grace_period must be non-negative');

  const existing = await sdk.data.sla.find({ where: { name: name.trim() } });
  if (existing.length > 0) throw ApiError.conflict('SLA name already exists');

  const now = new Date();
  const result = await sdk.data.sla.create({
    name: name.trim(),
    grace_period: gp,
    flags: flags !== undefined ? flags : FLAGS.ACTIVE,
    schedule_id: schedule_id || 0,
    notes: notes || null,
    created: now,
    updated: now,
  });

  const created = await sdk.data.sla.findById(result.id);
  res.status(201).json({ success: true, data: formatSla(created) });
};

/**
 * Update SLA plan (admin)
 */
const update = async (req, res) => {
  const sdk = getSdk();
  const { id } = req.params;
  const existing = await sdk.data.sla.findById(id);
  if (!existing) throw ApiError.notFound('SLA plan not found');

  const { name, grace_period, flags, notes, schedule_id } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (!name.trim()) throw ApiError.badRequest('SLA name cannot be empty');
    if (name.length > 64) throw ApiError.badRequest('SLA name must be 64 chars or less');
    const dup = await sdk.data.sla.find({ where: { name: name.trim() } });
    if (dup.some(s => parseInt(s.id, 10) !== parseInt(id, 10))) {
      throw ApiError.conflict('SLA name already exists');
    }
    updates.name = name.trim();
  }

  if (grace_period !== undefined) {
    const gp = parseInt(grace_period, 10);
    if (isNaN(gp) || gp < 0) throw ApiError.badRequest('grace_period must be non-negative');
    updates.grace_period = gp;
  }

  if (flags !== undefined) updates.flags = flags;
  if (schedule_id !== undefined) updates.schedule_id = schedule_id;
  if (notes !== undefined) updates.notes = notes;

  if (Object.keys(updates).length === 0) throw ApiError.badRequest('No fields to update');
  updates.updated = new Date();

  await sdk.data.sla.update(id, updates);
  const updated = await sdk.data.sla.findById(id);
  res.json({ success: true, data: formatSla(updated) });
};

/**
 * Remove SLA plan (admin) — blocked if referenced
 */
const remove = async (req, res) => {
  const sdk = getSdk();
  const { id } = req.params;
  const existing = await sdk.data.sla.findById(id);
  if (!existing) throw ApiError.notFound('SLA plan not found');

  const conn = sdk.connection;
  const deptCount = parseInt(await conn.queryValue(
    `SELECT COUNT(*) FROM ${conn.table('department')} WHERE sla_id = ?`, [id]
  ) || 0, 10);
  if (deptCount > 0) throw ApiError.conflict(`Cannot delete — SLA referenced by ${deptCount} department(s)`);

  const topicCount = parseInt(await conn.queryValue(
    `SELECT COUNT(*) FROM ${conn.table('help_topic')} WHERE sla_id = ?`, [id]
  ) || 0, 10);
  if (topicCount > 0) throw ApiError.conflict(`Cannot delete — SLA referenced by ${topicCount} help topic(s)`);

  const ticketCount = parseInt(await conn.queryValue(
    `SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE sla_id = ?`, [id]
  ) || 0, 10);
  if (ticketCount > 0) throw ApiError.conflict(`Cannot delete — SLA referenced by ${ticketCount} ticket(s)`);

  await sdk.data.sla.remove(id);
  res.json({ success: true, message: 'SLA plan deleted' });
};

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  FLAGS,
};
