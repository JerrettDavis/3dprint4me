# Home Assistant Work Peek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a token-protected, non-consuming work snapshot plus Home Assistant dashboard and alert configuration whose interactions deep-link to `work.3dprint4.me`.

**Architecture:** A new work-management repository operation returns one privacy-minimized snapshot from either Neon or the local development store. A narrow GET transport authenticates a dedicated bearer secret and serializes only the versioned snapshot; Home Assistant polls it through one REST sensor and derives counts, a dashboard, and new-work alerts without invoking any mutation or cursor API.

**Tech Stack:** Node.js 22 ES modules, Vercel Functions, Neon Postgres, `node:test`, Home Assistant REST/template/automation integrations, Lovelace YAML.

**Spec:** `docs/superpowers/specs/2026-09-22-home-assistant-work-peek-design.md`

## Global Constraints

- Home Assistant observes work; it must never acknowledge, claim, update, advance an event cursor, or consume work or notification-outbox entries.
- The machine credential is the server-only `HOME_ASSISTANT_TOKEN`; it may not enter `public/`, operator assets, URLs, logs, or response bodies.
- The response may contain only operational summary fields and fixed canonical `https://work.3dprint4.me` links.
- Exclude request IDs, customer identity/contact data, descriptions, specifications, model URLs, estimates, files, notes, event history, operator identities, and revisions.
- Accept only `GET`, return `Cache-Control: no-store`, fail closed when unconfigured, and normalize internal failures.
- Return at most 20 active items; terminal statuses are `completed`, `declined`, and `cancelled`.
- Use one Home Assistant REST request per polling cycle with `scan_interval: 60`.
- Add no MQTT dependency, custom Home Assistant integration, database migration, browser secret, public analytics, or workflow controls.

---

## File Map

- Create `lib/work-management/home-assistant-snapshot.js`: pure snapshot constants, canonical-link construction, and output allowlisting.
- Modify `lib/work-management/service.js`: expose `homeAssistantSnapshot()` through the application boundary.
- Modify `lib/work-management/adapters/local-work-repository.js`: compute the contract from local state without writing it.
- Modify `lib/work-management/adapters/neon-work-repository.js`: retrieve counts and bounded items in one read-only SQL statement.
- Create `lib/home-assistant-auth.js`: dedicated bearer-token parsing and timing-safe verification.
- Create `api/home-assistant-work.js`: GET-only transport and generic failure behavior.
- Create `tests/unit/home-assistant-snapshot.test.mjs`: pure projection, canonical URL, and privacy tests.
- Modify `tests/contract/work-repository.contract.test.mjs`: local repository semantics and non-mutation contract.
- Create `tests/unit/home-assistant-api.test.mjs`: method, auth, headers, payload, and failure tests.
- Create `integrations/home-assistant/package.yaml`: one REST resource, derived entities, and persistent new-work alert.
- Create `integrations/home-assistant/dashboard.yaml`: read-only Lovelace dashboard with canonical external links.
- Create `integrations/home-assistant/README.md`: installation, mobile notification extension, validation, rotation, and recovery.
- Modify `scripts/validate.mjs`: statically validate the shipped integration's security and deep-link invariants.
- Modify `.env.example`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, and `docs/VERIFICATION.md`: describe configuration and production proof.

### Task 1: Pure Snapshot Contract and Application Port

**Files:**
- Create: `lib/work-management/home-assistant-snapshot.js`
- Modify: `lib/work-management/service.js`
- Create: `tests/unit/home-assistant-snapshot.test.mjs`

**Interfaces:**
- Consumes: repository method `getHomeAssistantSnapshot(): Promise<{ counts, latestCreatedId, items }>`.
- Produces: `presentHomeAssistantSnapshot(raw, { now? }): { version, generatedAt, queueUrl, counts, latestCreatedId, items }` and service method `homeAssistantSnapshot()`.

- [ ] **Step 1: Write failing projection and privacy tests**

Create tests that pass a raw item containing both allowed and forbidden fields and assert exact deep equality:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { presentHomeAssistantSnapshot } from "../../lib/work-management/home-assistant-snapshot.js";

