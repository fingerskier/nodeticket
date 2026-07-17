# Database fixture (integration tests)

A **MySQL fixture** is a disposable, known-good osTicket-shaped database used to prove real HTTP + SQL behavior (not just unit mocks).

## Target

| Item | Value |
|------|--------|
| Engine | MySQL 8.0 (Docker) |
| Schema | `docs/mysql.sql` (+ `test/fixture/extra-schema.sql` for `ticket__cdata`) |
| Host/port | `127.0.0.1:3307` |
| Database | `osticket` |
| App user | `osticket` / `osticket` |
| Root | `root` / `root` |
| Table prefix | `ost_` |

## One-time / reset

```bash
# Start MySQL (Docker Desktop must be running)
npm run fixture:up

# Load schema + seed identities (idempotent clean slate)
npm run fixture:bootstrap

# Or both:
npm run fixture:reset
```

## Seeded accounts

| Kind | Username | Password | Notes |
|------|----------|----------|--------|
| Staff admin | `admin` | `password123` | `isadmin=1` |
| Customer | `customer` | `password123` | verified account |
| API key | `NTFIXTURETESTKEY00000000000000000000000000000001` | — | `can_create_tickets` + `can_exec_cron`, IP `0.0.0.0` |
| Help topic | id `1` | — | General Inquiry, public + active |

## Run tests

```bash
# Unit tests only (no Docker required)
npm test

# Integration HTTP tests (requires fixture up + bootstrap)
npm run test:http

# Everything (integration skips if MySQL not reachable)
npm run test:all
```

## App `.env` for manual use against the fixture

```env
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=osticket
DB_USER=osticket
DB_PASSWORD=osticket
TABLE_PREFIX=ost_
JWT_SECRET=fixture-jwt-secret
SESSION_SECRET=fixture-session-secret
```

## What bootstrap does

1. Wait until MySQL accepts connections on port 3307  
2. Drop any existing `ost_*` tables  
3. Apply `docs/mysql.sql`  
4. Ensure `ost_ticket__cdata` exists  
5. Seed statuses, dept, role, staff, user, topic, sequence, events, API key  

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `fixture:bootstrap` wait forever | Start Docker Desktop; `docker compose -f docker-compose.fixture.yml ps` |
| Access denied for osticket | Re-run bootstrap (it grants privileges) |
| Integration tests skip | Bootstrap not run, or wrong port |
| Port 3307 in use | Change host port in `docker-compose.fixture.yml` and `FIXTURE_PORT` |
