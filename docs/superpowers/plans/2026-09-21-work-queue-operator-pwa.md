# Work Queue and Operator PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every database-backed storefront request as interactive operational work and provide an authenticated local PWA with OS Push notifications, workflow updates, and complete end-to-end verification.

**Architecture:** Neon Postgres is the source of truth for requests, work items, append-only events, operator authorization, Push subscriptions, and a transactional notification outbox. Vercel functions expose a provider-neutral authenticated operator API backed by Neon Managed Better Auth; a separate local PWA consumes that API, while a scheduled Neon Function drains the Push outbox. Explicit development adapters provide the same contracts on loopback so the complete storefront-to-inbox workflow is runnable without production secrets.

**Tech Stack:** Node.js 22 ESM, vanilla HTML/CSS/JavaScript PWA, Vercel functions, Neon Postgres and `@neondatabase/serverless`, Neon Managed Better Auth/Neon JavaScript SDK, Neon Functions (Node.js 24), standards-based Web Push/VAPID, Node test runner, Python/Playwright E2E, existing screenshot and accessibility tooling.

**Spec:** `docs/superpowers/specs/2026-09-21-work-queue-operator-pwa-design.md`

## Global Constraints

- Only `public/` is storefront static output; `operator/` must never be copied into `public/` or included in the Vercel static output.
- No database, GitHub, Neon Auth, VAPID, worker, or provider secret may enter a browser bundle.
- Customer uploads remain private; v1 operator reads expose normalized file metadata only.
- Customer request payloads are immutable from operator mutations.
- Detailed intake continues to work in database, delivery-only, and no-integration modes; only database persistence guarantees a work item.
- GitHub is the first provider behind a provider-neutral auth adapter; an enabled `operators` row, not provider identity alone, grants access.
- Private API responses and customer data are network-only and absent from Cache Storage, Local Storage, and Session Storage.
- Push text contains no customer PII or project details.
- Every mutation is server-validated and revision-checked; provider failures expose no raw body or credentials.
- Preserve light/dark/system themes, keyboard focus, reduced motion, accessibility, and 390-pixel responsiveness.
- Preserve non-binding estimate language, all four service paths, customer-recoverable no-integration behavior, and Stripe verification boundaries.
- Implement production behavior test-first: write one focused failing test, verify the expected failure, add minimal code, verify green, then refactor.
- Provider code must follow current official GitHub, Neon, Vercel, and Web Push documentation and have URL/method/header/timeout/failure contract tests.

---

## File map

### Database and server domain

- Create `neon/migrations/003_work_queue.sql`: additive operators, work items, notes, events, Push subscriptions, outbox, checks, indexes, and request-completion helper.
- Create `lib/work-validation.js`: pure identifiers, filters, cursors, transition, mutation, and Push-subscription validation.
- Create `lib/work-store.js`: production Neon work creation/read/mutation/outbox queries.
- Create `lib/local-work-store.js`: ignored-file development implementation of the same store interface.
- Create `lib/operator-auth.js`: provider-neutral session-to-operator authorization and trusted-origin behavior.
- Modify `lib/neon.js`: expose safe query/transaction helpers needed by focused stores without exporting credentials.
- Modify `api/request.js`: make database completion atomically create work, event, and outbox state and trigger best-effort immediate delivery.

### Operator API

- Create `api/operator-session.js`: session/authorization discovery.
- Create `api/operator-work.js`: cursor list, detail, and incremental event reads.
- Create `api/operator-work-update.js`: acknowledgment, state/priority/date/assignment updates, and notes.
- Create `api/operator-push.js`: Push config, subscribe, unsubscribe, and test alert.
- Create `lib/operator-api.js`: shared CORS, auth, response, and store-resolution wrapper.

### Push worker and managed Neon configuration

- Create `lib/push-delivery.js`: VAPID payload and provider-independent batch result logic usable by tests/worker.
- Create `neon/functions/push-outbox.ts`: scheduled/immediate outbox drain handler.
- Create `neon.ts`: Neon Auth and Push function declaration; apply schedules through documented Neon trigger configuration/API when declarative schedule support is confirmed by the installed CLI.
- Modify `package.json` and lockfile: add only the official/current Neon auth/config and Web Push dependencies actually required after checking installed package exports.

### Local operator PWA

