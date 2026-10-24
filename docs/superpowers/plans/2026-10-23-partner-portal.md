# Partner Portal Implementation Plan

> Execute inline using superpowers:executing-plans. Preserve the complete packet scope through deployment and verification.

**Goal:** Implement and deploy the complete private partner portal, owner administration, legal review workspace and verifiable manual-payment ledger, with production engagement disabled pending professional approvals.

**Architecture:** A partner-outreach bounded context in the existing native Node API and PostgreSQL platform. Separate opaque partner sessions; existing numeric GitHub owner authorization. A dedicated partner static shell and existing operator administration consume scoped APIs. No new database, bank payout automation or public legal drafts.

**Tech stack:** Node 22 ESM, PostgreSQL 18, existing Vercel shells, Python/Playwright, node:test.

**Spec:** Owner-supplied private partner portal packet, archive SHA256 `e44c8837952620f871a2e59c801dac039b49f191149462f44b144e477db091a1`. Private source retained outside Git; do not publish the packet or its personal background.

## Current evidence

- Baseline origin/main: `e981a7f89fea596f7fb11102e273710fbb2a3203`.
- Isolated branch: `feat/partner-portal`; unrelated invoice changes remain in original checkout.
- Packet integrity: every manifest hash verified; packet validator passed seven templates and nine feature files. This proves packet integrity only.
- Latest migration: `011_spoolman_inventory.sql`; partner migration starts at 012 if still available at implementation.
- Native API admits direct operator/auth routes only; partner admission needs explicit scoped route integration.
- Discovery began without a portal. See the implementation checkpoints below; no real professional approval, DNS change or production deployment is asserted.

## Global constraints

Program default OFF, classification approval OFF, accounting approval OFF. New authorizations end December 31, 2026 in America/Chicago. Default weekly cap 20000 cents; owner-adjustable hard maximum 40000 cents. Weeks start Monday Central; obligations survive cap changes and sunset. Gifts never enter compensation ledger. No mandatory timer, GPS, minimum work, email, SMS or GitHub for partners. Server authorizes every operation and revalidates every payload. Static outputs contain no secrets or private records. Existing storefront output remains public/.

## Review focus

- Lost device and recovery revoke every old session without disclosing account existence.
- Acceptance races, midnight/DST and ambiguous retries preserve single obligations and stable original authorization weeks.
- Kill switches prevent new engagement while allowing access to existing obligations and disputes.
- Legal review binds exact document hashes; later edits never inherit approval.
- Offline draft queues never cache sessions, sensitive responses or unconsented contact details.

## Task 1: Domain policies and financial rules

Files: lib/partner-outreach/policy.js, domain.js; tests/unit/partner-policy.test.mjs and partner-domain.test.mjs.
- [x] Write failing tests for Central Monday boundaries/DST, sunset, strict integer cents, 20000/40000 caps and disabled gates.
- [x] Implement pure authorization policy; no provider imports.
- [x] Test voluntary decline/counteroffer, safety termination, cancellation preserving earned obligations, immutable terms, gift rejection and payment corrections.
- [x] Implement explicit state transitions with expected revisions; verify focused tests and commit.

## Task 2: Transactional persistence

Files: neon/migrations/012_partner_outreach.sql; lib/partner-outreach/postgres-repository.js (native-only repository; isolated PostgreSQL for development); deploy/platform migration and recovery inventories; tests/contract/partner-repository.test.mjs.
- [x] Inspect current migration runner and grants before writing schema; load Postgres best practices.
- [x] Define programs, partners, credentials/sessions/invites, campaigns, gigs, week reservations, visits/leads/consents, referrals/bonuses, activities, append-only payments/audit/outbox, documents/reviews/issues and command receipts.
- [x] Prove transactional idempotency with payload hash, revision CAS and weekly locking; reject mismatched retries.
- [ ] Verify native PostgreSQL role isolation, append-only enforcement, 15000+15000 race against 20000, migration and isolated restore; update recovery inventory.

## Task 3: Partner identity and HTTP boundaries

