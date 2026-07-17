/**
 * Ticket lifecycle email notifications (templates + SES helper).
 * Failures are logged and never roll back ticket writes.
 * @module lib/ticketNotifications
 */

const config = require('../config');
const { sendEmail } = require('./email');

/**
 * Load an active email template by code_name from the Default (or first active) group.
 * @param {Object} conn
 * @param {string} codeName
 * @returns {Promise<{ subject: string, body: string }|null>}
 */
async function loadTemplate(conn, codeName) {
  try {
    const row = await conn.queryOne(
      `SELECT et.subject, et.body
       FROM ${conn.table('email_template')} et
       JOIN ${conn.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id
       WHERE et.code_name = ? AND etg.isactive = 1
       ORDER BY etg.tpl_id ASC
       LIMIT 1`,
      [codeName]
    );
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Replace {{placeholders}} in template strings.
 * @param {string} text
 * @param {Object} vars
 */
function render(text, vars = {}) {
  if (!text) return '';
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split('.');
    let cur = vars;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    return cur != null ? String(cur) : '';
  });
}

/**
 * Notify user that a ticket was created.
 */
async function notifyTicketCreated(conn, { ticket, userEmail, userName }) {
  if (!userEmail) return { sent: false, reason: 'no_email' };
  const tpl = await loadTemplate(conn, 'ticket.created');
  const vars = buildVars(ticket, { userName, userEmail });
  const subject = tpl ? render(tpl.subject, vars) : `Ticket #${ticket.number} created`;
  const body = tpl
    ? render(tpl.body, vars)
    : `<p>Hi ${userName || ''},</p><p>Your ticket #${ticket.number} was created.</p>`;
  try {
    const id = await sendEmail(userEmail, subject, body);
    return { sent: true, messageId: id };
  } catch (err) {
    console.error('notifyTicketCreated failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Notify user of a staff reply (or staff of a user message — optional).
 */
async function notifyTicketReply(conn, { ticket, userEmail, userName, isStaffReply }) {
  if (!userEmail) return { sent: false, reason: 'no_email' };
  // Only auto-notify the customer when staff replies (common helpdesk behavior)
  if (!isStaffReply) return { sent: false, reason: 'user_message' };

  const tpl = await loadTemplate(conn, 'ticket.reply');
  const vars = buildVars(ticket, { userName, userEmail });
  const subject = tpl ? render(tpl.subject, vars) : `Re: #${ticket.number} ${ticket.subject || ''}`;
  const body = tpl
    ? render(tpl.body, vars)
    : `<p>Hi ${userName || ''},</p><p>There is a new reply on ticket #${ticket.number}.</p>`;
  try {
    const id = await sendEmail(userEmail, subject, body);
    return { sent: true, messageId: id };
  } catch (err) {
    console.error('notifyTicketReply failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

function buildVars(ticket, { userName, userEmail }) {
  const baseUrl = (config.helpdesk.url || '').replace(/\/$/, '');
  return {
    user: { name: userName || '', email: userEmail || '' },
    staff: { name: ticket.staff_name || '' },
    ticket: {
      number: ticket.number || '',
      subject: ticket.subject || '',
      department: ticket.department || ticket.dept_name || '',
      status: ticket.status || 'open',
      url: `${baseUrl}/#?yg-app=ticket&id=${ticket.ticket_id || ''}`,
    },
  };
}

module.exports = {
  loadTemplate,
  render,
  notifyTicketCreated,
  notifyTicketReply,
};