- Create `operator/index.html`, `operator/manifest.webmanifest`, `operator/service-worker.js`, and local icons.
- Create `operator/assets/operator.css`: responsive accessible visual system.
- Create `operator/assets/auth-client.js`: Neon Auth and development adapters with `signIn`, `getSession`, `signOut`, and change observation.
- Create `operator/assets/api-client.js`: authenticated network-only client with stable error mapping.
- Create `operator/assets/work-state.js`: pure filters, ordering, transition presentation, and formatting.
- Create `operator/assets/push-client.js`: capability, permission, registration, subscription, and unsubscribe behavior.
- Create `operator/assets/operator.js`: application controller and accessible rendering.
- Create `scripts/operator-server.mjs`: loopback host for the operator files.
- Modify `scripts/dev-server.mjs`: operator API routes and explicit local work/auth adapters.
- Add ignored local state paths to `.gitignore` and safe configuration names to `.env.example`.

### Verification and documentation

- Create focused Node tests under `tests/unit/work-*.test.mjs`, `operator-*.test.mjs`, and `push-*.test.mjs`.
- Create `tests/e2e/test_operator_api.py` and `tests/e2e/test_operator_pwa.py`.
- Modify `tests/support/server.py` and add `tests/support/operator_harness.py` for the two-app local workflow.
- Modify `scripts/capture_screenshots.py` and screenshot board generation to include operator states.
- Modify `scripts/validate.mjs`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/DEPLOYMENT.md`, `docs/VERIFICATION.md`, and `README.md`.

---

### Task 1: Lock down the work schema and pure workflow contract

**Files:**
- Create: `neon/migrations/003_work_queue.sql`
- Create: `lib/work-validation.js`
- Create: `tests/unit/work-validation.test.mjs`
- Modify: `scripts/migrate-neon.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Produces: `WORK_STATUSES`, `WORK_PRIORITIES`, `parseWorkQuery(input)`, `parseWorkCommand(input)`, `canTransition(from, to, context)`, `parsePushSubscription(input)`.
- Produces tables: `operators`, `work_items`, `work_notes`, `work_events`, `push_subscriptions`, `notification_outbox`, and `notification_deliveries`.
- Consumes: existing `service_requests(id, status, payload, uploaded_files, ...)`.

- [ ] **Step 1: Write failing validation tests**

Add table-driven Node tests that prove:

```js
assert.equal(canTransition("submitted", "triage", {}), true);
assert.equal(canTransition("triage", "waiting_customer", {}), true);
assert.equal(canTransition("waiting_customer", "triage", { previousStatus: "triage" }), true);
assert.equal(canTransition("submitted", "completed", {}), false);
assert.equal(canTransition("approved", "scheduled", { targetDate: null }), false);
assert.equal(canTransition("approved", "scheduled", { targetDate: "2026-09-30" }), true);
assert.throws(() => parseWorkCommand({ type: "set-priority", priority: "critical", revision: 2 }), /priority/i);
assert.deepEqual(parseWorkCommand({ type: "acknowledge", revision: 1 }), { type: "acknowledge", revision: 1 });
assert.throws(() => parseWorkCommand({ type: "add-note", body: " ", revision: 1 }), /note/i);
```

Also read the migration as text and assert unique `request_id`, positive `revision`, bounded enum checks, append-only event/note intent, outbox uniqueness, and indexes for actionable list/event cursor/outbox claim queries.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/work-validation.test.mjs`

Expected: FAIL because `lib/work-validation.js` and migration 003 do not exist.

- [ ] **Step 3: Implement the pure validators and additive schema**

Use an explicit transition map, strict ISO date parsing, integer revisions, bounded note text (1–4000 code points), cursor objects encoded as URL-safe base64 JSON, and conservative Push endpoint/key validation. The schema must use foreign keys, `ON DELETE` behavior that does not orphan operational events, generated UUID/random IDs available in the current Neon Postgres version, and no destructive alterations to migration 001/002.

The request-to-work invariant must be database-enforced:

```sql
request_id text NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE RESTRICT
```

The outbox/delivery uniqueness must make repeated creation safe:

```sql
UNIQUE (event_id, kind)
UNIQUE (outbox_id, subscription_id)
```

- [ ] **Step 4: Verify GREEN and migration validation**

Run: `node --test tests/unit/work-validation.test.mjs`

Run: `npm run validate`

Expected: all focused tests and static validation pass.

- [ ] **Step 5: Commit the schema contract**

```powershell
git add neon/migrations/003_work_queue.sql lib/work-validation.js tests/unit/work-validation.test.mjs scripts/migrate-neon.mjs scripts/validate.mjs
git commit -m "feat: define durable work queue schema"
```

### Task 2: Implement atomic work ingestion and production/local stores

**Files:**
- Create: `lib/work-store.js`
- Create: `lib/local-work-store.js`
- Create: `tests/unit/work-store.test.mjs`
- Modify: `lib/neon.js`
- Modify: `api/request.js`
- Modify: `tests/e2e/test_api.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces store methods:

