# Partner portal implementation status

The partner portal is under implementation on `feat/partner-portal`, based on
`e981a7f89fea596f7fb11102e273710fbb2a3203`. It is not deployed or activated.
The implementation plan is [here](superpowers/plans/2026-10-23-partner-portal.md).
The owner-provided source packet and its contextual documents remain outside Git.

## Initial domain decisions

- Keep the existing native PostgreSQL/API platform and numeric GitHub owner binding.
  Partner sessions form a separate authentication realm, without GitHub/SMS/email requirements.
- All professional approval and launch gates default off. Evidence must be resolved
  from private persisted review records; caller-supplied approval flags are insufficient.
- Weekly new authorizations use Monday Central calendar dates, default 20000 cents
  and maximum 40000 cents. Reserve full fees and promised deterministic bonus maxima.
  Cap reductions preserve previously committed amounts; the cap never defines pay owed.
- New engagement ends after December 31, 2026 in America/Chicago. Existing obligations,
  payment access and disputes must remain available beyond the pilot and kill switches.
- Accepted offer snapshots retain original fees and terms. Revision checks and scoped
  partner identity precede transitions. Payment settlement and cancellation reconciliation
  require dedicated append-only ledger operations rather than arbitrary gig status edits.
- Gifts are excluded from gig offer fields and the service compensation ledger.
- Personally identifying contacts require affirmative, specific follow-up consent;
  withdrawal removes follow-up eligibility.
- A future separate partner hosting project will emit only its `public/` directory.
  Root storefront output stays `public/`; source, legal files and dependencies are never
  served as the static project root.

## Evidence so far

Packet integrity hashes and its structural validator passed (seven draft templates,
nine feature files). Ten new policy/domain tests were observed failing before their
implementations, then passed. Static and architecture validation passed after these
changes. The baseline rerun passed 1,112 unit/contract tests; browser regression passed
224 tests with one Linux-only fresh-host test skipped on Windows; the UX audit passed 241 checks. The first
baseline attempt overlapped test-first module creation and did not complete.
Deployment and encrypted backup evidence remain outstanding.

## Operational state

No portal migration has been applied. No DNS, provider account, production environment,
real invitation, legal activation or payment action has been performed by this change.

## Persistence and identity increment

Migration `012_partner_outreach.sql` adds private partner, program, outreach,
authentication, budget, payment, legal review and audit tables. The migration
runner allows 012; empty-host setup already discovers tracked migrations. Existing
production databases need explicit migration via the normal release procedure.
This migration has not been applied to production.

Every new table enables RLS and revokes PUBLIC access. The existing backend role
receives SELECT/INSERT and UPDATE only for mutable records, with no DELETE grants.
Partner identity remains an API concern: browsers receive no database credentials.
Composite foreign keys prevent cross-partner visits, cross-week reservations,
wrong-document active versions, unrelated payment reversals and mismatched legal
acknowledgments. Triggers protect accepted terms and append-only evidence.

`withCommand` records a canonical payload digest and stable response under a
unique actor/operation/key in the same transaction as all effects. Account,
program, gig and week locks serialize acceptance and preserve full reservations.
The trusted application must resolve review evidence before calling the internal
reservation primitive; its authorization flag is never a browser field.

Authentication uses account codes and passphrases, with owner-issued 30-minute
one-use enrollment/recovery codes. It requires no messaging account or third-party
authentication provider. Recovery is owner-mediated after identity confirmation;
it changes the credential version and revokes all old sessions. Account revocation
also revokes unused invitations. Raw codes are displayed once for private handoff,
never retained in command receipts. Only token hashes are persisted.

