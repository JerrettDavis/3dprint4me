# Pragmatic Vertical Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor 3dprint4.me into documented, behavior-preserving feature slices with explicit domain, application, transport, and provider boundaries.

**Architecture:** Four bounded contexts—Project Request Intake, Quick Inquiry, Work Management, and Checkout—own their behavior and dependencies. Vercel handlers and browser entry points become thin composition/transport boundaries, provider selection moves to explicit composition roots, and automated fitness checks enforce inward dependencies.

**Tech Stack:** Node.js 22 ES modules, Vercel Functions, vanilla browser ES modules, Neon Postgres, Vercel Blob, legacy Supabase REST/Storage, Resend, Stripe Checkout, Node test runner, pytest/Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-pragmatic-vertical-architecture-design.md`

## Global Constraints

- Only `public/` is static output; no secret or server module may enter it.
- Customer files remain private by default.
- Browser estimates remain non-binding and every server payload is revalidated.
- All four service paths must omit unrelated fields.
- No-integration mode must preserve a customer-recoverable request.
- Light, dark, system theme, keyboard focus, reduced motion, and 390-pixel behavior must remain intact.
- Provider failures must expose neither credentials nor raw internals.
- Do not add analytics or tracking.
- Stripe return URLs never verify payment.
- Preserve Neon/Blob, legacy Supabase, delivery-only, and local-development modes.
- Run `npm test` after each production slice and `npm run screenshots` after any visible browser change.

---

### Task 1: Architecture Fitness and Domain Documentation

**Files:**
- Create: `scripts/check-architecture.mjs`
- Create: `tests/unit/architecture.test.mjs`
- Create: `docs/adr/0001-feature-oriented-bounded-contexts.md`
- Create: `docs/DOMAIN-LANGUAGE.md`
- Modify: `scripts/validate.mjs`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Produces: `checkArchitecture({ root }) -> { filesChecked, violations }`
- Produces: executable architecture validation through `npm run validate`
- Consumes: the dependency rules and bounded-context language from the approved spec

- [ ] **Step 1: Write failing architecture tests**

Add tests that build temporary fixture trees and prove the checker rejects: a public module importing `lib/`; a `lib/<feature>/domain.js` importing a provider package; a `lib/<feature>/<use-case>.js` importing from `api/`; and an API transport directly importing `@neondatabase/serverless`, `@vercel/blob`, or `web-push`. Add a passing fixture showing an API importing a feature composition root and a use case importing a sibling domain module.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/unit/architecture.test.mjs`

Expected: FAIL because `scripts/check-architecture.mjs` does not exist.

- [ ] **Step 3: Implement the dependency checker**

Export a pure `checkArchitecture` function. Walk tracked JavaScript beneath `public/`, `api/`, and feature directories under `lib/`; parse static import specifiers; normalize relative paths; and return stable `{ file, rule, import }` violations. Keep the checker conservative: enforce dependency direction and forbidden provider imports, not line counts or naming aesthetics. Its CLI prints violations and exits nonzero.

- [ ] **Step 4: Connect validation and document the architecture vocabulary**

Call the checker from `scripts/validate.mjs`. Write the ADR with context, decision, alternatives, consequences, and rollback. Define Project Request, Quick Inquiry, Work Item, submission, completion, delivery, notification, checkout proof, operator, revision, outbox, and bounded-context ownership in `docs/DOMAIN-LANGUAGE.md`. Update `CONTRIBUTING.md` with the SDD → BDD → TDD workflow and dependency rules.

- [ ] **Step 5: Verify and commit**

Run:

```text
node --test tests/unit/architecture.test.mjs
npm run validate
npm test
```

Expected: all pass with no architecture violations.

Commit: `test: enforce architecture boundaries`

---

### Task 2: Project Request Server Slice

**Files:**
- Create: `lib/project-request/domain.js`
- Create: `lib/project-request/runtime.js`
- Create: `lib/project-request/create-project-request.js`
- Create: `lib/project-request/authorize-project-upload.js`
- Create: `lib/project-request/complete-project-request.js`
- Create: `lib/project-request/handler.js`
- Create: `lib/project-request/upload-handler.js`
- Create: `tests/unit/project-request.test.mjs`
- Modify: `api/request.js`
- Modify: `api/upload-url.js`
- Modify: `tests/unit/checkout.test.mjs`
- Modify: `tests/e2e/test_api.py`
- Modify: `tests/e2e/test_order_flow.py`

**Interfaces:**
- Produces: `createProjectRequestUseCase(deps) -> async execute(body)`
- Produces: `authorizeProjectUploadUseCase(deps) -> async execute(body)`
- Produces: `completeProjectRequestUseCase(deps) -> async execute(body)`
- Produces: `createProjectRequestHandler(deps?)` and `createProjectUploadHandler(deps?)`
- Produces: `createProjectRequestRuntime(env?)`
- Consumes: current validation, Neon, Supabase, Blob, notification, local operator, checkout-token, and Push-trigger adapters

