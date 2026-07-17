# Nodeticket Master Plan

**Status:** Active  
**Created:** 2026-07-16  
**Baseline revision:** `e7fa1f99` (and subsequent docs commits)  
**Comparison target:** osTicket FOSS **v1.18.4** (pin; expand later only with fixtures)  
**Evidence:** `plan/FINDINGS.CODEX.md` (authoritative security/schema review), `plan/FINDINGS.GROK.md` (product roadmap lens), `docs/TODO.md`, `FX.md`, `docs/SCHEMA.md`

---

## 1. Goals

| # | Goal | Definition of done (summary) |
|---|------|------------------------------|
| **G1** | **Feature parity with osTicket FOSS** | Stock HTTP API (JSON/XML/email create + cron) matches v1.18.4 contracts; native ticket lifecycle, RBAC, dept visibility, attachments, SLA, outbound notifications, and schema-correct writes work against a real bootstrapped MySQL osTicket DB. |
| **G2** | **API & UI updates** | After G1 gates are green: complete native product API (OpenAPI-accurate), operational staff desk UI, hardened customer portal, admin/KB polish, production session/error hardening. |

**Non-goals for the first shippable desk:**

- Full plugin marketplace / PHP plugin binary compatibility  
- LDAP / 2FA / OAuth identity backends (deferred unless required)  
- PostgreSQL as a production dialect (fail-fast or separate funded track)  
- Supporting every historical osTicket schema from v1.8 without version detection  

---

## 2. Strategy and sequencing rules

### 2.1 Why this order

Reviews agree that Nodeticket has the right **skeleton** (SDK layers, broad REST map, admin config SSR, customer SPA, MCP) but is **not safe or interoperable** yet:

1. Auth trust boundaries are broken (purpose JWTs, API keys as admins).  
2. Customer data isolation fails (internal notes/events).  
3. Native ticket writes fail or corrupt current-schema invariants.  
4. Official create/cron paths are stubs or wrong paths.  
5. Staff visibility/RBAC is unenforced; staff ticket detail is read-only.

**Rule:** Do **not** expand staff mutation UI or “feature polish” until **Gates A0–A1** are green. Do not claim official parity until **A2–A3**. Hand off to major UI feature work only after **A0–A4 exit criteria** (Section 8).

### 2.2 Dual parity definitions (do not conflate)

| Track | What it is | Success metric |
|-------|------------|----------------|
| **Exact external API** | Paths, key/IP/capability auth, payloads, status codes, response bodies of stock osTicket | Differential tests vs stock v1.18.4 |
| **Product / native API** | Modern `/api/v1/*` help-desk surface for SPA, admin, MCP, CLI | Behavioral tests + OpenAPI client smoke + RBAC matrix |

### 2.3 Engineering principles

1. **SDK-first** — Business logic in `src/sdk/services/*`; controllers stay thin HTTP adapters (`docs/superpowers/specs/2026-04-03-sdk-extraction-design.md`).  
2. **TDD / red-green** — Write failing HTTP + DB behavioral tests before production fixes. Avoid process/structure-only tests.  
3. **One authorization service** — Same rules for REST, SSR `/admin`, and MCP tools.  
4. **osTicket schema is source of truth** — Non-destructive; prefer stock columns/flags/sequences over inventing Node-only columns.  
5. **MySQL only until proven** — Pin fully bootstrapped **MySQL + osTicket v1.18.4** strict mode as the first fixture.  
6. **Observable DoD** — Every gate ends with a checklist that can be run in CI.

### 2.4 Document map

| Doc | Role |
|-----|------|
| **`plan/PLAN.md`** (this file) | Single ordered execution plan |
| `plan/FINDINGS.CODEX.md` | Stop-ship findings, acceptance tests, gate sketch (security/schema-first) |
| `plan/FINDINGS.GROK.md` | Product scorecard, UI gap analysis, P0–P3 product roadmap |
| `docs/TODO.md` | Phase checklist (P0–P5 historical; treat open P4/P5 as backlog under this plan) |
| Root `TODO.md` | Open bugs (CSRF scope, Windows CLI flags, etc.) |
| `FX.md` | Target domain model / invariants (aspirational; implement against schema + tests) |
| `docs/openapi.json` | Contract seed — regenerate after A4 |

---

## 3. Current state snapshot

### 3.1 What already works (keep)

- Layered **SDK** (`data/` + `services/`) as package `main`  
- Wide **REST** surface under `/api/v1` (auth, tickets, users, staff, depts, teams, orgs, topics, SLA, roles, settings, templates, canned, filters, FAQ read, tasks read)  
- **Admin SSR** config pages (settings, topics, SLA, filters, templates, canned, API keys, bulk list ops)  
- **Customer SPA** skeleton (login/register, list/create/view/reply, FAQ browse)  
- **API key** table integration + admin key UI (flags exist; enforcement wrong)  
- **Filter engine** scaffolding with AND/OR / stop-on-match / reject  
- **MCP** tools (when enabled)  
- CLI package entry  