Files: lib/partner-outreach/auth.js, api-partner.js, api-owner.js, runtime.js; lib/platform/api-server.js; native API composition entrypoint; tests/contract/partner-auth.test.mjs.
- [ ] Test owner invitation, short-lived one-use token, enrollment, credential login, owner-mediated recovery, expiry, brute force, logout and revocation.
- [ ] Use reviewed invite plus credential mechanism without requiring personal messaging accounts; document choice and password/session threat model.
- [ ] Hash opaque tokens; host-only Secure HttpOnly cookies, bounded session lifetimes, exact origins, CSRF and no-store.
- [ ] Test two-partner IDOR, role spoofing, operator denial, origin attacks and failure redaction; default-disabled flags block real invitations.

## Task 4: Gigs, outreach and consent

Files: lib/partner-outreach/application.js, visits.js, referrals.js; owner/partner handlers; tests/contract/partner-workflows.test.mjs.
- [ ] Implement campaigns, numbered deliverables, fee/bonus snapshots, supplied materials, offers, publish/withdraw, counterproposal, acceptance receipts and submission/review/dispute.
- [ ] Implement business visits, safety refusal, specific consent, duplicate detection, contact correction/deletion/revocation and materials issuance/return.
- [ ] Implement cryptographic referral attribution with consent, verified qualification and self-referral/collusion guards; reserve deterministic promised maximum bonuses.
- [ ] Implement optional activity sessions independently of payment eligibility; test retry and concurrent mutation behavior.

## Task 5: Ledger and exports

Files: lib/partner-outreach/ledger.js, export.js; tests/contract/partner-ledger.test.mjs.
- [ ] Test obligation/payment separation, verified settlement references, partial payment, compensating events, overpayment rejection and disputes.
- [ ] Implement weekly statements, earnings projection, forecasts, stable CSV export batches and own-data exports.
- [ ] Verify official Invoice Ninja expense capabilities; provide tested manual CSV when unsupported; keep customer invoicing unchanged and provider failures recoverable.

## Task 6: Private legal editorial lifecycle

Files: lib/partner-outreach/review.js, documents.js; private seed/export scripts; tests/contract/partner-review.test.mjs.
- [ ] Import only anonymized unapproved templates as draft revisions; retain private source context outside Git.
- [ ] Test typed variables, canonical hashes, immutable revision chains, safe preview/diff, concurrent saves, clause comments/resolution, review rounds and feedback import.
- [ ] Implement authenticated private Markdown/DOCX review bundles with provenance, change log and nonbinding cover; render/inspect DOCX using documents skill.
- [ ] Bind classification/language/policy/CPA evidence to frozen hashes; publish and issue only after required approvals. Preserve acknowledgments/retirement; no e-signature activation.

## Task 7: Partner PWA and owner console

Files: partner/ application workspace with partner/public/ as its only static output and restricted deployment config; operator/assets/partner-*.js and owner navigation; scripts/capture_screenshots.py; tests/e2e/test_partner_portal.py.
- [ ] Load UI design skills; implement welcome/join/gigs/visit/activity/earnings/agreements/profile/help and owner roster/campaigns/leads/referrals/payments/legal/settings/audit.
- [ ] Preserve existing blue/teal design, light/dark/system, keyboard focus, reduced motion, 320/390 widths and landscape.
- [ ] Cache shell only; explicit device-only unsent drafts with idempotent sync/conflict UI; purge on logout, safe worker upgrade, 100-draft replay test.
- [ ] Map all nine supplied feature files into executable browser scenarios against real API/persistence; test negative security and outage journeys.

## Task 8: Complete verification and operations

Files: docs/PARTNER-PORTAL.md, docs/VERIFICATION.md, partner API schema, release smoke scripts; CI and stack inventory.
- [ ] Run npm ci, npm test, dedicated BDD, native DB privileges/concurrency/migration, independent security checks and backup/restore drill.
- [ ] Run npm run screenshots and inspect preview-board including partner/owner; measure mobile performance and record baseline rather than invented targets.
- [ ] Document operator/partner help, retention/deletion, private review bundles, payment reconciliation, kill switches, incident/rollback and approval evidence.
- [ ] Review full change, fix findings, commit and submit clean reviewed PR with authentic CI evidence.