- [ ] **Step 1: Characterize use-case behavior with injected fakes**

Write Given/When/Then-named tests for: ignored honeypot; Neon draft creation; Supabase draft creation; delivery-only and local modes; private Blob upload; Supabase signed upload; atomic Neon/work completion; local-operator completion; independent notification failure; and checkout proof only after a confirmed integration. Assert that malformed bodies are rejected by server normalization even when a fake repository would accept them.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/unit/project-request.test.mjs`

Expected: FAIL because the feature modules do not exist.

- [ ] **Step 3: Extract domain-facing request and upload operations**

Move request-ID generation, integration-mode selection, and application orchestration into the feature. Keep `lib/validation.js` as the initial normalization implementation but re-export only feature-owned domain operations from `domain.js`. Inject `newRequestId`, repositories, file store, notifier functions, recorder, checkout proof issuer, and Push trigger so tests require no environment mutation.

- [ ] **Step 4: Add the runtime composition root**

Create a capability-based runtime once per handler construction. Adapt Neon/Blob, Supabase, delivery-only, local recorder, and local work store to stable method names. Ensure absent optional notification capabilities resolve honest `{ delivered: false }` outcomes and configured-provider failures remain isolated during completion.

- [ ] **Step 5: Make HTTP handlers thin**

Move bounded body parsing, method/action agreement, use-case invocation, and response serialization to feature handler factories. Reduce `api/request.js` and `api/upload-url.js` to imports plus default handler exports. Preserve exported test seams where needed through factories, not global environment mutation.

- [ ] **Step 6: Verify request contracts and commit**

Run:

```text
node --test tests/unit/project-request.test.mjs tests/unit/checkout.test.mjs tests/unit/validation.test.mjs tests/unit/supabase.test.mjs
python -m pytest tests/e2e/test_api.py tests/e2e/test_order_flow.py tests/e2e/test_supabase_backend.py -q
npm test
```

Expected: every existing API response shape, private upload rule, four-service payload, recovery state, and safe failure assertion passes.

Commit: `refactor: extract project request server slice`

---

### Task 3: Project Request Browser Slice

**Files:**
- Create: `public/assets/js/order/model.js`
- Create: `public/assets/js/order/validation.js`
- Create: `public/assets/js/order/draft-store.js`
- Create: `public/assets/js/order/files.js`
- Create: `public/assets/js/order/client.js`
- Create: `public/assets/js/order/view.js`
- Create: `public/assets/js/order/controller.js`
- Create: `tests/unit/order-model.test.mjs`
- Create: `tests/unit/order-client.test.mjs`
- Modify: `public/assets/js/order.js`
- Modify: `tests/e2e/test_order_flow.py`
- Modify: `scripts/version-assets.mjs`

**Interfaces:**
- Produces: `projectRequestFromForm(form, estimate, files)`
- Produces: `createDraftStore(storage, key)`
- Produces: `createProjectRequestClient({ fetchImpl })`
- Produces: `createOrderController({ model, view, client, draftStore, files })`
- Consumes: `calculateEstimate`, `formatEstimate`, `buildRequestSummary`, public configuration, and shared toast behavior

- [ ] **Step 1: Add pure model, draft, and client tests**

Characterize unrelated service-field exclusion, consent/contact projection, storage-denied recovery, 4xx classification, uncertain PATCH completion, signed file upload shapes for Blob and Supabase, and local-reference behavior. Use Given/When/Then names and fake FormData/storage/fetch dependencies.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/unit/order-model.test.mjs tests/unit/order-client.test.mjs`

Expected: FAIL because the new browser modules do not exist.

- [ ] **Step 3: Extract pure browser responsibilities**

Move request projection to `model.js`, step rules to `validation.js`, local persistence to `draft-store.js`, and HTTP/upload protocol to `client.js` plus `files.js`. Pass browser globals as dependencies where unit tests need control. Preserve exact public response interpretation and customer copy.

- [ ] **Step 4: Extract accessible view and flow controller**

Move DOM rendering/focus behavior to `view.js` and state transitions to `controller.js`. Keep `order.js` as a composition entry point that queries the existing DOM, creates modules, handles payment-return presentation, and starts the controller. Do not change HTML or CSS unless required to preserve an existing accessible behavior.

- [ ] **Step 5: Version assets and verify visual behavior**

Run:

```text
npm run assets:version
node --test tests/unit/order-model.test.mjs tests/unit/order-client.test.mjs
python -m pytest tests/e2e/test_order_flow.py tests/e2e/test_cached_upgrade.py -q
npm test
npm run screenshots
```

