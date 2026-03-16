/**
 * Nodeticket SPA - Using Ygdrassil State Machine
 * Vanilla JavaScript implementation
 */

// Import ygdrassil from CDN (loaded via script tag in HTML)
// State machine will be initialized after DOM ready

let app = null;
let currentUser = null;

/**
 * API Helper
 */
const api = {
  async get(endpoint) {
    const res = await fetch(`/api/v1${endpoint}`, {
      credentials: 'include'
    });
    return res.json();
  },

  async post(endpoint, data) {
    const res = await fetch(`/api/v1${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async put(endpoint, data) {
    const res = await fetch(`/api/v1${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return res.json();
  }
};

/**
 * Template helpers
 */
const escapeHtml = (str) => {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString();
};

/**
 * Render functions for each state/view
 */
const views = {
  async home() {
    const content = document.getElementById('content');
    content.classList.add('fade-out');

    await delay(150);

    let statsHtml = '';
    if (currentUser) {
      try {
        const res = await api.get(`/tickets?user_id=${currentUser.id}&status=open`);
        statsHtml = `
          <div class="dashboard">
            <div class="stats-card">
              <h3>Your Open Tickets</h3>
              <p class="stat-number">${res.pagination?.total || 0}</p>
              <button class="btn btn-primary" data-state="tickets">View Tickets</button>
            </div>
            <div class="quick-actions">
              <h3>Quick Actions</h3>
              <button class="btn btn-success" data-state="create">Create New Ticket</button>
              <button class="btn" data-state="tickets">View All Tickets</button>
              <button class="btn" data-state="faq">Browse Knowledge Base</button>
            </div>
          </div>
        `;
      } catch (e) {
        console.error('Error loading stats:', e);
      }
    }

    content.innerHTML = `
      <div class="hero">
        <h1>Welcome to ${window.APP_CONFIG?.title || 'Nodeticket Help Desk'}</h1>
        <p>How can we help you today?</p>
      </div>
      ${currentUser ? statsHtml : `
        <div class="login-prompt">
          <p>Please <button class="link-btn" data-state="login">login</button> to view your tickets or submit a new request.</p>
        </div>
      `}
    `;

    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
  },

  async login() {
    if (currentUser) {
      app.gotoState('tickets');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <div class="auth-form slide-in">
        <h2>Login</h2>
        <form id="loginForm">
          <div class="form-group">
            <label for="username">Username or Email</label>
            <input type="text" id="username" name="username" required autocomplete="username">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required autocomplete="current-password">
          </div>
          <div class="form-group radio-group">
            <label class="radio-label">
              <input type="radio" name="type" value="user" checked> User Portal
            </label>
            <label class="radio-label">
              <input type="radio" name="type" value="staff"> Staff Portal
            </label>
          </div>
          <div class="form-error" id="loginError"></div>
          <button type="submit" class="btn btn-primary btn-block">Login</button>
        </form>
        <p class="form-footer">
          <button class="link-btn" data-state="home">&larr; Back to Home</button>
          <a href="#" class="link-btn" data-state="register">Create Account</a>
        </p>
      </div>
    `;

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
  },

  async register() {
    if (currentUser) {
      app.gotoState('tickets');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <div class="auth-form slide-in">
        <h2>Create Account</h2>
        <form id="registerForm">
          <div class="form-group">
            <label for="reg-name">Full Name</label>
            <input type="text" id="reg-name" name="name" required autocomplete="name">
          </div>
          <div class="form-group">
            <label for="reg-email">Email Address</label>
            <input type="email" id="reg-email" name="email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label for="reg-username">Username</label>
            <input type="text" id="reg-username" name="username" required minlength="3" autocomplete="username">
          </div>
          <div class="form-group">
            <label for="reg-password">Password</label>
            <input type="password" id="reg-password" name="password" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label for="reg-confirm">Confirm Password</label>
            <input type="password" id="reg-confirm" name="confirm" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-error" id="registerError"></div>
          <button type="submit" class="btn btn-primary btn-block">Create Account</button>
        </form>
        <p class="form-footer">
          <button class="link-btn" data-state="login">&larr; Back to Login</button>
        </p>
      </div>
    `;

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errorDiv = document.getElementById('registerError');
      const submitBtn = form.querySelector('button[type="submit"]');

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';
      errorDiv.textContent = '';

      const formData = new FormData(form);
      const data = Object.fromEntries(formData);

      try {
        const res = await api.post('/auth/register', data);

        if (res.success) {
          const content = document.getElementById('content');
          content.innerHTML = `
            <div class="auth-form slide-in">
              <h2>Check Your Email</h2>
              <p>Registration successful! Please check your email to verify your account before logging in.</p>
              <p class="form-footer">
                <button class="link-btn" data-state="login">&larr; Back to Login</button>
              </p>
            </div>
          `;
          bindStateButtons();
        } else {
          errorDiv.textContent = res.message || 'Registration failed. Please try again.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Account';
        }
      } catch (err) {
        console.error('Registration error:', err);
        errorDiv.textContent = 'Connection error. Please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });

    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
  },

  async tickets() {
    if (!currentUser) {
      app.gotoState('login');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <div class="page-header">
        <h2>My Tickets</h2>
        <button class="btn btn-success" data-state="create">+ New Ticket</button>
      </div>
      <div id="ticketsList" class="loading">
        <div class="spinner"></div>
        <p>Loading tickets...</p>
      </div>
    `;

    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');

    try {
      const res = await api.get('/tickets');
      const ticketsList = document.getElementById('ticketsList');

      if (!res.success || !res.data?.length) {
        ticketsList.innerHTML = `
          <div class="empty-state">
            <p>No tickets found.</p>
            <button class="btn btn-primary" data-state="create">Create Your First Ticket</button>
          </div>
        `;
        bindStateButtons();
        return;
      }

      ticketsList.innerHTML = `
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
            ${res.data.map(t => `
              <tr class="clickable-row" data-state="ticket" data-id="${t.ticket_id}">
                <td><span class="ticket-number">${escapeHtml(t.number)}</span></td>
                <td>${escapeHtml(t.subject || 'No Subject')}</td>
                <td><span class="status status-${t.status?.state || 'open'}">${escapeHtml(t.status?.name || 'Open')}</span></td>
                <td>${escapeHtml(t.department?.name || 'N/A')}</td>
                <td>${formatDate(t.created)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      ticketsList.classList.remove('loading');
      bindTicketRows();
    } catch (e) {
      console.error('Error loading tickets:', e);
      document.getElementById('ticketsList').innerHTML = `
        <div class="error-state">
          <p class="error">Error loading tickets. Please try again.</p>
          <button class="btn" onclick="views.tickets()">Retry</button>
        </div>
      `;
    }
  },

  async ticket() {
    if (!currentUser) {
      app.gotoState('login');
      return;
    }

    const query = app.getQuery();
    const ticketId = query.id;

    if (!ticketId) {
      app.gotoState('tickets');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading ticket...</p>
      </div>
    `;

    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');

    try {
      const [ticketRes, threadRes] = await Promise.all([
        api.get(`/tickets/${ticketId}`),
        api.get(`/tickets/${ticketId}/thread`)
      ]);

      if (!ticketRes.success) {
        content.innerHTML = `
          <div class="error-state">
            <h2>Ticket Not Found</h2>
            <p>The ticket you requested could not be found.</p>
            <button class="btn" data-state="tickets">&larr; Back to Tickets</button>
          </div>
        `;
        bindStateButtons();
        return;
      }

      const t = ticketRes.data;
      const entries = threadRes.data || [];

      content.innerHTML = `
        <div class="ticket-detail slide-in">
          <div class="ticket-header">
            <div class="ticket-title">
              <button class="btn btn-sm" data-state="tickets">&larr;</button>
              <h2>Ticket #${escapeHtml(t.number)}</h2>
            </div>
            <span class="status status-${t.status?.state || 'open'}">${escapeHtml(t.status?.name || 'Open')}</span>
          </div>

          <div class="ticket-info">
            <div class="info-grid">
              <div class="info-item">
                <label>Subject</label>
                <span>${escapeHtml(t.subject || 'No Subject')}</span>
              </div>
              <div class="info-item">
                <label>Department</label>
                <span>${escapeHtml(t.department?.name || 'N/A')}</span>
              </div>
              <div class="info-item">
                <label>Priority</label>
                <span style="color: ${t.priority?.priority_color || '#666'}">${escapeHtml(t.priority?.priority || 'Normal')}</span>
              </div>
              <div class="info-item">
                <label>Created</label>
                <span>${formatDate(t.created)}</span>
              </div>
              ${t.staff ? `
                <div class="info-item">
                  <label>Assigned To</label>
                  <span>${escapeHtml(t.staff.name)}</span>
                </div>
              ` : ''}
              ${t.closed ? `
                <div class="info-item">
                  <label>Closed</label>
                  <span>${formatDate(t.closed)}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="thread">
            <h3>Conversation</h3>
            ${entries.length === 0 ? '<p class="empty-thread">No messages yet.</p>' : entries.map(e => `
              <div class="thread-entry thread-entry-${e.type === 'M' ? 'message' : 'response'}">
                <div class="entry-header">
                  <strong>${e.type === 'M' ? 'You' : escapeHtml(e.poster || 'Support')}</strong>
                  <span class="entry-date">${formatDate(e.created)}</span>
                </div>
                <div class="entry-body">${e.body}</div>
              </div>
            `).join('')}
          </div>

          ${t.status?.state !== 'closed' ? `
          <div class="reply-section">
            <h3>Post a Reply</h3>
            <form id="replyForm">
              <div class="form-group">
                <textarea id="replyMessage" name="message" required rows="4" placeholder="Type your reply..."></textarea>
              </div>
              <div class="form-error" id="replyError"></div>
              <button type="submit" class="btn btn-primary">Send Reply</button>
            </form>
          </div>
          ` : ''}

          <div class="ticket-actions">
            ${t.status?.state !== 'closed' ? `
              <button class="btn btn-danger" id="closeTicketBtn">Close Ticket</button>
            ` : `
              <button class="btn btn-success" id="reopenTicketBtn">Reopen Ticket</button>
            `}
            <button class="btn" data-state="tickets">&larr; Back to Tickets</button>
          </div>
        </div>
      `;

      // Bind reply form
      const replyForm = document.getElementById('replyForm');
      if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const msgEl = document.getElementById('replyMessage');
          const errorDiv = document.getElementById('replyError');
          const submitBtn = replyForm.querySelector('button[type="submit"]');

          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending...';
          errorDiv.textContent = '';

          try {
            const res = await api.post(`/tickets/${ticketId}/reply`, { message: msgEl.value });
            if (res.success) {
              app.gotoState('ticket', { id: ticketId });
            } else {
              errorDiv.textContent = res.message || 'Failed to send reply.';
            }
          } catch (err) {
            errorDiv.textContent = 'Connection error. Please try again.';
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reply';
          }
        });
      }

      // Bind close/reopen buttons
      const closeBtn = document.getElementById('closeTicketBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
          closeBtn.disabled = true;
          closeBtn.textContent = 'Closing...';
          try {
            const statusRes = await api.get('/statuses');
            const closedStatus = statusRes.data?.find(s => s.state === 'closed');
            if (closedStatus) {
              const res = await api.put(`/tickets/${ticketId}`, { status_id: closedStatus.id });
              if (res.success) {
                app.gotoState('ticket', { id: ticketId });
                return;
              }
            }
            closeBtn.textContent = 'Close failed';
          } catch (err) {
            closeBtn.textContent = 'Close failed';
          }
          closeBtn.disabled = false;
        });
      }

      const reopenBtn = document.getElementById('reopenTicketBtn');
      if (reopenBtn) {
        reopenBtn.addEventListener('click', async () => {
          reopenBtn.disabled = true;
          reopenBtn.textContent = 'Reopening...';
          try {
            const statusRes = await api.get('/statuses');
            const openStatus = statusRes.data?.find(s => s.state === 'open');
            if (openStatus) {
              const res = await api.put(`/tickets/${ticketId}`, { status_id: openStatus.id });
              if (res.success) {
                app.gotoState('ticket', { id: ticketId });
                return;
              }
            }
            reopenBtn.textContent = 'Reopen failed';
          } catch (err) {
            reopenBtn.textContent = 'Reopen failed';
          }
          reopenBtn.disabled = false;
        });
      }

      bindStateButtons();
    } catch (e) {
      console.error('Error loading ticket:', e);
      content.innerHTML = `
        <div class="error-state">
          <h2>Error</h2>
          <p>An error occurred loading the ticket.</p>
          <button class="btn" data-state="tickets">&larr; Back to Tickets</button>
        </div>
      `;
      bindStateButtons();
    }
  },

  async create() {
    if (!currentUser) {
      app.gotoState('login');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <div class="create-ticket slide-in">
        <div class="page-header">
          <h2>Create New Ticket</h2>
        </div>

        <form id="createTicketForm" class="ticket-form">
          <div class="form-group">
            <label for="topic_id">Help Topic *</label>
            <select id="topic_id" name="topic_id" required>
              <option value="">Loading topics...</option>
            </select>
          </div>

          <div class="form-group">
            <label for="subject">Subject *</label>
            <input type="text" id="subject" name="subject" required placeholder="Brief description of your issue" maxlength="255">
          </div>

          <div class="form-group">
            <label for="message">Message *</label>
            <textarea id="message" name="message" required rows="8" placeholder="Please describe your issue in detail..."></textarea>
          </div>

          <div class="form-error" id="createError"></div>

          <div class="form-actions">
            <button type="button" class="btn" data-state="tickets">Cancel</button>
            <button type="submit" class="btn btn-success">Create Ticket</button>
          </div>
        </form>
      </div>
    `;

    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');

    // Load topics
    try {
      const res = await api.get('/topics');
      const select = document.getElementById('topic_id');

      if (res.success && res.data?.length) {
        select.innerHTML = `
          <option value="">-- Select a Topic --</option>
          ${res.data.map(t => `
            <option value="${t.topic_id}">${escapeHtml(t.topic)}</option>
          `).join('')}
        `;
      } else {
        select.innerHTML = '<option value="">No topics available</option>';
      }
    } catch (e) {
      console.error('Error loading topics:', e);
      document.getElementById('topic_id').innerHTML = '<option value="">Error loading topics</option>';
    }

    document.getElementById('createTicketForm').addEventListener('submit', handleCreateTicket);
  },

  async faq() {
    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    content.innerHTML = `
      <h2>Knowledge Base</h2>
      <div id="faqList" class="loading">
        <div class="spinner"></div>
        <p>Loading articles...</p>
      </div>
    `;

    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');

    try {
      const res = await api.get('/faq');
      const faqList = document.getElementById('faqList');

      if (!res.success || !res.data?.length) {
        faqList.innerHTML = '<p>No articles found.</p>';
        return;
      }

      faqList.innerHTML = `
        <div class="faq-list">
          ${res.data.map(f => `
            <div class="faq-item">
              <h3 class="faq-question">${escapeHtml(f.question)}</h3>
              ${f.category?.name ? `<span class="faq-category">${escapeHtml(f.category.name)}</span>` : ''}
              <div class="faq-answer">${f.answer}</div>
            </div>
          `).join('')}
        </div>
      `;

      faqList.classList.remove('loading');
      initFaqAccordion();
    } catch (e) {
      console.error('Error loading FAQ:', e);
      document.getElementById('faqList').innerHTML = '<p class="error">Error loading knowledge base.</p>';
    }
  }
};

/**
 * Event handlers
 */
async function handleLogin(e) {
  e.preventDefault();

  const form = e.target;
  const errorDiv = document.getElementById('loginError');
  const submitBtn = form.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';
  errorDiv.textContent = '';

  const formData = new FormData(form);
  const data = Object.fromEntries(formData);

  // Add CSRF token
  if (window.APP_CONFIG?.csrfToken) {
    data._csrf = window.APP_CONFIG.csrfToken;
  }

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: new URLSearchParams(data)
    });

    if (res.redirected) {
      // Login successful - reload to get session
      window.location.href = res.url;
      return;
    }

    // Check if we got redirected back to login with error
    const url = new URL(res.url);
    const error = url.searchParams.get('error');

    if (error === 'invalid') {
      errorDiv.textContent = 'Invalid username or password.';
    } else if (error === 'server') {
      errorDiv.textContent = 'A server error occurred. Please try again.';
    } else {
      // Try to reload and check session
      window.location.reload();
    }
  } catch (e) {
    console.error('Login error:', e);
    errorDiv.textContent = 'Connection error. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Login';
  }
}

async function handleCreateTicket(e) {
  e.preventDefault();

  const form = e.target;
  const errorDiv = document.getElementById('createError');
  const submitBtn = form.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';
  errorDiv.textContent = '';

  const formData = new FormData(form);
  const data = {
    topic_id: parseInt(formData.get('topic_id'), 10),
    subject: formData.get('subject'),
    message: formData.get('message')
  };

  try {
    const res = await api.post('/tickets', data);

    if (res.success) {
      // Show success and redirect to ticket
      app.gotoState('ticket', { id: res.data.ticket_id });
    } else {
      errorDiv.textContent = res.message || 'Failed to create ticket. Please try again.';
    }
  } catch (e) {
    console.error('Create ticket error:', e);
    errorDiv.textContent = 'Connection error. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Ticket';
  }
}

async function handleLogout() {
  try {
    await fetch('/logout', { credentials: 'include' });
    currentUser = null;
    updateNav();
    app.gotoState('home');
  } catch (e) {
    console.error('Logout error:', e);
    window.location.href = '/logout';
  }
}

/**
 * UI helpers
 */
function bindStateButtons() {
  document.querySelectorAll('[data-state]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const state = btn.dataset.state;
      const id = btn.dataset.id;

      if (id) {
        app.gotoState(state, { id });
      } else {
        app.gotoState(state);
      }
    });
  });
}

function bindTicketRows() {
  document.querySelectorAll('.clickable-row[data-state="ticket"]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      app.gotoState('ticket', { id });
    });
  });
}