Password hashing uses Node scrypt with N=131072, r=8, p=1, random salts and bounded
concurrent derivations; see [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Persisted client/account rate buckets bound sign-in attempts. Opaque sessions use
seven-day sliding and thirty-day absolute expiry, with host-only Secure HttpOnly
SameSite=Strict cookies and token-bound CSRF checks. See [OWASP recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
and [secure cookie configuration](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies).

Partner routes are now wired in the native API composition root, but have not
been deployed. Writes require the exact partner/owner origin and token-bound CSRF.
Owner access reuses the existing GitHub session and requires the exact configured
numeric subject, enabled owner role and live identity binding. Owner commands
recheck and lock that session under the transaction. Partner commands recheck the
active account, credential version and live session before even replaying a
completed command receipt. Direct native admission is restricted to the explicit
partner route list; unrelated intake routes still require the signed proxy.

Launch checks resolve exact published contract and operational-policy versions
and the most recent nonexpired classification, language, solicitation-policy and
accounting review records. Draft changes invalidate readiness. Environment flags
and owner activation are independent additional requirements, never substitute
review evidence. Existing obligations remain reviewable when new work is paused.

### Reproducible database checks

Run `node --test tests/contract/partner-*.test.mjs` for migration, transaction,
identity and privacy contracts, then `npm run test:partner:postgres` for native
PostgreSQL 18 role grants, concurrency, duplicate commands and dump/restore.
The native test uses a digest-pinned image in a uniquely named disposable Docker
container, binds only a random loopback port and removes its own labeled container.
It never uses a configured DATABASE_URL or accesses the production stack.
The synthetic restore is not the encrypted production recovery drill required
before release. Full dumps cover the new tables automatically; release verification
must confirm restored partner relationships and ledger/legal evidence as well.

## Workflows currently implemented

Owner commands create programs and partner records, configure default and weekly
authorization limits, publish/pause campaigns, issue immutable offers and respond
to counteroffers. Partners can counteroffer, accept, decline, submit, request safe
termination and dispute. Owners can request changes with a retained private reason,
approve and create payables. Original terms and accepted fee remain immutable.
Program budget changes and gig reasons live in private append-only work events;
minimal audit exports contain identifiers/status changes rather than free text.

Visits record permitted business interactions independently of personal contacts.
Materials require placement permission; no-soliciting outcomes prohibit distribution.
Personal contacts require affirmative purpose-specific permission and a selected
contact method. Duplicate visit/client IDs and active email/phone identities are
blocked. Owner review distinguishes qualified leads from unreviewed submissions.
Withdrawal immediately suppresses follow-up. Correction of an email/phone requires
renewed permission and renewed owner review. Deletion clears eligible contact fields
while retaining the minimum consent/event evidence for retention review.

Optional activity belongs to the partner. Start/pause/resume/stop/delete operations
have independent revisions and never affect gig acceptance or payable creation.
No GPS, attendance schedule, mandatory clock or owner activity surveillance is added.

HTTP entrypoints: `/api/partner/v1/session`, `/login`, `/invite/redeem`, `/logout`,
`/commands` and scoped resource reads under `/api/partner/v1/`; owner reads/commands
use `/api/operator-partners`. No additional storefront Vercel function is introduced.
A command body contains only `action`, `input` and a UUID `key`; entity commands
require the relevant expected revision. Owner invitation/recovery responses show a
new raw code once and invalidate prior unused codes, rather than persisting codes
in idempotency receipts. The final OpenAPI schema and browser SDK remain pending.

Financial settlement/reconciliation/exports, referrals and bonus qualification,
legal editor and document packages, partner PWA/owner UI, full BDD browser coverage,
retention jobs and the actual disabled release remain in the implementation plan.
Existing integration tests do not prove those unfinished capabilities.

## Accounting compatibility research

Official Invoice Ninja documentation confirms separate vendor/expense records and
an expense CSV pre-import/mapping flow. The portal will retain an internal ledger
and manual CSV reconciliation as the default; no customer invoice will represent a
partner payout. Current account plan, selected company, category/payee mapping and
actual imports still need validation before enabling an adapter. No provider account
or financial record has been changed by this research.

- [Expense workflow](https://invoiceninja.github.io/en/expenses/)
- [Expense CSV pre-import and field mapping](https://invoiceninja.github.io/docs/api-reference/preimport)
- [Expense API](https://invoiceninja.github.io/docs/api-reference/store-expense)
- [CSV formula injection considerations](https://owasp.github.io/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Injection/21-CSV_Injection)

The native suite also exercises a real numeric-bound owner session under the
restricted backend role and a simultaneous owner-withdraw/partner-accept race.
Commands use account then program then gig/week lock ordering; exactly one race
participant commits. Contact-correction regression coverage checks that renewed
permission retains its consent-language version and exact text immutably.

## Manual ledger and exports increment

The portal now records owner-confirmed settlements, partial payments and returned
transfers. Evidence references are unique per payable, including case variations;
an uncertain-response retry with the same command key returns the same result.
Bank actions happen outside the portal. A return adds an immutable negative event;
it never edits the original payment. Read models distinguish original obligations,
adjustments, paid amounts, outstanding amounts and overpayment exceptions.

External cancellation/dispute resolutions require an owner-recorded reference,
reason, partner acknowledgment and verification attestation. The portal preserves
the accepted fee and original payable, adding a separate signed adjustment. This
records an externally verified resolution; it does not create or sign a release.
A downward adjustment cannot erase a settled amount, and a legitimate additional
obligation can exceed the initial internal authorization ceiling. Program pause,
sunset and lowered budgets do not disable settlement of existing obligations.

The owner can create incremental accounting CSV batches on an explicitly selected
cash or accrual basis, with optional Central-calendar date bounds. Cash exports
contain settlement and reversal events; accrual exports contain original obligations
and compensating adjustments. Ask the accountant which basis to use rather than
importing both as expenses. Stable source IDs and transactionally claimed export
entries prevent repeated incremental export. Existing batches download their frozen
rows and hash. CSV fields quote embedded separators and neutralize formula prefixes,
including Unicode compatibility forms. Exports contain internal partner identifiers,
not contact lists, tax IDs or personal gifts. Categories/tax classification remain
`pending_cpa_classification` / `review_required`; no deductibility or reporting conclusion is automated.

Invoice Ninja remains export/manual-reconciliation only for partner accounting.
No expense/vendor API record, customer invoice, payout or account setting is created.
Provider-specific mapping and account import validation remain outstanding before
an expense adapter can be enabled; the existing customer-invoice adapter is unchanged.

Partners can update their preferred display name, optional contact/accessibility
preferences and notification opt-out. Own JSON exports include only their profile,
gigs, consented visits/leads, optional activity, issued agreements/acknowledgments,
materials, work/negotiation records and earnings. Authentication secrets and owner-only
review/audit records are excluded. Partner statements expose actual due/paid/outstanding
amounts. Retained export snapshots remain private and authenticated.

Owner material issuance/return records are append-only, rejects over-return, and
never reduce compensation or impose purchase/attendance conditions. The profile
read model exposes only a safe new-work availability boolean and program end date;
confidential legal review evidence remains owner-only.

Native PostgreSQL tests now race payments against the same obligation, competing
adjustments and incremental exports under the restricted backend role. They verify
that immutable evidence tables require no UPDATE grant: serialization uses mutable
account/program locks. The synthetic restore retains payment/reversal totals,
adjustments and export claims. Encrypted production recovery remains a separate gate.

## Legal revision and issuance backend

The owner can save immutable Markdown revisions with typed variables, compare any
two revisions and review stable clause anchors. Source normalization, variable
schema, title, required scopes and issuance metadata are included in the content
hash. Editing creates a new draft and never overwrites prior reviewed or issued
text. Restoring older text creates another revision; its old review decisions do
not carry forward automatically even when its content hash matches an earlier one.

Review records require a specific, unexpired private package grant for the named
reviewer, role, version and scope, plus the exact content hash and external evidence
reference. Scope decisions and individual expiry are retained independently.
Conditional decisions do not satisfy approval gates. Initial discussion drafts
cannot be marked for issuance without removing their draft status and obtaining
new review for the exact final source. Publishing checks required reviews and
unresolved clause comments; concerns added after publication pause further issuance
until resolution and explicit republication. This records professional evidence;
it does not independently verify professional identity or make a legal determination.

Issued copies freeze rendered text, typed bindings and a snapshot hash for one
partner. The partner acknowledges reading that exact copy; this is not an electronic
signature. Gig acceptance requires the current reviewed agreement read acknowledgment
and stores its issue ID with the immutable accepted terms. A new draft invalidates
new-work readiness while prior issued text, acknowledgment and earned obligations
remain recoverable. Native PostgreSQL tests exercise this flow with synthetic review
grants and recompute document/snapshot hashes after an isolated restore.

The owner-only `legal.seed_templates` command imports seven anonymized bundled
sources from `contracts/partner/` as immutable, non-issuable drafts. It skips existing
document keys, including owner revisions. Company and person identity defaults are
absent; monetary defaults use integer cents. Private contextual material stays outside
Git. The API image includes these sources; storefront output does not.

`legal.export_package` freezes up to twenty selected versions with Markdown, editable
DOCX, typed variable schemas, source and file hashes, author/revision provenance,
prior-round clause/line comparison, factual brief and a formula-safe review worksheet.
Export requires explicit redaction/share confirmation and named attorney/CPA grants
with compatible scopes and expiry within thirty days. It works while work activation
is off. Package creation grants no approval and does not send anything to reviewers.
The source is canonical; editing a DOCX cannot change a stored legal version.

Set `PARTNER_REVIEW_SIGNING_PRIVATE_KEY` privately on the native API to a persistent
Ed25519 PKCS8 PEM key. Missing or invalid configuration fails closed. The ZIP includes
an Ed25519 signature over canonical manifest JSON, its public key and a SHA-256 key
fingerprint. Convey/verify that fingerprint through an independently trusted channel;
the embedded key alone cannot establish identity. Preserve old keys/fingerprints with
recovery records. This artifact signature is not a person's electronic signature.
Only authenticated owners can download via `review-package`; downloads verify archive
hash/signature, enforce expiry and append a minimal audit event. Bytes and manifest
are immutable database evidence, excluded from command receipts and public output.
Offline copies require an approved encrypted sharing channel; expiry cannot recall
copies. In-browser encrypted packaging and reviewer access UI remain pending.

The formatter handles text paragraphs, headings, bold/italic/code text, bullets and
simple tables with repeated headers and padded cells. Tables support two to six
columns, up to 200 rows and 4000 characters per cell; invalid dimensions return 400. Clause IDs and unresolved placeholders remain visible. No remote images,
hyperlinks, templates or macros are introduced. All seven synthetic drafts were rendered
in offline LibreOffice and all nine pages inspected. Reproduce source samples with
`node scripts/partner-review-docx-qa.mjs <private-output-outside-repository>`; run the
bundled documents `render_docx.py` on every file and inspect every rendered page.
The editor UI remains pending. A three-page synthetic table worksheet was also
rendered and inspected; the seven prior template DOCX files remain byte-identical. Earlier review-lifecycle tests use synthetic grants; package tests now
exercise actual generated signed ZIPs and native PostgreSQL/restore. No real counsel/CPA
decision or live activation has been recorded.

## Derived personal export retention

Partner data exports store only identifiers, generation/expiry times and a checksum
in immutable manifests. Downloadable snapshots live in a separate mutable private table
for at most twenty-four hours. Profile changes, contact corrections/withdrawal/deletion,
activity deletion, credential recovery and account revocation clear those snapshots.
Expired downloads return 410 and clear payload bytes; the existing auth-expiry scheduled
job also purges bounded batches. Account locks serialize owner contact changes with
partner export creation. Profile update receipts contain only identity/revision metadata.
This removes obsolete derived copies without rewriting agreement, consent or ledger
evidence. Backup retention and legally required source-record retention are separate
operational policies still requiring the deployment/recovery review.


## Returned review feedback

The owner-only `legal.import_feedback` command accepts a DOCX up to 512 KiB as a new
immutable private attachment. It requires the exact package, program, version and
source hash, an unexpired named attorney/CPA grant, and an explicit owner attestation
that the returning reviewer identity was checked through the agreed channel. Names
inside a Word file are untrusted author claims. Successful retries reuse the original
receipt; receipts contain counts/IDs/hashes rather than attachments or reviewer text.

All ZIP entries are checked under compressed/expanded, entry-count, ratio, CRC and
layout bounds. Local names/metadata must agree with the central directory, entries
cannot overlap, and trailing data is rejected. XML must be valid UTF-8, depth/token
bounded and free of DTD/entity declarations. Macros, embedded files, external
relationships/templates, active fields and unsupported executable content are denied.
PAGE/NUMPAGES fields remain compatible with the generated review footer. Existing
pinned `fast-xml-parser` is now a direct production dependency; no public parser
service or document upload provider is used. Owner JSON bodies allow bounded base64
transport; partner command limits are unchanged.

Standard WordprocessingML comments and tracked insertions/deletions are extracted as
suggestions with paragraph/clause anchors and untrusted author labels. Extraction
always requires manual comparison. It does not infer untracked edits, reliably
interpret moves/formatting changes, verify legal meaning, or apply changes. The
original attachment is retained for comparison and manual clause comments can be
recorded with the existing `legal.add_comment` action. Accepting a suggestion requires
a separate new Markdown revision and exact-version professional review. Import changes
no source, comments, approval decision or publication state automatically.

Owner legal-version reads list historical packages and feedback metadata, so copies
can be recovered after closing the browser. `review-feedback` is an owner-only authenticated, audited read returning the original
bytes and hash-bound evidence. Historical attachments remain recoverable after package
grant expiry; expired grants cannot import new feedback. Attachment and extraction
hashes are checked before download, and database evidence is append-only. Native
PostgreSQL/HTTP tests exercise a DOCX larger than the old 256 KiB JSON limit, oversize
rejection, restricted-role immutability and restore hash verification. A synthetic
LibreOffice open/save fixture preserves a comment and both tracked changes and is
covered by regression tests. This is not a Microsoft Word runtime test.

## Reserved referral bonuses

Accepted offers with bonuses require explicit rules whose award counts and amounts
exactly equal the reserved maximum. Each rule freezes its criteria, Central-time
qualification deadline and, for sales, refund treatment. Acceptance issues an opaque
code and immutable policy hash. A later campaign revision cannot reduce that promise.
No award is inferred from a quote, a checkout return URL or referral attribution.

Owner-only commands record opt-in evidence against an actual customer request,
independently verified full settlement and a separately reviewed award. These manual
attestations remain separate from the optional web instruction implemented below.
The complete owner attribution/settlement browser flow remains unfinished. Settlement references must be unique, qualified external receipt
identifiers; normalized case-insensitive reuse is denied across payment methods.
These commands do not contact payment providers or establish external payment truth.

Consented lead qualifications retain hashed identity evidence, source consent IDs,
qualification time and participant-match results without retaining a second raw
contact copy. Attribution and settlement likewise freeze hashed customer identities.
Sale verification and award recheck both frozen and current request identities against
participant profiles; owner assertions cannot override a detected match. Collusion and
identities never supplied to the system still require owner investigation. Hashes are
pseudonymous evidence, not anonymous data; source-evidence retention remains subject
to the outstanding operational retention review.

Global source claims prevent repeated identity, request and settlement awards. Account,
program and gig locks serialize accepted maxima and event/payable creation. Awards
qualified within the accepted period remain payable after pause, cap reduction or
sunset. Earnings distinguish earned bonuses from the remaining contingent maximum.
Scoped referral reads expose codes, accepted criteria and awards, excluding customer
identities and bank evidence. Excessive export volume fails explicitly rather than
silently truncating records. The optional public instruction and partner display are
implemented below; complete owner attribution/payment browser acceptance remains open.


## Online partner shell (first increment)

The separate `partner/` hosting project serves only `partner/public/`. Its source
contains no customer or legal records; private data arrives from the scoped native
API using the API host's cookie. Hosting applies no-store, noindex, a restrictive
CSP, no-referrer and denied camera/microphone/geolocation. Production API origin is
fixed to the existing API host; the client permits HTTP only for local loopback.

The first online views include invitation/recovery-code enrollment, sign-in,
maintenance-aware overview, gigs and decisions, itemized earnings/statements,
exact-text issued agreements/read acknowledgment, profile/data download, optional
activity and help. Legal source text is encoded and displayed inertly, without HTML
or remote-image interpretation. Themes use a local preference; authentication/CSRF
state remains in memory. No service worker or offline-private cache is enabled yet.

Authentication requests and sign-out are serialized to preserve cookie response
ordering. Sign-out invalidates the client epoch immediately; superseded responses
cannot restore signed-in client state. An in-flight authentication response supplies
only transient CSRF for its queued server sign-out. A failed server sign-out is
reported explicitly, including the need for owner revocation. Stale view responses
cannot render private records or emit downloads after sign-out. Same-page skip links
move focus without replacing unsaved forms.

Run the static development shell with `node scripts/partner-server.mjs`; it binds
loopback on port 4190 (`PARTNER_PORT` overrides). Set `PARTNER_API_ORIGIN` to the
loopback native API origin and configure that API's `PARTNER_WEB_ORIGIN` to match
the shell origin. This server supplies static files/configuration only; it does not
replace the native database/authentication runtime. Fixture browser tests explicitly
mock API responses and do not prove real cookies or PostgreSQL-backed browser flows.

Visit/contact forms, business-only device drafts and partner counterproposals are
implemented below. Partner referral display and customer opt-in intake are implemented below. Safe
service-worker lifecycle and the remaining owner finance/legal workflows are still
under implementation. The owner core operations are described below.
No deployment or complete PWA/browser acceptance is claimed by these views.


The separate device draft-store primitive now has account-specific per-entry storage,
strict business-field allowlisting and stable idempotent replay; contact and consent
values are rejected before writing. Conflicts remain for manual review and blocked
storage never reports a saved record. It is wired to the visit form and manual
draft replay; offline reload/service-worker behavior remains unfinished.

`npm run test:partner:browser` runs the first actual native browser slice in a
fresh pinned PostgreSQL container: two independent browser contexts, real cookie
flags/reload/logout, profile persistence and cross-partner read denial. Cleanup also
survives a deliberately killed native process. This is now a CI command, not a claim
of complete packet BDD, production subdomain validation or deployment.


## Visit recording and device drafts

Accepted and changes-requested gig sheets link to `/visits/new?gig=...`. The visit
form records the business, time, outcome and material permission. Personal follow-up
permission starts off; enabling it reveals the exact server consent language, purpose
and selected contact method. Disabling it clears contact fields and omits contact and
purpose from the submitted payload. Contact submissions require an online request.

The `/visits` history separates business visits from personal follow-up records.
Partners can correct details with renewed permission, withdraw follow-up permission,
or explicitly delete contact details. Changing email, phone, preferred contact method
or project purpose requires renewed permission and resets the contact to owner review.
Withdrawn contacts cannot be renewed through editing. Required consent/financial
source evidence remains private and immutable; deletion removes active contact values.

Device drafts are an explicit opt-in for business fields only. Contact and consent
fields cannot enter the draft store. `/drafts` lists this account's records, never
silently sends them, retains conflicts for review and uses stable source/request IDs.
The device warning states that drafts are unencrypted and accessible to someone using
that browser profile. Explicit sign-out clears all partner device draft keys. Session
expiry hides the form/draft screen and returns to sign-in while retaining pending
business drafts; only the same authenticated account can resume them in the interface.

Live visit dispatch freezes editing and captures the payload/request key together.
An uncertain response retains both for an exact retry. It does not clear the form or
claim submission. Draft replay similarly retains ambiguous source IDs. Native browser
coverage loses the 51st response after the server commits it, reloads, then resends:
101 attempts produce exactly 100 visits and no personal-contact leads.

The shell still has no service worker. Draft recording while the signed-in page
remains open can work offline, and saved business records survive reload/restart in
storage. A completely offline reload cannot authenticate or load private server
records. Full offline shell/reopen/upgrade behavior remains an explicit release gap;
it is not proved by the successful open-page offline/draft replay tests.


### Fee proposals on an unaccepted offer

A partner can send a proposed USD fee and required message from an offered gig.
The form converts up to two decimal places to integer cents and permits the same
$0–$400 range as the command validator. Sending a proposal does not accept work,
reserve money or change the currently offered fee. The owner must send a revised
offer; the partner still chooses whether to accept it. Fee discussion messages
are displayed as inert text, attributed to the partner or owner, and remain
visible after the offer closes. The proposal form is absent after acceptance.

Both gig decision forms are disabled during a request. An unchanged failed request
retains its idempotency key for retry; editing after failure creates a new key.
Responses from a view the partner has left cannot reroute or announce into the
newer view. Native browser evidence verifies proposal persistence after reload,
unchanged offered status/fee, and cross-partner read denial. The complete
owner reoffer/acceptance/budget browser flow is still a release requirement.


### Optional customer referral credit

Every detailed service path has a separate unchecked referral permission choice on
its contact step. A customer can enter an exact, case-sensitive, 16-character opaque
code after opting in. The versioned copy discloses possible partner compensation
and that contact details/files are not shared through partner referral records.
Disabling permission clears/disables the code. No URL parameters, public code lookup
or public customer-identification endpoint are added. Unknown well-shaped codes are
privately retained for owner reconciliation without exposing whether a code exists.

The browser sends only an opted-in `{code, consent: true, consentVersion}` object,
outside service specifications. The server rejects malformed codes, false/string
permission, unknown versions and additional fields. Pending device drafts strip
both code and permission, including legacy/tampered saved drafts. Customers must
make a fresh choice after reload. Completed recovery JSON and email fallback retain
the opted-in instruction; owner receipt emails include it for email-only delivery.
The privacy notice documents this processing. No estimate or service selection
changes because of a code, and the customer can continue with permission off.

An opted-in request is an instruction awaiting verification, not an automatic
attribution, earned bonus or paid sale. Owner attribution must match the stored web
code and use the request payload's server-generated `submittedAt` receipt time
(which may follow draft creation). A web request with no stored referral choice
cannot fall back to owner paper attestation. Genuine manual/paper records without
web provenance still require the existing explicit owner evidence. Do not reinterpret
an unchecked web request as consent; arrange a fresh customer instruction. Known
participant checks, verified full settlement and separate award commands still apply.

The partner `/referrals` page shows only their own codes, frozen policy rules/hash,
originating gig and earned awards. Earned awards are distinguished from actual
payments, and customer identity, project and settlement evidence are absent. Native
HTTP/PostgreSQL proof covers persisted completed request permission with zero
attributions/awards, and browser proof covers the two partners' scoped code views.
The complete owner attribution/settlement/award browser scenario is still pending.


### Owner Partners area: core operations

The existing operator project includes `/partners`, linked from the work inbox only
for owner-role sessions. Its separate static shell/controller reuses operator colors,
fonts and theme choices. Native numeric GitHub owner binding and the existing owner
host cookie are mandatory at `/api/operator-partners`; the link itself grants no
access. Ordinary operators and partners are refused. Use the operator project's
existing `/api/config` with `OPERATOR_API_BASE=https://api.3dprint4.me`; the owner page
accepts that production origin or explicit loopback development origins only. Sign-in
continues through the existing work inbox. Production OAuth and TLS are not proved
by a fixture that installs a synthetic owner session cookie.

Implemented owner views are program clearance/default cap/pause, disabled program
creation, account creation/status, campaigns, offers and gig review, specific week
caps and latest audit events. Campaign/reoffer forms disclose tasks, area, deadlines,
materials and up to ten bonus rules. Every bonus has criteria, amount, bounded count,
qualification date and a paid-sale refund treatment where applicable. The reservation
includes the complete sum of all maxima plus the fee; the server validates again.
Publishing, reoffering, creating offers and activating programs still require the
actual reviewed/published documents and environment launch settings. The clearance
region displays the backend's real missing gates. It is not a professional-approval
badge. Pausing or lowering authorization does not erase accepted obligations.

The owner can approve submitted work, request objective changes, mark approved fees
payable or withdraw an unaccepted offer using existing revisioned commands. A payable
is not a bank transfer confirmation. Safety/cancellation settlements, verified manual
payments and corrections remain separate ledger workflows; they are not arbitrary
status changes on the gig form. Accepted terms cannot be reoffered or overwritten.

CSRF remains in memory. All API traffic includes credentials, no-store and redirect
rejection. Forms capture data/key together and disable all current form controls while
sending. Unchanged uncertain retries retain their key, structural bonus edits create
new keys, and late responses cannot replace a later route. JSON parsing is also guarded
against a logout race. Even an unreadable 401/403 response clears owner state and private
forms/banner. The skip link focuses content without routing or losing unsaved input.
The operator service-worker version increments for the new static assets; API responses
are never added to its cache. The owner path has a restrictive CSP and no-store headers.
`npm --prefix operator run build` explicitly includes the owner page and assets.

Native browser evidence uses an actual bound synthetic GitHub owner session and a
restricted PostgreSQL runtime: saved cap survives reload, an operator is denied, and
existing accepted work can be submitted, owner-approved and made payable while new
work is disabled. This proves that slice, not the full packet owner scenario or live
GitHub login. Legal editorial/review/feedback/encrypted sharing screens are still required.


### Owner private access lifecycle

The Accounts view issues enrollment codes only when actual program clearance allows
it. Recovery is available for active or suspended accounts following the owner identity
check. Every issue invalidates unused codes; it never automatically retries an unknown
response. Reconfirm identity before issuing a replacement. Issuance alone does not restore
a suspended account. Successful redemption resets its passphrase, restores active status
and invalidates earlier credentials/sessions. Revocation blocks recovery.

One-time codes appear masked in a read-only field for deliberate private handoff. They
are absent from URLs, browser storage, ordinary command receipts and downloads. The
owner view clears them on navigation, sign-out, access denial, expiry, page hiding and
page exit; a late hidden-page response is suppressed. This limits browser exposure and
does not promise cryptographic memory erasure. The server enforces expiry independently.
Suspension/revocation require explicit confirmation and preserve accepted obligations.

Native verification now uses the production runtime composition, including enrollment
clearance and transaction-time owner authorization. A real restricted-role disposable
database/browser flow proves live suspension denial, fresh-code recovery with new work
still disabled, and preservation of an existing payable. Initial cleared enrollment,
production OAuth/TLS and the complete packet scenarios remain separate verification.


### Owner leads and referral review

Leads now shows recorded business context, exact permission language and purpose,
review state and revision. Qualification/rejection requires an owner reason and creates
no award. Corrected email/phone/method/purpose requires renewed specific permission and
resets review. Withdrawal and deletion are explicit separate actions; suppressed contact
fields are hidden in the owner UI, and deletion erases contact values on the server.
Business-only visits can be reviewed independently without implying personal permission.
The visit/lead view shows up to the 1,000 most recent records, matching existing API limits.

Referrals separates customer attribution, independently verified full-sale evidence and
awarding an accepted bonus. The web request picker uses the exact server permission
receipt for its matching code; it never substitutes draft creation time. A distinct paper
form needs an actual eligible request and contemporaneous evidence; server checks still
reject missing/mismatched web opt-ins. Quotes and return URLs cannot verify payment.
Each award form discloses the frozen criteria, amount, count, date and refund treatment
and submits only the source appropriate to that rule. Historical qualification is not
renewed contact permission. An earned bonus is payable, not a completed transfer.

Owner referral reads add `attributions`, `sales`, `qualifications` and `requests` after
the partner-safe return boundary. They omit identity hashes and customer contact data.
Request summaries include ID, title, status, matching code and the server receipt time;
only boolean opt-ins with the supported version and valid string receipt are candidates.
The owner response rejects more than 10,000 records in any evidence collection rather
than presenting a silently complete list. Partner responses retain only own policies and
awards. Reads still require current owner authorization inside the transaction.

Native evidence includes actual opted-in public intake, owner attribution without any
award, rejected checkout-return proof, independent manual settlement recording, repeated
award yielding one $5 payable, duplicate settlement denial and private partner display.
Another native flow verifies qualification, renewed correction, withdrawal and deletion
against live permission state. These tests use synthetic data and attestations, not real
bank verification, live professional approval or complete packet BDD. Legal editorial/review/encrypted sharing and deployment work remain open.


### Owner finance and accounting batches

Finance distinguishes recorded obligations, verified paid value net of reversals and
outstanding amounts. Accepted fees and contingent bonus maxima are separate from earned
payables. Funding exceptions do not erase lawful debt. Payment forms require deliberate
confirmation of actual settlement and accept partial amounts; payment recording rejects
URL references. Reversals require confirmed nonsettlement evidence and add compensating
events instead of editing history. Adjustments require an externally verified resolution
and partner acknowledgment and cannot erase already settled value. Safety, cancellation
and disputed work can be reconciled while new work is paused without rewriting accepted
fees. A resolved obligation is not a bank payment. Gifts remain outside compensation.

The owner ledger response adds private `adjustments`; partner earnings responses retain
their prior shape. Payment and adjustment history refuse more than 10,000 entries instead
of silently treating a partial history as complete. Owner accounting `exports` lists
immutable batch metadata; `export?id=...` reopens the original CSV. Both require current
owner authorization, including transaction-time checks. The owner page retains stable
command keys across unknown responses and freezes form controls while sending.

Cash batches contain verified payment/reversal events; accrual batches contain obligations
and acknowledged corrections. Optional date periods use complete Central-time days.
Every basis has separate source claims, so a new batch excludes previously exported
records; retrying the unchanged command reopens its original batch. Classification stays
pending accountant review. Download is deliberate and enabled only after SHA-256 checks;
private Blob URLs are revoked on route change, logout or loss of access. Late hash work
cannot recreate a download in another view. Nothing is saved in browser storage.

CSV is the manual fallback without Invoice Ninja and does not create a customer invoice,
contractor payout or verified provider import. Import into an actual accountant/Invoice
Ninja configuration remains unverified. Native tests use synthetic owner attestations;
real settlement and external resolution still require the owner's independent checking.
Legal editorial/review/encrypted sharing, full offline lifecycle and release work remain
open, along with the remaining complete packet scenarios and operations deliverables.
