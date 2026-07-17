# Nodeticket Project Review Findings

**Reviewer:** Grok  
**Date:** 2026-07-16  
**Branch:** `main` (clean working tree)  
**Goals under review:**

1. **API feature parity** with legacy osTicket FOSS (product capabilities + official HTTP interop)
2. **Minimal UI** for a usable ticketing system (end-user portal + staff/admin ops)

---

## 1. Executive summary

Nodeticket is a solid **Node.js reimplementation path** for osTicket: schema-compatible MySQL interop, a layered SDK, a modern `/api/v1` REST surface, server-rendered staff admin, a client SPA portal, CLI, and optional MCP tools. Core ticket CRUD/lifecycle (list, get, create, update/assign/transfer via fields, reply, note, merge, bulk) is largely present.

It is **not yet at parity** with osTicket FOSS as an operational help desk:

| Goal | Status | One-line assessment |
|------|--------|---------------------|
| Official osTicket HTTP API interop | **Fail** | Legacy `POST /api/tickets.json` is stubbed (`Write operations not yet implemented`) |
| Product-level ticket API | **Partial (~65–75%)** | Strong REST core; missing attachments, email pipeline, SLA due-date engine, fine-grained RBAC, staff-on-behalf create, full tasks |
| Minimal end-user UI | **Mostly met** | SPA covers login/register, list/create/view/reply/close, FAQ browse, profile |
| Minimal staff UI | **Partial** | Admin lists/CRUD for config entities; ticket **detail is largely read-only** (no reply/assign/note forms) |

**Bottom line:** Architecture and breadth of surface area are ahead of depth and reliability. Highest leverage work is (1) finish legacy create API + attachments, (2) wire staff ticket actions in UI + enforce permissions, (3) SLA/overdue + outbound notifications, (4) tests around ticket lifecycle.

---

## 2. Clarifying "API feature parity"

### 2.1 Official FOSS API (documented osTicket 1.x)

Upstream osTicket FOSS documents a deliberately thin public HTTP API:

- `POST /api/tickets.json` | `.xml` | `.email` — **create ticket only**
- Cron trigger endpoint
- Auth via `X-API-Key` (+ optional IP binding)

Fields: `email`, `name`, `subject`, `message`, `topicId`, `priority`, `source`, `alert`, `autorespond`, `ip`, `attachments[]`, custom form fields, phone/notes.

**Nodeticket status vs official API**

| Capability | Status | Evidence |
|------------|--------|----------|
| API key auth (`X-API-Key`) | Implemented | `src/middleware/auth.js` + admin API key UI |
| IP restriction on keys | Implemented | `verifyApiKey` |
| `POST /api/tickets.json` create | **Stub** | `createLegacy` throws bad request |
| `.xml` / `.email` formats | Missing | Only `.json` route registered |
| Attachments on create | Missing | No attachment code anywhere under `src/` |
| Custom form fields on create | Missing | Create path uses subject/body/topic only |
| `alert` / `autorespond` flags | Missing | Create does not send staff alerts / user auto-reply |
| Cron endpoint | Present, no-op | `POST /api/v1/cron` returns skipped tasks |
| Success body = ticket number | N/A until create works | — |

**Verdict:** Goal "interop with legacy osTicket clients that only create tickets" is **not met** until `createLegacy` is implemented with key-gated create, attachments, and response shape compatibility.

### 2.2 Product-level FOSS capabilities (what agents/users actually need)

`FX.md` and `docs/TODO.md` correctly aim beyond the official API at full desk behavior. Mapping against osTicket FOSS product:

#### Implemented (good)