```js
completeRequestWithWork(id, request, files) -> { workItem, eventId, outboxId }
listWork(query, operator) -> { items, nextCursor }
getWork(id, operator) -> { item, request, files, notes, events }
applyWorkCommand(id, command, operator, idempotencyKey) -> { item, event }
listEvents(after, limit) -> { events, nextCursor }
savePushSubscription(operator, subscription) -> { id, enabled }
disablePushSubscription(operator, endpoint) -> { disabled }
```

- Consumes: Task 1 validators and schema.
- Preserves: existing Supabase completion behavior; work ingestion is enabled only for Neon in v1 and documented accordingly.

- [ ] **Step 1: Write failing store contract tests**

Use injected query adapters/fake tagged-template results rather than a real production database. Prove one completion operation emits a single atomic SQL statement/transactional function call that:

```js
assert.equal(result.workItem.requestId, requestId);
assert.equal(result.workItem.status, "submitted");
assert.equal(result.workItem.revision, 1);
assert.equal(result.event.type, "work.created");
assert.equal(result.outbox.state, "pending");
```

Prove repeated completion returns the existing work item or the existing request conflict without adding a second event/outbox row. Prove local store persistence survives a new store instance, excludes secrets, and uses an ignored path beneath `data/`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/unit/work-store.test.mjs`

Expected: FAIL because the stores do not exist.

- [ ] **Step 3: Add safe Neon query injection and the production store**

Keep credentials inside `lib/neon.js`. Export a `createNeonWorkStore({ query })` factory for tests and a default environment-backed store. Use a single SQL CTE or database function for request completion, work creation, event creation, and outbox creation so partial acceptance is impossible.

- [ ] **Step 4: Add the local store with atomic file replacement**

Store only development data in `data/operator-dev.json`. Serialize writes through one promise chain, write a sibling temporary file, then rename within the same directory. Reject non-loopback production selection and ensure the file is ignored.

- [ ] **Step 5: Route Neon request completion through atomic ingestion**

In `api/request.js`, replace the Neon-only `completeRequestRecord` call with `completeRequestWithWork`. Keep Supabase/delivery/local fallbacks unchanged. Extend the successful integration result with a non-sensitive `workQueue: true|false` field only where tests and browser compatibility show this will not break strict consumers.

- [ ] **Step 6: Verify GREEN and existing intake paths**

Run: `node --test tests/unit/work-store.test.mjs tests/unit/validation.test.mjs`

Run: `python -m pytest tests/e2e/test_api.py tests/e2e/test_order_flow.py -q`

Expected: atomic work tests pass; all four existing services and local fallback still pass.

- [ ] **Step 7: Commit ingestion**

```powershell
git add lib/work-store.js lib/local-work-store.js lib/neon.js api/request.js tests/unit/work-store.test.mjs tests/e2e/test_api.py .gitignore
git commit -m "feat: enqueue persisted requests as operational work"
```

### Task 3: Add provider-neutral Neon Auth authorization

**Files:**
- Create: `lib/operator-auth.js`
- Create: `lib/operator-api.js`
- Create: `api/operator-session.js`
- Create: `tests/unit/operator-auth.test.mjs`
- Create: `tests/unit/operator-api.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- Produces `createIdentityProvider({ verifySession })` with `getIdentity(req)` returning `{ authUserId, name, email, provider } | null`.
- Produces `authorizeOperator(req, store)` returning `{ id, authUserId, displayName, role }` or throwing stable `401/403` errors.
- Produces `withOperatorApi(handler, options)` for CORS, method, auth, no-store, and safe-error behavior.
- Environment names: `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` (only if required by current official verifier), and `OPERATOR_ALLOWED_ORIGINS`.

- [ ] **Step 1: Inspect installed/current official Neon SDK exports**

Run `npm view @neondatabase/neon-js version exports --json` and consult current official Neon Auth docs. Record the chosen server verification API in a test fixture comment and dependency lockfile; do not guess an import or implement ad-hoc JWT verification.

- [ ] **Step 2: Write failing auth/authorization tests**

Cover missing, valid, expired, malformed, and provider-failure sessions; enabled owner/operator rows; valid identity without operator row; disabled operator; and last-seen update. Assert that provider tokens never appear in returned identity.

Cover CORS exactly:

```js
assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:4180");
assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
assert.equal(untrusted.status, 403);
assert.equal(untrusted.headers.has("Access-Control-Allow-Origin"), false);
```

