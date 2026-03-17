/**
 * Admin Routes - Staff Interface
 */

const crypto = require('crypto');
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
      <a href="/admin/roles" class="${activeNav === 'roles' ? 'active' : ''}">Roles</a>
      <a href="/admin/topics" class="${activeNav === 'topics' ? 'active' : ''}">Help Topics</a>
      <a href="/admin/sla" class="${activeNav === 'sla' ? 'active' : ''}">SLA Plans</a>
      <a href="/admin/faq" class="${activeNav === 'faq' ? 'active' : ''}">FAQ</a>
      ${base.isAdmin ? `<a href="/admin/api-keys" class="${activeNav === 'api-keys' ? 'active' : ''}">API Keys</a>` : ''}
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
    const countSql = sql.replace(/SELECT .*? FROM/s, 'SELECT COUNT(*) as count FROM');
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
              <div class="entry-body">${escapeHtml(e.body)}</div>
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
      ${base.isAdmin ? '<a href="/admin/users/create" class="btn btn-primary">Create User</a>' : ''}
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

        <div class="detail-actions">
          <a href="/admin/users" class="btn">&larr; Back to Users</a>
          ${base.isAdmin ? `
            <a href="/admin/users/${user.id}/edit" class="btn btn-primary">Edit</a>
            <form method="POST" action="/admin/users/${user.id}/delete" style="display:inline" onsubmit="return confirm('Delete this user?')">
              <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
              <button type="submit" class="btn btn-danger">Delete</button>
            </form>
          ` : ''}
        </div>
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

  const staffContent = `
    ${base.isAdmin ? '<div class="filters"><a href="/admin/staff/create" class="btn btn-primary">Create Staff</a></div>' : ''}
    ${staffHtml}
  `;
  res.send(renderAdminPage('Staff', staffContent, base, 'staff'));
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

  const deptsContent = `
    ${base.isAdmin ? '<div class="filters"><a href="/admin/departments/create" class="btn btn-primary">Create Department</a></div>' : ''}
    ${deptsHtml}
  `;
  res.send(renderAdminPage('Departments', deptsContent, base, 'departments'));
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

  const teamsContent = `
    ${base.isAdmin ? '<div class="filters"><a href="/admin/teams/create" class="btn btn-primary">Create Team</a></div>' : ''}
    ${teamsHtml}
  `;
  res.send(renderAdminPage('Teams', teamsContent, base, 'teams'));
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

  const orgsContent = `
    ${base.isAdmin ? '<div class="filters"><a href="/admin/organizations/create" class="btn btn-primary">Create Organization</a></div>' : ''}
    ${orgsHtml}
  `;
  res.send(renderAdminPage('Organizations', orgsContent, base, 'organizations'));
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

/**
 * API Key Management — admin only
 */
const requireAdmin = (req, res, next) => {
  if (!req.session?.user?.isAdmin) {
    return res.status(403).send(renderAdminPage('Forbidden', '<p class="error">Admin access required.</p>', { title: 'Admin', user: req.session?.user || null, isAdmin: false }, ''));
  }
  next();
};

// GET /admin/api-keys — list all keys
router.get('/api-keys', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  let keysHtml = '<p>No API keys found.</p>';

  try {
    const keys = await db.query(`SELECT * FROM ${db.table('api_key')} ORDER BY created DESC`);

    if (keys.length > 0) {
      keysHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Key (masked)</th>
              <th>IP Address</th>
              <th>Create Tickets</th>
              <th>Exec Cron</th>
              <th>Active</th>
              <th>Notes</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${keys.map(k => `
              <tr>
                <td>${k.id}</td>
                <td><code>...${escapeHtml(k.apikey.slice(-8))}</code></td>
                <td>${escapeHtml(k.ipaddr || '0.0.0.0')}</td>
                <td>${k.can_create_tickets ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
                <td>${k.can_exec_cron ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
                <td>${k.isactive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
                <td>${escapeHtml(k.notes || '-')}</td>
                <td>${formatDate(k.created)}</td>
                <td>
                  <a href="/admin/api-keys/${k.id}" class="btn btn-sm">Edit</a>
                  <form method="POST" action="/admin/api-keys/${k.id}/delete" style="display:inline" onsubmit="return confirm('Delete this API key?')">
                    <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
                    <button type="submit" class="btn btn-sm btn-danger">Delete</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading API keys:', e);
    keysHtml = '<p class="error">Error loading API keys.</p>';
  }

  const content = `
    <div class="page-actions" style="margin-bottom:16px">
      <a href="/admin/api-keys/create" class="btn">+ New API Key</a>
    </div>
    ${keysHtml}
  `;

  res.send(renderAdminPage('API Keys', content, base, 'api-keys'));
}));

// GET /admin/api-keys/create — create form
router.get('/api-keys/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  const content = `
    <form method="POST" action="/admin/api-keys" class="admin-form">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group">
        <label>IP Address <small>(0.0.0.0 = any)</small></label>
        <input type="text" name="ipaddr" value="0.0.0.0" class="form-control">
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="can_create_tickets" value="1">
          Can Create Tickets
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="can_exec_cron" value="1">
          Can Execute Cron
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="isactive" value="1" checked>
          Active
        </label>
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea name="notes" class="form-control" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn">Create Key</button>
        <a href="/admin/api-keys" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  `;

  res.send(renderAdminPage('Create API Key', content, base, 'api-keys'));
}));

// POST /admin/api-keys — create key
router.post('/api-keys', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { ipaddr = '0.0.0.0', can_create_tickets, can_exec_cron, isactive, notes } = req.body;

  const newKey = crypto.randomBytes(32).toString('hex');
  const now = new Date();

  try {
    await db.query(`
      INSERT INTO ${db.table('api_key')} (isactive, ipaddr, apikey, can_create_tickets, can_exec_cron, notes, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      isactive ? 1 : 0,
      ipaddr || '0.0.0.0',
      newKey,
      can_create_tickets ? 1 : 0,
      can_exec_cron ? 1 : 0,
      notes || '',
      now,
      now
    ]);

    const content = `
      <div class="alert alert-success">
        <strong>API Key Created</strong>
        <p>Copy this key now — it will not be shown again in full:</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:4px;word-break:break-all">${escapeHtml(newKey)}</pre>
      </div>
      <p><a href="/admin/api-keys" class="btn">Back to API Keys</a></p>
    `;

    res.send(renderAdminPage('API Key Created', content, base, 'api-keys'));
  } catch (e) {
    console.error('Error creating API key:', e);
    const content = `<p class="error">Error creating API key: ${escapeHtml(e.message)}</p><p><a href="/admin/api-keys/create" class="btn">Try Again</a></p>`;
    res.status(500).send(renderAdminPage('Error', content, base, 'api-keys'));
  }
}));