- **Auth:** login/logout/me/refresh, register, email verify, forgot/reset password; JWT + session + API key
- **Tickets:** list (filter/sort/page), get (with collaborators), thread, events, create (authenticated user), update (status/staff/dept/team/topic/sla/duedate), reply, internal note, merge, bulk assign/close/delete
- **Filters:** CRUD + `applyFilters` on web create (reject + field overrides)
- **Org structure:** users, staff, departments, teams, organizations, roles, help topics, SLA plans, settings, email templates, canned responses
- **FAQ:** public list/get/categories (read)
- **Tasks:** list/get/thread (read-only)
- **System:** priorities, statuses, config, stats
- **SDK** (`src/sdk/`): data + service layers for tickets and major entities; package `main` points at SDK
- **MCP tools:** tickets, users, staff, admin (when enabled)
- **Admin UI:** broad server-rendered coverage for P0–P3 config entities
- **DB interop:** `ost_` prefix, schema docs aligned to osTicket tables

#### Missing or incomplete (parity gaps)

| Area | Gap | Severity for parity |
|------|-----|---------------------|
| **Legacy ticket create** | Stub only | **Blocker** for official API parity |
| **Attachments** | No upload/store/serve; no `file`/`file_chunk` usage | **Blocker** for real desks |
| **Inbound email** | No IMAP/POP3 fetcher; cron MailFetcher skipped | **High** |
| **Outbound email** | SES helper exists; not hooked to reply/create/auto-response templates | **High** |
| **SLA engine** | Create sets `duedate`/`est_duedate` NULL; no grace-period / business-hours calc; TicketMonitor cron skipped | **High** |
| **Ticket number sequence** | Random base36 string, not `ost_sequence` | Medium (interop/display) |
| **Priority storage** | Priority read via **help_topic.priority_id**, not ticket-level/`ticket__cdata` priority; update API has no priority field | Medium |
| **Staff create on behalf of user** | `create` requires `auth.type === 'user'` | Medium |
| **API-key create via v1** | Same restriction; keys treated as staff/admin elsewhere | Medium |
| **Role permissions** | `requirePermission` defined but **never used on routes**; any staff can update/merge/note | **High** (security) |
| **Dept / assigned_only visibility** | Staff/API can access **all** tickets (`canAccessTicket` short-circuits) | **High** |
| **Org / collaborator access** | Users only own tickets; no org-shared or CC access checks | Medium |
| **Locks** | `lock_id` in schema unused | Low–medium |
| **Referrals / link tickets** | Not implemented | Low–medium |
| **Tasks write path** | No create/update/assign/close API | Medium |
| **FAQ write / vote** | P4 open; admin FAQ page list-only | Medium |
| **Custom forms** | Dynamic forms not processed on create/update | High for custom installs |
| **Plugins / webhooks** | P5 open | Low for MVP |
| **2FA / LDAP / OAuth backends** | Deferred / not present | Low for MVP |
| **OpenAPI** | Behind code: missing bulk, merge, settings, filters, canned, email-templates, roles, auth register/reset, etc. | Medium (docs drift) |

### 2.3 REST surface inventory (implemented routes)

```
/api/v1/auth/*          login logout me refresh register forgot/reset verify
/api/v1/tickets         GET list, POST create, POST bulk
/api/v1/tickets/:id     GET PUT  + /thread /events /reply /note /merge
/api/v1/users|staff|departments|teams|organizations|topics|sla|roles
/api/v1/settings|email-templates|canned-responses|filters
/api/v1/faq|tasks|priorities|statuses|system/*|cron
/api/tickets.json       legacy create (STUB)
```

Assign / close / transfer are **field updates** on `PUT /tickets/:id` (and SDK `close`), not dedicated endpoints — acceptable design, but clients must know the model.

---

## 3. Critical / high findings (bugs and design holes)

### 3.1 Legacy create is a hard fail for osTicket clients

- **File:** `src/controllers/ticketController.js` → `createLegacy`
- **Behavior:** Always throws `Write operations not yet implemented`
- **Impact:** Any migration path or script that posts to osTicket's create API cannot switch to nodeticket
- **Fix direction:** Implement with API-key permission `can_create_tickets`, create/find user by email, map `topicId`/`message`/`attachments`, return `201` + ticket number string body (or dual JSON mode behind Accept header)

