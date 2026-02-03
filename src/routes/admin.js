/**
 * Admin Routes - Staff Interface
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Check admin access
 */
const requireStaffSession = (req, res, next) => {
  if (!req.session?.user || req.session.user.type !== 'staff') {
    return res.redirect('/login');
  }
  next();
};

router.use(requireStaffSession);

/**
 * Get admin template data
 */
const getAdminData = async (req) => {
  let config = {};
  try {
    const configItems = await db.query(`
      SELECT \`key\`, value FROM ${db.table('config')}
      WHERE namespace = 'core' AND \`key\` IN ('helpdesk_title', 'helpdesk_url')
    `);
    configItems.forEach(item => {
      config[item.key] = item.value;
    });
  } catch (e) {
    config = { helpdesk_title: 'Nodeticket Admin' };
  }

  return {
    title: config.helpdesk_title || 'Nodeticket Admin',
    user: req.session?.user || null,
    isAdmin: req.session?.user?.isAdmin || false
  };
};

/**
 * Render admin page
 */
const renderAdminPage = (title, content, base, activeNav = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Admin - ${base.title}</title>
  <link rel="stylesheet" href="/css/admin.css">
</head>
<body class="admin-body">
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="/admin" class="logo">Admin Panel</a>
    </div>
    <nav class="sidebar-nav">
      <a href="/admin" class="${activeNav === 'dashboard' ? 'active' : ''}">Dashboard</a>
      <a href="/admin/tickets" class="${activeNav === 'tickets' ? 'active' : ''}">Tickets</a>
      <a href="/admin/users" class="${activeNav === 'users' ? 'active' : ''}">Users</a>
      <a href="/admin/staff" class="${activeNav === 'staff' ? 'active' : ''}">Staff</a>
      <a href="/admin/departments" class="${activeNav === 'departments' ? 'active' : ''}">Departments</a>
      <a href="/admin/teams" class="${activeNav === 'teams' ? 'active' : ''}">Teams</a>
      <a href="/admin/organizations" class="${activeNav === 'organizations' ? 'active' : ''}">Organizations</a>
      <a href="/admin/topics" class="${activeNav === 'topics' ? 'active' : ''}">Help Topics</a>
      <a href="/admin/sla" class="${activeNav === 'sla' ? 'active' : ''}">SLA Plans</a>
      <a href="/admin/faq" class="${activeNav === 'faq' ? 'active' : ''}">FAQ</a>
    </nav>
    <div class="sidebar-footer">
      <span class="user-name">${base.user?.name || 'Staff'}</span>
      <a href="/logout" class="logout-link">Logout</a>
    </div>
  </aside>
  <main class="admin-main">
    <header class="admin-header">
      <h1>${title}</h1>
      <div class="header-actions">
        <a href="/" target="_blank">View Site</a>
      </div>
    </header>
    <div class="admin-content">
      ${content}
    </div>
  </main>
  <script src="/js/admin.js"></script>
</body>
</html>
`;

/**
 * Helper functions
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString();
}

/**
 * Dashboard
 */
router.get('/', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const staffId = req.session.user.id;

  let stats = {
    openTickets: 0,
    overdueTickets: 0,
    unassignedTickets: 0,
    myTickets: 0,
    todayTickets: 0,
    users: 0
  };

  let recentActivity = [];
  let deptBreakdown = [];

  try {
    // Core ticket stats
    const ticketStats = await db.queryOne(`
      SELECT
        SUM(CASE WHEN ts.state = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN t.isoverdue = 1 AND ts.state = 'open' THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN t.staff_id = 0 AND ts.state = 'open' THEN 1 ELSE 0 END) as unassigned_count,
        SUM(CASE WHEN t.staff_id = ? AND ts.state = 'open' THEN 1 ELSE 0 END) as my_count
      FROM ${db.table('ticket')} t
      JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
    `, [staffId]);

    stats.openTickets = parseInt(ticketStats?.open_count || 0, 10);
    stats.overdueTickets = parseInt(ticketStats?.overdue_count || 0, 10);
    stats.unassignedTickets = parseInt(ticketStats?.unassigned_count || 0, 10);
    stats.myTickets = parseInt(ticketStats?.my_count || 0, 10);

    stats.todayTickets = parseInt(await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('ticket')} WHERE DATE(created) = CURDATE()
    `) || 0, 10);

    stats.users = parseInt(await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('user')}
    `) || 0, 10);

    // Recent activity: last 10 thread events
    recentActivity = await db.query(`
      SELECT te.*, t.number as ticket_number, t.ticket_id,
             tc.subject as ticket_subject,
             CONCAT(s.firstname, ' ', s.lastname) as staff_name
      FROM ${db.table('thread_event')} te
      JOIN ${db.table('thread')} th ON te.thread_id = th.id
      JOIN ${db.table('ticket')} t ON th.object_id = t.ticket_id AND th.object_type = 'T'
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      LEFT JOIN ${db.table('staff')} s ON te.staff_id = s.staff_id
      ORDER BY te.timestamp DESC
      LIMIT 10
    `);

    // Department breakdown
    deptBreakdown = await db.query(`
      SELECT d.id, d.name,
             COUNT(CASE WHEN ts.state = 'open' THEN 1 END) as open_count,
             COUNT(t.ticket_id) as total_count
      FROM ${db.table('department')} d
      LEFT JOIN ${db.table('ticket')} t ON t.dept_id = d.id
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      GROUP BY d.id, d.name
      ORDER BY open_count DESC
    `);
  } catch (e) {
    console.error('Error loading dashboard:', e);
  }

  // Build recent activity HTML
  let activityHtml = '';
  if (recentActivity.length > 0) {
    activityHtml = recentActivity.map(a => `
      <div class="activity-item">
        <div class="activity-info">
          <a href="/admin/tickets/${a.ticket_id}">#${a.ticket_number}</a>
          <span class="activity-event">${escapeHtml(a.state || a.type || 'update')}</span>
          ${a.ticket_subject ? `<span class="activity-subject">${escapeHtml(a.ticket_subject)}</span>` : ''}
        </div>
        <div class="activity-meta">
          ${a.staff_name && a.staff_name.trim() ? escapeHtml(a.staff_name) : 'System'}
          &middot; ${formatDate(a.timestamp)}
        </div>
      </div>
    `).join('');
  } else {
    activityHtml = '<p class="empty-text">No recent activity.</p>';
  }

  // Build department breakdown HTML
  let deptHtml = '';
  if (deptBreakdown.length > 0) {
    deptHtml = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Open</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${deptBreakdown.map(d => `
            <tr>
              <td>${escapeHtml(d.name)}</td>
              <td><strong>${d.open_count || 0}</strong></td>
              <td>${d.total_count || 0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    deptHtml = '<p class="empty-text">No departments found.</p>';
  }

  const content = `
    <div class="dashboard-stats">
      <div class="stat-card">
        <div class="stat-value">${stats.openTickets}</div>
        <div class="stat-label">Open Tickets</div>
      </div>
      <div class="stat-card stat-warning">
        <div class="stat-value">${stats.overdueTickets}</div>
        <div class="stat-label">Overdue</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.unassignedTickets}</div>
        <div class="stat-label">Unassigned</div>
      </div>
      <div class="stat-card stat-mine">
        <div class="stat-value">${stats.myTickets}</div>
        <div class="stat-label">My Tickets</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.todayTickets}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.users}</div>
        <div class="stat-label">Users</div>
      </div>
    </div>

    <div class="dashboard-sections">
      <section class="dashboard-section">
        <h2>Quick Actions</h2>
        <div class="quick-actions">
          <a href="/admin/tickets" class="action-btn">All Tickets</a>
          <a href="/admin/tickets?staff_id=${staffId}" class="action-btn">My Tickets</a>
          <a href="/admin/tickets?status=open&staff=unassigned" class="action-btn">Unassigned</a>
          <a href="/admin/tickets?status=overdue" class="action-btn">Overdue</a>
        </div>
      </section>

      <section class="dashboard-section">
        <h2>Recent Activity</h2>
        <div class="activity-feed">
          ${activityHtml}
        </div>
      </section>
    </div>

    <div class="dashboard-sections" style="margin-top: 20px">
      <section class="dashboard-section">
        <h2>Tickets by Department</h2>
        ${deptHtml}
      </section>
    </div>
  `;

  res.send(renderAdminPage('Dashboard', content, base, 'dashboard'));
}));

