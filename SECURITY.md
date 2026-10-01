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
- `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `HOME_ASSISTANT_TOKEN`, `PUSH_WORKER_SECRET`, `VAPID_PRIVATE_KEY`
- `SLICER_HTTP_TOKEN`

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

### Print models (STL/3MF)

Model files are parsed as untrusted input by dependency-free bounded parsers, in the browser for feedback and again on the server before anything is persisted:

- extension allowlist plus content checks (exact binary STL length, ASCII STL structure, 3MF must be a ZIP container);
- configurable size, triangle, entry, total-expansion, XML-node, object, part, and nesting limits;
- 3MF: ZIP64, encrypted entries, duplicate names, absolute/`..`/backslash/drive paths, compression ratios above 200:1, and output beyond the declared size are refused; only the model relationship and referenced model parts are decompressed; any DTD or entity declaration is rejected (no external entity resolution); thumbnails, metadata, and embedded slicer settings are never used for pricing and nothing is rendered as HTML;
- public failures are generic (`analysis_unavailable`, `file_too_large`); diagnostic codes are stored privately for operators.

Uploads go directly from the browser to private Blob through a signed, size-bounded, non-overwriting URL; bytes never pass through a JSON function body. Anonymous estimate sessions are owned by a 256-bit capability token whose SHA-256 hash is stored; it is sent in a header, never the URL, and ends when the request is submitted. Public estimate responses exclude Blob paths, hashes, landed costs, wages, overhead, floors, and margins. Operator downloads are 60-second signed links issued only after verifying the asset belongs to the requested work item. Slicer providers run without a shell in a private temporary directory with a hard timeout; the HTTP provider receives only a short-lived signed URL. Abandoned models expire and privacy purge deletes Blob objects before records ([PRINT-ESTIMATION.md](docs/PRINT-ESTIMATION.md)).

## Webhook verification

When `REQUEST_WEBHOOK_SECRET` is configured, the receiver must calculate HMAC-SHA256 over the exact raw body and compare it to `X-3DP-Signature` using a constant-time method. Add replay protection at the receiver.

## Stripe

The browser success URL is not proof of payment. Any automated payment state must come from a Stripe webhook with raw-body signature verification and idempotent event handling.

## Dependency and platform updates

The runtime intentionally has no third-party npm packages. Python packages are development/test dependencies only. Keep Node, Python, Playwright, Chromium, Vercel functions, Supabase, and provider configurations current. Review security headers after adding any external script, image host, analytics tool, or commerce widget.

## Known boundaries

- The honeypot is a low-cost spam control, not comprehensive abuse prevention.
- No CAPTCHA, external rate-limit service, malware scanner, authenticated admin portal, or payment webhook is included.
- The health endpoint reports configuration presence, not credential validity.
- Anonymous estimate sessions are bounded per session (models, snapshots, TTL), and session creation and upload-token issuance are rate limited globally and per client with Neon-backed fixed-window counters (migration 005; defaults 10 sessions and 30 upload tokens per client per hour, 300 and 900 globally; see [PRINT-ESTIMATION.md](docs/PRINT-ESTIMATION.md)). Client identity is a salted hash of the edge-supplied address (raw addresses are never stored), so clients behind one NAT share a budget and a distributed attacker is only bounded by the global cap. The limiter fails closed (429 over limit, error if counters are unavailable); the storefront then submits the file with the request as usual.
- Model parsing checks structure and limits; it is not malware scanning. Open downloaded models only in current slicer/CAD software.
- Local NDJSON logs are for development only and are not durable serverless storage.
