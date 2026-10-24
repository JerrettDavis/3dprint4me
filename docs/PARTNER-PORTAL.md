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

No partner routes are exposed yet. The next increment must connect these private
services through exact-origin HTTP boundaries and persisted legal approval checks.

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
