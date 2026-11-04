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

`tests/e2e/test_portal_polish.py` covers six surfaces at 390-pixel dark/reduced-motion and 1440-pixel light/normal-motion settings. It verifies document overflow, usable control sizes, visible keyboard focus, real success-icon CSS rendering, QA tool presentation and motion preferences. The screenshots below use synthetic presentation fixtures; they do not claim actual professional review or prove native persistence.

The existing responsive navigation, offline/PWA and old-worker upgrade suite passed 28 cases. Full project checks, refreshed native BDD evidence and deployment verification are recorded after final verification.

## Rendered examples

- Work inbox: [phone](screenshots/work-390-dark.png), [desktop](screenshots/work-1440-light.png).
- Partner administration: [phone](screenshots/owner-390-dark.png), [desktop](screenshots/owner-1440-light.png).
- Owner QA controls: [phone](screenshots/owner-qa-390-dark.png), [desktop](screenshots/owner-qa-1440-light.png).
- Participant profile: [phone](screenshots/partner-390-dark.png), [desktop](screenshots/partner-1440-light.png).
- Participant QA profile: [phone](screenshots/partner-qa-390-dark.png), [desktop](screenshots/partner-qa-1440-light.png).
- Offline review: [phone](screenshots/review-390-dark.png), [desktop](screenshots/review-1440-light.png).

Production verification is pending for this polish pass. The prior production QA release remains documented in [the QA guide](../partner-qa/README.md).
