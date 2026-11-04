# Work, QA and partner portal polish

The existing teal identity and system typography remain the foundation. This pass gives records, decisions and forms more breathing room while keeping their operational hierarchy recognizable.

## Design and coverage

Use the existing ink `#172d3c`, muted text `#506371`, teal `#006e73`, pale surface `#edf3f5`, white paper and dark paper `#0e1b22`. Segoe UI Variable Text / Aptos / system sans-serif remains local; there are no new font or network dependencies. Reading widths remain bounded and data/amounts retain tabular formatting.

- Work inbox: wider queue gutters, clearer filters and record spacing, more space around work actions, facts, conversation, model, print and payment forms, and sufficient bottom space for the utility dock.
- Partner administration: consistent label/control spacing, larger form groups, comfortable fieldsets, clearer record separators, document line height and balanced headings. The desktop index and compact mobile navigation remain keyboard reachable.
- QA: a clear mode notice followed by three aligned tool groups on desktop, stacked on mobile. Inputs and buttons have the same appearance, minimum touch targets and focus treatment as the rest of the portal.
- Participant portal: comfortable profile/enrollment/visit forms, separated record groups, readable agreements and clear financial summaries. Live and QA use generated copies of the same maintained styles.
- Offline professional review: larger reading/form gutters and form spacing, with self-contained styles, exact CSP hashes and no network access.
- Motion: 160–200 ms control feedback and a small content/heading entrance. No ambient or looping decorative motion. Reduced motion disables transitions and animations. Controls stay available without animation.

Small corners soften editable controls; record lists keep meaningful separators rather than becoming repeated decorative cards. Existing themes, access boundaries, QA disclaimers, private data handling and real launch settings are preserved. The malformed work success icon is corrected to a proper CSS Unicode escape.

## Verification

`tests/e2e/test_portal_polish.py` covers six surfaces at 390-pixel dark/reduced-motion and 1440-pixel light/normal-motion settings. It verifies document overflow, usable control sizes, visible keyboard focus, real success-icon CSS rendering, QA tool presentation and motion preferences. Every surface also selects a manual theme opposite to the operating system and verifies the native control palette follows that choice. The screenshots below use synthetic presentation fixtures; they do not claim actual professional review or prove native persistence.

The existing responsive navigation, offline/PWA and old-worker upgrade suite passed 28 cases. A further QA access/pending/retry test verifies that controls remain hidden and disabled until owner access is verified, show busy feedback during a request and recover after a sanitized temporary error. Its status region stays outside the busy group for immediate announcements. Full project checks passed 1,277 unit tests, 408 E2E tests (one existing Windows skip), and 241 UX checks. The final focused release suite passed 26 cases. The refreshed native BDD suite passed all 60 scenarios; its 142 redacted image records and 60 documentation mappings validate. The complete 168-image screenshot matrix was regenerated and its preview board visually inspected. An independent source review found no critical or important issues.

## Rendered examples

- Work inbox: [phone](screenshots/work-390-dark.png), [desktop](screenshots/work-1440-light.png).
- Partner administration: [phone](screenshots/owner-390-dark.png), [desktop](screenshots/owner-1440-light.png).
- Owner QA controls: [phone](screenshots/owner-qa-390-dark.png), [desktop](screenshots/owner-qa-1440-light.png).
- Participant profile: [phone](screenshots/partner-390-dark.png), [desktop](screenshots/partner-1440-light.png).
- Participant QA profile: [phone](screenshots/partner-qa-390-dark.png), [desktop](screenshots/partner-qa-1440-light.png).
- Offline review: [phone](screenshots/review-390-dark.png), [desktop](screenshots/review-1440-light.png).

Production release source is `a72c529d88700d40e6d4dadb2f7e553c97050899`. Owner deployment: `3dprint4me-operator-pof9s29zh`; participant deployment: `3dprint4me-partners-ckwm59bg1`. Both existing production aliases serve the release. [Static production proof](hosted/static-proof.json) verifies eight HTML/assets against raw committed bytes, private source paths returning 404 and the QA CSP. Worker versions are work v32, participant v9 and QA participant v3.

