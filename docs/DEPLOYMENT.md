# Deployment Guide

## Recommended production shape

- Vercel serves the `public/` directory and runs the Node functions in `api/`.
- Neon stores request records and Vercel Blob stores private customer files. The older Supabase adapter remains available for deployments that already use it.
- Resend delivers the owner notification and customer receipt.
- A signed webhook feeds any automation or back-office process.
- Stripe is optional and should initially be used in test mode for deposits.

The site can deploy without any integration, but that mode is a product preview rather than a production intake system.

## 1. Preflight

Use Node 22 and Python 3.11 or newer for the full verification suite.

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
npm test
npm run screenshots
```

Expected delivered baseline (recorded 2026-10-03; see [VERIFICATION.md](VERIFICATION.md)):

- `npm run vercel-build` passes from a clean `public/customize/` (Vite build, asset versions, static validation)
- 543 Node unit/contract tests pass
- 114 E2E tests pass
- 241 UX/accessibility checks pass
- 56 screenshots and the preview board regenerate without browser errors

## 2. Create request storage

The current production project uses a Neon Free database and a private Vercel Blob store, both connected only to the Production environment. Apply the additive migrations in order: `001_service_requests.sql`, `002_quick_inquiries.sql`, and `003_work_queue.sql` (`node --env-file=.env.production.local scripts/migrate-neon.mjs 003_work_queue.sql` for the latest migration). Verify with `node --env-file=.env.production.local scripts/verify-private-providers.mjs`; it creates and deletes a synthetic request and private file. Run `node --env-file=.env.production.local scripts/verify-live-intake.mjs` to exercise the deployed API and delete its synthetic data. The server uses `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`; neither belongs in `public/`. The browser receives only a 15-minute signed upload URL scoped to one path, size, and content type. Owner download links expire after 15 minutes. Monitor free limits and move to a paid plan or another private store before they are reached.

### Private operator inbox

The queue is created only for Neon-backed completions; existing Supabase and delivery-only modes remain unchanged. Enable Managed Neon Auth on the production branch, configure GitHub in Neon, deploy the separate `operator/` origin, and set the exact origin in `OPERATOR_ALLOWED_ORIGINS`. Apply `neon.ts` to deploy the Push outbox Function and its one-minute scheduled trigger. Do not serve `operator/` from the storefront's `public/` output.

After the first GitHub sign-in, copy the stable auth user ID—not the email or GitHub login—into an enabled `operators` row. Generate a dedicated VAPID key pair and a long random worker secret. See [OPERATOR-INBOX.md](OPERATOR-INBOX.md) for commands, environment variables, verification, rotation, and rollback.

### Read-only Home Assistant work peek

The snapshot endpoint is optional and independent of the operator PWA. The operator queue must already be working on the production Neon database. The package and dashboard are in [`integrations/home-assistant/`](../integrations/home-assistant/README.md); they are deployment examples outside `public/`.

1. Generate a distinct token on a trusted machine with `openssl rand -base64 48`. Keep the actual value in a secret manager, not a command transcript, repository file, browser bundle, or URL.
2. In the storefront Vercel project, add `HOME_ASSISTANT_TOKEN` under **Settings → Environment Variables** for **Production** with that value. It is a server-only variable; do not add a `VITE_` prefix or place it in `public/` or `operator/`. Deploy the API so the new variable reaches the function. A missing or shorter-than-32-character value fails closed with `503`.
3. Before adding the matching Home Assistant secret, confirm anonymous and wrong-token requests to `https://3dprint4.me/api/home-assistant-work` return `401`. Send the correct token only in an Authorization header, and confirm `200`, `Cache-Control: no-store`, and the minimized snapshot. Avoid recording the header in shell history or shared logs.
4. Install the package, `secrets.yaml` value (`three_d_print_work_authorization: "Bearer <same token>"`), and dashboard in the order described in the integration README. Run Home Assistant **Check configuration** before restarting it. Confirm the REST and derived sensors update, then verify the dashboard and alert with one labeled synthetic work item. The first successful poll establishes state without an alert.
5. Record the timestamped production results in [VERIFICATION.md](VERIFICATION.md). The local automated suite does not prove the Home Assistant installation or live alert.