## Task 9: Staging and disabled production release

- [ ] Inspect authenticated account access and existing DNS records read-only; export rollback evidence without secrets.
- [ ] Deploy isolated preview and staging API; verify real browser cookie/CORS, headers, TLS, mobile/offline and old services.
- [ ] Obtain narrowly scoped authorization required by packet before production DNS/account identity mutations; complete reviewable artifacts first.
- [ ] Back up, migrate and deploy native API using existing immutable-release handover; deploy partner shell with all launch gates OFF.
- [ ] Verify provider-issued domain target, two DNS resolvers, certificate, HTTPS, CSP, noindex, no-store, unauthenticated 401, role isolation and synthetic production smoke.
- [ ] Audit every requirement and delivery gate against current evidence; report deployment URLs, commit/PR, migration, feature flags, restore proof and real external blockers. Never claim activation or bank settlement.

## Implementation rulings and checkpoints

- 2026-10-23: Native-only partner repository instead of a duplicate mutable JSON adapter.
  Financial reservations, opaque sessions and legal evidence require native transaction
  semantics. Development/browser fixtures will use disposable PostgreSQL; PGlite runs
  contract tests. This keeps the production behavior in the local test path.
- 2026-10-23: Explicit command completion timestamp distinguishes a successful JSON null
  response from an unfinished receipt. Canonical JSON payload digests ignore object key
  order, while rejecting conflicting retries. Failure rolls back the receipt and all effects.
- 2026-10-23: Partner enrollment uses account code + passphrase with secure owner-mediated
  one-use recovery. No external account requirement; no raw token stored in receipts.
  Host-only secure cookie and token-bound CSRF support the existing API/partner subdomains.
  HTTP integration and browser cookie proof remain pending.
- Native PostgreSQL 18 concurrency/role/restore test passed with a pinned disposable Docker
  image. It is in CI and npm run test:partner:postgres. This does not substitute for the
  encrypted full-platform recovery drill required before release.
- Existing baseline browser suite: 224 passed, one Linux-only fresh-host test skipped on Windows. UX audit: 241/241.
  Generated artifacts with timestamp-only or nondeterministic changes were not retained
  because this increment makes no visual changes. Partner UI screenshots remain pending.

- HTTP/workflow increment: persisted version-scoped review gates, native runtime
  routing, independent partner/owner cookie/CSRF realms and transaction-time session
  rechecks are implemented. Native PostgreSQL tests use the real owner binding and
  restricted backend grants, including role downgrade denial.
- Campaigns/offers/counteroffers/acceptance/submission/review/payables, budget changes,
  private work reasons, business visits, consent/lead review/correction/withdrawal and
  optional deletable timers are implemented. Referrals, manual settlement, legal
  editorial/export, UI and full BDD/release gates remain unfinished.
- Retained attorney-review DOCX was read privately. It explicitly remains nonbinding
  and contains no signature blocks. Do not import it as approval evidence.
- Invoice Ninja official expense and CSV mapping documentation was inspected. Account
  capability and import execution remain unverified; preserve manual-ledger defaults.

- Ledger/legal backend increment: verified manual settlements, partial payments,
  compensating reversals, externally evidenced reconciliation, immutable adjustments,
  funding exceptions and scoped earnings are implemented. Cash/accrual incremental
  CSV exports claim stable source IDs in the same transaction; no provider writes.
- Partner profile, own data/statement exports and material issuance/return are
  implemented. Authentication secrets and other partners' data are excluded.
- Legal source/schema/issuance hashes, immutable revisions, comparison, comments,
  package-scoped review decisions, publication, frozen issues and exact read
  acknowledgment are implemented. Acceptance is linked to the current acknowledged
  issue. Real professional review and package generation/Word QA remain outstanding.
- Privacy discovery: the packet's review/CPA cover letters contain private personal
  and financial scenario facts. Never copy them wholesale into public Git. Anonymize
  reusable cover templates; supply factual context only in an explicitly approved,
  private reviewer package. Retain original packet sources privately for comparison.

