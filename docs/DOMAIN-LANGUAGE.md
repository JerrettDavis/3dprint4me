# Domain Language

This vocabulary is normative for code, tests, APIs, and operations. Provider terminology belongs in adapters and must not replace business terms.

## Context map

| Context | Owns | Does not own |
|---|---|---|
| Project Request Intake | Detailed service request, rough estimate, draft, private upload authorization, submission, receipt outcomes | Operational workflow after acceptance; payment verification |
| Quick Inquiry | Lightweight inquiry, ownership key, attachment verification, abuse limits, notification retry policy | Detailed estimate; work status |
| Work Management | Work item, operator commands, notes, events, revision, Push outbox | Customer intake validation; payment state |
| Checkout | Deposit eligibility, completion proof, hosted checkout-session request | Payment verification or fulfillment authorization |

## Intake terms

**Project Request** — a customer's detailed proposal for one of four services: print, design, repair, or consult. It is not an accepted quote, order, or promise to perform work.

**Quick Inquiry** — a lightweight, separately owned contact request from the homepage. It is not a partially completed Project Request.

**Draft** — a server record that has passed complete payload validation but may still be receiving private files. A draft is not customer-visible proof of receipt.

**Submission** — the one-way transition that durably accepts an intake record. Repeating submission must be idempotent or explicitly rejected; it must never create duplicate work.

**Completion** — the application operation that attempts submission and its independent delivery effects. An uncertain network response must not be described as a failed submission.

**Delivery** — successful persistence or an explicitly supported owner-notification path. Optional notification failure after persistence does not undo delivery.

**Rough Estimate** — a non-binding browser-generated planning range. The server revalidates its surrounding request, and a human confirms scope and price.

**Private Upload Instruction** — short-lived authorization for one randomized object path belonging to a validated draft. It is not a public file URL.

## Work terms

**Work Item** — the operational aggregate created once for an accepted Project Request. It owns status, priority, acknowledgement, assignment, target date, and revision.

**Operator** — an explicitly approved identity permitted to read or change private operational data. Authentication alone does not grant authorization.

**Command** — a validated request to change one aspect of a Work Item. Commands are revision-bound and idempotent per operator key.

**Revision** — the optimistic-concurrency version of a Work Item. A stale command produces a conflict and never overwrites newer state.

**Event** — an immutable record of an accepted domain change. Events contain bounded operational data and never serve as mutable current state.

**Outbox Entry** — a durable instruction to attempt an external notification after the related state change commits. Provider failure does not reverse the state change.

## Checkout terms

**Checkout Proof** — a short-lived, server-signed assertion that a particular completed request, email, and title may request a deposit session. It is not proof of payment.

**Return State** — browser presentation after leaving Stripe. A success-looking URL never verifies a charge or authorizes fulfillment.

## Invariants

- Customer uploads are private unless a deliberate product change says otherwise.
- A Project Request belongs to exactly one of the four service paths, and unrelated fields are excluded.
- Submission is revalidated server-side and cannot be inferred from browser state.
- Operational acceptance and optional notification delivery are separate outcomes.
- Work transitions follow the documented graph and scheduling requires a target date.
- Private notes and customer details never appear in Push payloads or browser storage.