### 3.2 Role-based permissions not enforced

- **File:** `src/middleware/auth.js` exports `requirePermission`
- **Usage:** No route wires it; ticket update/reply/note/merge only check staff vs user coarsely
- **Impact:** Non-admin staff with limited roles get full write access if they can authenticate as staff
- **Fix direction:** Map osTicket-style perms (reply, assign, close, delete, transfer, merge) onto role JSON and apply on ticket routes

### 3.3 Staff ticket visibility is global

- **File:** `src/middleware/auth.js` → `canAccessTicket`
- **Impact:** Ignores primary dept, `staff_dept_access`, `assigned_only`, referrals
- **Fix direction:** Filter list queries and gate get/update by department membership + assignment rules

### 3.4 User close/reopen UX is inconsistent with API

- SPA close/reopen sends `PUT` with `status_id`
- Controller for non-staff **always calls `tickets.close`** when any status_id is present — **reopen is broken for end users**
- **File:** `ticketController.update` user branch

### 3.5 Note route auth order

- `POST /:id/note` uses `requireStaff` then `canAccessTicket` but **not** an explicit leading `authenticate` on that chain (rely on `requireStaff` → `authenticate`)
- Works if `requireStaff` always authenticates first (it does), but API-key note posts set `staffId` from `req.auth.id` which for apikey is **key id**, not staff_id — audit trail pollution

### 3.6 CSRF known open issue

