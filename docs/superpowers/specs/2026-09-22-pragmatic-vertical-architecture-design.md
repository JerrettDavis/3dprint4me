# Pragmatic Vertical Architecture Design

**Status:** Approved 2026-09-22

## Purpose

Refine 3dprint4.me into a clean, maintainable architecture without changing its product promise or replacing its static-first, serverless technology choices. The result must make domain behavior, application orchestration, provider integration, and HTTP/browser concerns independently understandable and testable while preserving every invariant in `AGENTS.md`.

This design applies Clean Architecture, DRY, SOLID, vertical slicing, domain-driven design (DDD), behavior-driven development (BDD), specification-driven development (SDD), and test-driven development (TDD) pragmatically. These are enforceable dependency and delivery practices, not reasons to add ceremonial layers.

## Decision

Organize the application around feature-oriented bounded contexts rather than global technical layers. The primary contexts are:

1. **Project Request Intake** — the detailed four-service request, rough estimate contract, draft creation, private upload authorization, completion, recoverable fallback, and customer notification.
2. **Quick Inquiry** — the lightweight homepage inquiry, ownership key, attachment verification, abuse controls, durable acceptance, and bounded notification retry policy.
3. **Work Management** — operator identity, work lifecycle, commands, notes, events, optimistic concurrency, and the Push notification outbox.
4. **Checkout** — deposit eligibility and Stripe Checkout session creation. Payment verification remains outside this context until a webhook-backed payment model exists.

Each context owns its domain vocabulary, application use cases, external ports, provider adapters, and tests. A small module does not need every possible layer; boundaries exist only where they isolate a real policy or dependency.

## Alternatives Considered

### Global Clean Architecture layers

Top-level `domain/`, `application/`, `infrastructure/`, and `interfaces/` directories would make dependency roles visually explicit. They would also scatter each customer behavior across the repository and work against vertical ownership at this project's scale. This option was rejected.

### Hotspot-only extraction

Splitting `public/assets/js/order.js`, `api/request.js`, and `lib/work-store.js` would reduce file size with minimal churn. It would not resolve repeated provider selection, ambiguous domain ownership, or inconsistent composition. This option was rejected as insufficient.

## Repository and Dependency Boundaries

`public/` remains the only storefront output. No server code, provider credential, or secret-bearing configuration may enter it or any browser bundle.

`api/` remains the Vercel HTTP transport boundary. A handler may validate HTTP method and encoding, parse a bounded request, invoke one application entry point, and serialize an expected result or error. It must not choose persistence providers, coordinate notification providers, or implement domain policy.

Server feature code lives beneath `lib/<feature>/`. A feature may contain:

```text
lib/<feature>/
  domain.js          # entities, values, policies, and transitions
  <use-case>.js      # one application behavior and its required ports
  ports.js           # dependency contract documentation when useful
  adapters/          # Neon, Blob, Supabase, Resend, Stripe, or local adapters
```

This shape is not mandatory ceremony. A focused provider wrapper may remain a single adapter module. Domain and use-case modules must not import Vercel request/response objects or provider SDKs. Adapters may depend inward on domain contracts; domain code never depends outward on adapters.

Cross-feature sharing is limited to stable HTTP primitives, safe normalization primitives, clocks and ID generation, and application error types. Domain rules must not accumulate in a generic `utils` module.

The operator application remains outside `public/`, on a separate origin, and retains its controller/view/port pattern. Private customer or session data must not enter browser storage or Cache Storage.

## Project Request Intake

### Use cases

`createProjectRequest`:

- applies honeypot behavior without persisting customer content;
- normalizes and validates the complete project request;
- generates a non-sequential request ID;
- persists a draft when the selected runtime supports persistence;
- records the development event only when explicitly enabled; and
- returns an honest integration mode and live-delivery state.

`authorizeProjectUpload`:

- validates request ID, filename, byte size, and content type;
- confirms that the request is a draft that still accepts uploads;
- creates a randomized request-scoped object path; and
- requests a private, non-overwriting upload instruction from the configured file-store port.

`completeProjectRequest`:

- revalidates the request and uploaded-file metadata;
- atomically submits the request and creates operational work where supported;
- records the development event only when enabled;
- independently attempts owner/customer email, webhook delivery, and the immediate Push trigger;
- treats optional notification failures as non-fatal after durable acceptance; and
- issues checkout proof only when persistence or delivery confirms receipt.

### Runtime composition

Provider selection occurs once in a composition root. It returns capabilities with one stable vocabulary:

```js
{
  mode,
  requestRepository,
  privateFileStore,
  workPublisher,
  customerNotifier,
  webhookNotifier,
  localRecorder
}
```

Optional integrations use explicit no-op capabilities that return honest outcomes. They do not throw merely because optional configuration is absent. Neon plus private Vercel Blob is the current production composition. The legacy Supabase repository/storage composition remains supported until a separate product decision removes it. Delivery-only and no-integration modes remain recoverable.

### Browser slice

The existing `public/assets/js/order.js` URL remains the entry point. Its responsibilities move behind focused modules:

```text
public/assets/js/order/
  model.js
  validation.js
  draft-store.js
  files.js
  client.js
  view.js
  controller.js
```

`model.js` owns form state and request projection. `validation.js` owns step-level browser guidance. `draft-store.js` owns recoverable local persistence. `files.js` owns selection metadata and upload orchestration. `client.js` owns the request HTTP contract. `view.js` owns accessible DOM rendering. `controller.js` coordinates the flow. The entry point creates dependencies and starts the controller.

`quote-engine.js` remains pure estimate-domain logic. All four service paths, unrelated-field exclusion, storage-denied behavior, local email/JSON recovery, accessibility, themes, reduced motion, and the 390-pixel layout remain unchanged.

## Quick Inquiry

Quick Inquiry remains a distinct aggregate and persistence contract rather than becoming a partial project request. Its application flow is:

```text
create or replay owned draft
  -> authorize and verify private uploads
  -> durably complete the inquiry
  -> atomically claim the immutable notification payload
  -> send with a stable provider idempotency key
```

Notification failure never reverses durable acceptance. Attempt count, minimum retry delay, maximum retry window, and stable-payload policy are domain policy exposed to tests instead of behavior hidden only in SQL. The database adapter still provides atomic claims and state changes.

## Work Management

Work Management exposes application operations for listing work, reading detail, applying commands, managing Push subscriptions, and draining the notification outbox. Commands include acknowledge, priority, target date, assignment, status transition, and private note.

The workflow graph, scheduling prerequisite, command normalization, and revision semantics are domain policy shared by Neon and local adapters. Atomic persistence, idempotency-key storage, event creation, outbox creation, leases, and row locking remain adapter responsibilities because they are transactional guarantees.

Persistence capabilities may be separated internally into operator, work, and Push concerns, but the composition root may expose a cohesive store to consumers. This prevents both a monolithic adapter and needless one-method repository objects.

## Checkout

Checkout session creation is an application use case with an injected Stripe port. Completion-proof verification remains pure application/domain logic. The server controls amount and trusted site origin. A browser return URL is presentation state only and must never verify payment or authorize fulfillment.

## Error Model and Recovery

Expected failures use stable application codes, including:

- `validation_failed`
- `request_not_found`
- `request_already_completed`
- `revision_conflict`
- `capability_unavailable`
- `provider_unavailable`

Transport adapters map application failures to HTTP status codes. Responses and logs must never expose provider response bodies, credential-bearing URLs, raw SQL details, secrets, or stack traces. Safe logs contain an operation name, provider category, status class, and opaque identifier when useful.

Browser recovery follows the failure category:

- correctable 4xx responses keep the form editable;
- uncertain completion offers retry and never claims the request was lost;
- an initial network or server failure preserves a local customer-recoverable copy;
- optional notification failure after persistence still confirms receipt honestly;
- checkout failure leaves the completed request intact; and
- authentication failure clears private operator state.

## Development Method

### SDD

Every architecture increment starts from an approved specification that states behavior, contracts, invariants, and migration boundaries. This document is the governing specification for the refactor.

