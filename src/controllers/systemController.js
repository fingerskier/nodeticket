/**
 * System Controller
 */

const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Get system configuration
 */
const getConfig = async (req, res) => {
  // Only return relevant config items
  const configItems = await db.query(`
    SELECT \`key\`, value FROM ${db.table('config')}
    WHERE namespace = 'core' AND \`key\` IN (
      'helpdesk_url', 'helpdesk_title', 'default_dept_id',
      'default_sla_id', 'default_priority_id', 'default_template_id',
      'enable_kb', 'enable_captcha', 'max_file_size',
      'allowed_filetypes', 'ticket_autolock', 'auto_claim_tickets'
    )
  `);

  const config = {};
  configItems.forEach(item => {
    config[item.key] = item.value;
  });

  res.json({
    success: true,
    data: {
      helpdesk_url: config.helpdesk_url,
      helpdesk_title: config.helpdesk_title,
      default_dept_id: parseInt(config.default_dept_id, 10) || null,
      default_sla_id: parseInt(config.default_sla_id, 10) || null,
      default_priority_id: parseInt(config.default_priority_id, 10) || null,
      enable_kb: config.enable_kb === '1',
      enable_captcha: config.enable_captcha === '1',
      max_file_size: parseInt(config.max_file_size, 10) || 1048576,
      allowed_filetypes: config.allowed_filetypes || '',
      auto_claim_tickets: config.auto_claim_tickets === '1'
    }
  });
};

/**
 * Get system statistics
 */
const getStats = async (req, res) => {
  // Ticket stats
  const ticketStats = await db.queryOne(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN ts.state = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN ts.state = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN t.isoverdue = 1 AND ts.state = 'open' THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN t.staff_id = 0 AND ts.state = 'open' THEN 1 ELSE 0 END) as unassigned
    FROM ${db.table('ticket')} t
    JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
  `);

  // User count
  const userCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('user')}
  `);

  // Staff count
  const staffCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('staff')} WHERE isactive = 1
  `);

  // Department count
  const deptCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('department')}
  `);

  // Team count
  const teamCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('team')}
  `);

  // Organization count
  const orgCount = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('organization')}
  `);

  // Today's tickets
  const todayTickets = await db.queryValue(`
    SELECT COUNT(*) FROM ${db.table('ticket')}
    WHERE DATE(created) = CURDATE()
  `);

  res.json({
    success: true,
    data: {
      tickets: {
        total: parseInt(ticketStats?.total || 0, 10),
        open: parseInt(ticketStats?.open || 0, 10),
        closed: parseInt(ticketStats?.closed || 0, 10),
        overdue: parseInt(ticketStats?.overdue || 0, 10),
        unassigned: parseInt(ticketStats?.unassigned || 0, 10),
        today: parseInt(todayTickets || 0, 10)
      },
      users: parseInt(userCount || 0, 10),
      staff: parseInt(staffCount || 0, 10),
      departments: parseInt(deptCount || 0, 10),
      teams: parseInt(teamCount || 0, 10),
      organizations: parseInt(orgCount || 0, 10)
    }
  });
};

/**
 * List ticket priorities
 */
const listPriorities = async (req, res) => {
  let sql = `SELECT * FROM ${db.table('ticket_priority')} WHERE 1=1`;
  const params = [];

  // Non-staff only see public priorities
  if (!req.auth || req.auth.type === 'user') {
    sql += ` AND ispublic = 1`;
  }

  sql += ` ORDER BY priority_urgency DESC`;

  const priorities = await db.query(sql, params);

  res.json({
    success: true,
    data: priorities.map(p => ({
      priority_id: p.priority_id,
      priority: p.priority,
      priority_desc: p.priority_desc,
      priority_color: p.priority_color,
      priority_urgency: p.priority_urgency,
      ispublic: !!p.ispublic
    }))
  });
};

/**
 * List ticket statuses
 */
const listStatuses = async (req, res) => {
  const statuses = await db.query(`
    SELECT * FROM ${db.table('ticket_status')}
    ORDER BY sort
  `);

  res.json({
    success: true,
    data: statuses.map(s => ({
      id: s.id,
      name: s.name,
      state: s.state,
      flags: s.flags,
      sort: s.sort,
      properties: s.properties ? JSON.parse(s.properties) : null
    }))
  });
};

/**
 * Run cron tasks
 */
const runCron = async (req, res) => {
  // Check permission for API key
  if (req.auth?.type === 'apikey') {
    if (!req.auth.permissions.can_exec_cron) {
      throw ApiError.forbidden('API key does not have cron permission');
    }
  } else if (!req.auth?.isAdmin) {
    throw ApiError.forbidden('Administrator access required');
  }

  // Placeholder for cron execution
  // TODO: Implement actual cron tasks
  const tasks = [
    { name: 'MailFetcher', status: 'skipped', message: 'Not implemented' },
    { name: 'TicketMonitor', status: 'skipped', message: 'Not implemented' },
    { name: 'CleanExpiredSessions', status: 'skipped', message: 'Not implemented' }
  ];

  res.json({
    success: true,
    message: 'Cron execution completed',
    tasks
  });
};

module.exports = {
  getConfig,
  getStats,
  listPriorities,
  listStatuses,
  runCron
};
