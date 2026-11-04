# Workspace UX implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task by task. User authorized democratic selection and autonomous implementation.

**Goal:** Make partner and administrator work simple, polished, accessible and predictable across the real handbook flows.
**Architecture:** Improve existing native shells and render modules, retaining API/client/domain boundaries. Group navigation, prioritize review, progressively disclose consequential actions.
**Tech stack:** Native HTML/CSS/JavaScript, Python Playwright E2E, Node contract/unit tests.
**Spec:** ../specs/2026-11-03-workspace-ux-design.md

## Global constraints

Preserve private uploads, credentials, consent, exact terms, payable/payment distinctions, revision/idempotency controls, disabled launch gates, QA realm isolation, all destinations, light/dark/system themes, keyboard focus, reduced motion and 390-pixel behavior. Never edit generated QA copies manually. Preserve pre-existing dirty screenshot/audit files. No deployment is part of the local implementation.

## Review focus

- Async stale results cannot focus replaced content or overwrite titles.
- Route state, current parent destination and browser back/forward stay coherent.
- Failed/uncertain submissions retain data, request identity and visible errors.
- Disclosures do not hide required consent, verification or validation errors.
- Navigation and contextual controls remain usable on short landscape windows and keyboard zoom.

## Tasks

- [x] 1. Render three standalone concepts; obtain independent public votes; record decision with visual evidence.
- [x] 2. Partner shell and task flow: write failing E2E for labeled mobile navigation, parent routes, title/focus and explicit state-specific gig decisions; implement grouped navigation and quiet chrome, task hierarchy, visit/contact/device-draft sections, earnings/agreements readability. Run relevant partner workflow tests. Owner: partner/public/index.html and assets except generated qa-assets; partner-focused tests only.
- [x] 3. Administration: write failing E2E for grouped menu and deliberate account/finance action disclosures; implement grouped owner navigation, clearance hierarchy, compact account/payable review with deliberate creation/recovery/adjustment actions, and owner route focus/title. Preserve client calls and existing form binding. Owner: operator/partners.html, operator/assets/partner-owner*.js/css, owner-focused tests only. Do not change shared operator.css in this task.
- [x] 4. Main work inbox/detail: review captured workflows; improve shared operator.css and operator/index.html work hierarchy, contextual tool links and empty states while preserving selection/history and all actions. Add meaningful tests for any changed interaction. Owner: root agent, separate from partner-owner modules.
- [x] 5. Rebuild QA shell and cache versions; run npm test and screenshots; inspect preview board and representative 390/desktop light/dark task screens. Fix failures attributable to changes and document baseline/environment failures with isolated evidence.
- [x] 6. Independent code and visual review against full scope; correct findings. Refresh guidebook task captures and guide text, run docs build/check and inspect rendered guide. Record exact validation and remaining release steps.

## Execution notes

Initial recon is complete; initial tree has pending screenshot/UX audit updates. Both independent rendered votes favor A (24/25 and 23/25), with C's compact partner detail. Decision and 13 prototype renders are recorded in docs/design-concepts/2026-11-03. No product code changed before selection.

Root inbox task has 12 workflow checks plus a later 3-case short-viewport regression pass. Independent visual review verifies first request visible at390×520 and320×568. Review caught breakpoint focus loss and locked navigation visibility; workers added regression fixes before full verification. Final targeted partner and owner UX suites each pass10 tests. Admin work landing now opens real review work before setup; compact390×520 record visibility, actual mixed-program clearance, current-route/auth focus and bidirectional keyboard transitions have explicit regression coverage. Independent cross-reviews found no remaining source blocker. Baseline unit run had1276 passes and one generated-handbook false positive from environment variable names; ignored generated output was preserved outside public and isolated scanner checks passed5/5. Full fresh npm test started with final source, generated QA graphs and cache versions v33/v10/v4. Existing capture evidence was backed up under .private/before-workspace-ux-captures before the broad screenshot refresh.

Verification evidence: full `npm test` exited successfully with 1,277 unit/contract tests, 432 browser tests (one existing skip), and 241/241 UX checks. The native disposable-environment browser suite passed 18 tests. Visual review subsequently found a sticky owner feedback message covering content; the final correction keeps feedback in document flow and focuses errors only. Its regression and related owner/layout modules passed 61 tests, and final static validation passed. No backend, database, integration, pricing or deployment configuration changed. Source/QA caches are v33/v10/v4. The final screenshot matrix and handbook rendering are being verified serially; completion is recorded below when their actual outputs pass.

November 4 continuation: fresh full npm test passed 1,277 unit/contract tests, 433 browser tests with one existing skip, and 241 UX checks. All 168 screenshots and the preview board were regenerated; the complete board atlas and actual partner visit, owner gig and work inbox renders were inspected. All 40 handbook captures were refreshed. Independent final source review found no outstanding UI issue. Infrastructure follow-up adds separately tested recovery and optional-notification fixes; its release evidence is tracked in docs/INFRASTRUCTURE-VERIFICATION-2026-11-04.md. Main, production and handbook publication remain release gates until verified below.
