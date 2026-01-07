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
 * Home page - Serves SPA
 */
router.get('/', asyncHandler(async (req, res) => {
  const base = await getBaseData(req);
  res.send(renderSPA(base));
}));

/**
 * Login page - Redirect to SPA
 */
router.get('/login', asyncHandler(async (req, res) => {
  if (req.session?.user) {
    return res.redirect('/#?yg-app=tickets');
  }
  res.redirect('/#?yg-app=login');
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
