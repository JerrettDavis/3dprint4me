# Security Policy

## Reporting a vulnerability

Do not open a public issue containing customer data, secrets, private upload URLs, or an exploitable vulnerability. Send a concise report to `hello@3dprint4.me` with the affected component, reproduction steps, impact, and any suggested mitigation. Remove unnecessary personal data and do not retain customer files.

## Supported version

The latest commit on the primary production branch is the supported version. There is no long-term support promise for older deployments of this starter repository.

## Secret handling

The following values are server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `REQUEST_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`

Never place them in `public/`, client JavaScript, HTML, screenshots, test fixtures, logs, or issue reports. Use separate sandbox and production credentials. Rotate any credential that may have been exposed.

## Customer uploads

The application limits accepted names/extensions and size, but it does not prove that file contents match the extension or are safe. Treat every upload as untrusted.

Recommended controls:

- Keep the Supabase bucket private.
- Use short-lived signed download URLs.
- Scan or inspect files in an isolated environment.
- Do not execute binaries, scripts, macros, or installers from requests.
- Patch CAD, slicing, archive, and image software.
- Limit staff access and audit downloads.
- Define and automate a retention policy.
- Consider content-type inspection and malware scanning before scaling beyond a trusted local customer base.

## Webhook verification

When `REQUEST_WEBHOOK_SECRET` is configured, the receiver must calculate HMAC-SHA256 over the exact raw body and compare it to `X-3DP-Signature` using a constant-time method. Add replay protection at the receiver.

## Stripe

The browser success URL is not proof of payment. Any automated payment state must come from a Stripe webhook with raw-body signature verification and idempotent event handling.

## Dependency and platform updates

The runtime intentionally has no third-party npm packages. Python packages are development/test dependencies only. Keep Node, Python, Playwright, Chromium, Vercel functions, Supabase, and provider configurations current. Review security headers after adding any external script, image host, analytics tool, or commerce widget.

## Known boundaries

- The honeypot is a low-cost spam control, not comprehensive abuse prevention.
- No CAPTCHA, rate-limit service, malware scanner, authenticated admin portal, or payment webhook is included.
- The health endpoint reports configuration presence, not credential validity.
- Local NDJSON logs are for development only and are not durable serverless storage.
