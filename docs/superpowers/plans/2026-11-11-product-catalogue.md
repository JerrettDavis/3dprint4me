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

- [x] Write failing tests for schema validation, immutable-link resolution, malformed/withdrawn/mismatched/version-stale references, sensitive field rejection, and forbidden image URLs.
- [x] Run `node --test tests/unit/product-catalogue.test.mjs` and observe missing implementation.
- [x] Implement contract and derive 30 safe launch candidates from the approved existing design IDs. Normalize full non-sensitive parameters, independent of mutable defaults.
- [x] Run focused tests; verify every seed's generator version and params against the real registry.
- [x] Commit the contract, seed source, generated public records, and tests.

## Task 2: Exact preset initialization and gallery rendering

Files: create `customizer/framework/product-start.js`; modify `app.js`, `designs.js`, `explore-ui.js`, `catalog.js`, and `customizer/styles.css`; tests `tests/unit/product-start.test.mjs` and `tests/e2e/test_product_catalogue.py`.

Interfaces: `initialProductState(generator, search, draft, products) -> { params, product, error, preserveDraft }`; extend existing designs with published product revisions and render their images. Explicit links validate before form/build and take precedence over drafts. Never save over a preserved draft until the user explicitly chooses to do so.

- [x] Test conflicting draft, empty sensitive defaults, invalid-link recovery, and ordinary-navigation draft behavior before implementation.
- [x] Implement initialization, visible product context/error recovery, and gallery selection through existing undo/build controls.
- [x] Test choosing a card builds its exact params; confirm offline same-origin startup and preserved draft behavior.
- [x] Build/version assets and commit.

## Task 3: Rendered shop and request flow

Files: extend `scripts/{export-product-render-meshes.mjs,render-products.py,finish-product-renders.py}` with catalogue recipes, create `scripts/build-catalogue.mjs`, `public/shop/index.html`, `public/assets/{js,css}/catalogue.*`; update home/nav and sitemap. Tests: render pipeline unit tests and catalogue E2E.

Interfaces: deterministic recipes from public revision snapshots; each output image corresponds to the configuration hash. Build static `/shop/<id>/` detail pages and local assets. Request links use `productHref(..., { request: true })` and generator review/continue, never upload defaults behind the image.

- [x] Test recipe validation rejects secrets and mismatched images; test static output URLs and escaped public copy.
- [x] Extend the existing Blender studio without changing its physical geometry. Render all 30 seeds and extra angles needed for shape clarity; inspect review boards.
- [x] Implement filterable shop/category browsing, product details, clear render/quote disclosures, and request/customize links.
- [x] Add short product review/continue affordance once local model is built, preserving the ordinary handoff and downloadable fallback.
- [x] Run E2E for browse → exact preset → build → private request; screenshots at 390px/desktop, both themes; commit.

## Task 4: Private catalogue drafts and operator promotion

Files: new `lib/product-catalogue/{domain,application,repository,composition}.js`, migration under existing DB migrations, operator API routes, `operator/assets/catalogue.js`, and work-detail integration. Load Postgres skill before migration authoring.

Interfaces: revision-bound create/edit/approve/withdraw commands; safe promotion reads server-side work provenance and allowlists geometry/color values while requiring explicit public text/rights review. Operator list/detail API returns only to authorized merchandising identities.

- [x] Add tests for forbidden/unknown sensitive values, private text defaults, custom fonts/artwork, stale generator versions, authorization, concurrent edits, idempotency and provider failure redaction.
- [x] Implement draft persistence and private work-reference separation, command validation and explicit unconfigured behavior.
- [x] Implement admin list, create-from-work, public-field editing and rights evidence UI; verify partner/customer roles cannot publish.
- [x] Run repository/application/API tests, operator E2E and screenshots; commit.

## Task 5: Durable render/release runner

Files: catalogue job repository/application, trusted `scripts/catalogue-worker.mjs`, private preview route and existing platform job composition. Use the Task 3 studio pipeline.

Interfaces: lease/heartbeat/finish job commands bind draft revision plus config/build/scene hash. Render jobs rebuild safe configuration, never use submitted attachments. Release outbox serializes reviewed snapshots and final images through the existing repository/deployment route; deployment settings stay private.

- [x] Test stale results, expired leases, duplicate job completion, bounded retry/cancel, worker restart, unconfigured Blender/deploy, malicious paths/camera values, and redacted failure behavior.
- [x] Implement durable queue, private image review, publish readiness and release status; keep prior published snapshot live until verified deployment.
- [x] Implement runner with allowlisted commands and atomic public projection; test actual render and release adapters with controlled local destinations before external publication.
- [x] Add admin build/retry/review/publish/withdraw controls and E2E through durable publication; commit.

## Task 6: Documentation, full regression and completion audit

Files: update `docs/{GENERATORS,ARCHITECTURE,DOMAIN-LANGUAGE,DEPLOYMENT,OPERATIONS}.md`, privacy wording and runner configuration examples; maintain this plan/ledger.

