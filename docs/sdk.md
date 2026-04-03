# Nodeticket SDK API Reference

Programmatic access to osTicket databases from any Node.js application.
Provides two tiers: a thin **data-access layer** (`nt.data.*`) and a
**business-logic service layer** (`nt.*`).

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration](#configuration)
3. [Data Layer (`nt.data.*`)](#data-layer)
4. [Service Layer (`nt.*`)](#service-layer)
5. [Error Handling](#error-handling)
6. [Advanced](#advanced)

---

## Quick Start

```bash
npm install nodeticket
```

```js
const nodeticket = require('nodeticket');

const nt = await nodeticket.init({
  host: 'localhost',
  database: 'osticket',
  user: 'root',
  password: 'secret',
});

// Service layer — business logic, validation, joins
const result = await nt.tickets.list({ status: 'open', page: 1, limit: 10 });
console.log(result.data, result.pagination);

// Data layer — thin CRUD, raw rows
const rows = await nt.data.tickets.find({ where: { status_id: 1 }, limit: 20 });

await nt.close();
```

---

## Configuration

All options passed to `nodeticket.init(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `dialect` | `string` | `'mysql'` | `'mysql'` or `'postgres'` |
| `host` | `string` | `'localhost'` | Database host |
| `port` | `number` | auto | `3306` for mysql, `5432` for postgres |
| `database` | `string` | **required** | Database name |
| `user` | `string` | `'root'` | Database user |
| `password` | `string` | `''` | Database password |
| `prefix` | `string` | `'ost_'` | osTicket table prefix |
| `pool.min` | `number` | `2` | Minimum pool connections |
| `pool.max` | `number` | `10` | Maximum pool connections |

**Returns:** `Promise<NodeticketInstance>`

```js
const nt = await nodeticket.init({
  dialect: 'mysql',
  host: 'db.example.com',
  port: 3306,
  database: 'osticket',
  user: 'app',
  password: 'secret',
  prefix: 'ost_',
  pool: { min: 2, max: 10 },
});
```

---

## Data Layer

Accessed via `nt.data.<domain>`. Every data module operates directly on osTicket
database tables. Rows are returned as-is from the database (no transformation).

### Standard CRUD Methods

Every data module (except `config`) exposes this common interface:

#### `find(options?)` -> `Promise<Array<Object>>`

```js
const tickets = await nt.data.tickets.find({
  where: { status_id: 1 },
  orderBy: 'created DESC',
  limit: 25,
  offset: 0,
});
```

| Option | Type | Description |
|---|---|---|
| `where` | `Object` | Key-value WHERE conditions (AND) |
| `orderBy` | `string` | SQL ORDER BY clause |
| `limit` | `number` | Max rows to return |
| `offset` | `number` | Rows to skip |

#### `findById(id)` -> `Promise<Object|null>`

```js
const ticket = await nt.data.tickets.findById(42);
```

#### `count(where?)` -> `Promise<number>`

```js
const total = await nt.data.tickets.count({ status_id: 1 });
```

#### `create(data)` -> `Promise<Object>`

Returns the inserted data with the auto-generated primary key.

```js
const ticket = await nt.data.tickets.create({
  number: '100001', user_id: 5, dept_id: 1,
});
// ticket.ticket_id is set
```

#### `update(id, data)` -> `Promise<void>`

```js
await nt.data.tickets.update(42, { status_id: 3 });
```

#### `remove(id)` -> `Promise<void>`

```js
await nt.data.tickets.remove(42);
```

### Domain Modules

#### `nt.data.tickets`

Table: `ticket` | PK: `ticket_id`

| Method | Signature | Notes |
|---|---|---|
| `find` | `(options?) -> Promise<Array>` | Standard |
| `findById` | `(id) -> Promise<Object\|null>` | Standard |
| `findByNumber` | `(number) -> Promise<Object\|null>` | Lookup by display number |
| `count` | `(where?) -> Promise<number>` | Standard |
| `create` | `(data) -> Promise<Object>` | Standard |
| `update` | `(id, data) -> Promise<void>` | Standard |
| `remove` | `(id) -> Promise<void>` | Standard |

#### `nt.data.threads`

Table: `thread` | PK: `id`

Also manages `thread_entry`, `thread_event`, and `thread_collaborator` sub-tables.

| Method | Signature | Notes |
|---|---|---|
| `find` | `(options?) -> Promise<Array>` | Standard |
| `findById` | `(id) -> Promise<Object\|null>` | Standard |
| `findByObject` | `(objectId, objectType) -> Promise<Object\|null>` | e.g. `findByObject(42, 'T')` for ticket 42 |
| `count` | `(where?) -> Promise<number>` | Standard |
| `create` | `(data) -> Promise<Object>` | Standard |
| `update` | `(id, data) -> Promise<void>` | Standard |
| `remove` | `(id) -> Promise<void>` | Standard |
| `findEntries` | `(threadId, options?) -> Promise<Array>` | Thread entries (messages/notes) |
| `createEntry` | `(data) -> Promise<Object>` | `data.thread_id` required |
| `countEntries` | `(threadId) -> Promise<number>` | |
| `findEvents` | `(threadId) -> Promise<Array>` | Audit trail events |
| `createEvent` | `(data) -> Promise<Object>` | `data.thread_id` required |
| `findCollaborators` | `(threadId) -> Promise<Array>` | CC'd users on thread |

#### `nt.data.users`

Table: `user` | PK: `id`

Also manages `user_email` and `user_account` sub-tables.

| Method | Signature | Notes |
|---|---|---|
| `find` | `(options?) -> Promise<Array>` | Standard |
| `findById` | `(id) -> Promise<Object\|null>` | Standard |
| `count` | `(where?) -> Promise<number>` | Standard |
| `create` | `(data) -> Promise<Object>` | Standard |
| `update` | `(id, data) -> Promise<void>` | Standard |
| `remove` | `(id) -> Promise<void>` | Standard |
| `findEmails` | `(userId) -> Promise<Array>` | All email addresses for user |
| `createEmail` | `(data) -> Promise<Object>` | `data.user_id`, `data.address` required |
| `removeEmails` | `(userId) -> Promise<void>` | Deletes all emails for user |
| `findAccount` | `(userId) -> Promise<Object\|null>` | Portal login account |
| `createAccount` | `(data) -> Promise<Object>` | `data.user_id` required |
| `updateAccount` | `(userId, data) -> Promise<void>` | |
| `removeAccount` | `(userId) -> Promise<void>` | |

#### `nt.data.staff`

Table: `staff` | PK: `staff_id`

Also manages `staff_dept_access` and `team_member` relationships.

| Method | Signature | Notes |
|---|---|---|
| `find` | `(options?) -> Promise<Array>` | Standard |
| `findById` | `(id) -> Promise<Object\|null>` | Standard |
| `count` | `(where?) -> Promise<number>` | Standard |
| `create` | `(data) -> Promise<Object>` | Standard |
| `update` | `(id, data) -> Promise<void>` | Standard |
| `remove` | `(id) -> Promise<void>` | Standard |
| `findDeptAccess` | `(staffId) -> Promise<Array>` | Extended department access entries |
| `setDeptAccess` | `(staffId, deptIds[]) -> Promise<void>` | Replace all dept access (transactional) |
| `findTeamMemberships` | `(staffId) -> Promise<Array>` | Teams the staff member belongs to |

#### `nt.data.departments`

Table: `department` | PK: `id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.teams`

Table: `team` | PK: `team_id`

| Method | Signature | Notes |
|---|---|---|
| Standard CRUD | | `find`, `findById`, `count`, `create`, `update`, `remove` |
| `findMembers` | `(teamId) -> Promise<Array>` | Staff members on the team (joined) |
| `addMember` | `(teamId, staffId) -> Promise<void>` | |
| `removeMember` | `(teamId, staffId) -> Promise<void>` | |

#### `nt.data.organizations`

Table: `organization` | PK: `id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.roles`

Table: `role` | PK: `id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.topics`

Table: `help_topic` | PK: `topic_id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.sla`

Table: `sla` | PK: `id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.faq`

Table: `faq` | PK: `faq_id`

| Method | Signature | Notes |
|---|---|---|
| Standard CRUD | | `find`, `findById`, `count`, `create`, `update`, `remove` |
| `findCategories` | `() -> Promise<Array>` | All FAQ categories |
| `findByCategory` | `(categoryId, options?) -> Promise<Array>` | FAQs in a category |

#### `nt.data.tasks`

Table: `task` | PK: `id`

Standard CRUD only: `find`, `findById`, `count`, `create`, `update`, `remove`.

#### `nt.data.config`

Table: `config` -- **not** standard CRUD. Key-value access by namespace.

| Method | Signature | Notes |
|---|---|---|
| `get` | `(key, namespace?) -> Promise<string\|null>` | Default namespace: `'core'` |
| `getAll` | `(namespace?) -> Promise<Array<{key, value}>>` | All keys in namespace |
| `set` | `(key, value, namespace?) -> Promise<void>` | Upsert (insert or update) |

```js
const title = await nt.data.config.get('helpdesk_title');
await nt.data.config.set('helpdesk_title', 'My Help Desk');
const all = await nt.data.config.getAll('core');
```

---

## Service Layer

Accessed via `nt.<service>`. These modules provide business logic: validation,
joins, pagination, conflict checks, event logging, and transactional writes.

All list methods return a standard paginated response:

```js
{
  data: [...],
  pagination: { page, limit, total, totalPages }
}
```

Pagination defaults: `page=1`, `limit=25` (max 100).

### `nt.tickets`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(filters?) -> Promise<{data, pagination}>` | Paginated ticket list |
| `get` | `(id) -> Promise<Object>` | Full ticket detail (accepts ID or ticket number) |
| `getThread` | `(ticketId, options?) -> Promise<{data, pagination}>` | Paginated thread entries |
| `getEvents` | `(ticketId) -> Promise<Array>` | Event audit log |
| `create` | `(params) -> Promise<Object>` | New ticket with thread |
| `update` | `(ticketId, changes, options?) -> Promise<{ticket_id}>` | Update metadata |
| `reply` | `(ticketId, params) -> Promise<Object>` | Add reply to thread |
| `addNote` | `(ticketId, params) -> Promise<Object>` | Add internal note |
| `close` | `(ticketId, options?) -> Promise<{ticket_id}>` | Close ticket |
| `merge` | `(sourceTicketId, params) -> Promise<{target_ticket_id}>` | Merge two tickets |

**`list(filters?)`**

```js
const result = await nt.tickets.list({
  status: 'open',       // 'open', 'closed'
  dept_id: 1,
  staff_id: 5,
  user_id: 10,
  topic_id: 2,
  priority_id: 3,
  isoverdue: true,
  search: 'password',   // searches number + subject
  sort: 'created',      // 'ticket_id','number','created','updated','duedate','status_id','priority'
  order: 'DESC',        // 'ASC' or 'DESC'
  page: 1,
  limit: 25,
});
```

**`get(id)`** -- accepts numeric ticket_id or string ticket number:

```js
const ticket = await nt.tickets.get(42);
const ticket = await nt.tickets.get('LK3RF9ZA');
```

**`create(params)`**

```js
const ticket = await nt.tickets.create({
  userId: 5,
  topicId: 2,
  subject: 'Need help',
  body: 'Detailed description...',
  source: 'API',         // optional, default 'API'
});
// -> { ticket_id, number, subject, status, department, created }
```

**`update(ticketId, changes, options?)`**

```js
await nt.tickets.update(42, {
  status_id: 3,
  staff_id: 5,
  dept_id: 2,
  team_id: 1,
  topic_id: 4,
  sla_id: 1,
  duedate: '2026-04-15',
  isoverdue: false,
}, {
  staffId: 1,             // who made the change (for event log)
  username: 'admin',
});
```

All referenced IDs are validated. Status changes automatically set/clear the
`closed` timestamp and log `closed`/`reopened` events.

**`reply(ticketId, params)`**

```js
await nt.tickets.reply(42, {
  staffId: 1,            // staff reply (type 'R')
  // userId: 5,          // OR user message (type 'M')
  body: 'Working on it.',
  format: 'text',        // 'text' or 'html'
  poster: 'Admin',
  source: 'API',
});
```

**`addNote(ticketId, params)`**

```js
await nt.tickets.addNote(42, {
  staffId: 1,
  title: 'Internal',
  body: 'Escalating to tier 2.',
  poster: 'Admin',
});
```

**`close(ticketId, options?)`**

```js
await nt.tickets.close(42, { staffId: 1, username: 'admin' });
```

**`merge(sourceTicketId, params)`**

Moves thread entries and collaborators from source to target, then closes the source.

```js
await nt.tickets.merge(10, {
  targetTicketId: 20,
  staffId: 1,
  username: 'admin',
});
```

### `nt.users`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(filters?) -> Promise<{data, pagination}>` | `filters: { org_id, search, page, limit }` |
| `get` | `(id) -> Promise<Object>` | User detail with emails, org, ticket count |
| `getTickets` | `(userId, options?) -> Promise<{data, pagination}>` | User's tickets |
| `getOrganizations` | `(userId) -> Promise<Array>` | User's org (0 or 1 item) |
| `create` | `(params) -> Promise<Object>` | New user with email + optional account |
| `update` | `(id, changes) -> Promise<void>` | Update name, org_id, status |
| `remove` | `(id) -> Promise<void>` | Deletes user + emails + account |

**`create(params)`**

```js
const user = await nt.users.create({
  name: 'Jane Doe',
  email: 'jane@example.com',
  org_id: 3,            // optional
  username: 'jdoe',     // optional, creates portal account if set with password
  password: 'secret123',
});
```

Throws `ConflictError` if the email already exists. Transactional: creates user row, email row, and optional user_account in one transaction.

### `nt.staff`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(filters?) -> Promise<{data, pagination}>` | `filters: { dept_id, isactive, page, limit }` |
| `get` | `(id) -> Promise<Object>` | Staff detail with depts, teams, role/permissions |
| `getTickets` | `(staffId, options?) -> Promise<{data, pagination}>` | Assigned tickets |
| `getDepartments` | `(staffId) -> Promise<Array>` | Primary + extended dept access |
| `getTeams` | `(staffId) -> Promise<Array>` | Team memberships with isLead flag |
| `create` | `(params) -> Promise<Object>` | New staff member |
| `update` | `(id, changes) -> Promise<void>` | Update any staff field |
| `remove` | `(id) -> Promise<void>` | Delete staff + dept access + team memberships |

**`create(params)`**

```js
const member = await nt.staff.create({
  username: 'jdoe',        // 3-32 chars, unique
  firstname: 'John',
  lastname: 'Doe',
  email: 'jdoe@example.com',
  password: 'secret123',   // min 8 chars, bcrypt hashed
  dept_id: 1,
  role_id: 1,
  phone: '555-1234',       // optional
  isadmin: false,           // optional
  isactive: true,           // optional, default true
  signature: '...',         // optional
  timezone: 'US/Central',  // optional
  departments: [            // optional extended dept access
    { dept_id: 2, role_id: 1 },
    { dept_id: 3 },
  ],
});
```

`remove()` throws `ConflictError` if the staff member has assigned tickets, is a department manager, or is a team lead.

### `nt.departments`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(filters?) -> Promise<{data, pagination}>` | `filters: { ispublic, page, limit }` |
| `get` | `(id) -> Promise<Object>` | Detail with manager, SLA, staff/ticket counts |
| `getStaff` | `(id) -> Promise<Array>` | Staff in dept (primary + extended access) |
| `getTickets` | `(deptId, options?) -> Promise<{data, pagination}>` | Dept's tickets |
| `create` | `(params) -> Promise<Object>` | New department with auto-calculated path |
| `update` | `(id, changes) -> Promise<void>` | Update; recalculates descendant paths on rename |
| `remove` | `(id) -> Promise<void>` | Blocked if children, staff, or tickets exist |

```js
const dept = await nt.departments.create({
  name: 'Support',
  pid: 0,                // parent department ID
  manager_id: 5,         // optional
  sla_id: 1,             // optional
  ispublic: true,        // optional, default true
  signature: '...',      // optional
  flags: 0,              // optional
});
```

### `nt.teams`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(options?) -> Promise<{data, pagination}>` | Teams with lead info and member count |
| `get` | `(id) -> Promise<Object>` | Team detail with member list |
| `getMembers` | `(teamId) -> Promise<Array>` | Members with dept info and isLead flag |
| `create` | `(params) -> Promise<Object>` | `{ name, lead_id?, flags?, notes? }` |
| `update` | `(id, changes) -> Promise<void>` | |
| `remove` | `(id) -> Promise<void>` | Blocked if tickets assigned to team |
| `addMember` | `(teamId, staffId) -> Promise<void>` | Validates both exist; `ConflictError` if duplicate |
| `removeMember` | `(teamId, staffId) -> Promise<void>` | `NotFoundError` if not a member |

### `nt.organizations`

| Method | Signature | Returns |
|---|---|---|
| `list` | `(filters?) -> Promise<{data, pagination}>` | `filters: { search, page, limit }` |
| `get` | `(id) -> Promise<Object>` | Detail with user/ticket counts, manager |
| `getUsers` | `(orgId, options?) -> Promise<{data, pagination}>` | Users in org |
| `getTickets` | `(orgId, options?) -> Promise<{data, pagination}>` | Tickets from org users |
| `create` | `(params) -> Promise<Object>` | `{ name, domain?, status?, manager?, extra? }` |
| `update` | `(id, changes) -> Promise<void>` | Name uniqueness enforced |
| `remove` | `(id) -> Promise<void>` | Blocked if users are assigned |

```js
const org = await nt.organizations.create({
  name: 'Acme Corp',    // 1-128 chars, unique
  domain: 'acme.com',
  status: 0,
  manager: 's:5',       // "s:staffId" format
  extra: { notes: '...' },  // stored as JSON
});
```

### `nt.auth`

Password hashing and credential verification only. Does **not** handle sessions, JWT, or login flows.

| Method | Signature | Returns |
|---|---|---|
| `verifyPassword` | `(plaintext, hash) -> Promise<boolean>` | bcrypt compare |
| `hashPassword` | `(plaintext) -> Promise<string>` | bcrypt hash (10 rounds) |
| `lookupStaffByCredentials` | `(username) -> Promise<Object\|null>` | Staff record (incl. passwd) by username or email |
| `lookupUserByCredentials` | `(username) -> Promise<Object\|null>` | User account record (incl. passwd) by username |
| `changePassword` | `(type, id, currentPassword, newPassword) -> Promise<void>` | Verify-then-update |

```js
// Authenticate a staff member
const staff = await nt.auth.lookupStaffByCredentials('admin');
if (staff) {
  const valid = await nt.auth.verifyPassword(inputPassword, staff.passwd);
}

// Change a password (verifies current first)
await nt.auth.changePassword('staff', 1, 'oldPass', 'newPass');
await nt.auth.changePassword('user', 5, 'oldPass', 'newPass');
```

### `nt.system`

System configuration, statistics, and reference data.

| Method | Signature | Returns |
|---|---|---|
| `getConfig` | `() -> Promise<Object>` | Parsed core config (helpdesk_title, defaults, etc.) |
| `getStats` | `() -> Promise<Object>` | Aggregate counts (tickets by state, users, staff, etc.) |
| `listPriorities` | `(options?) -> Promise<Array>` | `options: { publicOnly? }` |
| `listStatuses` | `() -> Promise<Array>` | All ticket statuses sorted by sort order |

```js
const config = await nt.system.getConfig();
// { helpdesk_url, helpdesk_title, default_dept_id, default_sla_id, ... }

const stats = await nt.system.getStats();
// { tickets: { total, open, closed, overdue, unassigned, today }, users, staff, ... }

const priorities = await nt.system.listPriorities({ publicOnly: true });
const statuses = await nt.system.listStatuses();
```

---

## Error Handling

All SDK errors extend `NodeticketError`. Import them from the SDK:

```js
const { errors } = require('nodeticket');
const { ValidationError, NotFoundError, ConflictError, ConnectionError } = errors;
```

### Error Classes

| Class | Code | When |
|---|---|---|
| `NodeticketError` | `NODETICKET_ERROR` | Base class for all SDK errors |
| `ValidationError` | `VALIDATION_ERROR` | Invalid input, missing required fields |
| `NotFoundError` | `NOT_FOUND` | Record does not exist |
| `ConflictError` | `CONFLICT` | Uniqueness violation, referential integrity block |
| `ConnectionError` | `CONNECTION_ERROR` | Database connection failure |

### Properties

All errors have:

- `message` -- human-readable description
- `code` -- machine-readable string (see table above)
- `name` -- class name (e.g. `'ValidationError'`)

`ValidationError` also has:

- `errors` -- optional `Object` with field-level details, or `null`

### Usage

```js
try {
  await nt.users.create({ name: '', email: '' });
} catch (err) {
  if (err instanceof errors.ValidationError) {
    console.log(err.code);    // 'VALIDATION_ERROR'
    console.log(err.message); // 'Name is required'
    console.log(err.errors);  // field-level detail or null
  } else if (err instanceof errors.ConflictError) {
    console.log(err.message); // 'A user with this email already exists'
  } else if (err instanceof errors.NotFoundError) {
    console.log(err.message); // 'User not found'
  }
}
```

---

## Advanced

### Transactions

Use `nt.connection.transaction()` for multi-step operations that must be atomic:

```js
await nt.connection.transaction(async (txQuery, txQueryOne) => {
  const user = await txQueryOne('SELECT id FROM ost_user WHERE id = ?', [5]);
  await txQuery('UPDATE ost_user SET status = 1 WHERE id = ?', [5]);
  await txQuery('INSERT INTO ost_user_email (user_id, address) VALUES (?, ?)', [5, 'new@example.com']);
  // Automatically commits on success, rolls back on error
});
```

The callback receives `txQuery` and `txQueryOne` functions scoped to the
transaction. Both dialects (MySQL and PostgreSQL) are supported.

### Raw Connection Access

The connection object is available at `nt.connection` for queries the SDK
does not cover:

```js
// Raw SQL
const rows = await nt.connection.query('SELECT * FROM ost_ticket WHERE isoverdue = 1');
const row = await nt.connection.queryOne('SELECT * FROM ost_user WHERE id = ?', [5]);
const val = await nt.connection.queryValue('SELECT COUNT(*) FROM ost_ticket');

// Helpers
const prefixed = nt.connection.table('ticket');     // 'ost_ticket'
const dialect = nt.connection.getDialect();          // 'mysql' or 'postgres'
const prefix = nt.connection.getPrefix();            // 'ost_'

// Built-in finders (same as data layer internals)
const results = await nt.connection.find('ticket', { where: { status_id: 1 }, limit: 10 });
const one = await nt.connection.findOne('ticket', { status_id: 1 });
const byId = await nt.connection.findById('ticket', 42, 'ticket_id');
const total = await nt.connection.count('ticket', { status_id: 1 });
```

### Multiple Instances

Each `init()` call creates an independent connection pool. Use this for
multi-tenant setups or connecting to multiple osTicket databases:

```js
const site1 = await nodeticket.init({ database: 'osticket_site1', user: 'root', password: 'a' });
const site2 = await nodeticket.init({ database: 'osticket_site2', user: 'root', password: 'b' });

const site1Tickets = await site1.tickets.list({ status: 'open' });
const site2Tickets = await site2.tickets.list({ status: 'open' });

await site1.close();
await site2.close();
```

### Closing

Always close the connection pool when your application shuts down:

```js
await nt.close();
```
