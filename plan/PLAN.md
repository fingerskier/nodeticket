# Nodeticket v1.0 Plan

**Status:** Active — supersedes the 2026-07-16 parity-first master plan (see §13 changelog; prior plan preserved in git history at `71cd6f7^..`)
**Created:** 2026-07-17
**Baseline revision:** `71cd6f7` (all citations verified at this revision)
**Evidence:** `plan/FINDINGS.CODEX.md` (2026-07-17 security/schema review), `plan/FINDINGS.GROK.md` (historical product lens), `docs/SCHEMA.md`, `docs/FIXTURE.md`

---

## 1. What v1.0 is

**Nodeticket v1.0 is a Node.js help desk that runs safely on an existing osTicket v1.18.4 MySQL database, exposing a modern JSON REST API, a working customer portal and staff desk, and a secure core MCP server.**

| Pillar | Definition of done |
|---|---|
| **DB compatibility** | Point Nodeticket at an existing osTicket v1.18.4 MySQL database and operate it: all history, users, topics, forms, and configuration readable; all writes schema-valid, transactional, and non-destructive (rollback to PHP osTicket remains possible). |
| **JSON REST API** | `/api/v1/*` is the product API: authorization enforced server-side on every mutation, privacy allowlists on every DTO, OpenAPI accurate enough to drive a generated client. `POST /api/tickets.json` and `POST /api/tasks/cron` retained for existing integrations. |
| **Core MCP** | MCP server enableable in production: OAuth flow safe, principals typed and scoped, all tools routed through the same authorization service as REST. |
| **Usable desk** | Customer SPA + staff/admin SSR already shipped (U0–U4) keep working on top of the corrected backend; minimal browser smoke proves the critical paths. |

### 1.1 What v1.0 is NOT

- **Not a drop-in PHP osTicket replacement.** Exact official-API behavioral parity (differential corpus vs stock PHP) is out of scope.
- **No XML.** `POST /api/tickets.xml` and the hand-rolled parser are deleted, not fixed.
- **No live cohabitation.** Sharing one database with a *concurrently running* PHP osTicket is unsupported (writes are stock-valid, but locking/cache/session coordination with PHP is untested).
- **No PostgreSQL.** Dialect already fails fast; v1.0 removes the dead `pg` dependency and dead code paths.
- **Deferred:** plugins/webhooks, LDAP/2FA/OAuth identity backends, ticket merge (behind experimental flag, default off), full business-hours SLA engine, browser full matrix (Firefox/WebKit), MCP resources/prompts (tools only in v1.0).

---

## 2. Compatibility contract (load-bearing)

Three tiers. v1.0 guarantees T1 and T2; T3 is explicitly out.

| Tier | Guarantee | Proof |
|---|---|---|
| **T1 Schema-safe** | Every write is valid under `STRICT_TRANS_TABLES` against the stock v1.18.4 schema: no invented columns, no NULL into NOT NULL, required event/thread context columns populated, multi-row operations transactional. | Strict-mode fixture suite (P2) required in CI. |
| **T2 Adopt-existing** | An existing osTicket DB (retired or read-only PHP) is fully operable: dynamic form data read and written (`form_entry`/`form_entry_values`/cdata), stock filters interpreted safely, sequences/numbering stock-correct, rows we write are readable by stock PHP if the owner rolls back. | Adopt-existing acceptance suite against a committed stock-installed dump (P2). |
| **T3 Live side-by-side** | **Not guaranteed.** | — |

**Consequences:** the fixture must be a real stock v1.18.4 installation snapshot (not a hand-written seed); merge stays off by default (its non-stock graph rewrite would break the rollback guarantee); filters we don't understand are skipped and logged, never misapplied.

---

## 3. FINDINGS.CODEX disposition

The 2026-07-17 review is accurate but written against a recreation goal. v1.0 adopts its security findings whole and rescopes the parity findings to the compatibility contract above.

