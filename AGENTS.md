# Agent Guide

## Mission

Maintain 3dprint4.me as a trustworthy, accessible custom-fabrication storefront. Optimize for clear customer decisions, secure private intake, honest estimates, and easy deployment rather than framework novelty.

## Non-negotiable invariants

1. Only `public/` is static output.
2. No secret may enter `public/` or a browser bundle.
3. Customer uploads remain private by default.
4. Browser estimates are non-binding and server payloads are revalidated.
5. All four service paths must remain functional without unrelated fields being submitted.
6. The no-integration mode must still preserve a customer-recoverable request.
7. Light, dark, system theme, keyboard focus, reduced motion, and 390-pixel responsive behavior must remain intact.
8. External provider failures must not expose credentials or raw internal errors.
9. Do not add a public analytics or tracking service without explicit product need and privacy updates.
10. Do not treat a Stripe return URL as payment verification.

## Primary files

- Business configuration and pricing: `public/assets/js/config.js`
- Estimate logic: `public/assets/js/quote-engine.js`
- Intake behavior: `public/assets/js/order.js`
- Shared UI: `public/assets/js/site.js`
- Visual system: `public/assets/css/site.css`
- Server validation: `lib/validation.js`
- Integrations: `lib/supabase.js`, `lib/notifications.js`, `api/checkout.js`
- Deployment headers/output: `vercel.json`
- Database/bucket: `supabase/migrations/001_service_requests.sql`

## Change workflow

1. Read the relevant product and architecture document.
2. Make the smallest coherent change.
3. Add or update unit/E2E coverage.
4. Run `npm test`.
5. Run `npm run screenshots` for any visible change.
6. Inspect `screenshots/preview-board.png` rather than trusting assertions alone.
7. Update docs when integration contracts, pricing behavior, environment variables, or operational expectations change.

## CSP rule

The home page contains inline JSON-LD. Production CSP uses a SHA-256 hash rather than `unsafe-inline` for scripts. When the structured data changes, run `npm run validate`; it reports the exact missing hash. Replace the old hash in `vercel.json` and rerun validation.

## Provider changes

Use official primary documentation. Add regression tests that assert URL shape, method, headers, and failure behavior. Keep the provider behind a module boundary and preserve the unconfigured state.

## Completion criteria

A task is complete only when code, tests, documentation, screenshots where applicable, and production failure behavior agree.