Inspect `screenshots/preview-board.png` for desktop/mobile, light/dark, builder steps, and horizontal overflow. Expected: behavior and visuals match the pre-refactor baseline.

- [ ] **Step 6: Commit**

Commit: `refactor: slice project request browser flow`

---

### Task 4: Quick Inquiry Slice

**Files:**
- Create: `lib/quick-inquiry/domain.js`
- Create: `lib/quick-inquiry/create-inquiry.js`
- Create: `lib/quick-inquiry/complete-inquiry.js`
- Create: `lib/quick-inquiry/notify-inquiry.js`
- Create: `lib/quick-inquiry/runtime.js`
- Create: `lib/quick-inquiry/handler.js`
- Create: `tests/unit/quick-inquiry.test.mjs`
- Modify: `api/inquiry.js`
- Modify: `lib/inquiry-store.js`
- Modify: `lib/inquiry-validation.js`
- Modify: `tests/unit/inquiry.test.mjs`
- Modify: `tests/e2e/test_inquiry.py`

**Interfaces:**
- Produces: `createInquiryUseCase(deps)`
- Produces: `completeInquiryUseCase(deps)`
- Produces: `notifyInquiryUseCase(deps)`
- Produces: `createQuickInquiryHandler(deps?)`
- Consumes: inquiry repository, private Blob verifier, notification transport, clock, and ID/key functions

- [ ] **Step 1: Write behavior and notification-policy tests**

Cover owned draft replay, mismatched payload rejection, aggregate file bounds, verified attachment requirements, durable completion despite email failure, a maximum of three claims, one-minute spacing, a 23-hour window, immutable provider payload, and stable idempotency key.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/unit/quick-inquiry.test.mjs`

Expected: FAIL because the use cases do not exist.

- [ ] **Step 3: Extract domain policy and use cases**

Move validation ownership into the feature domain facade. Express retry eligibility as a pure policy consumed by tests and represented atomically by the repository query. Keep the complete notification payload persisted before send. Keep Blob paths private and verify uploaded objects before durable completion.

- [ ] **Step 4: Thin the API and repository boundary**

Make `api/inquiry.js` a default export from the feature handler. Keep SQL in the adapter, but rename operations around domain intent (`findOwnedDraft`, `createDraft`, `completeDraft`, `claimNotification`, `finishNotification`) instead of exposing row mechanics.

- [ ] **Step 5: Verify and commit**

Run:

```text
node --test tests/unit/quick-inquiry.test.mjs tests/unit/inquiry.test.mjs tests/unit/inquiry-client.test.mjs
python -m pytest tests/e2e/test_inquiry.py -q
npm test
```

Commit: `refactor: extract quick inquiry slice`

---

### Task 5: Work Management Slice

**Files:**
- Create: `lib/work-management/domain.js`
- Create: `lib/work-management/service.js`
- Create: `lib/work-management/runtime.js`
- Create: `lib/work-management/adapters/neon-work-repository.js`
- Create: `lib/work-management/adapters/local-work-repository.js`
- Create: `tests/unit/work-management.test.mjs`
- Create: `tests/contract/work-repository.contract.mjs`
- Modify: `lib/work-validation.js`
- Modify: `lib/work-store.js`
- Modify: `lib/local-work-store.js`
- Modify: `api/operator-work.js`
- Modify: `api/operator-work-update.js`
- Modify: `api/operator-push.js`
- Modify: `api/operator-session.js`
- Modify: `tests/unit/work-store.test.mjs`
- Modify: `tests/unit/operator-work-api.test.mjs`

**Interfaces:**
- Produces: `createWorkManagementService({ repository })`
- Produces: `createNeonWorkRepository({ query })`
- Produces: `createLocalWorkRepository({ path })`
- Produces: shared repository contract suite
- Consumes: operator authorization, work-domain command/query parsing, Push delivery worker

- [ ] **Step 1: Add service and adapter contract tests**

Run equivalent scenarios against Neon query fakes and the local JSON repository: minimized lists; private detail; valid and invalid transitions; scheduling prerequisite; revision conflict; idempotent repeated action; note/event creation; outbox claim/finish; and operator authorization lookup. Add service tests proving handlers do not make domain decisions.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/unit/work-management.test.mjs tests/contract/work-repository.contract.mjs`

Expected: FAIL because the feature service and adapters do not exist.

- [ ] **Step 3: Establish domain and application boundaries**

Move workflow vocabulary, transitions, command/query normalization, and Push-subscription normalization behind `work-management/domain.js`. Add an application service that exposes list/detail/command/subscription/outbox operations and depends only on repository capabilities.

- [ ] **Step 4: Split persistence by cohesive responsibility**