Prove local bypass requires all explicit loopback conditions and is rejected for non-loopback bind/origin or production environment.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/unit/operator-auth.test.mjs tests/unit/operator-api.test.mjs`

Expected: FAIL because auth/API wrappers do not exist.

- [ ] **Step 4: Implement identity and authorization adapters**

Use Neon Managed Better Auth's supported session/JWT verification path. Keep the provider-specific call inside one adapter. Query authorization by stable `auth_user_id`; never authorize by email, GitHub login, or mutable display name.

- [ ] **Step 5: Implement session endpoint and CORS wrapper**

`GET /api/operator-session` returns only:

```json
{
  "authenticated": true,
  "operator": { "id": "...", "displayName": "Jerrett", "role": "owner" }
}
```

Missing auth returns 401; valid-but-unapproved identity returns 403; provider outages return a generic 503. Every response is `no-store`.

- [ ] **Step 6: Verify GREEN and secret-safe failures**

Run the focused Node tests and capture console output during simulated provider failures. Assert fixture secrets, raw JWTs, and provider bodies are absent.

- [ ] **Step 7: Commit authentication**

```powershell
git add lib/operator-auth.js lib/operator-api.js api/operator-session.js tests/unit/operator-auth.test.mjs tests/unit/operator-api.test.mjs package.json package-lock.json .env.example
git commit -m "feat: authorize operators with managed Neon Auth"
```

### Task 4: Build interactive operator work APIs

**Files:**
- Create: `api/operator-work.js`
- Create: `api/operator-work-update.js`
- Create: `tests/unit/operator-work-api.test.mjs`
- Create: `tests/e2e/test_operator_api.py`
- Modify: `scripts/dev-server.mjs`
- Modify: `tests/support/server.py`

**Interfaces:**
- `GET /api/operator-work?view=&service=&priority=&cursor=&limit=` returns work summaries.
- `GET /api/operator-work?id=<work-id>` returns one detail.
- `GET /api/operator-work?eventsAfter=<cursor>&limit=` returns versioned events.
- `PATCH /api/operator-work-update` consumes `{ id, command, idempotencyKey }`.
- Commands are exactly `acknowledge`, `set-status`, `set-priority`, `set-target-date`, `set-assignee`, and `add-note` with Task 1 shapes.

- [ ] **Step 1: Write failing API tests**

Test methods, body limits, auth, authorization, origin, filters, pagination cursor tampering, missing records, minimized list data, full detail, every valid command, invalid transitions, scheduled-without-date, terminal immutability, note bounds, duplicate idempotency key, and revision conflict.

Conflict response contract:

```json
{
  "error": "Work changed before this update could be saved.",
  "code": "revision_conflict",
  "currentRevision": 4
}
```

Assert list responses do not include description, email, phone, address, specifications, notes, file paths, or Push endpoint data.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/operator-work-api.test.mjs`

Run: `python -m pytest tests/e2e/test_operator_api.py -q`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement list/detail/event endpoints**

Use cursor pagination with deterministic `(priority_rank, actionable_time, id)` ordering. Cap page size at 100 and default to 30. Return normalized display data only after authorization.

- [ ] **Step 4: Implement revision-checked mutations**

Each store mutation must update with `WHERE id = $id AND revision = $expected`, increment revision, and append its event in the same transaction. Note insertion and its event are atomic. Map equivalent states to `service_requests.status` only where the spec permits.

- [ ] **Step 5: Register local routes and test adapters**

Extend the development server route map. Update `running_server` to explicitly clear auth/Push/worker secrets and enable loopback-only development auth for operator tests.

- [ ] **Step 6: Verify GREEN**

Run focused unit and API E2E tests, then existing API tests.

- [ ] **Step 7: Commit operator APIs**

```powershell
git add api/operator-work.js api/operator-work-update.js tests/unit/operator-work-api.test.mjs tests/e2e/test_operator_api.py scripts/dev-server.mjs tests/support/server.py lib/work-store.js lib/local-work-store.js
git commit -m "feat: expose interactive operator work APIs"
```

### Task 5: Implement private Web Push subscriptions and durable delivery

