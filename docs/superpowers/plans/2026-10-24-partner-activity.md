# Optional partner activity implementation plan

**Goal:** Complete P-09 and the three optional-activity packet scenarios with safe browser controls and native persistence evidence.
**Architecture:** Retain the independent partner-only server timer API. Strengthen the existing activity renderer with per-action stable retry keys, one pending command, generation guards, session-expiry handling and explicit refresh. Display saved seconds, including sub-minute records. No new offline timer storage, GPS or pay prerequisites.
**Spec:** Private packet docs/02-REQUIREMENTS.md P-09 and testing/features/optional-activity.feature; existing docs/PARTNER-PORTAL.md privacy and auth boundaries.
**Tech stack:** Existing JavaScript modules, pytest/Playwright, disposable native PostgreSQL.

## Review focus

Lost committed responses must replay one command; rapid actions must not race.
Navigation/sign-out while pending must not restore old content or announce stale success.
Expired sessions must clear private view. Conflicts must allow explicit fresh reads.
A stopped short session must show its saved elapsed record. No passive geolocation.
No timer may become a requirement for gig submission or payment.

## Tasks

- [x] Add browser RED cases for stable lost-response retries, pending controls, stale navigation, expired sessions, conflict refresh and elapsed seconds.
- [x] Implement minimal renderer changes; run focused browser GREEN.
- [x] Add native packet scenario mappings: start/pause/resume/stop/delete and ownership; submit an accepted gig without starting a timer; gig/visit navigation without geolocation.
- [x] Bump static-shell release so updated browser bytes install coherently; retain shell privacy tests.
- [x] Add activity mobile/light/dark screenshot states; run screenshots and inspect preview board.
- [x] Run native suite and npm test with source held fixed, review, update traceability/verification and commit.

Ruling: packet P-09 specifies optional server activity; offline drafts are supplied by the existing visit workflow. Do not invent a second clock/reconciliation protocol or persist personal activity on shared devices.
