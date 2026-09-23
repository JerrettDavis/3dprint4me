# Release Verification

## Home Assistant work peek — release gate (pending production)

Local tests and source review verify the endpoint, snapshot contract, and Home Assistant example. They do not verify a deployed API, the owner's Home Assistant configuration, phone delivery, or live operator deep links. Record a timestamp, deployment identifier, Home Assistant configuration-check result, synthetic work ID, HTTP status and response-header observations, and before/after work-state evidence for each check below. Never record token values or full private request data.

1. **Authentication and failure closure:** Against the deployed `GET /api/home-assistant-work`, record `401` for anonymous, malformed, and wrong bearer headers; `200` for the correct bearer header; `503` after a controlled removal of the Vercel variable; and `401` for an old token after coordinated rotation. Confirm `Cache-Control: no-store` and generic errors without credentials or raw provider details.
2. **Field allowlist:** Inspect the successful JSON keys. Top level must contain only `version`, `generatedAt`, `queueUrl`, `counts`, `latestCreatedId`, and `items`. The nested `counts` object must contain exactly `active`, `unacknowledged`, `urgent`, and `waitingCustomer`. Each item must contain only `id`, `title`, `service`, `status`, `priority`, `acknowledged`, `submittedAt`, `targetDate`, and `url`. Verify no contact, description, estimate, file metadata, notes, event history, or revision appears; URLs must use the fixed operator origin.
3. **Home Assistant configuration and visibility:** Install the package and matching `secrets.yaml` entry, run **Check configuration** successfully, and restart. Confirm a fresh `generatedAt` and the derived sensors. Create one labeled synthetic request through an authorized production intake path, record its work ID, and confirm it appears once in the active snapshot and dashboard. The initial successful poll must establish state without alerting for preexisting work; for alert testing, establish a baseline marker first and then create the synthetic item.
4. **Alert and exact link:** On the next poll, confirm exactly one `three_d_print_new_work` persistent notification for the new marker. Its link must open `https://work.3dprint4.me/work/<synthetic-work-id>` after operator sign-in, not merely the queue. If optional phone delivery is configured, verify its tap action opens the same exact URL. A repeated poll with the same marker must not alert again.
5. **Read-only proof:** Before and after dashboard refreshes, repeated polls, and opening the alert, compare the synthetic work revision, acknowledgement timestamp, event count/cursor, and notification outbox state in the authoritative operator/Neon records. They must be identical. No Home Assistant control may acknowledge or update the item.
6. **Terminal behavior:** Complete the synthetic item in the operator PWA. Verify it disappears from `items` and active counts decrease. `latestCreatedId` must remain the newest-created ID across all statuses, including when active work reaches zero; no false new-work alert may result from completion.
7. **Rotation and recovery:** Rotate the token in Vercel and Home Assistant in one maintenance window, redeploy/reload, and verify the new token returns `200`, the old token returns `401`, and the REST sensor resumes with a fresh `generatedAt`. During an intentional secret removal, verify the endpoint returns `503`; restore matching configuration and verify recovery. Record any temporary polling gap without claiming missed intermediate work was delivered.

**Production evidence:** Pending. No Vercel secret, deployment, Home Assistant installation, synthetic production request, or live alert was changed or tested for this work peek in this local documentation task. Do not mark this integration production-verified until all seven checks above have timestamped evidence, including the Home Assistant configuration checker and exact-item alert with unchanged revision, acknowledgement, events, and outbox state.

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
- The production social image is a 1200×630 PNG.
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

## Blue/teal integration verification — September 15, 2026

Baseline: 35 unit / 27 browser / 193 UX checks. Integrated release: 51 unit / 35 browser / 193 UX checks passed, including quick-inquiry validation, local recovery with denied storage, real client/server contract, same-key retries, uncertain completion, and same-metadata attachment replacement. The $15 print minimum has a regression test.

A real local HTTP server connected to Neon/private Blob verified concurrent inquiry creation, request ownership, missing-upload rejection, signed upload, anonymous-read denial, completion, replay, and deletion of synthetic records/files. The saved local environment had email unconfigured, so the local-provider run attempted no notifications. Screenshot capture produced 21 views and the preview board was visually inspected for the proposed layout, mobile dialogs, both color themes, and retained detailed service pages. Production release: PR #8 merged as `139bbe6`; GitHub-connected Vercel deployment `dpl_FEhcRi79hBDwnF5ypD1XLbXugT7c` serves the new homepage at https://3dprint4.me and https://3dprint4me.vercel.app. PR CI run `35044542978` passed on Linux. Live smoke checked 15 responses with zero failures, including configured database, private files, and email.

The production inquiry verifier passed concurrent creation, ownership, incomplete-upload rejection, private Blob PUT, anonymous-read denial, durable completion, and replay assertions. Its final no-notification assertion failed because the target had email enabled although the saved local environment did not. Thus this run is not reported as a wholly passing command. It may have sent a labeled synthetic owner notification; the existing detailed-intake verification also passed and may have generated test emails. All synthetic database rows/files were deleted. The verification scripts now preflight the remote notification configuration before any writes.

A real Chromium session at the production domain verified the homepage, real image loading, shared theme preference on the repair builder, 390px menu/overflow, private file PUT under the production CSP, and honest recovery after an intentionally blocked completion request. The browser test left the inquiry in draft, confirmed the private object's size and zero notification attempts, then removed both. Screenshots of the production mobile inquiry were visually inspected. Email configuration is confirmed; inbox delivery is not independently certified.

Follow-up safety verification: 53 unit tests pass, including both actual verifier CLIs refusing email-enabled targets before writes. The production guard was exercised successfully (expected refusal), and a read-only database check found zero remaining synthetic inquiries. Main CI run `35044781911` also passed.