// GET /admin/api-keys/:id — edit form
router.get('/api-keys/:id', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;

  try {
    const key = await db.queryOne(`SELECT * FROM ${db.table('api_key')} WHERE id = ?`, [id]);

    if (!key) {
      return res.status(404).send(renderAdminPage('Not Found', '<p>API key not found.</p>', base, 'api-keys'));
    }

    const content = `
      <form method="POST" action="/admin/api-keys/${key.id}" class="admin-form">
        <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
        <div class="form-group">
          <label>Key (masked)</label>
          <input type="text" value="...${escapeHtml(key.apikey.slice(-8))}" class="form-control" disabled>
        </div>
        <div class="form-group">
          <label>IP Address <small>(0.0.0.0 = any)</small></label>
          <input type="text" name="ipaddr" value="${escapeHtml(key.ipaddr || '0.0.0.0')}" class="form-control">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="can_create_tickets" value="1" ${key.can_create_tickets ? 'checked' : ''}>
            Can Create Tickets
          </label>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="can_exec_cron" value="1" ${key.can_exec_cron ? 'checked' : ''}>
            Can Execute Cron
          </label>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="isactive" value="1" ${key.isactive ? 'checked' : ''}>
            Active
          </label>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes" class="form-control" rows="3">${escapeHtml(key.notes || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn">Save Changes</button>
          <a href="/admin/api-keys" class="btn btn-secondary">Cancel</a>
        </div>
      </form>
    `;

    res.send(renderAdminPage(`Edit API Key #${key.id}`, content, base, 'api-keys'));
  } catch (e) {
    console.error('Error loading API key:', e);
    res.status(500).send(renderAdminPage('Error', '<p class="error">Error loading API key.</p>', base, 'api-keys'));
  }
}));

// POST /admin/api-keys/:id — update key
router.post('/api-keys/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ipaddr, can_create_tickets, can_exec_cron, isactive, notes } = req.body;

  try {
    await db.query(`
      UPDATE ${db.table('api_key')}
      SET isactive = ?, ipaddr = ?, can_create_tickets = ?, can_exec_cron = ?, notes = ?, updated = ?
      WHERE id = ?
    `, [
      isactive ? 1 : 0,
      ipaddr || '0.0.0.0',
      can_create_tickets ? 1 : 0,
      can_exec_cron ? 1 : 0,
      notes || '',
      new Date(),
      id
    ]);

    res.redirect('/admin/api-keys');
  } catch (e) {
    console.error('Error updating API key:', e);
    const base = await getAdminData(req);
    const content = `<p class="error">Error updating API key: ${escapeHtml(e.message)}</p><p><a href="/admin/api-keys/${id}" class="btn">Back</a></p>`;
    res.status(500).send(renderAdminPage('Error', content, base, 'api-keys'));
  }
}));

// POST /admin/api-keys/:id/delete — delete key
router.post('/api-keys/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(`DELETE FROM ${db.table('api_key')} WHERE id = ?`, [id]);
    res.redirect('/admin/api-keys');
  } catch (e) {
    console.error('Error deleting API key:', e);
    const base = await getAdminData(req);
    const content = `<p class="error">Error deleting API key: ${escapeHtml(e.message)}</p><p><a href="/admin/api-keys" class="btn">Back</a></p>`;
    res.status(500).send(renderAdminPage('Error', content, base, 'api-keys'));
  }
}));

// ══════════════════════════════════════════
// Role CRUD
// ══════════════════════════════════════════

