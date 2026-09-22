# 3dprint4.me

A production-oriented storefront and guided project intake for custom 3D modeling, printing, printer repair, tuning, consulting, and printer design.

![3dprint4.me light, dark, desktop, and mobile preview board](screenshots/preview-board.png)

The project is deliberately static-first. The public site is plain HTML, CSS, SVG, and browser JavaScript, while four small Node endpoints provide request handling, private upload instructions, health reporting, and optional Stripe deposits. It deploys cleanly to Vercel, runs locally with no JavaScript package installation, and remains demonstrable even before external services are connected.

## What is included

- Eight complete public pages with a shared, responsive visual system
- Automatic system theme plus explicit light and dark controls
- Outcome-based service selection for printing, design, repair, and consulting
- Four-step intake with service-specific questions and inline validation
- Live rough estimates driven by material, time, quality, quantity, complexity, finishing, and delivery inputs
- File selection for STL, 3MF, STEP, OBJ, Fusion, ZIP, image, PDF, and text references
- Private, direct-to-Supabase signed uploads when configured
- Supabase request records protected behind server-only credentials
- Owner and customer email delivery through Resend
- Signed generic webhook delivery for CRM, automation, Home Assistant, n8n, Make, Zapier, or custom systems
- Optional Stripe-hosted project deposit checkout
- Durable Neon-backed work queue with revision-safe operational updates
- Separate installable operator PWA with GitHub sign-in, private notes, and generic Web Push alerts
- No-account fallback with local draft persistence, email handoff, and downloadable JSON
- Original SVG artwork, portfolio illustrations, favicon, PWA manifest, sitemap, robots file, Open Graph metadata, and JSON-LD
- Static checks, Node unit tests, real-HTTP E2E tests, browser UX tests, responsive checks, accessibility auditing, and generated screenshots

## Verification status

The delivered build passes:

- Static validation of all public routes, local references, JavaScript syntax, Vercel output configuration, and CSP hashes
- 10 Node unit tests covering integration boundaries, upload scoping, completion state, and JSON content types
- 7 end-to-end scenarios, including the real local API lifecycle
- 193 automated UX, accessibility, responsive, browser-error, keyboard, and contrast checks
- Desktop light, desktop dark, full-page, and mobile dark screenshot generation