For coordinated rotation, generate a new token and prepare the replacement Home Assistant secret. Change `HOME_ASSISTANT_TOKEN` in Vercel and redeploy, then change the Home Assistant `secrets.yaml` value, run **Check configuration**, and restart or reload the integration within one maintenance window. Brief `401` responses while values differ are expected. Confirm the new token returns `200`, the old token returns `401`, and the sensor resumes with a fresh `generatedAt`. Do not expose either token in the evidence record. If rotation fails, restore a matching token on both sides and redeploy/restart as needed; a previous Vercel deployment may contain an old environment value, so verify its actual endpoint behavior. For an intentional disable or rollback, remove `HOME_ASSISTANT_TOKEN` from Vercel and redeploy; the endpoint must return `503` even when called with an old token. Then remove the Home Assistant package, dashboard, and secret as described in its README. Intake and the operator PWA remain available independently.

### Print estimation

Apply the additive print-estimation schema after migrations 001-003:

```bash
node --env-file=.env.production.local scripts/migrate-neon.mjs 004_print_estimation.sql
```

Then apply migration 005 (`node --env-file=.env.production.local scripts/migrate-neon.mjs 005_print_estimate_rate_limits.sql`), which adds only `print_estimate_rate_buckets` for anonymous session and upload-token rate limiting (idempotent; apply before deploying the limiter, since estimate creation fails closed without it and the storefront falls back to uploading with the request).