**Files:**
- Create: `lib/push-delivery.js`
- Create: `api/operator-push.js`
- Create: `neon/functions/push-outbox.ts`
- Create: `neon.ts`
- Create: `tests/unit/push-delivery.test.mjs`
- Create: `tests/unit/operator-push-api.test.mjs`
- Modify: `api/request.js`
- Modify: `lib/work-store.js`
- Modify: `lib/local-work-store.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- `buildNewWorkNotification({ eventId, workId })` returns only generic text and safe route data.
- `drainPushOutbox({ store, transport, now, batchSize })` returns counts `{ claimed, delivered, disabled, retrying, failed }`.
- `GET /api/operator-push` returns `{ supported, vapidPublicKey, subscribed }` without secrets.
- `POST /api/operator-push` consumes `{ action: "subscribe"|"unsubscribe"|"test", subscription? }`.
- Neon Function accepts scheduled invocations carrying `X-Neon-Trigger-Invocation-Id` and immediate invocations carrying a separate server-only authorization secret.

- [ ] **Step 1: Write failing privacy and retry tests**

Assert notification serialization contains none of a fixture customer's name, email, title, description, estimate, file name, or request payload. Test success, `404/410` disablement, `429` retry, `5xx` retry, network timeout, malformed subscription, attempt cap, lease expiry, duplicate worker invocation, and safe logs.

- [ ] **Step 2: Write failing authenticated Push API tests**

Cover permission-independent server behavior, VAPID public-key discovery, subscription key/endpoint bounds, endpoint upsert to current operator, cross-operator unsubscribe denial, test notification outbox creation, unconfigured Push, and arbitrary-origin denial.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/unit/push-delivery.test.mjs tests/unit/operator-push-api.test.mjs`

Expected: FAIL because Push modules do not exist.

- [ ] **Step 4: Add official Web Push transport and outbox drain**

Use the maintained `web-push` package (or current standards-compatible official dependency selected after registry review). Configure VAPID subject/public/private values only from server environment. Use `AbortSignal.timeout(10_000)` where the library permits or its documented timeout option. Classify failures by HTTP status without logging endpoint URLs or response bodies.

- [ ] **Step 5: Add subscription API and immediate trigger**

On database-backed request completion, call the Neon Function endpoint after commit with only the outbox/event identifier and server authorization. Use a short timeout. Failure logs one safe category and leaves the outbox pending; it never changes the accepted request response.

- [ ] **Step 6: Implement the Neon Function and schedule configuration**

Use a module-scope `pg.Pool` in the Neon Function, as current Neon guidance recommends. Accept scheduled calls only when the Neon trigger invocation header is present, and immediate calls only with constant-time verification of `PUSH_WORKER_SECRET`. Claim a small batch using `FOR UPDATE SKIP LOCKED`, send outside or within carefully bounded leases, and persist per-subscription outcomes.

Declare Auth and the function in `neon.ts`. If the installed GA config schema does not yet support schedule declarations, add `scripts/configure-neon-trigger.mjs` using Neon's documented branch trigger API and make it idempotently create/update the named `push-outbox` trigger at `* * * * *`.

- [ ] **Step 7: Verify GREEN and provider contracts**

Run focused tests. Verify the tests assert function URL shape, HTTP method, auth headers, JSON privacy, timeout, scheduled header handling, and generic failure behavior.

- [ ] **Step 8: Commit Push delivery**

```powershell
git add lib/push-delivery.js api/operator-push.js neon/functions/push-outbox.ts neon.ts api/request.js lib/work-store.js lib/local-work-store.js tests/unit/push-delivery.test.mjs tests/unit/operator-push-api.test.mjs package.json package-lock.json .env.example scripts/configure-neon-trigger.mjs
git commit -m "feat: deliver durable private work notifications"
```

### Task 6: Build the installable operator shell and safe service worker

**Files:**
- Create: `operator/index.html`
- Create: `operator/manifest.webmanifest`
- Create: `operator/service-worker.js`
- Create: `operator/assets/icons/operator-192.png`
- Create: `operator/assets/icons/operator-512.png`
- Create: `operator/assets/operator.css`
- Create: `operator/assets/api-client.js`
- Create: `operator/assets/auth-client.js`
- Create: `operator/assets/push-client.js`
- Create: `operator/assets/work-state.js`
- Create: `tests/unit/operator-client.test.mjs`
- Create: `tests/unit/operator-service-worker.test.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- `createApiClient({ apiBase, getSessionHeaders, fetchImpl })` with `session`, `listWork`, `getWork`, `updateWork`, `events`, and Push methods.
- `createAuthClient(config)` with `signIn("github")`, `getSession()`, `signOut()`, `subscribe(listener)`.
- `createPushClient({ navigator, Notification, api })` with `getState`, `enable`, `disable`, `sendTest`.
- Pure work helpers: `filterWork`, `sortWork`, `allowedTransitions`, `formatRelativeTime`.

- [ ] **Step 1: Write failing pure client/service-worker tests**

Prove API errors map 401/403/409/422/503/network distinctly; credentials/session headers use the official auth client path; filters and ordering follow the spec; transition buttons only show valid targets; Push enable is explicit; denial/unsupported are recoverable; and subscription bytes are encoded correctly.

Parse the service worker and simulate install/fetch/push/click events. Assert only shell assets enter the cache, `/api/` is network-only, generic notification text is exact, and click routing uses a same-origin `/work/<opaque-id>` path.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/operator-client.test.mjs tests/unit/operator-service-worker.test.mjs`