See [`docs/UX-AUDIT.md`](docs/UX-AUDIT.md) and [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Run locally

Only Node is required to run the site and local API:

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

To run the storefront and private operator inbox together with loopback-only development auth:

```bash
npm run dev:workspace
```

Open the printed storefront and operator URLs (defaults: ports `4173` and `4180`). Local work persists in ignored `data/operator-dev.json`. This mode generates ephemeral VAPID keys and never sends external Push traffic.

The development API records create and complete events in `data/dev-requests.ndjson`. That file is ignored by Git.

For the browser tests, audit, and screenshots:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
npm test
npm run screenshots
```

The test harness uses `/usr/bin/chromium` when present and otherwise uses Playwright's managed Chromium. Set `CHROMIUM_PATH` to override the executable.

## Configuration levels

The same code supports four useful operating modes.

| Mode | Configuration | Behavior |
|---|---|---|
| Preview | Nothing | Full UI, calculator, draft saving, local browser copy, email draft, and JSON export |
| Delivery | Resend and/or webhook | Requests are delivered without a database; uploads are recorded as metadata only |
| Full intake | Supabase, optionally Resend/webhook | Request records persist and files upload to a private bucket by signed URL |
| Intake plus deposit | Full intake plus Stripe | Customers can open a Stripe-hosted checkout for a configurable project deposit |

Copy `.env.example` to `.env` for local work. Vercel reads the same names from Project Settings.

### Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `SITE_URL` | Recommended | Canonical origin used for Stripe return URLs |
| `DATABASE_URL` | For Neon intake/queue | Server-only Neon connection string |
| `BLOB_READ_WRITE_TOKEN` | For Neon intake files | Server-only private Vercel Blob credential |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` | Operator auth | Managed Neon Auth service and verifier keys; GitHub is the initial provider |
| `OPERATOR_ALLOWED_ORIGINS` | Operator API | Exact comma-separated operator origins allowed credentialed CORS access |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push | Web Push identity; only the public key reaches an authenticated browser |
| `PUSH_WORKER_URL`, `PUSH_WORKER_SECRET` | Push delivery | Immediate Neon Function trigger and its server-only shared secret |
| `SUPABASE_URL` | For database/uploads | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For database/uploads | Server-only REST and Storage credential; never expose it in browser code |
| `SUPABASE_STORAGE_BUCKET` | Optional | Private bucket name, default `service-files` |
| `RESEND_API_KEY` | For email | Resend API key |
| `REQUEST_FROM_EMAIL` | For email | Verified sender identity |
| `REQUEST_TO_EMAIL` | For email | Owner intake address |
| `REQUEST_WEBHOOK_URL` | For automation | HTTPS endpoint that receives completed requests |
| `REQUEST_WEBHOOK_SECRET` | Recommended with webhook | HMAC-SHA256 signing secret |
| `STRIPE_SECRET_KEY` | For deposits | Stripe secret API key |
| `DEPOSIT_AMOUNT_CENTS` | Optional | Deposit amount, default `2500` |
| `LOCAL_DEV` | Local only | Enables NDJSON request logging when set to `1` |
| `HOST`, `PORT` | Local only | Development listener, defaults `127.0.0.1:4173` |

## Deploy to Vercel and Supabase

1. Create a Supabase project.
2. Run [`supabase/migrations/001_service_requests.sql`](supabase/migrations/001_service_requests.sql) in the SQL editor or with the Supabase CLI.
3. Import this repository into Vercel.
4. Add the production environment variables from `.env.example`.
5. Deploy. `vercel.json` selects the `public/` output and keeps the Node functions in `api/`.
6. Add `3dprint4.me` and the preferred `www` redirect in Vercel, then update the domain's DNS records as instructed by Vercel.
7. Verify `/api/health`, submit a test request, confirm the private object and database row, then test email and Stripe in their sandbox modes.

Detailed instructions and rollback guidance are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Request lifecycle

```mermaid
flowchart LR
    A[Customer chooses a service] --> B[Relevant project questions]
    B --> C[Live planning estimate]
    C --> D[Contact, delivery, and files]
    D --> E[Review and consent]
    E --> F[Create request ID]
    F --> G{Supabase configured?}
    G -- Yes --> H[Create draft row]
    H --> I[Signed direct file uploads]
    G -- No --> J[Record file metadata only]
    I --> K[Complete request]
    J --> K
    K --> L[Database update]
    K --> M[Owner and customer email]
    K --> N[Signed automation webhook]
    K --> O[Optional Stripe deposit]
```

## Pricing configuration

All planning rates live in [`public/assets/js/config.js`](public/assets/js/config.js). The quote engine is deterministic and has no hidden remote dependency.

The supplied numbers are a starting model, not business or tax advice. Before launch, review:

- Hourly design and consulting rates
- Material cost per gram and machine-hour recovery
- Minimum job charge
- Color-change, finishing, delivery, and quantity adjustments
- Repair and diagnostic ranges
- Taxes, shipping, replacement parts, licensing, and rush work

The calculator intentionally returns a range. A human confirms geometry, risk, material, schedule, and scope before work begins. See [`docs/PRICING-CALIBRATION.md`](docs/PRICING-CALIBRATION.md).

## Repository map

```text
3dprint4me/
├── api/                         Vercel Node functions
├── data/                        Local development request log
├── docs/                        Product, architecture, deployment, and audit docs
├── lib/                         Validation and integration adapters
├── neon/                       Neon migrations and scheduled Push Function
├── operator/                   Separate private installable operator PWA (never copied to public)
├── public/                      Only files published as the static site
│   ├── assets/css/              Theme and responsive component system
│   ├── assets/icons/            Brand mark and logo
│   ├── assets/images/           Original hero and portfolio SVG artwork
│   └── assets/js/               Site UI, intake, configuration, and quote engine
├── screenshots/                 Generated visual evidence
├── scripts/                     Dev server, validation, and screenshot tooling
├── supabase/migrations/         Database and private bucket setup
├── tests/                       Unit, E2E, browser harness, and UX audit
├── .env.example
├── package.json
└── vercel.json
```

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | `GET` | Deployment and integration readiness |
| `/api/request` | `POST` | Validate the first complete request payload and reserve an ID |
| `/api/upload-url` | `POST` | Create a request-scoped signed private upload URL |
| `/api/request` | `PATCH` | Finalize the request and deliver notifications |
| `/api/checkout` | `POST` | Create an optional Stripe Checkout Session for a deposit |
| `/api/operator-session` | `GET` | Authorize an approved operator identity |
| `/api/operator-work` | `GET` | Read minimized queue, private detail, or incremental events |
| `/api/operator-work-update` | `PATCH` | Apply revision-checked workflow updates and private notes |
| `/api/operator-push` | `GET`, `POST` | Manage the authenticated operator's Push subscription |

API payloads are size-limited, normalized, and revalidated server-side. Client-side estimates and validation exist for usability, not trust.

## Commerce direction

Custom fabrication is best served by the guided request flow because geometry, licensing, materials, machine time, and delivery need review. Fixed products can be added later through Shopify's Storefront API or Buy Button, while SHOP.COM can be treated as a separate marketplace channel. The adapter strategy and recommended sequencing are in [`docs/COMMERCE-OPTIONS.md`](docs/COMMERCE-OPTIONS.md).

## Security and privacy

- The Supabase service-role key exists only in server environment variables.
- The storage bucket is private.
- Upload destinations are random, request-scoped, signed, and non-overwriting.
- Email download links expire after 15 minutes.
- Webhook payloads can be HMAC signed.
- The public response does not reveal integration errors or secrets.
- Security headers include CSP, HSTS, clickjacking protection, content-type protection, referrer limits, and restricted browser permissions.
- The request form includes a honeypot field and explicit consent.

Read [`SECURITY.md`](SECURITY.md) before accepting untrusted files in production.
The complete setup, operator approval, notification, recovery, and provider-swap runbook is in [`docs/OPERATOR-INBOX.md`](docs/OPERATOR-INBOX.md).

## Deliberate tradeoffs

This repository does not require React, Blazor, or a client framework to render the marketing site. That keeps first load, maintenance, hosting, and failure modes small. The API and integration modules are intentionally separable, so a future Blazor or MudBlazor administration application can consume the same records and webhook contracts without replacing the public experience.

The optional Stripe adapter creates hosted deposit checkout sessions and associates the request ID through metadata. It does not yet reconcile payment events into the request table. Add a verified Stripe webhook before using payment state as an automated fulfillment gate.

## License

MIT. Marketplace models, third-party designs, fonts, customer files, and the `3dprint4.me` name/domain retain their respective ownership and license terms.
