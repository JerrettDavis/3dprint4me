# Representative partner forms and live QA

Status: proposed design for owner review. No QA environment or new program has been created.

## Requested outcome

Prepare the necessary contracts and operational forms as accurate representative
stubs, visibly unreviewed until counsel/CPA approval. Allow complete owner/partner
QA journeys to run concurrently with professional review. Deliver descriptions,
Given/When/Then scenarios, reproducible evidence and screenshots inside `docs/`.

## Current foundation

Seven Markdown templates already live in `contracts/partner/`; owner-only seeding
creates immutable unapproved versions without overwriting owner edits. Canonical
discussion drafts cannot be marked issue-ready. The portal already supports
private Markdown/DOCX review packages, feedback, version-bound reviews, frozen
issued copies and read acknowledgment. A read acknowledgment is not a signature.
The maintained native suite covers 59 owner/partner checks against real PostgreSQL
and browser HTTP boundaries. Its populated workflows are disposable fixtures,
not a persistent hosted QA system. Production has no program, accounts or reviews;
all activation flags remain off. The statement RLS correction is already deployed.

## Form packet

Keep the existing seven stable keys and clause IDs: services arrangement, gig
work order, outreach/safety policy, follow-up consent, optional personal-assistance
acknowledgment, attorney cover letter and CPA cover letter.

Add eight supporting forms, each explicitly mapped to an implemented workflow:

1. `partner-onboarding-checklist`: identity/access recovery, device/privacy notice,
   contact preferences, document-version acknowledgment and a secure tax-form
   handoff checklist. Link the official W-9; collect no SSN, TIN, bank credentials
   or completed government form in QA or documentation.
2. `referral-bonus-schedule`: frozen criteria, maximum, duplicate treatment,
   qualification/settlement evidence and original accepted-policy preservation.
3. `materials-custody-record`: supplied/returned quantities and condition; no
   automatic deduction from compensation or requirement to buy inventory.
4. `work-submission-review-record`: objective deliverables, receipt, revision,
   correction reasons and distinct submission/approval/payable transitions.
5. `safety-cancellation-dispute-request`: voluntary safety escalation, cancellation,
   disputed work and recorded resolution without erasing earned obligations.
6. `payment-settlement-receipt`: independent external verification, amounts,
   references, partial payments, reversals and adjustments; never a transfer order.
7. `contact-correction-withdrawal-request`: exact consent purpose/version, renewed
   permission for changed use/channel, withdrawal/deletion and follow-up suppression.
8. `qa-participant-instructions`: test-only participation, synthetic inputs,
   simulated compensation/reviews and bug-report instructions; no real services,
   payment, legally binding execution or waiver.

Every form starts with **REPRESENTATIVE STUB — DRAFT — UNREVIEWED — QA/DISCUSSION
ONLY**, explains its purpose, lists fields and instructions, identifies unresolved
professional decisions and states that it does not authorize real execution,
marketing consent or payment. Original sources stay `issuable:false` and
`legallyApproved:false`. Default seeding is additive and preserves owner revisions.
New fields use the existing typed variable renderer; sample data is clearly
fictional, including `.invalid` email addresses. No invented company legal name,
reviewer identity, classification determination or tax threshold is presented as fact.

Correct current inconsistencies: use the configured gift amount rather than a
hardcoded amount; describe the software's $200 default/$400 hard authorization
maximum and December 31, 2026 sunset accurately; distinguish future policy changes
from capabilities the current software supports. Replace speculative gift/account
entries with CPA decision fields. Terms such as notice/cure periods, cancellation
valuation, payment day and expense treatment receive complete sample structures
and conspicuous decision placeholders rather than invented approved terms.

Provide a catalog under `docs/partner-qa/forms/` with purpose, reviewer scopes,
required fields, sample filled values, related UI/API operations and approval
status for each form. Link the canonical editable sources. Existing authenticated
Markdown/DOCX export remains the private review deliverable; no public legal-package
URL or real personal information enters the docs.

