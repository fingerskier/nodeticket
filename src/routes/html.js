/**
 * HTML Routes - User Interface
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Get base template data
 */
const getBaseData = async (req) => {
  let config = {};
  try {
    const configItems = await db.query(`
      SELECT \`key\`, value FROM ${db.table('config')}
      WHERE namespace = 'core' AND \`key\` IN ('helpdesk_title', 'helpdesk_url', 'enable_kb')
    `);
    configItems.forEach(item => {
      config[item.key] = item.value;
    });
  } catch (e) {
    // Use defaults if database is not available
    config = { helpdesk_title: 'Nodeticket Help Desk' };
  }

  return {
    title: config.helpdesk_title || 'Nodeticket Help Desk',
    user: req.session?.user || null,
    enableKB: config.enable_kb === '1'
  };
};

/**
 * Render HTML page
 */
const renderPage = (title, content, base) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${base.title}</title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <header class="header">
    <div class="container">
      <div class="header-content">
        <a href="/" class="logo">${base.title}</a>
        <nav class="nav">
          <a href="/">Home</a>
          <a href="/tickets">My Tickets</a>
          ${base.enableKB ? '<a href="/faq">Knowledge Base</a>' : ''}
          ${base.user
            ? `<span class="user-info">${base.user.name}</span>
               <a href="/logout">Logout</a>`
            : '<a href="/login">Login</a>'}
        </nav>
      </div>
    </div>
  </header>
  <main class="main">
    <div class="container">
      ${content}
    </div>
  </main>
  <footer class="footer">
    <div class="container">
      <p>Powered by Nodeticket</p>
    </div>
  </footer>
  <script src="/js/app.js"></script>