### 3.2 Stop-ship / parity blockers (from CODEX; must clear early)

| ID | Issue | Impact |
|----|--------|--------|
| **C-01** | Purpose JWTs (reset/verify) accepted as access tokens; unknown principal types fail open | Global data exposure via verify/reset links |
| **C-02** | Any active API key treated as staff/admin; capability flags unused | Create-only keys become superuser |
| **C-03** | Customer thread includes internal notes `N`; events + private identity fields leaked | Privacy breach on shared DB |
| **C-04** | Topic query uses nonexistent `help_topic.isactive` | Native create broken on stock schema |
| **C-05** | Missing required columns (`thread_entry.updated`, event context); non-transactional create; wrong numbering | Strict MySQL fail / orphan tickets |
| **C-06** | `requirePermission` unused; staff global ticket visibility | Any agent sees/mutates all tickets |
| **C-07** | Official JSON create stub; no XML/email; cron wrong path and no-op | Zero official HTTP parity |

### 3.3 High-priority product gaps

- Attachments absent entirely under `src/`  
- Outbound SES not wired to ticket create/reply/auto-response  
- Inbound mail + SLA monitor cron skipped  
- Customer reopen always closes (`status_id` → `close`)  
- Staff ticket detail is read-only (no reply/note/assign/close forms)  
- OpenAPI drifted from runtime  
- Session-authenticated SPA mutations lack CSRF coverage (API mounted before CSRF)  
- Accidental native routes under `/api` (rate-limit bypass)  
- PostgreSQL advertised but not operational  

### 3.4 Test reality

- `npm test` ≈ CLI + password + form-fields only (**45 tests** at last review).  
- **Missing:** HTTP routes, authz middleware, ticket lifecycle, fixture DB, differential official API, browser/a11y.  

---

## 4. Target architecture (end state)

```
                    ┌─────────────────────────────────────────┐
                    │  Clients: SPA | Admin SSR | MCP | CLI   │
                    └────────────────────┬────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
   Official compat API            Native REST /api/v1/*           HTML forms
   /api/tickets.json|.xml|.email  JWT | session | (no raw key     CSRF + session
   /api/tasks/cron                as admin)                            
   X-API-Key + IP + flags only    
          │                              │                              │
          └──────────────────────────────┼──────────────────────────────┘
                                         ▼
                              ┌────────────────────┐
                              │ AuthZ service      │
                              │ principals + perms │
                              │ ticket visibility  │
                              │ field allowlists   │
                              └─────────┬──────────┘
                                        ▼
                              ┌────────────────────┐
                              │ SDK services       │
                              │ tickets, auth, …   │
                              │ transactional ops  │
                              └─────────┬──────────┘
                                        ▼
                              ┌────────────────────┐
                              │ SDK data + pool    │
                              │ MySQL ost_* schema │
                              └────────────────────┘
```

**Key design decisions to implement:**

1. **API keys are not native principals.** Compatibility routes authenticate the *key*, enforce flags, call SDK create/cron; they never set `req.auth.type = 'staff'` with key id.  
2. **JWT `token_use`** (or equivalent claim) separates `access` | `refresh` | `password_reset` | `email_verify` | MCP. Shared secret alone is insufficient.  
3. **Visibility filter** applied in SDK list/get and middleware `canAccessTicket` (dept, extended access, assigned_only, team, referral).  
4. **Customer DTO allowlists** for ticket, thread, collaborators — notes type `N` never leave the staff boundary.  
5. **Single transactional create kernel** used by native create, legacy JSON/XML, and eventually email channel.  
6. **Dedicated compatibility router** mounted at official paths only — remove full native router mount at bare `/api`.

---

## 5. Workstreams and gates

Work is organized as **API/data gates A0–A4**, then **UI gates U0–U4**. Within each gate: tests → implementation → verification.

```
A0 Trust & isolation ──► A1 Schema fixture & writes ──► A2 JSON official API
                              │                              │
                              └──────────────┬───────────────┘
                                             ▼
                                      A3 XML + email + cron
                                             │
                                             ▼
                                      A4 Native product API
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
                   U0 Safe UI contracts     U1 Staff ops slice       U2 Attachments UI
                    │                        │                        │
                    └──────────┬─────────────┴────────────────────────┘
                               ▼
                        U3 Customer hardening
                               │
                               ▼
                        U4 Admin & production
```

Estimated effort is **order-of-magnitude for a focused engineer** (calendar will stretch with fixture/PHP interop and review). Adjust after A1 fixture cost is known.

---

## 6. Gate A0 — Trust boundaries and data isolation

