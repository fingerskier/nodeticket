# Production readiness

Checklist and ops notes for running Nodeticket in production.

## Required environment

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=production` | Enables secure cookies, config validation, safe errors |
| `SESSION_SECRET` | Strong random secret (required; app refuses default in production) |
| `JWT_SECRET` | Strong random secret (required) |
| `DB_*` | MySQL connection to osTicket-compatible schema |
| `TABLE_PREFIX` | Usually `ost_` |
| `HELPDESK_URL` | Public base URL (email links, etc.) |
| `EMAIL_FROM` / `AWS_REGION` | SES outbound (or rely on dev-mock only in non-prod) |

Optional:

| Variable | Purpose |
|----------|---------|
| `SESSION_MAX_AGE` | Cookie lifetime ms (default 24h) |
| `SESSION_IDLE_TIMEOUT` | Idle logout ms (default 30m); SPA uses same value |
| `SESSION_STORE=redis` | Use Redis for sessions (multi-instance); default is MemoryStore |
| `REDIS_URL` | Required when `SESSION_STORE=redis` (e.g. `redis://127.0.0.1:6379`) |
| `REDIS_SESSION_PREFIX` | Redis key prefix (default `nt:sess:`) |
| `API_RATE_LIMIT` | Requests per 15 minutes per IP |
| `MCP_ENABLED` / `MCP_JWT_SECRET` | MCP surface |

## Session store (Memory default, Redis optional peer)

**Default:** `express-session` **MemoryStore** — correct for single-process local and most single-node deploys. Sessions are lost on process restart and are **not** shared across replicas.

**Multi-instance / HA:** Redis is an **optional peer dependency** (not installed with a normal `npm install`).

```bash
# Install peers only when you need shared sessions
npm install redis@^5 connect-redis@^9

# Environment
SESSION_STORE=redis
REDIS_URL=redis://127.0.0.1:6379
# optional: REDIS_SESSION_PREFIX=nt:sess:
```

| If… | Then… |
|-----|--------|
| Peers not installed | Warning logged; **falls back to MemoryStore** |
| `SESSION_STORE=redis` but no `REDIS_URL` | Warning; MemoryStore |
| Redis unreachable at runtime | Client logs errors; session ops may fail until Redis is back |

`redis` and `connect-redis` are declared under `peerDependencies` + `peerDependenciesMeta.optional` so npm does not require them for a default install.

## Session & auth policy

- **Login** regenerates the session id (fixation protection) for SPA API and HTML form login.
- **Logout** destroys the session cookie (`GET /logout`). JWT access tokens remain valid until expiry; treat JWT as short-lived and prefer session for browsers.
- **CSRF** is required for session-authenticated mutating `/api/v1` and all `/admin` + HTML form POSTs.
- **Idle timeout** is enforced server-side on session auth and mirrored in the customer SPA.
- **Multi-instance:** install Redis peers + `SESSION_STORE=redis`, or use sticky sessions with MemoryStore (not recommended).

## Ticket locks (staff)

Soft edit locks match stock tables (`ost_lock`, `ticket.lock_id`) and config keys (`ticket_lock`, `autolock_minutes`):

| Mode (`ticket_lock`) | Behavior in Nodeticket |
|----------------------|------------------------|
| `0` | Disabled |
| `1` | Stock “on view” — we still only touch locks on **staff write** (product choice: soft + on-first-edit) |
| `2` (default) | On activity — acquire/renew on staff reply/note/assign/close/etc. |

- Writes are **never hard-blocked**; if another agent holds the lock, the write succeeds and a warning is shown.
- Cron job `LockCleanup` removes expired locks when `POST /api/tasks/cron` runs.
- API: `GET/POST /api/v1/tickets/:id/lock`, `POST .../lock/release` (staff).

## Cron

Stock osTicket expects an external scheduler to hit the official cron endpoint.

```http
POST /api/tasks/cron
X-API-Key: <key with can_exec_cron>
```

Response body: `Completed` (HTTP 200).

Native equivalent: `POST /api/v1/cron` (authenticated per API design).

Example (system cron, every 5 minutes):

```cron
*/5 * * * * curl -fsS -X POST -H "X-API-Key: $CRON_API_KEY" https://help.example.com/api/tasks/cron
```

## Frontend deps

- Customer SPA state machine: **ygdrassil 2026.7.13**, self-hosted at  
  `src/public/vendor/ygdrassil/StateMachine.js`  
  with CDN fallback to jsDelivr at the same version.
- Prefer serving the local vendor file (no runtime CDN dependency in normal operation).

## Safe errors

- Production API responses for unexpected errors use a generic message (no stack).
- HTML error pages HTML-escape messages; stacks only in `development`.

## Database

- Supported dialect: **MySQL** (osTicket schema). PostgreSQL fails fast at startup.
- Prefer fixture bootstrap (`docs/FIXTURE.md`) for CI and local integration tests, not production data.

## Recommended process model

1. Reverse proxy (TLS termination) → Node (`PORT`, `HOST`).
2. Trust proxy is enabled (`app.set('trust proxy', 1)`).
3. Single process or multiple processes **behind a load balancer with sticky sessions or Redis session store**.
4. Health: rely on process manager restart; optional HTTP `GET /` SPA shell.

## Deploy smoke checklist

- [ ] `NODE_ENV=production` starts without config exit
- [ ] Staff login → `/admin`, customer login → SPA
- [ ] Create ticket + reply + attachment download
- [ ] FAQ public browse + admin CRUD
- [ ] Cron endpoint returns `Completed` with cron key
- [ ] Logout clears session; idle logout works

## CI

```bash
npm test              # unit
npm run test:http     # requires MySQL fixture (docker compose)
```

GitHub Actions runs unit tests on push; HTTP fixture is optional when Docker services are available.