- Private export/package increment: derived own-data snapshots now expire after
  twenty-four hours and are cleared after relevant personal-record changes or
  credential/account recovery. Immutable export manifests and profile receipts
  retain no derived personal snapshot. Native PostgreSQL expiry/restore passed.
- Seven anonymized legal sources now seed as owner-only, non-issuable drafts without
  overwriting existing keys. Signed immutable private Markdown/DOCX packages include
  source/file hashes, typed schemas, provenance, prior-round comparison and a review
  worksheet. Named role/scope grants expire within thirty days; downloads are audited,
  authenticated and hash/signature checked. No automatic transmission or approval.
- All seven DOCX samples rendered offline in isolated LibreOffice; nine page images
  were visually inspected after fixing italic rendering. A production image build
  and read-only/no-network in-memory DOCX smoke passed with dev dependencies omitted.
- Feedback attachment import, simple tables, encrypted offline sharing and editor UI
  remain open. The current nine-feature evidence/gap map is in
  docs/PARTNER-PORTAL-TRACEABILITY.md; browser BDD coverage is explicitly still pending.

- Feedback/table increment: owner-only DOCX attachments now bind the exact named
  reviewer grant, package/program/version/hash and owner identity attestation.
  Originals and hash-bound untrusted suggestions are immutable private evidence;
  import never applies edits, clause comments, approval decisions or publication.
  Layout/CRC/ZIP/XML/active-content bounds reject malformed or unsafe files.
- Actual native HTTP handles a large returned DOCX under 512 KiB, enforces a bounded
  owner JSON envelope and preserves no-store/auth/CSRF; restricted-role/native restore
  verifies original bytes and extraction evidence hashes. An offline LibreOffice saved
  fixture retains one comment and two tracked changes; its page was inspected.
- DOCX simple tables now have bounded dimensions, repeated headers, padded cells and
  weighted column widths; all three worksheet pages were inspected. Maximum legal
  source plus canonical newline exports successfully. Existing seven template files
  remain byte-identical. Owner legal-version reads expose recoverable package and
  feedback metadata with indexed lookup; historical originals stay owner accessible.
- Encrypted offline sharing, complete legal editor UI, referral/bonus logic, partner
  PWA, all browser BDD/release gates and actual disabled production remain unfinished.

- Referral increment: accepted offers now freeze bounded explicit lead/sale bonus rules
  matching the full reserved maximum and issue opaque policy-bound codes. Owner-only
  opt-in attribution, independently verified settlement and award are separate actions.
  Immutable qualification/attribution/settlement identity evidence and global source
  claims prevent detected self-referrals and repeated identity/request/payment awards.
- Regression review reproduced and fixed stale participant checks in the sale path:
  verification and award now check frozen identities plus current request contacts.
  Earned amounts leave contingent forecasts; accepted obligations survive changed
  campaigns, pause/cap reduction and sunset. Native concurrent award/restore passed.
  Public customer opt-in and partner display are now implemented below; the complete
  owner attribution/payment browser scenario remains unfinished.


### Partner shell design direction

Use existing workshop colors: deep blue `#12304a`, teal `#08776f`, pale gray
`#f7faf9`, white `#ffffff`, ink `#102631`, and focus amber `#945700`.
Dark mode uses the operator palette with light teal actions and pale ink. System
fonts (Segoe UI Variable Text/Aptos/system fallback) avoid remote font requests.
A narrow navigation rail accompanies left-aligned work records on desktop; mobile
uses a wrapping navigation strip above a single column. Fees lead each job sheet,
with status, agreed tasks and decisions directly below. No decorative marketing
hero, sample offers, gradients or financial balance counters. Keep actions at least
44 pixels, visible labels/focus, reduced motion, and 320/390-pixel layouts.

The design-skill search returned generic marketing patterns even after narrowing
to an internal operations dashboard. Those patterns/fonts/palette were not adopted;
packet requirements and existing product tokens determine this direction. First
online shell/client fixtures, visits/business drafts and counterproposal UI are
implemented; referrals, offline reload/service worker, owner console and native
nine-feature browser BDD
remain required before release. Presentation fixtures are not cookie/persistence proof.