**Objective:** Denied requests fail on the server regardless of UI. No purpose token or API key can become a superuser. Customers cannot see internal notes.

**Estimated effort:** 1–1.5 weeks  

### 6.1 Tasks

| # | Task | Primary files | Notes |
|---|------|---------------|-------|
| A0.1 | Introduce explicit JWT claims: `token_use`, principal `type`, optional `iss`/`aud` | `middleware/auth.js`, `controllers/authController.js`, `routes/html.js` | Reject non-`access` on `authenticate` |
| A0.2 | Fix refresh: accept only refresh credentials; revalidate account active/verified | `authController.js` | No re-signing of purpose tokens |
| A0.3 | Fail closed on unknown principal types in `canAccessTicket` / list filters | `middleware/auth.js`, `ticketController.js` | |
| A0.4 | API-key model: capability-only for official routes; **never** `requireStaff`/`requireAdmin` via bare key | `middleware/auth.js`, route mounts | Map `can_create_tickets` / `can_exec_cron` only |
| A0.5 | Customer thread/event allowlists; strip notes `N`, staff emails, internal events | `sdk/services/tickets.js`, controllers | Pagination counts after filter |
| A0.6 | Deny customer `GET .../events` or map to public timeline only | `routes/tickets.js` | Prefer deny for MVP |
| A0.7 | Staff visibility: primary dept + `staff_dept_access` + `assigned_only` + assignment/team | `auth.js`, ticket list/get, `admin.js` queries | Build shared `authz` helper in SDK or middleware module |
| A0.8 | Wire `requirePermission` on ticket mutations (reply, note, assign, close, delete, transfer, merge) | `routes/tickets.js`, role JSON mapping | Admins bypass; others need role flags |
| A0.9 | Org/dept/profile privacy (H-01) | orgs, depts, users, `html.js` profile | Staff profile must not write customer `user` by staff_id |
| A0.10 | KB disablement + public topic field allowlist | `faq` routes, `topicController`, settings | |
| A0.11 | Named customer close/reopen (do not honor raw `status_id`) | `ticketController.update`, SPA later | Server-side transition policy |
| A0.12 | CSRF for session-authenticated API mutations; SameSite cookies; rate-limit all ticket aliases | `app.js`, `spa.js`, `csrf.js` | Exempt pure bearer/API-key only |
| A0.13 | Remove or restrict dual mount of full ticket router at `/api` | `app.js` | Compat routes only under `/api` |
| A0.14 | Production error hardening (no raw `err.message` leak; escape HTML errors) | `errorHandler.js` | Can start here; finish in U4 |

### 6.2 Acceptance tests (must be red then green)

- [ ] Reset/verify tokens → **401** on ordinary authenticated endpoints  
- [ ] Refresh with purpose token → **401**  
- [ ] Unknown `type` → fail closed  
- [ ] API key without `can_create_tickets` cannot hit native staff routes  
- [ ] API key cannot call `requireAdmin` surfaces  
- [ ] Customer thread has zero type-`N` entries; pagination consistent  
- [ ] Customer cannot read full event stream  
- [ ] Staff A cannot list/get ticket in Staff B’s private dept without access  
- [ ] `assigned_only` staff sees only assigned (+ team) tickets  
- [ ] Role without “reply” cannot `POST .../reply`  
- [ ] Cross-site session POST without CSRF fails; same-site with token succeeds  
- [ ] Public topics omit internal assignment/SLA secrets  

### 6.3 Exit criteria

A0 green when all acceptance tests pass and a short threat-model note is added under `docs/` (or appendix in this plan) describing principal types and key capabilities.

---

## 7. Gate A1 — Real osTicket fixture and schema-correct writes

**Objective:** Native create/reply/note/update/bulk/merge work on a **fully bootstrapped** strict MySQL osTicket **v1.18.4** database with transactional integrity and stock semantics for numbering, topics, forms, events.

**Estimated effort:** 1.5–2.5 weeks  

### 7.1 Fixture infrastructure

| # | Task | Notes |
|---|------|-------|
| A1.1 | Document supported target: **MySQL + osTicket v1.18.4** (replace “v1.8+” claims in README/SCHEMA) | Version detection optional later |
| A1.2 | CI/local fixture: bootstrap stock install SQL + dynamic tables (`ticket__cdata`, forms) | Docker Compose or scripted mysql + ost install |
| A1.3 | Strict SQL mode in fixture (`STRICT_TRANS_TABLES`, etc.) | Surfaces missing columns |
| A1.4 | Optional: stock PHP container for bidirectional interop (Node↔PHP) | High value for A1 exit |

### 7.2 Schema / write kernel

