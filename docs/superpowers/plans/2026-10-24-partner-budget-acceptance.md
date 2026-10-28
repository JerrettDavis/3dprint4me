# Native budget acceptance plan

**Goal:** Execute all five budget-week packet scenarios against real browser/API/native PostgreSQL rather than seeded accepted gigs.
**Architecture:** A separate Python support module creates a new program, reviewed synthetic source, invitations, issued agreements, campaigns and offers through authenticated HTTP/browser flows. Existing historical fixture obligations remain untouched. Optional fixture-only file clock drives the already-injected runtime clock; production modules and HTTP routes do not gain a clock control.
**Spec:** Private testing/features/budget-week.feature, P-06, O-04/O-05 and B weekly authorization rules; docs/PARTNER-ACCEPTANCE-GAPS.md.

- [x] Add validated atomic clock file support only to the disposable test fixture, preserving real-time default and cleanup.
- [x] Build reusable reviewed-program/two-partner enrollment/acknowledgment helper with real owner/session/CSRF boundaries and no direct financial seeding.
- [x] Execute independent $50/$60 acceptance, simultaneous $150/$150 acceptance with durable reservation checks, cap reduction preserving $200 owed, sunset completion/review/payment and four Monday/DST examples.
- [x] Read-only review; run native suite and npm test with source frozen; update gap audit/traceability/verification and commit.

Ruling: test fixtures may create explicit synthetic professional reviews in disposable PostgreSQL only. No real decision, live program flag, production data or provider payment is changed. No screenshots are needed unless a visible product defect requires a UI change.