/**
 * Tickets list
 */
router.get('/tickets', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { status, dept_id, staff_id, page = 1 } = req.query;
  const limit = 25;
  const offset = (parseInt(page, 10) - 1) * limit;

  let ticketsHtml = '<p>No tickets found.</p>';
  let pagination = '';

  try {
    let sql = `
      SELECT t.*, ts.name as status_name, ts.state as status_state,
             d.name as dept_name, u.name as user_name,
             CONCAT(s.firstname, ' ', s.lastname) as staff_name,
             tc.subject
      FROM ${db.table('ticket')} t
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE 1=1
    `;
    const params = [];

    if (status === 'open') {
      sql += ` AND ts.state = 'open'`;
    } else if (status === 'closed') {
      sql += ` AND ts.state = 'closed'`;
    } else if (status === 'overdue') {
      sql += ` AND t.isoverdue = 1 AND ts.state = 'open'`;
    }

    if (dept_id) {
      sql += ` AND t.dept_id = ?`;
      params.push(dept_id);
    }

    if (staff_id === 'unassigned') {
      sql += ` AND (t.staff_id = 0 OR t.staff_id IS NULL)`;
    } else if (staff_id) {
      sql += ` AND t.staff_id = ?`;
      params.push(staff_id);
    }

    // Get total count
    const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');
    const total = parseInt((await db.queryOne(countSql, params))?.count || 0, 10);

    sql += ` ORDER BY t.created DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const tickets = await db.query(sql, params);

    if (tickets.length > 0) {
      ticketsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Subject</th>
              <th>User</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>Department</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${tickets.map(t => `
              <tr class="${t.isoverdue ? 'row-overdue' : ''}">
                <td><a href="/admin/tickets/${t.ticket_id}">${escapeHtml(t.number)}</a></td>
                <td>${escapeHtml(t.subject || 'No Subject')}</td>
                <td>${escapeHtml(t.user_name || 'Unknown')}</td>
                <td><span class="status status-${t.status_state}">${t.status_name}</span></td>
                <td>${escapeHtml(t.staff_name || 'Unassigned')}</td>
                <td>${escapeHtml(t.dept_name || 'N/A')}</td>
                <td>${formatDate(t.created)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      // Pagination
      const totalPages = Math.ceil(total / limit);
      if (totalPages > 1) {
        pagination = `
          <div class="pagination">
            ${parseInt(page, 10) > 1 ? `<a href="?page=${parseInt(page, 10) - 1}">&laquo; Previous</a>` : ''}
            <span>Page ${page} of ${totalPages}</span>
            ${parseInt(page, 10) < totalPages ? `<a href="?page=${parseInt(page, 10) + 1}">Next &raquo;</a>` : ''}
          </div>
        `;
      }
    }
  } catch (e) {
    console.error('Error loading tickets:', e);
    ticketsHtml = '<p class="error">Error loading tickets.</p>';
  }

  const content = `
    <div class="filters">
      <form method="GET" class="filter-form">
        <select name="status">
          <option value="">All Statuses</option>
          <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${status === 'closed' ? 'selected' : ''}>Closed</option>
          <option value="overdue" ${status === 'overdue' ? 'selected' : ''}>Overdue</option>
        </select>
        <button type="submit" class="btn">Filter</button>
      </form>
    </div>
    ${ticketsHtml}
    ${pagination}
  `;

  res.send(renderAdminPage('Tickets', content, base, 'tickets'));
}));