| # | Task | Primary files | Notes |
|---|------|---------------|-------|
| A1.5 | Fix topic active/public selection (`flags` / `ispublic`, not `isactive`) | `sdk/services/tickets.js` | C-04 |
| A1.6 | Include required `thread_entry.updated` and full event context columns | tickets service + bulk | C-05 |
| A1.7 | Transactional ticket create: ticket + cdata + thread + first entry (+ collaborators) | SDK service | Rollback on any step |
| A1.8 | Ticket numbers via `ost_sequence` / topic number format | SDK | Match stock padding/format |
| A1.9 | Apply topic defaults: dept, status, priority, SLA, assignment, autorespond flags | create kernel | Controller currently discards some |
| A1.10 | Filter actions: map only real ticket columns; priority via cdata/form path not fake `priority_id` column | `filterController`, tickets | |
| A1.11 | Fix NULL inserts into required org/staff/dept columns | orgs, staff, depts services | |
| A1.12 | Reply/note/update transactional where multi-write | tickets service | Event log after successful mutation |
| A1.13 | Merge: complete event graph / collaborators semantics | tickets service | Document residual gaps if any |

### 7.3 Acceptance tests

- [ ] Create/reply/note/update/bulk/merge against clean v1.18.4 fixture in strict mode  
- [ ] Failure injection after each create step → **no orphan** ticket/thread rows  
- [ ] Topic inactive/private behavior matches stock flags  
- [ ] Sequence-based ticket number format validated  
- [ ] Bidirectional interop: Node create → PHP view/reply; PHP create → Node read/update (if PHP fixture available)  
- [ ] Dynamic form / cdata write for default install forms  

### 7.4 Exit criteria

A1 green when native ticket lifecycle tests pass on the fixture without schema hacks, and create is a single transaction boundary.

---

## 8. Gate A2 — Official `POST /api/tickets.json` parity

**Objective:** Exact external JSON create compatibility with stock osTicket.

**Estimated effort:** 3–5 days after A1  

### 8.1 Tasks

| # | Task | Notes |
|---|------|-------|
| A2.1 | Dedicated route `POST /api/tickets.json` (not nested under native `/:id` router confusion) | Mount outside dual native mount |
| A2.2 | Auth: active key, IP match, `can_create_tickets` only — **no native principal** | Stock-compatible 401 |
| A2.3 | Parse stock fields: `name`, `email`, `subject`, `message`, `topicId`, `priority`, `source`, `alert`, `autorespond`, `ip`, attachments (RFC 2397), custom form fields, phone/notes | Map to create kernel |
| A2.4 | Create/find user by email; apply filters; topic defaults | Reuse A1 kernel |
| A2.5 | Response: **HTTP 201** with **bare ticket number body** (not JSON envelope) | Match stock |
| A2.6 | Validation / error status codes differential vs stock | Document intentional deltas if any (prefer zero) |
| A2.7 | Attachment subset on create (store in `file` / `file_chunk` or agreed equivalent) | May share A4 attachment module; minimum for stock corpus |

### 8.2 Acceptance tests

- [ ] Differential corpus: same payloads to stock v1.18.4 and Nodeticket; normalize generated IDs; compare outcomes  
- [ ] Wrong key / inactive / wrong IP / missing capability → stock-compatible failure  
- [ ] Valid create → 201 + number; ticket readable in PHP and Node  

### 8.3 Exit criteria

Official JSON column of the parity matrix is **green**.

---

## 9. Gate A3 — Official XML, email MIME, and cron

**Objective:** Complete stock HTTP surface.

**Estimated effort:** 1–2 weeks  

### 9.1 Tasks

| # | Task | Notes |
|---|------|-------|
| A3.1 | `POST /api/tickets.xml` — raw body parser + semantic equivalence to JSON | |
| A3.2 | `POST /api/tickets.email` — MIME parse, new ticket vs reply threading, Message-ID dedup, attachments | Hardest channel |
| A3.3 | `POST /api/tasks/cron` with `can_exec_cron`; body `Completed` on success | Stock path, not only `/api/v1/cron` |
| A3.4 | Implement real cron jobs (minimum viable): TicketMonitor overdue flags; stub remaining jobs with honest status only if disabled by config | MailFetcher may start here or A4 |
| A3.5 | Capability matrix tests for every official endpoint | Create-only vs cron-only keys |

### 9.2 Acceptance tests

- [ ] XML create parity corpus  
- [ ] Email: new message creates ticket; reply to existing threads; duplicate Message-ID ignored  
- [ ] Cron with valid key runs work; wrong capability 401  
- [ ] Full official parity matrix green  

### 9.3 Exit criteria

| Official operation | Status required |
|--------------------|-----------------|
| `POST /api/tickets.json` | Green (A2) |
| `POST /api/tickets.xml` | Green |
| `POST /api/tickets.email` | Green |
| `POST /api/tasks/cron` | Green |

---

## 10. Gate A4 — Native product API completeness

