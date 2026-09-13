# UX, Accessibility, and Responsive Audit

**Result: PASS**  
Generated: 2026-09-13T18:01:05.778788+00:00  
Automated checks: **193/193 passed** across 8 routes, desktop light mode, mobile dark mode, and a separate keyboard-focus sequence.

## What was exercised

The audit executes the production HTML, CSS, SVG artwork, quote engine, navigation, and form JavaScript in Chromium. It checks page landmarks, heading order, metadata, image alternatives, accessible names, new-window safety, focus visibility, responsive overflow, control target size, and WCAG AA contrast wherever the background can be measured reliably. The E2E suite separately starts the real Node server and verifies the request API, local request log, validation, security headers, error paths, and no-account fallback.

| Area | Result | Evidence |
|---|---:|---|
| Browser/render checks | Pass | 193 passed, 0 failed |
| Viewports | Pass | 1440×1000 light and 390×844 dark on every route |
| Keyboard | Pass | Tab-order sample includes a visible focus treatment |
| Request UX | Pass | Service-specific wizard, inline errors, quote updates, upload metadata, review, local fallback, email and JSON handoff |
| Backend lifecycle | Pass | Real HTTP create/complete, health, validation, 404, security headers, unconfigured integration responses |
| Reduced motion | Pass | Browser test verifies transitions/animations collapse under the OS preference |

## UX review

The primary action is consistent across the header, hero, service cards, portfolio, and footer. The intake begins with four outcome-oriented choices instead of asking customers to understand fabrication terminology. Each choice reveals only its relevant fields, and the estimate stays visible without being presented as a binding checkout total.

Validation is local to the field, moves focus to the first issue, and preserves the draft in the browser. The final review restates the service, rough range, contact, handoff, files, and description before consent. When no external service is configured, submission still succeeds as a demonstrable local handoff with an email draft and downloadable JSON copy rather than ending in a dead form.

Mobile navigation is keyboard-dismissable, primary controls remain at least 44 CSS pixels where practical, form actions remain reachable in a sticky footer, and all audited pages avoid horizontal scrolling at 390 CSS pixels. Light, dark, and system themes use the same information hierarchy rather than changing content between modes.

## Finding resolved during verification

The audit found that an author-level `display` rule could override the browser’s default rendering of the HTML `hidden` attribute, causing the optional Stripe deposit control to remain visible before Stripe was configured. A global `[hidden] { display: none !important; }` invariant was added and covered by the order-flow test.

## Limits and launch checks

Automated contrast sampling excludes text positioned over gradients or illustrations because a single computed background color would be misleading; those overlays were visually inspected in the generated screenshots. Before accepting paid work, perform one manual pass with a production URL, a screen reader, real email delivery, the chosen private storage bucket, and Stripe test mode. Pricing, taxes, shipping rules, prohibited-item policy, warranty language, and privacy terms should be reviewed for the actual business and jurisdiction.

The machine-readable result is in [`docs/ux-audit.json`](./ux-audit.json).