- Root `TODO.md`: csrf-csrf v4 ForbiddenError on startup/login (Reqall #609)
- Middleware wraps double-submit cookie; HTML/admin depend on it
- Blocks confidence in form-based admin if still reproducible

### 3.7 SLA and overdue are cosmetic

- Create never sets `sla_id` from topic default or computes due dates
- Cron `TicketMonitor` skipped
- Overdue filter works only if data is populated elsewhere (e.g. coexisting PHP osTicket)

### 3.8 Priority model is incomplete

- Joins `help_topic.priority_id` for display; no per-ticket priority override field on `ost_ticket` (osTicket typically uses form/cdata priority)
- Filters can set priority, but ticket row may not persist a dedicated priority column — verify against real osTicket DB how priority is stored for existing installs

### 3.9 Admin ticket detail is read-only

- `/admin/tickets/:id` renders metadata + thread, **no reply, note, assign, transfer, close** forms
- Bulk assign/close exists on list page only
- Undercuts "minimal staff UI" for day-to-day work

### 3.10 Thin automated test coverage

Tests present:

- CLI args / runner / export-users
- SDK auth set-password, users form-fields

**Missing:** ticket create/update/reply/merge, filters engine, auth middleware, canAccessTicket, legacy API, integration tests against MySQL fixture

---

## 4. Goal 2 — Minimal UI assessment

### 4.1 End-user portal (SPA) — **adequate minimal**

**Stack:** `src/public/js/spa.js` + ygdrassil state machine + `/api/v1` + session cookies  
**Routes shell:** `src/routes/html.js` serves SPA; auth POSTs for session login/password flows

| User story | Present? | Notes |
|------------|----------|-------|
| Login (user/staff type) | Yes | SPA + session POST |
| Register + verify messaging | Yes | |
| List my tickets | Yes | Server forces `user_id` for users |
| Create ticket (topic/subject/message) | Yes | No attachments |
| View thread | Yes | EscapeHtml on body (XSS fix noted done) |
| Reply | Yes | |
| Close / reopen | Partial | Close path; reopen broken for users (see 3.4) |
| FAQ browse | Yes | Search UI basic |
| Profile / change password | Yes (HTML routes) | |
| Attachments | No | |
| Canned responses (user) | N/A | Staff feature |

**Minimal UI bar:** Met for a text-only help desk without email/attachments.

### 4.2 Staff / admin UI — **config-complete, ops-thin**

**Stack:** Large server-rendered `src/routes/admin.js` (~3k lines) + `admin.css`/`admin.js`

| Area | Present? | Notes |
|------|----------|-------|
| Dashboard stats | Yes | Open/unassigned counts |
| Ticket list + filters + bulk | Yes | Assign/close/delete bulk via API |
| Ticket detail ops | **Weak** | Read-only thread view |
| Users/staff/orgs/depts/teams CRUD | Yes | |
| Topics / SLA / settings | Yes | |
| Email templates / canned / filters | Yes | |
| Roles / API keys | Yes | |
| FAQ manage | Weak | List-oriented; write incomplete vs P4 |
| Tasks UI | No | |
| Knowledge base editor | No | |

**Minimal staff bar for "run a desk":** Not fully met until ticket detail supports reply + assign + close + note without leaving to raw API tools.

### 4.3 UI architecture notes

- **Two client styles:** SPA (public) vs SSR admin — fine for minimal; avoid third parallel SPA unless needed
- **admin.js is a god-router:** maintainability risk; feature modules would help
- **No SPA staff mode:** staff who log in via portal SPA still use user-oriented ticket list unless they use `/admin`
- CSP allows `cdn.jsdelivr.net` for ygdrassil — acceptable for minimal; pin versions for production

---

## 5. Architecture strengths (keep)

1. **SDK-first design** — Controllers thin; `src/sdk/services/*` holds business logic; reusable from CLI/MCP/tests
2. **osTicket schema interop** — Practical migration story vs greenfield schema
3. **Filter engine** — Real routing rules with AND/OR, stop-on-match, reject
4. **Auth layering** — JWT + session + API key with idle timeout
5. **MCP surface** — Differentiator vs PHP osTicket for agentic tooling
6. **P0–P3 checklist** largely checked in `docs/TODO.md` for admin config breadth

---

## 6. Documentation vs reality

| Document | Accuracy |
|----------|----------|
| `docs/TODO.md` | Useful phase roadmap; P0–P3 marked done aligns with code presence, not depth (email/attachments still open under P4/P5) |
| `FX.md` | Aspirational domain model; describes operations (email fetcher, SLA calc, PERM_*) that are **specified but not enforced/implemented** |
| `docs/openapi.json` | Incomplete vs live routes; still useful as core contract seed |
| `docs/SCHEMA.md` / `mysql.sql` | Strong reference for interop |
| Root `TODO.md` | Accurate open bugs (CSRF, Windows CLI flags) + open P4/P5 |

---

## 7. Recommended priority roadmap

Aligned to the two stated goals.

### P0 — Unblock parity & trust (1–2 weeks focused)

1. Implement **legacy `POST /api/tickets.json`** (and plan `.xml` later) with API-key gate  
2. Fix **user reopen** path in `ticketController.update`  
3. Fix or document **CSRF** production path  
4. Add **integration tests** for ticket create / reply / close / merge against a fixture DB  
5. Enforce **staff visibility** (dept + assigned_only) on list + `canAccessTicket`

### P1 — Minimal desk that works (ops)

1. Admin (or staff) ticket detail: **reply, note, assign, transfer, close** forms posting to existing API  
2. Hook **outbound email** on reply + new-ticket auto-response using templates  
3. **Attachments** on create/reply (store in osTicket file tables or filesystem + metadata)  
4. Wire **`requirePermission`** on ticket mutating routes  
5. **SLA** on create from topic default + cron overdue mark

### P2 — Official/product completeness

1. Staff/API create ticket on behalf of user  
2. Inbound email (IMAP) + cron MailFetcher  
3. Tasks write API + minimal UI  
4. FAQ CRUD + search polish  
5. OpenAPI regeneration from routes  
6. Custom form field pass-through on create

### P3 — Stretch / P5

- Plugins, webhooks, 2FA, LDAP, scheduled jobs beyond overdue, ticket locks, referrals

---

## 8. Scorecard (subjective)

| Dimension | Score (1–5) | Comment |
|-----------|-------------|---------|
| Schema interop | 4.5 | Clear intent and docs; needs real dual-write validation with live osTicket |
| Modern REST completeness | 3.5 | Wide resource map; depth gaps |
| Official API interop | 1.5 | Stub create |
| Security / RBAC | 2.5 | Auth present; permission model not applied; global staff access |
| End-user minimal UI | 4.0 | Usable text portal |
| Staff minimal UI | 2.5 | Config rich; ticket work incomplete |
| Email / channel parity | 1.5 | SES helper only |
| Attachments | 1.0 | Absent |
| Test / CI confidence | 1.5 | Few unit tests, no ticket lifecycle |
| Extensibility (SDK/MCP) | 4.0 | Strong differentiation |

**Overall readiness for production replacement of osTicket FOSS:** **not yet**.  
**Overall readiness as Node API + light portal beside an osTicket DB:** **usable for limited pilots** (web-only, trusted staff, no attachments).

---

## 9. Suggested definition of done (for the stated goals)

### Goal 1 — API feature parity (propose dual DoD)

**A. Official API parity (hard):**

- [ ] `POST /api/tickets.json` creates ticket with API key; returns ticket number; supports core fields + attachments subset  
- [ ] `POST` cron triggers overdue (and later mail) with `can_exec_cron`  
- [ ] Documented mapping of osTicket fields → nodeticket behavior  

**B. Product API parity (practical MVP):**

- [ ] Ticket lifecycle with RBAC and dept scoping  
- [ ] Attachments on create/reply  
- [ ] Outbound notifications  
- [ ] SLA due dates + overdue cron  
- [ ] Staff-on-behalf create  
- [ ] OpenAPI matches live surface  

### Goal 2 — Minimal UI DoD

- [ ] User: register/login, create, view, reply, close/reopen, FAQ, profile — **without console errors**  
- [ ] Staff: queue list, open ticket, reply, internal note, assign, close — **in UI**  
- [ ] Admin: settings, topics, SLA, filters, templates, keys — already largely present  
- [ ] No known CSRF/login blockers  

---

## 10. Key files referenced

| Path | Role |
|------|------|
| `src/app.js` | Express mount, MCP, CSRF HTML |
| `src/routes/tickets.js` | Ticket HTTP surface |
| `src/controllers/ticketController.js` | Adapters; legacy stub; bulk; user update quirk |
| `src/sdk/services/tickets.js` | Ticket business logic |
| `src/middleware/auth.js` | JWT/API key/session; unused `requirePermission`; loose staff access |
| `src/middleware/csrf.js` | Double-submit CSRF |
| `src/lib/email.js` | SES send (unwired to tickets) |
| `src/routes/admin.js` | Staff/admin SSR UI |
| `src/public/js/spa.js` | End-user SPA |
| `src/controllers/systemController.js` | Cron placeholder |
| `docs/TODO.md` / root `TODO.md` | Phase and open bugs |
| `FX.md` | Domain target state |
| `docs/openapi.json` | Partial contract |

---

## 11. Conclusion

Nodeticket has the **right skeleton** for a Node.js osTicket-compatible desk: database interop, SDK, broad REST resources, admin configuration UI, and a credible minimal user portal. Against the two goals:

1. **API parity** — modern REST exceeds official osTicket API *scope*, but **fails** official create interop and still lacks the product features that make a desk real (attachments, email, SLA engine, RBAC, visibility).  
2. **Minimal UI** — **end-user portal is close**; **staff operational UI is the main UI gap**.

Treat the next milestone as **“web-only MVP desk”**: fix legacy create + user reopen, staff ticket actions in UI, permissions/visibility, attachments, and outbound mail — then reassess parity with a live osTicket instance side-by-side.

---

*Generated by Grok project review. Artifact path: `plan/FINDINGS.GROK.md`.*
