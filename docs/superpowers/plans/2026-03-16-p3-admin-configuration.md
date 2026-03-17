# P3 Admin & Configuration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all P3 admin and configuration features: system settings, help topic CRUD, SLA plan CRUD, email template editor, canned responses, ticket filters/routing rules, and bulk ticket operations.

**Architecture:** Feature-by-feature vertical slices. Each feature gets a controller (or controller additions), API routes, admin HTML pages, and MCP tools. Build order follows dependencies: infrastructure first, then settings, then CRUD upgrades, then new resources, then cross-cutting features.

**Tech Stack:** Node.js/Express, raw SQL via `src/lib/db.js` abstraction, server-side HTML admin pages, MCP tools with Zod schemas.

**Spec:** `docs/superpowers/specs/2026-03-16-p3-admin-configuration-design.md`

---

## Chunk 1: Infrastructure & System Settings

### Task 1: Add ApiError.conflict() (if missing)

**Files:**
- Modify: `src/middleware/errorHandler.js`

**Note:** `roleController.js` already calls `ApiError.conflict()` but the method may not exist yet in `errorHandler.js` — check first. If it already exists, skip this task.

- [ ] **Step 1: Check if conflict() already exists**

Search `src/middleware/errorHandler.js` for `conflict`. If found, skip to Task 2.

- [ ] **Step 2: Add conflict() static method to ApiError**

In `src/middleware/errorHandler.js`, add after the `notFound` static method:

```javascript
static conflict(message = 'Resource conflict') {
  return new ApiError(409, message);
}
```

- [ ] **Step 3: Verify the server starts**

Run: `node src/app.js` (Ctrl+C after startup)
Expected: No errors on startup

- [ ] **Step 4: Commit**

```bash
git add src/middleware/errorHandler.js
git commit -m "fix: add missing ApiError.conflict() for HTTP 409 responses"
```

---

### Task 2: Update admin sidebar navigation

**Files:**
- Modify: `src/routes/admin.js` — the `renderAdminPage()` function sidebar section

- [ ] **Step 1: Add new nav items to sidebar**

In the `renderAdminPage()` function, find the sidebar nav items list. After the "SLA Plans" entry, add:

```html
${base.isAdmin ? `
<a href="/admin/settings" class="${activeNav === 'settings' ? 'active' : ''}">Settings</a>
` : ''}
<a href="/admin/email-templates" class="${activeNav === 'email-templates' ? 'active' : ''}">Email Templates</a>
<a href="/admin/canned-responses" class="${activeNav === 'canned-responses' ? 'active' : ''}">Canned Responses</a>
${base.isAdmin ? `
<a href="/admin/filters" class="${activeNav === 'filters' ? 'active' : ''}">Filters</a>
` : ''}
```

**Note:** Settings and Filters are admin-only (wrapped in `isAdmin` guard). Email Templates and Canned Responses are visible to all staff (staff can view but not edit).

- [ ] **Step 2: Verify admin page loads with new nav**

Run: Start server, navigate to `/admin`
Expected: Sidebar shows new links (pages won't exist yet, that's OK)

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add P3 admin sidebar navigation entries"
```

---

### Task 3: System Settings Controller

**Files:**
- Create: `src/controllers/settingsController.js`

- [ ] **Step 1: Create settingsController.js**

```javascript
const db = require('../lib/db');
const { ApiError } = require('../middleware/errorHandler');

// Settings groups define which config keys belong to which UI section
// and how they should be rendered/validated
const SETTINGS_GROUPS = {
  general: {
    label: 'General',
    keys: {
      helpdesk_title: { type: 'text', label: 'Helpdesk Title' },
      helpdesk_url: { type: 'text', label: 'Helpdesk URL' },
    }
  },
  tickets: {
    label: 'Tickets',
    keys: {
      default_dept_id: { type: 'fk', label: 'Default Department', table: 'department', valueCol: 'id', labelCol: 'name' },
      default_sla_id: { type: 'fk', label: 'Default SLA Plan', table: 'sla', valueCol: 'id', labelCol: 'name' },
      default_priority_id: { type: 'fk', label: 'Default Priority', table: 'ticket_priority', valueCol: 'priority_id', labelCol: 'priority' },
      default_template_id: { type: 'fk', label: 'Default Email Template', table: 'email_template_group', valueCol: 'tpl_id', labelCol: 'name' },
      ticket_autolock: { type: 'toggle', label: 'Auto-lock Tickets' },
      auto_claim_tickets: { type: 'toggle', label: 'Auto-claim Tickets' },
    }
  },
  kb: {
    label: 'Knowledge Base',
    keys: {
      enable_kb: { type: 'toggle', label: 'Enable Knowledge Base' },
      enable_captcha: { type: 'toggle', label: 'Enable CAPTCHA' },
    }
  },
  files: {
    label: 'Files',
    keys: {
      max_file_size: { type: 'number', label: 'Max File Size (bytes)' },
      allowed_filetypes: { type: 'text', label: 'Allowed File Types' },
    }
  }
};

/**
 * List all settings grouped by section
 */
const list = async (req, res) => {
  const rows = await db.query(
    `SELECT \`namespace\`, \`key\`, value FROM ${db.table('config')} ORDER BY \`namespace\`, \`key\``
  );

  // Build a flat key-value map (keyed by `key` column — keys are unique across namespaces)
  const configMap = {};
  for (const row of rows) {
    configMap[row.key] = row.value;
  }

  // Load FK options for select fields
  const fkOptions = {};
  for (const [groupName, group] of Object.entries(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      if (def.type === 'fk') {
        const options = await db.query(
          `SELECT ${def.valueCol} as value, ${def.labelCol} as label FROM ${db.table(def.table)} ORDER BY ${def.labelCol}`
        );
        fkOptions[key] = options;
      }
    }
  }

  res.json({
    success: true,
    data: {
      groups: SETTINGS_GROUPS,
      values: configMap,
      fkOptions
    }
  });
};