- [x] Document seed maintenance, permission requirements, render/release setup, recovery, and truthful unavailable states.
- [x] Run `npm run customizer:build && npm run assets:version`, `npm test`, and `npm run screenshots`; inspect `screenshots/preview-board.png` and product/admin boards.
- [x] Verify all spec completion evidence, including secrets, non-sensitive PII, offline requests, actual image/configuration match, short request flow and admin promotion/render/publish/withdraw.
- [x] Request whole-branch fresh review; fix material findings with regression coverage.
- [x] Report remaining integration prerequisites explicitly; mark the goal complete only when its full end state is proven.

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
- The isolated screenshot workflow `51140` completed successfully with 206 captures. Visual inspection of the mobile product page exposed a real conversion problem (both images preceding the title/actions); a follow-up now places the title first, hero next, request actions before specifications, and alternate views later. A real 390px E2E assertion failed before and passes after the change, including the request→handoff flow.
- The full screenshot refresh session `66514` terminated with exit 1 (`net::ERR_ADDRESS_IN_USE`) during customizer captures; log `.private/catalogue-screenshots-mobile-refresh.log`. It is no longer live. Inspect the resulting `screenshots/preview-board.png` (a very tall ~155MP board; crop relevant rows for readable inspection) and refreshed mobile/desktop product images. All four sections of the separate 68-image render board were already inspected.
- Checkpoint commit `3dd1223` contains the shop, all 60 images, exact preset handling, private promotion/editor/storage, trusted render worker, authenticated previews and publication domain tests. Follow-up mobile layout changes are being committed separately. Root-worktree invoice edits remain untouched.
- Remaining requirement audit: wire the publication/withdrawal commands and trusted release adapter into durable jobs/UI (including uncertainty and serialized release handling); carry optional product ID/revision and product-friendly title through private handoff/server provenance; make historical generator-version disposition compatible with the immutable snapshot/build policy; add current admin modal states to routine screenshot coverage; then rerun full tests/audit/screenshots and request whole-branch review. Neither a successful push nor pure publication-domain tests prove public deployment.
- Official Git primary references for the release adapter were fetched successfully: `https://git-scm.com/docs/git-worktree` and `https://git-scm.com/docs/git-push` (local copies `.private/git-worktree-doc.html` and `.private/git-push-doc.html`). Use a dedicated private release worktree, ordinary fast-forward push, immutable per-release receipts, and deployment verification; never force-push over unrelated changes. No external push/deployment has been performed.
- Build/verification integration now generates static shop pages and preserves cache keys. QA shell copies must be regenerated when the shared operator client changes. Final full tests, screenshots/board inspection and whole-branch review remain outstanding.

- Continuation checkpoint: product provenance carries bounded ID/revision and friendly title through private intake; 27 focused provenance/customization tests passed. No public identity is claimed by private previews.
- Publisher adapter implemented with actual temporary local Git integration tests: immutable merge/images, ordinary fast-forward push, credential-free receipt GET, pending deployment, restart reconciliation without duplicate commits, mismatched receipts and hostile configuration. Eight adapter tests pass, including durable publish then withdrawal through real local Git/receipt adapters.
- Application, job policy, worker kinds, runtime capability and owner publish/withdraw controls are wired. Native Postgres claim tests prove capability filtering and a serialized release lane, including pending receipt blocking other products. No remote migration, external push or deployment was performed.
- Ruling: unconfirmed publication jobs retry indefinitely while holding their product/release lane — a possibly delivered release must not become editable through attempt exhaustion — cost: an unavailable provider requires operator repair before later releases proceed.
- Ruling: historical versions may retain exact settings only if they still pass the current safety schema; they are hidden and never rebuilt by a newer generator — newly sensitive/unknown fields stop release for privacy review — cost: breaking schema changes require deliberate historical-record quarantine.
- Desktop light and 390px dark owner control E2E tests pass. Routine screenshots now include reviewed overview/actions, pending, published and withdrawn states at desktop/390px in light/dark (20 captures); mobile reviewed-actions image inspected. Customizer build and asset versioning passed. Full unit/contract run is in progress in session 4855; log .private/catalogue-unit-final.log. Final npm test, screenshot board inspection and fresh whole-branch review are still required.
- Fresh whole-branch review by catalogue_final_review covered 1184b5d..62a48cea, verdict with four Important fixes. Findings: launch-ID collision/unmanaged launch products; missing-preview UI recovery; invented deployment author; missing merchandising/alt/camera controls. All four are accepted for the single fix pass. No Critical privacy issue found. Declined remote deployment/credential authorization and physical fit/rights proofs remain external evidence requirements, not inferred from tests.
- Final: fixed launch management/collision — owner bootstrap/concurrent initializer/reserved promotion/withdrawal test RED→GREEN; existing private records remain authoritative and counters start from last public revision.
- Final: fixed deployment author — actual Git commit identity regression RED→GREEN; explicit validated author name/email required before enabling publication.
- Final: merchandising/camera/alt fields regression RED→GREEN (14 focused domain tests); bounded camera presets bind the private render fingerprint. Description, limitations, ordering and discovery visibility are public allowlisted fields.
- Ruling: immutable product ID doubles as URL slug, so owners change title/copy without renaming established links — preserves pinned link/history semantics — cost: a new URL requires a distinct product ID rather than an in-place slug rename.
- First final npm test passed 1,519 unit/contract tests; E2E run still in progress (session 22263). Four legacy home-link assertions failed and have been updated to the intentional shop collection routes. Additional final-fix changes require a fresh all-suite run afterward. Browser workflows remain sequential.
- Final: fixed missing-preview recovery — ready-preview endpoint 409 browser regression RED→GREEN; edit/rebuild/withdraw controls remain available, while approval/publication require available previews. Explicit form labels also cover camera selects.
- Final-fix focused browser run: 13 passed (product/shop paths, missing-preview recovery, four theme/viewport home-media cases). Real Blender integration: 2 passed in 29.74s, including lower-front camera, descriptive image alt text, private preview delivery, approval and safe settings inspection.
- First final all-suite run ended with 1,519 unit/contract passed; E2E 529 passed, 7 skipped, six legacy assertions failed (home tile routing and first-record assumptions after launch reconciliation). Updated all six expectations and disambiguated same-title owner products with visible IDs.
- Final: Ruling: remote deployment/migration and production identity authorization remain operator setup, not actions performed by this feature implementation — no external push/deploy is needed to verify the mechanism locally — cost: a deployment rehearsal with authorized infrastructure is still required before enabling it.
- Final: Ruling: physical fit, printability and legal rights cannot be certified by renders/tests; retain reviewed rights evidence and honest use limitations — cost: operator rights clearance and physical validation remain necessary for production work.