Expected: FAIL because operator assets do not exist.

- [ ] **Step 3: Create semantic shell, manifest, and visual foundation**

The HTML must include skip link, header, connection status, sign-in state, inbox navigation, filter form, work list, detail region/dialog, status live region, and a `<noscript>` explanation. Use local assets only. The stylesheet must define intentional blue/teal operator styling, clear information hierarchy, status shapes plus text, 44-pixel targets, visible focus, reduced motion, themes, desktop split view, and 390-pixel stacked view.

- [ ] **Step 4: Implement pure clients and auth adapter**

Keep auth provider names/configuration at the adapter boundary. Never serialize sessions or request data into browser storage. Use `credentials: "include"` only as required by Neon Auth and allowed origins; all operator API responses remain `no-store`.

- [ ] **Step 5: Implement service worker and Push client**

Version shell cache names. Delete obsolete shell caches on activate. Never intercept/cache operator API or Neon Auth endpoints. Require explicit button activation before `Notification.requestPermission()`.

- [ ] **Step 6: Verify GREEN and output isolation**

Run focused tests and `npm run validate`. Add validation proving no `operator/` file is under or copied into `public/`, manifests reference local files, and forbidden secret names/literals are absent from browser sources.

- [ ] **Step 7: Commit PWA shell**

```powershell
git add operator tests/unit/operator-client.test.mjs tests/unit/operator-service-worker.test.mjs scripts/validate.mjs
git commit -m "feat: add secure installable operator PWA shell"
```

### Task 7: Implement inbox, detail, updates, and conflict recovery

**Files:**
- Create: `operator/assets/operator.js`
- Create: `tests/unit/operator-app.test.mjs`
- Modify: `operator/index.html`
- Modify: `operator/assets/operator.css`
- Modify: `operator/assets/work-state.js`

**Interfaces:**
- Application states: `checking-session`, `signed-out`, `forbidden`, `loading`, `ready`, `empty`, `offline`, `error`.
- URL contract: `/`, `/work/<opaque-id>`, query/filter state that contains no customer data.
- Poll/event refresh interval: visible-page bounded refresh, paused when hidden/offline, immediate refresh on service-worker message.

- [ ] **Step 1: Write failing application-state tests**

Test signed-out/forbidden/empty/loading/error/offline rendering, minimized list rendering, detail separation, acknowledgment, priority/date/assignment/status commands, note draft behavior, event history, filter URL state, logout memory clearing, 401 re-auth, and 409 recovery preserving note text.

Name the production failure each test detects; do not assert implementation-only DOM trivia.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/operator-app.test.mjs`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement session and inbox controller**

Render with DOM construction and `textContent`, never customer-derived `innerHTML`. Abort stale requests on selection/filter changes. Clear in-memory detail immediately on logout/401/disabled-operator response.

- [ ] **Step 4: Implement detail and mutations**

Disable only the active control during a mutation. Announce success/failure. On conflict, retain unsent note text, refetch detail, explain the revision change, and require a deliberate retry. Never optimistically claim server success.

- [ ] **Step 5: Implement incremental refresh and Push handoff**

Use event cursor refresh while visible and online. Listen for service-worker messages to refresh and navigate. Polling/event refresh is an inbox freshness feature, not notification delivery.

- [ ] **Step 6: Verify GREEN**

Run application and all operator unit tests.

- [ ] **Step 7: Commit interaction layer**

```powershell
git add operator/assets/operator.js operator/index.html operator/assets/operator.css operator/assets/work-state.js tests/unit/operator-app.test.mjs
git commit -m "feat: add interactive operator triage workflow"
```

### Task 8: Make the complete workflow runnable locally

**Files:**
- Create: `scripts/operator-server.mjs`
- Create: `scripts/dev-workspace.mjs`
- Create: `tests/support/operator_harness.py`
- Modify: `scripts/dev-server.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- `npm run dev:workspace` starts storefront/API and operator PWA on loopback, prints both URLs, and shuts both down together.
- Development auth is enabled only by explicit script-owned flags and loopback binding.
- Operator runtime config is generated in memory or returned from a non-cacheable local endpoint; production provider values are not written into source.

- [ ] **Step 1: Write failing local-workspace harness test**