| Finding | Verdict | v1.0 treatment | Phase |
|---|---|---|---|
| C-01 MCP OAuth/principal boundary | **Adopt + elevate** | MCP is a headline feature, so the fix is mandatory, not optional. Full gate in P4; containment (assert-disabled) in P0. | P0, P4 |
| C-02 inconsistent authz | **Adopt** | One operation-matrix authorization service across REST, admin SSR, tasks, MCP. | P0 |
| C-03 attachment privacy/atomicity | **Adopt** | Entry-aware policy, ownership verification, transactional reply+files, server-side limits. | P1 |
| C-04 spoofable inbound email | **Rescope** | Email intake ships **default-off** (`EMAIL_INTAKE_ENABLED=false`). Enable-gate: sender/collaborator authorization, real MIME parser, atomic dedup. No stock nested-MIME differential corpus. | P3 |
| C-05 non-stock lifecycle semantics | **Split** | Adopt: form_entry writes, transactional update/bulk, strict-schema correctness. Rescope: filters → safe-interpretation (not stock vocabulary re-implementation). Drop from v1.0: merge (flag off), stock filter authoring parity. | P2 |
| C-06 identity/privacy boundaries | **Adopt** | Typed principal guards, DTO allowlists, account-state revalidation, collision-proof profile routes. | P1 |
| C-07 fixture not an oracle | **Rescope** | Fixture becomes a committed stock v1.18.4 install dump under strict mode, **required** in CI. No PHP runtime differential in CI. | P2, P5 |
| H-01 official JSON/XML exactness | **Rescope / drop** | XML deleted. `tickets.json` kept and fixed pragmatically (stock attachment map accepted, alert/autorespond applied, priority persisted) with local behavioral tests — no differential corpus. | P3 |
| H-02 cron/SLA narrower than stock | **Rescope** | Keep endpoint; document the supported job subset honestly; job failures become observable; overdue uses `est_duedate`. Full stock job set not required. | P3 |
| H-03 KB/topic config ignored | **Adopt** | `enable_kb` server-side, public allowlists, server-complete pagination/search. | P3 |
| H-04 OpenAPI not a contract | **Adopt** | Single root server, conditional security modeled, deterministic generation, generated-client smoke. Core to the JSON-REST pillar. | P3 |
| H-05 CSRF/throttle/proxy/mail-mock | **Adopt** | Production hardening. | P1 |
| H-06 docs drift | **Adopt** | Reconcile claims to the tested matrix at release. | P5 |

---

## 4. Current state (at `71cd6f7`)

**Works (keep):** layered SDK (`src/sdk/`); broad `/api/v1` REST; purpose-token JWT isolation (`src/lib/tokens.js`); capability-only API keys; transactional create/reply/note kernel with `ost_sequence` numbering; attachments, notifications, tasks, FAQ CRUD, soft locks; customer SPA (`src/public/js/spa.js`) + staff/admin SSR (`src/routes/admin.js`); MySQL fixture harness (`docker-compose.fixture.yml`, `scripts/fixture-bootstrap.js`); OpenAPI generator (75 paths); optional Redis sessions; 114 passing unit tests + 14 fixture tests.

**Blockers (fix):** MCP OAuth/principal safety (C-01, incl. fallback admin principal at `src/mcp/tools/admin.js:833`); mutation authz gaps across REST/admin/tasks/MCP (C-02); attachment trust boundary (C-03); identity boundaries (C-06); dynamic forms not written on create (C-05); fixture is hand-seeded, CI unit-only (C-07); OpenAPI dual-server misrouting (H-04); email fail-open mock, CSRF header exemption ordering, blanket `trust proxy` (H-05).

**Housekeeping:** `pg` is an unused hard dependency with dead dialect branches (`src/sdk/connection.js:54-60`); package version is CalVer `2026.3.1` while `src/mcp/transport.js` hardcodes `1.0.0`; README claims v1.8+ interop.

---

## 5. Phases

Phases are sequential gates; each is red/green (failing behavioral tests first). P0/P1/P2 numbering aligns with FINDINGS.CODEX's revised plan for cross-reading; P3–P5 diverge per §3.

```
P0 Authorization seam ─► P1 Privacy & integrity ─► P2 Existing-DB compat ─► P3 JSON API & channels ─► P4 Core MCP ─► P5 Release
```

Effort estimates are order-of-magnitude for one focused engineer.

---

## 6. P0 — One authorization seam (≈1–1.5 weeks)

**Objective:** every ticket/task mutation is authorized server-side by one service, on every interface, before any other v1.0 work builds on top.