/**
 * Update settings — accepts flat object of key-value pairs
 */
const update = async (req, res) => {
  const updates = req.body;

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw ApiError.badRequest('No settings to update');
  }

  // Validate all keys are known
  const allKeys = {};
  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      allKeys[key] = def;
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    const def = allKeys[key];
    if (!def) {
      throw ApiError.badRequest(`Unknown setting: ${key}`);
    }

    // Type validation
    if (def.type === 'number') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        throw ApiError.badRequest(`${def.label} must be a non-negative number`);
      }
    }

    if (def.type === 'fk' && value) {
      const exists = await db.queryOne(
        `SELECT ${def.valueCol} FROM ${db.table(def.table)} WHERE ${def.valueCol} = ?`,
        [value]
      );
      if (!exists) {
        throw ApiError.badRequest(`Invalid ${def.label}: referenced entity does not exist`);
      }
    }

    if (def.type === 'toggle') {
      updates[key] = value ? '1' : '0';
    }
  }

  // Upsert all settings in a transaction using SELECT-then-INSERT/UPDATE
  // (avoids relying on affected row counts which differ between MySQL and PostgreSQL txQuery return values)
  await db.transaction(async (txQuery, txQueryOne) => {
    for (const [key, value] of Object.entries(updates)) {
      const existing = await txQueryOne(
        `SELECT id FROM ${db.table('config')} WHERE \`key\` = ?`,
        [key]
      );

      if (existing) {
        await txQuery(
          `UPDATE ${db.table('config')} SET value = ?, updated = ? WHERE \`key\` = ?`,
          [String(value), new Date(), key]
        );
      } else {
        await txQuery(
          `INSERT INTO ${db.table('config')} (\`namespace\`, \`key\`, value, updated) VALUES (?, ?, ?, ?)`,
          ['core', key, String(value), new Date()]
        );
      }
    }
  });

  res.json({ success: true, message: 'Settings updated' });
};

module.exports = { list, update, SETTINGS_GROUPS };
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/settingsController.js
git commit -m "feat: add settingsController with grouped settings and validation"
```

---

### Task 4: Settings API Routes

**Files:**
- Create: `src/routes/settings.js`
- Modify: `src/app.js` — register route

- [ ] **Step 1: Create routes/settings.js**

```javascript
const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', authenticate, requireAdmin, asyncHandler(settingsController.list));
router.put('/', authenticate, requireAdmin, asyncHandler(settingsController.update));

module.exports = router;
```

- [ ] **Step 2: Register route in app.js**

In `src/app.js`, find the route registration block. Add:

```javascript
const settingsRoutes = require('./routes/settings');
```

And in the route mounting section:

```javascript
app.use('/api/v1/settings', settingsRoutes);
```

- [ ] **Step 3: Verify server starts**

Run: `node src/app.js`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.js src/app.js
git commit -m "feat: add settings API routes (GET/PUT /api/v1/settings)"
```

---

### Task 5: Settings Admin Page

**Files:**
- Modify: `src/routes/admin.js` — add settings page routes

- [ ] **Step 1: Add GET /admin/settings page**

Import `SETTINGS_GROUPS` from `settingsController.js` at the top of admin.js (or redefine inline — importing is cleaner). Build the page by iterating over groups:

```javascript
router.get('/settings', asyncHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) return res.redirect('/admin');
  const base = await getAdminData(req);
  const { SETTINGS_GROUPS } = require('../controllers/settingsController');

  // Load current config values
  const rows = await db.query(`SELECT \`key\`, value FROM ${db.table('config')}`);
  const configMap = {};
  for (const row of rows) configMap[row.key] = row.value;

  // Load FK options for select fields
  const fkOptions = {};
  for (const group of Object.values(SETTINGS_GROUPS)) {
    for (const [key, def] of Object.entries(group.keys)) {
      if (def.type === 'fk') {
        // Column names come from the hardcoded SETTINGS_GROUPS constant, not user input
        fkOptions[key] = await db.query(
          `SELECT ${def.valueCol} as value, ${def.labelCol} as label FROM ${db.table(def.table)} ORDER BY ${def.labelCol}`
        );
      }
    }
  }

  // Build form HTML: iterate groups, render appropriate input per type
  let formHtml = '';
  for (const [groupName, group] of Object.entries(SETTINGS_GROUPS)) {
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

  const content = `<h2>System Settings</h2><form method="POST" action="/admin/settings/update"><input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">${formHtml}<button type="submit" class="btn btn-primary">Save Settings</button></form>`;
  res.send(renderAdminPage('Settings', content, base, 'settings'));
}));
```

- [ ] **Step 2: Add POST /admin/settings/update handler**

Parse form body. For each key in SETTINGS_GROUPS, read from req.body. **Checkbox coercion**: unchecked checkboxes are absent from req.body — for toggle fields, set value to '0' if missing and '1' if present. Upsert each into ost_config using SELECT-then-INSERT/UPDATE. Redirect to `/admin/settings`.

```javascript
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
  res.redirect('/admin/settings');
}));
```

- [ ] **Step 3: Test manually**

Navigate to `/admin/settings`, verify form renders with current values, change a setting, submit, verify it persists.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add admin settings page with grouped form"
```

---

### Task 6: Settings MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add get_settings and update_settings MCP tools**

Add two tools after existing tool registrations:

```javascript
// ── Settings ──

server.tool(
  'get_settings',
  'Get all system settings with current values.',
  {},
  async () => {
    const check = requireAdmin(); if (check) return check;
    try {
      const rows = await db.query(`SELECT \`key\`, value FROM ${db.table('config')} ORDER BY \`key\``);
      const settings = {};
      for (const row of rows) settings[row.key] = row.value;
      return { content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }] };
    } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
  }
);

