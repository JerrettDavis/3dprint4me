# Partner portal acceptance traceability

This is a coverage map, not a release certificate. The private packet names nine
Gherkin features. The implementations below have unit, contract or isolated native
PostgreSQL evidence; none yet has the requested complete partner/owner browser flow.
Existing storefront/operator browser regression is a separate compatibility check.
`test_partner_shell.py` adds synthetic API presentation/client checks for sign-in,
maintenance, responsive navigation, inert issued text/exact acknowledgment, skip-link
form preservation, delayed authentication and fee-proposal retry/history/navigation.
They do not replace complete native browser BDD.
The source packet stays private and the real professional approval gates stay off.

- **budget-week.feature**: `tests/unit/partner-policy.test.mjs`,
  `tests/contract/partner-repository.contract.test.mjs` and
  `tests/integration/partner-postgres.test.mjs` cover Central Monday/DST boundaries,
  integer-cent authorization ceilings, full maximum reservation, cap changes,
  transaction races, retries and pilot sunset. Explicit frozen bonus criteria and
  browser budget displays remain pending.
- **partner-auth.feature**: `tests/contract/partner-auth.contract.test.mjs` and
  `tests/contract/partner-http.contract.test.mjs` cover one-use invitation,
  passphrase credentials, persistent rate limits, separate host cookies, CSRF,
  exact origins, recovery/revocation, IDOR and safe failure output. Native tests
  exercise the real GitHub owner binding and restricted backend role. A first native Chromium/PostgreSQL slice proves two independent sessions, cookie
  flags/reload, profile persistence, cross-partner read denial and logout. Production
  subdomain/TLS, invitation/recovery and logout/offline-storage checks remain pending.
- **gig-choice.feature**: `tests/unit/partner-domain.test.mjs` and
  `tests/contract/partner-application.contract.test.mjs` cover voluntary offer
  acceptance/decline, negotiation/reoffer, revision conflicts, submission/review,
  safety/cancellation requests and frozen accepted terms. Ledger tests cover
  reconciliation without erasing earned obligations. Partner counterproposal UI and
  inert negotiation history are implemented. Native browser evidence verifies a
  persisted proposal without acceptance or a changed offered fee; fixture tests cover
  exact retries, pending form locks, closed-offer history, 320/390 layouts and delayed
  response navigation. Complete owner reoffer/acceptance/budget UI flows and browser
  acceptance receipts remain pending.
- **visits-leads.feature**: `tests/contract/partner-outreach.contract.test.mjs`
  covers business visits, permission for materials, specific contact consent,
  duplicate contacts, owner qualification, correction/renewed consent, withdrawal
  and deletion. `partner-materials.contract.test.mjs` covers issued/returned
  supplies without pay deductions. Immutable qualification evidence survives contact changes; referral contracts cover
  subsequent bonus use. Native browser evidence now records visits with and without contacts, checks
  unconsented-contact rejection, corrects purpose/contact with renewed permission,
  withdraws/deletes details, and preserves offline business drafts for explicit send.
  Browser/store tests cover stable live retries, session-expiry hiding and 100 queued
  visits with a lost committed response (101 attempts, 100 visits, zero leads).
  Lead retention operations, offline reload/worker lifecycle and the complete
  owner qualification/bonus browser scenario remain pending.
- **optional-activity.feature**: outreach/profile contract tests cover independent
  optional timer start/pause/resume/stop/delete, ownership and data export. Timers
  do not gate fees or acceptance. Browser offline drafts, accessible controls and
  deletion from device storage remain pending.
- **ledger-payments.feature**: `tests/contract/partner-ledger.contract.test.mjs`,
  `tests/unit/partner-export.test.mjs` and native restore tests cover earned debt,
  verified manual settlement, partial payments, immutable reversals, externally
  evidenced adjustments, duplicate evidence, stable incremental cash/accrual
  exports and source claims. Profile tests cover scoped earnings/statements/data
  export and derived-copy expiry. Weekly generated statements, forecasts, owner
  finance UI and account-specific CSV import validation remain pending.
- **contract-review.feature**: `tests/contract/partner-legal.contract.test.mjs`,
  `partner-template-seed.contract.test.mjs`, `partner-review-package.contract.test.mjs`
  and `tests/unit/partner-legal-content.test.mjs` cover immutable typed/hash-bound
  revisions, stale-save denial, any-revision/clause comparison, scoped comments,
  review evidence, publication, frozen issues and read acknowledgment. Native
  restore recomputes legal/snapshot/artifact hashes. Seven anonymized non-issuable
  templates seed without overwriting owner revisions. Signed private Markdown/DOCX
  bundles have audited owner-only expiring downloads, manifests and reviewer grants;
  all nine rendered template pages were inspected. Private feedback imports retain originals and untrusted comment/redline suggestions
  without applying text or approvals; native HTTP/restore and a LibreOffice saved
  fixture cover that boundary. Bounded simple table rendering is implemented and its three-page worksheet was
  rendered/inspected. Encrypted offline sharing, editorial UI and actual professional
  review remain pending.
- **referral.feature**: `partner-referrals.contract.test.mjs` covers opaque codes,
  immutable accepted bonus criteria and exact reserved maxima, consent-attested
  attribution to real requests, independently owner-verified settlements, participant
  identity checks at attribution/verification/award, global identity/request/payment
  uniqueness and atomic earned payables. Qualification evidence survives contact
  erasure; accepted promises survive reduced caps, pause and sunset. Native PostgreSQL
  covers concurrent award replay, restricted-role immutability and restore. Public
  customer opt-in intake, referral UI and complete browser scenarios remain pending.
- **owner-control.feature**: application/auth/HTTP/native contract tests cover
  owner-only commands, real GitHub owner identity, revocation, kill switches,
  payable preservation and reconciliation after pause/sunset. Existing operator
  and storefront regression checks compatibility. Partner owner screens, staging,
  production-disabled smoke checks and the complete browser scenario remain pending.

## Release evidence still required

All nine feature flows must run through real browser contexts and the native API
with disposable PostgreSQL, including two partners, owner/operator distinctions,
320/390-pixel layouts, themes, keyboard/reduced motion and offline privacy behavior.
Maintain explicit scenario assertions rather than counting unrelated regression
checks as partner coverage. Complete OpenAPI/requirements mapping, secure retention
and outbox operations, encrypted full-platform restore, clean reviewed PR/CI,
staging, disabled production deployment and provider-issued DNS/TLS verification.

See [implementation status](PARTNER-PORTAL.md) and the
[implementation plan](superpowers/plans/2026-10-23-partner-portal.md).