| # | Task | Files |
|---|---|---|
| P0.1 | Assert MCP disabled: startup warning + production assertion while C-01 open (removed in P4) | `src/config/index.js`, `src/app.js:206-210` |
| P0.2 | Define the operation matrix: view, create, create-on-behalf, reply, note, edit, assign, transfer, close/reopen, attach, lock, bulk, merge, task-* × principal (customer/staff/admin/system) × scope (dept, extended access, `assigned_only`, assignee, team, referral, admin override, role permission) | new `src/sdk/services/authz.js` (extend `src/lib/authz.js`) |
| P0.3 | Route REST ticket mutations through it — reply, update, assign, transfer, close/reopen, attachments, locks currently unchecked | `src/routes/tickets.js:40-135`, `src/controllers/ticketController.js` |
| P0.4 | Route admin SSR POST handlers through it (they currently re-check nothing) | `src/routes/admin.js:607-649, 973-1176` |
| P0.5 | Scope tasks by dept/assignment/permission (currently global staff) | `src/routes/tasks.js:12-27`, `src/controllers/taskController.js:24-55` |
| P0.6 | Merge: authorize **source and target**; then gate whole feature behind `MERGE_ENABLED=false` (see P2.6) | `src/controllers/ticketController.js:442-459`, `src/sdk/services/tickets.js:1307-1368` |
| P0.7 | MCP tools call the same service; delete the fallback admin principal | `src/mcp/tools/*.js`, `src/mcp/tools/admin.js:12-20,833` |

**Acceptance (red → green):**
- [ ] Scoped agent posting a foreign ticket ID to any mutation (REST, admin SSR, task, MCP) → 403/denied
- [ ] Merge into unauthorized target → denied
- [ ] Role-permission matrix: each of reply/note/edit/assign/transfer/close/merge denied without its permission, on every interface
- [ ] `assigned_only`, extended dept access, team, referral each covered by at least one allow and one deny test
- [ ] MCP enabled in production without P4 green → startup fails

**Exit:** denied requests fail server-side on every interface, independent of UI.

---

## 7. P1 — Privacy and write integrity (≈1–1.5 weeks)

**Objective:** customers can't read or write across trust boundaries; credentials reflect live account state; platform hardening lands.

| # | Task | Files |
|---|---|---|
| P1.1 | Attachment reads filtered by the same publicOnly entry policy as threads (internal-note files currently leak) | `src/sdk/services/tickets.js:1375-1428`, `src/controllers/ticketController.js:336-341` |
| P1.2 | Verify ticket → thread → entry ownership before file association (foreign `entry_id` currently accepted) | `src/sdk/services/tickets.js:1450-1476`, `src/controllers/ticketController.js:359-366` |
| P1.3 | Reply + attachments in one transaction (or documented idempotent two-phase); enforce size/count/type/filename server-side | `src/controllers/ticketController.js:276-294`, `src/sdk/services/tickets.js:840-897` |
| P1.4 | Org/dept privacy: member lists and dept detail behind staff/self allowlists | `src/routes/organizations.js`, `src/sdk/services/organizations.js:89-178`, `src/sdk/services/departments.js:99-153`, `src/routes/users.js:36-37` |
| P1.5 | Principal-typed profile routes — numeric-ID collision between staff/API-key/customer must be impossible | `src/routes/users.js:11-24`, `src/controllers/userController.js:81-109`, `src/routes/html.js:603-674` |
| P1.6 | Reject inactive accounts at login/refresh; bounded revalidation of account state/role on session and bearer use; document revocation bound | `src/sdk/services/auth.js:83-90`, `src/controllers/authController.js:198-224`, `src/middleware/auth.js:22-103` |
| P1.7 | CSRF exemption only after non-session credential *validates* (not on header presence) | `src/app.js:125-148`, `src/middleware/auth.js:109-129` |
| P1.8 | Dedicated login/reset throttles (HTML routes currently outside the API limiter) | `src/routes/html.js:176-331`, `src/config/index.js:44-50` |
| P1.9 | `trust proxy` becomes explicit config, not unconditional `1` | `src/app.js:46-47` |
| P1.10 | Email transport fails closed in production unless `EMAIL_MODE=mock` explicit | `src/lib/email.js:28-36` |