/**
 * View ticket
 */
router.get('/tickets/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;

  try {
    const ticket = await db.queryOne(`
      SELECT t.*, ts.name as status_name, ts.state as status_state,
             d.name as dept_name, u.name as user_name, ue.address as user_email,
             CONCAT(s.firstname, ' ', s.lastname) as staff_name,
             tm.name as team_name,
             tp.priority as priority_name, tp.priority_color,
             sla.name as sla_name,
             tc.subject, th.id as thread_id
      FROM ${db.table('ticket')} t
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${db.table('user')} u ON t.user_id = u.id
      LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
      LEFT JOIN ${db.table('staff')} s ON t.staff_id = s.staff_id
      LEFT JOIN ${db.table('team')} tm ON t.team_id = tm.team_id
      LEFT JOIN ${db.table('help_topic')} ht ON t.topic_id = ht.topic_id
      LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
      LEFT JOIN ${db.table('sla')} sla ON t.sla_id = sla.id
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ?
    `, [id]);

    if (!ticket) {
      return res.send(renderAdminPage('Ticket Not Found', '<p>Ticket not found.</p>', base, 'tickets'));
    }

    // Get thread entries
    const entries = await db.query(`
      SELECT te.*, s.firstname, s.lastname, u.name as user_name
      FROM ${db.table('thread_entry')} te
      LEFT JOIN ${db.table('staff')} s ON te.staff_id = s.staff_id
      LEFT JOIN ${db.table('user')} u ON te.user_id = u.id
      WHERE te.thread_id = ?
      ORDER BY te.created ASC
    `, [ticket.thread_id]);

    const content = `
      <div class="ticket-detail">
        <div class="ticket-meta">
          <p><strong>Status:</strong> <span class="status status-${ticket.status_state}">${ticket.status_name}</span></p>
          <p><strong>User:</strong> ${escapeHtml(ticket.user_name)} &lt;${escapeHtml(ticket.user_email)}&gt;</p>
          <p><strong>Department:</strong> ${escapeHtml(ticket.dept_name || 'N/A')}</p>
          <p><strong>Assigned To:</strong> ${escapeHtml(ticket.staff_name || 'Unassigned')}</p>
          ${ticket.team_name ? `<p><strong>Team:</strong> ${escapeHtml(ticket.team_name)}</p>` : ''}
          <p><strong>Priority:</strong> <span style="color: ${ticket.priority_color}">${ticket.priority_name || 'Normal'}</span></p>
          ${ticket.sla_name ? `<p><strong>SLA:</strong> ${escapeHtml(ticket.sla_name)}</p>` : ''}
          <p><strong>Created:</strong> ${formatDate(ticket.created)}</p>
          ${ticket.duedate ? `<p><strong>Due Date:</strong> ${formatDate(ticket.duedate)}</p>` : ''}
          ${ticket.closed ? `<p><strong>Closed:</strong> ${formatDate(ticket.closed)}</p>` : ''}
        </div>

        <div class="ticket-subject">
          <h2>${escapeHtml(ticket.subject || 'No Subject')}</h2>
        </div>

        <div class="thread">
          <h3>Thread</h3>
          ${entries.map(e => `
            <div class="thread-entry thread-entry-${e.type}">
              <div class="entry-header">
                <strong>${getEntryPoster(e)}</strong>
                <span class="entry-type">${getEntryType(e.type)}</span>
                <span class="entry-date">${formatDate(e.created)}</span>
              </div>
              ${e.title ? `<div class="entry-title">${escapeHtml(e.title)}</div>` : ''}
              <div class="entry-body">${e.body}</div>
            </div>
          `).join('')}
        </div>

        <p><a href="/admin/tickets" class="btn">&larr; Back to Tickets</a></p>
      </div>
    `;

    res.send(renderAdminPage(`Ticket #${ticket.number}`, content, base, 'tickets'));
  } catch (e) {
    console.error('Error loading ticket:', e);
    res.send(renderAdminPage('Error', '<p class="error">Error loading ticket.</p>', base, 'tickets'));
  }
}));

