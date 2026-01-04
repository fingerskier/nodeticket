/**
 * SLA Controller
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

// SLA Flags
const FLAGS = {
  ACTIVE: 1,
  ESCALATE: 2,
  NOALERTS: 4,
  TRANSIENT: 8
};

/**
 * List SLA plans
 */
const list = async (req, res) => {
  const slas = await db.query(`
    SELECT * FROM ${db.table('sla')}
    ORDER BY name
  `);

  res.json({
    success: true,
    data: slas.map(s => ({
      id: s.id,
      name: s.name,
      grace_period: s.grace_period,
      flags: s.flags,
      isActive: !!(s.flags & FLAGS.ACTIVE),
      escalate: !!(s.flags & FLAGS.ESCALATE),
      noAlerts: !!(s.flags & FLAGS.NOALERTS),
      isTransient: !!(s.flags & FLAGS.TRANSIENT),
      created: s.created,
      updated: s.updated
    }))
  });
};

/**
 * Get SLA details
 */
const get = async (req, res) => {
  const { id } = req.params;

  const sla = await db.queryOne(`
    SELECT * FROM ${db.table('sla')} WHERE id = ?
  `, [id]);

  if (!sla) {
    throw ApiError.notFound('SLA plan not found');
  }

  // Get usage statistics
  const ticketCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')} t
    JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    WHERE t.sla_id = ? AND ts.state = 'open'
  `, [id]);

  const deptCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('department')} WHERE sla_id = ?
  `, [id]);

  const topicCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('help_topic')} WHERE sla_id = ?
  `, [id]);

  res.json({
    success: true,
    data: {
      id: sla.id,
      name: sla.name,
      grace_period: sla.grace_period,
      flags: sla.flags,
      isActive: !!(sla.flags & FLAGS.ACTIVE),
      escalate: !!(sla.flags & FLAGS.ESCALATE),
      noAlerts: !!(sla.flags & FLAGS.NOALERTS),
      isTransient: !!(sla.flags & FLAGS.TRANSIENT),
      notes: sla.notes,
      usage: {
        openTickets: parseInt(ticketCount || 0, 10),
        departments: parseInt(deptCount || 0, 10),
        helpTopics: parseInt(topicCount || 0, 10)
      },
      created: sla.created,
      updated: sla.updated
    }
  });
};

module.exports = {
  list,
  get
};
