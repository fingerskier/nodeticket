# Nodeticket current review: parity, security, and release readiness

- **Review date:** 2026-07-17
- **Nodeticket revision:** 71cd6f7749ef3d457bf7379b232fb916cf4c676b
- **Comparison target:** osTicket FOSS v1.18.4
- **Test result:** 114 passed, 0 failed, 14 fixture tests skipped

**Verdict:** the project has advanced substantially since the 2026-07-16 review, but it is not release-ready and exact osTicket parity is not proven. The customer and staff interfaces now contain useful end-to-end workflows. The remaining blockers are server-side authorization, attachment privacy and integrity, inbound-email trust, stock dynamic-form/filter/merge semantics, and the absence of a stock PHP/osTicket compatibility oracle.

MCP must remain disabled. When enabled, its OAuth flow permits authorization-code theft, API keys become privileged MCP principals, and MCP ticket tools bypass the visibility and private-note rules used by the REST API.

## Executive summary

The previous report is materially stale in a positive direction:

- Purpose JWTs are rejected by normal REST access-token validation.
- Official JSON, XML, email, and cron paths now exist with API-key capability checks and stock-shaped top-level responses.
- Core ticket creation, reply, and note writes use transactions and current required thread/event columns.
- REST customer thread retrieval filters internal notes, and staff list/detail reads have department and assignment scoping helpers.
- Native attachments, outbound notification hooks, task writes, FAQ administration, locks, optional Redis sessions, a MySQL HTTP fixture, and a much broader customer/staff UI have landed.
- The unit suite grew from 45 to 114 passing tests.

Those gains do not close the release gates:

1. **MCP is unsafe to enable.** OAuth auto-approval plus arbitrary registered redirects enables login CSRF/code theft. MCP also treats API keys as staff/admin and omits core ticket scope and private-note checks.
2. **Authorization is inconsistent across interfaces.** REST checks only a subset of ticket permissions; direct admin POST handlers do not repeat ticket visibility/permission checks; merge authorizes only the source ticket; tasks and MCP remain globally scoped.
3. **Attachments cross trust boundaries.** Customer list/download includes attachments on internal notes, caller-supplied entry IDs are not bound to the authorized ticket, and reply/file writes are not atomic.
4. **Official email reply handling is spoofable.** A subject ticket number can select a ticket, and an unknown sender is attributed to the ticket owner. Nested MIME, reply attachments, and durable deduplication are incomplete.
5. **Shared-database parity remains incomplete.** Dynamic form entries are not written, filter vocabulary differs from stock, merge rewrites the graph using non-stock semantics, and update/bulk events still violate transaction or strict-schema invariants.
6. **The compatibility proof is too weak.** The fixture applies a local osTicket-shaped schema and hand-written seed, not a fully bootstrapped stock v1.18.4 application. CI runs only unit tests, and no PHP differential, generated-client, MCP, browser, or accessibility gate exists.

## Scope and verification limits

This review used:

- Static inspection of runtime routes, middleware, SDK services, MCP, UI, schema, fixture, OpenAPI, production documentation, tests, and planning files.
- Comparison with the stock v1.18.4 [HTTP route table](https://github.com/osTicket/osTicket/blob/v1.18.4/api/http.php), [ticket API](https://github.com/osTicket/osTicket/blob/v1.18.4/include/api.tickets.php), [ticket model and permissions](https://github.com/osTicket/osTicket/blob/v1.18.4/include/class.ticket.php), and [cron implementation](https://github.com/osTicket/osTicket/blob/v1.18.4/include/class.cron.php).
- npm run test:all at the reviewed revision.

The test command discovered 128 tests: 114 passed and 14 HTTP fixture tests skipped because MySQL was unavailable. The skipped state is intentional in test/integration/helpers.js:25-42 and test/integration/http.fixture.test.js:41-47. No stock PHP instance, fully installed osTicket database, generated OpenAPI client, MCP integration harness, or browser runner was available. Claims of exact interoperability therefore remain unverified even where local unit or synthetic-fixture tests are green.

## Readiness scorecard

| Area | Current state | Release assessment |
|---|---|---|
| Native REST API | Broad and functional on happy paths | **Blocked:** mutation RBAC, privacy, identity, and atomicity gaps |
| Official JSON API | Route, key gate, create kernel, bare number response | **Partial:** dynamic fields, priority, flags, message and attachment contract differ |
| Official XML API | Route and custom parser exist | **Partial:** attributes, CDATA, files, and differential behavior unproven |
| Official email API | Route, minimal MIME parser, threading and dedup attempt | **Blocked:** sender authorization, nested MIME, reply files, idempotency |
| Official cron API | Correct path/body; overdue and lock cleanup | **Partial:** most stock work omitted; job failures still return success |
| MySQL/osTicket schema | Core create/reply/note improved | **Blocked:** forms, filters, merge, update/bulk invariants, no PHP round trip |
| Staff RBAC | Read helpers and two permission checks exist | **Blocked:** incomplete across REST, SSR admin, tasks, and MCP |
| Customer privacy | REST thread/event DTO improved | **Blocked:** attachments, MCP, organization/department/profile boundaries |
| MCP | Feature-gated and disabled by default | **Critical fail if enabled** |
| Customer/staff UI | Meaningful operational workflows now exist | **Backend-blocked; browser/a11y unverified** |
| OpenAPI | Broad hand-maintained route catalog | **Not generated-client safe or contract-tested** |
| CI/test oracle | 114 unit tests; optional 14-test fixture | **Insufficient:** fixture job disabled and skips are green |
| Documentation | Production and fixture docs improved | **Drift:** support, dialect, TODO, and completion claims conflict |

## Release-blocking findings

The C prefix means completion/release blocker, not a CVSS score. C-01 is conditional on enabling MCP; the project is safe from that route only while MCP remains disabled.

### C-01 - MCP has an unsafe OAuth and principal boundary

**Evidence**

- Unauthenticated dynamic client registration accepts arbitrary nonempty redirect URIs without scheme, loopback, or trusted-domain restrictions: src/mcp/oauth/register.js:11-27.
- GET /oauth/authorize uses the caller's existing generic authentication, silently approves, makes state optional, and redirects a code without a consent or CSRF confirmation step: src/mcp/oauth/authorize.js:19-50. POST has the same approval model at src/mcp/oauth/authorize.js:57-87.
- The attacker can exchange the victim-bound code with the attacker's PKCE verifier: src/mcp/oauth/token.js:26-51.
- Generic authentication accepts API keys: src/middleware/auth.js:109-145. MCP then explicitly accepts them as administrators/staff/users: src/mcp/tools/admin.js:12-20, src/mcp/tools/staff.js:10-20, and src/mcp/tools/users.js:10-22.
- MCP ticket list/search/detail omit staff_scope; customer include_thread omits publicOnly; update, note, and merge omit the REST authorization helpers: src/mcp/tools/tickets.js:16-45, 62-110, 134-179, 229-400.
- MCP bearer validation checks signature/expiry but not token purpose or principal state, and transport session IDs are not rebound to the current JWT principal: src/mcp/transport.js:35-60, 83-87, 99-121.
- MCP is disabled by default at src/config/index.js:65-70 and mounted only when enabled at src/app.js:206-210. Integration tests explicitly disable it at test/integration/helpers.js:8-20.

**Impact**

A logged-in victim can be induced to authorize an attacker-controlled callback, allowing the attacker to exchange a code for the victim's MCP bearer. Any active osTicket API key can also become an unrestricted MCP administrator. Customer MCP clients can read private notes, while staff MCP clients bypass department, assignment, team/referral, and role scope.

**Required red/green gate**

- Keep MCP disabled in production until this gate is green.
- Restrict or pre-register redirect URIs, require state and user-confirmed authorization, bind code/client/redirect/PKCE/principal, and make codes single-use.
- Reject API-key principals from MCP OAuth and all native MCP tools.
- Validate token_use, allowed principal types, live account state, and session-to-principal binding on every MCP request.
- Apply one ticket visibility/permission service to REST, SSR, and MCP.
- Add behavioral tests for login CSRF, redirect validation, code replay, cross-principal session reuse, API-key escalation, staff scope, and customer-note disclosure.

### C-02 - Ticket visibility and mutation permissions are not consistently enforced

**Evidence**

- REST mounts explicit permissions for internal notes and merge, but not staff create-on-behalf, reply, update, assign, transfer, close/reopen, attachments, or locks: src/routes/tickets.js:40-135.
- Stock osTicket defines distinct create, edit, assign, transfer, merge, reply, close, and delete permissions in its ticket model; the local route layer does not yet enforce the equivalent matrix.
- Admin list/detail GETs apply staff visibility, but the top-level guard only checks session shape and direct reply, attachment, note, update, close, and reopen POST handlers do not repeat visibility or permission checks: src/routes/admin.js:14-28, 607-649, 973-1047, 1053-1071, 1090-1114, 1119-1176.
- Merge authorizes only /tickets/:id. The target ID is accepted later and mutated without target-ticket authorization: src/routes/tickets.js:128-135, src/controllers/ticketController.js:442-459, src/sdk/services/tickets.js:1307-1368.
- Task routes require staff but have no department/assignment/permission scope, and listing begins with a global query: src/routes/tasks.js:12-27 and src/controllers/taskController.js:24-55.
- MCP omits the same visibility and permission checks; see C-01.

**Impact**

A scoped agent can mutate a foreign ticket by posting its ID directly, including merging an authorized source into an unauthorized target. UI hiding does not mitigate the server-side gap. Task and MCP access remain broader than the staff member's osTicket role.

**Required red/green gate**

- Define one operation matrix for view, create, reply, note, edit, assign, transfer, merge, close/reopen, attach, lock, bulk, and task operations.
- Authorize both source and target resources and re-check within the write transaction where practical.
- Cover primary and extended departments, assigned_only, direct assignee, team membership, referral, administrator override, and every role permission.
- Invoke the same service from REST, admin SSR POST handlers, tasks, and MCP.

### C-03 - Attachment authorization, validation, and atomicity are unsafe

**Evidence**

- Ticket owners can list, download, and upload attachments: src/routes/tickets.js:68-90.
- Attachment queries include all thread entry types, including internal N notes: src/sdk/services/tickets.js:1375-1428. The controller's assertion that thread attachments are customer-safe is false: src/controllers/ticketController.js:336-341.
- Upload accepts entry_id, but addAttachments does not verify that the entry belongs to the authorized ticket/thread: src/controllers/ticketController.js:359-366 and src/sdk/services/tickets.js:1450-1476.
- Reply commits before attachments are added in a separate transaction: src/controllers/ticketController.js:276-294. A file failure can return an error after the reply exists, making retries duplicate the message.
- File size/type checks are UI-only at src/public/js/spa.js:78-104 and src/routes/admin.js:860-867. Server storage does not enforce the configured attachment policy and silently skips malformed inputs: src/sdk/services/tickets.js:840-897.

**Impact**

A customer can retrieve files attached to private notes and can link a new file to a guessed entry on another ticket. Failed reply uploads can create partial writes and duplicate retries. Direct API callers bypass UI file limits.

**Required red/green gate**

- Filter attachment list/download through the same publicOnly entry policy as threads.
- Require and verify ticket -> thread -> entry ownership before every file association.
- Make reply plus attachments one transaction or define an idempotent two-phase contract.
- Enforce configured enablement, size, count, content/type, and safe filename rules server-side.
- Test private-note files, foreign entry IDs, deleted/missing blobs, malformed data URLs, oversized files, rollback, and retry idempotency.

### C-04 - Inbound email can inject replies into an existing ticket

**Evidence**

- The email parser derives a ticket number from the subject: src/lib/legacyTicketEmail.js:72-87.
- The controller selects an existing ticket from In-Reply-To/References or the subject number: src/controllers/ticketController.js:691-718.
- If the sender email is unknown, the reply is attributed to replyTicket.user_id and posted as a public response: src/controllers/ticketController.js:720-736.
- Reply attachments are parsed but never passed to the reply/file write: src/controllers/ticketController.js:720-736. New-ticket attachments take a separate path at src/controllers/ticketController.js:748-765.
- Message-ID metadata is recorded after the entry and all insertion failures are swallowed: src/controllers/ticketController.js:637-651, 738-765. The local mid index is not unique: docs/mysql.sql:400-409.
- The MIME parser handles only a shallow multipart shape: src/lib/legacyTicketEmail.js:19-60.

**Impact**

Anyone who knows or guesses a ticket number or reply Message-ID can send mail that is attributed to the ticket owner. Nested MIME can lose the message body, reply files are dropped, and a metadata failure or race permits duplicate processing.

**Required red/green gate**

- Match stock thread-header lookup and sender/collaborator authorization; never substitute the owner for an unknown sender.
- Use a mature MIME parser with nested multipart/alternative and multipart/mixed coverage.
- Persist Message-ID claim, entry, and files atomically with a uniqueness/idempotency constraint.
- Add exact official nested-MIME examples plus spoofed sender, collaborator, duplicate, race, attachment, bounce, and malformed-mail tests.

### C-05 - Shared-database lifecycle semantics remain non-stock

#### Dynamic forms

Stock ticket creation validates and saves dynamic form answers. Nodeticket reduces official input to a fixed object at src/lib/legacyTicketApi.js:12-72 and writes only ticket__cdata(ticket_id, subject) at src/sdk/services/tickets.js:758-766. It never creates form_entry/form_entry_values for ticket answers. Topic detail returns only form headers, not field definitions or validation configuration: src/controllers/topicController.js:113-159; the topic router has no field-schema endpoint at src/routes/topics.js:11-15.

Configured required/custom fields, phone, notes, priority, and topic-specific answers are therefore ignored or absent from stock's canonical data model.

#### Filters

Local filters store and interpret set_dept, set_priority, set_sla, set_status, assign_staff, assign_team, set_topic, and reject: src/controllers/filterController.js:8-10, 112-119, 223-286. Stock uses different action names/config keys and different case/regex matching semantics. Native create also applies filter results after the create transaction through an independent UPDATE, and its allowlist drops priority: src/controllers/ticketController.js:131-164.

Filters authored by stock PHP and Nodeticket are not mutually reliable; a post-create filter failure can leave a ticket despite a failed HTTP request.

#### Merge

Local merge physically moves thread entries and collaborators, closes the source, and logs events: src/sdk/services/tickets.js:1307-1368. It does not model stock parent/child ticket_pid, merge flags, thread parent metadata, child-owner collaboration, referrals, task movement, or complete last-message/response state. Authorization also omits the target ticket as described in C-02.

#### Update and bulk

Update logs close/assign/transfer events before the final ticket UPDATE and outside one transaction: src/sdk/services/tickets.js:923-1053. Nullable staff/team/SLA values can write NULL to stock NOT NULL columns. Bulk audit insertion omits required event context columns: src/controllers/ticketController.js:853-873 versus docs/mysql.sql:420-434.

**Required red/green gate**

- Build a topic-aware public/staff form schema and validate answers against it.
- Write form_entry, form_entry_values, and cdata projection inside the ticket transaction.
- Adopt stock filter action vocabulary/configuration and matching behavior, with reject/routing inside the create transaction.
- Disable or label merge experimental until its stock representation, target authorization, row locking, tasks, referrals, participants, and derived state are compatible.
- Put update/bulk state and full event context in one lifecycle transaction, using stock sentinel values and event names.
- Prove Node create -> PHP view/edit/reply and PHP create -> Node view/update with custom forms, filters, assignment, and merge cases.

### C-06 - Identity, privacy, and account-state boundaries remain open

**Evidence**

- Any authenticated principal can retrieve organization detail and member lists, including emails/internal metadata: src/routes/organizations.js:14-18 and src/sdk/services/organizations.js:89-138, 153-178.
- /users/:id/organizations has no self check: src/routes/users.js:36-37 and src/controllers/userController.js:47-51.
- Department detail has no public/staff visibility rule and returns private signature, manager email, SLA, and counts: src/routes/departments.js:11-15 and src/sdk/services/departments.js:99-153.
- /users/me/profile accepts generic authentication and updates the user table with req.auth.id; an API-key or staff numeric ID can collide with a customer ID: src/routes/users.js:11-24 and src/controllers/userController.js:81-109. HTML /profile has the same principal confusion: src/routes/html.js:603-674.
- Customer login and refresh do not consistently reject inactive account state: src/sdk/services/auth.js:83-90, src/routes/html.js:246-251, and src/controllers/authController.js:198-224.
- Bearer/session validation trusts cached claims and does not revalidate account state, role, permissions, organization, or department scope: src/middleware/auth.js:22-34, 78-103. Admin SSR also trusts the cached session snapshot: src/routes/admin.js:14-28.
- Default JWT/session lifetimes are up to 24 hours, and logout destroys only the browser session: src/config/index.js:30-41 and src/controllers/authController.js:126-158.

**Impact**

Authenticated users can cross organization/department privacy boundaries. Staff and API-key identities can edit a customer row through numeric-ID collision. Disabled accounts and removed privileges can remain usable until cached credentials expire.

**Required red/green gate**

- Use explicit user-only, staff-only, admin-only, and official-key-only guards; never infer identity from a numeric ID alone.
- Define self, organization-member/manager, public-department, and scoped-staff response allowlists.
- Reject inactive accounts at login and refresh, and define bounded revalidation/revocation for sessions, access tokens, refresh credentials, role changes, and logout.
- Test colliding IDs across every principal type and immediate disable/role/scope changes.

### C-07 - The test fixture is not a stock compatibility oracle

**Evidence**

- The fixture describes itself as osTicket-shaped and applies docs/mysql.sql plus a project-specific extra schema: docs/FIXTURE.md:3-15.
- Bootstrap reads those local files and hand-seeds a minimal set of statuses, one department/admin/user/topic/key, and ticket__cdata: scripts/fixture-bootstrap.js:29-31, 73-195, 219-237.
- It does not run a pinned stock installer/post-bootstrap process or seed custom forms, extended departments, roles, teams/referrals, filters, mail configuration, or PHP behavior.
- HTTP coverage exercises happy-path auth, native lifecycle, note privacy, JSON/XML/cron, and attachment round trips, but not email HTTP, forms, filters, update, bulk, merge, failure injection, or PHP interoperability: test/integration/http.fixture.test.js:49-385.
- npm test excludes integration tests by script definition; npm run test:all treats fixture unavailability as 14 skips and exit 0: package.json:13-19.
- CI runs npm test only. The MySQL fixture job is fully commented out: .github/workflows/ci.yml:1-16, 18-54.

**Impact**

Green tests prove that a tailored MySQL 8 subset accepts the local happy paths. They do not prove that stock v1.18.4 can read, edit, reply to, merge, or administer the written graph, nor that Nodeticket behaves like stock on the official API corpus.

**Required red/green gate**

- Bootstrap a pinned stock v1.18.4 installation, including generated forms/cdata/configuration, and keep the local simulator only as a fast lower-level fixture if useful.
- Add bidirectional Node/PHP tests, strict SQL mode, failure injection, RBAC matrices, MCP tests, and an official JSON/XML/email/cron differential corpus.
- Make fixture unavailability a visible CI failure for required jobs; do not count skips as parity green.

## High-priority findings

### H-01 - Official JSON/XML behavior is only partially compatible

- alert and autorespond are parsed but not applied: src/lib/legacyTicketApi.js:69-70 and src/controllers/ticketController.js:480-496.
- Fixed parsing drops dynamic fields; priority and several stock options are not persisted.
- Stock JSON attachment objects use filename-to-data-URL mappings, while local tests/OpenAPI specify name/data objects: test/legacy.ticket-api.test.js:65-76, 188-203 and docs/openapi.json:6620-6643, 6783-6826.
- Stock supports RFC2397 message bodies; local code treats the string as literal message content.
- XML parsing discards root attributes, assumes base64 for plain file content, and does not correctly advance through CDATA: src/lib/legacyTicketXml.js:38-76, 117-169.

Build a differential corpus from stock setup/doc/api examples, including dynamic fields, unexpected fields, notification flags, data-URL bodies/files, root attributes, CDATA, validation errors, and exact status/body behavior.

### H-02 - Cron and SLA behavior are much narrower than stock

The official endpoint and literal Completed response exist, but the runner only marks past explicit duedate values overdue and cleans locks: src/lib/cron.js:11-86. Mail fetching and session cleanup are explicit skips at src/lib/cron.js:88-98, and stock draft/log/reset/orphan/plugin work is absent. The overdue query ignores stock est_duedate/SLA scheduling. Per-job errors become result objects, while the official controller still returns success: src/controllers/ticketController.js:776-785.

Document the supported subset until the remaining jobs are implemented. Required jobs must fail observably, and SLA tests must cover schedules, grace periods, holidays/business hours, est_duedate, reopen, transfer, and overdue transitions.

### H-03 - Knowledge-base/topic public contracts ignore configuration

- Public FAQ routes do not consult enable_kb: src/routes/faq.js:11-27. The SPA always shows/fetches knowledge-base content: src/public/js/spa.js:282-291, 1047-1127, 1386-1416.
- Public FAQ detail includes internal notes: src/controllers/faqController.js:149-160.
- Public topic detail exposes operational fields such as notes, SLA, numbering, department, and default staff/team assignment: src/controllers/topicController.js:113-159.
- Topic detail exposes form headers but not fields, and customer create submits only topic, subject, and message: src/public/js/spa.js:947-984, 1263-1268.
- Topic and FAQ views consume only the first API page; FAQ search filters that partial set client-side: src/public/js/spa.js:1022-1042, 1072-1118.

Enforce enable_kb server-side and in navigation, publish explicit FAQ/topic allowlists, deliver the accepted dynamic form schema, and make pagination/search server-complete.

### H-04 - OpenAPI is a route inventory, not a proven client contract

- The generator explicitly calls itself a hand-maintained route catalog: scripts/generate-openapi.js:1-9.
- Two global servers, /api/v1 and /, apply to a path set that mixes native /tickets and official /api/tickets.json. A normal client misroutes one family: docs/openapi.json:15-23, 6096-6185.
- csrfHeader is declared but unused by operations, even though session mutations require it: scripts/generate-openapi.js:1380-1384.
- /auth/refresh documents no required token body, and legacy fields/attachments/responses diverge from runtime.
- Generation embeds a timestamp and is not checked for a clean diff: scripts/generate-openapi.js:2104-2114.
- Contract tests assert selected path/security presence only: test/openapi.contract.test.js:9-46.

Use a single root server with full paths or correct per-operation servers, model conditional cookie-plus-CSRF security, validate requests/responses against the live app, regenerate deterministically in CI, and smoke-test a generated client.

### H-05 - CSRF, throttling, proxy, and production email assumptions need hardening

- apiSessionCsrf skips validation when a bearer/API-key header merely exists, before that credential is validated; authenticate can then fall back to the session: src/app.js:125-148 and src/middleware/auth.js:109-129.
- API authentication receives only the generic 100-per-15-minute limiter, while HTML login/reset routes are outside it: src/config/index.js:44-50, src/app.js:113-148, src/routes/html.js:176-331.
- trust proxy is unconditionally one hop while rate limiting and API-key IP checks rely on req.ip: src/app.js:46-47 and src/middleware/auth.js:52-61.
- Admin SSR does not enforce the API session idle check: src/routes/admin.js:14-28 versus src/middleware/auth.js:81-103.
- Without AWS credentials, email falls back to a mock that logs recipient, subject, and full HTML while reporting success: src/lib/email.js:28-36 and src/lib/ticketNotifications.js:54-91.

Exempt CSRF only after a non-session credential is successfully authenticated, add dedicated login/reset throttles, make trusted proxies explicit deployment configuration, apply one idle/revocation policy, and fail closed for production email unless an explicit mock mode is enabled.

### H-06 - Documentation and completion state have drifted

- README.md:3 and docs/SCHEMA.md:3-10 still claim osTicket v1.8+ interoperability, while the plan correctly pins v1.18.4.
- docs/sdk.md:54-56, 667, 682 advertises PostgreSQL although runtime now fails fast at src/config/index.js:79-86 and src/sdk/connection.js:54-59.
- TODO.md:9-10 and docs/TODO.md:41-56 leave implemented FAQ, attachment, notification, canned-response, and cron work unchecked or conflate it with still-missing features.
- plan/PLAN.md retains the old 45-test baseline and many unchecked acceptance/immediate-action items despite a detailed changelog: plan/PLAN.md:110-111, 218-229, 660-667, 725-743.
- Browser/a11y verification is explicitly deferred and no browser script/dependency exists: plan/PLAN.md:508-509, 565-582 and package.json:9-20.
- Example production secrets are recognizable placeholders that are not among the defaults rejected by production validation: .env.example:25, 32, 45 and src/config/index.js:88-97.

Reconcile support claims, configuration examples, TODOs, and gate checklists only after the relevant behavioral tests are green. Replace known example secrets with empty required values and validate strength/placeholder patterns in production.

## Prior review disposition

| Prior finding | Current disposition |
|---|---|
| C-01 purpose JWT crossover | **Resolved for normal REST access tokens.** Reopened as a distinct MCP token/principal problem in current C-01. |
| C-02 API key becomes native administrator | **Partial.** Official REST capability gates improved; generic profile auth and MCP still accept/escalate API-key principals. |
| C-03 customer notes/events/identity disclosure | **Partial.** REST thread/event privacy improved; MCP thread and note attachments remain unsafe; public DTOs should become allowlists. |
| C-04 invalid help_topic.isactive query | **Resolved.** Topic selection uses flags/ispublic at src/sdk/services/tickets.js:643-658. |
| C-05 schema and transaction failures | **Partial.** Core create/reply/note are materially improved; forms, filters, merge, update/bulk, reply files, and stock interop remain open. |
| C-06 staff RBAC and visibility | **Partial.** Read scoping and note/merge checks landed; mutation coverage across REST/admin/tasks/MCP remains incomplete. |
| C-07 official API parity effectively zero | **Superseded.** All four routes now exist, but exact behavior is not proven and material JSON/XML/email/cron gaps remain. |
| H-01 organization/department/profile boundaries | **Open.** |
| H-02 CSRF/rate limiting | **Partial.** Baseline session CSRF exists; header exemption, OAuth login CSRF, HTML throttling, and proxy assumptions remain. |
| H-03 ticket lifecycle/operations | **Partial.** Attachments, notifications, tasks, UI mutations, and locks landed; merge, files, email, SLA, and atomicity remain. |
| H-04 OpenAPI/support claims | **Partial.** Coverage is broad, but base paths, schemas, conditional security, client proof, and support claims drift. |
| H-05 PostgreSQL advertised but broken | **Runtime resolved.** The app fails fast; documentation/config/dependency surface is stale. |
| H-06 production session/error handling | **Partial.** Error and optional Redis work landed; revocation, admin idle, email fail-closed, and secrets remain. |
| H-07 public KB/topic contract | **Open.** |

## UI assessment

The UI is no longer the thin/read-only surface described by the previous report. Source inspection confirms meaningful progress:

| Surface | Progress verified | Remaining release gate |
|---|---|---|
| Customer portal | Discoverable account flows, search/status/pagination, newest thread plus load older, draft persistence, close/reopen, attachments, notification feedback, skip link/live errors | Backend privacy and identity fixes; KB/forms; full pagination; browser/a11y proof |
| Staff desk | Scoped queue GET, search/filter/pagination, detail thread, reply/canned response, note, assign/transfer, close/reopen, attachments, soft-lock feedback | Server-side permission checks on every POST; target/resource scope; attachment fix; browser proof |
| Administration | Broad configuration plus FAQ CRUD/search, production error handling, optional Redis | Role-policy consistency, dashboard data scope, docs/config truth, operational validation |

Representative UI evidence is at src/public/js/spa.js:204-227, 475-594, 656-855, 947-1127 and src/routes/admin.js:359-597, 607-941, 971-1176, 2668-2810.

Do not remove or hide the new UI. Fix the shared server boundaries first, then use browser tests to verify the workflows already present.

## Revised red/green delivery plan

### P0 - Contain and repair the trust boundary

1. Keep MCP disabled and add a production assertion/documented warning.
2. Write failing MCP tests for redirect/code theft, API-key escalation, token purpose, cross-principal transport sessions, staff scope, and customer notes.
3. Repair OAuth and MCP principal/session validation.
4. Introduce one operation-aware ticket authorization service and call it from REST, admin POST handlers, tasks, and MCP.
5. Add source-and-target authorization for merge and every relationship mutation.

**Exit:** denied requests fail server-side across every interface, independent of UI controls.

### P1 - Close customer privacy and write-integrity gaps

1. Add failing tests for note attachments, foreign entry IDs, organization/department/profile access, colliding principal IDs, and account/role revocation.
2. Make attachment read/write policy entry-aware and transactional with replies.
3. Split principal-specific profile routes and define public/self/staff DTO allowlists.
4. Enforce live account state and bounded credential revocation.
5. Fix CSRF credential selection, auth/reset throttles, proxy configuration, production email mode, and server-side file limits.

**Exit:** customers cannot retrieve or mutate internal/foreign records, and stale/disabled principals lose access within the documented bound.

### P2 - Make shared-database writes stock-compatible

1. Bootstrap an actual pinned v1.18.4 installation and add strict-mode PHP/Node round trips.
2. Implement topic/form field schema, validation, form_entry/value persistence, and cdata projection in one create transaction.
3. Match stock filter action/config/matching semantics and move filter effects inside creation.
4. Refactor update/bulk into one lifecycle/event transaction.
5. Either implement stock merge representation and side effects or disable/label merge experimental.

**Exit:** stock PHP can view/edit/reply to Node-created records and Nodeticket can safely operate on PHP-created records across custom forms, filters, lifecycle, and merge cases.

### P3 - Prove the official HTTP contract

1. Create a stock-derived JSON/XML corpus and differential runner.
2. Fix dynamic fields, message/file encodings, priority/options, notification flags, XML attributes/CDATA, validation, and exact responses.
3. Replace minimal MIME handling and add authorized, atomic, idempotent email reply processing.
4. Define and implement the intended cron scope; cover job effects, SLA est_duedate/schedules, and error behavior.
5. Exercise create-only, cron-only, inactive, wrong-IP, and wrong-capability keys on every official route.

**Exit:** normalized stock and Nodeticket results match for the accepted v1.18.4 corpus.

### P4 - Turn contracts into required delivery gates

1. Fix OpenAPI servers, security, payloads, and responses; generate deterministically.
2. Validate live requests/responses and run a generated-client smoke test.
3. Enable required MySQL/stock fixture jobs in CI; fail on unavailable required infrastructure.
4. Add Chromium customer/staff smoke tests and focused accessibility checks.
5. Reconcile README, SCHEMA, SDK docs, TODOs, PLAN checkboxes, and production examples with the proven support matrix.

**Exit:** CI makes schema, parity, authorization, client-contract, and critical browser regressions visible before merge.

## Release exit criteria

Do not call the project release-ready or osTicket-compatible until all are true:

- MCP is either disabled as unsupported or passes its OAuth, token, principal, session-binding, privacy, and RBAC tests.
- Every ticket/task mutation enforces the accepted role permission and resource scope across REST, admin SSR, and MCP.
- Customers cannot access internal-note attachments, foreign entries, private organization/department data, or another principal's profile.
- Account disablement and authorization changes revoke or revalidate access within a documented bound.
- Dynamic forms, filters, lifecycle events, and merge behavior pass strict stock-database and bidirectional PHP tests.
- JSON, XML, email, and cron pass the accepted differential v1.18.4 corpus.
- OpenAPI can drive a generated client against the live fixture.
- Required fixture jobs run in CI without green-by-skip behavior.
- Customer and staff critical paths pass browser smoke and targeted accessibility checks.
- Support/version/dialect claims match the tested matrix.

## Recommended first implementation slice

Start with **P0 trust boundary and authorization**, using red tests before production changes:

1. Reject API-key principals from MCP OAuth/tools.
2. Reproduce and close arbitrary-redirect authorization-code theft.
3. Centralize ticket operation authorization.
4. Apply it to admin POST handlers and MCP.
5. Add customer private-note and attachment regressions.

That slice removes the highest-impact exploit paths and creates the shared authorization seam needed by the remaining work.
