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
- Baseline completed: 1,446 unit/contract tests passed; 528 E2E passed, 7 skipped; accessibility audit 241/241. Output `.private/catalogue-baseline.log`. Changes made during the long E2E run require a fresh final full suite.
- Task 1 implemented and committed; focused contract tests passed. Task 2 startup/draft isolation and Task 3 shop/request flow implemented; three real browser tests passed, including offline 3MF metadata and private intake handoff.
- Visual ruling: render review showed closed launch vases and a visually repetitive desk name plate. Use hollow construction for all vase launch products and office instead of desk; add a second camera for every product. Sixty catalogue images were rendered successfully; the full second board still needs visual review.
- Task 4 draft domain/application, local/native repositories, private migration and owner API/editor implemented. Focused native RLS/concurrency/replay tests and the real owner promote/edit/reopen browser test pass. Migration is authored, not applied to production.
- Task 5 render execution/leases, retries, authenticated image review, private safe-settings inspection and worker CLI are implemented. Real Blender adapter proof and real admin promote→render→review→approve integration passed. Deployment-confirmed publish/withdraw remains outstanding; runtime publication capability stays false.
- Publication domain rules and immutable projection merging are implemented with tests. The release adapter, durable publisher job handling, UI publication/withdrawal and confirmed deployment proof are the next work; do not substitute a manual-only release for the admin workflow.
- Regression run v2: 1,479 unit/contract tests passed. E2E: 526 passed, 7 skipped, 6 failures; three expected assertions/inventory updates and one real 320px utility-layout regression were corrected, two resource-related cases passed unchanged. All six passed on focused rerun. Final all-suite verification after remaining work is still required.
- Screenshot workflow v3 captured all 12 new shop/product/review views but later timed out on an existing pumpkin capture while the full browser suite ran concurrently. Default pumpkin startup reproduced three times at ~3.3s afterward; rerun the full screenshot workflow without competing browser workloads and inspect the resulting board. Do not mask actual page errors or silently increase timeouts.
- Final media regeneration completed successfully (session `98871` exit 0): 68 studio views, with all shipped-media/recipe receipt tests passing. All four sections of the 68-image review board were visually inspected. No renderer restart is needed unless geometry/studio inputs change.
- Current focused checkpoint: 57 catalogue/deployment/receipt tests passed; five real customer/admin E2E tests passed; the opt-in real Blender integration passed including private safe-settings inspection in a new generator tab. Product reload/back resumes its own non-sensitive edits; fresh gallery navigation starts as pictured. Home category tiles now lead into pictured collections.
- Accessibility audit now covers shop and product detail and passes 289/289. Its lazy-image preparation was corrected to eager-decode a stable DOM list, including images inside closed galleries, rather than scrolling invisible/dynamically renumbered locators.
- The isolated final screenshot workflow is live in exec session `51140`, log `.private/catalogue-screenshots-final.log`; recent captures have progressed past all pumpkin states into display signs. Poll that handle before retrying. When it finishes, inspect `screenshots/preview-board.png`; new customer pages have also been captured at desktop/390px in both themes. A fresh full regression run remains required after the unfinished publication work.
- Official Git primary references for the release adapter were fetched successfully: `https://git-scm.com/docs/git-worktree` and `https://git-scm.com/docs/git-push` (local copies `.private/git-worktree-doc.html` and `.private/git-push-doc.html`). Use a dedicated private release worktree, ordinary fast-forward push, immutable per-release receipts, and deployment verification; never force-push over unrelated changes. No external push/deployment has been performed.
- Build/verification integration now generates static shop pages and preserves cache keys. QA shell copies must be regenerated when the shared operator client changes. Final full tests, screenshots/board inspection and whole-branch review remain outstanding.
