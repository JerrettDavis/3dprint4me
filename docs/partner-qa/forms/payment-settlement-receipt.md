# Representative Payment verification and settlement receipt

**REPRESENTATIVE STUB — DRAFT — UNREVIEWED — QA/DISCUSSION ONLY**

[Canonical editable source](../../../contracts/partner/payment-settlement-receipt.md)

Status: draft, nonissuable, no actual attorney/CPA approval. Reviewers: attorney, cpa. Exact scopes are enforced by `minimumScopes` in the legal domain.

Purpose: Participant {{partner_full_name}}; payable reference {{record_reference}}; amount ${{payment_amount_usd}}; event date {{record_date}}; method {{payment_method}}.

Workflow: payment.record; payment.reverse; payable.adjust; statements.

## Fields and fictional filled example

- `partner_full_name` (private-person-name; optional): Synthetic Participant A.
- `record_reference` (string; optional): QA-RUN-001.
- `payment_amount_usd` (money; optional): $25.00 (2500 cents), SIMULATED.
- `record_date` (date; optional): 2026-11-03.
- `payment_method` (string; optional): QA simulated external payment.
- `verification_reference` (string; optional): QA-SIMULATED-SETTLEMENT-001.
- `review_detail` (multiline; optional): QA-only evidence reference; no banking or real contact data.

## Instructions and unresolved decisions

Read every clause in the source. Replace fictional values privately; keep missing decisions explicit. Counsel decides enforceable terms, privacy/outreach and classification as applicable; CPA decides accounting/reporting. No completed W-9, SSN/TIN, bank details, personal background or active access codes belong here. This catalog describes records; it does not add unimplemented workflow enforcement.
