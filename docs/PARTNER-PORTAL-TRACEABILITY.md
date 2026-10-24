# Partner portal acceptance traceability

This is a coverage map, not a release certificate. The later scenario-level
[acceptance gap audit](PARTNER-ACCEPTANCE-GAPS.md) supersedes historical pending-flow
notes below when newer native journeys already cover part of them. The private packet names nine
Gherkin features. The implementations below have unit, contract or isolated native
PostgreSQL evidence. Optional activity, budget-week and partner-auth scenarios now have direct native
mappings; the remaining features still need their complete partner/owner flows.
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
  complete multi-partner browser authorization/race scenarios remain pending. The
  owner default/week cap controls are implemented; native browser evidence currently
  verifies default-cap persistence with new work disabled.
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
- **optional-activity.feature**: P-09's three named scenarios map directly to
  `test_native_optional_activity_partner_can_track_and_delete_own_elapsed_record`,
  `test_native_optional_activity_work_submission_never_requires_a_timer` and
  `test_native_optional_activity_gig_and_visit_screens_never_request_geolocation`
  in `tests/integration/test_partner_native_browser.py`. Real partner cookies/API/
  restricted native PostgreSQL prove start, committed-response replay, pause,
  reload, resume, stop and elapsed display, partner isolation, owner read denial,
  deletion, submission without any activity record and map-free navigation.
  Browser fixtures additionally cover pending locks, same-key retry, stale navigation,
  expired sessions, explicit refresh after conflict and clearing prior success while
  pending. Records stay server-side; no offline activity draft or passive GPS is added.
  This feature's native evidence does not establish production subdomain/TLS or the
  remaining eight complete packet features.
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
  covers concurrent award replay, restricted-role immutability and restore. Four-path
  browser tests cover optional customer permission, malformed codes, no permission
  reuse in pending drafts, review, JSON recovery and email fallback. Strict server
  normalization and owner attribution bind web choices to the selected code/server
  receipt; absent web consent cannot use the manual/paper path. Native HTTP with
  the actual request repository persists permission without attribution or awards.
  Native browser views prove account-specific codes with no customer information.
  Partner policy/earned-award display has 320/390 light/dark and inert-message tests.
  Complete owner attribution/settlement/award browser scenarios remain pending.
- **owner-control.feature**: application/auth/HTTP/native contract tests cover
  owner-only commands, real GitHub owner identity, revocation, kill switches,
  payable preservation and reconciliation after pause/sunset. Existing operator
  and storefront regression checks compatibility. The owner Partners area now exposes
  real clearance/pause/default caps, disabled program and account creation, campaigns
  with full bonus maxima, offers, review/reoffer, week caps and audit. Fixtures test
  320/390 themes, exact command retries, form locks, stale navigation, lost access and
  skip-link input preservation. Native browser evidence uses a bound synthetic GitHub
  owner session, denies an ordinary operator, persists cap changes and creates an
  approved payable from existing work while the program remains disabled. Full owner
  invitations/revocation, leads/referrals, finance/legal UI and complete scenarios,
  staging and disabled-production smoke checks remain pending.

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


Owner access lifecycle increment: Accounts now exposes deliberate enrollment/recovery
issuance and suspension/revocation. Contract evidence covers code replacement, replay,
old-passphrase rejection, suspended recovery and revoked denial. Browser fixtures cover
masked private display, hidden/late responses, expiry and authorization loss. Native
production-composition browser evidence covers suspension, recovery and debt preservation
while new work is disabled. This does not complete all nine native packet scenarios.


Owner Leads/Referrals increment: private owner screens now support business visits,
exact consent review, qualification/rejection, renewed correction, withdrawal/deletion,
web/paper attribution, independent sale evidence and source-specific accepted-rule awards.
Production-composition native journeys prove public opt-in through one earned bonus,
return-URL rejection, duplicate-award/payment-proof protection, suppressed contacts and
unchanged partner response privacy. This expands referral and visits-leads evidence;
it does not stand in for all nine full packet feature scenarios or actual settlement.


Owner Finance increment: the existing owner realm now exposes manual partial/full
settlement, nonsettlement reversals, acknowledged adjustments, safety/dispute/cancellation
reconciliation, funding exceptions and durable cash/accrual CSV batch history/download.
Native evidence follows real accepted work through payable, lost-response payment retry,
reversal/correction, paused safety resolution, lost-response export retry, identical reload
download and empty incremental re-export. This expands ledger-payments coverage; synthetic
settlement attestations do not prove an actual bank transfer or provider import.


Owner legal editorial increment: template/draft creation and typed immutable saves,
exact history/hash/text, saved and unsaved comparisons, all-document clause concerns,
resolutions, review requests, gated publication and retirement now have owner screens.
Native actual-runtime evidence proves old versions unchanged, comments retained across
versions, unreviewed publication denied and stale-editor text preserved. This covers
editorial portions of contract-review.feature; professional package/approval/import,
encrypted sharing and exact issue/acknowledgment UI journeys remain open requirements.


Professional review handoff preparation: owner package downloads now expose the
verified manifest/public key/signature/expiry alongside the same immutable ZIP.
Version details project package reviewer grants and program ID without full
artifacts. The owner client allows both private review-package and review-feedback
reads with its existing session, epoch and no-store protections. This is API/client
preparation; it does not complete the professional reviewer or encrypted offline
recipient journey in contract-review.feature.


