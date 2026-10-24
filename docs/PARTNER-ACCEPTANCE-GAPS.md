# Remaining partner acceptance work

This 2026-10-24 audit, updated after the budget and authentication increments, compares the private
packet's nine feature files with native cases across `test_partner_native_browser.py`,
`test_partner_budget_browser.py`, `test_partner_auth_browser.py` and
`test_partner_gig_browser.py` and their fixtures. It identifies missing evidence, not automatic product defects.
Synthetic owner sessions are bound to real numeric-identity rules but do not exercise
GitHub OAuth. Synthetic review decisions never establish actual professional clearance.
Production flags remain off. This list supplements, rather than replaces, the full
numbered packet requirements and operational release gates.

- **Budget/week:** all five named scenarios now map to eight cases in
  `tests/integration/test_partner_budget_browser.py`. The reviewed-program helper
  creates fresh programs, invitations/enrollment, issues/acknowledgments and actual
  campaign/offer commands. No accepted gigs or reservations are seeded for this
  program. Evidence includes two genuinely blocked simultaneous acceptance transactions,
  cap reduction preserving earned debt, post-sunset review/payment and four Central
  Monday/DST examples. This does not establish production readiness or every other
  numbered financial requirement.
- **Authentication:** all five named scenarios now map directly to
  `test_partner_auth_browser.py`: real initial invitation UI enrollment without GitHub,
  Secure/HttpOnly/Strict host cookie, fresh-browser replay denial, live revocation,
  an existing other-partner payable denied by ID, and the real owner-work handler
  rejecting partner credentials (including a renamed cookie). A synthetic private
  work record has positive owner access before/after denial. Environment-off enrollment
  isolates the sole missing program flag, preserves invited state and proves the same
  code succeeds after reenabling. This does not prove actual OAuth or production TLS.
- **Gig choice:** all four named scenarios map directly to `test_partner_gig_browser.py`:
  a fresh $50 offer accepted, ten unique permitted UI visits, actual owner review and
  unpaid status; decline without reservation/account penalty followed by future acceptance
  under unchanged policy; unsafe-work escalation visible to the owner without GPS and
  with future acceptance; offline save plus lost committed responses for both visit and
  gig submission, identical retries and one resulting visit/submission event. Previous
  cold-reopen and 100-draft replay evidence remains separate useful coverage.
- **Visits/leads:** qualified-lead (not sale) bonus qualification/award followed by a
  different-device duplicate replay; exact consent-version evidence and explicit absence
  of marketing notifications. Consent, correction, suppression/deletion and owner review
  already have native flows.
- **Optional activity:** all three named native scenarios are directly mapped in
  [traceability](PARTNER-PORTAL-TRACEABILITY.md). This does not establish production TLS.
- **Ledger/payments:** a separate gift fixture excluded from statements and contractor
  exports; explicit unconfigured Invoice Ninja/manual fallback and no customer-invoice
  creation. Existing native settlement/replay/reversal/adjustment/CSV flows are useful
  but do not prove these missing scenarios.
- **Contract review:** anonymous private-package download denial; explicit redaction/
  exclusion assertions; issuance denied with exact missing gates; attempted amended
  version B under A's reviews, followed by independent B review/reissue/acknowledgment.
  Preserving A after amendment alone does not prove the whole transition.
- **Referrals:** accept the original bonus, replace current policy, then earn the
  original accepted amount. Current customer intake records permission without owner
  attribution until verification: document this deliberate verification boundary when
  interpreting the packet's quote-attribution scenario. Existing native sale conversion
  and duplicate settlement checks remain valid.
- **Owner control:** actual campaign creation/publication/offer and partner publication
  denial; paused acceptance denial with unchanged reservations; full existing owner-work
  API compatibility. Authentication tests now mount the real owner-work handler with
  a positive private-record control; this does not prove the full existing operations
  journey. Ordinary storefront/operator regression cannot stand in for that journey.

## Next implementation spine

The budget spine is now implemented in `tests/support/partner_budget.py`, including
fresh two-partner enrollment and exact acknowledgment. Authentication now adds positive owner-work controls and explicit environment-off
enrollment. The gig-choice journeys now reuse them as well. Next add accepted-policy
referral and qualified-lead duplicate-award scenarios.
Do not rebuild synthetic approval plumbing or substitute seeded accepted work for
an actual authorization transition. The remaining numbered operations/product work
above and below still needs its own evidence.

## Operations remain separate

The isolated protected static preview and complete encrypted scheduled checkpoints are
verified in [deployment evidence](PARTNER-DEPLOYMENT.md). Remaining gates include native
same-site staging/cookie/CORS/TLS, full host/private-object-provider restore, current
provider DNS/TTL/proxy discovery, reviewed release/CI and additive disabled production
migration/API/domain rollout, unchanged existing-service smokes, operational jobs/
retention/outboxes/statements/forecasts/OpenAPI/monitoring requirements and actual
provider/accounting validation. Existing status reports estimates/jobs unhealthy and
files/email unknown; do not erase that evidence. Actual attorney/CPA clearance and owner
activation remain independent of deployment. No green aggregate count closes these gaps.
