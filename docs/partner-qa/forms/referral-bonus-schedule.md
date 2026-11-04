# Representative Referral and qualified-lead bonus schedule

**REPRESENTATIVE STUB — DRAFT — UNREVIEWED — QA/DISCUSSION ONLY**

[Canonical editable source](../../../contracts/partner/referral-bonus-schedule.md)

Status: draft, nonissuable, no actual attorney/CPA approval. Reviewers: attorney, cpa. Exact scopes are enforced by `minimumScopes` in the legal domain.

Purpose: Work order: {{gig_title}}.

Workflow: campaign.create/publish; gig.accept; referral.attribute; referral.verify_sale; referral.award.

## Fields and fictional filled example

- `gig_title` (string; optional): QA sample distribution simulation.
- `record_reference` (string; optional): QA-RUN-001.
- `terms_reference` (string; optional): Synthetic frozen terms hash from QA runtime.
- `bonus_criteria` (multiline; optional): Synthetic qualified lead with explicit purpose-specific permission.
- `bonus_amount_usd` (money; optional): $5.00 (500 cents).
- `bonus_max_awards` (integer; optional): 2.
- `weekly_authorization_default_usd` (money; required): $200.00 (20000 cents).
- `weekly_authorization_max_usd` (money; required): $400.00 (40000 cents).
- `weekly_payment_day` (string; optional): UNDECIDED — review required.

## Instructions and unresolved decisions

Read every clause in the source. Replace fictional values privately; keep missing decisions explicit. Counsel decides enforceable terms, privacy/outreach and classification as applicable; CPA decides accounting/reporting. No completed W-9, SSN/TIN, bank details, personal background or active access codes belong here. This catalog describes records; it does not add unimplemented workflow enforcement.