router.get('/roles', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  let rolesHtml = '<p>No roles found.</p>';

  try {
    const roles = await db.query(`SELECT * FROM ${db.table('role')} ORDER BY name`);
    if (roles.length > 0) {
      rolesHtml = `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Flags</th><th>Notes</th></tr></thead>
          <tbody>
            ${roles.map(r => `
              <tr>
                <td><a href="/admin/roles/${r.id}">${escapeHtml(r.name)}</a></td>
                <td>${r.flags || 0}</td>
                <td>${escapeHtml(r.notes || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    rolesHtml = `<p class="error">Error loading roles: ${escapeHtml(e.message)}</p>`;
  }

  const content = `
    ${base.isAdmin ? '<div class="filters"><a href="/admin/roles/create" class="btn btn-primary">Create Role</a></div>' : ''}
    ${rolesHtml}
  `;
  res.send(renderAdminPage('Roles', content, base, 'roles'));
}));

router.get('/roles/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';
  const content = `
    <form method="POST" action="/admin/roles">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" required maxlength="64"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3"></textarea></div>
      <div class="form-group"><label>Flags</label><input type="number" name="flags" value="0"></div>
      <button type="submit" class="btn btn-primary">Create Role</button>
      <a href="/admin/roles" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create Role', content, base, 'roles'));
}));

router.post('/roles', requireAdmin, asyncHandler(async (req, res) => {
  const { name, notes, flags } = req.body;
  const now = new Date();
  await db.query(`INSERT INTO ${db.table('role')} (name, permissions, flags, notes, created, updated) VALUES (?, NULL, ?, ?, ?, ?)`,
    [name.trim(), parseInt(flags, 10) || 0, notes || null, now, now]);
  res.redirect('/admin/roles');
}));

router.get('/roles/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const role = await db.queryOne(`SELECT * FROM ${db.table('role')} WHERE id = ?`, [req.params.id]);
  if (!role) return res.send(renderAdminPage('Not Found', '<p>Role not found.</p>', base, 'roles'));

  let permissions = {};
  try { permissions = role.permissions ? JSON.parse(role.permissions) : {}; } catch (e) {}

  const content = `
    <div class="detail-view">
      <h2>${escapeHtml(role.name)}</h2>
      <div class="detail-meta">
        <p><strong>Flags:</strong> ${role.flags || 0}</p>
        <p><strong>Notes:</strong> ${escapeHtml(role.notes || 'None')}</p>
        <p><strong>Permissions:</strong> <pre>${escapeHtml(JSON.stringify(permissions, null, 2))}</pre></p>
      </div>
      <div class="detail-actions">
        <a href="/admin/roles" class="btn">&larr; Back</a>
        ${base.isAdmin ? `
          <a href="/admin/roles/${role.id}/edit" class="btn btn-primary">Edit</a>
          <form method="POST" action="/admin/roles/${role.id}/delete" style="display:inline" onsubmit="return confirm('Delete this role?')">
            <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderAdminPage(role.name, content, base, 'roles'));
}));

router.get('/roles/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const role = await db.queryOne(`SELECT * FROM ${db.table('role')} WHERE id = ?`, [req.params.id]);
  if (!role) return res.send(renderAdminPage('Not Found', '<p>Role not found.</p>', base, 'roles'));

  const csrfToken = req.csrfToken ? req.csrfToken() : '';
  const content = `
    <form method="POST" action="/admin/roles/${role.id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(role.name)}" required maxlength="64"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(role.notes || '')}</textarea></div>
      <div class="form-group"><label>Flags</label><input type="number" name="flags" value="${role.flags || 0}"></div>
      <button type="submit" class="btn btn-primary">Update Role</button>
      <a href="/admin/roles/${role.id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit Role', content, base, 'roles'));
}));

router.post('/roles/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, notes, flags } = req.body;
  await db.query(`UPDATE ${db.table('role')} SET name = ?, notes = ?, flags = ?, updated = ? WHERE id = ?`,
    [name.trim(), notes || null, parseInt(flags, 10) || 0, new Date(), req.params.id]);
  res.redirect(`/admin/roles/${req.params.id}`);
}));

router.post('/roles/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const staffCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('staff')} WHERE role_id = ?`, [req.params.id]);
  if (parseInt(staffCount || 0, 10) > 0) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', '<p class="error">Cannot delete: staff are assigned to this role.</p><p><a href="/admin/roles" class="btn">Back</a></p>', base, 'roles'));
  }
  await db.query(`DELETE FROM ${db.table('role')} WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/roles');
}));

// ══════════════════════════════════════════
// User CRUD Forms
// ══════════════════════════════════════════

router.get('/users/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const orgs = await db.query(`SELECT id, name FROM ${db.table('organization')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/users">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name *</label><input type="text" name="name" required></div>
      <div class="form-group"><label>Email *</label><input type="email" name="email" required></div>
      <div class="form-group"><label>Organization</label>
        <select name="org_id"><option value="0">None</option>${orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Username (for login)</label><input type="text" name="username"></div>
      <div class="form-group"><label>Password (min 8 chars)</label><input type="password" name="password" minlength="8"></div>
      <button type="submit" class="btn btn-primary">Create User</button>
      <a href="/admin/users" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create User', content, base, 'users'));
}));

router.post('/users', requireAdmin, asyncHandler(async (req, res) => {
  const { name, email, org_id, username, password } = req.body;

  // Validate email uniqueness
  const existingEmail = await db.queryOne(`SELECT id FROM ${db.table('user_email')} WHERE address = ?`, [email.trim()]);
  if (existingEmail) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', `<p class="error">Email "${escapeHtml(email)}" already exists.</p><p><a href="/admin/users/create" class="btn">Back</a></p>`, base, 'users'));
  }

  const now = new Date();
  const bcrypt = require('bcryptjs');

  await db.transaction(async (txQuery) => {
    const userResult = await txQuery(`INSERT INTO ${db.table('user')} (org_id, default_email_id, name, status, created, updated) VALUES (?, 0, ?, 0, ?, ?)`,
      [parseInt(org_id, 10) || 0, name.trim(), now, now]);
    const userId = userResult.insertId;
    const emailResult = await txQuery(`INSERT INTO ${db.table('user_email')} (user_id, address, flags) VALUES (?, ?, 0)`, [userId, email.trim()]);
    await txQuery(`UPDATE ${db.table('user')} SET default_email_id = ? WHERE id = ?`, [emailResult.insertId, userId]);
    if (username && password && password.length >= 8) {
      const hash = await bcrypt.hash(password, 10);
      await txQuery(`INSERT INTO ${db.table('user_account')} (user_id, username, passwd, status) VALUES (?, ?, ?, 1)`, [userId, username, hash]);
    }
    res.redirect(`/admin/users/${userId}`);
  });
}));

