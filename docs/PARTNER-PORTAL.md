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
changes. The complete baseline suite is being investigated after one unit/contract
failure; no complete regression pass is claimed. Browser, database, deployment,
legal review export and backup evidence remain outstanding.

## Operational state

No portal migration has been applied. No DNS, provider account, production environment,
real invitation, legal activation or payment action has been performed by this change.
