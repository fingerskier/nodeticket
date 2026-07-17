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
  headers(extra = {}) {
    const headers = { ...extra };
    const csrf = window.APP_CONFIG?.csrfToken;
    if (csrf) headers['x-csrf-token'] = csrf;
    return headers;
  },

  async parseJson(res) {
    const text = await res.text();
    if (!text) {
      return {
        success: false,
        message: res.status ? `Empty response (${res.status})` : 'Empty response',
        status: res.status,
      };
    }
    try {
      const data = JSON.parse(text);
      if (typeof data === 'object' && data !== null && data.status == null) {
        data.status = res.status;
      }
      return data;
    } catch {
      return {
        success: false,
        message: res.ok ? 'Invalid JSON response' : `Request failed (${res.status})`,
        status: res.status,
        raw: text.slice(0, 200),
      };
    }
  },

  async get(endpoint) {
    const res = await fetch(`/api/v1${endpoint}`, {
      credentials: 'include',
      headers: this.headers()
    });
    return this.parseJson(res);
  },

  async post(endpoint, data) {
    const res = await fetch(`/api/v1${endpoint}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return this.parseJson(res);
  },

  async put(endpoint, data) {
    const res = await fetch(`/api/v1${endpoint}`, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return this.parseJson(res);
  }
};

/**
 * Convert FileList / File[] to API attachment payloads (RFC 2397 data URLs).
 * @param {FileList|File[]} fileList
 * @param {{ maxBytes?: number, maxFiles?: number }} [opts]
 */
async function filesToAttachments(fileList, opts = {}) {
  const maxBytes = opts.maxBytes || 5 * 1024 * 1024;
  const maxFiles = opts.maxFiles || 5;
  const files = Array.from(fileList || []).slice(0, maxFiles);
  const out = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      throw new Error(`File "${file.name}" exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
    }
    // eslint-disable-next-line no-await-in-loop
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
    out.push({
      name: file.name,
      type: file.type || 'application/octet-stream',
      data: dataUrl,
    });
  }
  return out;
}