/**
 * Users list
 */
router.get('/users', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { page = 1, search } = req.query;
  const limit = 25;
  const offset = (parseInt(page, 10) - 1) * limit;

  let usersHtml = '<p>No users found.</p>';

  try {
    let sql = `
      SELECT u.*, ue.address as email, o.name as org_name
      FROM ${db.table('user')} u
      LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
      LEFT JOIN ${db.table('organization')} o ON u.org_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (u.name LIKE ? OR ue.address LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY u.created DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = await db.query(sql, params);

    if (users.length > 0) {
      usersHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Organization</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><a href="/admin/users/${u.id}">${escapeHtml(u.name)}</a></td>
                <td>${escapeHtml(u.email || 'N/A')}</td>
                <td>${escapeHtml(u.org_name || '-')}</td>
                <td>${formatDate(u.created)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading users:', e);
    usersHtml = '<p class="error">Error loading users.</p>';
  }

  const content = `
    <div class="filters">
      <form method="GET" class="filter-form">
        <input type="text" name="search" placeholder="Search users..." value="${escapeHtml(search || '')}">
        <button type="submit" class="btn">Search</button>
      </form>
    </div>
    ${usersHtml}
  `;

  res.send(renderAdminPage('Users', content, base, 'users'));
}));

/**
 * View user
 */
router.get('/users/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;

  try {
    const user = await db.queryOne(`
      SELECT u.*, o.name as org_name
      FROM ${db.table('user')} u
      LEFT JOIN ${db.table('organization')} o ON u.org_id = o.id
      WHERE u.id = ?
    `, [id]);

    if (!user) {
      return res.send(renderAdminPage('User Not Found', '<p>User not found.</p>', base, 'users'));
    }

    const emails = await db.query(`
      SELECT * FROM ${db.table('user_email')} WHERE user_id = ?
    `, [id]);

    const ticketCount = await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?
    `, [id]);

    const content = `
      <div class="detail-view">
        <h2>${escapeHtml(user.name)}</h2>
        <div class="detail-meta">
          <p><strong>Organization:</strong> ${escapeHtml(user.org_name || 'None')}</p>
          <p><strong>Created:</strong> ${formatDate(user.created)}</p>
          <p><strong>Tickets:</strong> ${ticketCount || 0}</p>
        </div>

        <h3>Email Addresses</h3>
        <ul>
          ${emails.map(e => `<li>${escapeHtml(e.address)} ${e.id === user.default_email_id ? '(Primary)' : ''}</li>`).join('')}
        </ul>

        <p><a href="/admin/users" class="btn">&larr; Back to Users</a></p>
      </div>
    `;

    res.send(renderAdminPage(user.name, content, base, 'users'));
  } catch (e) {
    console.error('Error loading user:', e);
    res.send(renderAdminPage('Error', '<p class="error">Error loading user.</p>', base, 'users'));
  }
}));