Primary references checked November 3, 2026:

- [IRS Form W-9](https://www.irs.gov/forms-pubs/about-form-w-9).
- [IRS classification guidance](https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee).
- [DOL classification guide](https://www.dol.gov/agencies/whd/flsa/misclassification/small-entity-compliance-guide).

These explain review topics, not approval of the proposed arrangement. State/local
solicitation requirements, entity treatment and classification remain for the actual
professionals; the packet makes no conclusion about them.

## Proposed live QA boundary

Owner decision: **test in the production portal**, using the existing owner and
partner origins. No separate QA hostnames or OAuth application are required.

Builder recommendation: expose explicit QA entry points within those portals,
backed by a dedicated empty QA database and a separately configured QA runtime.
The ordinary portal entry points continue to use the selected production store.
The server chooses the runtime from fixed QA routes, never a database URL, header,
program ID or caller-provided schema. QA gets separate partner credentials,
sessions, CSRF context, invitation keys, browser draft/cache namespaces and jobs.
Requests and service-worker caches must not cross the two route namespaces.

The existing real GitHub owner identity authorizes QA administration. Revalidate
that identity against the production auth store for each QA operation; hold the
normal session/account locks through the QA operation so revocation cannot race
an already authorized operation. Only shared authentication is read there; QA
business commands run exclusively in the QA database. Do not copy owner session
secrets into QA, create a synthetic-owner bypass, or weaken the production guard.
A narrow owner-auth adapter is preferable to changing business-command semantics.
Define lock acquisition consistently (auth first, QA transaction second), handle
both failures with rollback and safe errors, and test suspension/revocation races.
There is no distributed business transaction: production business data is never
written by the QA runtime.

The QA database has its own restricted backend role, normal RLS/migrations,
backups and explicit identity sentinel. It is outside the production selection
pointer. Its business connection cannot access the real database. A separately
restricted production auth connection can read/lock only the required auth rows.
Runtime preflight fails closed if QA resolves to the selected production store,
if database identities overlap, or if provider credentials are present. Never
restore customer data into QA or widen the loopback-only native fixture server.

Provide a persistent “QA only — representative stubs” entry/banner and an explicit
return-to-live link. Owner QA provisioning creates named synthetic scenarios;
partner QA uses the normal invitation/passphrase flow in its separate cookie realm.
Reset is owner-only, scoped to QA and preserves evidence/run history; it cannot
operate on the production selection. QA data never enters live owner lists,
forecasts, exports, referral awards or ledgers. Normal production launch flags
remain off; QA simulation enablement belongs only to the isolated QA runtime.

Keep real attorney/CPA evidence and unreviewed canonical forms untouched. QA may
create explicitly named simulated review decisions in its own database solely to
exercise transitions. For issuance/acknowledgment cases, use a separate synthetic
workflow sample with the same typed fields and representative clause structure,
its own hash and a prominent **QA SAMPLE — NO LEGAL EFFECT — NOT FOR REAL SIGNING
OR WORK** notice. It is not the canonical discussion draft and not professional
approval. Canonical stubs remain nonissuable, including in QA. There is no
production `allowDraft` switch or acceptance of caller-supplied clearance.

Block external email, SMS, webhooks, push, payment, billing and object-provider
writes in the QA runtime rather than relying on imaginary recipients. Local fake
provider adapters can return representative success/failure responses and record
only sanitized simulation receipts. The QA database must never contain a real
paid-sale verification, bank transaction or tax decision. Run only QA statement/
retention jobs against its own database. Every owner/partner page, download and
export displays a persistent QA/simulation label; test report labels say simulated
settlement and simulated professional clearance rather than implying reality.

Publish only the existing frontend output directories. Credentials and invitation/
recovery codes stay in private custody, never source, docs, screenshot pixels,
filenames, URLs or published artifacts. Real program activation remains independently
blocked until actual reviewed versions and all launch gates are satisfied.

## BDD documentation and evidence

Create `docs/partner-qa/README.md` as the QA launch guide and
`docs/partner-qa/features/` as the maintained, readable Gherkin contract. Each
scenario has a stable ID, actor, prerequisites, synthetic inputs, action steps,
expected UI and persisted effects, failure/retry behavior, cleanup requirements,
automation mapping and linked screenshot evidence.

Cover the complete nine existing feature areas plus QA lifecycle:

1. Enrollment/recovery, host cookies, CSRF, sign-out, replay, live revocation and
   cross-partner/owner denial.
2. Weekly budgets, simultaneous acceptances, Central Monday/DST, cap reduction,
   pause and program sunset while preserving debt.
3. Offer review/decline/counterproposal/reoffer/acceptance, exact terms, ten unique
   permitted visits, submission, objective review, correction and payable creation.
4. Business-only visits, precise consent, unconsented data rejection, correction/
   renewed consent, qualification, duplicate evidence, withdrawal and deletion.
5. Optional activity start/pause/resume/stop/delete, no timer requirement and no GPS.
6. Earnings, partial settlement/replay, reversal/adjustment, immutable statements,
   weekly schedules/history, exports, gift separation and provider-unconfigured fallback.
7. Legal seeding/editing/conflicts, signed/encrypted review handoff, returned feedback,
   canonical stub issuance denial, simulated QA decisions, version-specific publication,
   typed issuing, exact acknowledgment and immutable older versions.
8. Referral opt-in and attribution, independently simulated sale settlement,
   preserved original bonus promise and one award under retries/second-device evidence.
9. Owner campaign/accounts/suspension, materials, spend forecasts, audit and existing
   work-inbox compatibility; preserve all earned obligations under pause/revocation.
10. QA-only identity/origin/isolation checks, blocked egress, visible disclaimers,
    scenario reset/reproducibility, and proof that production business records and launch flags are unchanged.

Offline preparation, cold reopen, device drafts, lost committed responses, session
expiry and explicit manual replay must be included in the corresponding journeys.
All existing native scenarios receive an explicit mapping; gaps receive real tests
instead of being relabeled complete. Mocked UI tests are identified separately from
browser/API/PostgreSQL evidence and actual hosted QA observations.

Store screenshot files under `docs/partner-qa/screenshots/` and reference them
relatively from Markdown, alongside step descriptions. Capture real rendered pages
from the documented synthetic scenario at 390-pixel dark and desktop light sizes;
include focus, errors, denial, pending/retry and successful transitions. Mask all
active credentials, invitation/recovery/bootstrap codes and signing/encryption
secrets before capture. A screenshot of another state cannot substantiate a step.

Evidence metadata records scenario/step ID, viewport/theme, source commit, run ID,
environment, observed result and screenshot checksum. Reports distinguish passed,
failed, blocked and not-run. A documentation validator checks scenario/test/step
mappings, missing image references, stale source/run metadata and accidental secret
markers. Generate captures and descriptions reproducibly from maintained scenario
definitions/helpers; do not copy arbitrary old screenshots to imply a fresh run.

## Acceptance

The representative packet is complete, renderable and nonissuable; all typed
references validate; owner edits survive repeat seeding. Hosted QA accepts only
synthetic activity in its own realm, shows unambiguous notices and cannot contact
real providers or production data. The complete BDD guide and its screenshots live
in docs and match the tested runtime. Required unit/contract/native/browser checks,
full `npm test`, `npm run screenshots` for visible changes, preview-board inspection,
document render verification where DOCX changes, and independent review pass.
Only then perform the concrete approved QA deployment and record its exact identities,
HTTPS/session/CORS results and manually reproducible owner/contractor entry points.
Professional review remains a parallel workstream, never replaced by QA evidence.

## Decisions and builder discretion

The owner selected the production portal for live QA. The dedicated QA database,
fixed routes, restricted auth adapter and separate browser state are builder
recommendations to make that selection safe; they are not claims of prior approval.
The builder may choose route names, module layout and evidence helper structure
within these constraints. No additional product decisions are presently needed.
