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

const requireAdminSession = (req, res, next) => {
  if (!req.session?.user || req.session.user.type !== 'staff' || !req.session.user.isAdmin) {
    return res.redirect('/admin');
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
      ${base.isAdmin ? `<a href="/admin/settings" class="${activeNav === 'settings' ? 'active' : ''}">Settings</a>` : ''}
      <a href="/admin/email-templates" class="${activeNav === 'email-templates' ? 'active' : ''}">Email Templates</a>
      <a href="/admin/canned-responses" class="${activeNav === 'canned-responses' ? 'active' : ''}">Canned Responses</a>
      ${base.isAdmin ? `<a href="/admin/filters" class="${activeNav === 'filters' ? 'active' : ''}">Filters</a>` : ''}
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

    const createBtn = base.isAdmin ? `<div style="margin-bottom:1em"><a href="/admin/topics/create/edit" class="btn btn-primary">Create Topic</a></div>` : '';

    if (topics.length > 0) {
      topicsHtml = createBtn + `
        <table class="data-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Department</th>
              <th>Visibility</th>
              ${base.isAdmin ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${topics.map(t => `
              <tr>
                <td><a href="/admin/topics/${t.topic_id}">${escapeHtml(t.topic)}</a></td>
                <td>${escapeHtml(t.dept_name || 'Default')}</td>
                <td>${t.ispublic ? 'Public' : 'Private'}</td>
                ${base.isAdmin ? `<td><a href="/admin/topics/${t.topic_id}/edit">Edit</a></td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      topicsHtml = createBtn + topicsHtml;
    }
  } catch (e) {
    console.error('Error loading topics:', e);
    topicsHtml = '<p class="error">Error loading topics.</p>';
  }

  res.send(renderAdminPage('Help Topics', topicsHtml, base, 'topics'));
}));

/**
 * Help topic detail (admin)
 */
router.get('/topics/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  if (id === 'create') return res.redirect('/admin/topics/create/edit');

  const topic = await db.queryOne(`
    SELECT ht.*, d.name as dept_name, p.topic as parent_topic,
           tp.priority_desc as priority_name, sla.name as sla_name
    FROM ${db.table('help_topic')} ht
    LEFT JOIN ${db.table('department')} d ON ht.dept_id = d.id
    LEFT JOIN ${db.table('help_topic')} p ON ht.topic_pid = p.topic_id
    LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
    LEFT JOIN ${db.table('sla')} sla ON ht.sla_id = sla.id
    WHERE ht.topic_id = ?
  `, [id]);
  if (!topic) return res.redirect('/admin/topics');

  const childCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('help_topic')} WHERE topic_pid = ?`, [id]);
  const ticketCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('ticket')} WHERE topic_id = ?`, [id]);

  const error = req.query.error;
  const errorMap = {
    'has-children': 'Cannot delete — topic has child topics.',
    'has-tickets': 'Cannot delete — topic has existing tickets.',
  };
  const errorHtml = error && errorMap[error] ? `<div class="alert alert-danger">${errorMap[error]}</div>` : '';

  const content = `
    <h2>${escapeHtml(topic.topic)}</h2>
    ${errorHtml}
    <dl class="detail-grid">
      <dt>Parent</dt><dd>${escapeHtml(topic.parent_topic || 'None')}</dd>
      <dt>Department</dt><dd>${escapeHtml(topic.dept_name || 'Default')}</dd>
      <dt>Priority</dt><dd>${escapeHtml(topic.priority_name || 'Default')}</dd>
      <dt>SLA</dt><dd>${escapeHtml(topic.sla_name || 'None')}</dd>
      <dt>Visibility</dt><dd>${topic.ispublic ? 'Public' : 'Private'}</dd>
      <dt>Active</dt><dd>${topic.flags & 1 ? 'Yes' : 'No'}</dd>
      <dt>Child Topics</dt><dd>${childCount?.count || 0}</dd>
      <dt>Tickets</dt><dd>${ticketCount?.count || 0}</dd>
      <dt>Notes</dt><dd>${escapeHtml(topic.notes || '—')}</dd>
    </dl>
    ${base.isAdmin ? `
      <div style="margin-top:1em">
        <a href="/admin/topics/${topic.topic_id}/edit" class="btn btn-primary">Edit</a>
        <form method="POST" action="/admin/topics/${topic.topic_id}/delete" style="display:inline" onsubmit="return confirm('Delete this topic?')">
          <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
          <button type="submit" class="btn btn-danger">Delete</button>
        </form>
      </div>
    ` : ''}
    <p style="margin-top:1em"><a href="/admin/topics">← Back to topics</a></p>
  `;
  res.send(renderAdminPage(topic.topic, content, base, 'topics'));
}));

/**
 * Help topic create/edit form (admin)
 */
router.get('/topics/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const isCreate = id === 'create';

  let topic = {
    topic_id: null, topic: '', topic_pid: 0, dept_id: 0, priority_id: 0,
    sla_id: 0, ispublic: 1, noautoresp: 0, flags: 1, notes: ''
  };

  if (!isCreate) {
    const existing = await db.queryOne(`SELECT * FROM ${db.table('help_topic')} WHERE topic_id = ?`, [id]);
    if (!existing) return res.redirect('/admin/topics');
    topic = existing;
  }

  const [parents, depts, priorities, slas] = await Promise.all([
    db.query(`SELECT topic_id, topic FROM ${db.table('help_topic')} ORDER BY topic`),
    db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`),
    db.query(`SELECT priority_id, priority_desc FROM ${db.table('ticket_priority')} ORDER BY priority_desc`).catch(() => []),
    db.query(`SELECT id, name FROM ${db.table('sla')} ORDER BY name`).catch(() => []),
  ]);

  const selectOpts = (items, value, labelField, valueField) =>
    `<option value="">— None —</option>` + items.map(i =>
      `<option value="${i[valueField]}" ${String(topic[value]) === String(i[valueField]) ? 'selected' : ''}>${escapeHtml(i[labelField])}</option>`
    ).join('');

  const action = isCreate ? '/admin/topics/create' : `/admin/topics/${topic.topic_id}/update`;
  const content = `
    <h2>${isCreate ? 'Create' : 'Edit'} Help Topic</h2>
    <form method="POST" action="${action}">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group"><label>Topic Name</label><input type="text" name="topic" value="${escapeHtml(topic.topic)}" maxlength="128" required></div>
      <div class="form-group"><label>Parent Topic</label><select name="topic_pid">${selectOpts(parents.filter(p => p.topic_id !== topic.topic_id), 'topic_pid', 'topic', 'topic_id')}</select></div>
      <div class="form-group"><label>Department</label><select name="dept_id">${selectOpts(depts, 'dept_id', 'name', 'id')}</select></div>
      <div class="form-group"><label>Priority</label><select name="priority_id">${selectOpts(priorities, 'priority_id', 'priority_desc', 'priority_id')}</select></div>
      <div class="form-group"><label>SLA Plan</label><select name="sla_id">${selectOpts(slas, 'sla_id', 'name', 'id')}</select></div>
      <div class="form-group"><label><input type="checkbox" name="ispublic" ${topic.ispublic ? 'checked' : ''}> Public</label></div>
      <div class="form-group"><label><input type="checkbox" name="noautoresp" ${topic.noautoresp ? 'checked' : ''}> Disable auto-response</label></div>
      <div class="form-group"><label><input type="checkbox" name="isactive" ${(topic.flags & 1) ? 'checked' : ''}> Active</label></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="4">${escapeHtml(topic.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
      <a href="/admin/topics" class="btn">Cancel</a>
      ${!isCreate ? `<button type="submit" formaction="/admin/topics/${topic.topic_id}/delete" class="btn btn-danger" onclick="return confirm('Delete this topic?')">Delete</button>` : ''}
    </form>
  `;
  res.send(renderAdminPage(isCreate ? 'Create Topic' : 'Edit Topic', content, base, 'topics'));
}));

