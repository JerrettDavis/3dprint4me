# Changelog

## Unreleased - 2026-09-02

- Fixed the theme toggle icon breaking after the first click (light/dark states rendered no icon).
- Added E2E coverage for icon integrity, theme cycling, and mobile menu icons across every page.
- Added unit tests for the previously untested email (Resend) and webhook notification paths, including HTML-escaping and HMAC signature verification.
- Added a server-level integration suite that runs the real Node server against a mock Supabase backend to verify the full create → upload → complete request lifecycle, double-submission rejection, and post-completion upload rejection.

## 1.0.0 - 2026-09-01

- Added a 1200×630 social sharing PNG and complete Open Graph image metadata.
- Hardened production request IDs, method/action matching, Stripe return origins, and provider error parsing.
- Added complete responsive public storefront with system, light, and dark themes.
- Added services, selected work, about, order, privacy, terms, and 404 pages.
- Added guided service-specific intake and deterministic rough quote engine.
- Added draft persistence, file validation, request review, local fallback, email handoff, and JSON export.
- Added Vercel Node request, signed upload, health, and optional Stripe deposit endpoints.
- Added Supabase Postgres/private Storage migration, Resend delivery, and signed webhook adapter.
- Added original SVG brand, hero, social, and portfolio artwork.
- Added CSP/HSTS and other production security headers.
- Added static validation, integration unit tests, real HTTP E2E tests, browser UX/accessibility audit, screenshot generation, and GitHub CI.
- Added deployment, pricing, architecture, operations, portfolio, commerce, security, and contributor documentation.
