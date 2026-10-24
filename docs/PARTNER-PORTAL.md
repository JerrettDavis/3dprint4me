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
224 tests with one optional skip; the UX audit passed 241 checks. The first
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