**Objective:** Modern `/api/v1` is a trustworthy product API for UI, MCP, and CLI — attachments, notifications, SLA, tasks write, OpenAPI truth, mount hygiene.

**Estimated effort:** 1.5–2.5 weeks  

### 10.1 Tasks

| # | Task | Notes |
|---|------|-------|
| A4.1 | Attachment API: upload (create/reply), authorized download, thread association | Use osTicket file tables where possible |
| A4.2 | Outbound email: new ticket auto-response, staff alerts, reply notifications via templates + SES (or SMTP config) | Wire `lib/email.js` + templates |
| A4.3 | SLA: set `sla_id` / due dates from topic/plan on create; TicketMonitor marks overdue | Business hours if data present |
| A4.4 | Staff/API create ticket **on behalf of** user (authenticated staff with permission) | Separate from API-key-as-admin anti-pattern |
| A4.5 | Tasks write path: create/update/assign/close + authz | |
| A4.6 | FAQ write API (CRUD) + ratings if schema supports | Feeds U4 admin |
| A4.7 | Safe merge completion; search/pagination contracts documented | |
| A4.8 | Custom form field schema endpoint for public create; server-side validation | |
| A4.9 | OpenAPI regenerated from accepted runtime; generated-client smoke test | Fix path/base mismatches |
| A4.10 | PostgreSQL: **fail fast** in config if dialect=pg (recommended) **or** separate implementation track | Do not advertise broken support |
| A4.11 | Align rate limits, CSRF, session regeneration on login, idle timeout for HTML admin | Partial production hardening |
| A4.12 | MCP tools use same authz helpers (no bypass) | |

### 10.2 Acceptance tests

- [ ] Attachment upload/download permission matrix (owner, staff, deny)  
- [ ] Create/reply triggers expected email (mock transport OK)  
- [ ] Overdue cron flips `isoverdue` when past due  
- [ ] Staff create-on-behalf creates ticket owned by target user  
- [ ] OpenAPI client can call list/create/reply/close against fixture  
- [ ] Setting dialect to postgres fails at startup with clear error (if fail-fast path chosen)  

### 10.3 Exit criteria (API ready for UI expansion)

All of the following:

- [ ] Purpose tokens cannot authenticate as access tokens; API keys are not native admins  
- [ ] Customers cannot retrieve internal notes/events/private identity fields  
- [ ] Staff visibility + role permissions enforced across REST, SSR, MCP  
- [ ] KB disablement + public topic/form schema enforced  
- [ ] Native create/read/reply/update pass on strict v1.18.4 fixture with rollback  
- [ ] Official JSON/XML/email/cron parity matrix green  
- [ ] OpenAPI describes live native API and client smoke passes  
- [ ] Close/reopen named contracts correct  
- [ ] Expanded suite (HTTP + DB + authz) remains green with existing unit tests  

**At this point G1 (feature parity MVP) is substantially complete.** Remaining G2 work is UI depth and production polish.

---

## 11. Gate U0 — UI safety and contract consumption

**Objective:** Customer SPA and staff SSR consume **safe** contracts only; no new mutation surface until U1.

**Estimated effort:** 3–5 days  

### 11.1 Tasks

| # | Task | Notes |
|---|------|-------|
| U0.1 | SPA login: treat non-JSON/error responses correctly (no false success reload) | `spa.js` |
| U0.2 | Render only public thread entries; never show notes as “support responses” | |
| U0.3 | Named close/reopen API usage | Match A0.11 |
| U0.4 | Pagination for tickets, thread, topics, FAQ (full pages, not first 25 only) | |
| U0.5 | Public topic/form schema for create form; honor KB disable setting | |
| U0.6 | Staff queue/detail **read** scoping already server-side (verify UI doesn’t assume global) | No new staff mutations yet |
| U0.7 | CSRF headers on SPA session mutations | Pair with A0.12 |

### 11.2 Exit criteria

- [ ] Customer cannot see notes even if API bug reintroduced (defense in depth in UI)  
- [ ] Login errors visible; reopen works  
- [ ] Pagination reaches page 2+ for tickets/FAQ/topics  

---

## 12. Gate U1 — Staff operational vertical slice

**Objective:** A real help desk: queue + one complete ticket-detail workflow, permission-checked and accessible.

**Estimated effort:** 1–1.5 weeks  

### 12.1 Queue

- Search, status, department, assignee/team, priority, overdue filters  
- Sort + query-preserving pagination  
- Fix `staff=unassigned` vs `staff_id` handler mismatch  
- Bulk ops gated by **permissions**, not only `isadmin`  

### 12.2 Ticket detail (minimum ops)

| Action | UI control | API |
|--------|------------|-----|
| Reply | Form + optional canned insert | `POST .../reply` |
| Internal note | Distinct form/styling | `POST .../note` |
| Assign / team | Selects | `PUT` fields |
| Transfer dept | Select | `PUT` |
| Status / close / reopen | Named actions | close/reopen endpoints or constrained PUT |
| Audit feedback | Flash/banner | events (staff-only) |

