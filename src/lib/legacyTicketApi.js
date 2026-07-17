/**
 * Official osTicket FOSS HTTP create helpers (JSON path).
 * @module lib/legacyTicketApi
 */

/**
 * Parse and validate stock POST /api/tickets.json body.
 * @param {Object} body
 * @param {Object} [reqMeta] - { ip }
 * @returns {{ ok: true, data: Object } | { ok: false, status: number, message: string }}
 */
function parseLegacyCreateBody(body = {}, reqMeta = {}) {
  const email = (body.email || '').toString().trim();
  const name = (body.name || '').toString().trim();
  const subject = (body.subject || '').toString().trim();
  const message = (body.message || body.body || '').toString().trim();
  const topicId = body.topicId != null ? body.topicId : body.topic_id;
  const sourceRaw = (body.source || 'API').toString();
  const ip = (body.ip || reqMeta.ip || '').toString().substring(0, 64);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      status: 400,
      message: 'Unable to create new ticket : A valid email address is required',
    };
  }
  if (!name) {
    return {
      ok: false,
      status: 400,
      message: 'Unable to create new ticket : Name is required',
    };
  }
  if (!subject) {
    return {
      ok: false,
      status: 400,
      message: 'Unable to create new ticket : Subject is required',
    };
  }
  if (!message) {
    return {
      ok: false,
      status: 400,
      message: 'Unable to create new ticket : Message is required',
    };
  }

  const allowedSources = new Set(['Web', 'Email', 'Phone', 'API', 'Other']);
  const source = allowedSources.has(sourceRaw) ? sourceRaw : 'API';

  return {
    ok: true,
    data: {
      email,
      name,
      subject,
      message,
      topicId: topicId != null && topicId !== '' ? parseInt(topicId, 10) : null,
      source,
      ip,
      phone: body.phone != null ? String(body.phone) : null,
      notes: body.notes != null ? String(body.notes) : null,
      staffId: body.staffId != null ? body.staffId : body.staff_id,
      slaId: body.slaId != null ? body.slaId : body.sla_id,
      duedate: body.duedate != null ? body.duedate : body.due_date,
      priorityId: body.priorityId != null ? body.priorityId : body.priority_id,
      alert: body.alert !== undefined ? !!body.alert : true,
      autorespond: body.autorespond !== undefined ? !!body.autorespond : true,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
    },
  };
}

/**
 * Format stock-style error line.
 * @param {string} detail
 * @returns {string}
 */
function formatLegacyCreateError(detail) {
  return `Unable to create new ticket : ${detail}`;
}

module.exports = {
  parseLegacyCreateBody,
  formatLegacyCreateError,
};
