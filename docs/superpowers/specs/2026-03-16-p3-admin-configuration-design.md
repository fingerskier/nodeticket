# P3 — Admin & Configuration Design

**Date**: 2026-03-16
**Status**: Approved
**Approach**: Feature-by-feature vertical slices (controller + routes + admin UI + MCP tools)
**Build order**: Settings → Help Topics → SLA Plans → Email Templates → Canned Responses → Filters → Bulk Ops

---

## 1. System Settings Management

### Purpose
Grouped admin settings page that reads/writes the `ost_config` table (namespace/key/value). Organized into logical sections with appropriate input types.

### Settings Groups

| Group | Keys | Input Types |
|-------|------|-------------|
| General | helpdesk_title, helpdesk_url | text |
| Tickets | default_dept_id, default_sla_id, default_priority_id, default_template_id, ticket_autolock, auto_claim_tickets | select (FK lookups), toggle |
| Knowledge Base | enable_kb, enable_captcha | toggle |
| Files | max_file_size, allowed_filetypes | number, text |

### Components
- **Controller**: `settingsController.js` — `list()` returns all config grouped by namespace, `update()` accepts a flat object of key-value pairs and upserts them in a transaction
- **API**: `GET /api/v1/settings` (admin), `PUT /api/v1/settings` (admin)
- **Admin page**: `/admin/settings` — form with grouped sections, select dropdowns populated from departments/SLA/priorities tables
- **MCP tools**: `get-settings`, `update-settings`

### Validation
- FK select fields (default_dept_id, default_sla_id, etc.): verify the referenced entity exists before saving
- Numeric fields (max_file_size): must be positive integers
- Toggle fields: coerce to 0/1
- Select dropdowns populated from departments/SLA/priorities tables on page load

---

## 2. Help Topic Management (Upgrade to Full CRUD)

### Current State
Read-only `list()` and `get()` in `topicController.js`, read-only admin page, read-only API routes.

### Changes
- **Controller**: Add `create()`, `update()`, `remove()` to `topicController.js`
- **API**: Add `POST /api/v1/topics`, `PUT /api/v1/topics/:id`, `DELETE /api/v1/topics/:id` (admin-only)
- **Admin page**: Upgrade `/admin/topics` with add/edit/delete forms
  - Fields: topic name, parent topic (select), public/private toggle, active/inactive toggle, default department/staff/team/SLA/priority (FK selects), auto-response toggle, notes
  - Inactive topics are hidden from ticket creation but remain visible in admin
- **MCP tools**: `create-help-topic`, `update-help-topic`, `delete-help-topic`

### Delete Behavior
Reject delete if any open tickets reference the topic. Otherwise hard delete.

---

## 3. SLA Plan Management (Upgrade to Full CRUD)

### Current State
Read-only `list()` and `get()` in `slaController.js` with flag decoding. Read-only admin page.

### Changes
- **Controller**: Add `create()`, `update()`, `remove()` to `slaController.js`
- **API**: Add `POST /api/v1/sla`, `PUT /api/v1/sla/:id`, `DELETE /api/v1/sla/:id` (admin-only)
- **Admin page**: Upgrade `/admin/sla` with add/edit/delete forms
  - Fields: name, grace period (hours), schedule_id (FK select from `schedule` table, default "24/7" if none exist), flags as toggles (active, escalate on overdue, disable alerts, transient), notes
- **MCP tools**: `create-sla-plan`, `update-sla-plan`, `delete-sla-plan`

### Delete Behavior
Reject if any open tickets or help topics reference the SLA. Offer to deactivate instead (clear ACTIVE flag).

---

## 4. Email Template Editor

### Database
`ost_email_template` (id, tpl_id, code_name, subject, body, notes) + `ost_email_template_group` (tpl_id, name, lang, isactive, notes). The `lang` column defaults to `en_US` and is not exposed in the initial UI.