/** Download attachment via authenticated session fetch */
async function downloadTicketAttachment(ticketId, fileId, name) {
  const res = await fetch(`/api/v1/tickets/${ticketId}/attachments/${fileId}`, {
    credentials: 'include',
    headers: api.headers(),
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || `file-${fileId}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatFileSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachmentsList(ticketId, attachments) {
  if (!attachments?.length) {
    return '<p class="text-muted empty-attachments">No attachments.</p>';
  }
  return `
    <ul class="attachment-list">
      ${attachments.map((a) => `
        <li class="attachment-item">
          <button type="button" class="attachment-link"
            data-file-id="${a.file_id}"
            data-file-name="${escapeHtml(a.name || 'download')}">
            📎 ${escapeHtml(a.name || 'file')}
          </button>
          <span class="attachment-meta">${escapeHtml(a.mime_type || '')} · ${formatFileSize(a.size)}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function bindAttachmentDownloads(ticketId, root = document) {
  root.querySelectorAll('.attachment-link[data-file-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fileId = btn.getAttribute('data-file-id');
      const name = btn.getAttribute('data-file-name') || 'download';
      btn.disabled = true;
      try {
        await downloadTicketAttachment(ticketId, fileId, name);
      } catch (err) {
        alert(err.message || 'Download failed');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function notificationBanner(notification) {
  if (!notification) return '';
  if (notification.sent) {
    return '<div class="alert alert-success" role="status">Email notification sent.</div>';
  }
  if (notification.reason === 'user_message' || notification.reason === 'no_email') {
    return '';
  }
  return `<div class="alert alert-warning" role="status">Saved, but email notification failed${
    notification.reason ? `: ${escapeHtml(String(notification.reason))}` : ''
  }.</div>`;
}

/** Safe query params from URL / state machine */
function getAppQuery() {
  if (app && typeof app.getQuery === 'function') {
    try {
      return app.getQuery() || {};
    } catch {
      /* fall through */
    }
  }
  // Fallback: parse ygdrassil-style or plain hash query
  try {
    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return {};
    return Object.fromEntries(new URLSearchParams(hash.slice(qIndex + 1)));
  } catch {
    return {};
  }
}

/** Draft message persistence across reauth / navigation (sessionStorage) */
const DRAFT_PREFIX = 'nt_draft_';
function draftKey(kind, id) {
  return `${DRAFT_PREFIX}${kind}_${id || 'new'}`;
}
function saveDraft(kind, id, text) {
  try {
    if (text && String(text).trim()) {
      sessionStorage.setItem(draftKey(kind, id), String(text));
    } else {
      sessionStorage.removeItem(draftKey(kind, id));
    }
  } catch { /* private mode */ }
}
function loadDraft(kind, id) {
  try {
    return sessionStorage.getItem(draftKey(kind, id)) || '';
  } catch {
    return '';
  }
}
function clearDraft(kind, id) {
  try {
    sessionStorage.removeItem(draftKey(kind, id));
  } catch { /* ignore */ }
}

function focusMainHeading() {
  const h = document.querySelector('#content h1, #content h2');
  if (h) {
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: false }); } catch { /* ignore */ }
  }
}

const THREAD_PAGE_SIZE = 20;

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
    if (!content) return;

    // Always paint shell first so we never stick on the HTML "Loading..." placeholder
    // while waiting on the tickets API (slow/hung DB was freezing the home view).
    content.innerHTML = `
      <div class="hero">
        <h1>Welcome to ${escapeHtml(window.APP_CONFIG?.title || 'Nodeticket Help Desk')}</h1>
        <p>How can we help you today?</p>
      </div>
      ${currentUser ? `
        <div class="dashboard" id="homeDashboard">
          <div class="stats-card">
            <h3>Your Open Tickets</h3>
            <p class="stat-number" id="openTicketCount">…</p>
            <button class="btn btn-primary" data-state="tickets">View Tickets</button>
          </div>
          <div class="quick-actions">
            <h3>Quick Actions</h3>
            <button class="btn btn-success" data-state="create">Create New Ticket</button>
            <button class="btn" data-state="tickets">View All Tickets</button>
            <button class="btn" data-state="faq">Browse Knowledge Base</button>
          </div>
        </div>
      ` : `
        <div class="login-prompt">
          <p>Please <button class="link-btn" data-state="login">log in</button> to view your tickets or submit a new request.</p>
          <p class="guest-actions">
            <button class="btn btn-primary" data-state="login">Login</button>
            <button class="btn btn-success" data-state="register">Create Account</button>
            <button class="btn" data-state="faq">Browse Knowledge Base</button>
          </p>
          <p class="text-muted"><a href="/forgot-password">Forgot password?</a></p>
        </div>
      `}
    `;
    bindStateButtons();
    focusMainHeading();

    if (!currentUser) return;

    // Load open-ticket count in background (do not block UI)
    try {
      const res = await api.get(`/tickets?status=open&limit=1`);
      const el = document.getElementById('openTicketCount');
      if (el) {
        el.textContent = String(
          res?.pagination?.total != null ? res.pagination.total : (res?.data?.length || 0)
        );
      }
    } catch (e) {
      console.error('Error loading stats:', e);
      const el = document.getElementById('openTicketCount');
      if (el) el.textContent = '—';
    }
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
          <div class="form-error" id="loginError" role="alert" aria-live="assertive"></div>
          <button type="submit" class="btn btn-primary btn-block">Login</button>
        </form>
        <p class="form-footer form-footer-stack">
          <a href="/forgot-password">Forgot password?</a>
          <button type="button" class="link-btn" data-state="register">Create Account</button>
          <button type="button" class="link-btn" data-state="home">&larr; Back to Home</button>
        </p>
      </div>
    `;

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    bindStateButtons();
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
    focusMainHeading();
    document.getElementById('username')?.focus();
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
          <div class="form-error" id="registerError" role="alert" aria-live="assertive"></div>
          <button type="submit" class="btn btn-primary btn-block">Create Account</button>
        </form>
        <p class="form-footer form-footer-stack">
          <button type="button" class="link-btn" data-state="login">&larr; Back to Login</button>
          <a href="/forgot-password">Forgot password?</a>
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
    focusMainHeading();
    document.getElementById('reg-name')?.focus();
  },

  async tickets() {
    if (!currentUser) {
      app.gotoState('login');
      return;
    }

    const content = document.getElementById('content');
    content.classList.add('fade-out');
    await delay(150);

    const query = getAppQuery();
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const status = query.status || '';
    const search = query.search != null ? String(query.search) : '';

    content.innerHTML = `
      <div class="page-header">
        <h2>My Tickets</h2>
        <button class="btn btn-success" data-state="create">+ New Ticket</button>
      </div>
      <form class="ticket-filters" id="ticketFilters" role="search">
        <label for="ticketSearch" class="sr-only">Search tickets</label>
        <input type="search" id="ticketSearch" name="search" value="${escapeHtml(search)}"
          placeholder="Search # or subject…" autocomplete="off">
        <label for="ticketStatusFilter" class="sr-only">Status</label>
        <select id="ticketStatusFilter" aria-label="Filter by status">
          <option value="" ${!status ? 'selected' : ''}>All statuses</option>
          <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
        <button type="submit" class="btn btn-primary">Apply</button>
        ${search || status ? '<button type="button" class="btn" id="clearTicketFilters">Clear</button>' : ''}
      </form>
      <div id="ticketsList" class="loading" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading tickets...</p>
      </div>
      <nav id="ticketsPagination" class="pagination" aria-label="Ticket list pages"></nav>
    `;

    bindStateButtons();
    /** Same-state query updates do not re-fire onEnter — re-render explicitly. */
    const goTickets = (q) => {
      const already = app.is('tickets');
      app.gotoState('tickets', q, true);
      if (already) views.tickets();
    };
    const applyFilters = () => {
      const q = { page: 1 };
      const s = document.getElementById('ticketStatusFilter')?.value;
      const term = document.getElementById('ticketSearch')?.value?.trim();
      if (s) q.status = s;
      if (term) q.search = term;
      goTickets(q);
    };
    document.getElementById('ticketFilters')?.addEventListener('submit', (e) => {
      e.preventDefault();
      applyFilters();
    });
    document.getElementById('ticketStatusFilter')?.addEventListener('change', applyFilters);
    document.getElementById('clearTicketFilters')?.addEventListener('click', () => {
      goTickets({ page: 1 });
    });
    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
    focusMainHeading();

    const ticketsList = document.getElementById('ticketsList');
    const pagEl = document.getElementById('ticketsPagination');
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '25' });
      if (status) qs.set('status', status);
      if (search) qs.set('search', search);
      const res = await api.get(`/tickets?${qs.toString()}`);
      if (!ticketsList) return;

      const rows = Array.isArray(res?.data) ? res.data : [];
      if (!res?.success || rows.length === 0) {
        ticketsList.innerHTML = `
          <div class="empty-state">
            <p>${escapeHtml(res?.message || (search || status ? 'No tickets match your filters.' : 'No tickets found.'))}</p>
            <button class="btn btn-primary" data-state="create">Create Your First Ticket</button>
          </div>
        `;
        if (pagEl) pagEl.innerHTML = '';
        ticketsList.classList.remove('loading');
        bindStateButtons();
        return;
      }

      ticketsList.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Ticket #</th>
              <th scope="col">Subject</th>
              <th scope="col">Status</th>
              <th scope="col">Department</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(t => `
              <tr class="clickable-row" data-state="ticket" data-id="${t.ticket_id}" tabindex="0" role="link"
                aria-label="Open ticket ${escapeHtml(t.number)}">
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

      const totalPages = res.pagination?.totalPages || 1;
      const total = res.pagination?.total || rows.length;
      if (pagEl && totalPages > 1) {
        const prev = page > 1
          ? `<button type="button" class="btn" data-page="${page - 1}">&laquo; Previous</button>`
          : '<span class="pagination-disabled" aria-hidden="true">&laquo; Previous</span>';
        const next = page < totalPages
          ? `<button type="button" class="btn" data-page="${page + 1}">Next &raquo;</button>`
          : '<span class="pagination-disabled" aria-hidden="true">Next &raquo;</span>';
        pagEl.innerHTML = `${prev} <span aria-current="page">Page ${page} of ${totalPages} (${total})</span> ${next}`;
        pagEl.querySelectorAll('[data-page]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const q = { page: btn.getAttribute('data-page') };
            if (status) q.status = status;
            if (search) q.search = search;
            const already = app.is('tickets');
            app.gotoState('tickets', q, true);
            if (already) views.tickets();
          });
        });
      } else if (pagEl) {
        pagEl.innerHTML = total ? `<span>${total} ticket${total === 1 ? '' : 's'}</span>` : '';
      }

      ticketsList.classList.remove('loading');
      bindTicketRows();
    } catch (e) {
      console.error('Error loading tickets:', e);
      if (ticketsList) {
        ticketsList.classList.remove('loading');
        ticketsList.innerHTML = `
          <div class="error-state">
            <p class="error" role="alert">Error loading tickets. Please try again.</p>
            <button class="btn" type="button" id="retryTickets">Retry</button>
          </div>
        `;
        document.getElementById('retryTickets')?.addEventListener('click', () => views.tickets());
      }
    }
  },

  async ticket() {
    if (!currentUser) {
      app.gotoState('login');
      return;
    }

    const query = getAppQuery();
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
      const [ticketRes, threadProbe, attachRes] = await Promise.all([
        api.get(`/tickets/${ticketId}`),
        api.get(`/tickets/${ticketId}/thread?page=1&limit=${THREAD_PAGE_SIZE}`),
        api.get(`/tickets/${ticketId}/attachments`).catch(() => ({ success: false, data: [] })),
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
      const totalPages = Math.max(1, threadProbe.pagination?.totalPages || 1);
      const totalEntries = threadProbe.pagination?.total || 0;
      // Load newest page first (chronological ASC within page)
      let oldestLoadedPage = totalPages;
      let threadRes = totalPages === 1
        ? threadProbe
        : await api.get(`/tickets/${ticketId}/thread?page=${totalPages}&limit=${THREAD_PAGE_SIZE}`);
      let entries = Array.isArray(threadRes.data) ? threadRes.data.slice() : [];
      const attachments = Array.isArray(attachRes?.data) ? attachRes.data : [];
      const byEntry = new Map();
      for (const a of attachments) {
        const key = a.entry_id || 0;
        if (!byEntry.has(key)) byEntry.set(key, []);
        byEntry.get(key).push(a);
      }

      const renderEntry = (e) => `
        <div class="thread-entry thread-entry-${e.type === 'M' ? 'message' : 'response'}" data-entry-id="${e.id}">
          <div class="entry-header">
            <strong>${e.type === 'M' ? 'You' : escapeHtml(e.poster || 'Support')}</strong>
            <span class="entry-date">${formatDate(e.created)}</span>
          </div>
          <div class="entry-body">${escapeHtml(e.body)}</div>
          ${byEntry.has(e.id) ? `
            <div class="entry-attachments">
              ${renderAttachmentsList(ticketId, byEntry.get(e.id))}
            </div>
          ` : ''}
        </div>
      `;

      const draftReply = loadDraft('reply', ticketId);

      content.innerHTML = `
        <div class="ticket-detail slide-in">
          <div class="ticket-header">
            <div class="ticket-title">
              <button class="btn btn-sm" data-state="tickets" aria-label="Back to tickets">&larr;</button>
              <h2>Ticket #${escapeHtml(t.number)}</h2>
            </div>
            <span class="status status-${t.status?.state || 'open'}">${escapeHtml(t.status?.name || 'Open')}</span>
          </div>

          <div class="ticket-info">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Subject</span>
                <span>${escapeHtml(t.subject || 'No Subject')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Department</span>
                <span>${escapeHtml(t.department?.name || 'N/A')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Priority</span>
                <span style="color: ${t.priority?.priority_color || '#666'}">${escapeHtml(t.priority?.priority || 'Normal')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Created</span>
                <span>${formatDate(t.created)}</span>
              </div>
              ${t.staff ? `
                <div class="info-item">
                  <span class="info-label">Assigned To</span>
                  <span>${escapeHtml(t.staff.name)}</span>
                </div>
              ` : ''}
              ${t.closed ? `
                <div class="info-item">
                  <span class="info-label">Closed</span>
                  <span>${formatDate(t.closed)}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="attachments-section">
            <h3>Attachments</h3>
            ${renderAttachmentsList(ticketId, attachments)}
          </div>

          <div class="thread">
            <h3>Conversation ${totalEntries ? `<span class="thread-count">(${totalEntries})</span>` : ''}</h3>
            <div id="loadOlderWrap" class="load-older-wrap" ${oldestLoadedPage <= 1 ? 'hidden' : ''}>
              <button type="button" class="btn btn-sm" id="loadOlderBtn">Load older messages</button>
            </div>
            <div id="threadEntries">
              ${entries.length === 0 ? '<p class="empty-thread">No messages yet.</p>' : entries.map(renderEntry).join('')}
            </div>
          </div>

          ${t.status?.state !== 'closed' ? `
          <div class="reply-section">
            <h3>Post a Reply</h3>
            <form id="replyForm">
              <div class="form-group">
                <label for="replyMessage" class="sr-only">Reply message</label>
                <textarea id="replyMessage" name="message" required rows="4" placeholder="Type your reply...">${escapeHtml(draftReply)}</textarea>
              </div>
              <div class="form-group">
                <label for="replyFiles">Attachments (optional, max 5 × 5MB)</label>
                <input type="file" id="replyFiles" name="files" multiple
                  accept=".png,.jpg,.jpeg,.gif,.pdf,.txt,.doc,.docx,.zip,image/*,application/pdf">
              </div>
              <div class="form-error" id="replyError" role="alert" aria-live="assertive"></div>
              <div id="replyNotice" aria-live="polite"></div>
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

      bindAttachmentDownloads(ticketId, content);
      focusMainHeading();

      const loadOlderBtn = document.getElementById('loadOlderBtn');
      const loadOlderWrap = document.getElementById('loadOlderWrap');
      const threadEl = document.getElementById('threadEntries');
      if (loadOlderBtn && threadEl) {
        loadOlderBtn.addEventListener('click', async () => {
          if (oldestLoadedPage <= 1) return;
          loadOlderBtn.disabled = true;
          loadOlderBtn.textContent = 'Loading…';
          try {
            const prevPage = oldestLoadedPage - 1;
            const older = await api.get(
              `/tickets/${ticketId}/thread?page=${prevPage}&limit=${THREAD_PAGE_SIZE}`
            );
            const olderEntries = Array.isArray(older?.data) ? older.data : [];
            oldestLoadedPage = prevPage;
            if (olderEntries.length) {
              const html = olderEntries.map(renderEntry).join('');
              threadEl.insertAdjacentHTML('afterbegin', html);
              bindAttachmentDownloads(ticketId, threadEl);
            }
            if (oldestLoadedPage <= 1 && loadOlderWrap) {
              loadOlderWrap.hidden = true;
            }
          } catch (err) {
            console.error('Load older failed:', err);
          } finally {
            loadOlderBtn.disabled = false;
            loadOlderBtn.textContent = 'Load older messages';
          }
        });
      }

      // Bind reply form + draft autosave
      const replyForm = document.getElementById('replyForm');
      const replyMsg = document.getElementById('replyMessage');
      if (replyMsg) {
        replyMsg.addEventListener('input', () => saveDraft('reply', ticketId, replyMsg.value));
      }
      if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const msgEl = document.getElementById('replyMessage');
          const errorDiv = document.getElementById('replyError');
          const noticeDiv = document.getElementById('replyNotice');
          const fileInput = document.getElementById('replyFiles');
          const submitBtn = replyForm.querySelector('button[type="submit"]');

          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending...';
          errorDiv.textContent = '';
          if (noticeDiv) noticeDiv.innerHTML = '';

          try {
            let replyAttachments = [];
            if (fileInput?.files?.length) {
              replyAttachments = await filesToAttachments(fileInput.files);
            }
            const payload = { message: msgEl.value };
            if (replyAttachments.length) payload.attachments = replyAttachments;
            const res = await api.post(`/tickets/${ticketId}/reply`, payload);
            if (res.success) {
              clearDraft('reply', ticketId);
              const reloadTicket = () => {
                const already = app.is('ticket');
                app.gotoState('ticket', { id: ticketId }, true);
                if (already) views.ticket();
              };
              if (res.notification && res.notification.sent === false
                && res.notification.reason !== 'user_message'
                && res.notification.reason !== 'no_email') {
                if (noticeDiv) noticeDiv.innerHTML = notificationBanner(res.notification);
                setTimeout(reloadTicket, 1200);
              } else {
                reloadTicket();
              }
            } else {
              errorDiv.textContent = res.message || 'Failed to send reply.';
            }
          } catch (err) {
            errorDiv.textContent = err.message || 'Connection error. Please try again.';
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reply';
          }
        });
      }

      // Bind close/reopen buttons (named server-side actions)
      const closeBtn = document.getElementById('closeTicketBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
          closeBtn.disabled = true;
          closeBtn.textContent = 'Closing...';
          try {
            const res = await api.put(`/tickets/${ticketId}`, { action: 'close' });
            if (res.success) {
              app.gotoState('ticket', { id: ticketId });
              return;
            }
            closeBtn.textContent = res.message || 'Close failed';
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
            const res = await api.put(`/tickets/${ticketId}`, { action: 'reopen' });
            if (res.success) {
              app.gotoState('ticket', { id: ticketId });
              return;
            }
            reopenBtn.textContent = res.message || 'Reopen failed';
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

          <div class="form-group">
            <label for="createFiles">Attachments (optional, max 5 × 5MB)</label>
            <input type="file" id="createFiles" name="files" multiple
              accept=".png,.jpg,.jpeg,.gif,.pdf,.txt,.doc,.docx,.zip,image/*,application/pdf">
          </div>

          <div class="form-error" id="createError" role="alert" aria-live="assertive"></div>
          <div id="createNotice" aria-live="polite"></div>

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
    focusMainHeading();

    // Restore create draft
    const draftCreate = loadDraft('create', 'new');
    if (draftCreate) {
      try {
        const parsed = JSON.parse(draftCreate);
        if (parsed.subject) document.getElementById('subject').value = parsed.subject;
        if (parsed.message) document.getElementById('message').value = parsed.message;
        if (parsed.topic_id) {
          // applied after topics load
          document.getElementById('createTicketForm').dataset.draftTopic = String(parsed.topic_id);
        }
      } catch {
        document.getElementById('message').value = draftCreate;
      }
    }
    const persistCreateDraft = () => {
      saveDraft('create', 'new', JSON.stringify({
        topic_id: document.getElementById('topic_id')?.value || '',
        subject: document.getElementById('subject')?.value || '',
        message: document.getElementById('message')?.value || '',
      }));
    };
    ['topic_id', 'subject', 'message'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', persistCreateDraft);
      document.getElementById(id)?.addEventListener('change', persistCreateDraft);
    });

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
        const draftTopic = document.getElementById('createTicketForm')?.dataset.draftTopic;
        if (draftTopic) select.value = draftTopic;
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
      <div class="page-header">
        <h2>Knowledge Base</h2>
      </div>
      <form class="faq-search" id="faqSearchForm" role="search">
        <label for="faqSearch" class="sr-only">Search articles</label>
        <input type="search" id="faqSearch" placeholder="Search questions…" autocomplete="off">
      </form>
      <div id="faqList" class="loading" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading articles...</p>
      </div>
    `;

    content.classList.remove('fade-out');
    content.classList.add('fade-in');
    await delay(150);
    content.classList.remove('fade-in');
    focusMainHeading();

    try {
      const res = await api.get('/faq');
      const faqList = document.getElementById('faqList');
      if (!faqList) return;

      const items = Array.isArray(res?.data) ? res.data : [];
      if (!res?.success || items.length === 0) {
        faqList.innerHTML = `<p>${escapeHtml(res?.message || 'No articles found.')}</p>`;
        faqList.classList.remove('loading');
        return;
      }

      const renderFaq = (list) => {
        if (!list.length) {
          faqList.innerHTML = '<p class="empty-state">No articles match your search.</p>';
          return;
        }
        faqList.innerHTML = `
          <div class="faq-list">
            ${list.map((f, i) => `
              <div class="faq-item">
                <h3 class="faq-question" id="faq-q-${i}" tabindex="0" role="button"
                  aria-expanded="false" aria-controls="faq-a-${i}">${escapeHtml(f.question)}</h3>
                ${f.category?.name ? `<span class="faq-category">${escapeHtml(f.category.name)}</span>` : ''}
                <div class="faq-answer" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}">${escapeHtml(f.answer)}</div>
              </div>
            `).join('')}
          </div>
        `;
        initFaqAccordion();
      };

      renderFaq(items);
      faqList.classList.remove('loading');

      const searchInput = document.getElementById('faqSearch');
      searchInput?.addEventListener('input', () => {
        const q = (searchInput.value || '').trim().toLowerCase();
        if (!q) {
          renderFaq(items);
          return;
        }
        renderFaq(items.filter((f) =>
          (f.question || '').toLowerCase().includes(q)
          || (f.answer || '').toLowerCase().includes(q)
          || (f.category?.name || '').toLowerCase().includes(q)
        ));
      });
    } catch (e) {
      console.error('Error loading FAQ:', e);
      const faqList = document.getElementById('faqList');
      if (faqList) {
        faqList.innerHTML = '<p class="error" role="alert">Error loading knowledge base.</p>';
        faqList.classList.remove('loading');
      }
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

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
  }
  if (errorDiv) errorDiv.textContent = '';

  const formData = new FormData(form);
  const username = formData.get('username');
  const password = formData.get('password');
  const type = formData.get('type') || 'user';

  try {
    // Prefer JSON API login (clear success/error); fall back to form POST
    const apiRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: api.headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ username, password, type }),
    });
    const body = await api.parseJson(apiRes);

    if (apiRes.ok && body.success && body.user) {
      currentUser = body.user;
      window.APP_CONFIG = window.APP_CONFIG || {};
      window.APP_CONFIG.user = body.user;
      // Staff use admin UI (full navigation — needs session cookie on same origin HTTP)
      if (body.user.type === 'staff') {
        window.location.assign('/admin');
        return;
      }
      updateNav();
      initIdleDetection();
      // Prefer tickets list after login; fall back to home if state machine rejects transition
      try {
        app.gotoState('tickets');
      } catch (err) {
        console.warn('gotoState tickets failed, using home', err);
        app.gotoState('home');
      }
      return;
    }

    // Form POST path (HTML login) if API failed without a clear auth error
    if (apiRes.status === 401 || body.message) {
      if (errorDiv) {
        errorDiv.textContent = body.message || 'Invalid username or password.';
      }
      return;
    }

    const data = Object.fromEntries(formData);
    if (window.APP_CONFIG?.csrfToken) {
      data._csrf = window.APP_CONFIG.csrfToken;
    }

    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: new URLSearchParams(data),
      redirect: 'follow',
    });

    if (res.redirected || (res.url && !res.url.includes('error='))) {
      window.location.href = res.url || '/';
      return;
    }

    let error = null;
    try {
      error = new URL(res.url).searchParams.get('error');
    } catch { /* ignore */ }

    if (errorDiv) {
      if (error === 'invalid') {
        errorDiv.textContent = 'Invalid username or password.';
      } else if (error === 'server') {
        errorDiv.textContent = 'A server error occurred. Please try again.';
      } else if (res.status === 403) {
        errorDiv.textContent = 'Security check failed (CSRF). Please refresh the page and try again.';
      } else {
        errorDiv.textContent = 'Login failed. Please check your credentials.';
      }
    }
  } catch (e) {
    console.error('Login error:', e);
    if (errorDiv) {
      // Common local-dev mistake: open https://localhost while the server is HTTP-only
      if (window.location.protocol === 'https:' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
        const httpUrl = `http://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`;
        errorDiv.innerHTML =
          'Cannot reach the server over <strong>HTTPS</strong> (no TLS certificate). ' +
          `Open <a href="${httpUrl}">${httpUrl}</a> instead (use <code>http://</code>, not <code>https://</code>).`;
      } else if (e && (e.name === 'TypeError' || /Failed to fetch|NetworkError|SSL/i.test(String(e.message || e)))) {
        errorDiv.textContent =
          'Connection failed. If you used https://, switch to http:// for local dev. Otherwise check that the server is running.';
      } else {
        errorDiv.textContent = 'Connection error. Please try again.';
      }
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
    }
  }
}

async function handleCreateTicket(e) {
  e.preventDefault();

  const form = e.target;
  const errorDiv = document.getElementById('createError');
  const noticeDiv = document.getElementById('createNotice');
  const submitBtn = form.querySelector('button[type="submit"]');
  const fileInput = document.getElementById('createFiles');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';
  if (errorDiv) errorDiv.textContent = '';
  if (noticeDiv) noticeDiv.innerHTML = '';

  const formData = new FormData(form);
  const data = {
    topic_id: parseInt(formData.get('topic_id'), 10),
    subject: formData.get('subject'),
    message: formData.get('message'),
  };

  try {
    if (fileInput?.files?.length) {
      data.attachments = await filesToAttachments(fileInput.files);
    }
    const res = await api.post('/tickets', data);

    if (res.success) {
      clearDraft('create', 'new');
      if (res.notification && res.notification.sent === false
        && res.notification.reason !== 'no_email') {
        if (noticeDiv) noticeDiv.innerHTML = notificationBanner(res.notification);
        setTimeout(() => app.gotoState('ticket', { id: res.data.ticket_id }, true), 1200);
      } else {
        app.gotoState('ticket', { id: res.data.ticket_id }, true);
      }
    } else {
      if (errorDiv) errorDiv.textContent = res.message || 'Failed to create ticket. Please try again.';
    }
  } catch (err) {
    console.error('Create ticket error:', err);
    if (errorDiv) errorDiv.textContent = err.message || 'Connection error. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Ticket';
  }
}

async function handleLogout() {
  clearTimeout(idleTimer);
  clearTimeout(idleWarningTimer);
  try {
    await fetch('/logout', { credentials: 'include', redirect: 'manual' });
  } catch (e) {
    console.error('Logout error:', e);
  }
  currentUser = null;
  if (window.APP_CONFIG) window.APP_CONFIG.user = null;
  updateNav();
  try {
    app.gotoState('home', null, true);
  } catch {
    window.location.href = '/';
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
    const open = () => {
      const id = row.dataset.id;
      app.gotoState('ticket', { id });
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
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
      const toggle = () => {
        const isOpen = answer.style.display !== 'none';
        answer.style.display = isOpen ? 'none' : 'block';
        question.classList.toggle('open', !isOpen);
        question.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      };
      question.setAttribute('aria-expanded', 'false');
      question.addEventListener('click', toggle);
      question.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }
  });
}

function updateNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  if (currentUser) {
    const displayName = currentUser.name || currentUser.username || 'Account';
    nav.innerHTML = `
      <button type="button" class="nav-link" data-state="home">Home</button>
      <button type="button" class="nav-link" data-state="tickets">My Tickets</button>
      <button type="button" class="nav-link" data-state="create">New Ticket</button>
      <button type="button" class="nav-link" data-state="faq">Knowledge Base</button>
      <a class="nav-link" href="/profile" id="profileLink">${escapeHtml(displayName)}</a>
      <button type="button" class="nav-link" id="logoutBtn">Logout</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Show verification banner if unverified
    const existingBanner = document.querySelector('.verification-banner');
    if (existingBanner) existingBanner.remove();

    if (currentUser && currentUser.verified === false) {
      const banner = document.createElement('div');
      banner.className = 'verification-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = `
        <div class="container">
          <p>Your email is not verified. Please check your inbox.
            <button type="button" class="btn btn-sm" id="resendVerification">Resend Verification Email</button>
          </p>
        </div>
      `;
      document.querySelector('.main')?.prepend(banner);
      document.getElementById('resendVerification')?.addEventListener('click', async () => {
        const res = await api.post('/auth/resend-verification', {});
        alert(res.message || 'Verification email sent');
      });
    }
  } else {
    nav.innerHTML = `
      <button type="button" class="nav-link" data-state="home">Home</button>
      <button type="button" class="nav-link" data-state="faq">Knowledge Base</button>
      <button type="button" class="nav-link" data-state="login">Login</button>
      <button type="button" class="nav-link" data-state="register">Register</button>
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
const IDLE_TIMEOUT = Number(window.APP_CONFIG?.idleTimeout) || 30 * 60 * 1000;
const IDLE_WARNING = Math.min(5 * 60 * 1000, Math.max(30 * 1000, Math.floor(IDLE_TIMEOUT / 6)));

function resetIdleTimers() {
  if (!currentUser) return;

  clearTimeout(idleTimer);
  clearTimeout(idleWarningTimer);

  // Remove existing warning
  const existing = document.querySelector('.idle-warning');
  if (existing) existing.remove();

  // Set warning timer (aligned under server idleTimeout)
  const warnDelay = Math.max(0, IDLE_TIMEOUT - IDLE_WARNING);
  idleWarningTimer = setTimeout(() => {
    const warning = document.createElement('div');
    warning.className = 'idle-warning';
    warning.setAttribute('role', 'alert');
    warning.innerHTML = `
      <div class="container">
        <p>Your session will expire soon due to inactivity.
          <button type="button" class="btn btn-sm" id="dismissIdleWarning">Stay Logged In</button>
        </p>
      </div>
    `;
    document.querySelector('.main')?.prepend(warning);
    document.getElementById('dismissIdleWarning')?.addEventListener('click', async () => {
      try { await api.get('/auth/me'); } catch { /* ignore */ }
      warning.remove();
      resetIdleTimers();
    });
  }, warnDelay);

  // Set logout timer — full session teardown (matches server idle)
  idleTimer = setTimeout(async () => {
    const existing = document.querySelector('.idle-warning');
    if (existing) existing.remove();
    await handleLogout();
    app.gotoState('login', null, true);
    const content = document.getElementById('content');
    if (content && !document.getElementById('loginError')) {
      // soft notice after idle logout paints login
      setTimeout(() => {
        const err = document.getElementById('loginError');
        if (err) err.textContent = 'You were logged out due to inactivity.';
      }, 200);
    }
  }, IDLE_TIMEOUT);
}

let idleListenersBound = false;
function initIdleDetection() {
  if (!currentUser) return;
  if (!idleListenersBound) {
    idleListenersBound = true;
    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach((event) => {
      document.addEventListener(event, () => resetIdleTimers(), { passive: true });
    });
  }
  resetIdleTimers();
}

/**
 * Initialize the SPA
 */
async function initApp() {
  // Get user info from server-injected data
  currentUser = window.APP_CONFIG?.user || null;

  if (typeof StateMachine !== 'function') {
    console.error('Ygdrassil StateMachine not loaded');
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = '<div class="error-state"><h2>Failed to load app shell</h2><p>Could not load the state machine library. Check network/CDN access.</p></div>';
    }
    return;
  }

  // Initialize ygdrassil state machine (v2026.7.x API)
  app = new StateMachine({
    name: 'app',
    initial: 'home',
    states: {
      home: {
        onEnter: () => views.home(),
        transition: ['login', 'register', 'tickets', 'create', 'faq', 'ticket']
      },
      login: {
        onEnter: () => views.login(),
        transition: ['home', 'tickets', 'register', 'faq']
      },
      register: {
        onEnter: () => views.register(),
        transition: ['login', 'home', 'faq']
      },
      tickets: {
        onEnter: () => views.tickets(),
        transition: ['home', 'ticket', 'create', 'faq', 'login']
      },
      ticket: {
        onEnter: () => views.ticket(),
        transition: ['tickets', 'home', 'create', 'faq', 'login']
      },
      create: {
        onEnter: () => views.create(),
        transition: ['tickets', 'ticket', 'home', 'faq', 'login']
      },
      faq: {
        onEnter: () => views.faq(),
        transition: ['home', 'tickets', 'login', 'register', 'create']
      }
    },
    onEnter: (state) => {
      document.querySelectorAll('.nav-link[data-state]').forEach((link) => {
        const active = link.dataset.state === state;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },
    onTransitionDenied: (from, to) => {
      console.warn(`Navigation denied: ${from} → ${to}`);
    }
  });

  document.getElementById('siteLogo')?.addEventListener('click', (e) => {
    e.preventDefault();
    app.gotoState('home', null, true);
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