Owner professional review workspace increment: package creation, frozen source/grant
inspection, private signed archive retrieval, explicit external professional decision
recording, bounded DOCX return import and original/suggestion inspection now have
owner screens. Native runtime evidence proves package command replay after a lost
response creates one package, download hash matches, importing a tracked insertion
changes no source/review state, conditional evidence leaves clearance off and separate
scoped synthetic approvals allow publication while program activation remains off.
This expands contract-review.feature evidence; encrypted offline recipient handoff,
exact issued-snapshot UI and the full packet acceptance journey remain required.


Encrypted offline professional handoff: owner-local authenticated encryption and a
separate reusable, self-contained reader now support signed package verification,
individual editable file retrieval and an encrypted DOCX return. The native runtime
journey uses a real signed package and an offline local-file reader, rejects wrong
passphrase/fingerprint, verifies unchanged source/review state after return import,
and retains separate explicit decision/publication actions. Lifecycle and crypto
bounds have focused regressions. This supplies the offline sharing path requested
by the packet; exact issuance, all remaining full-feature acceptance and release
requirements still need their own evidence.


Exact issuance and scoped activation increment: the owner can bind reviewed contract
and policy versions separately from activation, issue a typed exact-source copy and
inspect immutable source/render/bindings/hash history after pause or amendment. The
native runtime journey creates four explicitly synthetic scoped reviews, binds while
paused, separately activates the disposable fixture, retries issuance after a lost
response, denies acceptance before read acknowledgment, then ties acceptance to the
acknowledged copy. An amendment removes new-work clearance without changing history.
No live setting or professional decision is changed by this fixture. Cross-program
review pooling is denied; all source-required scopes are enforced. Native PostgreSQL
lock barriers cover cross-program retirement during authorization and binding.
This supplies the exact-copy UI path; full partner offline/PWA lifecycle, complete
packet feature acceptance and operational/deployment work still remain.


Partner offline PWA increment: P-03 now has a dedicated manifest, fixed static-shell
cache and cold-reopen workspace. Native runtime evidence prepares a minimal visit
context online, reopens a new page offline, saves a business-only visit, reloads it,
then explicitly sends after server session revalidation; one server visit persists.
No API responses, accepted terms, legal text, credentials, contact or consent enter
Cache Storage. Device drafts/preparation remain explicit, account-scoped, unencrypted
business-only data with a device warning. Known conflicts stay for manual review.
Worker migration preserves unrelated caches and refuses unknown routes/query assets.
Sign-out clears local records/static caches and other tab views. A native held real
login response reproduces a late-cookie sign-out race; superseded responses now revoke
their server session using transient CSRF, while unreadable/network failures announce
uncertainty instead of silently claiming success. Canonical-shell hosting is tested
with cleanUrls-style 308 redirects. Unsupported workers cannot claim preparation.
Chromium installability/manifest inspection reports no errors. This covers offline
visit continuity; optional timer lifecycle, the remaining complete named packet
scenarios and operational/disabled deployment gates still need their own evidence.


Release increment: the isolated protected static Vercel preview has exact-byte and
route/header evidence in [PARTNER-DEPLOYMENT.md](PARTNER-DEPLOYMENT.md). A fresh
complete two-repository encrypted platform checkpoint includes private objects;
its database/configuration archive passes isolated native restore and runtime
privilege denial, and both object streams pass read-only hash/content validation.
These address specific operational tests, not the nine complete feature scenarios,
full replacement-host/object-provider restore or production rollout/activation.


Budget authorization increment: all five budget-week scenarios map to eight native
browser cases in `test_partner_budget_browser.py`. A new reviewed-program helper
creates programs, initial invitation enrollment, exact issues/acknowledgments,
campaign publication and offers through actual owner/partner HTTP/browser boundaries.
Its accepted gigs and reservations are not seeded. Both concurrent accept transactions
are observed blocked on the held program row before release; one commits and the
other stays offered with no dangling reservation. Reduced caps preserve $200 payable;
Dec 30 acceptance survives Jan 1 review/payment while new work is denied. Four native
Monday/DST examples also verify the actual detail-page week. A missing detail-read
week was reproduced and fixed after authorization, without changing command locks.
This closes these budget scenarios, not production cookie/TLS or all financial rules.


Authentication increment: all five partner-auth scenarios now map directly to
`test_partner_auth_browser.py`. Genuine owner-issued codes are redeemed in independent
mobile browser contexts without GitHub; secure host cookies, same-code replay denial,
live revocation and private-view removal are verified. Another partner has an actual
$60 payable; own reads exclude it and ID reads are denied. The actual existing owner-work
handler and cookie/session-store authorizer expose a synthetic private work record to
the owner, deny partner/renamed partner cookies with 401, and still serve the owner.
This prevents a missing route or CORS-only failure from masquerading as authentication.
An isolated file control disables only the disposable fixture's program environment
flag after complete reviews/activation: enrollment stays invited, and the same code
works after reenabling. No production control endpoint or actual review is introduced.
Login/redemption 401s now give generic access help; form reset no longer hides the error.
Native auth evidence is separate from real provider OAuth and production TLS/cookies.