**Acceptance (red → green):**
- [ ] Customer cannot list/download internal-note attachments; foreign `entry_id` upload denied
- [ ] Reply-with-file failure leaves no partial write; retry does not duplicate
- [ ] Non-member cannot read org members/dept internals; profile collision tests across all principal types
- [ ] Disabled account loses access within documented bound; refresh with disabled account → 401
- [ ] Forged `X-API-Key` header no longer bypasses CSRF for session requests
- [ ] Production boot without SES credentials and without explicit mock mode → hard fail

**Exit:** FINDINGS.CODEX C-03/C-06/H-05 closed.

---

## 8. P2 — Existing-database compatibility (≈2 weeks)

**Objective:** T1 + T2 of the compatibility contract proven against a real stock database image.

| # | Task | Files |
|---|---|---|
| P2.1 | **Stock fixture:** install osTicket v1.18.4 once (locally, PHP required once), `mysqldump` → commit `test/fixture/osticket-1.18.4-stock.sql`; bootstrap loads dump + seed deltas (admin/agent/customer/API keys) with `STRICT_TRANS_TABLES`; document regeneration in `docs/FIXTURE.md` | `scripts/fixture-bootstrap.js`, `test/fixture/`, `docker-compose.fixture.yml` |
| P2.2 | **Dynamic forms read:** topic-aware field schema endpoint (public + staff) from `form`/`form_field` tables; SPA create form renders it | `src/controllers/topicController.js:113-159`, `src/routes/topics.js`, `src/public/js/spa.js:947-984` |
| P2.3 | **Dynamic forms write:** validate answers server-side; write `form_entry` + `form_entry_values` + cdata projection inside the create transaction | `src/sdk/services/tickets.js:758-766`, `src/lib/legacyTicketApi.js:12-72` |
| P2.4 | **Filter safe-interpretation:** read stock filter rows; apply actions we support (dept/priority/SLA/status/staff/team/topic/reject); **skip and log** unknown actions — never guess; apply inside the create transaction | `src/controllers/filterController.js`, `src/controllers/ticketController.js:131-164` |
| P2.5 | **Update/bulk integrity:** lifecycle state + full event context in one transaction; stock sentinel values instead of NULL into NOT NULL columns | `src/sdk/services/tickets.js:923-1053`, `src/controllers/ticketController.js:853-873` |
| P2.6 | **Merge off:** `MERGE_ENABLED=false` default; docs mark experimental; stock `ticket_pid` representation deferred past v1.0 | `src/config/index.js`, `src/routes/tickets.js:128-135` |
| P2.7 | **Adopt-existing acceptance suite:** boot against the stock dump; read seeded history/forms/config; run full lifecycle; assert written rows are stock-shape (columns, events, form entries, sequences) | `test/integration/` |

**Acceptance (red → green):**
- [ ] Full lifecycle (create/reply/note/update/bulk/close/reopen) green on stock dump under strict mode
- [ ] Ticket created via topic with required custom fields → `form_entry`/`form_entry_values`/cdata rows present and stock-shaped; missing required field → validation error
- [ ] Stock-authored filter with supported actions applies; filter with unsupported action skips with log, create succeeds
- [ ] Failure injection mid-create/mid-update → no orphan/partial rows
- [ ] Row-shape assertions: everything we write matches stock column expectations (the "PHP could still read this" proof, without running PHP)

**Exit:** compatibility contract T1/T2 demonstrated by CI-runnable suite.

---

## 9. P3 — JSON REST contract and channels (≈1.5 weeks)

**Objective:** the JSON API is the product; XML dies; retained legacy channels are honest and safe.

