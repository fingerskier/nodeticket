# Nodeticket SDK Extraction — Design Spec

**Date**: 2026-04-03
**Status**: Approved

## Context

Nodeticket is a Node.js application providing REST API, admin SPA, and MCP service for osTicket databases. All database logic lives in Express controllers (~4,500 lines), tightly coupled to HTTP. This makes reuse impossible without the full server.

**Goal**: Layered architecture where an exportable SDK is the core, and Express/MCP are consumers built on top.

**Constraints**: Non-destructive to osTicket schema. Monorepo for now, cleanly separable later. Incremental migration. JSDoc throughout. Markdown API reference.

## Architecture

```
src/sdk/                        # Exportable library
  index.js                      # init() factory, namespace assembly
  connection.js                 # Pool management, dialect abstraction
  errors.js                     # NotFoundError, ValidationError, etc.
  data/                         # Thin CRUD (close to SQL)
    tickets.js, threads.js, users.js, staff.js, departments.js,
    teams.js, organizations.js, roles.js, topics.js, sla.js,
    faq.js, tasks.js, config.js
  services/                     # Business logic (multi-table, validation)
    tickets.js, users.js, staff.js, departments.js, teams.js,
    organizations.js, auth.js, system.js
```

Express controllers become thin HTTP adapters. `src/lib/db.js` becomes a backward-compat wrapper around `sdk/connection`.

## SDK Public API

```javascript
const nodeticket = require('nodeticket');
const nt = await nodeticket.init({ dialect, host, port, database, user, password, prefix, pool });

// Thin data access
await nt.data.tickets.find({ where: { status_id: 1 }, limit: 20 });
await nt.data.tickets.findById(123);

// Business logic
await nt.tickets.create({ userId, topicId, subject, body });
await nt.tickets.reply(123, { staffId, body });
await nt.tickets.close(123, { staffId });

await nt.close();
```

## Data Layer

Standard methods per domain: `find`, `findById`, `count`, `create`, `update`, `remove`. Factory functions receiving connection instance. Non-destructive to osTicket schema.

## Service Layer

Orchestrates multi-table operations. Depends only on data layer. Does NOT include HTTP, auth/authz, email, or JWT. Throws SDK error classes.

## Error Types

`NodeticketError` (base), `ValidationError`, `NotFoundError`, `ConflictError`, `ConnectionError`.

## Package Export

`package.json` main points to `src/sdk/index.js`. `npm start` runs Express server.