### Purpose
Admin manages template groups and edits individual templates with a rich HTML editor and live preview. Templates use placeholder syntax: `{{ticket.number}}`, `{{user.name}}`, `{{staff.name}}`, `{{ticket.department}}`.

### Components
- **Controller**: `emailTemplateController.js`
  - Groups: `listGroups()`, `getGroup()`, `createGroup()`, `updateGroup()`, `removeGroup()`
  - Templates: `list()`, `get()`, `update()` — no create/remove for individual templates (seeded by code_name, deletion would break email system)
- **API**:
  - `GET/POST /api/v1/email-templates/groups`, `GET/PUT/DELETE /api/v1/email-templates/groups/:id`
  - `GET /api/v1/email-templates`, `GET/PUT /api/v1/email-templates/:id` (no POST/DELETE for individual templates)
- **Admin page**: `/admin/email-templates` — list of template groups, click into a group to see templates
  - Edit page: subject field with placeholder insertion buttons, body textarea with HTML editing + Preview tab, available placeholders as clickable chips
- **MCP tools**: `list-email-templates`, `get-email-template`, `update-email-template`

### Seeding
On first run/migration, seed default template group ("Default") with standard code_names: `ticket.created`, `ticket.reply`, `ticket.assigned`, `ticket.closed`, `ticket.overdue`, `password.reset`, `email.verify`.

### Preview
Client-side JS replaces `{{placeholder}}` with sample data and renders in a styled div.

---

## 5. Canned Responses Management

### Database
`ost_canned_response` (canned_id, dept_id, isenabled, title, response, lang, notes)

### Purpose
Pre-written response templates that staff insert when replying to tickets. Scoped globally (dept_id=0) or to a specific department.

### Components
- **Controller**: `cannedResponseController.js` — `list()` with filtering by dept_id and enabled status, `get()`, `create()`, `update()`, `remove()`
- **API**: `GET/POST /api/v1/canned-responses`, `GET/PUT/DELETE /api/v1/canned-responses/:id` (staff can list/get, admin for CUD)
- **Admin page**: `/admin/canned-responses` — table with title, department (or "Global"), enabled badge
  - Add/edit form: title, department select (or "All Departments" for global), enabled toggle, response body (HTML textarea), notes. The `lang` column defaults to `en_US` and is not exposed in the initial UI.
- **MCP tools**: `list-canned-responses`, `get-canned-response`, `create-canned-response`, `update-canned-response`, `delete-canned-response`

### Access Control
Non-admin staff can `list()` and `get()` — filtered to their department + global. The `list()` method looks up the caller's `dept_id` from the `staff` table when `req.auth.type === 'staff'` and `!req.auth.isAdmin`, then filters to `dept_id IN (staff_dept_id, 0)`. Admins see all responses and can create/update/delete.

---

## 6. Ticket Filter / Routing Rules

### Database
Three related tables:
- `ost_filter` (id, execorder, isactive, match_all_rules, stop_onmatch, target, name, ...)
- `ost_filter_rule` (id, filter_id, what, how, val, isactive)
- `ost_filter_action` (id, filter_id, sort, type, configuration)

### Purpose
Ordered rules that auto-process incoming tickets on creation. Note: `flags`, `status`, and `email_id` columns on `ost_filter` are legacy/unused — ignore during implementation. The `name` column is VARCHAR(32); keep filter names concise.

### Conditions (the `what` field in `filter_rule`)
- `subject`, `body`, `email` — text matching on ticket content
- `dept_id`, `topic_id`, `priority_id`, `source` — exact match on ticket metadata

### Match Operators (`how`)
equal, not_equal, contains, dn_contain, starts, ends, match, not_match

### Logic
- `match_all_rules=1` → AND all rules
- `match_all_rules=0` → OR any rule
- `stop_onmatch` prevents subsequent filters from running