router.get('/users/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const user = await db.queryOne(`SELECT * FROM ${db.table('user')} WHERE id = ?`, [req.params.id]);
  if (!user) return res.send(renderAdminPage('Not Found', '<p>User not found.</p>', base, 'users'));

  const orgs = await db.query(`SELECT id, name FROM ${db.table('organization')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/users/${user.id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(user.name)}" required></div>
      <div class="form-group"><label>Organization</label>
        <select name="org_id"><option value="0">None</option>${orgs.map(o => `<option value="${o.id}" ${o.id === user.org_id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Status</label>
        <select name="status"><option value="0" ${user.status === 0 ? 'selected' : ''}>Active</option><option value="1" ${user.status === 1 ? 'selected' : ''}>Inactive</option></select>
      </div>
      <button type="submit" class="btn btn-primary">Update User</button>
      <a href="/admin/users/${user.id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit User', content, base, 'users'));
}));

router.post('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, org_id, status } = req.body;
  await db.query(`UPDATE ${db.table('user')} SET name = ?, org_id = ?, status = ?, updated = ? WHERE id = ?`,
    [name.trim(), parseInt(org_id, 10) || 0, parseInt(status, 10) || 0, new Date(), req.params.id]);
  res.redirect(`/admin/users/${req.params.id}`);
}));

