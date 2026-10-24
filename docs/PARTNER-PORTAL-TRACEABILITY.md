# Partner portal acceptance traceability

This is a coverage map, not a release certificate. The later scenario-level
[acceptance gap audit](PARTNER-ACCEPTANCE-GAPS.md) supersedes historical pending-flow
notes below when newer native journeys already cover part of them. The private packet names nine
Gherkin features. The implementations below have unit, contract or isolated native
PostgreSQL evidence. Optional activity, budget-week, partner-auth, gig-choice and visits/leads now have
direct native mappings. Referral uses the staged attribution interpretation below.
Owner-control, ledger and legal-review follow-ups below add direct native mappings;
operational release evidence remains separate.
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
  export and derived-copy expiry. Native browser journeys now cover owner finance,
  forecasts and opt-in weekly statements; their production rollout remains pending.
  The two direct gift/unconfigured-provider mappings are recorded below. Actual
  account-specific provider import and completed tax reporting remain unverified.
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
- **owner-control.feature**: `test_partner_owner_control_browser.py` directly maps all
  four named scenarios through the native API and disposable PostgreSQL:
  `test_native_only_owner_can_publish_forty_dollar_campaign_and_partner_sees_frozen_offer`,
  `test_native_owner_suspension_ends_routes_but_preserves_payable_for_lawful_settlement`,
  `test_native_program_pause_denies_unaccepted_work_without_erasing_prior_debt`, and
  `test_native_existing_private_work_inbox_updates_while_storefront_and_status_routes_stay_separate`.
  Assertions cover actual publication/offer and partner 403, route revocation with
  unchanged debt and partial settlement, paused acceptance with unchanged commitments,
  and private work acknowledgment/priority/note persistence via existing handlers.
  Storefront and status static bytes remain unchanged and private contact data stays
  out of those responses. The owner session is synthetic and bound to the existing
  GitHub identity provider; this does not prove real OAuth, TLS or live status health.
  Existing layout, theme, retry, stale-navigation and owner-lifecycle checks remain
  complementary. Staging and disabled-production smokes remain pending.

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


Gig-choice increment: four direct native cases in `test_partner_gig_browser.py` create
fresh offers under a fully reviewed synthetic program. They cover $50 authorization,
ten unique allowed visits through the UI and actual owner review with submitted/unpaid
assertions; decline without obligation/account penalty followed by future acceptance
under unchanged program settings; owner-visible unsafe-work escalation without GPS or
route fields and preserved future acceptance; and offline business-only save followed
by identical visit/work retries after actual committed responses are lost. Exactly one
visit and one submission event remain. No accepted gig/reservation is seeded for these
programs. Existing cold-reopen/100-draft tests supplement this exact scenario mapping.
The native command explicitly includes the new module, so the CI boundary maintains it.


Consent/referral increment: `test_partner_consent_referral_browser.py` directly maps
all five visits-leads scenarios and the original-$20-versus-new-$10 referral policy
scenario. Actual second-browser login, new client IDs/command keys, a qualified-lead
award and exact single visit/lead/award/payable counts prove the duplicate boundary.
Consent language/version and audit evidence are read from native persistence. Rejected
unconsented data creates no visit/lead/consent/outbox side effect; withdrawal suppresses
owner contact and server requalification. The optional disposable fixture fetch observer
writes only a count and denies attempts; zero observed fetch calls does not claim to
monitor other network transports. No production control surface is added.

Quote attribution is two-stage: private intake immediately retains opted-in code and
server receipt and appears in owner pending attribution; verified attribution requires
the owner check. The fresh original-policy test traverses both stages and actual
synthetic settlement verification, then earns $20 while a separate published/accepted
policy promises $10. Neither a quote nor synthetic evidence attests to actual payment.

Ledger/payments follow-up: `test_partner_ledger_browser.py` directly maps the remaining
`Gift is not contractor compensation` and `Invoice Ninja unavailable does not lose
work` scenarios. Fresh accepted $50 work becomes an actual payable; actual statement
and cash/accrual downloads exclude a separate synthetic $200 personal gift. The
application role cannot access the disposable owner-books schema. Invoice Ninja's
actual runtime reports unconfigured after explicit fixture credential overrides;
private payable/CSV persist through reload, invoice operation count stays zero and
no fixture fetch occurs. These are not actual provider import, owner-books integration
or prepared 1099 evidence; contractor classification still requires CPA review.

Legal-review follow-up: `test_partner_legal_acceptance_browser.py` directly covers
private owner ZIP download followed by anonymous denial, specific unrelated-record
exclusions in all archive/nested DOCX entries, exact missing classification/language
issuance gates, and independent version-B review/publication/program binding/issue/
acknowledgment with unchanged version A. Existing native editor and stale-save cases
cover immutable editing/conflict. A late language-review change is checked by the
real publication endpoint and displayed by the actual owner client. Client unit
checks restrict readable gate names to a known list on 409 responses and preserve
generic server failures. Mobile fixture checks cover 390-dark/320-light display.
The selected records and professional approvals are synthetic; this is not general
content redaction or actual professional clearance.