router.post('/topics/create', requireAdminSession, asyncHandler(async (req, res) => {
  const { topic, topic_pid, dept_id, priority_id, sla_id, ispublic, noautoresp, isactive, notes } = req.body;
  if (!topic || !topic.trim()) return res.redirect('/admin/topics/create/edit');

  const parentId = parseInt(topic_pid, 10) || 0;
  const dup = await db.queryOne(
    `SELECT topic_id FROM ${db.table('help_topic')} WHERE LOWER(topic) = LOWER(?) AND topic_pid = ?`,
    [topic.trim(), parentId]
  );
  if (dup) return res.redirect('/admin/topics/create/edit?error=duplicate');

  const now = new Date();
  await db.query(
    `INSERT INTO ${db.table('help_topic')}
     (topic_pid, topic, ispublic, noautoresp, flags, sort, dept_id, priority_id, sla_id, staff_id, team_id, notes, created, updated)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?)`,
    [
      parentId, topic.trim(),
      ispublic ? 1 : 0, noautoresp ? 1 : 0, isactive ? 1 : 0,
      parseInt(dept_id, 10) || 0,
      parseInt(priority_id, 10) || 0,
      parseInt(sla_id, 10) || 0,
      notes || null, now, now
    ]
  );
  res.redirect('/admin/topics');
}));

router.post('/topics/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { topic, topic_pid, dept_id, priority_id, sla_id, ispublic, noautoresp, isactive, notes } = req.body;
  const existing = await db.queryOne(`SELECT topic_id FROM ${db.table('help_topic')} WHERE topic_id = ?`, [id]);
  if (!existing) return res.redirect('/admin/topics');

  const newParent = parseInt(topic_pid, 10) || 0;
  if (newParent === parseInt(id, 10)) return res.redirect(`/admin/topics/${id}/edit?error=self-parent`);

  await db.query(
    `UPDATE ${db.table('help_topic')} SET
       topic = ?, topic_pid = ?, dept_id = ?, priority_id = ?, sla_id = ?,
       ispublic = ?, noautoresp = ?, flags = ?, notes = ?, updated = ?
     WHERE topic_id = ?`,
    [
      topic.trim(), newParent,
      parseInt(dept_id, 10) || 0, parseInt(priority_id, 10) || 0, parseInt(sla_id, 10) || 0,
      ispublic ? 1 : 0, noautoresp ? 1 : 0, isactive ? 1 : 0,
      notes || null, new Date(), id
    ]
  );
  res.redirect(`/admin/topics/${id}`);
}));

router.post('/topics/:id/delete', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const children = await db.queryOne(
    `SELECT COUNT(*) as count FROM ${db.table('help_topic')} WHERE topic_pid = ?`, [id]
  );
  if (parseInt(children?.count || 0, 10) > 0) return res.redirect(`/admin/topics/${id}?error=has-children`);

  const tickets = await db.queryOne(
    `SELECT COUNT(*) as count FROM ${db.table('ticket')} WHERE topic_id = ?`, [id]
  );
  if (parseInt(tickets?.count || 0, 10) > 0) return res.redirect(`/admin/topics/${id}?error=has-tickets`);

  await db.query(`DELETE FROM ${db.table('help_topic')} WHERE topic_id = ?`, [id]);
  res.redirect('/admin/topics');
}));

/**
 * SLA list
 */
router.get('/sla', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let slaHtml = '<p>No SLA plans found.</p>';
  const createBtn = base.isAdmin ? `<div style="margin-bottom:1em"><a href="/admin/sla/create/edit" class="btn btn-primary">Create SLA Plan</a></div>` : '';

  try {
    const slas = await db.query(`SELECT * FROM ${db.table('sla')} ORDER BY name`);

    if (slas.length > 0) {
      slaHtml = createBtn + `
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Grace Period</th>
              <th>Status</th>
              ${base.isAdmin ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${slas.map(s => `
              <tr>
                <td><a href="/admin/sla/${s.id}">${escapeHtml(s.name)}</a></td>
                <td>${s.grace_period} hours</td>
                <td>${s.flags & 1 ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
                ${base.isAdmin ? `<td><a href="/admin/sla/${s.id}/edit">Edit</a></td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      slaHtml = createBtn + slaHtml;
    }
  } catch (e) {
    console.error('Error loading SLAs:', e);
    slaHtml = '<p class="error">Error loading SLA plans.</p>';
  }

  res.send(renderAdminPage('SLA Plans', slaHtml, base, 'sla'));
}));

/**
 * SLA detail (admin)
 */
router.get('/sla/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  if (id === 'create') return res.redirect('/admin/sla/create/edit');

  const sla = await db.queryOne(`SELECT * FROM ${db.table('sla')} WHERE id = ?`, [id]);
  if (!sla) return res.redirect('/admin/sla');

  const deptCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('department')} WHERE sla_id = ?`, [id]);
  const topicCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('help_topic')} WHERE sla_id = ?`, [id]);
  const ticketCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('ticket')} WHERE sla_id = ?`, [id]);

  const error = req.query.error;
  const errorMsg = error === 'referenced' ? '<div class="alert alert-danger">Cannot delete — SLA is referenced by departments, topics, or tickets.</div>' : '';

  const content = `
    <h2>${escapeHtml(sla.name)}</h2>
    ${errorMsg}
    <dl class="detail-grid">
      <dt>Grace Period</dt><dd>${sla.grace_period} hours</dd>
      <dt>Active</dt><dd>${sla.flags & 1 ? 'Yes' : 'No'}</dd>
      <dt>Escalate</dt><dd>${sla.flags & 2 ? 'Yes' : 'No'}</dd>
      <dt>No Alerts</dt><dd>${sla.flags & 4 ? 'Yes' : 'No'}</dd>
      <dt>Transient</dt><dd>${sla.flags & 8 ? 'Yes' : 'No'}</dd>
      <dt>Departments using</dt><dd>${deptCount?.count || 0}</dd>
      <dt>Help topics using</dt><dd>${topicCount?.count || 0}</dd>
      <dt>Tickets using</dt><dd>${ticketCount?.count || 0}</dd>
      <dt>Notes</dt><dd>${escapeHtml(sla.notes || '—')}</dd>
    </dl>
    ${base.isAdmin ? `
      <div style="margin-top:1em">
        <a href="/admin/sla/${sla.id}/edit" class="btn btn-primary">Edit</a>
        <form method="POST" action="/admin/sla/${sla.id}/delete" style="display:inline" onsubmit="return confirm('Delete this SLA?')">
          <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
          <button type="submit" class="btn btn-danger">Delete</button>
        </form>
      </div>
    ` : ''}
    <p style="margin-top:1em"><a href="/admin/sla">← Back to SLA plans</a></p>
  `;
  res.send(renderAdminPage(sla.name, content, base, 'sla'));
}));