## Final completion evidence

- Final whole-project `npm test` completed with exit 0: 1,522 unit/contract tests passed, 536 E2E passed, 7 expected skips, and 289/289 accessibility checks passed. Log: `.private/catalogue-full-final2.log`.
- After that full regression, visual review identified the empty-title alt-text default. Its exact browser regression failed with `, primary studio view`, then passed after a one-line private-editor guard. All eight catalogue browser tests passed afterward, followed by static validation and the complete screenshot workflow. Backend/public behavior was unchanged by this final guard.
- Final `npm run screenshots` completed with exit 0: 230 captures, including 24 owner catalogue states covering fields/actions, pending, published and withdrawn at desktop/390px in light/dark. Log: `.private/catalogue-screenshots-final2.log`.
- Inspected four crops from the actual final `screenshots/preview-board.png`: desktop product/request, mobile dark shop/product, mobile owner fields/actions, and pending/published. Also inspected the current 390px first-screen product crop, complete mobile owner action image, fields image, and real Blender preview. Actions fit, text is readable, and release states are truthful. All four sections of the separate 68-view rendered-product board were inspected earlier.
- Real Blender integration passed two tests, including a non-default camera, owner image descriptions, private image receipt delivery, approval, safe inspection and public-preview 404 behavior. Actual local Git adapter tests prove durable publish and withdrawal plus receipt verification, restart reconciliation, immutable images/revisions and configured author identity.
- Fresh whole-branch review found four Important issues; all were fixed in one pass with RED→GREEN coverage. No Critical finding, deferred minor, or unresolved Important finding remains.
- Requirement audit complete: 30 products cover ten generators with 60 matching studio images; shop/detail/filter/pinned-link/request/offline paths work; provenance stays bounded and private; launch products and customer-derived drafts are owner-manageable; rendering and publication are durable and revision-bound; publication and withdrawal require public receipts; documentation and configuration describe failure recovery and prerequisites.
- Operational prerequisites remain explicit: apply migration 019 and configure the trusted private render/release host, authorized Git/deployment author, repository branch integration and public site before enabling publication. No remote migration, external push, merge or deployment was performed. Physical fit/rights verification remains an operator responsibility.

## Authorized landing and deployment

- User requested landing on origin/main and deployment. Pushed feature branch and opened PR #83. Storefront/operator preview and Workspace regressions passed, but the first hosted Verify run failed in native backup recovery: FORCE RLS prevented schema-owner pg_dump.
- Reproduced the export failure locally with disposable network-isolated PostgreSQL. Follow-up preserves enabled RLS/backend-only access and restores the established trusted schema-owner backup boundary. The native rehearsal now seeds/restores catalogue draft/command/job rows in both databases and passes. Six focused release/repository checks pass.
- Guarded native release archive checks and migration ordering now include migration 019, with a regression that failed before the rollout change. Production source inspection shows current service code is preserved; existing API/jobs/slicer are healthy.
