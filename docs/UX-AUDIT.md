# UX, Accessibility, and Responsive Audit

**Result: PASS**  
Generated: 2026-09-16T02:18:00.858320+00:00  
Automated checks: **193/193 passed** across 8 routes, desktop light mode, mobile dark mode, and a separate keyboard-focus sequence.

## What was exercised

The audit executes the production HTML, CSS, SVG artwork, quote engine, navigation, and form JavaScript in Chromium. It checks page landmarks, heading order, metadata, image alternatives, accessible names, new-window safety, focus visibility, responsive overflow, control target size, and WCAG AA contrast wherever the background can be measured reliably. The E2E suite separately starts the real Node server and verifies the request API, local request log, validation, security headers, error paths, and no-account fallback.

| Area | Result | Evidence |
|---|---:|---|
| Browser/render checks | Pass | 193 passed, 0 failed |
| Viewports | Pass | 1440×1000 light and 390×844 dark on every route |
| Keyboard | Pass | Separate Tab-order sample |
| Request UX | Separate E2E suite | Quick inquiry, project dialogs, four-service wizard, inline errors, recovery, email and JSON handoff |
| Backend lifecycle | Separate API/unit suites | Create/complete, validation, health, security headers, and unconfigured integration responses; live providers need deployment verification |
| Reduced motion | Separate E2E suite | Browser test verifies transitions/animations collapse under the OS preference |

## UX review

The homepage starts with outcome-oriented choices, published project examples, and a short inquiry. Customers can describe an idea, share a link, or attach files without selecting a paid service. The detailed builder remains available for the four service paths and labels its estimates as non-binding.

Quick inquiries and detailed requests retain separate contracts. The inquiry provides field validation, optional local drafts, and email/download recovery when online intake is unavailable. A recovery copy is not proof of server acceptance or email delivery. The detailed builder retains its service-specific review and consent step.

The findings above report mobile overflow and target sizes, and the separate E2E suite checks keyboard dismissal, dialog behavior, and theme controls. Light, dark, and system preferences share the same customer content. Generated screenshots include desktop and mobile inquiry and project dialogs for visual review.

## Finding resolved during verification

The audit found that an author-level `display` rule could override the browser’s default rendering of the HTML `hidden` attribute, causing the optional Stripe deposit control to remain visible before Stripe was configured. A global `[hidden] { display: none !important; }` invariant was added and covered by the order-flow test.

## Limits and launch checks

Automated contrast sampling excludes text positioned over gradients or illustrations because a single computed background color would be misleading. Those overlays require separate visual inspection of generated screenshots; this script does not certify that inspection. Before accepting paid work, perform one manual pass with a production URL, a screen reader, real email delivery, private Blob storage, and Stripe test mode. Pricing, taxes, shipping rules, prohibited-item policy, warranty language, and privacy terms should be reviewed for the actual business and jurisdiction.

The machine-readable result is in [`docs/ux-audit.json`](./ux-audit.json).