Actual GitHub owner sign-in was verified in production. The [authenticated QA screenshot](hosted/owner-qa-authenticated.png) shows the owner controls, persistent QA warning and an existing retired synthetic program. This check performed no business mutation. The earlier complete hosted workflow smoke and its separate backend release remain documented in [the QA guide](../partner-qa/README.md). No new attorney/CPA approval, real work or payment was created by this UI release.

## Populated workflow samples

The [capture inventory](populated-captures.json) records dimensions and checksums for selected populated screens preserved during screenshot and browser verification. These complement the 12 spacing/motion views above.

- [operator detail mobile light](screenshots/populated/operator-detail-mobile-light.png)
- [operator conversation 390 dark](screenshots/populated/operator-conversation-390-dark.png)
- [operator models 390 light](screenshots/populated/operator-models-390-light.png)
- [operator print estimate desktop light](screenshots/populated/operator-print-estimate-desktop-light.png)
- [operator invoice mobile dark](screenshots/populated/operator-invoice-mobile-dark.png)
- [operator spoolman mobile dark](screenshots/populated/operator-spoolman-mobile-dark.png)
- [operator filament proposal desktop light](screenshots/populated/operator-filament-proposal-desktop-light.png)
- [operator inquiry detail light](screenshots/populated/operator-inquiry-detail-light.png)
- [operator partners accounts light](screenshots/populated/operator-partners-accounts-light.png)
- [operator partners campaigns dark](screenshots/populated/operator-partners-campaigns-dark.png)
- [operator partners gig light](screenshots/populated/operator-partners-gig-light.png)
- [operator partners finance light](screenshots/populated/operator-partners-finance-light.png)
- [operator partners forecasts dark](screenshots/populated/operator-partners-forecasts-dark.png)
- [operator partners leads light](screenshots/populated/operator-partners-leads-light.png)
- [operator partners legal version light](screenshots/populated/operator-partners-legal-version-light.png)
- [operator partners review package dark](screenshots/populated/operator-partners-review-package-dark.png)
- [operator partners review feedback light](screenshots/populated/operator-partners-review-feedback-light.png)
- [operator partners agreement copy light](screenshots/populated/operator-partners-agreement-copy-light.png)
- [operator partners weekly statement dark](screenshots/populated/operator-partners-weekly-statement-dark.png)
- [partner accepted gig light](screenshots/populated/partner-accepted-gig-light.png)
- [partner agreement light](screenshots/populated/partner-agreement-light.png)
- [partner visit light](screenshots/populated/partner-visit-light.png)
- [partner visit contact dark](screenshots/populated/partner-visit-contact-dark.png)
- [partner referrals light](screenshots/populated/partner-referrals-light.png)
- [partner weekly statements dark](screenshots/populated/partner-weekly-statements-dark.png)
- [partner offline drafts light](screenshots/populated/partner-offline-drafts-light.png)
- [partner materials partner history dark](screenshots/populated/partner-materials-partner-history-dark.png)
- [offline review unlocked dark](screenshots/populated/offline-review-unlocked-dark.png)

QA feedback samples: [owner access required](screenshots/owner-qa-access-required.png), [operation pending](screenshots/owner-qa-busy.png), [retry available](screenshots/owner-qa-retry.png).


## Live responsive verification

[Hosted UI observations](hosted/ui-proof.json) record all six anonymous production surfaces at 390 and 1440 pixels: no horizontal document overflow, controls at least 44 pixels high, visible keyboard focus, no uncaught page errors, and manual light/dark themes opposite the OS with matching native control palettes. Each observation links its screenshot and checksum. These anonymous checks complement the actual authenticated owner check and the separately identified synthetic/native workflow evidence.