Do **not** ship note UI before C-03 / A0.5 is green.

### 12.3 Accessibility (in-slice, not later)

- Keyboard operable controls (no click-only table rows without row action)  
- Visible focus  
- Errors in `aria-live` regions  
- Usable at 360px width  

### 12.4 Exit criteria

- [ ] Agent can triage: open queue → open ticket → reply → note → assign → close without raw API tools  
- [ ] Denied permissions hide or disable controls **and** API returns 403  
- [ ] Dept-scoped agent never sees foreign tickets in UI  

---

## 13. Gate U2 — Attachments and notifications in UI

**Objective:** Visible file + mail behavior for customer and staff.

**Estimated effort:** 3–5 days  

### 13.1 Tasks

- Customer upload on create/reply; display on thread  
- Staff upload/download on detail  
- Size/type validation messaging  
- Notification failure surfaced (e.g. “reply saved; email failed”) without rolling back ticket write unless policy says otherwise  
- Email-created tickets/replies present cleanly in UI (A3)  

### 13.2 Exit criteria

- [x] Customer SPA: attach on create/reply; list + download on ticket detail; notify failure banner  
- [x] Staff admin: attach list/download on detail; reply + standalone upload; notify failure flash  
- [ ] End-to-end attach on create and reply in fixture (manual / HTTP suite expansion)  
- [ ] Unauthorized download denied (covered by API `canAccessTicket`; add fixture assert when convenient)  

---

## 14. Gate U3 — Customer portal hardening

**Objective:** MVP-safe customer experience.

**Estimated effort:** 3–5 days  

### 14.1 Tasks

| Area | Work |
|------|------|
| Account | Discoverable register / verify / reset / profile / logout; single principal model |
| Tickets | Search/filter + complete pagination; newest thread activity; load older |
| Drafts | Preserve draft message across reauth when possible |
| A11y | Keyboard FAQ/headings; live errors; responsive acceptance |
| Session | Align client idle with server; coherent logout |

### 14.2 Exit criteria

- [ ] User stories from FINDINGS.GROK §4.1 all pass browser acceptance without console errors  
- [ ] Automated a11y smoke (axe or equivalent) on login, list, detail, create  

---

## 15. Gate U4 — Administration and production readiness

**Objective:** Finish admin/KB gaps and production session/ops posture.

**Estimated effort:** 1 week  

### 15.1 Admin / config

- FAQ CRUD + search UI (API from A4)  
- Status/priority/forms/channels/saved queues as needed  
- Keep existing P3 config pages; fix authz to match A0  
- Optional: modularize god-router `src/routes/admin.js` (maintainability; not a feature gate)  

### 15.2 Production

- Durable session store (Redis/DB) for multi-instance  
- Login session regeneration; logout + bearer revocation policy documented  
- Safe production errors; pin/vend frontend CDN deps (ygdrassil)  
- Cron deployment docs (external scheduler → official cron endpoint)  
- Browser matrix smoke  

### 15.3 Backlog (explicitly deferred after U4 unless needed)

- Plugins / hooks / webhooks (docs P5)  
- 2FA, LDAP, OAuth  
- Ticket locks, referrals  
- Windows `npm run` CLI flag stripping (root TODO)  
- Full business-hours SLA engine edge cases  

### 15.4 Exit criteria

- [ ] Admin can manage FAQ and core config under RBAC  
- [ ] Production checklist documented in README  
- [ ] CI runs unit + HTTP fixture + (optional) browser smoke  

---

## 16. Testing strategy

### 16.1 Layers

| Layer | What | When |
|-------|------|------|
| Unit | Pure helpers (JWT claims, filter match, number format) | Ongoing |
| HTTP behavioral | Supertest (or equivalent) against app + fixture DB | A0+ |
| DB graph | Assert rows after create/merge/cron | A1+ |
| Differential | Same payload stock PHP vs Node | A2–A3 |
| Authz matrix | Principals × resources × allow/deny | A0, expand A4 |
| Browser | Playwright/Cypress critical paths | U0+ |
| A11y | axe on key pages | U1, U3 |

### 16.2 Fixture policy

1. Prefer **real schema** over mocks for ticket writes.  
2. Seed: admin staff, limited agent, customer user, two depts, topics, roles, API keys (create-only, cron-only, full).  
3. Each test file cleans or uses transactions where possible.  
4. Never require production secrets; SES mocked.

### 16.3 CI minimum (target)

```
npm test                  # unit
npm run test:http         # fixture required
npm run test:parity       # optional job with PHP container
```

Add scripts as gates land; do not block A0 on full parity job.

---

## 17. Suggested PR / milestone breakdown

