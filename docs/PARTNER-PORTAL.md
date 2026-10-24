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
Deployment, legal review export and encrypted backup evidence remain outstanding.

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

The review-package generator, DOCX rendering/import, draft template seeding and
editor UI are still pending. Current automated legal tests insert synthetic package
metadata directly; they do not prove package generation or actual professional approval.
No real counsel/CPA decision or live activation has been recorded.
