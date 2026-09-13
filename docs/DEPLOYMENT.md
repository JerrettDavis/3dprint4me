# Deployment Guide

## Recommended production shape

- Vercel serves the `public/` directory and runs the Node functions in `api/`.
- Supabase stores normalized request records and private customer files.
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

## 2. Create Supabase resources

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

Current DNS uses Namecheap email-forwarding MX records and an SPF record for that forwarding service. Verify that `hello@3dprint4.me` forwards to a monitored inbox with a real inbound test. Add the exact sending-domain records shown by Resend and confirm its domain status before enabling customer receipts; do not replace the forwarding MX records unless inbound mail is moved deliberately. After SPF and DKIM pass, publish and test a DMARC policy appropriate to the business. See [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction) and [DMARC setup](https://resend.com/docs/dashboard/domains/dmarc).

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

As checked on 2026-09-13, the apex A record was `192.64.119.53` and `www` resolved to `0.0.0.0` and `::`. Remove the parking/sinkhole records when applying the project-specific records from Vercel; verify both hosts after DNS convergence.

## 8. Production smoke test

Run the read-only HTTP preflight against the deployed URL before sending customers there:

```bash
npm run smoke:live -- https://3dprint4.me
```

It requires Supabase and email to be configured, checks public routes and assets, security headers, `/api/health`, and denial of private source paths. To check a Vercel preview URL, replace the origin. A third argument can change the required health flags, for example `supabase,email,webhook`; this checks configuration only, not provider delivery. Continue with the real request, private file, email, and payment checks below.

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