router.post('/users/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE user_id = ?`, [req.params.id]);
  if (parseInt(ticketCount || 0, 10) > 0) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', '<p class="error">Cannot delete: user has tickets.</p><p><a href="/admin/users" class="btn">Back</a></p>', base, 'users'));
  }
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('user_account')} WHERE user_id = ?`, [req.params.id]);
    await txQuery(`DELETE FROM ${db.table('user_email')} WHERE user_id = ?`, [req.params.id]);
    await txQuery(`DELETE FROM ${db.table('user')} WHERE id = ?`, [req.params.id]);
  });
  res.redirect('/admin/users');
}));

// ══════════════════════════════════════════
// Staff Detail View
// ══════════════════════════════════════════

router.get('/staff/:id', asyncHandler(async (req, res, next) => {
  if (req.params.id === 'create') return next(); // Skip, handled by create route
  const base = await getAdminData(req);
  const staff = await db.queryOne(`
    SELECT s.*, d.name as dept_name, r.name as role_name
    FROM ${db.table('staff')} s
    LEFT JOIN ${db.table('department')} d ON s.dept_id = d.id
    LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
    WHERE s.staff_id = ?
  `, [req.params.id]);

  if (!staff) return res.send(renderAdminPage('Not Found', '<p>Staff member not found.</p>', base, 'staff'));

  const teams = await db.query(`
    SELECT t.name FROM ${db.table('team_member')} tm
    JOIN ${db.table('team')} t ON tm.team_id = t.team_id WHERE tm.staff_id = ?
  `, [req.params.id]);

  const content = `
    <div class="detail-view">
      <h2>${escapeHtml(`${staff.firstname || ''} ${staff.lastname || ''}`.trim() || staff.username)}</h2>
      <div class="detail-meta">
        <p><strong>Username:</strong> ${escapeHtml(staff.username)}</p>
        <p><strong>Email:</strong> ${escapeHtml(staff.email || 'N/A')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(staff.phone || 'N/A')}</p>
        <p><strong>Department:</strong> ${escapeHtml(staff.dept_name || 'N/A')}</p>
        <p><strong>Role:</strong> ${escapeHtml(staff.role_name || 'N/A')}</p>
        <p><strong>Status:</strong> ${staff.isactive ? 'Active' : 'Inactive'} ${staff.isadmin ? '(Admin)' : ''} ${staff.onvacation ? '(Vacation)' : ''}</p>
        <p><strong>Teams:</strong> ${teams.length > 0 ? teams.map(t => escapeHtml(t.name)).join(', ') : 'None'}</p>
        <p><strong>Created:</strong> ${formatDate(staff.created)}</p>
      </div>
      <div class="detail-actions">
        <a href="/admin/staff" class="btn">&larr; Back to Staff</a>
        ${base.isAdmin ? `
          <a href="/admin/staff/${staff.staff_id}/edit" class="btn btn-primary">Edit</a>
          <form method="POST" action="/admin/staff/${staff.staff_id}/delete" style="display:inline" onsubmit="return confirm('Delete this staff member?')">
            <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderAdminPage(`${staff.firstname} ${staff.lastname}`, content, base, 'staff'));
}));

// ══════════════════════════════════════════
// Department Detail View
// ══════════════════════════════════════════

router.get('/departments/:id', asyncHandler(async (req, res, next) => {
  if (req.params.id === 'create') return next();
  const base = await getAdminData(req);
  const dept = await db.queryOne(`
    SELECT d.*, s.firstname, s.lastname, sla.name as sla_name
    FROM ${db.table('department')} d
    LEFT JOIN ${db.table('staff')} s ON d.manager_id = s.staff_id
    LEFT JOIN ${db.table('sla')} sla ON d.sla_id = sla.id
    WHERE d.id = ?
  `, [req.params.id]);

  if (!dept) return res.send(renderAdminPage('Not Found', '<p>Department not found.</p>', base, 'departments'));

  const staffCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = ?`, [req.params.id]);
  const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} t JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id WHERE t.dept_id = ? AND ts.state = 'open'`, [req.params.id]);

  const content = `
    <div class="detail-view">
      <h2>${escapeHtml(dept.name)}</h2>
      <div class="detail-meta">
        <p><strong>Path:</strong> ${escapeHtml(dept.path || '/')}</p>
        <p><strong>Manager:</strong> ${dept.manager_id ? escapeHtml(`${dept.firstname} ${dept.lastname}`.trim()) : 'None'}</p>
        <p><strong>SLA:</strong> ${escapeHtml(dept.sla_name || 'Default')}</p>
        <p><strong>Visibility:</strong> ${dept.ispublic ? 'Public' : 'Private'}</p>
        <p><strong>Active Staff:</strong> ${staffCount || 0}</p>
        <p><strong>Open Tickets:</strong> ${ticketCount || 0}</p>
      </div>
      <div class="detail-actions">
        <a href="/admin/departments" class="btn">&larr; Back</a>
        ${base.isAdmin ? `
          <a href="/admin/departments/${dept.id}/edit" class="btn btn-primary">Edit</a>
          <form method="POST" action="/admin/departments/${dept.id}/delete" style="display:inline" onsubmit="return confirm('Delete this department?')">
            <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderAdminPage(dept.name, content, base, 'departments'));
}));

// ══════════════════════════════════════════
// Team Detail View (with member management)
// ══════════════════════════════════════════

router.get('/teams/:id', asyncHandler(async (req, res, next) => {
  if (req.params.id === 'create') return next();
  const base = await getAdminData(req);
  const team = await db.queryOne(`
    SELECT t.*, s.firstname, s.lastname
    FROM ${db.table('team')} t
    LEFT JOIN ${db.table('staff')} s ON t.lead_id = s.staff_id
    WHERE t.team_id = ?
  `, [req.params.id]);

  if (!team) return res.send(renderAdminPage('Not Found', '<p>Team not found.</p>', base, 'teams'));

  const members = await db.query(`
    SELECT s.staff_id, s.firstname, s.lastname, s.email
    FROM ${db.table('team_member')} tm
    JOIN ${db.table('staff')} s ON tm.staff_id = s.staff_id
    WHERE tm.team_id = ?
  `, [req.params.id]);

  const allStaff = base.isAdmin ? await db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY lastname`) : [];
  const memberIds = new Set(members.map(m => m.staff_id));
  const availableStaff = allStaff.filter(s => !memberIds.has(s.staff_id));
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <div class="detail-view">
      <h2>${escapeHtml(team.name)}</h2>
      <div class="detail-meta">
        <p><strong>Lead:</strong> ${team.lead_id ? escapeHtml(`${team.firstname} ${team.lastname}`.trim()) : 'None'}</p>
        <p><strong>Notes:</strong> ${escapeHtml(team.notes || 'None')}</p>
        <p><strong>Members:</strong> ${members.length}</p>
      </div>

      <h3>Members</h3>
      ${members.length > 0 ? `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Actions</th></tr></thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td>${escapeHtml(`${m.firstname} ${m.lastname}`.trim())}</td>
                <td>${escapeHtml(m.email || '')}</td>
                <td>
                  ${base.isAdmin ? `
                    <form method="POST" action="/admin/teams/${team.team_id}/members/${m.staff_id}/remove" style="display:inline">
                      <input type="hidden" name="_csrf" value="${csrfToken}">
                      <button type="submit" class="btn btn-sm btn-danger">Remove</button>
                    </form>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p>No members.</p>'}

      ${base.isAdmin && availableStaff.length > 0 ? `
        <h3>Add Member</h3>
        <form method="POST" action="/admin/teams/${team.team_id}/members" class="filter-form">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <select name="staff_id">${availableStaff.map(s => `<option value="${s.staff_id}">${escapeHtml(`${s.firstname} ${s.lastname}`.trim())}</option>`).join('')}</select>
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
      ` : ''}

      <div class="detail-actions" style="margin-top:20px">
        <a href="/admin/teams" class="btn">&larr; Back</a>
        ${base.isAdmin ? `
          <a href="/admin/teams/${team.team_id}/edit" class="btn btn-primary">Edit</a>
          <form method="POST" action="/admin/teams/${team.team_id}/delete" style="display:inline" onsubmit="return confirm('Delete this team?')">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderAdminPage(team.name, content, base, 'teams'));
}));

// ══════════════════════════════════════════
// Organization Detail View
// ══════════════════════════════════════════

router.get('/organizations/:id', asyncHandler(async (req, res, next) => {
  if (req.params.id === 'create') return next();
  const base = await getAdminData(req);
  const org = await db.queryOne(`SELECT * FROM ${db.table('organization')} WHERE id = ?`, [req.params.id]);

  if (!org) return res.send(renderAdminPage('Not Found', '<p>Organization not found.</p>', base, 'organizations'));

  const userCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = ?`, [req.params.id]);

  const content = `
    <div class="detail-view">
      <h2>${escapeHtml(org.name)}</h2>
      <div class="detail-meta">
        <p><strong>Domain:</strong> ${escapeHtml(org.domain || 'None')}</p>
        <p><strong>Status:</strong> ${org.status === 0 ? 'Active' : 'Inactive'}</p>
        <p><strong>Users:</strong> ${userCount || 0}</p>
        <p><strong>Created:</strong> ${formatDate(org.created)}</p>
      </div>
      <div class="detail-actions">
        <a href="/admin/organizations" class="btn">&larr; Back</a>
        ${base.isAdmin ? `
          <a href="/admin/organizations/${org.id}/edit" class="btn btn-primary">Edit</a>
          <form method="POST" action="/admin/organizations/${org.id}/delete" style="display:inline" onsubmit="return confirm('Delete this organization?')">
            <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
            <button type="submit" class="btn btn-danger">Delete</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderAdminPage(org.name, content, base, 'organizations'));
}));

// ══════════════════════════════════════════
// Staff CRUD Forms
// ══════════════════════════════════════════