Migration 004 adds `filament_inventory`, `print_estimate_sessions`, `print_assets`, `print_estimates` (insert-only, trigger-enforced), `print_analysis_jobs`, and `print_runs`, all with RLS enabled and no public grants. Until it is applied, the storefront keeps working: private estimates fail closed to browser-only geometry and operator detail shows the print section as unavailable. Model objects use the same private Blob store under `print-estimates/<session>/`. Schedule `npm run estimate:cleanup` hourly from a trusted host and, when exact slicing is wanted, run `npm run estimate:worker` (containerized with the Bambu Studio or PrusaSlicer CLI for an always-on Docker host in `deploy/slicer-worker/`; see [Slicer worker container](PRINT-ESTIMATION.md#slicer-worker-container) for host steps, the Portainer git-stack option, and the Vercel `SLICER_PROVIDER` redeploy) or an HTTP worker. Full configuration, bootstrap, retention, and rollback: [PRINT-ESTIMATION.md](PRINT-ESTIMATION.md).

### Print estimation scheduled cleanup

A GitHub Actions workflow runs `npm run estimate:cleanup` hourly to clean up expired sessions, failed uploads, and retained assets per the configured retention policy. Add the following repository secrets under **Settings → Secrets and variables → Actions**:

- `NEON_DATABASE_URL`: The production Neon database connection string (same as the storefront's `DATABASE_URL`)
- `VERCEL_BLOB_TOKEN`: The production Vercel Blob token (same as the storefront's `BLOB_READ_WRITE_TOKEN`)

The workflow runs on an hourly schedule (`0 * * * *`) and can also be triggered manually via `workflow_dispatch` from the Actions tab. If cleanup is already running from another trusted host, disable or remove `.github/workflows/estimate-cleanup.yml` to avoid concurrent execution.

### Customize section rollout (owner-gated)

The Customize section (`/customize/`, [GENERATORS.md](GENERATORS.md)) adds **no environment variable, no serverless function, no table and no migration**: generator pages are static Vite output, and the model and its provenance travel with the existing print request (`customization` lives in the request payload JSON). What it changes in deployment:

- `vercel-build` runs `npm run customizer:build` (Vite) first, then `assets:version`, then `validate`. The build needs Node 22 (`engines: 22.x`; Vite 8.3.2 requires `^20.19.0 || >=22.12.0`) and the dev dependencies Vercel installs by default.
- `vercel.json` splits the CSP: the global header rule excludes `/customize/` (`/((?!customize/).*)`) and `/customize/(.*)` has its own complete policy with `'wasm-unsafe-eval'` and `worker-src 'self' blob:` and `connect-src 'self'`. `/customize/assets/*` is cached immutably and `/customize/fonts/*` for a day. `api/*.js` functions include `public/assets/js/**`, so the server can import the generator schemas.

The steps below are **not executed by the repository or its agents**. Each outward-facing step waits for the owner's explicit go-ahead, and the owner enters every credential. Record each executed step, with its date and result, in [VERIFICATION.md](VERIFICATION.md).

1. **Pre-flight (read-only).** Confirm migration 005 is applied in production and that `/api/health` reports `printEstimation: true`. Check the Vercel project's Node version (22.x) and branch settings.
2. **OWNER-GATED — Preview.** Push `feat/generator-section` and open a PR. Let Vercel build a preview, then on it:
   - run the four generator flows;
   - check the headers on the preview. The negative-lookahead header source `/((?!customize/).*)` has not yet been verified on a real Vercel deployment. If Vercel rejected or ignored it, every page would lose its security headers, so do not merge until all of these hold (`<preview>` is the preview host):
     ```sh
     curl -sI https://<preview>/ | grep -i content-security-policy
     curl -sI https://<preview>/customize/g/wifi-tag/ | grep -i content-security-policy
     curl -sI https://<preview>/customize | grep -i -E '^HTTP|^location'
     curl -sI https://<preview>/customize/assets/<manifold-hash>.wasm | grep -i content-type
     curl -sI https://<preview>/customize/fonts/Pacifico-Regular.ttf | grep -i content-type
     ```
     - The first header must equal `GLOBAL_CSP` and the second `CUSTOMIZE_CSP` in `scripts/csp.mjs`, character for character (`node -e "import('./scripts/csp.mjs').then(m => console.log(m.GLOBAL_CSP + '\n\n' + m.CUSTOMIZE_CSP))"`). Also check that `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are present on both responses.
     - `/customize` (no slash) must answer `308` with `location: /customize/`.
     - The `.wasm` file must be served as `application/wasm`; take its hashed name from the page's network panel or from `public/customize/assets/`.
     - The font must be served as a font type (`font/ttf`), not as `application/octet-stream` or `text/html`.
   - print one Wi-Fi tag and scan it with a phone.
3. **OWNER-GATED — Merge and deploy.** Merge the PR to `main` and let Vercel deploy production. Run `npm run smoke:live -- https://3dprint4.me`. The Customize section works without a slicer: estimates stay geometry-only until step 5.
4. **OWNER-GATED — Slicer worker on jdh-docker-00.** Deploy the Portainer git stack from `deploy/slicer-worker/docker-compose.yml` on branch `main` (which now has the merged code). The owner enters `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` and `SLICER_PROFILE_ID` in Portainer. Run the one-batch check: `docker compose -f deploy/slicer-worker/docker-compose.yml run --rm slicer-worker node scripts/print-estimate-worker.mjs --once`. See [PRINT-ESTIMATION.md](PRINT-ESTIMATION.md#slicer-worker-container) for the host steps.
5. **OWNER-GATED — Enable slicing.** In Vercel Production, set `SLICER_PROVIDER=bambu-cli` and redeploy. The owner does this, or approves it explicitly.
6. **OWNER-GATED — End-to-end smoke.** Submit one real customizer request and confirm the operator sees three things: the model, the Customizer parameters, and a slicer-backed estimate. That request is also the first production slice of generator output; compare its grams and time with the multi-color note in PRINT-ESTIMATION.md.
7. **Rollback (OWNER-GATED when executed).** To roll back the code, promote the previous Vercel deployment; there is no migration to undo. To roll back the worker, run `docker compose … down`; queued jobs stay queued. To stop slicing only, unset `SLICER_PROVIDER` and redeploy.

### Legacy Supabase option

1. Create a Supabase project in the desired region.
2. Open the SQL editor.
3. Run `supabase/migrations/001_service_requests.sql`.
4. Confirm the `public.service_requests` table exists.
5. Confirm Row Level Security is enabled and there are no anonymous policies.
6. Confirm the `service-files` bucket is private and has a 25 MB file limit.
7. Copy the project URL and service-role key from the API settings.

Use the service-role key only in server environment settings. It must not be added to `public/assets/js/config.js`, HTML, a `VITE_` variable, or any browser bundle.

### Existing bucket with another name

Set `SUPABASE_STORAGE_BUCKET` to that exact private bucket name. Apply an equivalent file-size and MIME policy manually.

### Cleanup policy

The delivered API can leave a draft row when an upload fails or the customer abandons after creation. Schedule a periodic cleanup after observing real behavior. A conservative first rule is to review or remove draft records and their object prefix after seven days, never submitted rows automatically.

## 3. Configure email

1. Add and verify a sending domain in Resend.
2. Create an API key with the minimum required sending capability.
3. Choose an owner intake address.
4. Set:

```text
RESEND_API_KEY=...
REQUEST_FROM_EMAIL=3dprint4.me <requests@3dprint4.me>
REQUEST_TO_EMAIL=hello@3dprint4.me
```

The function sends two messages after completion:

- Owner notification with request details and 15-minute signed file links
- Customer receipt with request ID, planning range, and next-step language

Production smoke testing should confirm SPF, DKIM, DMARC alignment, inbox placement, Reply-To behavior, HTML rendering, and signed-link expiry.

Production DNS and mail routing use Cloudflare, MXroute, and Resend. Keep provider-specific hostnames, forwarding destinations, filtering exceptions, and delivery diagnostics in the private operations record rather than this public repository. Confirm the active DNS records in each provider before changing delegation or mail routing. See [MXroute setup](https://docs.mxroute.com/docs/quick-setup.html), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), and [DMARC setup](https://resend.com/docs/dashboard/domains/dmarc).

## 4. Configure a webhook

The webhook is optional but useful for automation and redundancy.

```text
REQUEST_WEBHOOK_URL=https://automation.example/hooks/3dprint4me
REQUEST_WEBHOOK_SECRET=<long-random-secret>
```

Completed requests are posted as:

```json
{
  "event": "project.requested",
  "id": "3DP-20260901-ABC123",
  "request": {},
  "files": [],
  "occurredAt": "2026-09-01T12:00:00.000Z"
}
```

When a secret is configured, verify the `X-3DP-Signature` header by computing HMAC-SHA256 over the exact raw request body. Use constant-time comparison and reject replayed event IDs or timestamps outside your chosen window.

Potential destinations include a queue, CRM, issue tracker, email fallback, n8n, Make, Zapier, or a custom Blazor operations system.

## 5. Configure Stripe deposits

Set Stripe test credentials first:

```text
STRIPE_SECRET_KEY=sk_test_...
DEPOSIT_AMOUNT_CENTS=2500
SITE_URL=https://3dprint4.me
```

The amount is bounded server-side from $5 to $250. The default is $25.

The delivered implementation creates a Stripe-hosted Checkout Session only with proof from a successfully persisted or delivered request, and includes the request ID in metadata. The completion proof expires after 24 hours and is signed with the configured Stripe secret key; rotating that key invalidates outstanding proofs. It does not treat a success redirect as verified payment and does not update the request database from Stripe events.

Before deposits influence scheduling or fulfillment:

1. Add a dedicated Stripe webhook function.
2. Verify the webhook signature against the raw body.
3. Store event IDs and process idempotently.
4. Record payment state separately from project status.
5. Handle expired, completed, refunded, disputed, and failed events.
6. Test live-mode tax, receipt, and refund behavior with the actual business account.

## 6. Create the Vercel project

1. Import the repository.
2. Use the `Other` framework preset.
3. Keep the repository root as the project root.
4. Let `vercel.json` set `npm run vercel-build` and `public` as the static output.
5. Add all production variables under Project Settings > Environment Variables.
6. Add them to Preview only when preview deployments should deliver real customer information. Usually, use sandbox projects or omit delivery secrets in Preview.
7. Deploy.

The API function timeout is 45 seconds. Request completion can make successive private-storage and notification calls, each with its own 10-second timeout; the previous 15-second function cap could terminate a valid submission before its result reached the browser. Confirm the deployed project accepts this setting and inspect function duration during smoke testing.

`npm run vercel-build` builds the Customize bundle with Vite (`public/customize/`, gitignored), stamps asset versions, then performs static, reference, JavaScript, output-directory, CSP-hash, generator (page, sitemap, rights, catalog) and no-remote-request validation. A bad inline-script edit fails the deployment instead of silently breaking under the production content security policy.

## 7. Connect the domain

1. Add `3dprint4.me` in Vercel Domains.
2. Add `www.3dprint4.me` if desired and configure one canonical redirect.
3. At the domain registrar, create the exact A/AAAA/CNAME records Vercel provides.
4. Remove conflicting parking or forwarding records.
5. Wait for certificate issuance and DNS convergence.
6. Confirm both HTTP and HTTPS behavior, then keep HTTPS canonical.

The repository already uses `https://3dprint4.me` in canonical tags, Open Graph metadata, sitemap, robots file, and Stripe return configuration examples.

As checked on 2026-09-13, the authoritative apex A record was `192.64.119.53` and `www` was a CNAME to `parkingpage.namecheap.com`. The domain is attached to the `jerrettdavis-projects/3dprint4me` Vercel project. Vercel currently requests `A @ 76.76.21.21` and `A www 76.76.21.21`. Remove the conflicting parking records when applying these records at the authoritative DNS provider, and preserve the mail records until the inbound route is confirmed. Verify both hosts and TLS after DNS convergence. The production deployment is available at `https://3dprint4me.vercel.app`; Neon and private files passed the live API check, while email remains unconfigured.

## 8. Production smoke test

Run the read-only HTTP preflight against the deployed URL before sending customers there:

```bash
npm run smoke:live -- https://3dprint4.me
```

It requires Neon, private files, and email to be configured, checks public routes and assets, security headers, `/api/health`, and denial of private source paths. To check a Vercel preview URL, replace the origin. A third argument can change the required health flags, for example `neon,privateFiles`; this checks configuration only, not provider delivery. Continue with the real request, private file, email, and payment checks below.

### Public experience

- Home, services, portfolio, about, order, privacy, terms, and 404 load.
- Theme follows the operating system and survives a manual override.
- Mobile navigation opens, closes, and returns focus properly.
- No horizontal scrolling appears on a common phone width.
- All portfolio links open the expected published source.
- Sitemap and robots file return correct content types.

### Request flow

Run one request for each service. For the print path, include a small harmless STL and exact slicer time/weight.

- Draft persists after reload.
- Service-specific fields switch correctly.
- Estimate changes are sensible.
- Unsupported extension and oversize file are rejected.
- Review contains the intended details.
- Submission produces a `3DP-...` request ID.
- Supabase row moves from draft to submitted.
- Private object path is under the request ID.
- Object is not publicly readable without a signed URL.
- Owner and customer emails arrive.
- Owner file link expires as expected.
- Webhook signature validates.
- Deposit uses Stripe test mode and returns to the correct URL.

### API and headers

- `/api/health` returns `ok: true` and the expected configured flags.
- API responses use `Cache-Control: no-store`.
- Static responses include CSP, HSTS, frame denial, MIME protection, referrer policy, and permission restrictions.
- Provider failures do not return secret values or raw provider bodies to the browser.

## 9. Observability

At minimum, enable Vercel function logs and Supabase database/storage logs. Alert or check for:

- Elevated 4xx validation failures that indicate confusing UX or abuse
- Any 5xx from request, upload, email, webhook, or checkout paths
- Draft rows that never complete
- Submitted rows with no email and no webhook result
- Storage growth and abandoned object prefixes
- Estimate-to-final-price drift
- Response-time breaches against the public expectation

Do not log raw secrets, Stripe keys, service-role credentials, full customer file contents, or unnecessary personal data.

## 10. Rollback

Vercel deployments are immutable. When a release fails:

1. Promote the last known-good deployment.
2. Keep Supabase migrations additive whenever possible.
3. Do not drop columns or statuses until all deployed functions no longer reference them.
4. Revoke a compromised provider key, update the Vercel variable, and redeploy.
5. For a bad pricing change, revert `public/assets/js/config.js`; the asset cache is intentionally limited rather than immutable.

## 11. Launch decisions still owned by the business

The repository supplies working language and technical controls, but production launch still requires decisions on:

- Legal business name and contact address
- Oklahoma and destination sales-tax obligations
- Shipping territories and carrier responsibility
- Deposits, invoicing, refunds, cancellations, and abandoned-property handling
- Repair warranty and liability boundaries
- Prohibited, regulated, unsafe, or infringing items
- Customer authorization to reproduce third-party designs
- File retention and deletion schedule
- Rush fees and service-level promises
- Accessibility and screen-reader validation on the live deployment

## Blue/teal release and quick inquiry

Apply the additive inquiry migration before releasing the new homepage: `node --env-file=.env.production.local scripts/migrate-neon.mjs 002_quick_inquiries.sql`. Migration statements run in one transaction. Existing detailed requests and their schema remain unchanged.

For a release candidate with Production provider settings but no domain promotion, use `vercel deploy --prod --skip-domain`. Verify `node --env-file=.env.production.local scripts/verify-live-inquiry.mjs https://<candidate-host>` before `vercel promote <candidate-host>`. The verifier creates only labeled synthetic data and deletes its own records/files. It refuses locally configured email delivery; do not use it against an email-enabled deployment without separately authorizing test notifications.

The quick-inquiry notification and retention runbook is in [QUICK-INQUIRY.md](QUICK-INQUIRY.md). Database receipt is independent of owner-email delivery.

For the September 15 release, CLI file uploads were blocked by commit-author matching, while the existing GitHub integration recognized the author and deployed successfully. The reviewed branch was pushed, checked in PR #8, then merged to main for production deployment. No author impersonation, access-policy changes, or disabled deployment protections were needed. Live health now reports email configured; historical unconfigured-email notes above describe the earlier launch state. Always read the target health response before synthetic submission tests.
