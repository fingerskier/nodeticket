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

module.exports = {
  list,
  get,
};