router.get('/staff/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const depts = await db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`);
  const roles = await db.query(`SELECT id, name FROM ${db.table('role')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/staff">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Username *</label><input type="text" name="username" required minlength="3" maxlength="32"></div>
      <div class="form-group"><label>First Name *</label><input type="text" name="firstname" required></div>
      <div class="form-group"><label>Last Name *</label><input type="text" name="lastname" required></div>
      <div class="form-group"><label>Email *</label><input type="email" name="email" required></div>
      <div class="form-group"><label>Password *</label><input type="password" name="password" required minlength="8"></div>
      <div class="form-group"><label>Department *</label>
        <select name="dept_id" required>${depts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Role *</label>
        <select name="role_id" required>${roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Phone</label><input type="text" name="phone"></div>
      <div class="form-group"><label><input type="checkbox" name="isadmin" value="1"> Administrator</label></div>
      <div class="form-group"><label><input type="checkbox" name="isactive" value="1" checked> Active</label></div>
      <button type="submit" class="btn btn-primary">Create Staff</button>
      <a href="/admin/staff" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create Staff', content, base, 'staff'));
}));

router.post('/staff', requireAdmin, asyncHandler(async (req, res) => {
  const { username, firstname, lastname, email, password, dept_id, role_id, phone, isadmin, isactive } = req.body;

  // Validate uniqueness
  const existing = await db.queryOne(`SELECT staff_id FROM ${db.table('staff')} WHERE username = ?`, [username.trim()]);
  if (existing) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', `<p class="error">Username "${escapeHtml(username)}" already exists.</p><p><a href="/admin/staff/create" class="btn">Back</a></p>`, base, 'staff'));
  }

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  const result = await db.query(`
    INSERT INTO ${db.table('staff')} (username, firstname, lastname, email, passwd, dept_id, role_id, phone, isadmin, isactive, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [username.trim(), firstname.trim(), lastname.trim(), email.trim(), hash, dept_id, role_id, phone || null, isadmin ? 1 : 0, isactive ? 1 : 0, now, now]);
  res.redirect(`/admin/staff/${result.insertId}`);
}));

router.get('/staff/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const staff = await db.queryOne(`SELECT * FROM ${db.table('staff')} WHERE staff_id = ?`, [req.params.id]);
  if (!staff) return res.send(renderAdminPage('Not Found', '<p>Staff not found.</p>', base, 'staff'));

  const depts = await db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`);
  const roles = await db.query(`SELECT id, name FROM ${db.table('role')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/staff/${staff.staff_id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Username</label><input type="text" name="username" value="${escapeHtml(staff.username)}" required></div>
      <div class="form-group"><label>First Name</label><input type="text" name="firstname" value="${escapeHtml(staff.firstname || '')}" required></div>
      <div class="form-group"><label>Last Name</label><input type="text" name="lastname" value="${escapeHtml(staff.lastname || '')}" required></div>
      <div class="form-group"><label>Email</label><input type="email" name="email" value="${escapeHtml(staff.email || '')}" required></div>
      <div class="form-group"><label>New Password (leave blank to keep)</label><input type="password" name="password" minlength="8"></div>
      <div class="form-group"><label>Department</label>
        <select name="dept_id">${depts.map(d => `<option value="${d.id}" ${d.id === staff.dept_id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Role</label>
        <select name="role_id">${roles.map(r => `<option value="${r.id}" ${r.id === staff.role_id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Phone</label><input type="text" name="phone" value="${escapeHtml(staff.phone || '')}"></div>
      <div class="form-group"><label><input type="checkbox" name="isadmin" value="1" ${staff.isadmin ? 'checked' : ''}> Administrator</label></div>
      <div class="form-group"><label><input type="checkbox" name="isactive" value="1" ${staff.isactive ? 'checked' : ''}> Active</label></div>
      <button type="submit" class="btn btn-primary">Update Staff</button>
      <a href="/admin/staff/${staff.staff_id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit Staff', content, base, 'staff'));
}));

router.post('/staff/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { username, firstname, lastname, email, password, dept_id, role_id, phone, isadmin, isactive } = req.body;
  const updates = ['username = ?', 'firstname = ?', 'lastname = ?', 'email = ?', 'dept_id = ?', 'role_id = ?', 'phone = ?', 'isadmin = ?', 'isactive = ?', 'updated = ?'];
  const params = [username.trim(), firstname.trim(), lastname.trim(), email.trim(), dept_id, role_id, phone || null, isadmin ? 1 : 0, isactive ? 1 : 0, new Date()];

  if (password && password.length >= 8) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    updates.push('passwd = ?');
    params.push(hash);
  }

  params.push(req.params.id);
  await db.query(`UPDATE ${db.table('staff')} SET ${updates.join(', ')} WHERE staff_id = ?`, params);
  res.redirect(`/admin/staff/${req.params.id}`);
}));

router.post('/staff/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE staff_id = ?`, [id]);
  if (parseInt(ticketCount || 0, 10) > 0) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', '<p class="error">Cannot delete: staff has assigned tickets.</p><p><a href="/admin/staff" class="btn">Back</a></p>', base, 'staff'));
  }
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('staff_dept_access')} WHERE staff_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('team_member')} WHERE staff_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('staff')} WHERE staff_id = ?`, [id]);
  });
  res.redirect('/admin/staff');
}));

// ══════════════════════════════════════════
// Organization CRUD Forms
// ══════════════════════════════════════════

router.get('/organizations/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';
  const content = `
    <form method="POST" action="/admin/organizations">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name *</label><input type="text" name="name" required maxlength="128"></div>
      <div class="form-group"><label>Domain</label><input type="text" name="domain"></div>
      <button type="submit" class="btn btn-primary">Create Organization</button>
      <a href="/admin/organizations" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create Organization', content, base, 'organizations'));
}));

router.post('/organizations', requireAdmin, asyncHandler(async (req, res) => {
  const { name, domain } = req.body;

  // Validate name uniqueness
  const existing = await db.queryOne(`SELECT id FROM ${db.table('organization')} WHERE name = ?`, [name.trim()]);
  if (existing) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', `<p class="error">Organization "${escapeHtml(name)}" already exists.</p><p><a href="/admin/organizations/create" class="btn">Back</a></p>`, base, 'organizations'));
  }

  const now = new Date();
  const result = await db.query(`INSERT INTO ${db.table('organization')} (name, domain, status, created, updated) VALUES (?, ?, 0, ?, ?)`,
    [name.trim(), domain || null, now, now]);
  res.redirect(`/admin/organizations/${result.insertId}`);
}));

