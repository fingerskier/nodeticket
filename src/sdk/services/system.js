/**
 * System Service — configuration, statistics, and reference data
 * @module sdk/services/system
 */

/**
 * @param {import('../connection')} conn
 * @param {Object} data - Full data layer
 * @returns {Object} System service methods
 */
module.exports = (conn, data) => {
  /**
   * Read core configuration keys from the config table.
   *
   * @returns {Promise<Object>} Parsed configuration object
   *
   * @example
   * const config = await system.getConfig();
   * // config.helpdesk_title, config.default_dept_id, etc.
   */
  const getConfig = async () => {
    const configItems = await conn.query(`
      SELECT \`key\`, value FROM ${conn.table('config')}
      WHERE namespace = 'core' AND \`key\` IN (
        'helpdesk_url', 'helpdesk_title', 'default_dept_id',
        'default_sla_id', 'default_priority_id', 'default_template_id',
        'enable_kb', 'enable_captcha', 'max_file_size',
        'allowed_filetypes', 'ticket_autolock', 'auto_claim_tickets'
      )
    `);

    const raw = {};
    configItems.forEach((item) => { raw[item.key] = item.value; });

    return {
      helpdesk_url: raw.helpdesk_url,
      helpdesk_title: raw.helpdesk_title,
      default_dept_id: parseInt(raw.default_dept_id, 10) || null,
      default_sla_id: parseInt(raw.default_sla_id, 10) || null,
      default_priority_id: parseInt(raw.default_priority_id, 10) || null,
      enable_kb: raw.enable_kb === '1',
      enable_captcha: raw.enable_captcha === '1',
      max_file_size: parseInt(raw.max_file_size, 10) || 1048576,
      allowed_filetypes: raw.allowed_filetypes || '',
      auto_claim_tickets: raw.auto_claim_tickets === '1',
    };
  };

  /**
   * Get aggregate system statistics.
   *
   * @returns {Promise<Object>} Stats object with ticket breakdown, user/staff/dept/team/org counts
   *
   * @example
   * const stats = await system.getStats();
   * // stats.tickets.open, stats.users, stats.staff, etc.
   */
  const getStats = async () => {
    const ticketStats = await conn.queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ts.state = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN ts.state = 'closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN t.isoverdue = 1 AND ts.state = 'open' THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN t.staff_id = 0 AND ts.state = 'open' THEN 1 ELSE 0 END) as unassigned
      FROM ${conn.table('ticket')} t
      JOIN ${conn.table('ticket_status')} ts ON t.status_id = ts.id
    `);

    const userCount = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('user')}`
    );
    const staffCount = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('staff')} WHERE isactive = 1`
    );
    const deptCount = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('department')}`
    );
    const teamCount = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('team')}`
    );
    const orgCount = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('organization')}`
    );
    const todayTickets = await conn.queryValue(
      `SELECT COUNT(*) FROM ${conn.table('ticket')} WHERE DATE(created) = CURDATE()`
    );

    return {
      tickets: {
        total: parseInt(ticketStats?.total || 0, 10),
        open: parseInt(ticketStats?.open || 0, 10),
        closed: parseInt(ticketStats?.closed || 0, 10),
        overdue: parseInt(ticketStats?.overdue || 0, 10),
        unassigned: parseInt(ticketStats?.unassigned || 0, 10),
        today: parseInt(todayTickets || 0, 10),
      },
      users: parseInt(userCount || 0, 10),
      staff: parseInt(staffCount || 0, 10),
      departments: parseInt(deptCount || 0, 10),
      teams: parseInt(teamCount || 0, 10),
      organizations: parseInt(orgCount || 0, 10),
    };
  };

  /**
   * List ticket priorities.
   *
   * @param {Object} [options={}]
   * @param {boolean} [options.publicOnly=false] - Only return public priorities
   * @returns {Promise<Array<Object>>} Priority list sorted by urgency descending
   *
   * @example
   * const priorities = await system.listPriorities({ publicOnly: true });
   */
  const listPriorities = async ({ publicOnly = false } = {}) => {
    let sql = `SELECT * FROM ${conn.table('ticket_priority')} WHERE 1=1`;
    const params = [];

    if (publicOnly) {
      sql += ` AND ispublic = 1`;
    }

    sql += ` ORDER BY priority_urgency DESC`;

    const priorities = await conn.query(sql, params);

    return priorities.map((p) => ({
      priority_id: p.priority_id,
      priority: p.priority,
      priority_desc: p.priority_desc,
      priority_color: p.priority_color,
      priority_urgency: p.priority_urgency,
      ispublic: !!p.ispublic,
    }));
  };

  /**
   * List ticket statuses.
   *
   * @returns {Promise<Array<Object>>} Status list sorted by sort order
   *
   * @example
   * const statuses = await system.listStatuses();
   */
  const listStatuses = async () => {
    const statuses = await conn.query(`
      SELECT * FROM ${conn.table('ticket_status')} ORDER BY sort
    `);

    return statuses.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      flags: s.flags,
      sort: s.sort,
      properties: s.properties ? JSON.parse(s.properties) : null,
    }));
  };

  return {
    getConfig,
    getStats,
    listPriorities,
    listStatuses,
  };
};