Start the workspace on free ports, verify storefront and operator HTML, ensure operator files are unavailable from the storefront static root, verify development session authorization, submit a normalized storefront request through create/complete, list exactly one work item, mutate it, restart local stores, and verify the work/history remains.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/e2e/test_operator_api.py -q`

Expected: FAIL because the coordinated workspace does not exist.

- [ ] **Step 3: Implement operator host and coordinator**

Bind both servers to `127.0.0.1`, use separate origins to exercise CORS, forward termination signals, hide any spawned Windows console window, and refuse non-loopback host when development auth is on.

- [ ] **Step 4: Add local worker behavior**

Expose an explicit local drain route/timer using an injected fake Push transport. It must exercise outbox leasing/outcomes without sending external notifications during automated tests.

- [ ] **Step 5: Verify GREEN and shutdown cleanliness**

Run the harness twice and ensure ports/processes/files are cleaned or reused safely, with no orphan Node processes.

- [ ] **Step 6: Commit local operation**

```powershell
git add scripts/operator-server.mjs scripts/dev-workspace.mjs scripts/dev-server.mjs tests/support/operator_harness.py package.json .env.example .gitignore
git commit -m "feat: run storefront and operator workspace locally"
```

### Task 9: Add comprehensive browser E2E coverage

**Files:**
- Create: `tests/e2e/test_operator_pwa.py`
- Modify: `tests/e2e/test_operator_api.py`
- Modify: `tests/support/operator_harness.py`
- Modify: `tests/support/browser_harness.py`
- Modify: `tests/e2e/test_order_flow.py`

**Interfaces:**
- Real HTTP Playwright context against both local origins.
- Controlled browser permissions for notification default/denied/granted states.
- Two pages/contexts for revision-conflict verification.

- [ ] **Step 1: Write a failing intake-to-inbox E2E test**

Use the real order page to submit one request, then assert the operator inbox shows one matching safe summary. Open detail, acknowledge, set high priority and target date, move through valid states, add a private note, reload, and verify event order.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/e2e/test_operator_pwa.py::test_intake_to_interactive_work_inbox -q`

Expected: FAIL at the first missing/incomplete browser behavior.

- [ ] **Step 3: Make the primary flow GREEN**

Fix only production behavior required by this test, rerunning until it passes without console/page errors.

- [ ] **Step 4: Add auth, error, conflict, and offline paths one test at a time**

Cover signed-out, forbidden, logout, session expiry, empty/loading/API outage, invalid transition, two-page conflict with preserved note, offline startup, offline mutation, reconnect, and provider-generic errors. For each test: run RED, implement minimal behavior, run GREEN.

- [ ] **Step 5: Add Push/PWA paths one test at a time**

Cover unsupported Push, default permission with no prompt on load, denied permission, granted subscription, unsubscribe, generic test notification payload, service-worker refresh message, click routing, manifest/icon fetches, shell-cache contents, and absence of API/customer data from Cache Storage and browser storage.

- [ ] **Step 6: Add accessibility/responsive/theme paths**

At 390 pixels and desktop widths, test no horizontal overflow, keyboard-only list/detail/mutation flow, focus trapping/return where used, visible focus, accessible names, status text independent of color, live-region output, reduced motion, and light/dark/system modes.

- [ ] **Step 7: Re-run every storefront service path**

Extend existing parameterized order tests so print/design/repair/consult each create one local work item with no unrelated fields. Reassert no-integration fallback creates no durable work claim and remains email/JSON recoverable.

- [ ] **Step 8: Run the complete E2E suite**

Run: `npm run test:e2e`

Expected: all browser/API tests pass with no unexpected console errors.

- [ ] **Step 9: Commit E2E coverage**

```powershell
git add tests/e2e/test_operator_pwa.py tests/e2e/test_operator_api.py tests/e2e/test_order_flow.py tests/support/operator_harness.py tests/support/browser_harness.py operator api lib scripts
git commit -m "test: verify operator workflow end to end"
```

### Task 10: Integrate screenshots and visual inspection

**Files:**
- Modify: `scripts/capture_screenshots.py`
- Modify: screenshot-board composition code used by that script
- Create/update: generated operator screenshots and `screenshots/preview-board.png`
- Modify: `docs/UX-AUDIT.md` only if the audit inventory/count changes.

**Interfaces:**
- Screenshot states: signed-in inbox desktop, selected detail desktop, 390-pixel inbox/detail, dark theme, Push permission explanation, empty state, and conflict/error state.

- [ ] **Step 1: Add screenshot-state assertions before capture changes**

Add a failing test or validation check proving the capture manifest must include each required operator state and that images have non-zero expected dimensions.

- [ ] **Step 2: Verify RED**

Run the focused screenshot/validation check and confirm missing operator states fail.

- [ ] **Step 3: Extend capture and preview board**

Seed deterministic local work without customer-realistic PII, capture animations disabled, and label operator frames distinctly from storefront frames. Preserve existing board content.