### Actions (stored in `filter_action` table)
Each action has a `type` and JSON `configuration` column. Action types:
- `set_dept` — set department (config: `{ dept_id }`)
- `set_priority` — set priority (config: `{ priority_id }`)
- `set_sla` — set SLA plan (config: `{ sla_id }`)
- `set_status` — set status (config: `{ status_id }`)
- `assign_staff` — assign to staff (config: `{ staff_id }`)
- `assign_team` — assign to team (config: `{ team_id }`)
- `set_topic` — set help topic (config: `{ topic_id }`)
- `reject` — reject ticket (config: `{ message }`)

### Components
- **Controller**: `filterController.js` — `list()` ordered by execorder, `get()` with rules and actions, `create()` with nested rules and actions, `update()` with rule sync AND action sync (delete removed, insert new, update existing), `remove()` cascade deletes both rules and actions, `reorder()` for ordering
- **API**: `GET/POST /api/v1/filters`, `GET/PUT/DELETE /api/v1/filters/:id`, `PUT /api/v1/filters/reorder` (all admin-only)
- **Admin page**: `/admin/filters` — ordered list with active badge, rule count
  - Edit form: name, active toggle, target (Any/Web/Email/API), match logic (all/any), stop on match toggle
  - Rules section: dynamic add/remove rows (what/how/val)
  - Actions section: checkboxes to enable each action with corresponding select/input
- **MCP tools**: `list-filters`, `get-filter`, `create-filter`, `update-filter`, `delete-filter`

### Execution Hook
`applyFilters(ticket)` function called from `ticketController.create()` after ticket insertion. Runs filters in execorder, applies matching filter actions.

---

## 7. Bulk Operations

### Purpose
Admin can multi-select tickets from the admin ticket list and perform batch actions: assign, close, or delete.

### Components
- **Controller**: Add `bulkUpdate()` and `bulkDelete()` to `ticketController.js`
- **API**: `POST /api/v1/tickets/bulk` (admin-only) — accepts `{ action: "assign"|"close"|"delete", ticketIds: [...], data: { staff_id?, team_id? } }`
- **Admin page**: Upgrade `/admin/tickets` with:
  - Checkbox column + "select all" header checkbox
  - Sticky action bar (appears on selection): count, Assign button (staff/team dropdown), Close button, Delete button
  - Confirmation modal for destructive actions
- **MCP tools**: `bulk-update-tickets`

### Implementation Details
- All bulk actions run in a single transaction (all-or-nothing — if any ticket fails, entire batch rolls back)
- Each affected ticket gets a thread event logged (audit trail)
- Assign: updates `staff_id` and/or `team_id`
- Close: sets `status_id` to closed status, sets `closed` timestamp
- Delete: soft-delete via `status_id` set to deleted status (not hard delete)
- Max batch size: 100 tickets per request
- Response: `{ success: true, data: { affected: N } }`

---

## Cross-Cutting Patterns

All features follow existing project conventions:
- **Database**: `db.query()` / `db.queryOne()` with `db.table()` for prefixed table names, parameterized queries
- **Error handling**: `ApiError.notFound()`, `ApiError.badRequest()`, `ApiError.forbidden()`. Add `ApiError.conflict()` (HTTP 409) for delete-rejection on referential integrity violations.
- **Response format**: `{ success: true, data: {...}, pagination: { page, limit, total, totalPages } }`
- **Pagination**: All new `list()` endpoints include pagination for consistency, even when datasets are small (use high default page size like 200)
- **Auth (API routes)**: `authenticate` + `requireStaff` middleware for read routes, `authenticate` + `requireAdmin` middleware for CUD routes (admin check is route middleware, not in-controller)
- **Auth (MCP tools)**: Admin check via in-handler `requireAdmin()` call (MCP has no route middleware)
- **Admin UI**: Server-side HTML via `renderAdminPage()`, inline templates, `escapeHtml()` for XSS protection, CSRF tokens on forms. Update sidebar navigation in `renderAdminPage()` to include new pages after "SLA Plans": Settings, Email Templates, Canned Responses, Filters.
- **MCP tools**: Zod schemas, admin auth check in handler, JSON text content response
- **Transactions**: `db.transaction()` for multi-step mutations
