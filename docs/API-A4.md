# Native product API additions (Gate A4)

Base path: `/api/v1`. Auth: Bearer JWT or session cookie (staff/user as noted).

## Tickets

### Create (user or staff on behalf)

`POST /tickets`

| Caller | Body |
|--------|------|
| User | `{ topic_id, subject, message, attachments? }` — email verified required |
| Staff | `{ user_id, topic_id, subject, message, source?, attachments? }` — **user_id required** |

Response includes optional `notification: { sent, messageId|reason }`.

### Attachments

| Method | Path | Notes |
|--------|------|-------|
| GET | `/tickets/:id/attachments` | Metadata list |
| GET | `/tickets/:id/attachments/:fileId` | Binary download |
| POST | `/tickets/:id/attachments` | Body `{ attachments: [{ name, type?, data, encoding? }], entry_id? }` |
| POST | `/tickets/:id/reply` | Accepts optional `attachments` array on the new entry |

`data` may be RFC 2397 data URL or base64 string.

## Tasks (staff)

| Method | Path |
|--------|------|
| POST | `/tasks` — `{ title, description?, dept_id?, staff_id?, team_id?, object_id?, object_type?, duedate? }` |
| PUT | `/tasks/:id` |
| POST | `/tasks/:id/close` |

## FAQ (staff write)

| Method | Path |
|--------|------|
| POST | `/faq` — `{ question, answer, category_id?, keywords?, ispublished?, notes? }` |
| PUT | `/faq/:id` |
| DELETE | `/faq/:id` |

Public list/get unchanged (published + public categories for users).

## System

- `DB_DIALECT=postgres` **fails fast** at config load and at `sdk` `createConnection`.
- Outbound mail uses SES when `AWS_ACCESS_KEY_ID` is set; otherwise console mock (dev).

## Official FOSS API (A2–A3)

Still under `/api` (not `/api/v1`):

- `POST /api/tickets.json|.xml|.email`
- `POST /api/tasks/cron`