server.tool(
  'update_settings',
  'Update system settings. Pass key-value pairs.',
  { settings: z.record(z.string(), z.string()).describe('Object of setting key-value pairs, e.g. {"helpdesk_title": "My Helpdesk"}') },
  async (params) => {
    const check = requireAdmin(); if (check) return check;
    try {
      for (const [key, value] of Object.entries(params.settings)) {
        const existing = await db.queryOne(`SELECT id FROM ${db.table('config')} WHERE \`key\` = ?`, [key]);
        if (existing) {
          await db.query(`UPDATE ${db.table('config')} SET value = ?, updated = ? WHERE \`key\` = ?`, [value, new Date(), key]);
        } else {
          await db.query(`INSERT INTO ${db.table('config')} (\`namespace\`, \`key\`, value, updated) VALUES (?, ?, ?, ?)`, ['core', key, value, new Date()]);
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ updated: Object.keys(params.settings).length }) }] };
    } catch (err) { return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }; }
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add settings MCP tools (get_settings, update_settings)"
```

---

## Chunk 2: Help Topics & SLA Plans (CRUD Upgrades)

### Task 7: Help Topics — Controller CRUD Methods

**Files:**
- Modify: `src/controllers/topicController.js`

- [ ] **Step 1: Add create() method**

Add after the existing `get()` method. Pattern:
- Validate required `topic` field (1-128 chars per schema VARCHAR(128))
- Check uniqueness (case-insensitive, scoped to same parent: `WHERE LOWER(topic) = LOWER(?) AND topic_pid = ?`)
- Validate parent topic FK if provided
- Accept `ispublic` (default 1), `noautoresp`, `flags` (for active/inactive — check how existing code uses this field), `dept_id`, `priority_id`, `sla_id`, `staff_id`, `team_id`, `notes`
- INSERT into `help_topic`
- Return 201 with created topic

**Active/inactive handling:** The `help_topic` table uses a `flags` column. Check the existing `topicController.list()` to see if it filters by `isactive` or `flags`. If `isactive` is a derived column from flags, use the same bitmask pattern. If it's a direct column, use it. The admin form should include an "Active" toggle that maps to this field. Inactive topics must be hidden from ticket creation but visible in admin.

- [ ] **Step 2: Add update() method**

Pattern:
- Verify topic exists by id
- Validate name uniqueness if name changing (exclude self, same parent scope)
- Validate parent FK if changing (also prevent self-reference: `topic_pid !== topic_id`)
- Build dynamic UPDATE query from provided fields (including `ispublic`, `flags`/`isactive`, `noautoresp`)
- Return success message

- [ ] **Step 3: Add remove() method**

Pattern:
- Verify topic exists
- Check child topics count — reject with `ApiError.conflict()` if > 0
- Check open tickets count — reject with `ApiError.conflict()` if > 0
- DELETE and return success

- [ ] **Step 4: Update module.exports to include create, update, remove**

- [ ] **Step 5: Commit**

```bash
git add src/controllers/topicController.js
git commit -m "feat: add create/update/remove to topicController"
```

---

### Task 8: Help Topics — API Routes

**Files:**
- Modify: `src/routes/topics.js`

- [ ] **Step 1: Update import and add CUD routes**

The current import in `src/routes/topics.js` is:
```javascript
const { authenticate, optionalAuth } = require('../middleware/auth');
```

Update to include `requireAdmin`:
```javascript
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth');
```

Then add after existing GET routes:
```javascript
router.post('/', authenticate, requireAdmin, asyncHandler(topicController.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(topicController.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(topicController.remove));
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/topics.js
git commit -m "feat: add topic CUD API routes"
```

---

### Task 9: Help Topics — Admin Pages

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Upgrade existing topics list page**

Find the existing `/admin/topics` GET handler. Add:
- "Create Topic" button linking to `/admin/topics/create/edit`
- Clickable topic names linking to `/admin/topics/:id`
- Edit/Delete action links per row (admin only)

- [ ] **Step 2: Add topic detail page (GET /admin/topics/:id)**

Show topic details with department, priority, SLA joins. Show usage stats (child count, ticket count). Show Edit and Delete buttons (admin only, delete only if no references).

- [ ] **Step 3: Add topic create/edit form (GET /admin/topics/:id/edit)**

Form with: topic name, parent topic select, department select, priority select, SLA select, public toggle, active toggle, auto-response toggle, notes textarea. Populate selects by querying related tables.

Use `id === 'create'` to distinguish new vs edit.

- [ ] **Step 4: Add POST handlers for create, update, delete**

- `POST /admin/topics/create` — validate, insert, redirect to list
- `POST /admin/topics/:id/update` — validate, update, redirect to detail
- `POST /admin/topics/:id/delete` — check refs, delete, redirect to list

All check `req.session?.user?.isAdmin` and include CSRF protection.

- [ ] **Step 5: Test manually**

Create, edit, delete a topic through the admin UI. Verify referential integrity blocks deletion.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add full CRUD admin pages for help topics"
```

---

### Task 10: Help Topics — MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add create_help_topic, update_help_topic, delete_help_topic tools**

Follow existing MCP tool pattern (see existing role/department/team tools in `admin.js`). Each tool calls `requireAdmin()`, uses try-catch, returns JSON text.

Zod schemas:
- `create_help_topic`: `{ topic: z.string(), topic_pid: z.number().optional(), dept_id: z.number().optional(), priority_id: z.number().optional(), sla_id: z.number().optional(), ispublic: z.boolean().optional(), notes: z.string().optional() }`
- `update_help_topic`: `{ topic_id: z.number(), topic: z.string().optional(), topic_pid: z.number().optional(), dept_id: z.number().optional(), priority_id: z.number().optional(), sla_id: z.number().optional(), ispublic: z.boolean().optional(), notes: z.string().optional() }`
- `delete_help_topic`: `{ topic_id: z.number() }` — check child topics and tickets before deleting

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add help topic MCP tools (create, update, delete)"
```

---

### Task 11: SLA Plans — Controller CRUD Methods

**Files:**
- Modify: `src/controllers/slaController.js`

- [ ] **Step 1: Add create() method**

Pattern:
- Validate required `name` (1-64 chars per schema)
- Check uniqueness
- Validate grace_period is non-negative
- INSERT with flags (default FLAGS.ACTIVE)
- Return 201 with decoded flags

- [ ] **Step 2: Add update() method**

Pattern:
- Verify SLA exists
- Check name uniqueness if changing (exclude self)
- Build dynamic UPDATE
- Return success

- [ ] **Step 3: Add remove() method**

Pattern:
- Check departments referencing this SLA
- Check help topics referencing this SLA
- Check tickets referencing this SLA
- Reject with `ApiError.conflict()` if any references exist
- DELETE and return success

- [ ] **Step 4: Update module.exports**

- [ ] **Step 5: Commit**

```bash
git add src/controllers/slaController.js
git commit -m "feat: add create/update/remove to slaController"
```

---

### Task 12: SLA Plans — API Routes

**Files:**
- Modify: `src/routes/sla.js`

- [ ] **Step 1: Add CUD routes with requireAdmin middleware**

The current import in `src/routes/sla.js` is:
```javascript
const { authenticate, requireStaff } = require('../middleware/auth');
```

Update to include `requireAdmin`:
```javascript
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
```

Then add after existing GET routes:
```javascript
router.post('/', authenticate, requireAdmin, asyncHandler(slaController.create));
router.put('/:id', authenticate, requireAdmin, asyncHandler(slaController.update));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(slaController.remove));
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/sla.js
git commit -m "feat: add SLA plan CUD API routes"
```

---

### Task 13: SLA Plans — Admin Pages

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Upgrade existing SLA list page with Create button and action links**

- [ ] **Step 2: Add SLA detail page (GET /admin/sla/:id)**

Show SLA details with flag decoding, usage stats (departments, topics, tickets).

- [ ] **Step 3: Add SLA create/edit form (GET /admin/sla/:id/edit)**

Form with: name, grace period (number), schedule_id (select), flags as checkboxes (active, escalate, no alerts, transient), notes.

- [ ] **Step 4: Add POST handlers for create, update, delete**

- [ ] **Step 5: Test manually**

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add full CRUD admin pages for SLA plans"
```

---

### Task 14: SLA Plans — MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add create_sla, update_sla, delete_sla tools**

Zod schemas:
- `create_sla`: `{ name: z.string(), grace_period: z.number().optional(), flags: z.number().optional(), notes: z.string().optional() }`
- `update_sla`: `{ sla_id: z.number(), name: z.string().optional(), grace_period: z.number().optional(), flags: z.number().optional(), notes: z.string().optional() }`
- `delete_sla`: `{ sla_id: z.number() }` — check departments, topics, and tickets before deleting

Follow the same requireAdmin + try-catch + JSON response pattern as existing tools.

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add SLA plan MCP tools (create, update, delete)"
```

---

## Chunk 3: Email Templates

### Task 15: Email Template Controller

**Files:**
- Create: `src/controllers/emailTemplateController.js`

- [ ] **Step 1: Create controller with group and template methods**

Methods:
- `listGroups()` — paginated list of template groups
- `getGroup(id)` — single group with its templates
- `createGroup()` — name, isactive, notes; validates unique name
- `updateGroup(id)` — partial update
- `removeGroup(id)` — reject if templates exist in group
- `list()` — all templates, optionally filtered by tpl_id
- `get(id)` — single template with group info
- `update(id)` — update subject, body, notes only (no create/delete for individual templates)

- [ ] **Step 2: Commit**

```bash
git add src/controllers/emailTemplateController.js
git commit -m "feat: add emailTemplateController with group and template CRUD"
```

---

### Task 16: Email Template Routes

**Files:**
- Create: `src/routes/emailTemplates.js`
- Modify: `src/app.js`

- [ ] **Step 1: Create routes**

```
GET    /api/v1/email-templates/groups      — listGroups
POST   /api/v1/email-templates/groups      — createGroup (admin)
GET    /api/v1/email-templates/groups/:id  — getGroup
PUT    /api/v1/email-templates/groups/:id  — updateGroup (admin)
DELETE /api/v1/email-templates/groups/:id  — removeGroup (admin)
GET    /api/v1/email-templates             — list
GET    /api/v1/email-templates/:id         — get
PUT    /api/v1/email-templates/:id         — update (admin)
```

- [ ] **Step 2: Register in app.js**

- [ ] **Step 3: Commit**

```bash
git add src/routes/emailTemplates.js src/app.js
git commit -m "feat: add email template API routes"
```

---

### Task 17: Email Template Seeding

**Files:**
- Create: `src/lib/seedEmailTemplates.js`
- Modify: `src/app.js` — call on startup

- [ ] **Step 1: Create seed function**

Creates a "Default" template group if none exists, then inserts template rows for each standard code_name (`ticket.created`, `ticket.reply`, `ticket.assigned`, `ticket.closed`, `ticket.overdue`, `password.reset`, `email.verify`) with sensible default subjects and placeholder bodies.

**Performance**: First check if the "Default" group exists. If it does AND has the expected template count, skip all further queries (fast path for subsequent startups). Only run individual template inserts on first setup or if templates are missing.

Only inserts if the code_name doesn't already exist for the group (idempotent).

- [ ] **Step 2: Call from app.js after DB connection**

- [ ] **Step 3: Commit**

```bash
git add src/lib/seedEmailTemplates.js src/app.js
git commit -m "feat: seed default email template group and templates on startup"
```

---

### Task 18: Email Template Admin Pages

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Add template group list page (GET /admin/email-templates)**

Table of groups with name, active status, template count. "Create Group" button.

- [ ] **Step 2: Add group detail/template list (GET /admin/email-templates/groups/:id)**

Shows group info + table of templates in that group with code_name, subject preview, edit link.

- [ ] **Step 3: Add template edit page (GET /admin/email-templates/:id/edit)**

Form with:
- Subject (text input) with placeholder insertion buttons
- Body (textarea, tall) with placeholder insertion buttons
- "Preview" button that shows rendered HTML in a div (client-side JS replaces `{{placeholder}}` with sample values)
- Available placeholders listed as clickable chips: `{{ticket.number}}`, `{{ticket.subject}}`, `{{user.name}}`, `{{user.email}}`, `{{staff.name}}`, `{{ticket.department}}`, `{{ticket.status}}`, `{{ticket.url}}`
- Notes textarea

Include inline `<script>` for:
- Placeholder chip click → insert at cursor position in active field
- Preview button → take body content, replace placeholders with sample data, render in preview div

- [ ] **Step 4: Add POST handlers (group create/update/delete, template update)**

- [ ] **Step 5: Test manually**

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add email template admin pages with rich editor and preview"
```

---

### Task 19: Email Template MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add list_email_templates, get_email_template, update_email_template tools**

Zod schemas:
- `list_email_templates`: `{ tpl_id: z.number().optional().describe('Filter by template group ID') }` — returns all templates, optionally filtered by group
- `get_email_template`: `{ template_id: z.number() }` — returns single template with subject, body, code_name, group info
- `update_email_template`: `{ template_id: z.number(), subject: z.string().optional(), body: z.string().optional(), notes: z.string().optional() }` — no create/delete for individual templates

Follow requireAdmin + try-catch + JSON response pattern.

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add email template MCP tools"
```

---

## Chunk 4: Canned Responses

### Task 20: Canned Response Controller

**Files:**
- Create: `src/controllers/cannedResponseController.js`

- [ ] **Step 1: Create controller**

Methods:
- `list()` — paginated, filterable by dept_id and isenabled. JOIN department for name.
  - **Department-scoped access for non-admin staff:**
    ```javascript
    if (req.auth.type === 'staff' && !req.auth.isAdmin) {
      const staff = await db.queryOne(
        `SELECT dept_id FROM ${db.table('staff')} WHERE staff_id = ?`, [req.auth.id]
      );
      const staffDeptId = staff?.dept_id || 0;
      // Add WHERE clause: dept_id IN (?, 0) with staffDeptId
    }
    ```
  - Admins see all responses (no dept filter).
- `get(id)` — single response with department name
- `create()` — title (unique), dept_id (0 for global), isenabled, response body, lang (default 'en_US'), notes
- `update(id)` — partial update, check title uniqueness if changing
- `remove(id)` — hard delete (no referential integrity concerns)

- [ ] **Step 2: Commit**

```bash
git add src/controllers/cannedResponseController.js
git commit -m "feat: add cannedResponseController with department-scoped access"
```

---

### Task 21: Canned Response Routes

**Files:**
- Create: `src/routes/cannedResponses.js`
- Modify: `src/app.js`

- [ ] **Step 1: Create routes**

```
GET    /api/v1/canned-responses      — list (staff)
GET    /api/v1/canned-responses/:id  — get (staff)
POST   /api/v1/canned-responses      — create (admin)
PUT    /api/v1/canned-responses/:id  — update (admin)
DELETE /api/v1/canned-responses/:id  — remove (admin)
```

- [ ] **Step 2: Register in app.js**

- [ ] **Step 3: Commit**

```bash
git add src/routes/cannedResponses.js src/app.js
git commit -m "feat: add canned response API routes"
```

---

### Task 22: Canned Response Admin Pages

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Add list page (GET /admin/canned-responses)**

Table with title, department (or "Global"), enabled badge, action links. "Create Response" button.

- [ ] **Step 2: Add create/edit form (GET /admin/canned-responses/:id/edit)**

Form with: title, department select (with "All Departments" = 0 option), enabled toggle, response body (HTML textarea), notes.

- [ ] **Step 3: Add POST handlers (create, update, delete)**

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add canned response admin pages"
```

---

### Task 23: Canned Response MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add list, get, create, update, delete canned response tools**

Zod schemas:
- `list_canned_responses`: `{ dept_id: z.number().optional(), enabled_only: z.boolean().optional() }`
- `get_canned_response`: `{ canned_id: z.number() }`
- `create_canned_response`: `{ title: z.string(), response: z.string(), dept_id: z.number().optional().describe('0 for global'), isenabled: z.boolean().optional(), notes: z.string().optional() }`
- `update_canned_response`: `{ canned_id: z.number(), title: z.string().optional(), response: z.string().optional(), dept_id: z.number().optional(), isenabled: z.boolean().optional(), notes: z.string().optional() }`
- `delete_canned_response`: `{ canned_id: z.number() }`

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add canned response MCP tools"
```

---

## Chunk 5: Ticket Filters & Routing Rules

### Task 24: Filter Controller

**Files:**
- Create: `src/controllers/filterController.js`

- [ ] **Step 1: Create controller**

Methods:
- `list()` — paginated, ordered by execorder. Include rule count and action count via subqueries.
- `get(id)` — single filter + all rules (from `filter_rule`) + all actions (from `filter_action`)
- `create()` — in a transaction: insert filter, insert rules, insert actions. Validate name (max 32 chars). Set execorder to max+1.
- `update(id)` — in a transaction: update filter fields, sync rules (delete missing, insert new, update existing by id), sync actions (same pattern)
- `remove(id)` — in a transaction: delete from filter_action, delete from filter_rule, delete from filter
- `reorder()` — accepts `{ filterIds: [3, 1, 2] }`, updates execorder for each. **Validation:** verify all IDs exist, no duplicates, and the array contains ALL filter IDs (query `SELECT id FROM ost_filter` and compare sets — reject if mismatched to prevent partial reordering bugs).

Action types with JSON configuration:
- `set_dept` → `{ dept_id }`
- `set_priority` → `{ priority_id }`
- `set_sla` → `{ sla_id }`
- `set_status` → `{ status_id }`
- `assign_staff` → `{ staff_id }`
- `assign_team` → `{ team_id }`
- `set_topic` → `{ topic_id }`
- `reject` → `{ message }`

- [ ] **Step 2: Add applyFilters(ticketData, queryFn, queryOneFn) function**

Exported helper that runs all active filters against a ticket object. Accepts query functions as parameters so it can run inside or outside a transaction (caller passes `txQuery`/`txQueryOne` if transactional, or `db.query`/`db.queryOne` if standalone).

```javascript
async function applyFilters(ticketData, queryFn = db.query, queryOneFn = db.queryOne) { ... }
```

Logic:
1. Query active filters ordered by execorder using `queryFn`
2. For each filter, load rules using `queryFn`
3. Evaluate rules against ticket (match_all_rules = AND vs OR)
4. If matched, load actions and build a field-update map
5. If `stop_onmatch`, break
6. Return modified ticket fields as `{ dept_id, staff_id, ... }` or `{ _rejected: true, _rejectMessage: '...' }` if a reject action was matched

Rule evaluation logic (coerce both sides to String for comparison):
- `equal`: val === ticketField
- `not_equal`: val !== ticketField
- `contains`: ticketField.includes(val)
- `dn_contain`: !ticketField.includes(val)
- `starts`: ticketField.startsWith(val)
- `ends`: ticketField.endsWith(val)
- `match`: wrap in try-catch — `new RegExp(val).test(ticketField)`. On invalid regex, log a warning and treat rule as non-matching.
- `not_match`: wrap in try-catch — `!new RegExp(val).test(ticketField)`. Same error handling.

**IMPORTANT: Regex safety.** User-authored regex patterns can throw on invalid syntax or cause ReDoS. Always wrap `new RegExp()` in try-catch. Also validate regex syntax when creating/updating filter rules — in the `create()` and `update()` methods, if any rule uses `match` or `not_match` operator, test `new RegExp(val)` and reject with ApiError.badRequest if it throws.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/filterController.js
git commit -m "feat: add filterController with CRUD and applyFilters engine"
```

---

### Task 25: Filter Routes

**Files:**
- Create: `src/routes/filters.js`
- Modify: `src/app.js`

- [ ] **Step 1: Create routes**

```
GET    /api/v1/filters           — list (admin)
GET    /api/v1/filters/:id       — get (admin)
POST   /api/v1/filters           — create (admin)
PUT    /api/v1/filters/:id       — update (admin)
DELETE /api/v1/filters/:id       — remove (admin)
PUT    /api/v1/filters/reorder   — reorder (admin)
```

Note: PUT `/reorder` must be registered BEFORE `/:id` to avoid route conflict.

- [ ] **Step 2: Register in app.js**

- [ ] **Step 3: Commit**

```bash
git add src/routes/filters.js src/app.js
git commit -m "feat: add filter API routes"
```

---

### Task 26: Integrate applyFilters into Ticket Creation

**Files:**
- Modify: `src/controllers/ticketController.js`

- [ ] **Step 1: Wrap ticket creation in a transaction and integrate applyFilters**

The current `create()` method in ticketController inserts into 4 tables (ticket, ticket__cdata, thread, thread_entry) without a transaction. Wrap the entire creation flow in `db.transaction()` and call `applyFilters` within the same transaction.

```javascript
const { applyFilters } = require('./filterController');

// Inside create(), wrap the existing insert logic in a transaction:
const result = await db.transaction(async (txQuery, txQueryOne) => {
  // ... existing ticket insert, cdata insert, thread insert, thread_entry insert ...
  // (move all existing INSERT queries to use txQuery instead of db.query)

  // After all inserts, apply filter rules within the same transaction
  const ticketData = {
    ticket_id: ticketId,
    subject, body: message, email: userEmail,
    dept_id, topic_id, priority_id, source
  };
  const filterResult = await applyFilters(ticketData, txQuery, txQueryOne);

  // If rejected, throw to trigger rollback
  if (filterResult?._rejected) {
    throw new Error(`TICKET_REJECTED:${filterResult._rejectMessage || 'Rejected by filter'}`);
  }

  // If filters modified ticket fields, apply updates
  if (filterResult && Object.keys(filterResult).length > 0) {
    const updateCols = [];
    const updateParams = [];
    for (const [col, val] of Object.entries(filterResult)) {
      if (!col.startsWith('_')) { // Skip internal flags
        updateCols.push(`${col} = ?`);
        updateParams.push(val);
      }
    }
    if (updateCols.length > 0) {
      updateParams.push(ticketId);
      await txQuery(
        `UPDATE ${db.table('ticket')} SET ${updateCols.join(', ')} WHERE ticket_id = ?`,
        updateParams
      );
    }
  }

  return { ticketId, number: ticketNumber };
});
```

- [ ] **Step 2: Handle reject action**

Catch the `TICKET_REJECTED` error outside the transaction and return an appropriate error response. The transaction rollback automatically cleans up all 4 inserted tables.

```javascript
try {
  const result = await db.transaction(async (txQuery, txQueryOne) => { ... });
  // Success response
} catch (err) {
  if (err.message.startsWith('TICKET_REJECTED:')) {
    const msg = err.message.replace('TICKET_REJECTED:', '');
    throw ApiError.badRequest(msg);
  }
  throw err;
}
```

**IMPORTANT:** The `applyFilters` function signature must accept `(ticketData, txQuery, txQueryOne)` so it uses the transaction's query functions, not standalone `db.query`. Update the function signature in Task 24 Step 2 accordingly.

- [ ] **Step 3: Test manually**

Create a filter rule, create a ticket that matches, verify the ticket was auto-modified.

- [ ] **Step 4: Commit**

```bash
git add src/controllers/ticketController.js
git commit -m "feat: integrate filter engine into ticket creation flow"
```

---

### Task 27: Filter Admin Pages

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Add filter list page (GET /admin/filters)**

Ordered table with: execorder, name, active badge, target, rule count, action count, edit/delete links.

- [ ] **Step 2: Add filter create/edit page (GET /admin/filters/:id/edit)**

Form with:
- Name (text, maxlength=32), active toggle, target select (Any/Web/Email/API)
- Match logic radio (All rules / Any rule), stop on match toggle
- **Rules section**: dynamic rows with add/remove. Each row: "what" select (subject/body/email/dept_id/topic_id/priority_id/source), "how" select (equal/not_equal/contains/etc.), "val" text input
- **Actions section**: checkboxes to enable each action type, with corresponding select/input when enabled (e.g., "Set Department" checkbox + department select)

Include inline `<script>` for:
- Add/remove rule rows dynamically
- Show/hide action inputs based on checkbox state
- Form serializes rules as JSON array and actions as JSON array in hidden fields

- [ ] **Step 3: Add POST handlers (create, update, delete)**

Parse rules/actions from hidden JSON fields, call controller methods.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add filter admin pages with dynamic rule/action editor"
```

---

### Task 28: Filter MCP Tools

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add list, get, create, update, delete filter tools**

Zod schemas:
- `list_filters`: `{}` — returns all filters ordered by execorder
- `get_filter`: `{ filter_id: z.number() }` — returns filter with rules and actions
- `create_filter`: `{ name: z.string().max(32), isactive: z.boolean().optional(), target: z.enum(['Any','Web','Email','API']).optional(), match_all_rules: z.boolean().optional(), stop_onmatch: z.boolean().optional(), rules: z.array(z.object({ what: z.string(), how: z.string(), val: z.string() })), actions: z.array(z.object({ type: z.string(), configuration: z.string().describe('JSON string') })) }`
- `update_filter`: same fields as create but all optional except `filter_id: z.number()`
- `delete_filter`: `{ filter_id: z.number() }`

`create_filter` and `update_filter` accept nested `rules` and `actions` arrays in params. The controller handles the transaction for inserting/syncing across all 3 tables.

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add filter MCP tools"
```

---

## Chunk 6: Bulk Operations & Finalization

### Task 29: Seed Bulk Event Types & Add Bulk Controller Method

**Files:**
- Modify: `src/lib/seedEmailTemplates.js` (rename conceptually to `src/lib/seed.js` if it makes sense, or add to existing seed file)
- Modify: `src/controllers/ticketController.js`

- [ ] **Step 0: Seed bulk event types on startup**

In the startup seed logic (same file as email template seeding, or a shared `src/lib/seed.js`), add idempotent inserts for:
```sql
INSERT IGNORE INTO ost_event (name, description) VALUES ('bulk_assign', 'Bulk assign operation');
INSERT IGNORE INTO ost_event (name, description) VALUES ('bulk_close', 'Bulk close operation');
INSERT IGNORE INTO ost_event (name, description) VALUES ('bulk_delete', 'Bulk delete operation');
```

- [ ] **Step 1: Add bulkAction() method**

```javascript
const bulkAction = async (req, res) => {
  const { action, ticketIds, data } = req.body;

  if (!action || !['assign', 'close', 'delete'].includes(action)) {
    throw ApiError.badRequest('Invalid action. Must be: assign, close, delete');
  }

  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    throw ApiError.badRequest('No tickets selected');
  }

  if (ticketIds.length > 100) {
    throw ApiError.badRequest('Maximum 100 tickets per bulk operation');
  }

  const staffId = req.auth.id;
  const staffName = req.auth.name || 'System';

  await db.transaction(async (txQuery, txQueryOne) => {
    const placeholders = ticketIds.map(() => '?').join(',');

    if (action === 'assign') {
      if (!data?.staff_id && !data?.team_id) {
        throw ApiError.badRequest('Must specify staff_id or team_id for assign');
      }
      const updates = [];
      const params = [];
      if (data.staff_id) { updates.push('staff_id = ?'); params.push(data.staff_id); }
      if (data.team_id) { updates.push('team_id = ?'); params.push(data.team_id); }
      updates.push('updated = ?');
      params.push(new Date());

      await txQuery(
        `UPDATE ${db.table('ticket')} SET ${updates.join(', ')} WHERE ticket_id IN (${placeholders})`,
        [...params, ...ticketIds]
      );
    }

    if (action === 'close') {
      // Find "Closed" status id
      const closedStatus = await txQueryOne(
        `SELECT id FROM ${db.table('ticket_status')} WHERE state = 'closed' LIMIT 1`
      );
      if (!closedStatus) throw ApiError.badRequest('No closed status defined');

      const now = new Date();
      await txQuery(
        `UPDATE ${db.table('ticket')} SET status_id = ?, closed = ?, updated = ? WHERE ticket_id IN (${placeholders})`,
        [closedStatus.id, now, now, ...ticketIds]
      );
    }

    if (action === 'delete') {
      // Soft delete — find "Deleted" status
      const deletedStatus = await txQueryOne(
        `SELECT id FROM ${db.table('ticket_status')} WHERE state = 'deleted' LIMIT 1`
      );
      if (!deletedStatus) throw ApiError.badRequest('No deleted status defined');

      await txQuery(
        `UPDATE ${db.table('ticket')} SET status_id = ?, updated = ? WHERE ticket_id IN (${placeholders})`,
        [deletedStatus.id, new Date(), ...ticketIds]
      );
    }

    // Log events for audit trail
    // Look up event type ONCE before the loop (pre-seeded, see Task 29a)
    const eventName = `bulk_${action}`;
    const event = await txQueryOne(
      `SELECT id FROM ${db.table('event')} WHERE name = ?`,
      [eventName]
    );

    if (event) {
      // Batch: get all thread IDs for the affected tickets in one query
      const threads = await txQuery(
        `SELECT id, object_id FROM ${db.table('thread')} WHERE object_id IN (${placeholders}) AND object_type = 'T'`,
        ticketIds
      );

      // Batch insert all thread_event rows
      if (threads.length > 0) {
        const now = new Date();
        const values = threads.map(() => '(?, ?, ?, ?, ?, \'S\', ?)').join(', ');
        const params = threads.flatMap(t => [t.id, event.id, staffId, staffName, staffId, now]);
        await txQuery(
          `INSERT INTO ${db.table('thread_event')} (thread_id, event_id, staff_id, username, uid, uid_type, timestamp) VALUES ${values}`,
          params
        );
      }
    }
  });

  res.json({
    success: true,
    data: { affected: ticketIds.length }
  });
};
```

- [ ] **Step 2: Export bulkAction in module.exports**

- [ ] **Step 3: Commit**

```bash
git add src/controllers/ticketController.js
git commit -m "feat: add bulkAction to ticketController for assign/close/delete"
```

---

### Task 30: Bulk Operations Route

**Files:**
- Modify: `src/routes/tickets.js`

- [ ] **Step 1: Add requireAdmin to import and add bulk route**

The current import in `src/routes/tickets.js` is:
```javascript
const { authenticate, canAccessTicket, requireStaff, requireVerified } = require('../middleware/auth');
```

Update to include `requireAdmin`:
```javascript
const { authenticate, canAccessTicket, requireStaff, requireVerified, requireAdmin } = require('../middleware/auth');
```

Then add BEFORE the `/:id` routes to avoid route conflict:

```javascript
router.post('/bulk', authenticate, requireAdmin, asyncHandler(ticketController.bulkAction));
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tickets.js
git commit -m "feat: add bulk ticket operations API route"
```

---

### Task 31: Bulk Operations Admin UI

**Files:**
- Modify: `src/routes/admin.js`

- [ ] **Step 1: Upgrade admin tickets list page**

Add to the existing tickets table:
- Checkbox column (`<input type="checkbox" class="ticket-select" value="${ticketId}">`)
- Select-all checkbox in header
- Sticky action bar (hidden by default, shown via JS when checkboxes checked):

```html
<div id="bulk-actions" style="display:none" class="bulk-action-bar">
  <span id="selected-count">0</span> selected
  <select id="bulk-assign-staff"><!-- populated from staff list --></select>
  <button onclick="bulkAction('assign')">Assign</button>
  <button onclick="bulkAction('close')">Close</button>
  <button onclick="if(confirm('Delete selected tickets?')) bulkAction('delete')">Delete</button>
</div>
```

- [ ] **Step 2: Add inline script for bulk operations**

```javascript
function bulkAction(action) {
  const ids = [...document.querySelectorAll('.ticket-select:checked')].map(cb => parseInt(cb.value));
  if (ids.length === 0) return;
  const data = {};
  if (action === 'assign') {
    data.staff_id = parseInt(document.getElementById('bulk-assign-staff').value);
    if (!data.staff_id) { alert('Select a staff member'); return; }
  }
  fetch('/api/v1/tickets/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ticketIds: ids, data }),
    credentials: 'same-origin'
  }).then(r => r.json()).then(result => {
    if (result.success) { location.reload(); }
    else { alert(result.message || 'Error'); }
  });
}
```

**Auth mechanism for admin UI fetch calls:** The `authenticate` middleware already supports session cookies (check `src/middleware/auth.js` for session-based auth). Use `credentials: 'same-origin'` so the session cookie is sent. For CSRF, embed the token in the page and include it in the fetch headers:

```javascript
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
// Add to fetch headers:
headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }
```

Add a `<meta name="csrf-token" content="${req.csrfToken ? req.csrfToken() : ''}">` to the admin page head. If the authenticate middleware doesn't support session cookies, fall back to storing a JWT in a `<meta>` tag and using `Authorization: Bearer ${token}` header instead. Check which approach the existing codebase uses.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.js
git commit -m "feat: add bulk operations UI to admin tickets page"
```

---

### Task 32: Bulk Operations MCP Tool

**Files:**
- Modify: `src/mcp/tools/admin.js`

- [ ] **Step 1: Add bulk_update_tickets tool**

Accepts: `action` (assign/close/delete), `ticketIds` (array of numbers), `data` (optional object with staff_id/team_id).

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/admin.js
git commit -m "feat: add bulk ticket operations MCP tool"
```

---

### Task 33: Update TODO.md

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Mark all P3 items as complete**

```markdown
## P3 — Admin & Configuration
- [x] System settings management
- [x] Email template editor
- [x] Help topic management
- [x] SLA plan management
- [x] Ticket filter / routing rules
- [x] Canned responses management
- [x] Bulk operations (assign, close, delete)
```

(Note: "Reporting & dashboard analytics" is already checked.)

- [ ] **Step 2: Final commit**

```bash
git add docs/TODO.md
git commit -m "feat: mark P3 Admin & Configuration complete in TODO"
```