router.get('/sla/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const isCreate = id === 'create';

  let sla = { id: null, name: '', grace_period: 24, flags: 1, notes: '' };
  if (!isCreate) {
    const existing = await db.queryOne(`SELECT * FROM ${db.table('sla')} WHERE id = ?`, [id]);
    if (!existing) return res.redirect('/admin/sla');
    sla = existing;
  }

  const action = isCreate ? '/admin/sla/create' : `/admin/sla/${sla.id}/update`;
  const content = `
    <h2>${isCreate ? 'Create' : 'Edit'} SLA Plan</h2>
    <form method="POST" action="${action}">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(sla.name)}" maxlength="64" required></div>
      <div class="form-group"><label>Grace Period (hours)</label><input type="number" name="grace_period" value="${sla.grace_period}" min="0" required></div>
      <div class="form-group"><label><input type="checkbox" name="active" ${sla.flags & 1 ? 'checked' : ''}> Active</label></div>
      <div class="form-group"><label><input type="checkbox" name="escalate" ${sla.flags & 2 ? 'checked' : ''}> Escalate</label></div>
      <div class="form-group"><label><input type="checkbox" name="noalerts" ${sla.flags & 4 ? 'checked' : ''}> No Alerts</label></div>
      <div class="form-group"><label><input type="checkbox" name="transient" ${sla.flags & 8 ? 'checked' : ''}> Transient</label></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(sla.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
      <a href="/admin/sla" class="btn">Cancel</a>
    </form>
  `;
  res.send(renderAdminPage(isCreate ? 'Create SLA' : 'Edit SLA', content, base, 'sla'));
}));

const buildSlaFlags = (body) => {
  let f = 0;
  if (body.active) f |= 1;
  if (body.escalate) f |= 2;
  if (body.noalerts) f |= 4;
  if (body.transient) f |= 8;
  return f;
};

router.post('/sla/create', requireAdminSession, asyncHandler(async (req, res) => {
  const { name, grace_period, notes } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/sla/create/edit');

  const dup = await db.queryOne(`SELECT id FROM ${db.table('sla')} WHERE name = ?`, [name.trim()]);
  if (dup) return res.redirect('/admin/sla/create/edit?error=duplicate');

  const now = new Date();
  await db.query(
    `INSERT INTO ${db.table('sla')} (schedule_id, flags, grace_period, name, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [0, buildSlaFlags(req.body), parseInt(grace_period, 10) || 24, name.trim(), notes || null, now, now]
  );
  res.redirect('/admin/sla');
}));

router.post('/sla/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, grace_period, notes } = req.body;
  const existing = await db.queryOne(`SELECT id FROM ${db.table('sla')} WHERE id = ?`, [id]);
  if (!existing) return res.redirect('/admin/sla');

  const dup = await db.queryOne(`SELECT id FROM ${db.table('sla')} WHERE name = ? AND id != ?`, [name.trim(), id]);
  if (dup) return res.redirect(`/admin/sla/${id}/edit?error=duplicate`);

  await db.query(
    `UPDATE ${db.table('sla')} SET name = ?, grace_period = ?, flags = ?, notes = ?, updated = ? WHERE id = ?`,
    [name.trim(), parseInt(grace_period, 10) || 24, buildSlaFlags(req.body), notes || null, new Date(), id]
  );
  res.redirect(`/admin/sla/${id}`);
}));

router.post('/sla/:id/delete', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deptCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('department')} WHERE sla_id = ?`, [id]);
  const topicCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('help_topic')} WHERE sla_id = ?`, [id]);
  const ticketCount = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('ticket')} WHERE sla_id = ?`, [id]);
  const refs = parseInt(deptCount?.count || 0, 10) + parseInt(topicCount?.count || 0, 10) + parseInt(ticketCount?.count || 0, 10);
  if (refs > 0) return res.redirect(`/admin/sla/${id}?error=referenced`);

  await db.query(`DELETE FROM ${db.table('sla')} WHERE id = ?`, [id]);
  res.redirect('/admin/sla');
}));

/**
 * Settings page (admin only)
 */
