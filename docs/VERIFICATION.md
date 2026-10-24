# Release Verification

## Filament matching coverage (2026-10-21)

Final local evidence on `feat/filament-inventory-matching`, rebased onto `origin/main` at `418f1fd`: 1,081 unit/contract tests passed; the full browser rerun passed 223 tests with one optional test skipped; UX audit passed 241/241. The changed brand/extraction/email paths also passed their nine focused tests. `npm run screenshots` produced 75 captures; the preview-board filament section and focused mobile light/dark, candidate, inventory, and approval-message captures were inspected. The operator static build and asset validation passed without changing the storefront release key.

The first integrated run exposed an outdated service-worker cache assertion, now updated and verified from v10 to v11. A subsequent parallel test/capture run hit Chromium `ERR_NO_BUFFER_SPACE` before a display-sign page loaded; the isolated test and a complete standalone browser rerun both passed. No customizer test was disabled or narrowed. Migration 010 includes restricted `platform_backend` grants/RLS policies, tested with that role and a denied visitor role. Production migration and real customer email delivery have not been performed.

`tests/unit/filament-color.test.mjs` covers HSL/RGB bounds, circular/asymmetric hue, neutral review, reference Lab values, progressive widening/hard stops, deterministic ties, and selected-stock sharing. `filament-requirements.test.mjs` covers color-count ambiguity, total-only demand, overrides, and sensitive/hidden generator-field exclusion. `filament-proposals.test.mjs` covers audited decisions, stale revisions/stock, copyable failure state, concurrent sends and the idempotent retry horizon. `operator-filament-api.test.mjs` checks owner writes, origin protection, work lookup, preview, and read-model failure isolation.

`tests/contract/filament-matching.contract.test.mjs` executes inventory/settings/work compare-and-swap on local JSON and real PostgreSQL SQL through PGlite. `substitution-email.contract.test.mjs` checks Resend endpoint/method/headers, recipient, escaping, idempotency and sanitized failures. `tests/e2e/test_operator_filament.py` drives inventory editing/deactivation, thresholds/preview, multiple candidates/further bands, requirement corrections, operator acceptance/reopening, pending email fallback, and 390px dark/reduced-motion layout. Screenshot capture includes filament inventory, matching, and pending approval states in the preview board.

## ZIP model packs â€” local verification (2026-10-05; production gate pending)

Branch `feat/zip-model-packs`, Windows 11 host, Playwright Chromium. In this checkout the customizer bundle is not built (`vite` is not installed), which accounts for every failure listed below. The same failures occur on a clean checkout and are not caused by this change.

```text
npm run assets:version                 asset release 654861fdbb36467b; the unrelated customizer/ rewrites were reverted
npm run validate                       version check: stale only for customizer/index.html and customizer/g/*/index.html (pre-existing)
node scripts/validate.mjs              6 issues, all customize/ build output missing (customizer:build not run)
node scripts/check-architecture.mjs    passed for 119 JavaScript files
node --test tests/unit/*.test.mjs tests/contract/*.test.mjs
                                       534 tests: 524 passed, 9 failed (all customize-*, bundle not built), 1 skipped
python -m pytest tests/e2e -q --ignore=tests/e2e/test_customize.py
                                       75 passed (tests/e2e/test_zip_model_pack.py: 7 of them)
python tests/audit/audit.py            stops at /customize/ (generator never reaches ready without the build);
                                       with the two /customize/ routes removed: 193/193 passed
npm run screenshots                    stops at the customize captures (404); the preview board was not rebuilt
```

`tests/e2e/test_zip_model_pack.py` builds its ZIPs with Python `zipfile` (stored and deflated ASCII STL cubes, an unmeasurable STL, a PNG, a Markdown file). It covers:

- the picker: rows, the disabled unmeasurable part, the "Not printed" list
- selection and quantity changing the planning range, quantity clamping, and the last-part rule
- keyboard order and Space toggling
- a `../x.stl` traversal ZIP failing generically and still submitting
- without integrations, the pack selection saved in the request text (`packParts`, `packIgnored`), and the "Packs are printed part by part" price note
- 390 px light and dark without horizontal overflow
- over real HTTP: one private PUT, the debounced `estimate-pack` preview, submit, only the selected parts attached with their quantities, and the operator sheet listing the ZIP, its ignored files and only those parts

The preview board does not include the ZIP picker. The picker was captured separately with the browser harness and inspected at desktop light, desktop dark, and 390 px light and dark: one column at 390 px, the disabled part dimmed, and the focus ring visible.

**Manual check with the reference pack** (`turn-tracker-print-pack-v2.zip`, not committed), run in `dev:workspace` with a scratch store:

- The picker listed 10 parts (base, chassis, keycap_E/R/S, latch_bar, lid, panel, plunger, yoke) and showed 8 PNGs, `ASSEMBLY.md` and `turn_tracker.scad` under "Not printed".
- The upload was verified privately. Deselecting `base` and setting `chassis` to 3 moved the range from $26â€“$44 to $38â€“$64.
- Submit succeeded. The operator inbox showed the ZIP with its ignored list and the 9 selected parts, `chassis` at quantity 3, each with a Download button.
- The server pack snapshot for that selection was $71â€“$88. The customer-facing range is the browser's planning figure and is not replaced by the server pack price.

**Final fix wave (same day).** The counts above are from after the fixes for the whole-branch review. A real-browser run on `scripts/dev-workspace.mjs` (`npm run dev:workspace`) used two synthetic ZIPs. It attached pack A, set a part to quantity 4, replaced it with pack B, deselected one part, set another to quantity 2, and submitted. Results:

