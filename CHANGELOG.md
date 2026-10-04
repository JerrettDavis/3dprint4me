# Changelog

## 2026-10-03

- Every Customize generator now has the same font picker: built-in block font, the eight curated OFL fonts, a font installed on the customer's computer (Chromium, with the browser's permission prompt) or the customer's own font file. The Wi-Fi tag (title and network name) and the rating card (caption) can print in any of them, as the name plate and route shield already could.
- An installed font or a font file needs a checked "I have the right to use this font to make a printed item" confirmation before it can be chosen; the confirmation is validated with the request details and never kept in a draft. Route shield's `font_mode` field became the shared `font` field (generator version 2).
- Added the Customize section (`/customize/`): parametric generators that build a multi-color, Bambu-compatible 3MF in the browser (Manifold WASM in a worker) with a schema-driven form, 2D/3D preview and local planning facts. Launch generators: route shield, Wi-Fi QR tag (placard, keychain, business card), rating card (built-in icons or a locally traced image, half stars) and name plate (self-hosted OFL fonts or the customer's own font file).
- **Continue to request** hands the model to the print request through IndexedDB (download fallback when storage is blocked); the server re-validates the `customization` provenance against the generator schema and stores it in the request payload (no migration, no new function or environment variable). The operator work detail shows a Customizer section.
- Sensitive generator fields (the Wi-Fi password) are redacted in the browser, on the server and in 3MF metadata; they exist only as geometry in the model file.
- `/customize/*` has its own CSP (`'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`); `vercel-build` runs the Vite build first.
- Validation gates: every registered generator needs a page, builder, built page and rights note (publishable ones a sitemap entry, catalog card and screenshots), and `public/customize/` may contain no remote URL or remote request. A new all-generators test builds every default and preset on real Manifold (≤ 5 colors, analyzer-clean, under 20 s, no sensitive canary in the 3MF). A full E2E matrix runs every generator from edit to operator store, offline from other origins, at 390 px, under the real CSP. A new architecture rule stops server code from importing `customizer/`.
- Fixed: generated meshes kept zero-area triangles, so the order page warned that Wi-Fi tags, rating cards and some name plates "may need repair"; JPEGs with more than 64 KB of EXIF/ICC data before the frame header were refused as unreadable.
- Documentation: [GENERATORS.md](docs/GENERATORS.md) (contract, adding a generator, troubleshooting); architecture, deployment (owner-gated rollout), print-estimation (multi-color slicing) and verification updates.

## 2026-09-30

- Added global and per-client DB-backed rate limiting for anonymous print-estimate session creation and upload-token issuance (additive migration 005, fails closed with 429; the storefront still uploads the file with the request).

- Added model-aware print estimation: bounded browser/server STL and 3MF geometry analysis with hostile-archive limits, a prominent STL/3MF intake path, and honest geometry-versus-slicer confidence.
- Added a server-only dual-floor pricing policy (market rate card vs. economic floor at a required margin vs. minimum charge) pinned to the rate-and-margin workbook fixtures, plus a private filament cost basis.
- Added capability-owned anonymous estimate sessions with direct private Blob uploads, immutable estimate snapshots, attachment to the single work item on submission, and retention/privacy cleanup.
- Added an asynchronous slicer port with local CLI and HTTP providers and a leased retry job runner.
- Added the operator print sheet: files with 60-second signed downloads, latest estimate, cost/margin, history, job state, and estimated-versus-actual runs. Work list and Home Assistant stay minimized.
- Migration 004 (additive). Verified 220 unit/contract tests, 61 E2E tests, 193/193 UX checks, and 28 screenshots.

## 2026-09-22

- Reorganized Project Request, Quick Inquiry, Work Management, and Checkout around explicit domain, application, adapter, runtime, and transport boundaries.
- Split the detailed browser intake into model, validation, draft, file, client, view, and controller modules while preserving all four service paths and local recovery.
- Added executable architecture dependency rules, repository contract tests, domain language, and ADR documentation.
- Fixed private Blob uploads in Neon mode, made denied browser storage non-fatal, and removed unsafe HTML rendering from request review output.
- Verified 139 unit/contract tests, 46 E2E tests, 193/193 UX checks, and the generated responsive light/dark screenshot board.

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