Move Neon SQL and local JSON mechanics into feature adapters. Internally group operator access, work operations, and Push/outbox operations while allowing one composed repository object. Keep transactionally coupled completion/work/event/outbox creation atomic. Retain compatibility exports temporarily only for consumers migrated in later steps, then remove them.

- [ ] **Step 5: Recompose operator handlers and verify**

Build one runtime per handler factory. Preserve exact origin, authentication, authorization, no-store, minimized-list, private-detail, conflict, and safe-error contracts.

Run:

```text
node --test tests/unit/work-management.test.mjs tests/contract/work-repository.contract.mjs tests/unit/work-store.test.mjs tests/unit/operator-*.test.mjs tests/unit/push-*.test.mjs
python -m pytest tests/e2e/test_operator_api.py tests/e2e/test_operator_pwa.py tests/e2e/test_operator_workspace.py -q
npm test
```

- [ ] **Step 6: Commit**

Commit: `refactor: establish work management slice`

---

### Task 6: Checkout Slice

**Files:**
- Create: `lib/checkout/domain.js`
- Create: `lib/checkout/create-checkout-session.js`
- Create: `lib/checkout/stripe-adapter.js`
- Create: `lib/checkout/handler.js`
- Create: `tests/unit/checkout-use-case.test.mjs`
- Modify: `api/checkout.js`
- Modify: `lib/checkout-token.js`
- Modify: `tests/unit/checkout.test.mjs`

**Interfaces:**
- Produces: `createCheckoutSessionUseCase({ checkoutProvider, verifyProof, siteOrigin, depositAmount })`
- Produces: `createStripeCheckoutProvider({ fetchImpl, secretKey })`
- Produces: `createCheckoutHandler(deps?)`
- Consumes: completion-proof verification and shared HTTP/error primitives

- [ ] **Step 1: Write checkout use-case tests**

Cover trusted origin, bounded amount, proof required and customer-bound, provider request method/headers/body, generic provider rejection, credential-safe network failure, and a success URL that says only that the browser returned from checkout.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/unit/checkout-use-case.test.mjs`

Expected: FAIL because the checkout feature modules do not exist.

- [ ] **Step 3: Extract domain, provider, and transport**

Keep HMAC proof issuing/verifying pure. Move Stripe protocol details into the adapter, deposit eligibility into the use case, and HTTP parsing/serialization into the handler factory. Make `api/checkout.js` a thin default export.

- [ ] **Step 4: Verify and commit**

Run:

```text
node --test tests/unit/checkout-use-case.test.mjs tests/unit/checkout.test.mjs
npm test
```

Commit: `refactor: extract checkout slice`

---

### Task 7: Consolidation, Documentation, and Release Verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/QUICK-INQUIRY.md`
- Modify: `docs/OPERATOR-INBOX.md`
- Modify: `docs/VERIFICATION.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: test paths and package scripts only where ownership has stabilized
- Remove: superseded compatibility modules/exports proven unused by static search and tests

**Interfaces:**
- Produces: documentation that matches deployed providers, current contexts, failure behavior, and verification counts
- Consumes: all completed feature slices and their tests

- [ ] **Step 1: Audit remaining imports, duplication, and stale terminology**

Search every JavaScript import and documentation reference. Remove dead compatibility exports only when no runtime, script, or test consumes them. Confirm `public/` contains no server or secret-bearing material. Confirm architecture checks cover all implemented feature paths.

- [ ] **Step 2: Update authoritative documentation**

Rewrite the architecture diagrams and request flow around current Neon/Blob production composition with legacy Supabase identified accurately. Synchronize Quick Inquiry, Operator Inbox, README, contribution rules, environment variables, recovery behavior, and deployment expectations. Replace stale verification status and counts with evidence from this release.

- [ ] **Step 3: Run the full local release gate**

Run:

```text
npm run assets:version
npm test
npm run screenshots
git diff --check
git status --short
```

Inspect `screenshots/preview-board.png`. Expected: validation passes, all unit/contract/E2E tests pass, audit remains 193/193 or higher, no visual regression exists, and only intended release artifacts are modified.

- [ ] **Step 4: Commit the release documentation**

Commit: `docs: align architecture and verification evidence`

- [ ] **Step 5: Push and verify origin/CI**

Push `main` to `origin/main`. Inspect the resulting GitHub Actions run to terminal success. Confirm local `HEAD`, `origin/main`, and the successful workflow SHA are identical. If CI fails, reproduce, add a failing regression test where applicable, fix, rerun the complete local gate, commit, push, and recheck.

- [ ] **Step 6: Completion audit**

For every completion item in the spec and every invariant in `AGENTS.md`, record the authoritative test, file, screenshot, runtime check, or CI result. Do not mark complete if any item has only indirect evidence.
