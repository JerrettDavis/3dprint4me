# Product Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Build and deploy approved blue-and-teal D across storefront, admin and partners.
**Architecture:** Extend static HTML/CSS/ES modules and existing private application shells; reuse domain/API boundaries. No database changes.
**Tech Stack:** HTML, CSS, browser ES modules, Node22, Python Playwright, Vite customizer, existing Vercel projects.
**Spec:** docs/superpowers/specs/2026-10-26-product-counter-design.md

## Global Constraints

All AGENTS.md invariants apply. Only public/ is storefront output. Blue #174b71, teal #006e73, white catalog. No invented prices or stock. Preserve four intake paths, recovery, auth/privacy, no-remote customizer, sensitive geometry handling, themes/focus/reduced motion/390px. Keep partner flags, native API and DNS unchanged.

## Review Focus

- Empty/unmatched catalog searches give a recovery path and live count.
- Catalog requests scope service and context correctly without unrelated inputs.
- Existing project links, inquiries and recovery remain usable.
- Long records, permission-off and offline screens remain legible at 390px.
- Service workers deliver changed shell assets while keeping private APIs network-only.

## Task 1 — Public storefront and shop
Files: public/index.html, public/assets/js/site.js, public/assets/css/shared.css, new shop modules/styles, customizer shell as needed, tests/e2e shop tests, unit/contract catalog tests.
- [x] Write meaningful failing tests for catalog filters/search/empty state and real product links/service scope.
- [x] Implement approved D hero/catalog and real paths, preserving existing inquiry/project and recovery flows.
- [x] Apply public shared visual system across pages and generator shell; build/version assets.
- [x] Run focused tests, record verification, commit scoped files.

## Task 2 — Private workspaces
Files: operator/assets styles and view modules, operator index/partner shell, partner/public assets and shell, service workers, focused browser tests.
- [x] Add failing browser coverage for next-action hierarchy and responsive navigation.
- [x] Implement D workspace language and reduce clutter with actual state, preserve every authorized action and failure path.
- [x] Bump shell releases and verify online/offline navigation and network-only private APIs.
- [x] Run focused regression, record verification, commit scoped files.

## Task 3 — Review and release
- [x] Independently review each task and whole change; address findings.
- [x] Run npm test, partner native browser coverage appropriate to changed views, npm run screenshots and inspect screenshots/preview-board.png plus private workspaces.
- [x] Build all production outputs and commit final assets/docs. Deploy exact committed release through existing storefront/operator/partner projects, retaining rollback identities.
- [x] Verify public routes/HTTPS/exact UI files and anonymous private boundaries. Document results and limitations.

## Execution rulings

Reuse clean existing linked worktree G:/git/3dprint4me-partner-portal on a new redesign branch because it contains the deployed partner release absent from origin/main. Existing main checkout and unrelated invoicing edits are preserved. User build-and-deploy request supplies execution and production publication authorization; no repeated plan approval is needed.

## Completed implementation evidence

Task 1: `f1d6993`, public catalog and shared visual system. Focused storefront/inquiry/shared tests 21 passed; order/shop tests 21 passed; final shop allowlist/draft checks 3 passed. Static validation and customizer build passed. Inquiry/gallery/share/recovery are preserved; final production screenshots remain in Task 3.

Task 2: `ab2ce59`, next-action operator queues, real active partner work and distinct unpaid/settlement regions. Eleven new hierarchy, unresolved-state and contrast tests passed; 86 existing workspace/PWA/privacy/navigation tests passed. Operator shell v28 and partner shell v7 preserve private requests as network-only. Independent review findings were fixed: accurate QR copy, catalog context, dark owner action contrast, unresolved work visibility and header focus contrast.

Final release and exact validation details: [PRODUCT-COUNTER-RELEASE.md](../../PRODUCT-COUNTER-RELEASE.md). The full browser run plus repaired asynchronous readiness check is documented precisely; no uninterrupted green npm-test command is claimed. All production assets remain identical to source41ca3d4.