Prefer small, reviewable PRs that leave `main` green.

| Milestone | Gates | Example PR themes |
|-----------|-------|-------------------|
| **M0** | A0.1–A0.6, A0.11 | JWT token_use; customer allowlists; close/reopen policy |
| **M1** | A0.4, A0.7–A0.10, A0.12–A0.13 | API keys; staff visibility; CSRF/mount hygiene |
| **M2** | A1 | Fixture + transactional create kernel + schema fixes |
| **M3** | A2 | Official JSON create + differential tests |
| **M4** | A3 | XML + email + cron |
| **M5** | A4 | Attachments, mail out, SLA, OpenAPI, tasks write |
| **M6** | U0–U1 | Safe SPA + staff ops slice |
| **M7** | U2–U3 | Attachments UI + customer hardening |
| **M8** | U4 | Admin FAQ + production readiness |

Each PR: tests first when practical; update this plan’s checkboxes or linked issue tracker.

---

## 18. Risk register

| Risk | Mitigation |
|------|------------|
| Fixture/bootstrap cost higher than coding | Invest early in Docker Compose; block A1 until green |
| osTicket schema subtleties (forms, cdata, events) | Prefer reading stock PHP create path; differential tests |
| Scope creep into plugins/LDAP | Keep deferred list explicit; reject mid-gate expansions |
| Admin.js size / merge conflicts | Split by domain only after U1 if pain is high |
| Dual SPA vs SSR confusion | Keep customer SPA + staff SSR; one staff mutation surface |
| Email deliverability | Mock in tests; document SES/SMTP config for ops |
| Shared DB with live PHP osTicket | A1 bidirectional tests; never invent columns |

---

## 19. Ownership of findings reconciliation

When FINDINGS.GROK and FINDINGS.CODEX disagree, **prefer CODEX** for:

- Severity of auth/API-key issues  
- Schema correctness of native create  
- CSRF diagnosis (middleware works; **coverage/mounting** is the bug)  
- Customer UI “MVP-safe” claim (not safe until privacy + reopen fixed)  
- Delivery sequence (A0 before UI expansion)

Prefer **GROK** for:

- Breadth of product roadmap narrative  
- Staff vs customer UI gap framing  
- Scorecard communication to stakeholders  

This PLAN incorporates both: CODEX order, GROK product completeness after A4.

---

## 20. Immediate next actions (start here)

1. **Scaffold HTTP test harness** + empty fixture compose file (even if tests fail).  
2. **A0.1–A0.3** JWT `token_use` + fail-closed principals (highest security ROI).  
3. **A0.5–A0.6** customer note/event isolation.  
4. **A0.4** API-key capability isolation.  
5. **A1.1–A1.2** pin v1.18.4 and bootstrap fixture.  
6. Do not start staff reply UI until A0 staff visibility + note isolation are green.

---

## 21. Success scorecard (revisit after each milestone)

| Dimension | Baseline (reviews) | Target after A4 | Target after U4 |
|-----------|--------------------|-----------------|-----------------|
| Official HTTP API | Fail / ~0% | Full green matrix | Full green |
| Native ticket writes | Blocker / broken schema | Strict fixture green | Green |
| Auth / API keys | Critical fail | Capability-correct | Hardened sessions |
| Customer privacy | High fail | Allowlisted DTOs | UI + API defense |
| Staff RBAC / visibility | Unenforced | Enforced all surfaces | UI matches |
| Attachments | Absent | API green | UI green |
| Email / SLA | Placeholder | Outbound + overdue | UX for failures |
| Customer UI | Not MVP-safe | Safe contracts (U0) | Hardened (U3) |
| Staff UI | Config-rich, ops-thin | — | Operational (U1+) |
| Tests | 45 unit-ish | HTTP+DB+authz suite | + browser/a11y |
| OpenAPI | Drifted | Regenerated + smoke | Maintained |

---

## 22. Appendix — Official parity matrix (tracking)

| Operation | Auth | Nodeticket target | Gate |
|-----------|------|-------------------|------|
| `POST /api/tickets.json` | Key + IP + `can_create_tickets` | 201 bare number; stock fields | A2 |
| `POST /api/tickets.xml` | same | Semantic = JSON | A3 |
| `POST /api/tickets.email` | same | MIME create/reply/dedup | A3 |
| `POST /api/tasks/cron` | Key + IP + `can_exec_cron` | Body `Completed`; real jobs | A3 |

## 23. Appendix — Key file index