/**
 * Staff list
 */
router.get('/staff', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let staffHtml = '<p>No staff found.</p>';

  try {
    const staff = await db.query(`
      SELECT s.*, d.name as dept_name, r.name as role_name
      FROM ${db.table('staff')} s
      LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
      LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
      ORDER BY s.lastname, s.firstname
    `);

    if (staff.length > 0) {
      staffHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Department</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${staff.map(s => `
              <tr>
                <td><a href="/admin/staff/${s.staff_id}">${escapeHtml(`${s.firstname || ''} ${s.lastname || ''}`.trim() || s.username)}</a></td>
                <td>${escapeHtml(s.username)}</td>
                <td>${escapeHtml(s.email || 'N/A')}</td>
                <td>${escapeHtml(s.dept_name || 'N/A')}</td>
                <td>${escapeHtml(s.role_name || 'N/A')}</td>
                <td>
                  ${s.isactive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}
                  ${s.isadmin ? '<span class="badge badge-primary">Admin</span>' : ''}
                  ${s.onvacation ? '<span class="badge badge-warning">Vacation</span>' : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading staff:', e);
    staffHtml = '<p class="error">Error loading staff.</p>';
  }

  res.send(renderAdminPage('Staff', staffHtml, base, 'staff'));
}));

/**
 * Departments list
 */
router.get('/departments', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let deptsHtml = '<p>No departments found.</p>';

  try {
    const depts = await db.query(`
      SELECT d.*, s.firstname, s.lastname, sla.name as sla_name,
             (SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = d.id AND isactive = 1) as staff_count
      FROM ${db.table('department')} d
      LEFT JOIN ${db.table('staff')} s ON d.manager_id = s.staff_id
      LEFT JOIN ${db.table('sla')} sla ON d.sla_id = sla.id
      ORDER BY d.name
    `);

    if (depts.length > 0) {
      deptsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Manager</th>
              <th>SLA</th>
              <th>Staff</th>
              <th>Visibility</th>
            </tr>
          </thead>
          <tbody>
            ${depts.map(d => `
              <tr>
                <td><a href="/admin/departments/${d.id}">${escapeHtml(d.name)}</a></td>
                <td>${d.manager_id ? escapeHtml(`${d.firstname || ''} ${d.lastname || ''}`.trim()) : 'None'}</td>
                <td>${escapeHtml(d.sla_name || 'Default')}</td>
                <td>${d.staff_count || 0}</td>
                <td>${d.ispublic ? 'Public' : 'Private'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading departments:', e);
    deptsHtml = '<p class="error">Error loading departments.</p>';
  }

  res.send(renderAdminPage('Departments', deptsHtml, base, 'departments'));
}));

/**
 * Teams list
 */
router.get('/teams', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let teamsHtml = '<p>No teams found.</p>';

  try {
    const teams = await db.query(`
      SELECT t.*, s.firstname, s.lastname,
             (SELECT COUNT(*) FROM ${db.table('team_member')} WHERE team_id = t.team_id) as member_count
      FROM ${db.table('team')} t
      LEFT JOIN ${db.table('staff')} s ON t.lead_id = s.staff_id
      ORDER BY t.name
    `);

    if (teams.length > 0) {
      teamsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Lead</th>
              <th>Members</th>
            </tr>
          </thead>
          <tbody>
            ${teams.map(t => `
              <tr>
                <td><a href="/admin/teams/${t.team_id}">${escapeHtml(t.name)}</a></td>
                <td>${t.lead_id ? escapeHtml(`${t.firstname || ''} ${t.lastname || ''}`.trim()) : 'None'}</td>
                <td>${t.member_count || 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading teams:', e);
    teamsHtml = '<p class="error">Error loading teams.</p>';
  }

  res.send(renderAdminPage('Teams', teamsHtml, base, 'teams'));
}));

/**
 * Organizations list
 */
router.get('/organizations', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let orgsHtml = '<p>No organizations found.</p>';

  try {
    const orgs = await db.query(`
      SELECT o.*,
             (SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = o.id) as user_count
      FROM ${db.table('organization')} o
      ORDER BY o.name
    `);

    if (orgs.length > 0) {
      orgsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Domain</th>
              <th>Users</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${orgs.map(o => `
              <tr>
                <td><a href="/admin/organizations/${o.id}">${escapeHtml(o.name)}</a></td>
                <td>${escapeHtml(o.domain || '-')}</td>
                <td>${o.user_count || 0}</td>
                <td>${formatDate(o.created)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading organizations:', e);
    orgsHtml = '<p class="error">Error loading organizations.</p>';
  }

  res.send(renderAdminPage('Organizations', orgsHtml, base, 'organizations'));
}));

/**
 * Help Topics list
 */
router.get('/topics', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let topicsHtml = '<p>No help topics found.</p>';

  try {
    const topics = await db.query(`
      SELECT ht.*, d.name as dept_name
      FROM ${db.table('help_topic')} ht
      LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
      ORDER BY ht.sort, ht.topic
    `);

    if (topics.length > 0) {
      topicsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Department</th>
              <th>Visibility</th>
            </tr>
          </thead>
          <tbody>
            ${topics.map(t => `
              <tr>
                <td><a href="/admin/topics/${t.topic_id}">${escapeHtml(t.topic)}</a></td>
                <td>${escapeHtml(t.dept_name || 'Default')}</td>
                <td>${t.ispublic ? 'Public' : 'Private'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading topics:', e);
    topicsHtml = '<p class="error">Error loading topics.</p>';
  }

  res.send(renderAdminPage('Help Topics', topicsHtml, base, 'topics'));
}));

/**
 * SLA list
 */
router.get('/sla', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let slaHtml = '<p>No SLA plans found.</p>';

  try {
    const slas = await db.query(`SELECT * FROM ${db.table('sla')} ORDER BY name`);

    if (slas.length > 0) {
      slaHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Grace Period</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${slas.map(s => `
              <tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${s.grace_period} hours</td>
                <td>${s.flags & 1 ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading SLAs:', e);
    slaHtml = '<p class="error">Error loading SLA plans.</p>';
  }

  res.send(renderAdminPage('SLA Plans', slaHtml, base, 'sla'));
}));

/**
 * FAQ list
 */
router.get('/faq', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let faqHtml = '<p>No FAQ articles found.</p>';

  try {
    const faqs = await db.query(`
      SELECT f.*, c.name as category_name
      FROM ${db.table('faq')} f
      LEFT JOIN ${db.table('faq_category')} c ON f.category_id = c.category_id
      ORDER BY c.name, f.question
    `);

    if (faqs.length > 0) {
      faqHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${faqs.map(f => `
              <tr>
                <td>${escapeHtml(f.question)}</td>
                <td>${escapeHtml(f.category_name || 'Uncategorized')}</td>
                <td>${f.ispublished ? '<span class="badge badge-success">Published</span>' : '<span class="badge badge-warning">Draft</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading FAQs:', e);
    faqHtml = '<p class="error">Error loading FAQ articles.</p>';
  }

  res.send(renderAdminPage('FAQ Articles', faqHtml, base, 'faq'));
}));

/**
 * Helper functions
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString();
}

function getEntryPoster(entry) {
  if (entry.staff_id && entry.firstname) {
    return escapeHtml(`${entry.firstname} ${entry.lastname}`.trim());
  }
  if (entry.user_id && entry.user_name) {
    return escapeHtml(entry.user_name);
  }
  return escapeHtml(entry.poster || 'Unknown');
}

function getEntryType(type) {
  switch (type) {
    case 'M': return 'Message';
    case 'R': return 'Response';
    case 'N': return 'Note';
    default: return type;
  }
}

module.exports = router;
