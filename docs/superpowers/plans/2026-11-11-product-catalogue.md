# Product catalogue implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Deliver a product-led shop, rendered galleries for every generator, exact preset links, and private admin promotion/render/publication.
**Architecture:** An isomorphic public snapshot contract feeds static shop pages and offline customizers. A separate authenticated catalogue context owns private drafts and durable render/release jobs; a trusted runner rebuilds safe geometry and publishes reviewed static projections.
**Tech stack:** Existing JavaScript/Node, Vite customizer, Python/Blender Cycles, existing Postgres and operator infrastructure.
**Spec:** `docs/superpowers/specs/2026-11-11-product-catalogue-design.md`.

## Global constraints

- Only `public/` is static output. No secret or private draft enters public data.
- No remote requests from `/customize/*`; bundle preset data and use same-origin images.
- Sensitive keys are prohibited in saved/public configurations; never render a customer's private model for publication.
- All ten public generators receive at least three distinct pictured launch configurations.
- Exact immutable product revisions override but preserve existing drafts.
- Existing four-service intake, no-integration recovery, estimate and payment semantics remain intact.
- Admin publication requires rights approval, matching render fingerprints, revision checks, and confirmed release evidence.
- Preserve light/dark/system theme, keyboard access, reduced motion, and 390px layouts.

## Review focus

- A conflicting saved draft must not replace the pictured product (Task 2).
- A withdrawn/mismatched/stale link must not silently open another configuration (Tasks 1–2).
- Schema-safe customer text can still be private; promotion must require explicit rewriting/inclusion (Task 4).
- A delayed render result for an older draft must not become publishable (Tasks 4–5).
- A failed or unavailable runner/deploy must leave the prior product live and the draft recoverable (Tasks 5–6).

## Task 1: Public catalogue contract and launch records

Files: create `public/assets/js/catalogue/{contract,products}.js`, `scripts/catalogue-seeds.mjs`, `tests/unit/product-catalogue.test.mjs`.

Interfaces: `validateProduct(record, { getGenerator }) -> normalized public product`; `productHref(product, { request }) -> same-origin generator path`; `resolveProductLink(generator, search, products) -> { status, product?, params? }`. Product records use `id`, `revision`, `generatorId`, `generatorVersion`, `params`, `title`, `category`, `summary`, `images`, and `status`.

- [ ] Write failing tests for schema validation, immutable-link resolution, malformed/withdrawn/mismatched/version-stale references, sensitive field rejection, and forbidden image URLs.
- [ ] Run `node --test tests/unit/product-catalogue.test.mjs` and observe missing implementation.
- [ ] Implement contract and derive 30 safe launch candidates from the approved existing design IDs. Normalize full non-sensitive parameters, independent of mutable defaults.
- [ ] Run focused tests; verify every seed's generator version and params against the real registry.
- [ ] Commit the contract, seed source, generated public records, and tests.

## Task 2: Exact preset initialization and gallery rendering

Files: create `customizer/framework/product-start.js`; modify `app.js`, `designs.js`, `explore-ui.js`, `catalog.js`, and `customizer/styles.css`; tests `tests/unit/product-start.test.mjs` and `tests/e2e/test_product_catalogue.py`.

Interfaces: `initialProductState(generator, search, draft, products) -> { params, product, error, preserveDraft }`; extend existing designs with published product revisions and render their images. Explicit links validate before form/build and take precedence over drafts. Never save over a preserved draft until the user explicitly chooses to do so.

- [ ] Test conflicting draft, empty sensitive defaults, invalid-link recovery, and ordinary-navigation draft behavior before implementation.
- [ ] Implement initialization, visible product context/error recovery, and gallery selection through existing undo/build controls.
- [ ] Test choosing a card builds its exact params; confirm offline same-origin startup and preserved draft behavior.
- [ ] Build/version assets and commit.

## Task 3: Rendered shop and request flow

Files: extend `scripts/{export-product-render-meshes.mjs,render-products.py,finish-product-renders.py}` with catalogue recipes, create `scripts/build-catalogue.mjs`, `public/shop/index.html`, `public/assets/{js,css}/catalogue.*`; update home/nav and sitemap. Tests: render pipeline unit tests and catalogue E2E.