| Path | Role in plan |
|------|----------------|
| `src/middleware/auth.js` | A0 JWT, keys, visibility, permissions |
| `src/controllers/authController.js` | Token issuance claims |
| `src/controllers/ticketController.js` | Native + legacy adapters; close/reopen |
| `src/sdk/services/tickets.js` | Create kernel, thread, merge |
| `src/routes/tickets.js` | Route auth chains |
| `src/app.js` | Mounts, CSRF order, rate limits |
| `src/middleware/csrf.js` | Double-submit CSRF |
| `src/lib/email.js` | Outbound transport |
| `src/controllers/systemController.js` | Cron jobs |
| `src/routes/admin.js` | Staff SSR queue/detail |
| `src/public/js/spa.js` | Customer portal |
| `docs/openapi.json` | Contract (regenerate A4) |
| `docs/mysql.sql` / `docs/SCHEMA.md` | Schema reference (pin version) |
| `plan/FINDINGS.CODEX.md` | Evidence & acceptance detail |
| `plan/FINDINGS.GROK.md` | Product gap analysis |

---

## 24. Changelog

| Date | Change |
|------|--------|
| 2026-07-16 | Initial master plan from CODEX + GROK findings and project docs |
| 2026-07-16 | **A0 partially landed in code:** JWT `token_use`, API-key isolation, customer thread/event privacy, staff dept visibility + `requirePermission` on note/merge, named close/reopen, session CSRF on API, legacy `/api` mount limited to `tickets.json`, unit tests + `docker-compose.fixture.yml`. Remaining A0 polish: org/dept profile privacy (A0.9), KB/topic public allowlists (A0.10), production error hardening (A0.14), HTTP integration tests with fixture. |
| 2026-07-16 | **A1 core write kernel landed:** transactional ticket create (ticket+cdata+thread+entry+event); `ost_sequence` numbering + topic `number_format`; topic defaults (dept/staff/team/sla/status) + SLA due dates; `thread_entry.updated` + full `thread_event` context columns; reply/note transactional; org/staff/dept NOT NULL defaults; unit tests `test/sdk.tickets.create-kernel.test.js`; fixture docs `docs/FIXTURE.md`. Remaining A1: scripted v1.18.4 bootstrap + live-DB integration + PHP interop. |
| 2026-07-16 | **A2 official JSON create landed:** `POST /api/tickets.json` gated by `X-API-Key` + `can_create_tickets` (plain-text 401); find/create user by email; filters; create kernel with private topics + optional topicId; RFC2397 attachments to file tables; **HTTP 201 + bare ticket number** body. Helpers in `src/lib/legacyTicketApi.js`. Tests: `test/legacy.ticket-api.test.js`. Remaining A2 polish: live differential corpus vs stock PHP. XML/email/cron → A3. |
| 2026-07-16 | **A3 official surface landed:** `POST /api/tickets.xml` (XML parse → same create kernel); `POST /api/tickets.email` (MIME parse, Message-ID dedup, In-Reply-To/References/subject threading reply, new ticket + mid log); `POST /api/tasks/cron` with `can_exec_cron` → body `Completed` + TicketMonitor overdue update; native `/api/v1/cron` shares jobs. Libs: `legacyTicketXml`, `legacyTicketEmail`, `cron`. Tests: `test/legacy.a3-xml-email-cron.test.js` (91 total). |
| 2026-07-16 | **A4 native product API landed (partial):** PG fail-fast; staff create-on-behalf (`user_id`); attachment list/download/upload + reply attachments; ticket create/reply notification hooks (templates+SES/mock); tasks create/update/close; FAQ staff CRUD; `docs/API-A4.md`. Tests: `test/a4.product-api.test.js` (97 total). Remaining A4: full OpenAPI regen, custom form schema endpoint, merge polish, MCP authz audit, login/CSRF deep triage (deferred). |
| 2026-07-16 | **U0/U1 staff ops UI:** Admin ticket queue (search, status, dept, assignee, unassigned fix, filter-preserving pagination, staff visibility scope); ticket detail ops (reply + canned, internal note, assign/team/dept, close/reopen); SPA ticket list pagination + status filter + keyboard row open. Login triage still deferred. |
| 2026-07-17 | **MySQL fixture + HTTP integration green:** Docker compose MySQL:8 on :3307; `scripts/fixture-bootstrap.js` applies `docs/mysql.sql` + seed (admin/customer/API key); `npm run test:http` — 12/12 pass (login, create/reply/close/reopen, note privacy, tickets.json/xml, cron Completed, purpose JWT isolation). Schema fixes: backtick `mid`, list.configuration no TEXT default. App exports `{ app, start }` for tests. |
| 2026-07-17 | **U2 attachments + notify UI:** Customer SPA file upload on create/reply (RFC2397 data URLs), attachment list + authenticated download, notification failure banners. Staff admin ticket detail: attachment panel, per-entry links, reply attachments, standalone upload form, warn flash when email notify fails (write not rolled back). CSS in `styles.css` / `admin.css`. |

---

*Execute top-down by gate. Update checkboxes and scorecard as milestones land. Prefer fixing trust and schema before shipping more UI surface area.*