router.get('/organizations/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const org = await db.queryOne(`SELECT * FROM ${db.table('organization')} WHERE id = ?`, [req.params.id]);
  if (!org) return res.send(renderAdminPage('Not Found', '<p>Organization not found.</p>', base, 'organizations'));

  const csrfToken = req.csrfToken ? req.csrfToken() : '';
  const content = `
    <form method="POST" action="/admin/organizations/${org.id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(org.name)}" required maxlength="128"></div>
      <div class="form-group"><label>Domain</label><input type="text" name="domain" value="${escapeHtml(org.domain || '')}"></div>
      <div class="form-group"><label>Status</label>
        <select name="status"><option value="0" ${org.status === 0 ? 'selected' : ''}>Active</option><option value="1" ${org.status === 1 ? 'selected' : ''}>Inactive</option></select>
      </div>
      <button type="submit" class="btn btn-primary">Update Organization</button>
      <a href="/admin/organizations/${org.id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit Organization', content, base, 'organizations'));
}));

router.post('/organizations/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, domain, status } = req.body;
  await db.query(`UPDATE ${db.table('organization')} SET name = ?, domain = ?, status = ?, updated = ? WHERE id = ?`,
    [name.trim(), domain || null, parseInt(status, 10) || 0, new Date(), req.params.id]);
  res.redirect(`/admin/organizations/${req.params.id}`);
}));

router.post('/organizations/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const userCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('user')} WHERE org_id = ?`, [req.params.id]);
  if (parseInt(userCount || 0, 10) > 0) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', '<p class="error">Cannot delete: users are assigned to this organization.</p><p><a href="/admin/organizations" class="btn">Back</a></p>', base, 'organizations'));
  }
  await db.query(`DELETE FROM ${db.table('organization')} WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/organizations');
}));

// ══════════════════════════════════════════
// Department CRUD Forms
// ══════════════════════════════════════════

router.get('/departments/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const depts = await db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`);
  const staff = await db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY lastname`);
  const slas = await db.query(`SELECT id, name FROM ${db.table('sla')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/departments">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name *</label><input type="text" name="name" required></div>
      <div class="form-group"><label>Parent Department</label>
        <select name="pid"><option value="0">None (Top Level)</option>${depts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Manager</label>
        <select name="manager_id"><option value="0">None</option>${staff.map(s => `<option value="${s.staff_id}">${escapeHtml(`${s.firstname} ${s.lastname}`.trim())}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>SLA Plan</label>
        <select name="sla_id"><option value="0">Default</option>${slas.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label><input type="checkbox" name="ispublic" value="1" checked> Public</label></div>
      <button type="submit" class="btn btn-primary">Create Department</button>
      <a href="/admin/departments" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create Department', content, base, 'departments'));
}));

router.post('/departments', requireAdmin, asyncHandler(async (req, res) => {
  const { name, pid, manager_id, sla_id, ispublic } = req.body;
  let path = `/${name.trim()}`;
  if (parseInt(pid, 10)) {
    const parent = await db.queryOne(`SELECT path FROM ${db.table('department')} WHERE id = ?`, [pid]);
    if (parent) path = `${parent.path}/${name.trim()}`;
  }
  const now = new Date();
  const result = await db.query(`INSERT INTO ${db.table('department')} (pid, name, path, manager_id, sla_id, ispublic, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [parseInt(pid, 10) || 0, name.trim(), path, parseInt(manager_id, 10) || 0, parseInt(sla_id, 10) || 0, ispublic ? 1 : 0, now, now]);
  res.redirect(`/admin/departments/${result.insertId}`);
}));

router.get('/departments/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const dept = await db.queryOne(`SELECT * FROM ${db.table('department')} WHERE id = ?`, [req.params.id]);
  if (!dept) return res.send(renderAdminPage('Not Found', '<p>Department not found.</p>', base, 'departments'));

  const depts = await db.query(`SELECT id, name FROM ${db.table('department')} WHERE id != ? ORDER BY name`, [req.params.id]);
  const staff = await db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY lastname`);
  const slas = await db.query(`SELECT id, name FROM ${db.table('sla')} ORDER BY name`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/departments/${dept.id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(dept.name)}" required></div>
      <div class="form-group"><label>Parent Department</label>
        <select name="pid"><option value="0">None (Top Level)</option>${depts.map(d => `<option value="${d.id}" ${d.id === dept.pid ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Manager</label>
        <select name="manager_id"><option value="0">None</option>${staff.map(s => `<option value="${s.staff_id}" ${s.staff_id === dept.manager_id ? 'selected' : ''}>${escapeHtml(`${s.firstname} ${s.lastname}`.trim())}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>SLA Plan</label>
        <select name="sla_id"><option value="0">Default</option>${slas.map(s => `<option value="${s.id}" ${s.id === dept.sla_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label><input type="checkbox" name="ispublic" value="1" ${dept.ispublic ? 'checked' : ''}> Public</label></div>
      <button type="submit" class="btn btn-primary">Update Department</button>
      <a href="/admin/departments/${dept.id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit Department', content, base, 'departments'));
}));

router.post('/departments/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, pid, manager_id, sla_id, ispublic } = req.body;
  const deptId = req.params.id;
  const newPid = parseInt(pid, 10) || 0;
  let newPath = `/${name.trim()}`;
  if (newPid) {
    const parent = await db.queryOne(`SELECT path FROM ${db.table('department')} WHERE id = ?`, [newPid]);
    if (parent) newPath = `${parent.path}/${name.trim()}`;
  }

  // Get old path for descendant recalculation
  const oldDept = await db.queryOne(`SELECT path FROM ${db.table('department')} WHERE id = ?`, [deptId]);

  await db.transaction(async (txQuery) => {
    await txQuery(`UPDATE ${db.table('department')} SET name = ?, pid = ?, path = ?, manager_id = ?, sla_id = ?, ispublic = ?, updated = ? WHERE id = ?`,
      [name.trim(), newPid, newPath, parseInt(manager_id, 10) || 0, parseInt(sla_id, 10) || 0, ispublic ? 1 : 0, new Date(), deptId]);

    // Recalculate descendant paths if path changed
    if (oldDept && newPath !== oldDept.path) {
      const descendants = await txQuery(`SELECT id, path FROM ${db.table('department')} WHERE path LIKE ?`, [`${oldDept.path}/%`]);
      for (const desc of descendants) {
        const updatedPath = desc.path.replace(oldDept.path, newPath);
        await txQuery(`UPDATE ${db.table('department')} SET path = ? WHERE id = ?`, [updatedPath, desc.id]);
      }
    }
  });

  res.redirect(`/admin/departments/${deptId}`);
}));

router.post('/departments/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const checks = [
    { sql: `SELECT COUNT(*) FROM ${db.table('department')} WHERE pid = ?`, msg: 'has child departments' },
    { sql: `SELECT COUNT(*) FROM ${db.table('staff')} WHERE dept_id = ?`, msg: 'has staff members' },
    { sql: `SELECT COUNT(*) FROM ${db.table('ticket')} WHERE dept_id = ?`, msg: 'has tickets' }
  ];
  for (const check of checks) {
    const count = await db.queryValue(check.sql, [id]);
    if (parseInt(count || 0, 10) > 0) {
      const base = await getAdminData(req);
      return res.status(400).send(renderAdminPage('Error', `<p class="error">Cannot delete: ${check.msg}.</p><p><a href="/admin/departments" class="btn">Back</a></p>`, base, 'departments'));
    }
  }
  await db.query(`DELETE FROM ${db.table('department')} WHERE id = ?`, [id]);
  res.redirect('/admin/departments');
}));