Interfaces: deterministic recipes from public revision snapshots; each output image corresponds to the configuration hash. Build static `/shop/<id>/` detail pages and local assets. Request links use `productHref(..., { request: true })` and generator review/continue, never upload defaults behind the image.

- [ ] Test recipe validation rejects secrets and mismatched images; test static output URLs and escaped public copy.
- [ ] Extend the existing Blender studio without changing its physical geometry. Render all 30 seeds and extra angles needed for shape clarity; inspect review boards.
- [ ] Implement filterable shop/category browsing, product details, clear render/quote disclosures, and request/customize links.
- [ ] Add short product review/continue affordance once local model is built, preserving the ordinary handoff and downloadable fallback.
- [ ] Run E2E for browse → exact preset → build → private request; screenshots at 390px/desktop, both themes; commit.

## Task 4: Private catalogue drafts and operator promotion

Files: new `lib/product-catalogue/{domain,application,repository,composition}.js`, migration under existing DB migrations, operator API routes, `operator/assets/catalogue.js`, and work-detail integration. Load Postgres skill before migration authoring.

Interfaces: revision-bound create/edit/approve/withdraw commands; safe promotion reads server-side work provenance and allowlists geometry/color values while requiring explicit public text/rights review. Operator list/detail API returns only to authorized merchandising identities.

- [ ] Add tests for forbidden/unknown sensitive values, private text defaults, custom fonts/artwork, stale generator versions, authorization, concurrent edits, idempotency and provider failure redaction.
- [ ] Implement draft persistence and private work-reference separation, command validation and explicit unconfigured behavior.
- [ ] Implement admin list, create-from-work, public-field editing and rights evidence UI; verify partner/customer roles cannot publish.
- [ ] Run repository/application/API tests, operator E2E and screenshots; commit.

## Task 5: Durable render/release runner

Files: catalogue job repository/application, trusted `scripts/catalogue-worker.mjs`, private preview route and existing platform job composition. Use the Task 3 studio pipeline.

Interfaces: lease/heartbeat/finish job commands bind draft revision plus config/build/scene hash. Render jobs rebuild safe configuration, never use submitted attachments. Release outbox serializes reviewed snapshots and final images through the existing repository/deployment route; deployment settings stay private.

- [ ] Test stale results, expired leases, duplicate job completion, bounded retry/cancel, worker restart, unconfigured Blender/deploy, malicious paths/camera values, and redacted failure behavior.
- [ ] Implement durable queue, private image review, publish readiness and release status; keep prior published snapshot live until verified deployment.
- [ ] Implement runner with allowlisted commands and atomic public projection; test actual render and release adapters with controlled local destinations before external publication.
- [ ] Add admin build/retry/review/publish/withdraw controls and E2E through durable publication; commit.

## Task 6: Documentation, full regression and completion audit

Files: update `docs/{GENERATORS,ARCHITECTURE,DOMAIN-LANGUAGE,DEPLOYMENT,OPERATIONS}.md`, privacy wording and runner configuration examples; maintain this plan/ledger.

- [ ] Document seed maintenance, permission requirements, render/release setup, recovery, and truthful unavailable states.
- [ ] Run `npm run customizer:build && npm run assets:version`, `npm test`, and `npm run screenshots`; inspect `screenshots/preview-board.png` and product/admin boards.
- [ ] Verify all spec completion evidence, including secrets, non-sensitive PII, offline requests, actual image/configuration match, short request flow and admin promotion/render/publish/withdraw.
- [ ] Request whole-branch fresh review; fix material findings with regression coverage.
- [ ] Report remaining integration prerequisites explicitly; mark the goal complete only when its full end state is proven.

## Execution ledger

- 2026-11-11: User continuation treated as design approval and authorization to implement. Reusing clean existing linked render worktree on new `feat/product-catalogue`; upstream HEAD is `1184b5d`, so no integration-base guessing is needed. Unrelated root-worktree changes remain untouched.
- Baseline: `npm test` running, output `.private/catalogue-baseline.log`.