</body>
</html>
`;

/**
 * Home page
 */
router.get('/', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  let statsHtml = '';
  if (req.session?.user) {
    try {
      const userId = req.session.user.id;
      const openTickets = await db.queryValue(`
        SELECT COUNT(*) FROM ${db.table('ticket')} t
        JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
        WHERE t.user_id = ? AND ts.state = 'open'
      `, [userId]);

      statsHtml = `
        <div class="stats-card">
          <h3>Your Open Tickets</h3>
          <p class="stat-number">${openTickets || 0}</p>
          <a href="/tickets" class="btn btn-primary">View Tickets</a>
        </div>
      `;
    } catch (e) {
      // Ignore database errors
    }
  }

  const content = `
    <div class="hero">
      <h1>Welcome to ${base.title}</h1>
      <p>How can we help you today?</p>
    </div>

    ${req.session?.user ? `
      <div class="dashboard">
        ${statsHtml}
        <div class="quick-actions">
          <h3>Quick Actions</h3>
          <a href="/tickets" class="btn">View My Tickets</a>
          ${base.enableKB ? '<a href="/faq" class="btn">Browse Knowledge Base</a>' : ''}
        </div>
      </div>
    ` : `
      <div class="login-prompt">
        <p>Please <a href="/login">login</a> to view your tickets or submit a new request.</p>
      </div>
    `}
  `;

  res.send(renderPage('Home', content, base));
}));

/**
 * Login page
 */
router.get('/login', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  if (req.session?.user) {
    return res.redirect('/tickets');
  }

  const content = `
    <div class="auth-form">
      <h2>Login</h2>
      <form action="/login" method="POST" id="loginForm">
        <div class="form-group">
          <label for="username">Username or Email</label>
          <input type="text" id="username" name="username" required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required>
        </div>
        <div class="form-group">
          <label>
            <input type="radio" name="type" value="user" checked> User Portal
          </label>
          <label>
            <input type="radio" name="type" value="staff"> Staff Portal
          </label>
        </div>
        <div class="form-error" id="loginError"></div>
        <button type="submit" class="btn btn-primary">Login</button>
      </form>
    </div>
  `;

  res.send(renderPage('Login', content, base));
}));

/**
 * Handle login
 */
router.post('/login', express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  const { username, password, type = 'user' } = req.body;

  try {
    // Use the auth controller logic
    const bcrypt = require('bcryptjs');

    if (type === 'staff') {
      const staff = await db.queryOne(`
        SELECT s.*, r.permissions as role_permissions
        FROM ${db.table('staff')} s
        LEFT JOIN ${db.table('role')} r ON s.role_id = r.id
        WHERE (s.username = ? OR s.email = ?) AND s.isactive = 1
      `, [username, username]);

      if (!staff) {
        return res.redirect('/login?error=invalid');
      }

      const valid = await bcrypt.compare(password, staff.passwd);
      if (!valid) {
        return res.redirect('/login?error=invalid');
      }

      req.session.user = {
        id: staff.staff_id,
        username: staff.username,
        name: `${staff.firstname || ''} ${staff.lastname || ''}`.trim() || staff.username,
        email: staff.email,
        isAdmin: !!staff.isadmin,
        type: 'staff'
      };

      return res.redirect('/admin');
    } else {
      const account = await db.queryOne(`
        SELECT ua.*, u.id as user_id, u.name, ue.address as email
        FROM ${db.table('user_account')} ua
        JOIN ${db.table('user')} u ON ua.user_id = u.id
        LEFT JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
        WHERE ua.username = ? AND ua.status = 1
      `, [username]);

      if (!account) {
        return res.redirect('/login?error=invalid');
      }

      const valid = await bcrypt.compare(password, account.passwd);
      if (!valid) {
        return res.redirect('/login?error=invalid');
      }

      req.session.user = {
        id: account.user_id,
        username: account.username,
        name: account.name,
        email: account.email,
        isAdmin: false,
        type: 'user'
      };

      return res.redirect('/tickets');
    }
  } catch (e) {
    console.error('Login error:', e);
    return res.redirect('/login?error=server');
  }
}));

/**
 * Logout
 */
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

/**
 * My tickets page
 */
router.get('/tickets', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  if (!req.session?.user) {
    return res.redirect('/login');
  }

  let ticketsHtml = '<p>No tickets found.</p>';

  try {
    const userId = req.session.user.id;
    const tickets = await db.query(`
      SELECT t.*, ts.name as status_name, ts.state as status_state,
             d.name as dept_name, tc.subject
      FROM ${db.table('ticket')} t
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      WHERE t.user_id = ?
      ORDER BY t.created DESC
      LIMIT 50
    `, [userId]);

    if (tickets.length > 0) {
      ticketsHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Department</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${tickets.map(t => `
              <tr>
                <td><a href="/tickets/${t.ticket_id}">${t.number}</a></td>
                <td>${escapeHtml(t.subject || 'No Subject')}</td>
                <td><span class="status status-${t.status_state}">${t.status_name}</span></td>
                <td>${escapeHtml(t.dept_name || 'N/A')}</td>
                <td>${formatDate(t.created)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    console.error('Error loading tickets:', e);
    ticketsHtml = '<p class="error">Error loading tickets.</p>';
  }

  const content = `
    <h2>My Tickets</h2>
    ${ticketsHtml}
  `;

  res.send(renderPage('My Tickets', content, base));
}));

/**
 * View ticket
 */
