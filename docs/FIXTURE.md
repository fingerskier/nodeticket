# Database fixture (Gate A1)

## Supported target

| Item | Value |
|------|--------|
| Database | **MySQL 8.0+** |
| Schema | **osTicket FOSS v1.18.x** (pin: **v1.18.4**) |
| Table prefix | `ost_` (configurable via `TABLE_PREFIX`) |
| SQL mode | Prefer `STRICT_TRANS_TABLES` |

PostgreSQL is **not** a supported production dialect until a dedicated implementation track lands. Configure `DB_DIALECT=mysql` only.

## Local MySQL via Docker

```bash
docker compose -f docker-compose.fixture.yml up -d
```

This starts MySQL 8 on host port **3307**:

| Setting | Value |
|---------|--------|
| Host | `127.0.0.1` |
| Port | `3307` |
| Database | `osticket` |
| User | `osticket` / `osticket` |
| Root | `root` / `root` |

## Bootstrap a stock schema

1. Download [osTicket v1.18.4](https://github.com/osTicket/osTicket/releases/tag/v1.18.4).
2. Apply the official install stream SQL (replace `%TABLE_PREFIX%` with `ost_`):

   `setup/inc/streams/core/install-mysql.sql`

3. Complete a normal osTicket web install **or** seed minimum rows:
   - At least one department, role, staff admin, help topic (public + active `flags & 1`)
   - Default ticket statuses (`open`, `closed`)
   - Default ticket form so dynamic table `ost_ticket__cdata` exists with a `subject` column
   - Optional: `ost_sequence` row for ticket numbering
   - Core events (`created`, `closed`, `reopened`, `assigned`, `transferred`, `message`, `note`, `merged`, …)

Nodeticket **does not** create dynamic `__cdata` tables; those come from osTicket form bootstrap.

## Nodeticket `.env` for the fixture

```env
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=osticket
DB_USER=osticket
DB_PASSWORD=osticket
TABLE_PREFIX=ost_
```

## What A1 code assumes

- `help_topic` uses `flags` / `ispublic` (not a nonexistent `isactive` column)
- `thread_entry.updated` is NOT NULL
- `thread_event` requires `thread_type`, `staff_id`, `team_id`, `dept_id`, `topic_id`, `uid`, `uid_type`, `annulled`, `timestamp`
- Ticket create runs in a **single transaction** (ticket → cdata → thread → entry → event)
- Ticket numbers prefer `ost_sequence` (+ optional `help_topic.number_format`)

## Automated tests today

Unit tests under `test/sdk.tickets.create-kernel.test.js` assert SQL shape and transactional create without a live DB.

Full integration tests against this fixture (and optional PHP bidirectional checks) are the next hardening step after bootstrap is scripted in CI.