- Only pack B's two selected parts were attached, with quantities 1 and 2.
- Pack A's ZIP row attached with no parts. The attach rules are unchanged; its parts were unselected when pack B's selection was recorded.
- The request carried `packParts: "2 of 3 parts: b/left.stl Ã—1; b/right.stl Ã—2"`.
- The operator sheet listed only `b/left.stl` and `b/right.stl` as parts.
- The pack price note was inspected in harness captures at 390 px, light and dark. It wraps normally under the slice copy and is legible in both themes.

**Pending before production use:** apply `006_model_packs.sql` to production Neon after 005 and before deploying this code; run a synthetic ZIP request against private Blob (upload, extraction, operator per-part download); confirm `npm run estimate:cleanup` reports `orphanedParts` for the unselected parts. None of these were performed.

## Customize section (parametric generators) â€” local verification (2026-10-03; production gate pending)

Branch `feat/generator-section`, Node 22.22.0, Windows 11 host, Playwright Chromium. Every number below comes from a run on this date.

```text
rm -rf public/customize && npm run vercel-build      exit 0
  Vite build of /customize, asset release 295d8d664ce2c0cd (48 files verified, no ?v= change)
  Static validation: 13 HTML pages, 129 local references, 261 JavaScript files;
  architecture boundaries for 127 JavaScript files; generator and no-remote-request gates

npm test                                             exit 0
  Static validation: PASS (same counts as above)
  Node unit and contract tests: 559 passed, 0 failed
  End-to-end (pytest): 118 passed (tests/e2e/test_customize.py: 57 of them)
  UX/accessibility audit: 241/241 passed

npm run screenshots                                  exit 0
  56 screenshots and screenshots/preview-board.png
```

What the new checks cover:

- `tests/unit/customize-all-generators.test.mjs` builds every registered generator's defaults and every preset on real Manifold WASM. Each build must be analyzer-clean (no warning other than `embedded_settings_ignored`), use 1â€“5 colors and finish in under 20 s. In Node the defaults take 5â€“110 ms. A canary in every sensitive field never appears in any inflated 3MF entry, the filename or a part name. The Wi-Fi tag defaults validate only once a password is supplied; the test allows a failure only on sensitive fields.
- `npm run validate` checks every generator for a page, a builder, a built page, `origin`, `version` and `rights`. A publishable generator also needs a sitemap entry, a catalog card and a screenshot entry. `public/customize/` may contain no remote URL or remote request, including protocol-relative `//host` URLs in HTML attributes (src, href, srcset, action, poster, data-src), CSS `url()`/`@import` and JS string literals; the site assets those pages load (site.css, shared.css, site.js and its imports, favicon, manifest) may not make a remote request either (their ordinary profile links are navigation, not requests). The gate logic lives in `scripts/generator-gates.mjs`, and `tests/unit/generator-gates.test.mjs` proves each gate fails on a fixture (missing built page, source page, sitemap entry, screenshot entry, rights note, publishable flag, origin, version, builder, catalog card; an unpublishable generator listed). Against the real tree each gate was also shown to fail when broken: an injected `fetch("https://evil.example/x")`, `url(//evil.example/â€¦)` in the bundle CSS and in shared.css, an `<img src="//evil.example/â€¦">` in a built page, a removed sitemap line, an empty `rights.note`, a missing screenshot entry.
- The E2E matrix runs every generator through four checks:
  - Full flow: page, edit, color badge, Continue, order page (`.3mf` chip and notice), submission through the local dev API. The local operator store and `data/dev-requests.ndjson` (create and complete events) then hold `customization.generatorId`. The typed Wi-Fi password appears in neither, nor in browser storage.
  - Offline: a build with every non-storefront request aborted; zero requests were attempted. The route provably sees the build worker's requests: it records the Manifold `.wasm` (fetched only by the worker), and aborting that `.wasm` through the same route makes the build fail.
  - Layout: 390 px dark with no horizontal scroll.
  - CSP: a `securitypolicyviolation` listener records no violation, on every generator page, the order page and the `/customize/` catalog. The listener was itself shown to fire on a provoked violation. It cannot see violations raised inside the build worker; a worker-side failure would instead stop the build from reaching ready.
- The all-generators test also builds a name plate in two curated fonts (Pacifico, Bebas Neue) and a rating card from a traced image, and checks warnings for sensitive canaries.
- The Wi-Fi QR code is also read back and decoded (jsQR) from the finished `buildModel` mesh, after mesh cleanup.

  Separate E2E checks cover the IndexedDB fallback (`IDBFactory.prototype.open` throws, so the 3MF downloads and the order page explains) and removing or replacing the handed-off model, which drops `customization` from the stored request.
- Local slicing of each generator's default model in the Bambu Studio worker image is recorded in [PRINT-ESTIMATION.md](PRINT-ESTIMATION.md#customizer-models).