- [ ] **Step 4: Generate and inspect**

Run: `npm run screenshots`

Open `screenshots/preview-board.png` and individual operator captures. Inspect typography, clipping, contrast, focus, density, scroll behavior, mobile layout, status clarity, and customer/operations separation. Fix visual defects and rerun captures.

- [ ] **Step 5: Commit reviewed visuals**

```powershell
git add scripts/capture_screenshots.py screenshots docs/UX-AUDIT.md operator/assets/operator.css
git commit -m "test: add operator PWA visual verification"
```

### Task 11: Document provisioning, operations, privacy, and recovery

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/VERIFICATION.md`
- Modify: `public/privacy.html` only if the current notice does not already cover operator processing/Push endpoint retention.
- Modify: `public/assets/js/config.js`/`vercel.json` CSP hash only if structured data or public behavior actually changes.

**Interfaces:**
- Exact environment/config inventory with public/server/Neon Function ownership.
- Exact migration, Neon Auth GitHub provider, trusted origin, operator provisioning, VAPID generation, function deploy, trigger enable, rotation, revocation, and smoke commands.

- [ ] **Step 1: Write documentation-validation assertions**

Extend static validation to require every new environment name in `.env.example` and deployment docs; require migration 003, operator startup, owner provisioning, Push rotation, subscription cleanup, outbox inspection/replay, and auth revocation sections; reject example secrets under `public/`.

- [ ] **Step 2: Verify RED**

Run: `npm run validate`

Expected: FAIL listing missing operational documentation.

- [ ] **Step 3: Update architecture and runbooks**

Document the precise data flow and failure matrix. State that the inbox is authoritative and Push is an alert. Include safe SQL queries for pending/failed outbox counts and disabled subscriptions without selecting endpoint/key/customer columns.

- [ ] **Step 4: Add deployment and smoke procedure**

Document official Neon CLI/API steps as verified during implementation. Include how to find the first Auth user ID and insert an enabled owner without authorizing by email alone. Document GitHub client-secret and VAPID rotation consequences, how to disable an operator immediately, and how to remove a lost device.

- [ ] **Step 5: Review privacy language**

If required, add concise language that authenticated operational software and device Push services process requests; Push lock-screen content contains no customer details. If public HTML changes, run asset versioning and CSP validation per repository rules.

- [ ] **Step 6: Verify GREEN and commit docs**

Run: `npm run validate`

```powershell
git add README.md docs .env.example scripts/validate.mjs public vercel.json
git commit -m "docs: add operator queue deployment and operations"
```

### Task 12: Full completion audit, live local demonstration, and handoff

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Completion evidence maps every spec acceptance criterion to a test, rendered artifact, command result, or live local observation.

- [ ] **Step 1: Run static and unit verification**

Run: `npm run validate`

Run: `npm run test:unit`

Expected: clean exit, no warnings/errors, all old/new tests pass.

- [ ] **Step 2: Run all browser/API and accessibility verification**

Run: `npm run test:e2e`

Run: `npm run audit`

Expected: all existing and new paths pass; the UX audit includes the operator PWA where applicable.

- [ ] **Step 3: Run aggregate gate**

Run: `npm test`

Expected: validate, unit, E2E, and audit all pass in the same final tree.

- [ ] **Step 4: Regenerate and visually inspect screenshots**

Run: `npm run screenshots`

Inspect `screenshots/preview-board.png` and operator captures after the final code, not earlier artifacts.

- [ ] **Step 5: Run local end-to-end demonstration**

Start `npm run dev:workspace`. Through the visible storefront, create a labeled synthetic request. In the visible operator PWA, confirm it appears once, enable/test notification UI, acknowledge it, set priority/date, add a note, advance status, reload, and confirm persistence/history. Confirm no customer/API data in Cache Storage or Web Storage.

- [ ] **Step 6: Open the operator app for user inspection**

Leave the verified local workspace running and open the operator URL in the default browser. Report both local URLs and the exact synthetic request ID.

- [ ] **Step 7: Audit production-readiness gaps honestly**

Distinguish repository-complete work from external provisioning that could not be performed without linked Neon/GitHub credentials. If credentials and authorization are available, apply migration/config to a safe branch first and run provider smoke tests. Do not claim production Auth/Push operational without observing actual configured provider behavior.

- [ ] **Step 8: Review diff and route verification fixes to their owning task**

Run: `git diff --check`

Run: `git status --short`

If the final audit required a code or documentation fix, repeat that owning task's focused test and full verification gate, then use the explicit staging list and commit message from that task. If verification made no source change, do not create an empty completion commit.