router.get('/tickets/:id', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  if (!req.session?.user) {
    return res.redirect('/login');
  }

  const { id } = req.params;
  const userId = req.session.user.id;

  try {
    const ticket = await db.queryOne(`
      SELECT t.*, ts.name as status_name, ts.state as status_state,
             d.name as dept_name, tc.subject,
             tp.priority as priority_name, tp.priority_color,
             th.id as thread_id
      FROM ${db.table('ticket')} t
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      LEFT JOIN ${db.table('help_topic')} ht ON t.topic_id = ht.topic_id
      LEFT JOIN ${db.table('ticket_priority')} tp ON ht.priority_id = tp.priority_id
      LEFT JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.ticket_id = ? AND t.user_id = ?
    `, [id, userId]);

    if (!ticket) {
      const content = '<div class="error"><h2>Ticket Not Found</h2><p>The ticket you requested could not be found.</p></div>';
      return res.send(renderPage('Ticket Not Found', content, base));
    }

    // Get thread entries
    const entries = await db.query(`
      SELECT te.*, s.firstname, s.lastname
      FROM ${db.table('thread_entry')} te
      LEFT JOIN ${db.table('staff')} s ON te.staff_id = s.staff_id
      WHERE te.thread_id = ? AND te.type IN ('M', 'R')
      ORDER BY te.created ASC
    `, [ticket.thread_id]);

    const content = `
      <div class="ticket-detail">
        <div class="ticket-header">
          <h2>Ticket #${ticket.number}</h2>
          <span class="status status-${ticket.status_state}">${ticket.status_name}</span>
        </div>
        <div class="ticket-info">
          <p><strong>Subject:</strong> ${escapeHtml(ticket.subject || 'No Subject')}</p>
          <p><strong>Department:</strong> ${escapeHtml(ticket.dept_name || 'N/A')}</p>
          <p><strong>Priority:</strong> <span style="color: ${ticket.priority_color}">${ticket.priority_name || 'Normal'}</span></p>
          <p><strong>Created:</strong> ${formatDate(ticket.created)}</p>
          ${ticket.closed ? `<p><strong>Closed:</strong> ${formatDate(ticket.closed)}</p>` : ''}
        </div>

        <div class="thread">
          <h3>Conversation</h3>
          ${entries.length === 0 ? '<p>No messages yet.</p>' : entries.map(e => `
            <div class="thread-entry thread-entry-${e.type === 'M' ? 'message' : 'response'}">
              <div class="entry-header">
                <strong>${e.type === 'M' ? 'You' : (e.firstname ? `${e.firstname} ${e.lastname}`.trim() : e.poster)}</strong>
                <span class="entry-date">${formatDate(e.created)}</span>
              </div>
              <div class="entry-body">${e.body}</div>
            </div>
          `).join('')}
        </div>

        <p><a href="/tickets" class="btn">&larr; Back to Tickets</a></p>
      </div>
    `;

    res.send(renderPage(`Ticket #${ticket.number}`, content, base));
  } catch (e) {
    console.error('Error loading ticket:', e);
    const content = '<div class="error"><h2>Error</h2><p>An error occurred loading the ticket.</p></div>';
    res.send(renderPage('Error', content, base));
  }
}));

/**
 * FAQ page
 */
router.get('/faq', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  let faqHtml = '<p>No articles found.</p>';

  try {
    const categories = await db.query(`
      SELECT c.*, (SELECT COUNT(*) FROM ${db.table('faq')} f WHERE f.category_id = c.category_id AND f.ispublished = 1) as count
      FROM ${db.table('faq_category')} c
      WHERE c.ispublic = 1
      ORDER BY c.name
    `);

    const faqs = await db.query(`
      SELECT f.*, c.name as category_name
      FROM ${db.table('faq')} f
      LEFT JOIN ${db.table('faq_category')} c ON f.category_id = c.category_id
      WHERE f.ispublished = 1 AND (c.ispublic = 1 OR c.category_id IS NULL)
      ORDER BY c.name, f.question
      LIMIT 50
    `);

    if (faqs.length > 0) {
      faqHtml = `
        <div class="faq-list">
          ${faqs.map(f => `
            <div class="faq-item">
              <h3 class="faq-question">${escapeHtml(f.question)}</h3>
              ${f.category_name ? `<span class="faq-category">${escapeHtml(f.category_name)}</span>` : ''}
              <div class="faq-answer">${f.answer}</div>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (e) {
    console.error('Error loading FAQ:', e);
    faqHtml = '<p class="error">Error loading knowledge base.</p>';
  }

  const content = `
    <h2>Knowledge Base</h2>
    ${faqHtml}
  `;

  res.send(renderPage('Knowledge Base', content, base));
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

module.exports = router;