| # | Task | Files |
|---|---|---|
| P3.1 | **Delete XML:** remove `src/lib/legacyTicketXml.js`, `createLegacyXml` (`src/controllers/ticketController.js:466,616-657,895`), mount (`src/app.js:181-187`), OpenAPI path (`scripts/generate-openapi.js:1247-1266`), XML tests; keep `rawText10mb` (email uses it); regenerate `docs/openapi.json` | as listed |
| P3.2 | **`tickets.json` pragmatics:** accept stock attachment map (`{filename: dataURL}`) alongside current shape; apply `alert`/`autorespond`; persist `priority` via form path; RFC2397 message bodies | `src/lib/legacyTicketApi.js`, `src/controllers/ticketController.js:480-496` |
| P3.3 | **Email intake default-off:** `EMAIL_INTAKE_ENABLED=false`; enable-gate = mature MIME parser (e.g. `mailparser`), sender/collaborator authorization (never attribute unknown sender to owner), atomic Message-ID dedup with unique index, reply attachments persisted | `src/lib/legacyTicketEmail.js`, `src/controllers/ticketController.js:691-765`, `docs/mysql.sql:400-409` |
| P3.4 | **Cron honesty:** document supported jobs (overdue via `est_duedate`, lock cleanup); failures observable in response/logs (not silent `Completed`); unsupported jobs listed as such | `src/lib/cron.js`, `src/controllers/ticketController.js:776-785`, `docs/PRODUCTION.md` |
| P3.5 | **KB gates:** `enable_kb` enforced server-side + SPA nav; public FAQ/topic allowlists (no internal notes, SLA/assignment internals); server-complete pagination/search | `src/routes/faq.js`, `src/controllers/faqController.js:149-160`, `src/controllers/topicController.js:113-159`, `src/public/js/spa.js:1022-1127` |
| P3.6 | **OpenAPI as contract:** single root server (full paths); conditional cookie+CSRF security modeled; `/auth/refresh` body documented; deterministic output (no timestamp); live request/response validation in tests; generated-client smoke (list/create/reply/close) against fixture | `scripts/generate-openapi.js`, `test/openapi.contract.test.js` |
| P3.7 | **Drop `pg`:** remove dependency and dead dialect branches | `package.json`, `src/sdk/connection.js`, `src/sdk/`, `docs/sdk.md` |

**Acceptance (red → green):**
- [ ] `POST /api/tickets.xml` → 404; no XML code or docs remain
- [ ] Stock-example `tickets.json` payloads (dynamic fields, attachment map, data-URL body, alert flags) → 201 + bare number, fields persisted
- [ ] Email disabled → endpoint 503/404 documented; enabled in test: unknown sender rejected, nested MIME parsed, duplicate Message-ID idempotent
- [ ] Cron job failure visible to caller/ops
- [ ] `enable_kb=0` hides KB in API + SPA; FAQ search server-paginated past page 1
- [ ] Generated client compiles and passes smoke against fixture; OpenAPI regeneration is diff-clean in CI

**Exit:** JSON-REST pillar done; only JSON channels remain.

---

## 10. P4 — Core MCP (≈1.5–2 weeks)

**Objective:** MCP becomes a supported, safe, first-class surface — the "pave the way" pillar delivered.

| # | Task | Files |
|---|---|---|
| P4.1 | **OAuth hardening:** redirect URIs restricted (pre-registered via config + loopback/HTTPS rules; dynamic registration behind flag); consent screen (no silent approval); `state` required; codes single-use and bound to client+redirect+PKCE+principal | `src/mcp/oauth/register.js:11-27`, `authorize.js:19-87`, `token.js:26-51`, `store.js` |
| P4.2 | **Principal safety:** reject API-key principals from MCP OAuth and every tool; MCP bearer carries `token_use='mcp'` + typed principal; validate purpose, live account state, and session-to-principal binding per request | `src/mcp/transport.js:35-121`, `src/middleware/auth.js:109-145`, `src/mcp/tools/*.js` |
| P4.3 | **Scopes:** `tickets:read`, `tickets:write`, `directory:read`, `admin` mapped onto the P0 authz matrix; customer principals get publicOnly threads; staff get staff_scope | `src/mcp/oauth/`, `src/mcp/tools/tickets.js:16-400` |
| P4.4 | **Toolset audit:** all 49 tools through authz service (P0.7 done; verify matrix coverage incl. 33 admin tools admin-gated); prune any tool that can't be safely scoped | `src/mcp/tools/` |
| P4.5 | **Transport cleanup:** replace `res.writeHead` session-capture hack if SDK ≥1.27 allows; session idle/eviction documented; MCP server version string = package version | `src/mcp/transport.js` |
| P4.6 | **Docs:** `docs/MCP.md` — enablement, client registration, scopes, Claude/inspector quickstart; restart semantics of in-memory OAuth store (accepted for v1.0; static client config recommended) | new `docs/MCP.md` |