test("snapshot exposes only operational summary fields and canonical work links", () => {
  const actual = presentHomeAssistantSnapshot({
    counts: { active: 1, unacknowledged: 1, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: "work_12345678",
    items: [{
      id: "work_12345678", projectTitle: "Replacement bracket", service: "print",
      status: "submitted", priority: "normal", acknowledged: false,
      submittedAt: "2026-09-22T11:55:00.000Z", targetDate: null,
      requestId: "3DP-private", contact: { email: "private@example.com" },
      description: "private", files: ["private.stl"], notes: ["private"], revision: 7
    }]
  }, { now: () => new Date("2026-09-22T12:00:00.000Z") });

  assert.deepEqual(actual, {
    version: 1,
    generatedAt: "2026-09-22T12:00:00.000Z",
    queueUrl: "https://work.3dprint4.me/",
    counts: { active: 1, unacknowledged: 1, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: "work_12345678",
    items: [{
      id: "work_12345678", title: "Replacement bracket", service: "print",
      status: "submitted", priority: "normal", acknowledged: false,
      submittedAt: "2026-09-22T11:55:00.000Z", targetDate: null,
      url: "https://work.3dprint4.me/work/work_12345678"
    }]
  });
  assert.equal(JSON.stringify(actual).includes("private"), false);
});
```

Also test the empty snapshot (`latestCreatedId: null`, empty `items`) and reject an invalid work ID rather than constructing an attacker-controlled URL.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/home-assistant-snapshot.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `home-assistant-snapshot.js`.

- [ ] **Step 3: Implement the pure presenter**

Create a focused module with fixed origins and exact field projection:

```js
const OPERATOR_ORIGIN = "https://work.3dprint4.me";
const WORK_ID = /^work_[A-Za-z0-9_-]{8,123}$/;

function safeWorkId(value) {
  const id = String(value ?? "");
  if (!WORK_ID.test(id)) throw new TypeError("Snapshot contains an invalid work ID.");
  return id;
}

export function presentHomeAssistantSnapshot(raw, { now = () => new Date() } = {}) {
  const items = raw.items.map(item => {
    const id = safeWorkId(item.id);
    return {
      id, title: item.projectTitle, service: item.service, status: item.status,
      priority: item.priority, acknowledged: Boolean(item.acknowledged),
      submittedAt: item.submittedAt, targetDate: item.targetDate ?? null,
      url: `${OPERATOR_ORIGIN}/work/${id}`
    };
  });
  return {
    version: 1, generatedAt: now().toISOString(), queueUrl: `${OPERATOR_ORIGIN}/`,
    counts: {
      active: Number(raw.counts.active), unacknowledged: Number(raw.counts.unacknowledged),
      urgent: Number(raw.counts.urgent), waitingCustomer: Number(raw.counts.waitingCustomer)
    },
    latestCreatedId: raw.latestCreatedId === null ? null : safeWorkId(raw.latestCreatedId), items
  };
}
```

In `service.js`, import the presenter and add:

```js
homeAssistantSnapshot: async () => presentHomeAssistantSnapshot(await repository.getHomeAssistantSnapshot()),
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/unit/home-assistant-snapshot.test.mjs`

Expected: all snapshot tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add lib/work-management/home-assistant-snapshot.js lib/work-management/service.js tests/unit/home-assistant-snapshot.test.mjs
git commit -m "feat: define Home Assistant work snapshot"
```

### Task 2: Local and Neon Read-Only Snapshot Adapters

**Files:**
- Modify: `lib/work-management/adapters/local-work-repository.js`
- Modify: `lib/work-management/adapters/neon-work-repository.js`
- Modify: `tests/contract/work-repository.contract.test.mjs`
- Create: `tests/unit/home-assistant-neon-adapter.test.mjs`

**Interfaces:**
- Consumes: existing request/work storage and the fixed terminal-status set.
- Produces: `repository.getHomeAssistantSnapshot(): Promise<{ counts: { active, unacknowledged, urgent, waitingCustomer }, latestCreatedId: string|null, items: RawSummary[] }>`.

- [ ] **Step 1: Write failing local repository contract tests**

Extend the contract test to create work, snapshot state before and after two reads, and assert identical persisted state:

```js
const before = await repository.snapshot();
const first = await repository.getHomeAssistantSnapshot();
const second = await repository.getHomeAssistantSnapshot();
const after = await repository.snapshot();
assert.deepEqual(after, before);
assert.deepEqual(second, first);
assert.equal(first.counts.active, 1);
assert.equal(first.counts.unacknowledged, 1);
assert.equal(first.latestCreatedId, completed.workItem.id);
assert.equal(first.items[0].projectTitle, "Alignment bracket");
```

Add seeded-state coverage for terminal exclusion, waiting and urgent counts, priority ordering, newest-created marker independent of display ordering, and a 20-item cap.

- [ ] **Step 2: Write a failing Neon SQL-shape test**

Inject a query spy into `createNeonWorkRepository({ query })`, return a representative aggregate row, and assert that `getHomeAssistantSnapshot()`:

```js
assert.equal(calls.length, 1);
assert.match(calls[0].text, /COUNT\(\*\).*FILTER/is);
assert.match(calls[0].text, /jsonb_agg/is);
assert.match(calls[0].text, /LIMIT 20/is);
assert.doesNotMatch(calls[0].text, /UPDATE|INSERT|DELETE/is);
```

Assert the adapter converts Postgres count strings to numbers and timestamps to ISO strings.

- [ ] **Step 3: Run adapter tests and verify RED**

Run: `node --test tests/contract/work-repository.contract.test.mjs tests/unit/home-assistant-neon-adapter.test.mjs`

Expected: FAIL because `getHomeAssistantSnapshot` does not exist and the Neon repository does not accept an injected query yet.

- [ ] **Step 4: Implement local snapshot reads**

Add `getHomeAssistantSnapshot` after `listWork`. Await pending writes, read once, filter terminal work, join each item to its request, derive counts, sort display items by priority/creation/ID, separately select the descending creation/ID latest marker, and slice to 20. Return cloned plain objects and never call `exclusive()` or `writeState()`.

Use these exact semantics:

```js
const terminal = new Set(["completed", "declined", "cancelled"]);
const active = state.workItems.filter(item => !terminal.has(item.status));
const latest = [...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
const counts = {
  active: active.length,
  unacknowledged: active.filter(item => !item.acknowledgedAt).length,
  urgent: active.filter(item => item.priority === "urgent").length,
  waitingCustomer: active.filter(item => item.status === "waiting_customer").length
};
```

- [ ] **Step 5: Implement one-statement Neon snapshot reads**

Change the factory signature to `createNeonWorkRepository({ query = queryNeon } = {})`. Add a single CTE statement that selects active work, computes filtered counts and latest ID, selects the operationally ordered first 20 items, and returns them as JSON. The SQL must select only the fields required by `RawSummary`; do not select `payload`, `uploaded_files`, notes, events, request IDs, revisions, or operator columns.

Normalize a no-work result to zero counts, `latestCreatedId: null`, and `items: []`.

- [ ] **Step 6: Run adapter tests and verify GREEN**

Run: `node --test tests/contract/work-repository.contract.test.mjs tests/unit/home-assistant-neon-adapter.test.mjs`

Expected: all adapter and non-mutation tests PASS.

- [ ] **Step 7: Commit adapters**

```bash
git add lib/work-management/adapters/local-work-repository.js lib/work-management/adapters/neon-work-repository.js tests/contract/work-repository.contract.test.mjs tests/unit/home-assistant-neon-adapter.test.mjs
git commit -m "feat: read bounded work snapshots"
```

### Task 3: Dedicated Machine Authentication and HTTP Endpoint

**Files:**
- Create: `lib/home-assistant-auth.js`
- Create: `api/home-assistant-work.js`
- Create: `tests/unit/home-assistant-api.test.mjs`

**Interfaces:**
- Consumes: `runtime.service.homeAssistantSnapshot()` and `HOME_ASSISTANT_TOKEN`.
- Produces: `createHomeAssistantWorkHandler({ runtime?, token? })` and Vercel `GET /api/home-assistant-work`.

- [ ] **Step 1: Write failing endpoint tests**

Use the existing in-memory response helper pattern and a runtime spy. Cover:

```js
await handler({ method: "GET", headers: { authorization: `Bearer ${token}` } }, res);
assert.equal(res.statusCode, 200);
assert.equal(res.headers.get("cache-control"), "no-store");
assert.deepEqual(JSON.parse(res.body), snapshot);
assert.equal(snapshotCalls, 1);
```

Add cases for missing header, wrong scheme, wrong token, extra bearer text, missing configured token, POST, repository rejection containing a sentinel secret, and logs/body that do not contain the sentinel. Assert unauthorized requests never call the runtime.

- [ ] **Step 2: Run endpoint tests and verify RED**

Run: `node --test tests/unit/home-assistant-api.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `api/home-assistant-work.js`.

- [ ] **Step 3: Implement timing-safe bearer authentication**

In `lib/home-assistant-auth.js`, parse exactly one `Bearer <token>` value, require a configured token of at least 32 characters, compare SHA-256 digests with `timingSafeEqual`, and throw generic `HttpError` values:

```js
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";

const digest = value => createHash("sha256").update(value, "utf8").digest();

export function authorizeHomeAssistant(req, configuredToken = process.env.HOME_ASSISTANT_TOKEN) {
  if (!configuredToken || configuredToken.length < 32) throw new HttpError(503, "Home Assistant integration is unavailable.");
  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? req?.headers?.get?.("authorization");
  const match = /^Bearer ([^\s]+)$/.exec(String(header ?? ""));
  if (!match || !timingSafeEqual(digest(match[1]), digest(configuredToken))) {
    throw new HttpError(401, "Authentication is required.");
  }
}
```

- [ ] **Step 4: Implement the GET-only handler**

Build the runtime with `resolveWorkManagementRuntime()`, call authorization before the service, set `Cache-Control: no-store`, and return the snapshot. Catch expected `HttpError` values through existing HTTP helpers. Catch unknown/provider failures separately, log only `Home Assistant work snapshot failed.`, and send `{ error: "Home Assistant integration is temporarily unavailable." }` with status 503.

Do not add CORS headers: Home Assistant is a server-to-server client.

- [ ] **Step 5: Run endpoint and architecture tests**

Run: `node --test tests/unit/home-assistant-api.test.mjs tests/unit/home-assistant-snapshot.test.mjs && node scripts/check-architecture.mjs`

Expected: all tests PASS and zero architecture violations.

- [ ] **Step 6: Commit the endpoint**

```bash
git add lib/home-assistant-auth.js api/home-assistant-work.js tests/unit/home-assistant-api.test.mjs
git commit -m "feat: expose authenticated Home Assistant snapshot"
```

### Task 4: Home Assistant Package, Dashboard, and Static Guardrails

**Files:**
- Create: `integrations/home-assistant/package.yaml`
- Create: `integrations/home-assistant/dashboard.yaml`
- Create: `integrations/home-assistant/README.md`
- Create: `tests/unit/home-assistant-config.test.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: version-1 JSON from `GET /api/home-assistant-work` and secret `three_d_print_work_authorization`.
- Produces: entities `sensor.three_d_print_work`, `sensor.three_d_print_active`, `sensor.three_d_print_unacknowledged`, `sensor.three_d_print_urgent`, `sensor.three_d_print_waiting_customer`, and `sensor.three_d_print_latest_work`; persistent notification ID `three_d_print_new_work`.

- [ ] **Step 1: Write failing configuration guardrail tests**

Read the three integration files and assert:

```js
assert.match(packageYaml, /resource:\s*https:\/\/3dprint4\.me\/api\/home-assistant-work/);
assert.match(packageYaml, /Authorization:\s*!secret three_d_print_work_authorization/);
assert.match(packageYaml, /scan_interval:\s*60/);
assert.match(packageYaml, /persistent_notification\.create/);
assert.match(packageYaml, /https:\/\/work\.3dprint4\.me\/work\//);
assert.match(dashboardYaml, /https:\/\/work\.3dprint4\.me\//);
assert.doesNotMatch(`${packageYaml}\n${dashboardYaml}`, /operator-work-update|acknowledge|set-status|add-note/);
```

Also assert `HOME_ASSISTANT_TOKEN` does not occur under `public/` or `operator/`, and that validation's forbidden browser-secret list includes it.

- [ ] **Step 2: Run the config test and verify RED**

Run: `node --test tests/unit/home-assistant-config.test.mjs`

Expected: FAIL because the integration files do not exist.

- [ ] **Step 3: Create the Home Assistant package**

Define one top-level `rest:` resource with `scan_interval: 60`, the secret authorization header, `timeout: 10`, and a sensor whose state is `value_json.counts.active` and whose JSON attributes are `generatedAt`, `queueUrl`, `counts`, `latestCreatedId`, and `items`.

Define template sensors for the four counts and latest work ID. Give count sensors `state_class: measurement` and icon names under `mdi:`. Keep `items` only as an attribute of the REST sensor to avoid oversized entity state.

Define an automation triggered by changes to `sensor.three_d_print_latest_work`. Its conditions reject `unknown`, `unavailable`, `none`, empty, and unchanged states. Its action calls `persistent_notification.create` with a stable notification ID, an operational-summary message, and a Markdown link built from the allowlisted work ID:

```yaml
message: >-
  New work is available.
  [Open it in the operator inbox](https://work.3dprint4.me/work/{{ trigger.to_state.state }})
```

Set `initial_state: true` and document that the first successful poll after installation establishes state; it does not invoke any remote write.

- [ ] **Step 4: Create the dashboard**

Use core cards only. Show count entities in an `entities` card and render active items in a `markdown` card with Jinja. Every rendered item must be a Markdown link to the API-provided canonical `item.url`; provide a fixed queue link for the empty state and heading. Do not add service calls or mutation buttons.

- [ ] **Step 5: Document installation and optional mobile delivery**

Document package inclusion, the exact `secrets.yaml` key, Home Assistant configuration validation, restart, dashboard raw-configuration inclusion, and the fact that the persistent notification is the baseline alert. Give an explicit optional automation action example using a concrete illustrative `notify.mobile_app_owner_phone` entity and explain that the owner must replace that entity ID with the target exposed by their Companion App. Keep its `url` fixed to the work item.

Document token generation with `openssl rand -base64 48`, coordinated rotation, 401/503 meanings, privacy exclusions, and removal steps.

- [ ] **Step 6: Add integration checks to validation**

In `scripts/validate.mjs`, add the integration files to required root artifacts, scan public and operator browser assets for `HOME_ASSISTANT_TOKEN`, and enforce endpoint URL, `!secret`, interval, canonical links, and forbidden mutation-route absence. These checks duplicate the focused test intentionally so `npm run validate` protects release builds.

- [ ] **Step 7: Run configuration and validation tests**

Run: `node --test tests/unit/home-assistant-config.test.mjs && npm run validate`

Expected: tests PASS and static/architecture validation PASS.

- [ ] **Step 8: Commit Home Assistant configuration**

```bash
git add integrations/home-assistant scripts/validate.mjs tests/unit/home-assistant-config.test.mjs
git commit -m "feat: add Home Assistant dashboard and alerts"
```

### Task 5: Operations Documentation and Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/VERIFICATION.md`

**Interfaces:**
- Consumes: the completed endpoint and integration artifacts.
- Produces: deployment, rotation, incident, and production-verification runbooks.

- [ ] **Step 1: Document the server-only environment contract**

Add to `.env.example`:

```dotenv
# Read-only Home Assistant work snapshot. Server-only; store the matching Bearer value in HA secrets.yaml.
HOME_ASSISTANT_TOKEN=replace-with-at-least-32-random-characters
```

Document the API boundary and privacy-minimized snapshot in `ARCHITECTURE.md`.

- [ ] **Step 2: Document deployment and rotation**

In `DEPLOYMENT.md`, add exact Vercel configuration, secret-generation, Home Assistant installation order, coordinated rotation, and rollback instructions. State that removing the Vercel variable fails closed with 503 and that the old token must return 401 after rotation.

- [ ] **Step 3: Document operational failure behavior**

In `OPERATIONS.md`, add checks for endpoint availability, stale `generatedAt`, 401/503 diagnosis, Home Assistant configuration validation, and the invariant that intake and the operator PWA remain authoritative and independent.

- [ ] **Step 4: Add a requirement-by-requirement verification checklist**

In `VERIFICATION.md`, add explicit proof for anonymous/wrong/correct token behavior, field allowlisting, synthetic request visibility, one alert and exact deep link, repeated-poll non-mutation, terminal removal, and coordinated rotation recovery.

- [ ] **Step 5: Run the complete automated suite**

Run: `npm test`

Expected: validation, all unit/contract tests, all browser tests, and the 193-point audit PASS.

- [ ] **Step 6: Inspect the final diff for secret and scope leaks**

Run:

```bash
git diff --check
git grep -n "HOME_ASSISTANT_TOKEN" -- public operator
git grep -nE "contact|email|phone|description|uploaded_files|notes|revision" -- api/home-assistant-work.js lib/work-management/home-assistant-snapshot.js integrations/home-assistant
```

Expected: `git diff --check` is clean; the browser-secret grep has no matches; any privacy-term matches occur only in explanatory documentation and never in the JSON projection.

- [ ] **Step 7: Commit documentation**

```bash
git add .env.example docs/ARCHITECTURE.md docs/DEPLOYMENT.md docs/OPERATIONS.md docs/VERIFICATION.md
git commit -m "docs: operate Home Assistant work peek"
```

- [ ] **Step 8: Perform production verification after deployment**

Set the generated `HOME_ASSISTANT_TOKEN` in Vercel, deploy, install the matching authorization value in Home Assistant, and use the spec's seven-step production checklist. Record timestamped evidence in `docs/VERIFICATION.md`. Do not mark the integration complete until the Home Assistant configuration checker passes and a real dashboard alert opens the exact synthetic item on `work.3dprint4.me` without changing its revision, acknowledgement, events, or outbox state.