router.get('/settings', asyncHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) return res.redirect('/admin');
  const base = await getAdminData(req);
  const { SETTINGS_GROUPS } = require('../controllers/settingsController');

  const rows = await db.query(`SELECT \`key\`, value FROM ${db.table('config')}`);
  const configMap = {};
  for (const row of rows) configMap[row.key] = row.value;

  const fkOptions = {};
  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      if (def.type === 'fk') {
        try {
          fkOptions[key] = await db.query(
            `SELECT ${def.valueCol} as value, ${def.labelCol} as label FROM ${db.table(def.table)} ORDER BY ${def.labelCol}`
          );
        } catch (e) {
          fkOptions[key] = [];
        }
      }
    }
  }

  let formHtml = '';
  for (const group of Object.values(SETTINGS_GROUPS)) {
    formHtml += `<h3>${escapeHtml(group.label)}</h3>`;
    for (const [key, def] of Object.entries(group.keys)) {
      const val = configMap[key] || '';
      if (def.type === 'text') {
        formHtml += `<div class="form-group"><label>${escapeHtml(def.label)}</label><input type="text" name="${key}" value="${escapeHtml(val)}"></div>`;
      } else if (def.type === 'number') {
        formHtml += `<div class="form-group"><label>${escapeHtml(def.label)}</label><input type="number" name="${key}" value="${escapeHtml(val)}" min="0"></div>`;
      } else if (def.type === 'toggle') {
        formHtml += `<div class="form-group"><label><input type="checkbox" name="${key}" ${val === '1' ? 'checked' : ''}> ${escapeHtml(def.label)}</label></div>`;
      } else if (def.type === 'fk') {
        const opts = (fkOptions[key] || []).map(o => `<option value="${o.value}" ${String(val) === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        formHtml += `<div class="form-group"><label>${escapeHtml(def.label)}</label><select name="${key}"><option value="">— None —</option>${opts}</select></div>`;
      }
    }
  }

  const saved = req.query.saved ? '<div class="alert alert-success">Settings saved.</div>' : '';
  const content = `<h2>System Settings</h2>${saved}<form method="POST" action="/admin/settings/update"><input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">${formHtml}<button type="submit" class="btn btn-primary">Save Settings</button></form>`;
  res.send(renderAdminPage('Settings', content, base, 'settings'));
}));

router.post('/settings/update', asyncHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) return res.redirect('/admin');
  const { SETTINGS_GROUPS } = require('../controllers/settingsController');

  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      let value = req.body[key];
      if (def.type === 'toggle') value = value ? '1' : '0';
      if (value === undefined || value === null) continue;

      const existing = await db.queryOne(`SELECT id FROM ${db.table('config')} WHERE \`key\` = ?`, [key]);
      if (existing) {
        await db.query(`UPDATE ${db.table('config')} SET value = ?, updated = ? WHERE \`key\` = ?`, [String(value), new Date(), key]);
      } else {
        await db.query(`INSERT INTO ${db.table('config')} (\`namespace\`, \`key\`, value, updated) VALUES (?, ?, ?, ?)`, ['core', key, String(value), new Date()]);
      }
    }
  }
  res.redirect('/admin/settings?saved=1');
}));

/**
 * Email Templates — group list
 */
router.get('/email-templates', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const groups = await db.query(
    `SELECT etg.*, (SELECT COUNT(*) FROM ${db.table('email_template')} et WHERE et.tpl_id = etg.tpl_id) as template_count
     FROM ${db.table('email_template_group')} etg ORDER BY etg.name`
  );
  const createBtn = base.isAdmin ? `<div style="margin-bottom:1em"><a href="/admin/email-templates/groups/create/edit" class="btn btn-primary">Create Group</a></div>` : '';

  let html;
  if (groups.length === 0) {
    html = createBtn + '<p>No template groups. Default group is seeded on first server start.</p>';
  } else {
    html = createBtn + `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Active</th><th>Language</th><th>Templates</th>${base.isAdmin ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${groups.map(g => `
            <tr>
              <td><a href="/admin/email-templates/groups/${g.tpl_id}">${escapeHtml(g.name)}</a></td>
              <td>${g.isactive ? 'Yes' : 'No'}</td>
              <td>${escapeHtml(g.lang)}</td>
              <td>${g.template_count}</td>
              ${base.isAdmin ? `<td><a href="/admin/email-templates/groups/${g.tpl_id}/edit">Edit</a></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  res.send(renderAdminPage('Email Templates', html, base, 'email-templates'));
}));

router.get('/email-templates/groups/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const isCreate = id === 'create';
  let group = { tpl_id: null, name: '', isactive: 1, lang: 'en_US', notes: '' };
  if (!isCreate) {
    const row = await db.queryOne(`SELECT * FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
    if (!row) return res.redirect('/admin/email-templates');
    group = row;
  }
  const action = isCreate ? '/admin/email-templates/groups/create' : `/admin/email-templates/groups/${group.tpl_id}/update`;
  const content = `
    <h2>${isCreate ? 'Create' : 'Edit'} Template Group</h2>
    <form method="POST" action="${action}">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(group.name)}" maxlength="32" required></div>
      <div class="form-group"><label><input type="checkbox" name="isactive" ${group.isactive ? 'checked' : ''}> Active</label></div>
      <div class="form-group"><label>Language</label><input type="text" name="lang" value="${escapeHtml(group.lang)}" maxlength="16"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(group.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
      <a href="/admin/email-templates" class="btn">Cancel</a>
      ${!isCreate ? `<button type="submit" formaction="/admin/email-templates/groups/${group.tpl_id}/delete" class="btn btn-danger" onclick="return confirm('Delete this group? Only empty groups can be deleted.')">Delete</button>` : ''}
    </form>
  `;
  res.send(renderAdminPage(isCreate ? 'Create Group' : 'Edit Group', content, base, 'email-templates'));
}));

router.post('/email-templates/groups/create', requireAdminSession, asyncHandler(async (req, res) => {
  const { name, isactive, lang, notes } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/email-templates/groups/create/edit');
  const dup = await db.queryOne(`SELECT tpl_id FROM ${db.table('email_template_group')} WHERE name = ?`, [name.trim()]);
  if (dup) return res.redirect('/admin/email-templates/groups/create/edit?error=duplicate');
  const now = new Date();
  await db.query(
    `INSERT INTO ${db.table('email_template_group')} (isactive, name, lang, notes, created, updated) VALUES (?, ?, ?, ?, ?, ?)`,
    [isactive ? 1 : 0, name.trim(), lang || 'en_US', notes || null, now, now]
  );
  res.redirect('/admin/email-templates');
}));

router.post('/email-templates/groups/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, isactive, lang, notes } = req.body;
  await db.query(
    `UPDATE ${db.table('email_template_group')} SET name = ?, isactive = ?, lang = ?, notes = ?, updated = ? WHERE tpl_id = ?`,
    [name.trim(), isactive ? 1 : 0, lang || 'en_US', notes || null, new Date(), id]
  );
  res.redirect(`/admin/email-templates/groups/${id}`);
}));