**Acceptance (red → green)** — the C-01 behavioral list:
- [ ] Arbitrary-redirect registration rejected; code theft via attacker redirect fails
- [ ] Authorization without consent interaction fails; missing `state` fails
- [ ] Code replay fails; attacker-PKCE exchange of victim code fails
- [ ] API key → MCP token or tool call → rejected
- [ ] Customer MCP client cannot read internal notes; scoped-staff MCP client denied foreign-dept tickets (reuses P0 matrix tests)
- [ ] Disabled account's MCP token stops working within documented bound
- [ ] MCP inspector / real client end-to-end: authorize → list_tickets → create_ticket → reply

**Exit:** `MCP_ENABLED=true` is a supported production configuration; P0.1 assertion removed.

---

## 11. P5 — Release engineering (≈1 week)

| # | Task | Files |
|---|---|---|
| P5.1 | **CI gates:** fixture job (stock dump, strict mode) required — unavailable infra fails the job, skips are not green; unit + integration + OpenAPI diff-clean + generated-client smoke | `.github/workflows/ci.yml` |
| P5.2 | **Browser smoke (minimal):** Playwright Chromium, two specs — customer login→create→reply→detail; staff queue→detail→reply/note — no console errors; runs in CI | `test/browser/`, `package.json` (`test:browser`) |
| P5.3 | **Versioning:** keep CalVer for the npm package (semver `1.0.0` would sort *below* published `2026.3.1` for range consumers); release = package `2026.x.y` + git tag `v1.0.0`; MCP server version reads package version | `package.json`, `src/mcp/transport.js` |
| P5.4 | **Docs reconcile (H-06):** README/`docs/SCHEMA.md` claim exactly "osTicket v1.18.4 MySQL"; remove XML and PostgreSQL claims; `docs/sdk.md` PG sections removed; TODO files pruned to real remainder; `docs/PRODUCTION.md` final checklist (proxy config, email mode, Redis, cron scheduling, MCP enablement) | `README.md`, `docs/` |
| P5.5 | **Secrets hygiene:** `.env.example` placeholders empty-required; production validation rejects known placeholder patterns | `.env.example`, `src/config/index.js:88-97` |

**Release checklist (tag `v1.0.0` when all true):**
- [ ] P0–P4 acceptance lists green in CI (no green-by-skip)
- [ ] Adopt-existing suite green on stock v1.18.4 dump, strict mode
- [ ] MCP gate green and enabled in at least one staging config
- [ ] Generated OpenAPI client smoke green
- [ ] Browser smoke green
- [ ] Docs/support claims match tested matrix; no XML/PG/v1.8+ references
- [ ] `npm audit` reviewed; placeholder secrets rejected in production mode

---

## 12. Testing strategy

| Layer | What | Phase |
|---|---|---|
| Unit | tokens, authz matrix logic, parsers, filter interpretation, form validation | ongoing |
| HTTP behavioral | supertest-style against app + fixture; every acceptance checkbox above | P0+ |
| Row-shape | assert written rows match stock schema expectations (the no-PHP compatibility proof) | P2 |
| Contract | OpenAPI live validation + generated-client smoke | P3 |
| MCP integration | OAuth flow + tool calls via MCP SDK client | P4 |
| Browser smoke | 2 Chromium specs | P5 |

CI target: `npm test` + `npm run test:http` (required, stock fixture) + `npm run openapi:generate --check` + `npm run test:mcp` + `npm run test:browser`.

Fixture policy: one committed stock v1.18.4 dump; seed deltas add admin staff, limited agent, customer, two depts, topics with custom forms, roles, create-only/cron-only API keys. Regeneration documented, PHP needed only for regeneration, never in CI.

---

## 13. Changelog

| Date | Change |
|---|---|
| 2026-07-17 | v1.0 plan replaces the 2026-07-16 parity-first plan. Scope reframed: compatibility with existing databases instead of recreation of osTicket behavior; XML dropped; JSON REST + core MCP become pillars; FINDINGS.CODEX findings dispositioned per §3. Prior A0–A4/U0–U4 progress retained (see git history of this file for the full gate changelog). |