- Visit/UI increment: accepted gigs link to business visit recording. Contact
  permission defaults off, contact values clear when disabled, and business-only
  device drafts require explicit opt-in/send. Correction/withdrawal/deletion controls
  operate against native APIs. Purpose and preferred-method changes require renewed
  permission and reset review. Stable payload/key capture prevents late input events
  from altering an uncertain retry; expired sessions clear private forms/screens.
- Native browser proof now includes actual 100-draft replay with a lost committed
  response, reload and retry: 101 requests produce 100 visits and no personal leads.
  Session-expired drafts remain private in the UI until same-account reauthentication.
  Offline reload/service-worker lifecycle still remains open; do not claim full PWA.
- Security checkpoint `4f9c284`: Zod 4.6.6/Undici 6.29.1 overrides, Vite 8.3.5,
  regenerated operator auth bundle and Node 22.23.4 pinned image are applied.
  Full regression/native/container checks passed; npm audit reports zero findings.
- Counterproposal UI: offered-only USD/message form, unchanged offered fee,
  persisted inert negotiation history, exact retry key and pending form locks.
  Native browser verifies persistence without acceptance; complete owner
  reoffer/acceptance/budget browser flow remains required.
- Partner referral display/customer intake are implemented below. Continue full offline
  behavior, owner/legal console and all remaining release gates.


### Customer referral intake design

Use a manual optional 16-character opaque code on the shared contact step for all
four service paths. A separate unchecked permission checkbox discloses possible
partner compensation and no contact/file sharing with the partner. Only an opted-in
code enters the request, outside service specifications. No URL or public code lookup
is needed. Pending browser drafts never retain referral permission or code; customers
reconfirm it after reload. The completed recovery copy retains the chosen code and
permission version, including in no-integration mode and its email fallback.

The server rejects malformed, unconsented, extra-field or unknown-version referral
objects. It records the versioned customer instruction in the private request, not an
automatic bonus or paid-sale assertion. Existing owner-verified attribution remains
separate: web instructions must match the chosen code and server receipt time;
legacy/paper opt-in still needs explicit owner evidence. Unknown well-shaped codes
are privately retained for reconciliation without public identity/existence disclosure.
Add partner code/policy/earned-award display without customer identities or fabricated
share URLs. Keep request attribution, verified sale, earned bonus and actual payment
separate. Update privacy, four-path tests, native proof and screenshots.


- Referral intake implementation: unchecked versioned permission and exact code across
  all four paths, no pending draft permission reuse, private normalized payload,
  recovery/download/email fallback, and privacy notice. Web attribution binds code
  and server receipt; absent consent cannot use the paper fallback. Independent review
  found/reproduced that fallback gap and confirmed the regression fix.
- Partner referrals display codes, accepted policy and earned awards without customer
  information or a payment claim. Native request-handler/repository proof persists
  permission without automatic attribution/award; two-account browser views stay scoped.
  Full owner attribution/settlement/award browser coverage remains required.


### Owner console implementation sequence

Add `/partners` to the existing private operator project, linked only for owner
sessions. Keep its static shell separate from the work-inbox controller. Reuse
operator typography/colors and accessible 320/390 layouts. Native GitHub cookie
and owner-bound memory-only CSRF are required; no partner session or synthetic
production owner shortcut. Errors and session expiry remove private forms/records.
API reads remain no-store and are never placed in service-worker caches.

First implement program clearance/pause/cap controls, program/account creation,
campaign terms with bounded conditional bonus rows and complete reservation,
campaign publish/pause, offers, owner gig review/reoffer, week caps and audit.
Use existing revisioned/idempotent commands, freeze forms while sending, preserve
unchanged uncertain retries and suppress stale responses after navigation/logout.
Then add invitations/revocation, lead/referral review, ledger/settlements and full
legal editorial/review/feedback/encrypted sharing in the same owner area. The
initial screens must not claim these later flows or complete BDD/deployment.
Verify owner/operator distinction through the native HTTP authorizer and an actual
bound synthetic GitHub session in disposable PostgreSQL, plus compatibility of the
existing inbox. Capture and inspect the new operator views before completion.
