# nodeticket

**Node.js help desk that interoperates with existing osTicket v1.8+ MySQL databases.**

## Quick start

```bash
cp .env.example .env   # if present; otherwise set env vars (see docs/PRODUCTION.md)
npm install
npm start              # http://localhost:3000
```

- **Customer portal:** `/` (SPA)
- **Staff admin:** `/admin` (session login as staff)
- **Native API:** `/api/v1/*`
- **Official FOSS API:** `/api/tickets.json`, `/api/tickets.xml`, `/api/tickets.email`, `/api/tasks/cron`

## Development

```bash
npm run dev            # watch mode
npm test               # unit tests
npm run fixture:up     # Docker MySQL on :3307
npm run fixture:bootstrap
npm run test:http      # HTTP integration (skips if fixture down)
```

See [docs/FIXTURE.md](docs/FIXTURE.md) and the master plan in [plan/PLAN.md](plan/PLAN.md).

## Production

See **[docs/PRODUCTION.md](docs/PRODUCTION.md)** for:

- Required secrets (`SESSION_SECRET`, `JWT_SECRET`, MySQL)
- Session regeneration / logout / CSRF / idle policy
- Session store: **MemoryStore default**; Redis via **optional peers** (`npm install redis connect-redis` + `SESSION_STORE=redis`)
- External cron → `POST /api/tasks/cron`
- Self-hosted ygdrassil pin and safe error behavior
- Deploy smoke checklist

## Core concepts

### Actors
* Customers
* Staff
* Agents (rules, routing)
* Administrators

### Actions
* create / classify / assign tickets
* public replies and internal notes
* close / reopen
* attachments and outbound notifications

### Entities
* Tickets, users, staff, departments, topics, FAQ, SLA, filters
