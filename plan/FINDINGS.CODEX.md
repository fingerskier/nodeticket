# Nodeticket review: osTicket API parity and MVP UI readiness

- **Review date:** 2026-07-16
- **Nodeticket revision:** `e7fa1f99e7b301c629af69136580a0d09a2964df`
- **Comparison baseline:** osTicket FOSS v1.18.4, commit `8d38b06`
**Verdict:** stop before adding MVP UI features. Repair the authentication boundary, customer/staff data isolation, and current-schema ticket writes; then implement and prove the official API contract.

## Executive summary

Nodeticket is not currently compatible with osTicket's official HTTP API, and its native REST API is not a safe foundation for an MVP UI.

The official osTicket API is intentionally small. Current v1.18.4 exposes ticket creation through JSON, XML, and MIME email plus a cron task endpoint. This review therefore separates two targets that should not be conflated:

1. **Exact external API parity:** the paths, authentication, payloads, behavior, and responses provided by stock osTicket.
2. **Product API readiness:** the broader ticket, account, staff, and administration behavior needed by Nodeticket's customer and staff interfaces.

The immediate blockers are functional and security defects, not missing polish:

- Password-reset and email-verification JWTs are accepted as ordinary bearer credentials. A verification token has no principal type, and unknown types fail open through ticket access checks.
- Every active osTicket API key bypasses staff, administrator, and role-permission checks, regardless of its `can_create_tickets` or `can_exec_cron` flags.
- Customer thread retrieval includes internal notes and internal identity metadata.
- Native ticket creation queries a nonexistent `help_topic.isactive` column on the current osTicket schema.
- Ticket creation, reply, note, and event writes omit required current-schema columns. Ticket creation is not transactional, so a late failure can leave partial records.
- The only official-format JSON route is a deliberate 400 stub. XML and email routes do not exist. Cron is exposed at the wrong path and skips all work.
- Staff ticket visibility is global in both REST and the server-rendered admin interface; `requirePermission` has no route call sites.

The existing test suite passes **45/45**, but it covers CLI behavior, password handling, and user form fields only. It does not exercise HTTP routes, authentication middleware, tickets, a real osTicket database, cron, RBAC, or browser workflows. The green suite does not reduce the risk of the findings below.

## Scope and evidence

The review used:

- Static inspection of application, SDK, route, middleware, UI, schema, OpenAPI, and planning files.
- Behavioral probes of JWT purpose-token handling, API-key authorization, and the CSRF middleware in isolation.
- Comparison with the current official [osTicket v1.18.4 release](https://github.com/osTicket/osTicket/releases/tag/v1.18.4), [HTTP route table](https://github.com/osTicket/osTicket/blob/v1.18.4/api/http.php), [ticket API implementation](https://github.com/osTicket/osTicket/blob/v1.18.4/include/api.tickets.php), [cron implementation](https://github.com/osTicket/osTicket/blob/v1.18.4/include/api.cron.php), [ticket creation path](https://github.com/osTicket/osTicket/blob/v1.18.4/include/class.ticket.php), and [install schema](https://github.com/osTicket/osTicket/blob/v1.18.4/setup/inc/streams/core/install-mysql.sql).
- `npm test` on the reviewed branch.

No live stock-PHP/osTicket instance or fully bootstrapped MySQL fixture was available. Schema incompatibilities are direct comparisons against required columns and should be converted into real-database red tests before implementation. UI findings are source-level; browser and accessibility acceptance tests remain to be added.

## Readiness scorecard

| Area | Status | Reason |
|---|---|---|
| Official JSON ticket API | **Fail** | `/api/tickets.json` always returns 400; auth and response contracts are absent. |
| Official XML ticket API | **Missing** | No route or raw XML parser. |
| Official email ticket API | **Missing** | No MIME parser, reply threading, deduplication, or attachment path. |
| Official cron API | **Fail** | Wrong path and all jobs are reported as skipped. |
| API-key trust boundary | **Critical fail** | Any active key becomes a native administrator. |
| Native ticket writes | **Blocker** | Invalid topic query plus current-schema and transaction defects. |
| Customer data isolation | **High / blocker** | Internal notes, private fields, and events are returned to ticket owners. |
| Staff RBAC/visibility | **High / blocker** | All staff can reach global ticket/task data; permissions are not routed. |
| OpenAPI | **Fail** | Paths, payloads, fields, and response envelopes differ from runtime behavior. |
| Customer UI | **Not MVP-safe** | Privacy, login, reopen, pagination, attachment, and accessibility gaps. |
| Staff UI | **Not operational** | Read-only detail and inadequate/global queues. |
| Admin UI | **Partial** | Broad configuration exists, but authorization and several workflows are incomplete. |

## Stop-ship findings

The `C` prefix below means **completion/release blocker**, not a CVSS severity. C-01 and C-02 are critical security issues; the remaining entries combine high-severity privacy/authorization defects with functional or data-integrity blockers.

### C-01 — Purpose JWTs authenticate as access tokens and unknown principals fail open

**Evidence**

- `src/middleware/auth.js:14-26` verifies any JWT signed with the shared secret and returns its payload without checking issuer, audience, token use, or allowed principal type.
- Password-reset tokens use that same secret and contain a normal `staff` or `user` type: `src/controllers/authController.js:152-156` and `src/routes/html.js:322-326`.
- Email-verification tokens contain an ID and purpose but no principal type: `src/controllers/authController.js:258-262`.
- `authenticate` accepts any truthy decoded object: `src/middleware/auth.js:73-103`.
- Ticket listing restricts only principals whose type is exactly `user`: `src/controllers/ticketController.js:13-23`.
- `canAccessTicket` handles staff/API keys and users, then falls through for any unknown type: `src/middleware/auth.js:199-240`.
- Refresh accepts expired access or purpose tokens for seven days and re-signs their payload without checking account state or token use: `src/controllers/authController.js:89-104`.

**Impact**

A user's verification link can be used as bearer authentication to list and read global tickets, close arbitrary tickets, and attempt arbitrary replies. A staff password-reset link is immediately a staff API credential. Purpose tokens can also be refreshed into new bearer tokens. This trust-boundary defect applies to every protected surface that delegates to the same middleware.

**Required acceptance tests**

- Reset and verification tokens receive 401 from ordinary authenticated endpoints.
- Missing, unknown, or malformed principal types fail closed on every protected endpoint. Optional/public endpoints define whether an invalid bearer is rejected or ignored, but never elevate it to a principal.
- Access, refresh, reset, verification, and MCP tokens have explicit and distinct `token_use`, issuer, audience, and key/secret validation.
- Refresh revalidates principal status and accepts only a refresh credential; logout/revocation behavior is explicit.

### C-02 — Any active osTicket API key becomes a global native administrator

**Evidence**

- Key lookup loads the two osTicket capability flags: `src/middleware/auth.js:32-63`.
- `requireStaff` accepts every API key as staff: `src/middleware/auth.js:134-149`.
- `requireAdmin` accepts every API key as an administrator: `src/middleware/auth.js:154-169`.
- `requirePermission` explicitly bypasses permissions for API keys: `src/middleware/auth.js:174-194`.
- `canAccessTicket` grants every API key global ticket access: `src/middleware/auth.js:199-209`.
- `can_create_tickets` is not enforced by a route. Native create rejects keys because it accepts only users: `src/controllers/ticketController.js:53-59`.
- API-key record IDs can be passed into reply/note code as though they were `staff_id` values: `src/controllers/ticketController.js:165-196`.

**Impact**

A disabled-capability, create-only, or cron-only key can reach native administrator mutations and global data. The numeric API-key ID can also corrupt staff attribution. This is substantially broader than stock osTicket's API-key contract.

**Required acceptance tests**

- A key without the required compatibility capability receives stock-compatible HTTP 401 from create/cron. It cannot authenticate to any protected native route; native staff/admin routes reject API keys without constructing a staff principal.
- A create-only key can call only the official create endpoints.
- A cron-only key can call only official cron.
- Neither key can call native staff/admin endpoints or be persisted as a staff identity.
- Active state and exact source-IP restrictions are enforced independently for each capability.

### C-03 — Customer APIs disclose internal notes, events, and identity data

**Evidence**

- Internal notes are stored as thread-entry type `N`: `src/controllers/ticketController.js:186-198` and `src/sdk/services/tickets.js:739-758`.
- Customer thread retrieval supplies no visibility context to the SDK: `src/controllers/ticketController.js:37-39`.
- The thread query selects every entry type and joins staff and customer email fields: `src/sdk/services/tickets.js:351-385`.
- Pagination totals also count every entry type: `src/sdk/services/tickets.js:377-384`.
- Ticket owners may call the event-history endpoint, which returns the internal audit stream: `src/routes/tickets.js:24-25` and `src/controllers/ticketController.js:43-48`.
- Ticket detail returns assigned-staff email and raw collaborator identities to the customer: `src/sdk/services/tickets.js:126-164` and `326-335`.
- The SPA renders every non-message entry as a support response rather than treating notes as private: `src/public/js/spa.js:425-435`.

**Impact**

Any internal note already present in the shared osTicket database can be read by the customer who owns the ticket. Internal staff/customer email fields and operational event details also cross the public boundary. Local note creation currently has separate schema defects, but that does not mitigate disclosure of records created by stock osTicket or other writers.

**Required acceptance tests**

- A customer receives only explicit public-field allowlists for ticket detail, collaborators, thread entries, and timelines.
- Customer pagination counts and page boundaries apply after the same visibility filter.
- Customer event access is removed or mapped to a safe public timeline.
- Staff notes remain visible to authorized staff and are visually distinct in the staff UI.

### C-04 — Native ticket creation cannot run against the current standard schema

**Evidence**

- `src/sdk/services/tickets.js:452-458` filters `help_topic` on `ht.isactive = 1`.
- Neither `docs/mysql.sql:584-612` nor the official v1.18.4 `help_topic` table has that column; current osTicket represents relevant state through `flags` and `ispublic`.

**Impact**

`POST /api/v1/tickets` should fail with an unknown-column error before any insert on a standard v1.18.x database. Customer ticket creation is therefore not a usable MVP workflow.

**Required acceptance tests**

- Native and compatibility ticket creation run against a fully bootstrapped v1.18.4 MySQL database in strict mode.
- Active/public topic selection follows the official flag semantics, including inactive and private topics.
- The selected topic's department, status, priority, SLA, assignment, numbering, and autoresponse defaults are verified behaviorally.

### C-05 — Core writes violate osTicket schema and transaction invariants

**Evidence**

- Current osTicket requires `thread_entry.updated`; create, reply, and note inserts omit it: `src/sdk/services/tickets.js:503-507`, `688-692`, and `748-752`.
- Current osTicket requires event context including department, topic, and team IDs. Normal and bulk event inserts omit it: `src/sdk/services/tickets.js:62-75` and `src/controllers/ticketController.js:291-310`.
- Ticket creation writes ticket, dynamic cdata, thread, and first entry sequentially without a transaction: `src/sdk/services/tickets.js:479-507`.
- The generated ticket number is timestamp/random data rather than the configured osTicket sequence and number format: `src/sdk/services/tickets.js:28-36` and `464`.
- Topic SLA/priority values are read by the controller but discarded by the SDK insert: `src/controllers/ticketController.js:64-104` and `src/sdk/services/tickets.js:479-485`.
- Filter action results are interpolated as ticket-table columns after creation. `set_priority` emits `priority_id`, which is not a current `ticket` column: `src/controllers/filterController.js:276-283` and `src/controllers/ticketController.js:106-119`.
- Additional create helpers pass explicit `NULL` into required organization, staff, and department columns: `src/sdk/services/organizations.js:251-268`, `src/sdk/services/staff.js:328-338`, and `src/sdk/services/departments.js:283-291`.

**Impact**

Strict MySQL writes fail. A failure after the first ticket insert can leave an orphaned or incomplete ticket because the operation is not atomic. Even where permissive schema customization lets a write complete, the resulting object graph does not preserve osTicket numbering, dynamic-form, topic, SLA, event, notification, or assignment semantics.

**Required acceptance tests**

- Exercise create, reply, note, update, bulk, and merge against a clean, post-bootstrap v1.18.4 fixture in strict mode.
- Inject a failure after every create step and assert complete rollback with no orphan records.
- Assert required thread and event context fields and validate the written rows through stock osTicket.
- Run bidirectional interoperability: Node create → PHP view/reply/close and PHP create → Node read/update.
- Include customized dynamic forms and configured number sequences, not only the default install.

### C-06 — Staff RBAC and department visibility are not enforced

**Evidence**

- `requirePermission` has no call site outside its definition/export.
- Staff/API keys bypass ticket access globally despite the comment claiming department scope: `src/middleware/auth.js:199-209`.
- Ticket list adds no staff department, assignment, team, or referral filter: `src/controllers/ticketController.js:13-23`.
- Staff login principals omit the full department-access and `assigned_only` context needed to evaluate osTicket visibility: `src/controllers/authController.js:34-44`.
- The server-rendered `/admin` guard checks only for a staff session, and its dashboard/list/detail queries are global: `src/routes/admin.js:14-28`, `151-198`, `311-363`, and `497-523`.
- Tasks expose a global queue to any staff/API key: `src/routes/tasks.js:11-18` and `src/controllers/taskController.js:24-55`.

**Impact**

Ordinary agents can view and mutate tickets outside their allowed departments and assignments. Adding staff UI controls now would expose more unsafe mutations without fixing the server boundary.

**Required acceptance tests**

- Cover primary department, extended-department role, `assigned_only`, direct assignment, team membership, and referral access.
- Exercise every read and mutation with allowed and denied role permissions.
- Apply one authorization service consistently to REST, server-rendered admin routes, and MCP tools.

### C-07 — Official osTicket HTTP API parity is effectively zero

Stock v1.18.4 exposes the following routes through its [official route table](https://github.com/osTicket/osTicket/blob/v1.18.4/api/http.php):

| Official operation | Required contract | Nodeticket behavior | Status |
|---|---|---|---|
| `POST /api/tickets.json` | JSON create, API-key/IP/capability auth, HTTP 201 with bare external ticket number | Route reaches `createLegacy`, which always throws 400 | **Fail** |
| `POST /api/tickets.xml` | XML create with equivalent semantics | No route and no raw XML parser | **Missing** |
| `POST /api/tickets.email` | MIME new-ticket/reply threading, Message-ID deduplication, attachments | No route or MIME/inbound-mail implementation | **Missing** |
| `POST /api/tasks/cron` | `can_exec_cron`, run actual cron work, HTTP 200 with literal body `Completed` | No official path; `/api/v1/cron` reports all tasks skipped | **Fail** |

Additional evidence:

- The compatibility stub is `src/controllers/ticketController.js:219-224`; its route is `src/routes/tickets.js:42-43`.
- The ticket router is mounted both at `/api/v1/tickets` and `/api`: `src/app.js:100-120`. This also exposes unintended native routes under `/api`, outside the `/api/v1` rate limiter.
- JSON and URL-encoded middleware are installed, but no raw XML or MIME parser exists: `src/app.js:64-66`.
- Local cron is `POST /api/v1/cron`: `src/routes/system.js:23-24`. `src/controllers/systemController.js:41-60` explicitly skips mail fetching and ticket monitoring.
- The OpenAPI server `/api/v1` plus path `/tickets.json` advertises nonexistent `/api/v1/tickets.json`; the accidental mounted compatibility path is `/api/v1/tickets/tickets.json` and still reaches the stub: `docs/openapi.json:15-18` and `473-503`.

The official create contract includes the core `name`, `email`, `subject`, and `message` fields plus supported options such as source/topic, alert/autorespond, priority, IP, and dynamic fields. JSON represents attachments as RFC 2397 data URLs; XML uses structured/base64 file data; `.email` consumes MIME attachments. Current source also supports due date, SLA, and staff assignment for JSON/XML. Nodeticket's native create accepts an authenticated user, derives email, consumes `topic_id`, and returns a JSON envelope; it is not a substitute for the compatibility contract.

## High-priority findings

### H-01 — Organization, department, and profile routes cross identity/privacy boundaries

- Organization detail and member listing require authentication but no organization membership or staff check: `src/routes/organizations.js:14-18` and `src/controllers/organizationController.js:18-28`.
- Member results include names and email addresses: `src/sdk/services/organizations.js:153-176`.
- `/users/:id/organizations` lacks the self check used by adjacent user operations: `src/routes/users.js:33-37` and `src/controllers/userController.js:34-51`.
- Department detail requires authentication but not public-department or staff scope: `src/routes/departments.js:11-15`. It returns private signatures, manager email, SLA, and staff/open-ticket counts: `src/sdk/services/departments.js:99-153`.
- `/profile` accepts staff sessions but reads and updates the customer `user` table with the staff ID: `src/routes/html.js:555-618`. Matching numeric IDs can cause a staff member to edit an unrelated customer.

Make organization visibility policy explicit and enforce self/staff scope server-side. Split customer and staff profile workflows.

### H-02 — Session mutations lack a complete CSRF boundary, and duplicate routes bypass rate limiting

- API routes are mounted before CSRF protection: `src/app.js:99-130`.
- API authentication accepts browser sessions: `src/middleware/auth.js:82-92`.
- SPA mutations send session cookies but no explicit CSRF header: `src/public/js/spa.js:15-41`.
- Session cookies omit an explicit `SameSite` policy: `src/app.js:68-79`.
- The entire ticket router is also mounted at `/api`, while rate limiting applies only under `/api/v1`: `src/app.js:100-120`.
- API-key IP validation relies on `req.ip`, while `trust proxy` is unconditionally set to one hop: `src/app.js:47` and `src/middleware/auth.js:48-53`. Safety depends on the actual proxy topology.

The isolated `csrf-csrf` GET-token/POST-validation round trip passed. That refutes the broad claim that the installed middleware is intrinsically broken; the verified issue is that session-authenticated APIs are outside its mounted scope. Add behavioral tests for cross-site and same-site/subdomain requests, and exempt only bearer/API-key calls from the session CSRF requirement.

### H-03 — Ticket lifecycle and operational workflows are incomplete

- A non-staff status update always invokes `close`, so the customer reopen action closes again: `src/controllers/ticketController.js:127-143` and `src/public/js/spa.js:515-535`.
- The safe fix is not to honor an arbitrary customer-supplied `status_id`. Expose named close/reopen operations with server-side allowed-transition policy, and define whether/how a reply may reopen a closed ticket.
- Reply/note and update sequences contain multiple nontransactional writes; update event logging can precede later validation or the final update: `src/sdk/services/tickets.js:542-654` and `680-758`.
- Merge moves entries and collaborators but not the complete old event graph: `src/sdk/services/tickets.js:835-869`.
- No attachment implementation exists under `src`, despite attachment fields in OpenAPI.
- Ticket create/reply does not send outbound notifications. Email is used only for account verification/reset flows.
- Inbound email and SLA/ticket monitoring are placeholders: `src/controllers/systemController.js:53-60`.
- Task routes are read-only: `src/routes/tasks.js:11-18`.

These are product API requirements for the MVP even though most are outside osTicket's small external create/cron API.

### H-04 — OpenAPI and support claims do not describe the running system

- OpenAPI documents the compatibility route under the wrong server base.
- Create requires `email`, `name`, and camelCase `topicId`, while native create requires an authenticated user and consumes `topic_id`: `docs/openapi.json:1520-1543` and `src/controllers/ticketController.js:53-104`.
- Reply documents `body`, while the controller consumes `message`: `docs/openapi.json:1572-1605` and `src/controllers/ticketController.js:165-178`.
- Many implemented auth, CRUD, merge, bulk, setting, and filter operations are absent; several documented fields and response envelopes are not implemented.
- `README.md:3` and `docs/SCHEMA.md:3-8` claim compatibility with osTicket v1.8+, but there is no schema-version detection or compatibility layer. Direct queries require much newer tables and columns.
- Runtime assumes generated dynamic tables such as `ticket__cdata`, which are not created by the raw install SQL; a valid integration fixture must complete osTicket bootstrap.

Declare MySQL/osTicket v1.18.x as the first supported target. Expand the range only after versioned fixture tests pass. Rebuild OpenAPI from the accepted runtime contracts and smoke-test a generated client.

### H-05 — PostgreSQL is advertised but is not operational

- `src/sdk/connection.js:102-109` forwards SQL without translating placeholders.
- Services use MySQL `?` placeholders and MySQL-only syntax such as `INSERT ... SET`, backticks, `NOW()`, and `CURDATE()`.
- Insert paths expect MySQL `insertId`, while the PostgreSQL adapter returns `result.rows`; ticket create is one example at `src/sdk/services/tickets.js:479-487`.
- `docs/sdk.md:667` nevertheless states that both dialects are supported.

Remove PostgreSQL from the supported/configurable surface and fail fast for that dialect, or fund it as a separate implementation with migrations, SQL compilation, `RETURNING`, and complete service integration tests. It should not remain an untested implied capability.

### H-06 — Production session and error behavior needs hardening

- Login does not regenerate the session ID: `src/controllers/authController.js:63-66`.
- Logout destroys the session but does not revoke bearer credentials: `src/controllers/authController.js:72-77`.
- Express's default in-memory session store is used: `src/app.js:68-79`.
- Admin HTML guards bypass the API idle-timeout logic: `src/routes/admin.js:14-28`.
- Native 500 responses return `err.message` in production, and HTML error fields are interpolated without escaping: `src/middleware/errorHandler.js:105-151`.
- `requireVerified` awaits a database call without an error boundary while mounted directly under Express 4: `src/middleware/auth.js:246-256` and `src/routes/tickets.js:27-28`.

Address these alongside the authentication boundary rather than deferring them as UI polish.

### H-07 — Public knowledge/topic contracts ignore configuration and expose internal data

- Public FAQ routes never consult the knowledge-base enable setting: `src/routes/faq.js:11-18`. The SPA also always renders knowledge-base actions: `src/public/js/spa.js:75-85` and `825-864`.
- Public topic list responses expose department, priority, SLA, flags, and timestamps: `src/controllers/topicController.js:63-76`.
- Public topic detail additionally exposes number format, internal notes, default staff/team assignment, and operational defaults: `src/controllers/topicController.js:121-160`.
- Topic detail returns only attached form headers, not the field schema needed for rendering/validation, while customer create renders only topic, subject, and message: `src/controllers/topicController.js:113-159` and `src/public/js/spa.js:552-610`.
- The SPA ignores FAQ and topic pagination envelopes, leaving only the first default page reachable: `src/public/js/spa.js:602-610` and `643-665`.

Enforce knowledge-base disablement at the API and UI. Define a minimal public topic allowlist plus a public dynamic-field schema; validate submitted dynamic values server-side and render the same contract in customer create.

## MVP UI assessment

### Customer portal — not MVP-safe

| Workflow | Current state | MVP requirement |
|---|---|---|
| Login/account | Invalid-login redirects are misclassified as success by the fetch flow, so the inline error is lost and a reload occurs; reset/profile flows are not discoverable | One login service/principal, inline success/error states, discoverable register/verify/reset/profile/logout |
| Ticket list | First 25 only; no complete pagination/search | Status/search plus complete pagination with preserved state |
| Thread | Includes internal notes; first/oldest 25 only; a new reply can appear to vanish | Public-field allowlist, newest activity, load older, immediate posted reply |
| Lifecycle | Close exists; reopen closes again | Named, server-authorized customer close/reopen transitions with policy checks and audit events |
| Attachments | None | Validated upload, authorized download, thread association and display |
| Topics/knowledge | Topic/form data is unsafe or incomplete; FAQ/topics stop at the first page; KB disablement is ignored | Public topic/form schema, server-side KB toggle, and complete pagination |
| Session recovery | Client/server idle behavior differs and drafts are not protected | Reauthentication path that preserves drafts and terminates the server session coherently |
| Accessibility | Click-only table rows and FAQ headings; dynamic errors are not announced | Keyboard operation, visible focus, semantic controls/live errors, 360 px responsive acceptance |

Relevant evidence includes `src/public/js/spa.js:278-319`, `361-435`, `515-584`, `643-720`, and `797-925`. The responsive CSS baseline is reasonable, but it does not solve interaction semantics.

### Staff desk — not operational

- Dashboard, list, and detail ignore department/assignment policy.
- Ticket detail is metadata, thread, and Back only: `src/routes/admin.js:539-575`.
- There is no per-ticket reply, internal note, canned response, assignment/team transfer, department transfer, status, close/reopen, merge, or attachment workflow.
- The queue exposes only a status select. Department/staff query support is not surfaced, search/saved queues are absent, `staff=unassigned` does not match the handler's `staff_id`, and pagination drops filters: `src/routes/admin.js:284`, `311-405`, and `473-483`.
- Bulk controls are administrator-only rather than permission-driven: `src/routes/admin.js:370-430`.

The first staff slice should be a real queue plus one complete, permission-checked ticket-detail workflow. Do not add a note form before the customer-note privacy gate passes.

### Administration — broad but incomplete

Existing configuration pages provide useful coverage, but they sit on an incomplete authorization model. FAQ administration is read-only, the SPA ignores the knowledge-base enable flag, and staff/customer profile identity is confused. Status, priority, custom-form, channel, and saved-queue configuration can follow the operational staff slice rather than block its first release.

## Reconciliation with `plan/FINDINGS.GROK.md`

Confirmed from the earlier review:

- Legacy JSON create is a stub; XML/email and attachments are absent.
- Ticket outbound notification and inbound email are not wired.
- SLA/cron behavior is incomplete.
- Customer reopen is broken.
- Staff visibility is global and `requirePermission` is unused.
- Staff ticket detail is read-only and the test suite is thin.

Corrections and material additions:

- The prior **65–75% product REST** estimate is too optimistic. Native create fails on the current standard schema, and core create/reply/note/event writes do not satisfy strict-schema invariants.
- The customer UI is not an adequate minimal portal while internal notes, login result handling, reopen, and pagination are broken.
- FAQ text search exists in the API; the missing piece is the UI/admin workflow.
- The server god-router is `src/routes/admin.js`, not the browser `admin.js` asset.
- Staff portal login already redirects to `/admin`; the more important defect is inconsistent principal construction between HTML and API login.
- The isolated CSRF middleware works. The actionable defect is incomplete mounting/coverage for session-authenticated APIs.
- The purpose-token authentication flaw, API-key administrator bypass, note disclosure, invalid topic query, and required-column write failures were not captured by the earlier severity assessment.

## Recommended red/green delivery sequence

### Gate A0 — Repair trust boundaries and data isolation

Write failing behavioral tests first for:

- Access versus refresh/reset/verification token separation.
- Fail-closed principal types and account-state revalidation.
- API-key create/cron capability isolation.
- Customer-visible thread/event field allowlists.
- Staff department/assignment/role visibility across REST, SSR, and MCP.
- Organization, private-department, and self-profile access.
- Knowledge-base disablement and public topic-field allowlists.
- Named customer close/reopen transition and reply-on-closed policy.
- Session CSRF behavior and rate limiting on every route alias.

This gate is green only when denied requests fail on the server regardless of UI state.

### Gate A1 — Establish a real osTicket interoperability fixture

- Pin the first supported database target to fully bootstrapped MySQL/osTicket v1.18.4 in strict mode.
- Make native create/reply/note/update/bulk/merge tests red against that fixture.
- Replace sequential ticket writes with one transactional creation kernel.
- Preserve configured numbering, dynamic forms, topic/filter/status/priority/SLA/assignment defaults, required thread/event context, collaborators, and notifications.
- Add failure injection and bidirectional stock-PHP interoperability tests.

Do not test source structure or development process; test observable HTTP behavior and the database object graph.

### Gate A2 — Deliver exact JSON compatibility

- Add a dedicated `/api/tickets.json` route outside the native ticket router.
- Enforce active key, exact source IP, and `can_create_tickets` without granting a native principal.
- Match stock fields, validation, defaults, filtering, attachment behavior, status codes, and the bare ticket-number response.
- Differentially submit the same corpus to stock v1.18.4 and Nodeticket, normalizing generated IDs before comparison.

### Gate A3 — Complete the official API surface

- Add XML create with semantic equivalence to JSON.
- Add MIME email new-ticket/reply threading, duplicate Message-ID handling, and attachments.
- Add `POST /api/tasks/cron` with `can_exec_cron` and observable jobs that actually run.
- Cover missing, invalid, inactive, wrong-IP, and wrong-capability keys for every endpoint.

At the end of A3, the official parity matrix must be completely green.

### Gate A4 — Harden the native product API

- Complete permissioned ticket lifecycle, attachments/download authorization, outbound notifications, SLA/overdue processing, tasks, pagination/search, and safe merge behavior.
- Publish a minimal topic/dynamic-form field schema and validate submitted values against it.
- Remove accidental `/api` native aliases and align rate limits/CSRF/session handling.
- Reconcile OpenAPI with runtime payloads and generated-client smoke tests.
- Either fail fast for PostgreSQL or implement and fixture-test it separately.

### Gate U0 — UI safety and contract

- Consume the safe thread/event contracts and unified login principal.
- Consume the public topic/dynamic-form contract, enforce KB disablement, and complete ticket/thread/topic/FAQ pagination.
- Use named close/reopen operations and the accepted transition policy.
- Prove staff queue/detail scoping before exposing mutations.
- Keep the existing configuration UI stable while contracts change.

### Gate U1 — Staff operational vertical slice

- Queue: search, status, department, assignee/team, priority, overdue, sort, and query-preserving pagination.
- Detail: reply, distinct internal note, canned response, assignment/team, transfer, status, close/reopen, and audit feedback.
- Enforce the same permissions at endpoint and control level.
- Include keyboard operation, visible focus, announced errors, and responsive acceptance in this first staff slice rather than retrofitting it later.

### Gate U2 — Attachments and notifications

- Customer and staff upload/download UI on the authorized attachment API.
- Ticket create/reply notifications with visible delivery failure behavior.
- Email-created ticket/reply/attachment presentation.

### Gate U3 — Customer hardening and accessibility

- Discoverable account lifecycle and explicit states.
- Ticket search/filter/pagination, newest-thread behavior, and draft-preserving reauthentication.
- Keyboard, focus, live-region, responsive, and automated accessibility/browser acceptance.

### Gate U4 — Administration and production readiness

- FAQ CRUD/search, status/priority/forms/channels, and saved queues. Server-side knowledge-base enablement already passed at U0.
- Durable session store, coherent idle/logout/revocation behavior, safe production errors, and vendored/fallback frontend dependencies.
- Browser matrix, accessibility checks, and production-session smoke tests.

## Exit criteria before MVP UI feature work

API work is ready to hand off to UI only when all of the following are true:

- Purpose tokens cannot authenticate as access tokens, and API keys cannot become native principals.
- Customers cannot retrieve internal notes, internal events, or private identity fields.
- Staff visibility and mutations obey department, assignment, team/referral, and role permissions across all interfaces.
- Disabled knowledge-base content is unavailable through both API and UI; public topics expose only the accepted field/form schema.
- Native create/read/reply/update pass against a bootstrapped strict v1.18.4 fixture with rollback guarantees.
- JSON/XML/email/cron official routes pass differential contract tests against stock v1.18.4.
- OpenAPI describes and successfully calls the live native API.
- Close/reopen and pagination are correct behavioral contracts.
- The expanded suite includes HTTP, database, authorization, and browser tests and remains green alongside the existing 45 tests.

This sequence intentionally puts API and data-contract parity ahead of UI expansion while retaining the useful existing configuration work.
