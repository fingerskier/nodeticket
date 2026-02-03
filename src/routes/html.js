/**
 * HTML Routes - User Interface (SPA with Ygdrassil)
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
 * Render SPA page - Single Page Application with Ygdrassil
 */
const renderSPA = (base) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${base.title}</title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <header class="header">
    <div class="container">
      <div class="header-content">
        <a href="#" class="logo" onclick="event.preventDefault(); app.gotoState('home');">${base.title}</a>
        <nav class="nav">
          <!-- Navigation will be dynamically updated by SPA -->
        </nav>
      </div>
    </div>
  </header>
  <main class="main">
    <div class="container">
      <div id="content">
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    </div>
  </main>
  <footer class="footer">
    <div class="container">
      <p>Powered by Nodeticket</p>
    </div>
  </footer>

  <!-- App Configuration -->
  <script>
    window.APP_CONFIG = {
      title: ${JSON.stringify(base.title)},
      user: ${JSON.stringify(base.user)},
      enableKB: ${base.enableKB}
    };
  </script>

  <!-- Ygdrassil State Machine (vanilla) -->
  <script type="module">
    import { StateMachine } from 'https://cdn.jsdelivr.net/npm/ygdrassil@2026.1.6/vanilla/StateMachine.js';
    window.StateMachine = StateMachine;

    // Load the SPA application after StateMachine is available
    const script = document.createElement('script');
    script.src = '/js/spa.js';
    document.body.appendChild(script);
  </script>