// ══════════════════════════════════════════
// Team CRUD Forms
// ══════════════════════════════════════════

router.get('/teams/create', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const staff = await db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY lastname`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/teams">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name *</label><input type="text" name="name" required></div>
      <div class="form-group"><label>Team Lead</label>
        <select name="lead_id"><option value="0">None</option>${staff.map(s => `<option value="${s.staff_id}">${escapeHtml(`${s.firstname} ${s.lastname}`.trim())}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3"></textarea></div>
      <button type="submit" class="btn btn-primary">Create Team</button>
      <a href="/admin/teams" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Create Team', content, base, 'teams'));
}));

router.post('/teams', requireAdmin, asyncHandler(async (req, res) => {
  const { name, lead_id, notes } = req.body;
  const now = new Date();
  const result = await db.query(`INSERT INTO ${db.table('team')} (name, lead_id, flags, notes, created, updated) VALUES (?, ?, 0, ?, ?, ?)`,
    [name.trim(), parseInt(lead_id, 10) || 0, notes || null, now, now]);
  res.redirect(`/admin/teams/${result.insertId}`);
}));

router.get('/teams/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const team = await db.queryOne(`SELECT * FROM ${db.table('team')} WHERE team_id = ?`, [req.params.id]);
  if (!team) return res.send(renderAdminPage('Not Found', '<p>Team not found.</p>', base, 'teams'));

  const staff = await db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY lastname`);
  const csrfToken = req.csrfToken ? req.csrfToken() : '';

  const content = `
    <form method="POST" action="/admin/teams/${team.team_id}">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(team.name)}" required></div>
      <div class="form-group"><label>Team Lead</label>
        <select name="lead_id"><option value="0">None</option>${staff.map(s => `<option value="${s.staff_id}" ${s.staff_id === team.lead_id ? 'selected' : ''}>${escapeHtml(`${s.firstname} ${s.lastname}`.trim())}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(team.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">Update Team</button>
      <a href="/admin/teams/${team.team_id}" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage('Edit Team', content, base, 'teams'));
}));

router.post('/teams/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, lead_id, notes } = req.body;
  await db.query(`UPDATE ${db.table('team')} SET name = ?, lead_id = ?, notes = ?, updated = ? WHERE team_id = ?`,
    [name.trim(), parseInt(lead_id, 10) || 0, notes || null, new Date(), req.params.id]);
  res.redirect(`/admin/teams/${req.params.id}`);
}));

router.post('/teams/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const ticketCount = await db.queryValue(`SELECT COUNT(*) FROM ${db.table('ticket')} WHERE team_id = ?`, [id]);
  if (parseInt(ticketCount || 0, 10) > 0) {
    const base = await getAdminData(req);
    return res.status(400).send(renderAdminPage('Error', '<p class="error">Cannot delete: team has tickets.</p><p><a href="/admin/teams" class="btn">Back</a></p>', base, 'teams'));
  }
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('team_member')} WHERE team_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('team')} WHERE team_id = ?`, [id]);
  });
  res.redirect('/admin/teams');
}));

// Team member management
router.post('/teams/:id/members', requireAdmin, asyncHandler(async (req, res) => {
  const { staff_id } = req.body;
  const existing = await db.queryOne(`SELECT staff_id FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?`, [req.params.id, staff_id]);
  if (!existing) {
    await db.query(`INSERT INTO ${db.table('team_member')} (team_id, staff_id, flags) VALUES (?, ?, 0)`, [req.params.id, staff_id]);
  }
  res.redirect(`/admin/teams/${req.params.id}`);
}));

router.post('/teams/:id/members/:staffId/remove', requireAdmin, asyncHandler(async (req, res) => {
  await db.query(`DELETE FROM ${db.table('team_member')} WHERE team_id = ? AND staff_id = ?`, [req.params.id, req.params.staffId]);
  res.redirect(`/admin/teams/${req.params.id}`);
}));

module.exports = router;
