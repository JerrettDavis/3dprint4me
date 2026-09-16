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

Expected delivered baseline:

- Static validation passes
- 35 Node tests pass
- 25 E2E tests pass
- 193 UX/accessibility checks pass
- Screenshot board regenerates without browser errors

## 2. Create request storage

The current production project uses a Neon Free database and a private Vercel Blob store, both connected only to the Production environment. Apply `neon/migrations/001_service_requests.sql` to Neon (`node --env-file=.env.production.local scripts/migrate-neon.mjs` after pulling production variables). Verify with `node --env-file=.env.production.local scripts/verify-private-providers.mjs`; it creates and deletes a synthetic request and private file. Run `node --env-file=.env.production.local scripts/verify-live-intake.mjs` to exercise the deployed API and delete its synthetic data. The server uses `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`; neither belongs in `public/`. The browser receives only a 15-minute signed upload URL scoped to one path, size, and content type. Owner download links expire after 15 minutes. Monitor the free limits before accepting more than 1 GB of uploads, and move to a paid plan or another private store before the limit is reached.

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

`npm run vercel-build` performs static, reference, JavaScript, output-directory, and CSP-hash validation. A bad inline-script edit fails the deployment instead of silently breaking under the production content security policy.

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