function initFaqAccordion() {
  document.querySelectorAll('.faq-item').forEach(item => {
    const question = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');

    if (question && answer) {
      answer.style.display = 'none';
      question.style.cursor = 'pointer';
      question.addEventListener('click', () => {
        const isOpen = answer.style.display !== 'none';
        answer.style.display = isOpen ? 'none' : 'block';
        question.classList.toggle('open', !isOpen);
      });
    }
  });
}

function updateNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  if (currentUser) {
    nav.innerHTML = `
      <button class="nav-link" data-state="home">Home</button>
      <button class="nav-link" data-state="tickets">My Tickets</button>
      <button class="nav-link" data-state="create">New Ticket</button>
      <button class="nav-link" data-state="faq">Knowledge Base</button>
      <span class="user-info">${escapeHtml(currentUser.name)}</span>
      <button class="nav-link" id="logoutBtn">Logout</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Show verification banner if unverified
    const existingBanner = document.querySelector('.verification-banner');
    if (existingBanner) existingBanner.remove();

    if (currentUser && currentUser.verified === false) {
      const banner = document.createElement('div');
      banner.className = 'verification-banner';
      banner.innerHTML = `
        <div class="container">
          <p>Your email is not verified. Please check your inbox.
            <button class="btn btn-sm" id="resendVerification">Resend Verification Email</button>
          </p>
        </div>
      `;
      document.querySelector('.main').prepend(banner);
      document.getElementById('resendVerification').addEventListener('click', async () => {
        const res = await api.post('/auth/resend-verification', {});
        alert(res.message || 'Verification email sent');
      });
    }
  } else {
    nav.innerHTML = `
      <button class="nav-link" data-state="home">Home</button>
      <button class="nav-link" data-state="faq">Knowledge Base</button>
      <button class="nav-link" data-state="login">Login</button>
    `;
  }

  bindStateButtons();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Idle timeout detection
 */
let idleTimer = null;
let idleWarningTimer = null;
const IDLE_TIMEOUT = window.APP_CONFIG?.idleTimeout || 30 * 60 * 1000;
const IDLE_WARNING = 5 * 60 * 1000; // warn 5 min before

function resetIdleTimers() {
  if (!currentUser) return;

  clearTimeout(idleTimer);
  clearTimeout(idleWarningTimer);

  // Remove existing warning
  const existing = document.querySelector('.idle-warning');
  if (existing) existing.remove();

  // Set warning timer
  idleWarningTimer = setTimeout(() => {
    const warning = document.createElement('div');
    warning.className = 'idle-warning';
    warning.innerHTML = `
      <div class="container">
        <p>Your session will expire soon due to inactivity.
          <button class="btn btn-sm" id="dismissIdleWarning">Stay Logged In</button>
        </p>
      </div>
    `;
    document.querySelector('.main').prepend(warning);
    document.getElementById('dismissIdleWarning').addEventListener('click', async () => {
      await api.get('/auth/me');
      warning.remove();
      resetIdleTimers();
    });
  }, IDLE_TIMEOUT - IDLE_WARNING);

  // Set logout timer
  idleTimer = setTimeout(() => {
    currentUser = null;
    updateNav();
    app.gotoState('login');
    const existing = document.querySelector('.idle-warning');
    if (existing) existing.remove();
  }, IDLE_TIMEOUT);
}

function initIdleDetection() {
  if (!currentUser) return;
  ['click', 'keypress', 'scroll', 'mousemove'].forEach(event => {
    document.addEventListener(event, () => resetIdleTimers(), { passive: true });
  });
  resetIdleTimers();
}

/**
 * Initialize the SPA
 */
async function initApp() {
  // Get user info from server-injected data
  currentUser = window.APP_CONFIG?.user || null;

  // Initialize ygdrassil state machine
  app = new StateMachine({
    name: 'app',
    initial: 'home',
    states: {
      home: {
        onEnter: () => views.home(),
        transition: ['login', 'tickets', 'create', 'faq', 'ticket']
      },
      login: {
        onEnter: () => views.login(),
        transition: ['home', 'tickets', 'register']
      },
      register: {
        onEnter: () => views.register(),
        transition: ['login', 'home']
      },
      tickets: {
        onEnter: () => views.tickets(),
        transition: ['home', 'ticket', 'create', 'faq']
      },
      ticket: {
        onEnter: () => views.ticket(),
        transition: ['tickets', 'home']
      },
      create: {
        onEnter: () => views.create(),
        transition: ['tickets', 'ticket', 'home']
      },
      faq: {
        onEnter: () => views.faq(),
        transition: ['home', 'tickets', 'login', 'create']
      }
    },
    onEnter: (state) => {
      // Update active nav state
      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.state === state);
      });
    }
  });

  updateNav();

  // If no hash state, go to home
  if (!window.location.hash || !window.location.hash.includes('yg-app')) {
    app.gotoState('home');
  }

  initIdleDetection();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