### BDD

Material customer and operator behaviors are expressed as observable scenarios using Given/When/Then vocabulary in test names or nearby test documentation. No new Cucumber dependency is required. Behavior matters more than syntax.

### TDD

Each slice starts with a failing characterization, contract, or architecture test. Implementation moves behavior behind the new boundary with the smallest coherent change. The old path is removed only after the new tests and existing regression suite pass.

### Contract tests

Applicable adapters run shared behavioral assertions. Both Neon and legacy Supabase request repositories must, for example, reject repeated completion. Both Neon and local work stores must enforce equivalent workflow and revision behavior. Provider-specific protocol tests still assert URL shape, method, headers, timeouts, and safe failure behavior.

Tests migrate incrementally toward feature ownership:

```text
tests/
  unit/<feature>/
  contract/<port>/
  e2e/storefront/
  e2e/operator/
```

Existing test paths continue working until their production boundaries stabilize.

## Architecture Fitness Checks

Validation must fail when:

- browser/public code imports server modules;
- domain or use-case code imports Vercel request/response objects;
- domain modules import provider SDKs;
- thin API handlers directly import provider SDKs or concrete provider adapters outside the composition root;
- a secret-bearing file or server source is emitted beneath `public/`; or
- a new feature boundary lacks an owned test location or documentation.

Fitness checks enforce dependency direction, not arbitrary line counts. Existing CSP hashing, asset-version validation, public-output validation, and accessibility audit remain required.

## Documentation

- `docs/ARCHITECTURE.md` describes the current bounded contexts, dependency rules, runtime composition, data flow, and failure behavior.
- `docs/DOMAIN-LANGUAGE.md` defines aggregates, important values, states, invariants, and context boundaries.
- An architecture decision record captures the choice of feature-oriented slices over global technical layers.
- `CONTRIBUTING.md` documents the SDD-to-BDD-to-TDD workflow, test ownership, dependency rules, and completion gates.
- Provider/deployment documentation changes whenever an integration contract or operational procedure changes.
- `docs/VERIFICATION.md` records current evidence and must not retain stale launch status or obsolete test counts.

## Incremental Migration

1. Add architecture characterization, fitness checks, domain vocabulary, and current documentation.
2. Extract the Project Request server composition and create/upload/complete use cases; leave thin compatible HTTP handlers.
3. Extract the Project Request browser model, validation, persistence, files, client, view, and controller behind the current entry point.
4. Extract explicit Quick Inquiry use cases and notification policy while preserving storage and retry contracts.
5. Refine Work Management domain/application/persistence boundaries while preserving transaction and local/Neon parity.
6. Extract Checkout use-case and Stripe port boundaries.
7. Consolidate feature-owned tests and documentation; remove compatibility exports and duplication only after all consumers migrate.

Every increment must remain independently deployable and pass focused tests, `npm test`, and any visible-change screenshot inspection before it is integrated.

## Non-goals

- No framework rewrite, TypeScript migration, bundler replacement, ORM, containers, event bus, or microservices.
- No public API redesign unless an existing contract is unsafe.
- No database rewrite for architectural symmetry.
- No removal of legacy Supabase support without a separate product decision.
- No visual redesign during structural work.
- No analytics, tracking, public customer data, or client-side secrets.
- No payment-state model without verified Stripe webhooks.

## Completion Evidence

The refactor is complete only when:

1. the approved contexts and dependency rules are implemented rather than merely documented;
2. the ten invariants in `AGENTS.md` are covered by architecture or behavioral tests;
3. duplicated provider selection and application orchestration have one owned boundary;
4. the original intake and work-management hotspots have cohesive responsibilities;
5. unit, adapter contract, integration, E2E, accessibility, and architecture checks pass;
6. visible changes, if any, pass screenshot capture and manual preview-board inspection;
7. architecture, domain, contribution, deployment, and verification documentation agree with the code;
8. the worktree is clean, all commits are pushed to `origin/main`, and the resulting CI run is green; and
9. production failure behavior continues to preserve privacy, recoverability, and honest customer claims.