**Pending before production use:** the owner-gated rollout in [DEPLOYMENT.md](DEPLOYMENT.md#customize-section-rollout-owner-gated). That covers a preview deployment and its live CSP, a printed and phone-scanned Wi-Fi tag, the slicer worker on jdh-docker-00, `SLICER_PROVIDER`, and a real customizer request end to end. None of these were performed.

## Print estimation â€” scheduled cleanup (production deployment pending)

The GitHub Actions workflow `.github/workflows/estimate-cleanup.yml` runs `npm run estimate:cleanup` on an hourly schedule. To enable it:

1. Add `NEON_DATABASE_URL` (same value as the storefront's `DATABASE_URL`) and `VERCEL_BLOB_TOKEN` (same value as the storefront's `BLOB_READ_WRITE_TOKEN`) to repository secrets.
2. Verify the workflow runs successfully in the Actions tab â€” the first run should show `sweep` results in the workflow logs.
3. Confirm cleanup logs appear in Vercel function logs, with no critical errors in the past 24 hours.
4. Verify that sessions and assets older than their retention TTL are removed by querying Neon directly or inspecting Blob storage metrics.

## Print estimation â€” local verification (2026-09-30; production gate pending)

`npm test` passed: static validation, 220 unit/contract tests, 61 browser/real-HTTP tests, and the 193/193 UX audit. `npm run screenshots` captured 28 views; the preview board was inspected, including the STL/3MF model panel (desktop light, 390 px dark) and the operator print sheet (desktop light, 390 px dark).

Coverage includes: pinned workbook calibration fixtures and dual-floor boundaries; filament cost selection; malformed STL, 3MF traversal, ZIP bomb, size-lying entries, DTD/entities, encryption, entry-count and expansion limits; browser/server parser parity; capability ownership, wrong-token and cross-session denial, server-side size/type limits, upload-before-analysis, per-session limits; the real Neon SQL (migration 004, attach-on-completion statement, immutability trigger, `SKIP LOCKED` job leases, retention, purge) executed on in-process PGlite; slicer CLI success/failure/timeout/invalid output and HTTP provider mapping; slicer failure never blocking submission; a real browser uploading the model exactly once and submitting without re-upload; operator detail, 60-second signed download, and recorded runs; and the work list/Home Assistant excluding file, estimate, and margin data.

**Pending before production use:** apply `004_print_estimation.sql` to production Neon; confirm `/api/health` reports `printEstimation: true`; verify a synthetic print request end to end against private Blob (upload, verification, operator download, cleanup); schedule `npm run estimate:cleanup`; optionally provision a slicer worker. None of these were performed in this change.

## Home Assistant work peek â€” release gate (production installed; synthetic alert pending)

Local tests and source review verify the endpoint, snapshot contract, and Home Assistant example. Production evidence below covers deployment and the installed empty-queue dashboard, but not synthetic-work alerts, phone delivery, terminal behavior, or the deliberate failure drills. Record a timestamp, deployment identifier, Home Assistant configuration-check result, synthetic work ID, HTTP status and response-header observations, and before/after work-state evidence for each check below. Never record token values or full private request data.

1. **Authentication and failure closure:** Against the deployed `GET /api/home-assistant-work`, record `401` for anonymous, malformed, and wrong bearer headers; `200` for the correct bearer header; `503` after a controlled removal of the Vercel variable; and `401` for an old token after coordinated rotation. Confirm `Cache-Control: no-store` and generic errors without credentials or raw provider details.
2. **Field allowlist:** Inspect the successful JSON keys. Top level must contain only `version`, `generatedAt`, `queueUrl`, `counts`, `latestCreatedId`, and `items`. The nested `counts` object must contain exactly `active`, `unacknowledged`, `urgent`, and `waitingCustomer`. Each item must contain only `id`, `title`, `service`, `status`, `priority`, `acknowledged`, `submittedAt`, `targetDate`, and `url`. Verify no contact, description, estimate, file metadata, notes, event history, or revision appears; URLs must use the fixed operator origin.
3. **Home Assistant configuration and visibility:** Install the package and matching `secrets.yaml` entry, run **Check configuration** successfully, and restart. Confirm a fresh `generatedAt` and the derived sensors. Create one labeled synthetic request through an authorized production intake path, record its work ID, and confirm it appears once in the active snapshot and dashboard. The initial successful poll must establish state without alerting for preexisting work; for alert testing, establish a baseline marker first and then create the synthetic item.
4. **Alert and exact link:** On the next poll, confirm exactly one `three_d_print_new_work` persistent notification for the new marker. Its link must open `https://work.3dprint4.me/work/<synthetic-work-id>` after operator sign-in, not merely the queue. If optional phone delivery is configured, verify its tap action opens the same exact URL. A repeated poll with the same marker must not alert again.
5. **Read-only proof:** Before and after dashboard refreshes, repeated polls, and opening the alert, compare the synthetic work revision, acknowledgement timestamp, event count/cursor, and notification outbox state in the authoritative operator/Neon records. They must be identical. No Home Assistant control may acknowledge or update the item.
6. **Terminal behavior:** Complete the synthetic item in the operator PWA. Verify it disappears from `items` and active counts decrease. `latestCreatedId` must remain the newest-created ID across all statuses, including when active work reaches zero; no false new-work alert may result from completion.
7. **Rotation and recovery:** Rotate the token in Vercel and Home Assistant in one maintenance window, redeploy/reload, and verify the new token returns `200`, the old token returns `401`, and the REST sensor resumes with a fresh `generatedAt`. During an intentional secret removal, verify the endpoint returns `503`; restore matching configuration and verify recovery. Record any temporary polling gap without claiming missed intermediate work was delivered.

**Production evidence (2026-09-23):** GitHub Actions run `35897154391` completed successfully for commit `97be22272eef9d8d8c2eb988e154ee1b89306f29`. Vercel production deployment `dpl_Y9ShTHBJ3eS5edjqGvm9vTtgch6y` reached Ready and was aliased to `https://3dprint4.me`; its build included `api/home-assistant-work`. A distinct 64-character bearer token was installed as the sensitive production `HOME_ASSISTANT_TOKEN` and as the Home Assistant `three_d_print_work_authorization` secret without recording its value. Home Assistant accepted the installed package and YAML dashboard with a clean **Check configuration** result and no warnings, then was restarted through the confirmed restart flow. The live `3D Print Work` dashboard rendered all four derived counts as `0`, showed the explicit `No active work` state, and exposed two links whose origins were both `https://work.3dprint4.me/`. The anonymous production endpoint returned HTTP `401`, while the available live REST-backed dashboard proves the matching Home Assistant credential can retrieve the production snapshot. The coordinated install also exercised one token rotation before the final deployment and restart; the discarded value was not retained or tested afterward.

This closes deployment, anonymous failure closure, Home Assistant configuration/visibility for an empty queue, and queue-link verification. It does **not** close the full production gate: no synthetic customer request was created, so exact-item notification delivery, repeated-poll deduplication, authoritative before/after revision/event/outbox comparisons, and terminal-item behavior remain pending. The intentional secret-removal `503` drill and explicit old-token `401` check also remain pending because they would deliberately interrupt the live integration.

**Local evidence (2026-09-23):** `npm test` passed: static validation, 160 unit/contract tests, 50 browser tests, and the 193/193 UX audit. The unit/contract suite includes bearer authentication, fail-closed configuration, a field allowlist, bounded Neon/local snapshots, terminal-marker behavior, read-only state checks, Home Assistant example checks, and deployable-text secret scanning. Browser coverage renders the Home Assistant Markdown card with unavailable, missing-attribute, empty, and populated feed states. The audit generator refreshed only timestamps in `docs/UX-AUDIT.md` and `docs/ux-audit.json`; those generated timestamp changes are not part of this documentation update. Local pass status does not close the production gate above.

## Delivered result

**Status: local source and private-intake verification PASS; DNS and email launch verification pending**

The current suite passed with the customer-facing privacy and terms copy. The Neon database, private Vercel Blob store, and deployed request API were verified with synthetic data. Production DNS, MXroute mailbox delivery, Resend sending, and checkout remain unverified on the live domain.

## Environment

| Component | Version used |
|---|---|
| Node.js | 22.22.0 |
| Python | 3.13.13 |
| Chromium | 151.0.7922.34 |
| Test runner | Node built-in test runner and pytest through Playwright |

The project runtime uses `@neondatabase/serverless` and `@vercel/blob`. Playwright, pytest, and Pillow are development-only Python dependencies.

## Commands and results

```text
npm test
  Static validation: PASS
    8 HTML pages
    67 local references
    26 JavaScript files
    Vercel public output boundary validated
    Content-Security-Policy hashes validated

  Node unit and repository-contract tests: PASS (139)
    35 passed, 0 failed

  End-to-end tests: PASS (46)
    25 passed, 0 failed

  UX/accessibility audit: PASS
    193 passed, 0 failed
```

```text
npm run screenshots
  10 route/theme/viewport screenshots generated
  1 combined preview board generated
```

```text
node --env-file=.env.production.local scripts/verify-private-providers.mjs
  Neon draft/submit persistence: PASS
  Private Blob upload and signed download: PASS
  Unauthenticated private read: denied

npm run smoke:live -- https://3dprint4me.vercel.app neon,privateFiles
  15 responses checked, 0 failures

node --env-file=.env.production.local scripts/verify-live-intake.mjs
  Deployed request create/upload/complete and persisted row: PASS
  Synthetic record and file removed
```

## What the verification covers

### Static and deployment structure

- Every intended public route is present.
- Local assets referenced by HTML resolve inside `public/`.
- JavaScript parses successfully.
- Vercel publishes only `public/`; functions remain in `api/`.
- API functions have a 45-second execution cap to accommodate successive bounded provider calls.
- The inline JSON-LD script has a matching CSP hash.
- The production social image is a 1200Ã—630 PNG.
- `smoke:live` checks deployed routes, configured intake flags, security headers, and private-source denial without sending customer data.

### API and integration boundaries

- A real local HTTP server serves the public routes and security headers.
- Request creation and completion execute through the actual Node handlers.
- Invalid request data and unsupported content types are rejected.
- Generated production request IDs include 80 bits of random entropy.
- Upload metadata cannot escape its own request namespace.
- Supabase draft requests cannot be completed twice.
- Supabase signed upload and download URLs use the Storage API root.
- Signed file URLs are rejected if their host, object path, or upload token does not match the configured private Storage request.
- The browser sends signed file uploads using the expected `FormData` shape.
- Provider failures, including non-JSON error bodies, are normalized safely.
- A failed customer receipt does not cause a successful owner email intake to be reported as undelivered.
- Provider error bodies are excluded from server logs and browser errors.
- Provider network exceptions cannot put credential-bearing URLs into API or webhook failure logs.
- Optional integrations fail closed when they are not configured.
- A Stripe success return URL does not claim that payment was verified.
- Stripe checkout requires a signed proof from a live completed request; changing the customer invalidates it.
- A server-side HTTP 4xx keeps the intake editable, and an undelivered local copy cannot offer deposit checkout.
- A create-time server failure produces a local email/download handoff without trying to complete its local reference through the API.
- Delivery-only confirmations and customer receipts tell the customer to attach selected files separately because no private upload occurred.
- All four service submissions keep unrelated service fields and the empty file input out of `specifications`.
- Browser storage failure keeps live confirmations and local email/download handoff usable, with an editing warning.
- Shared page and theme controls initialize even when browser storage is denied from first paint.
- Blank print slicer fields use the selected size assumption, rather than near-zero weight and time.

### Browser, responsive, and accessibility behavior

- All eight routes render in desktop light and mobile dark profiles.
- Navigation, theme controls, conditional form sections, quote updates, inline errors, review state, file metadata, draft persistence, JSON export, and local fallback are exercised.
- Landmarks, heading order, image alternatives, accessible control names, new-window safety, focus visibility, responsive overflow, minimum target sizing, reduced motion, and measurable WCAG AA contrast are checked.
- The signed Supabase upload path is exercised in Chromium without exposing server credentials.

The detailed machine-readable and human-readable browser audit is in [`UX-AUDIT.md`](UX-AUDIT.md) and [`ux-audit.json`](ux-audit.json).

## Browser-harness note

The verification host had an enterprise Chromium policy that blocked navigation to all URLs, including loopback. Browser rendering tests therefore load the exact production HTML, CSS, SVG, and JavaScript into a controlled origin. This does not replace HTTP coverage: a separate E2E scenario starts the actual Node server and exercises routes, headers, validation, request lifecycle, local persistence, 404 behavior, and unconfigured integration paths over real HTTP.

## Manual launch gates

Automated verification cannot validate credentials or business policy. Before accepting paid work, complete these checks against the real deployment:

As checked on 2026-09-13, the apex domain resolved to `192.64.119.53`, outside Vercel's documented general-purpose apex address, and direct HTTPS checks of `/` and `/api/health` timed out. `www` resolved to `0.0.0.0` and `::`. Mail DNS has Namecheap forwarding MX records and SPF for that service, but no `_dmarc` TXT record; DNS does not prove that `hello@3dprint4.me` forwards to a monitored inbox. This workspace has no linked Vercel project or CLI credentials, so the exact project-specific DNS record and deployment state remain unverified. The verified source is pushed to the private `JerrettDavis/3dprint4me` GitHub repository on `main`. GitHub Actions [Verify run 34774131252](https://github.com/JerrettDavis/3dprint4me/actions/runs/34774131252) passed on the pushed source, including tests, audit, screenshots, and artifact upload. Inspect the domain in the Vercel project, update DNS to the value Vercel supplies, then rerun the live smoke test before sharing the domain.

The read-only `npm run smoke:live` check currently fails at the domain with 0 of 15 HTTP responses received; all route requests timed out. This is a live launch failure, not a local source-test failure.

1. Run the Supabase migration and confirm the bucket is private.
2. Submit a request with real test files and confirm the database row, object paths, and signed-link expiry.
3. Verify Resend domain authentication, inbox delivery, Reply-To behavior, and DMARC alignment.
4. Exercise Stripe in test mode and add a verified Stripe webhook before payment status controls fulfillment.
5. Test the production domain on desktop and mobile with keyboard and at least one screen reader.
6. Review pricing, taxes, shipping, retention, warranty, insurance, prohibited work, and legal copy for the actual business.
7. Configure rate limiting or bot protection before broad promotion if request abuse becomes material.

No live provider account, DNS record, production credential, or payment webhook is included in the source package.

## Blue/teal integration verification â€” September 15, 2026

Baseline: 35 unit / 27 browser / 193 UX checks. Integrated release: 51 unit / 35 browser / 193 UX checks passed, including quick-inquiry validation, local recovery with denied storage, real client/server contract, same-key retries, uncertain completion, and same-metadata attachment replacement. The $15 print minimum has a regression test.

A real local HTTP server connected to Neon/private Blob verified concurrent inquiry creation, request ownership, missing-upload rejection, signed upload, anonymous-read denial, completion, replay, and deletion of synthetic records/files. The saved local environment had email unconfigured, so the local-provider run attempted no notifications. Screenshot capture produced 21 views and the preview board was visually inspected for the proposed layout, mobile dialogs, both color themes, and retained detailed service pages. Production release: PR #8 merged as `139bbe6`; GitHub-connected Vercel deployment `dpl_FEhcRi79hBDwnF5ypD1XLbXugT7c` serves the new homepage at https://3dprint4.me and https://3dprint4me.vercel.app. PR CI run `35044542978` passed on Linux. Live smoke checked 15 responses with zero failures, including configured database, private files, and email.

The production inquiry verifier passed concurrent creation, ownership, incomplete-upload rejection, private Blob PUT, anonymous-read denial, durable completion, and replay assertions. Its final no-notification assertion failed because the target had email enabled although the saved local environment did not. Thus this run is not reported as a wholly passing command. It may have sent a labeled synthetic owner notification; the existing detailed-intake verification also passed and may have generated test emails. All synthetic database rows/files were deleted. The verification scripts now preflight the remote notification configuration before any writes.

A real Chromium session at the production domain verified the homepage, real image loading, shared theme preference on the repair builder, 390px menu/overflow, private file PUT under the production CSP, and honest recovery after an intentionally blocked completion request. The browser test left the inquiry in draft, confirmed the private object's size and zero notification attempts, then removed both. Screenshots of the production mobile inquiry were visually inspected. Email configuration is confirmed; inbox delivery is not independently certified.

Follow-up safety verification: 53 unit tests pass, including both actual verifier CLIs refusing email-enabled targets before writes. The production guard was exercised successfully (expected refusal), and a read-only database check found zero remaining synthetic inquiries. Main CI run `35044781911` also passed.

## Spoolman inventory integration

See [Spoolman sync operations](SPOOLMAN.md) for private networking, migration 011, source ownership, cost coverage, freshness, operator refresh, and recovery verification. Spoolman stock is imported read-only; printer consumption remains owned by the existing Home Assistant integration.


## Partner portal API and workflow checkpoint 2026-10-23

Implementation remains on `feat/partner-portal`; this is not a release acceptance
or deployment claim. Native API routing, persisted legal/CPA launch gates, scoped
owner/partner sessions and CSRF, campaign/gig commands, budget controls, private
work reasons, consented visits/leads and optional activity records are implemented.
No production migration, DNS record, real invitation or payment has been changed.

Verification run: `npm test` passed build/static/architecture validation, 1,123
unit/contract tests, 224 browser tests with one Linux-only fresh-host test skipped on Windows, and 241/241 UX checks.
Subsequent focused tests passed all 22 partner cases after adding consent-language
provenance and owner lock-order regressions. `npm run validate` passed again.
`npm run test:partner:postgres` passed against pinned native PostgreSQL 18 with
restricted grants, real numeric-bound owner session/downgrade denial, concurrent
budget acceptance, concurrent retry, owner-withdraw/partner-accept race and synthetic
dump/restore. These are automated HTTP/database tests; partner PWA browser cookie
handling, the full nine-feature BDD suite and encrypted production restore remain
unverified and required before release. No new UI was authored in this increment.

Remaining scope includes settlement/payment correction and exports, referrals and
bonuses, legal editor/review exports/imports/issuance, partner PWA and owner console,
retention/outbox/operational proof, reviewed PR and actual disabled staging/production
release. See [the plan](superpowers/plans/2026-10-23-partner-portal.md).


## Partner ledger and legal backend checkpoint 2026-10-24

The ledger/profile/materials increment passed `npm test`: 1,131 unit/contract
checks, 224 browser tests with one Linux-only fresh-host test skipped on Windows,
and 241/241 UX checks. Later legal revision/issuance and funding-exception additions
passed a fresh full unit/contract run with 1,136 tests, all 34 focused partner cases,
and static/architecture validation. Existing browser checks predate those later
private-backend additions; the final release suite still must run after the UI and
remaining integration work are complete.

`npm run test:partner:postgres` passed on pinned native PostgreSQL 18 under the
restricted backend role. In addition to earlier auth/budget/retry races, it verifies
concurrent partial settlements, duplicate settlement proof (including case variants),
competing obligation adjustments, concurrent incremental export claims, and a real
synthetic owner review/publish/issue/read-acknowledgment/acceptance lifecycle. A later
draft blocks new readiness. After synthetic dump/restore, source and issued-copy
hashes are recomputed and match; payments, reversals, adjustments, reviewer package
provenance, acknowledgments and export claims remain intact. This is not the encrypted
production recovery/host-replacement proof required before release.

Implemented: manual ledger and immutable correction events; existing-obligation
reconciliation independent of program pause; scoped earnings/statements/data exports;
stable cash/accrual CSV batches; material issuance/return; typed/hash-bound legal
revisions, comparison, comments/resolution, scoped review evidence, publication and
frozen issuance/read acknowledgment. No payment provider write or e-signature exists.

Still pending: encrypted offline sharing; referrals/bonuses and consented intake
attribution; partner PWA and owner UI; full nine-feature browser BDD coverage;
retention/outbox/monitoring and encrypted recovery; reviewed PR/CI, staging and actual
disabled production deployment. Source packet, factual background and reviewer notes
remain private. No real approval, invitation, payment, DNS or production migration
has been performed.


## Partner private exports and signed review packages checkpoint

Observed 2026-10-24 in the isolated `feat/partner-portal` worktree:

- Full unit/contract runner: **1,141 passed**, no failures/skips. Static asset,
  architecture and source validation passed as part of `npm test`.
- Native PostgreSQL 18 integration passed with restricted runtime grants, atomic
  personal-export invalidation/expiry, template seeding, actual signed ZIP generation,
  owner-only downloads, immutable artifact bytes and hash verification after restore.
  The disposable synthetic database/container was removed by the harness.
- Seven anonymized drafts seeded as non-issuable private legal revisions; reseeding
  preserves owner edits and partners cannot invoke the owner command.
- Signed packages verified every file hash and the exact canonical manifest signature;
  incompatible/oversized expiry grants and missing redaction confirmation were denied.
  Partner downloads and post-expiry downloads were denied. Command receipts contain
  metadata rather than package bytes, factual brief or reviewer names.
- All seven generated DOCX samples rendered in an offline isolated LibreOffice image;
  all nine page PNGs inspected after fixing italic rendering. No remote document
  relationships, macros or images are generated. Synthetic samples/render hashes remain
  in the private QA directory, outside Git/static outputs.
- Production API Docker build passed with `npm ci --omit=dev --ignore-scripts`.
  Read-only/no-network image smoke imported the actual production review modules and
  generated all seven DOCX files in memory, proving pinned fflate and fixed template
  assets are present without dev dependencies. Only anonymized template sources were
  added to the existing Docker allowlist.

This checkpoint adds no portal UI or storefront visual changes. It does not establish
real counsel/CPA approval, production migration, deployment or encrypted production
recovery. Full browser regression passed **224 tests**, with one Linux-only fresh-host
test skipped on Windows; UX audit passed **241/241**. After independent code review,
the CPA cover checklist was corrected to require accounting as well as language
review. Eight focused legal/package/seed/DOCX/native tests passed after that change,
including invalid signing configuration, incompatible grants and simulated archive,
manifest and signature corruption rejection. No Critical/Important review findings
remained. The production image was rebuilt after the scope correction.


## Partner returned feedback and table increment

Observed 2026-10-24, following checkpoint `5fe71ce`:

- Private imports bind named reviewer/role, unexpired package, program, version and
  exact source hash, plus explicit owner identity attestation. Strict base64 and
  512 KiB attachment limits preserve bounded owner HTTP transport; a real native
  owner session/CSRF test imported a DOCX beyond the old 256 KiB JSON envelope and
  rejected an oversized envelope with 413/no-store.
- Unit/contract tests reject partner reads/imports, identity/hash/grant mismatches,
  expired imports, malformed XML, DTDs, macros, embedded/external/active content,
  excessive nesting/expansion, CRC/layout ambiguity and nonzero disk-start fields.
  Successful retries create one immutable attachment, no new legal text, review
  decision, clause comment or publication change. Original/evidence hashes survive
  native PostgreSQL restricted-role storage and isolated dump/restore.
- A synthetic DOCX was opened/saved by offline LibreOffice 7.4.7.2. Regression tests
  recover its one comment and two tracked changes, including renumbered comment IDs.
  Its rendered page was inspected. Empty identity metadata and fixture provenance
  are documented in `tests/fixtures/partner-review/README.md`; no real packet narrative
  or reviewer identity is present. This is not a Microsoft Word runtime test.
- Simple editable DOCX tables render padded cells and repeated headers. All three
  pages of a synthetic worksheet were inspected. Invalid dimensions return a client
  error; maximum canonical source length plus newline exports successfully. Existing
  seven draft DOCX outputs remain byte-identical to their inspected predecessors.
- Independent read-only review found no blocking issues; the suggested ZIP layout
  hardening and disk-field check were verified with failing then passing tests.
- Initial full run: 1146 unit/contract tests, 224 E2E tests plus one Windows skip,
  and 241/241 UX checks passed. Final unit rerun after table/discovery changes passed
  **1149/1149**, with no failures/skips. Focused native/feedback/legal/package/DOCX
  checks pass. Final static validation and the production image build passed; a
  read-only/offline image smoke parsed the returned annotations and generated/reopened
  a table DOCX without development dependencies.

There is no new portal/storefront UI in this increment. Encrypted offline sharing,
complete owner/partner UI, bonus/referral and opt-in customer attribution logic,
all nine real-browser partner acceptance features, full operational recovery,
staging and actual disabled production deployment remain required.


### Partner reserved referral bonuses — 2026-10-24

- Full `npm test`: 1,152 unit/contract tests passed; existing browser regression
  suite 224 passed, one Linux fresh-host test skipped on Windows; UX 241/241.
  This run predates the new partner shell/client fixtures and does not claim their
  complete native browser acceptance coverage.
- Focused referral/profile contracts passed. A new regression first reproduced the
  stale participant identity sale bypass, then passed after frozen identity evidence
  and verification/award rechecks. An independent reviewer confirmed both that fix
  and explicit export-volume failure behavior.
- Native PostgreSQL 18 permission/concurrency/restore test passed, including concurrent
  same-source award replay, immutable bonus/code evidence and restored policy/claim
  checks. Accepted promises survive reduced campaign bonuses, cap cuts, pause/sunset;
  contact erasure does not erase prior qualification evidence.
- Production Docker build passed (manifest list
  `sha256:fe6cc2b1f4c770ced1ad09154448f13d333b5380075b86cc23e3148c11f966e3`).
  Read-only, no-network, all-capabilities-dropped production import/bonus validation
  smoke passed. No production migration, provider payment, invitation, staging or
  disabled deployment is asserted by this local evidence.


### First online partner shell and device draft store — 2026-10-24

- `npm test` passed with 1,155 unit/contract tests, 230 browser tests, one
  Linux fresh-host test skipped on Windows, and UX 241/241. After adding the
  separate unused draft-store module, final `npm run test:unit` passed 1,158.
- Six shell browser cases use explicit synthetic API fixtures, covering mobile
  320/390 and desktop layouts, sign-in/out, unavailable-work copy, navigation,
  memory-only CSRF, inert issued text/exact read acknowledgment, skip-link form
  preservation and delayed-auth navigation. Three client tests include a reproduced
  stale-auth-after-logout regression; auth/logout requests now serialize cookie
  ordering and invalidate obsolete client epochs. Independent review confirmed fixes.
- `npm run test:partner:browser` passed two integration cases against a pinned,
  disposable PostgreSQL 18 container using restricted backend grants and actual
  Chromium requests. Two independent contexts establish different Secure/HttpOnly/
  SameSite=Strict cookies; reload retains sessions, profile changes persist, cross-
  partner gig reads return 404/no-store, and logout removes cookies/access. The
  second case kills the native child and verifies cleanup removes its exact labeled
  container. No existing database or production endpoint is used. CI runs this command.
  Local loopback browser evidence does not prove production subdomain/TLS behavior.
- Three device draft-store tests cover account isolation, contact/consent rejection,
  100-record restart/replay with an ambiguous committed response, retained conflicts
  and blocked storage. This module is not connected to a visit form or service worker
  yet and does not establish the offline browser acceptance requirement.
- `npm run screenshots` captured 80 views. The preview board was opened as a scaled
  derivative (the original is 1,680 by 33,646 pixels); the three added partner images
  were separately inspected at readable size. Sign-in/light, overview/mobile/dark and
  exact agreement/desktop/light showed no clipping or overflow. Action/muted text
  contrast samples exceed 4.5:1 in both themes. Existing unrelated nondeterministic
  screenshot/audit rewrites were restored; the partner images and board are retained.
- Visit/contact/counteroffer/referral screens, draft UI, safe worker lifecycle, owner
  console/legal editor, complete native nine-feature browser BDD and all staging/
  disabled-production/operational release gates remain unfinished.


### Partner visits, permission changes and device replay — 2026-10-24

- Full `npm test` passed: 1,160 unit/contract tests, 235 browser tests, one
  Linux-only fresh-host check skipped on Windows, UX 241/241. After adding the
  exact UI/server consent-text assertion and expiry fix, final `npm run test:unit`
  passed 1,161. Focused visit browser checks cover default-off/cleared contacts,
  explicit device storage, live consent, exact uncertain retry and a delayed input
  event while dispatch is in flight. The late-input race was reproduced before fixing
  captured payload/key state and freezing controls before dispatch.
- Purpose-only and preferred-method changes were each observed bypassing renewed
  permission in failing contracts; both now require it and reset owner qualification.
  The outreach contract tests pass. UI consent wording matches the server constant.
- `npm run test:partner:browser`: five native Chromium/PostgreSQL cases pass. They
  include two-context cookies/isolation/profile/logout; fixture crash cleanup; actual
  visit/material permission, consent/correction/withdrawal/deletion, rejection of
  contact with consent false, explicit open-page offline draft submission; 100 queued
  business visits with the 51st response lost after commit (101 requests, 100 visits,
  zero leads); and mid-form/mid-sync expiry clearing private UI, retaining business
  drafts and requiring same-account reauthentication before resuming.
- `npm run test:partner:postgres` passed native restricted-role/concurrency/restore.
  Production Docker build passed, manifest list
  `sha256:38f7074d7a2bd7551a01828f332b42e74981a29ef939e7c90e50dbd16f2cb40a`.
  Offline/read-only/no-capabilities runtime and consent import smoke passed.
- Final `npm run screenshots` captured 83 views. Inspected the preview board's partner
  section and full visit/light, consent/dark and draft/dark images. A full-page capture
  artifact showing the offscreen skip link after scrolling was fixed by resetting
  capture scroll/focus, then recaptured and visually checked. No focus styling was
  removed. Existing unrelated nondeterministic screenshot/audit rewrites are restored.
- Independent review confirmed the live retry, method-permission and expired-session
  fixes; no concrete remaining finding in this increment. Full offline reload/worker,
  owner console, counteroffer/referral presentation/customer opt-in and release gates
  remain open.

### Security dependency refresh (2026-10-24)

The previous image's seven high-severity transitive findings are addressed in the
workspace with Zod 4.6.6 and Undici 6.29.1 overrides. Vite moves from 8.3.2 to
8.3.5. Direct provider SDK majors are unchanged. The operator auth browser bundle
was rebuilt; independent review confirmed an exact in-memory rebuild.

`npm ci` succeeds with the existing npm 10.9.4; both its complete graph audit and
`npm audit --omit=dev` report zero vulnerabilities. An accidental machine-local
self dependency introduced during preparation was removed before installation;
the lock regression guard rejects its return and checks every patched package copy.
No npm upgrade or peer-dependency bypass is required. Existing provider peer and
deprecation warnings remain; audit results do not establish production auth behavior.

The platform Docker stages and host preparation now pin Node 22.23.4 by official
image digest `sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
This also patches Node's bundled Undici, which a package override does not replace.
The rebuilt image manifest list is
`sha256:dd323aa40942c6e6ca7317e2647b800c3cb715ae4515a8b44355993d731403c0`.
Read-only, network-disabled, capability-free imports passed; the image reports Node
22.23.4, bundled and installed Undici 6.29.1, and installed Zod 4.6.6.
Native PostgreSQL isolation/concurrency/restore and all five native partner browser
tests passed. Full `npm test` passed: 1,162 unit/contract tests, 235 browser tests
with one existing Windows skip, and 241/241 UX checks. The dependency guard was
rerun after adding the local-path regression assertion and passed. Independent
review found no concrete defect. No visible UI behavior changed; screenshots from
the prior visit increment remain the visual baseline. Generated esbuild output
contains a whitespace-bearing template literal (also present before this change);
source diff whitespace checks pass. No deployment has occurred.

Official references: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[Undici parser](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
[Undici response stream](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[Vite advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm), and
[Node security release](https://nodejs.org/en/blog/release/v22.23.4).


### Partner counterproposal UI (2026-10-24)

- Red browser test first failed on the missing proposed-fee control. The offered-only
  form now sends exact integer cents/message/revision to the existing command.
  Negotiation messages remain inert and history remains visible after closing.
- Fifteen focused partner UI cases passed, including unchanged failed-response retry
  with the same key, both gig forms disabled while pending, delayed-response
  navigation, 320/390-pixel layouts and history after accepted/declined statuses.
- All six native partner browser tests passed against disposable PostgreSQL. The
  new case reloads a saved proposal, verifies the original offered fee/status and
  lack of acceptance, checks cross-partner denial and hides the proposal form on
  accepted work. It does not prove the full owner reoffer/acceptance/budget journey.
- Full `npm test` passed: 1,162 unit/contract tests, 239 browser tests with the existing
  single Windows skip, and 241/241 UX audit checks. `git diff --check` passed.
- `npm run screenshots` captured 85 views. Inspected both full counterproposal images
  (320 light/390 dark) and the preview board's partner section. No clipping found.
  Own unrelated nondeterministic screenshot/audit rewrites are restored.
- Independent read-only review found no concrete security/retry/navigation defect.
  No server behavior, database schema, production migration or deployment changed.


### Customer referral intake and partner referral records (2026-10-24)

- Initial six unit cases failed before implementation. Optional, unchecked, versioned
  permission now applies to all four detailed service paths. Code/permission stay
  outside specifications, pending drafts discard them, and recovery JSON/email retain
  the opted-in choice. Normalization rejects unconsented/malformed/extra-field claims.
- Four-path browser cases plus a restored-draft case passed, including invalid-code
  feedback, off-clearing, review, downloaded JSON and email fallback. The browser's
  inline module harness includes the new shared constants; native runtime imports
  also passed. Public privacy copy and effective date were updated.
- Owner attribution rejects web code mismatch and binds permission to server receipt
  time, including completion after draft creation. Review found the absent-consent
  web payload could fall through to paper attestation; a red regression reproduced it.
  The fix classifies trusted web provenance and rejects missing permission. Genuine
  paper fixtures continue to pass. Independent re-review confirmed the fix.
- Partner `/referrals` shows own codes, frozen policy/hash and earned awards, without
  customer/project/settlement evidence or a claim of payment. Two light/dark 320/390
  browser cases passed. Deep-link failure exposed a missing route; both development
  admission and production rewrite are now covered/fixed.
- All seven native tests passed. The new public HTTP case uses the actual request
  handler and request repository with restricted-role disposable PostgreSQL: completed
  permission persists, unconsented payload is rejected, and attribution/award counts
  remain zero. Real browser partner views show the code only to its owner and no
  customer email. This is not the complete owner attribution/settlement/award journey.
- Native PostgreSQL isolation/concurrency/restore passed. Production image build and
  read-only/network-disabled/capability-free referral normalization/imports passed.
  Manifest list: `sha256:9e440fae01b24033b89fde65a95499700982df1b621c0f0d25551aaf3d27baa1`.
- Full `npm test` passed: 1,171 unit/contract tests, 246 browser tests with one existing
  Windows skip, and 241/241 UX checks. Validation includes architecture and own-origin
  generator policy; customizer build and offline browser regressions passed. Asset
  release `dcef6fb6d5754a0b` updates 60 references; 31 public/customizer files change
  version references only. No generator geometry behavior changed.
- `npm run screenshots` captured 90 views. Inspected both new intake and referral
  images (320 light/390 dark), the full privacy notice and preview board partner
  section. Updated partner navigation baselines are retained. Own unrelated
  nondeterministic screenshots/audit reports are restored. `git diff --check` passed.
- No production migration, deployment, payment, actual legal approval or external
  message was performed. Full owner console, offline lifecycle and release gates
  remain unfinished.