</body>
</html>
`;

/**
 * Legacy render for non-SPA pages (login form fallback)
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
            ? \`<span class="user-info">\${base.user.name}</span>
               <a href="/logout">Logout</a>\`
            : '<a href="/login">Login</a>'}
        </nav>
      </div>
    </div>
  </header>
  <main class="main">
    <div class="container">
      \${content}
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
<<<<<<< HEAD
 * Home page / User Dashboard
 */
router.get('/', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  if (!req.session?.user) {
    const content = `
      <div class="hero">
        <h1>Welcome to ${base.title}</h1>
        <p>How can we help you today?</p>
      </div>
      <div class="login-prompt">
        <p>Please <a href="/login">sign in</a> to view your tickets or submit a new request.</p>
      </div>
    `;
    return res.send(renderPage('Home', content, base));
  }

  // Redirect staff to admin dashboard
  if (req.session.user.type === 'staff') {
    return res.redirect('/admin');
  }

  const userId = req.session.user.id;
  let openCount = 0, closedCount = 0, awaitingReply = 0;
  let recentTickets = [];

  try {
    // Open ticket count
    openCount = await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('ticket')} t
      JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      WHERE t.user_id = ? AND ts.state = 'open'
    `, [userId]) || 0;

    // Closed ticket count
    closedCount = await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('ticket')} t
      JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      WHERE t.user_id = ? AND ts.state = 'closed'
    `, [userId]) || 0;

    // Awaiting reply: open tickets where the latest thread entry is a response (R) from staff
    awaitingReply = await db.queryValue(`
      SELECT COUNT(*) FROM ${db.table('ticket')} t
      JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      JOIN ${db.table('thread')} th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      WHERE t.user_id = ? AND ts.state = 'open'
        AND EXISTS (
          SELECT 1 FROM ${db.table('thread_entry')} te
          WHERE te.thread_id = th.id AND te.type = 'R'
          AND te.id = (
            SELECT MAX(te2.id) FROM ${db.table('thread_entry')} te2
            WHERE te2.thread_id = th.id AND te2.type IN ('M', 'R')
          )
        )
    `, [userId]) || 0;

    // Recent tickets (last 5 updated)
    recentTickets = await db.query(`
      SELECT t.ticket_id, t.number, t.created, t.lastupdate,
             ts.name as status_name, ts.state as status_state,
             tc.subject, d.name as dept_name
      FROM ${db.table('ticket')} t
      LEFT JOIN ${db.table('ticket_status')} ts ON t.status_id = ts.id
      LEFT JOIN ${db.table('ticket__cdata')} tc ON t.ticket_id = tc.ticket_id
      LEFT JOIN ${db.table('department')} d ON t.dept_id = d.id
      WHERE t.user_id = ?
      ORDER BY COALESCE(t.lastupdate, t.created) DESC
      LIMIT 5
    `, [userId]);
  } catch (e) {
    console.error('Dashboard query error:', e);
  }

  const totalTickets = openCount + closedCount;

  let recentHtml = '';
  if (recentTickets.length > 0) {
    recentHtml = `
      <div class="recent-tickets">
        <h3>Recent Tickets</h3>
        ${recentTickets.map(t => `
          <div class="recent-ticket-item">
            <div class="recent-ticket-info">
              <a href="/tickets/${t.ticket_id}">#${t.number} - ${escapeHtml(t.subject || 'No Subject')}</a>
              <div class="recent-ticket-meta">${escapeHtml(t.dept_name || '')} &middot; ${formatDate(t.lastupdate || t.created)}</div>
            </div>
            <div class="recent-ticket-status">
              <span class="status status-${t.status_state}">${t.status_name}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    recentHtml = `
      <div class="empty-state">
        <p>No tickets yet.</p>
      </div>
    `;
  }

  const content = `
    <div class="section-header">
      <h2>Dashboard</h2>
    </div>

    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-number">${openCount}</div>
        <div class="stat-label">Open Tickets</div>
      </div>
      <div class="stat-card stat-warning">
        <div class="stat-number">${awaitingReply}</div>
        <div class="stat-label">Awaiting Reply</div>
      </div>
      <div class="stat-card stat-success">
        <div class="stat-number">${closedCount}</div>
        <div class="stat-label">Closed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${totalTickets}</div>
        <div class="stat-label">Total Tickets</div>
      </div>
    </div>

    <div class="quick-actions-row">
      <a href="/tickets" class="btn btn-primary">View All Tickets</a>
      ${base.enableKB ? '<a href="/faq" class="btn">Knowledge Base</a>' : ''}
    </div>

    ${recentHtml}
  `;

  res.send(renderPage('Dashboard', content, base));
=======
 * Home page - Serves SPA
 */
router.get('/', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);
  res.send(renderSPA(base));
>>>>>>> 19b3b805ece5dc4fb273d3a79aabecd048db9e81
}));

/**
 * Login page - Redirect to SPA
 */
router.get('/login', asyncHandler(async (req, res) => {
  if (req.session?.user) {
<<<<<<< HEAD
    return res.redirect(req.session.user.type === 'staff' ? '/admin' : '/');
  }

  const error = req.query.error;
  let errorHtml = '';
  if (error === 'invalid') {
    errorHtml = '<div class="alert alert-danger">Invalid username or password.</div>';
  } else if (error === 'server') {
    errorHtml = '<div class="alert alert-danger">A server error occurred. Please try again.</div>';
  }

  const content = `
    <div class="auth-form">
      <h2>Sign In</h2>
      ${errorHtml}
      <form action="/login" method="POST" id="loginForm">
        <div class="tab-toggle">
          <input type="radio" name="type" value="user" id="type-user" checked>
          <label for="type-user">User Portal</label>
          <input type="radio" name="type" value="staff" id="type-staff">
          <label for="type-staff">Staff Portal</label>
        </div>
        <div class="form-group">
          <label for="username">Username or Email</label>
          <input type="text" id="username" name="username" required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
      </form>
      <p style="text-align:center; margin-top:16px; font-size:0.875rem">
        <a href="/forgot-password">Forgot your password?</a>
      </p>
    </div>
  `;

  res.send(renderPage('Login', content, base));
=======
    return res.redirect('/#?yg-app=tickets');
  }
  res.redirect('/#?yg-app=login');
>>>>>>> 19b3b805ece5dc4fb273d3a79aabecd048db9e81
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
        type: 'staff',
        deptId: staff.dept_id
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

      return res.redirect('/#?yg-app=tickets');
    }
  } catch (e) {
    console.error('Login error:', e);
    return res.redirect('/login?error=server');
  }
}));

/**
 * Forgot password page
 */
router.get('/forgot-password', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);

  const content = `
    <div class="auth-form">
      <h2>Reset Password</h2>
      <p style="color: var(--text-muted); margin-bottom: 20px; font-size: 0.875rem;">
        Enter your email address and we'll send you a link to reset your password.
      </p>
      <div id="resetMessage"></div>
      <form action="/forgot-password" method="POST" id="forgotForm">
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" required autocomplete="email">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Send Reset Link</button>
      </form>
      <p style="text-align:center; margin-top:16px; font-size:0.875rem">
        <a href="/login">&larr; Back to Login</a>
      </p>
    </div>
  `;

  res.send(renderPage('Forgot Password', content, base));
}));

/**
 * Handle forgot password
 */
router.post('/forgot-password', express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  const base = await getBaseData(req);
  const { email } = req.body;

  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const config = require('../config');

  let resetUrl = null;

  if (email) {
    // Check staff
    const staff = await db.queryOne(
      `SELECT staff_id, email FROM ${db.table('staff')} WHERE email = ? AND isactive = 1`,
      [email]
    );

    let resetType = null;
    let resetId = null;

    if (staff) {
      resetType = 'staff';
      resetId = staff.staff_id;
    } else {
      const account = await db.queryOne(
        `SELECT u.id as user_id, ue.address as email
         FROM ${db.table('user')} u
         JOIN ${db.table('user_email')} ue ON u.default_email_id = ue.id
         LEFT JOIN ${db.table('user_account')} ua ON ua.user_id = u.id
         WHERE ue.address = ? AND ua.status = 1`,
        [email]
      );

      if (account) {
        resetType = 'user';
        resetId = account.user_id;
      }
    }

    if (resetType) {
      const resetToken = jwt.sign(
        { id: resetId, type: resetType, purpose: 'password-reset' },
        config.jwt.secret,
        { expiresIn: '1h' }
      );

      const helpdeskUrl = config.helpdesk.url.replace(/\/$/, '');
      resetUrl = `${helpdeskUrl}/reset-password?token=${resetToken}`;

      console.log(`\n=== PASSWORD RESET ===`);
      console.log(`Account: ${email} (${resetType})`);
      console.log(`Reset URL: ${resetUrl}`);
      console.log(`Expires: 1 hour`);
      console.log(`======================\n`);
    }
  }

  let messageHtml = '<div class="alert alert-success">If an account exists with that email, a password reset link has been generated.</div>';

  // In development mode, show the reset link directly
  if (config.env === 'development' && resetUrl) {
    messageHtml += `<div class="alert alert-info">
      <strong>Dev mode:</strong> <a href="${resetUrl}">Click here to reset password</a>
    </div>`;
  }

  const content = `
    <div class="auth-form">
      <h2>Reset Password</h2>
      ${messageHtml}
      <p style="text-align:center; margin-top:16px; font-size:0.875rem">
        <a href="/login">&larr; Back to Login</a>
      </p>
    </div>
  `;

  res.send(renderPage('Forgot Password', content, base));
}));

/**
 * Reset password page
 */
router.get('/reset-password', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);
  const { token } = req.query;

  if (!token) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">Invalid or missing reset token. Please request a new password reset.</div>
        <p style="text-align:center; margin-top:16px; font-size:0.875rem">
          <a href="/forgot-password">Request Password Reset</a>
        </p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  // Validate token before showing form
  const jwt = require('jsonwebtoken');
  const config = require('../config');
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.purpose !== 'password-reset') {
      throw new Error('Invalid token purpose');
    }
  } catch (e) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">This reset link is invalid or has expired. Please request a new one.</div>
        <p style="text-align:center; margin-top:16px; font-size:0.875rem">
          <a href="/forgot-password">Request Password Reset</a>
        </p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  const content = `
    <div class="auth-form">
      <h2>Set New Password</h2>
      <div id="resetError"></div>
      <form action="/reset-password" method="POST" id="resetForm">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <div class="form-group">
          <label for="password">New Password</label>
          <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="confirm">Confirm Password</label>
          <input type="password" id="confirm" name="confirm" required minlength="6" autocomplete="new-password">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Reset Password</button>
      </form>
    </div>
  `;

  res.send(renderPage('Reset Password', content, base));
}));

/**
 * Handle password reset
 */
router.post('/reset-password', express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  const base = await getBaseData(req);
  const { token, password, confirm } = req.body;

  if (!token || !password) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">Missing required fields.</div>
        <p style="text-align:center; margin-top:16px"><a href="/forgot-password">Try Again</a></p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  if (password !== confirm) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">Passwords do not match.</div>
        <p style="text-align:center; margin-top:16px"><a href="/reset-password?token=${escapeHtml(token)}">Try Again</a></p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  if (password.length < 6) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">Password must be at least 6 characters.</div>
        <p style="text-align:center; margin-top:16px"><a href="/reset-password?token=${escapeHtml(token)}">Try Again</a></p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  const jwt = require('jsonwebtoken');
  const bcrypt = require('bcryptjs');
  const config = require('../config');

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.purpose !== 'password-reset') throw new Error('Invalid token');
  } catch (e) {
    const content = `
      <div class="auth-form">
        <h2>Reset Password</h2>
        <div class="alert alert-danger">This reset link is invalid or has expired.</div>
        <p style="text-align:center; margin-top:16px"><a href="/forgot-password">Request New Reset</a></p>
      </div>
    `;
    return res.send(renderPage('Reset Password', content, base));
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  if (decoded.type === 'staff') {
    await db.query(
      `UPDATE ${db.table('staff')} SET passwd = ?, updated = NOW() WHERE staff_id = ?`,
      [hashedPassword, decoded.id]
    );
  } else {
    await db.query(
      `UPDATE ${db.table('user_account')} SET passwd = ? WHERE user_id = ?`,
      [hashedPassword, decoded.id]
    );
  }

  const content = `
    <div class="auth-form">
      <h2>Password Reset</h2>
      <div class="alert alert-success">Your password has been reset successfully.</div>
      <a href="/login" class="btn btn-primary" style="width:100%; text-align:center; display:block">Sign In</a>
    </div>
  `;

  res.send(renderPage('Password Reset', content, base));
}));

/**
 * Logout
 */
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

/**
 * My tickets page - Redirect to SPA
 */
router.get('/tickets', asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/#?yg-app=login');
  }
  res.redirect('/#?yg-app=tickets');
}));

/**
 * View ticket - Redirect to SPA
 */
router.get('/tickets/:id', asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/#?yg-app=login');
  }
  const { id } = req.params;
  res.redirect(`/#?yg-app=ticket&id=${id}`);
}));

/**
 * Create ticket page - Redirect to SPA
 */
router.get('/create', asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/#?yg-app=login');
  }
  res.redirect('/#?yg-app=create');
}));

/**
 * FAQ page - Redirect to SPA
 */
router.get('/faq', asyncHandler(async (req, res) => {
  res.redirect('/#?yg-app=faq');
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