router.post('/email-templates/groups/:id/delete', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tpls = await db.queryOne(`SELECT COUNT(*) as count FROM ${db.table('email_template')} WHERE tpl_id = ?`, [id]);
  if (parseInt(tpls?.count || 0, 10) > 0) return res.redirect(`/admin/email-templates/groups/${id}?error=not-empty`);
  await db.query(`DELETE FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  res.redirect('/admin/email-templates');
}));

router.get('/email-templates/groups/:id', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  if (id === 'create') return res.redirect('/admin/email-templates/groups/create/edit');
  const group = await db.queryOne(`SELECT * FROM ${db.table('email_template_group')} WHERE tpl_id = ?`, [id]);
  if (!group) return res.redirect('/admin/email-templates');

  const templates = await db.query(
    `SELECT * FROM ${db.table('email_template')} WHERE tpl_id = ? ORDER BY code_name`, [id]
  );

  const error = req.query.error === 'not-empty' ? '<div class="alert alert-danger">Cannot delete — group has templates.</div>' : '';
  const content = `
    <h2>${escapeHtml(group.name)}</h2>
    ${error}
    <p>${group.isactive ? 'Active' : 'Inactive'} · ${escapeHtml(group.lang)}</p>
    ${base.isAdmin ? `<a href="/admin/email-templates/groups/${group.tpl_id}/edit" class="btn">Edit Group</a>` : ''}
    <h3>Templates</h3>
    <table class="data-table">
      <thead><tr><th>Code</th><th>Subject</th>${base.isAdmin ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>
        ${templates.map(t => `
          <tr>
            <td><code>${escapeHtml(t.code_name)}</code></td>
            <td>${escapeHtml(t.subject)}</td>
            ${base.isAdmin ? `<td><a href="/admin/email-templates/${t.id}/edit">Edit</a></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="margin-top:1em"><a href="/admin/email-templates">← Back to groups</a></p>
  `;
  res.send(renderAdminPage(group.name, content, base, 'email-templates'));
}));

router.get('/email-templates/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const tpl = await db.queryOne(
    `SELECT et.*, etg.name as group_name FROM ${db.table('email_template')} et
     LEFT JOIN ${db.table('email_template_group')} etg ON et.tpl_id = etg.tpl_id WHERE et.id = ?`, [id]
  );
  if (!tpl) return res.redirect('/admin/email-templates');

  const placeholders = ['{{ticket.number}}', '{{ticket.subject}}', '{{user.name}}', '{{user.email}}',
                        '{{staff.name}}', '{{ticket.department}}', '{{ticket.status}}', '{{ticket.url}}'];

  const content = `
    <h2>Edit Template — ${escapeHtml(tpl.code_name)}</h2>
    <p><small>Group: ${escapeHtml(tpl.group_name || '')}</small></p>
    <form method="POST" action="/admin/email-templates/${tpl.id}/update">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group">
        <label>Placeholders</label>
        <div class="placeholder-chips">${placeholders.map(p => `<button type="button" class="chip" onclick="insertPh('${p}')">${p}</button>`).join(' ')}</div>
      </div>
      <div class="form-group"><label>Subject</label><input type="text" id="et-subject" name="subject" value="${escapeHtml(tpl.subject)}" maxlength="255" required></div>
      <div class="form-group"><label>Body (HTML)</label><textarea id="et-body" name="body" rows="12" required>${escapeHtml(tpl.body)}</textarea></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(tpl.notes || '')}</textarea></div>
      <button type="button" class="btn" onclick="preview()">Preview</button>
      <button type="submit" class="btn btn-primary">Save</button>
      <a href="/admin/email-templates/groups/${tpl.tpl_id}" class="btn">Cancel</a>
    </form>
    <div id="et-preview" style="margin-top:1em;padding:1em;border:1px solid #ccc;display:none">
      <h4>Preview</h4>
      <div id="et-preview-subject" style="font-weight:bold;margin-bottom:0.5em"></div>
      <div id="et-preview-body"></div>
    </div>
    <script>
      const SAMPLES = {
        '{{ticket.number}}': '12345',
        '{{ticket.subject}}': 'Sample ticket subject',
        '{{user.name}}': 'Jane Customer',
        '{{user.email}}': 'jane@example.com',
        '{{staff.name}}': 'John Staff',
        '{{ticket.department}}': 'Support',
        '{{ticket.status}}': 'Open',
        '{{ticket.url}}': 'https://example.com/tickets/12345',
      };
      let lastActive = null;
      ['et-subject','et-body'].forEach(id => {
        document.getElementById(id).addEventListener('focus', e => lastActive = e.target);
      });
      function insertPh(p) {
        const el = lastActive || document.getElementById('et-body');
        const s = el.selectionStart || 0;
        const e = el.selectionEnd || 0;
        el.value = el.value.slice(0, s) + p + el.value.slice(e);
        el.focus();
        el.setSelectionRange(s + p.length, s + p.length);
      }
      function preview() {
        let subject = document.getElementById('et-subject').value;
        let body = document.getElementById('et-body').value;
        for (const [k, v] of Object.entries(SAMPLES)) {
          subject = subject.split(k).join(v);
          body = body.split(k).join(v);
        }
        document.getElementById('et-preview-subject').textContent = 'Subject: ' + subject;
        document.getElementById('et-preview-body').innerHTML = body;
        document.getElementById('et-preview').style.display = 'block';
      }
    </script>
  `;
  res.send(renderAdminPage('Edit Template', content, base, 'email-templates'));
}));

router.post('/email-templates/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { subject, body, notes } = req.body;
  const tpl = await db.queryOne(`SELECT tpl_id FROM ${db.table('email_template')} WHERE id = ?`, [id]);
  if (!tpl) return res.redirect('/admin/email-templates');
  await db.query(
    `UPDATE ${db.table('email_template')} SET subject = ?, body = ?, notes = ?, updated = ? WHERE id = ?`,
    [subject, body, notes || null, new Date(), id]
  );
  res.redirect(`/admin/email-templates/groups/${tpl.tpl_id}`);
}));

/**
 * Canned Responses — list
 */
router.get('/canned-responses', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);

  let where = '';
  const args = [];
  if (!base.isAdmin) {
    const staff = await db.queryOne(`SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?`, [base.user.id]);
    where = ' WHERE cr.dept_id = ? OR cr.dept_id = 0';
    args.push(staff?.dept_id || 0);
  }

  const rows = await db.query(
    `SELECT cr.*, d.name as dept_name
     FROM ${db.table('canned_response')} cr
     LEFT JOIN ${db.table('department')} d ON cr.dept_id = d.id
     ${where}
     ORDER BY cr.title`, args
  );

  const createBtn = base.isAdmin ? `<div style="margin-bottom:1em"><a href="/admin/canned-responses/create/edit" class="btn btn-primary">Create Response</a></div>` : '';
  let html;
  if (rows.length === 0) {
    html = createBtn + '<p>No canned responses.</p>';
  } else {
    html = createBtn + `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Department</th><th>Status</th>${base.isAdmin ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><a href="/admin/canned-responses/${r.canned_id}/view">${escapeHtml(r.title)}</a></td>
              <td>${escapeHtml(r.dept_name || 'All Departments')}</td>
              <td>${r.isenabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-danger">Disabled</span>'}</td>
              ${base.isAdmin ? `<td><a href="/admin/canned-responses/${r.canned_id}/edit">Edit</a></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  res.send(renderAdminPage('Canned Responses', html, base, 'canned-responses'));
}));

router.get('/canned-responses/:id/view', asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const row = await db.queryOne(
    `SELECT cr.*, d.name as dept_name FROM ${db.table('canned_response')} cr
     LEFT JOIN ${db.table('department')} d ON cr.dept_id = d.id WHERE cr.canned_id = ?`, [id]
  );
  if (!row) return res.redirect('/admin/canned-responses');

  if (!base.isAdmin) {
    const staff = await db.queryOne(`SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?`, [base.user.id]);
    const deptId = staff?.dept_id || 0;
    if (row.dept_id !== 0 && row.dept_id !== deptId) return res.redirect('/admin/canned-responses');
  }

  const content = `
    <h2>${escapeHtml(row.title)}</h2>
    <p><small>${escapeHtml(row.dept_name || 'All Departments')} · ${row.isenabled ? 'Enabled' : 'Disabled'}</small></p>
    <div class="canned-body" style="padding:1em;border:1px solid #ccc;background:#f9f9f9">${row.response}</div>
    ${base.isAdmin ? `<div style="margin-top:1em"><a href="/admin/canned-responses/${row.canned_id}/edit" class="btn">Edit</a></div>` : ''}
    <p style="margin-top:1em"><a href="/admin/canned-responses">← Back</a></p>
  `;
  res.send(renderAdminPage(row.title, content, base, 'canned-responses'));
}));

router.get('/canned-responses/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const isCreate = id === 'create';

  let row = { canned_id: null, title: '', response: '', dept_id: 0, isenabled: 1, notes: '' };
  if (!isCreate) {
    const existing = await db.queryOne(`SELECT * FROM ${db.table('canned_response')} WHERE canned_id = ?`, [id]);
    if (!existing) return res.redirect('/admin/canned-responses');
    row = existing;
  }

  const depts = await db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`);
  const deptOpts = `<option value="0" ${row.dept_id == 0 ? 'selected' : ''}>All Departments</option>` +
    depts.map(d => `<option value="${d.id}" ${row.dept_id == d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');

  const action = isCreate ? '/admin/canned-responses/create' : `/admin/canned-responses/${row.canned_id}/update`;
  const content = `
    <h2>${isCreate ? 'Create' : 'Edit'} Canned Response</h2>
    <form method="POST" action="${action}">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group"><label>Title</label><input type="text" name="title" value="${escapeHtml(row.title)}" maxlength="255" required></div>
      <div class="form-group"><label>Department</label><select name="dept_id">${deptOpts}</select></div>
      <div class="form-group"><label><input type="checkbox" name="isenabled" ${row.isenabled ? 'checked' : ''}> Enabled</label></div>
      <div class="form-group"><label>Response (HTML)</label><textarea name="response" rows="10" required>${escapeHtml(row.response)}</textarea></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(row.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
      <a href="/admin/canned-responses" class="btn">Cancel</a>
      ${!isCreate ? `<button type="submit" formaction="/admin/canned-responses/${row.canned_id}/delete" class="btn btn-danger" onclick="return confirm('Delete this response?')">Delete</button>` : ''}
    </form>
  `;
  res.send(renderAdminPage(isCreate ? 'Create Response' : 'Edit Response', content, base, 'canned-responses'));
}));

router.post('/canned-responses/create', requireAdminSession, asyncHandler(async (req, res) => {
  const { title, response, dept_id, isenabled, notes } = req.body;
  if (!title || !title.trim() || !response) return res.redirect('/admin/canned-responses/create/edit');
  const dup = await db.queryOne(`SELECT canned_id FROM ${db.table('canned_response')} WHERE title = ?`, [title.trim()]);
  if (dup) return res.redirect('/admin/canned-responses/create/edit?error=duplicate');
  const now = new Date();
  await db.query(
    `INSERT INTO ${db.table('canned_response')} (dept_id, isenabled, title, response, lang, notes, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [parseInt(dept_id, 10) || 0, isenabled ? 1 : 0, title.trim(), response, 'en_US', notes || null, now, now]
  );
  res.redirect('/admin/canned-responses');
}));

router.post('/canned-responses/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, response, dept_id, isenabled, notes } = req.body;
  await db.query(
    `UPDATE ${db.table('canned_response')} SET title = ?, response = ?, dept_id = ?, isenabled = ?, notes = ?, updated = ? WHERE canned_id = ?`,
    [title.trim(), response, parseInt(dept_id, 10) || 0, isenabled ? 1 : 0, notes || null, new Date(), id]
  );
  res.redirect(`/admin/canned-responses/${id}/view`);
}));

router.post('/canned-responses/:id/delete', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await db.query(`DELETE FROM ${db.table('canned_response')} WHERE canned_id = ?`, [id]);
  res.redirect('/admin/canned-responses');
}));

/**
 * Filters — list (admin only)
 */
router.get('/filters', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const rows = await db.query(
    `SELECT f.*,
            (SELECT COUNT(*) FROM ${db.table('filter_rule')} fr WHERE fr.filter_id = f.id) as rule_count,
            (SELECT COUNT(*) FROM ${db.table('filter_action')} fa WHERE fa.filter_id = f.id) as action_count
     FROM ${db.table('filter')} f ORDER BY f.execorder, f.id`
  );
  const createBtn = `<div style="margin-bottom:1em"><a href="/admin/filters/create/edit" class="btn btn-primary">Create Filter</a></div>`;
  let html;
  if (rows.length === 0) {
    html = createBtn + '<p>No filters.</p>';
  } else {
    html = createBtn + `
      <table class="data-table">
        <thead><tr><th>Order</th><th>Name</th><th>Active</th><th>Target</th><th>Rules</th><th>Actions</th><th></th></tr></thead>
        <tbody>
          ${rows.map(f => `
            <tr>
              <td>${f.execorder}</td>
              <td><a href="/admin/filters/${f.id}/edit">${escapeHtml(f.name)}</a></td>
              <td>${f.isactive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Off</span>'}</td>
              <td>${escapeHtml(f.target)}</td>
              <td>${f.rule_count}</td>
              <td>${f.action_count}</td>
              <td><a href="/admin/filters/${f.id}/edit">Edit</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  res.send(renderAdminPage('Filters', html, base, 'filters'));
}));

router.get('/filters/:id/edit', requireAdminSession, asyncHandler(async (req, res) => {
  const base = await getAdminData(req);
  const { id } = req.params;
  const isCreate = id === 'create';

  let filter = { id: null, name: '', isactive: 1, target: 'Any', match_all_rules: 0, stop_onmatch: 0, notes: '' };
  let rules = [];
  let actions = [];

  if (!isCreate) {
    const row = await db.queryOne(`SELECT * FROM ${db.table('filter')} WHERE id = ?`, [id]);
    if (!row) return res.redirect('/admin/filters');
    filter = row;
    rules = await db.query(`SELECT * FROM ${db.table('filter_rule')} WHERE filter_id = ? ORDER BY id`, [id]);
    actions = await db.query(`SELECT * FROM ${db.table('filter_action')} WHERE filter_id = ? ORDER BY sort, id`, [id]);
  }

  // Build action-type -> config map
  const actionMap = {};
  for (const a of actions) {
    try { actionMap[a.type] = JSON.parse(a.configuration || '{}'); } catch {}
  }

  const [depts, priorities, slas, statuses, staffs, teams, topics] = await Promise.all([
    db.query(`SELECT id, name FROM ${db.table('department')} ORDER BY name`),
    db.query(`SELECT priority_id, priority_desc FROM ${db.table('ticket_priority')} ORDER BY priority_desc`).catch(() => []),
    db.query(`SELECT id, name FROM ${db.table('sla')} ORDER BY name`).catch(() => []),
    db.query(`SELECT id, name FROM ${db.table('ticket_status')} ORDER BY name`).catch(() => []),
    db.query(`SELECT staff_id, firstname, lastname FROM ${db.table('staff')} WHERE isactive = 1 ORDER BY firstname`).catch(() => []),
    db.query(`SELECT team_id, name FROM ${db.table('team')} ORDER BY name`).catch(() => []),
    db.query(`SELECT topic_id, topic FROM ${db.table('help_topic')} ORDER BY topic`).catch(() => []),
  ]);

  const optHtml = (items, labelField, valueField, selected) =>
    `<option value="">—</option>` + items.map(i =>
      `<option value="${i[valueField]}" ${String(selected) === String(i[valueField]) ? 'selected' : ''}>${escapeHtml(i[labelField] || '')}</option>`
    ).join('');

  const rulesJson = JSON.stringify(rules.map(r => ({ what: r.what, how: r.how, val: r.val })));
  const action = isCreate ? '/admin/filters/create' : `/admin/filters/${filter.id}/update`;

  const content = `
    <h2>${isCreate ? 'Create' : 'Edit'} Filter</h2>
    <form method="POST" action="${action}" id="filter-form">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(filter.name)}" maxlength="32" required></div>
      <div class="form-group"><label><input type="checkbox" name="isactive" ${filter.isactive ? 'checked' : ''}> Active</label></div>
      <div class="form-group"><label>Target</label>
        <select name="target">
          ${['Any','Web','Email','API'].map(t => `<option value="${t}" ${filter.target === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Match</label>
        <label><input type="radio" name="match_all_rules" value="1" ${filter.match_all_rules ? 'checked' : ''}> All rules</label>
        <label><input type="radio" name="match_all_rules" value="0" ${!filter.match_all_rules ? 'checked' : ''}> Any rule</label>
      </div>
      <div class="form-group"><label><input type="checkbox" name="stop_onmatch" ${filter.stop_onmatch ? 'checked' : ''}> Stop on match</label></div>

      <h3>Rules</h3>
      <div id="rules-container"></div>
      <button type="button" class="btn" onclick="addRule()">+ Add Rule</button>
      <input type="hidden" name="rules" id="rules-json">

      <h3>Actions</h3>
      <div class="action-row">
        <label><input type="checkbox" name="act_set_dept" ${actionMap.set_dept ? 'checked' : ''}> Set Department</label>
        <select name="act_set_dept_val">${optHtml(depts, 'name', 'id', actionMap.set_dept?.dept_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_set_priority" ${actionMap.set_priority ? 'checked' : ''}> Set Priority</label>
        <select name="act_set_priority_val">${optHtml(priorities, 'priority_desc', 'priority_id', actionMap.set_priority?.priority_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_set_sla" ${actionMap.set_sla ? 'checked' : ''}> Set SLA</label>
        <select name="act_set_sla_val">${optHtml(slas, 'name', 'id', actionMap.set_sla?.sla_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_set_status" ${actionMap.set_status ? 'checked' : ''}> Set Status</label>
        <select name="act_set_status_val">${optHtml(statuses, 'name', 'id', actionMap.set_status?.status_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_assign_staff" ${actionMap.assign_staff ? 'checked' : ''}> Assign Staff</label>
        <select name="act_assign_staff_val">${['<option value="">—</option>', ...staffs.map(s => `<option value="${s.staff_id}" ${String(actionMap.assign_staff?.staff_id) === String(s.staff_id) ? 'selected' : ''}>${escapeHtml((s.firstname||'') + ' ' + (s.lastname||''))}</option>`)].join('')}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_assign_team" ${actionMap.assign_team ? 'checked' : ''}> Assign Team</label>
        <select name="act_assign_team_val">${optHtml(teams, 'name', 'team_id', actionMap.assign_team?.team_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_set_topic" ${actionMap.set_topic ? 'checked' : ''}> Set Topic</label>
        <select name="act_set_topic_val">${optHtml(topics, 'topic', 'topic_id', actionMap.set_topic?.topic_id)}</select>
      </div>
      <div class="action-row">
        <label><input type="checkbox" name="act_reject" ${actionMap.reject ? 'checked' : ''}> Reject</label>
        <input type="text" name="act_reject_val" placeholder="Rejection message" value="${escapeHtml(actionMap.reject?.message || '')}">
      </div>

      <div class="form-group"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(filter.notes || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">${isCreate ? 'Create' : 'Save'}</button>
      <a href="/admin/filters" class="btn">Cancel</a>
      ${!isCreate ? `<button type="submit" formaction="/admin/filters/${filter.id}/delete" class="btn btn-danger" onclick="return confirm('Delete this filter?')">Delete</button>` : ''}
    </form>
    <script>
      const RULES = ${rulesJson};
      const WHAT_OPTIONS = ['subject','body','email','dept_id','topic_id','priority_id','source'];
      const HOW_OPTIONS = ['equal','not_equal','contains','dn_contain','starts','ends','match','not_match'];
      function renderRules() {
        const c = document.getElementById('rules-container');
        c.innerHTML = RULES.map((r, i) => \`
          <div class="rule-row" data-i="\${i}">
            <select data-field="what">\${WHAT_OPTIONS.map(w => '<option value="' + w + '"' + (w === r.what ? ' selected' : '') + '>' + w + '</option>').join('')}</select>
            <select data-field="how">\${HOW_OPTIONS.map(h => '<option value="' + h + '"' + (h === r.how ? ' selected' : '') + '>' + h + '</option>').join('')}</select>
            <input type="text" data-field="val" value="\${String(r.val || '').replace(/"/g, '&quot;')}" maxlength="255">
            <button type="button" onclick="removeRule(\${i})">×</button>
          </div>
        \`).join('');
        c.querySelectorAll('.rule-row').forEach(el => {
          el.querySelectorAll('[data-field]').forEach(f => {
            f.addEventListener('change', () => {
              const i = parseInt(el.dataset.i, 10);
              RULES[i][f.dataset.field] = f.value;
            });
          });
        });
      }
      function addRule() { RULES.push({ what: 'subject', how: 'contains', val: '' }); renderRules(); }
      function removeRule(i) { RULES.splice(i, 1); renderRules(); }
      document.getElementById('filter-form').addEventListener('submit', () => {
        // sync values before serializing
        document.querySelectorAll('#rules-container .rule-row').forEach(el => {
          const i = parseInt(el.dataset.i, 10);
          el.querySelectorAll('[data-field]').forEach(f => { RULES[i][f.dataset.field] = f.value; });
        });
        document.getElementById('rules-json').value = JSON.stringify(RULES);
      });
      renderRules();
    </script>
  `;
  res.send(renderAdminPage(isCreate ? 'Create Filter' : 'Edit Filter', content, base, 'filters'));
}));

const parseFilterActions = (body) => {
  const actions = [];
  const map = [
    ['act_set_dept', 'set_dept', 'dept_id', 'act_set_dept_val'],
    ['act_set_priority', 'set_priority', 'priority_id', 'act_set_priority_val'],
    ['act_set_sla', 'set_sla', 'sla_id', 'act_set_sla_val'],
    ['act_set_status', 'set_status', 'status_id', 'act_set_status_val'],
    ['act_assign_staff', 'assign_staff', 'staff_id', 'act_assign_staff_val'],
    ['act_assign_team', 'assign_team', 'team_id', 'act_assign_team_val'],
    ['act_set_topic', 'set_topic', 'topic_id', 'act_set_topic_val'],
  ];
  for (const [checkField, type, key, valField] of map) {
    if (body[checkField] && body[valField]) {
      actions.push({ type, configuration: JSON.stringify({ [key]: parseInt(body[valField], 10) }) });
    }
  }
  if (body.act_reject) {
    actions.push({ type: 'reject', configuration: JSON.stringify({ message: body.act_reject_val || 'Rejected' }) });
  }
  return actions;
};

router.post('/filters/create', requireAdminSession, asyncHandler(async (req, res) => {
  const { name, isactive, target, match_all_rules, stop_onmatch, notes } = req.body;
  let rules = [];
  try { rules = JSON.parse(req.body.rules || '[]'); } catch {}
  const actions = parseFilterActions(req.body);

  // Validate regex rules
  for (const r of rules) {
    if ((r.how === 'match' || r.how === 'not_match')) {
      try { new RegExp(r.val); } catch { return res.redirect('/admin/filters/create/edit?error=bad-regex'); }
    }
  }

  const now = new Date();
  await db.transaction(async (txQuery, txQueryOne) => {
    const maxRow = await txQueryOne(`SELECT MAX(execorder) as max FROM ${db.table('filter')}`);
    const nextOrder = (parseInt(maxRow?.max || 0, 10)) + 1;

    const fr = await txQuery(
      `INSERT INTO ${db.table('filter')}
       (execorder, isactive, flags, status, match_all_rules, stop_onmatch, target, email_id, name, notes, created, updated)
       VALUES (?, ?, 0, 0, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [nextOrder, isactive ? 1 : 0,
       String(match_all_rules) === '1' ? 1 : 0, stop_onmatch ? 1 : 0,
       target || 'Any', name.trim(), notes || null, now, now]
    );
    const filterId = fr?.insertId || fr?.lastInsertId || fr?.id;

    for (const r of rules) {
      if (!r.what || !r.how || r.val === undefined) continue;
      await txQuery(
        `INSERT INTO ${db.table('filter_rule')} (filter_id, what, how, val, isactive, notes, created, updated)
         VALUES (?, ?, ?, ?, 1, '', ?, ?)`,
        [filterId, r.what, r.how, r.val, now, now]
      );
    }

    for (let i = 0; i < actions.length; i++) {
      await txQuery(
        `INSERT INTO ${db.table('filter_action')} (filter_id, sort, type, configuration, updated)
         VALUES (?, ?, ?, ?, ?)`,
        [filterId, i, actions[i].type, actions[i].configuration, now]
      );
    }
  });
  res.redirect('/admin/filters');
}));

router.post('/filters/:id/update', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, isactive, target, match_all_rules, stop_onmatch, notes } = req.body;
  let rules = [];
  try { rules = JSON.parse(req.body.rules || '[]'); } catch {}
  const actions = parseFilterActions(req.body);

  for (const r of rules) {
    if ((r.how === 'match' || r.how === 'not_match')) {
      try { new RegExp(r.val); } catch { return res.redirect(`/admin/filters/${id}/edit?error=bad-regex`); }
    }
  }

  const now = new Date();
  await db.transaction(async (txQuery) => {
    await txQuery(
      `UPDATE ${db.table('filter')} SET
         name = ?, isactive = ?, target = ?, match_all_rules = ?, stop_onmatch = ?, notes = ?, updated = ?
       WHERE id = ?`,
      [name.trim(), isactive ? 1 : 0, target || 'Any',
       String(match_all_rules) === '1' ? 1 : 0, stop_onmatch ? 1 : 0,
       notes || null, now, id]
    );
    await txQuery(`DELETE FROM ${db.table('filter_rule')} WHERE filter_id = ?`, [id]);
    for (const r of rules) {
      if (!r.what || !r.how || r.val === undefined) continue;
      await txQuery(
        `INSERT INTO ${db.table('filter_rule')} (filter_id, what, how, val, isactive, notes, created, updated)
         VALUES (?, ?, ?, ?, 1, '', ?, ?)`,
        [id, r.what, r.how, r.val, now, now]
      );
    }
    await txQuery(`DELETE FROM ${db.table('filter_action')} WHERE filter_id = ?`, [id]);
    for (let i = 0; i < actions.length; i++) {
      await txQuery(
        `INSERT INTO ${db.table('filter_action')} (filter_id, sort, type, configuration, updated)
         VALUES (?, ?, ?, ?, ?)`,
        [id, i, actions[i].type, actions[i].configuration, now]
      );
    }
  });
  res.redirect('/admin/filters');
}));

router.post('/filters/:id/delete', requireAdminSession, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await db.transaction(async (txQuery) => {
    await txQuery(`DELETE FROM ${db.table('filter_action')} WHERE filter_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('filter_rule')} WHERE filter_id = ?`, [id]);
    await txQuery(`DELETE FROM ${db.table('filter')} WHERE id = ?`, [id]);
  });
  res.redirect('/admin/filters');
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
