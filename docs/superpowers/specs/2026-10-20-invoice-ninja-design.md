# 3dprint4.me invoicing design

Status: approved draft-only workflow on 2026-10-20. The owner explicitly requires
all invoices to remain drafts until manually dispatched. No send action is part
of this integration. Account setup and a real ad hoc draft
already exist; website automation is not implemented.

## Outcome

Use the existing JDH Productions LLC Invoice Ninja account for branded
3dprint4.me invoices, created either directly in Invoice Ninja or from the
authenticated operator app. Invoice Ninja owns invoice delivery, payment links,
payments, credits, and the accounting balance. Customer inquiries remain
recoverable when billing is unconfigured or unavailable.

## Product decisions

Keep all four service paths. A submission remains an inquiry, because browser
estimates are non-binding. The operator enters confirmed billable scope and
prices before creating an invoice. Do not convert an estimate, change of work
status, or customer upload into a charge automatically.

My proposed default: a confirmed billing action creates a draft automatically;
the operator reviews the PDF and sends from Invoice Ninja. The operator app
links directly to that invoice. This delivers website-generated invoices without
introducing automatic customer emails before the workflow has been validated.
Automatic sending is excluded until the owner explicitly changes this policy.
Creation, retries, reconciliation and refresh must never send, mark sent or pay.

Manual jobs can be invoiced directly in Invoice Ninja. They need not be entered
as synthetic website inquiries. Website billing initially requires selecting an
existing Invoice Ninja client, avoiding unsafe automatic customer matching.
Client creation remains available in Invoice Ninja, linked from the operator UI.

## Brand and manual workflow

Use the existing `3dprint4.me` client group. The legal seller remains JDH
Productions LLC; company text displays both names. Finish group-specific logo,
brand colors, Clean design, US Letter page size, numbering prefix `3DP-`, payment
instructions, and appropriate columns: item, description, unit cost, quantity,
tax, and line total. Show invoice number/date/due date, buyer, delivery address,
subtotal, tax, payments and balance. Use the site's existing brand assets.

Reusable product descriptions cover physical fabrication, design, repair/tuning,
consulting, separately stated delivery, and parts. They must not imply a fixed
price or exemption for every job. Confirm prices and tax per invoice. Changing
these defaults must not rewrite historical invoices or unrelated JDH client
settings. A client buying both JDH and fabrication work needs explicit invoice
overrides; group membership alone cannot represent two brands per client.

## Billing model and API

Introduce a server-only `lib/invoicing/` context, an authenticated
`/api/operator-work?resource=invoices` boundary, and an operator job-detail billing panel.
Reuse the existing function because the deployment already uses all twelve
Vercel Hobby functions. Billing transport lives in `lib/invoicing/operator-api.js`.
Reuse the existing operator authorization and exact-origin protections.
Only enabled owners may create or reconcile billing; other operators can see a
minimal linked billing status if already allowed to read the work item.

The submitted command includes work ID and expected revision, selected provider
client ID, invoice/due dates, separately confirmed billing and receipt location,
1–50 approved lines, and an idempotency key. Line data includes customer-facing
description, quantity, integer unit-price cents and verified tax classification.
Use bounded decimal quantities and integer tax rate units supporting at least
three percentage decimal places. Reject invalid dates, negative prices, unsafe
numbers, unknown fields, markup, and overlong data. Credits use Invoice Ninja's
credit flow, not negative invoice lines in this first implementation.

Require a tax decision for every line, including explicit exemption or zero-rate
reason when appropriate. Store jurisdiction, receipt address, verification date,
rate and evidence/reference. No statewide Tulsa default. The owner confirms
the tax decision; the app is not a nationwide tax engine. Verify the remote
client belongs to the configured brand group before creation, and set supported
invoice-level branding overrides where the API contract permits.

Calculate a server preview and compare the provider result before making the
invoice sendable. The adapter must explicitly control automatic-tax settings:
do not accidentally layer manual and automatic tax. During implementation,
verify the hosted API's tax and rounding contracts with official sources and a
non-sent draft. If the provider cannot reproduce the approved total, show an
actionable review state and do not send or claim a matching invoice.

## Persistence and remote uncertainty

Add an additive Neon migration for confirmed billing records with work ID,
revision, immutable approved payload, unique local invoice identity and provider
invoice number, status, totals, provider ID and timestamps. Provide an equivalent
local repository adapter and contract tests. Private financial data is never
included in queue summaries, push messages or Home Assistant snapshots.

Atomically create/claim one billing operation per work item and approved billing
revision. Repeated clicks return the same operation. Record the intent before
network I/O. Include a stable local correlation reference in a provider field
that supports exact lookup; verify lookup and uniqueness behavior against the
official contract before relying on it. A timeout after dispatch enters
`needs_reconciliation`, never blind automatic POST retry. An owner reconciles
by exact reference and confirms an unambiguous existing invoice or investigates
the account. Do not promise exactly-once creation from a local lock alone.

States: prepared, creating, draft, needs_reconciliation, failed, and provider
payment states retained separately. Failed validation is safe to correct before
dispatch; immutable dispatched payloads are not silently edited. Changes after
creation occur in Invoice Ninja, with refreshed totals displayed locally. A new
invoice for the same work requires an explicit separate billing operation and
owner confirmation to avoid accidental double billing.

## Provider and payment behavior

Use official v5 API contracts and required headers. Credentials and configured
group/design IDs live only in server environment variables. Pin HTTPS host
`invoicing.co`; reject arbitrary caller URLs and redirects. Bound timeouts and
response sizes. Errors expose categories and recovery instructions, never raw
provider bodies, credentials or private payloads. Log only opaque operation IDs
and sanitized categories. Unconfigured billing is explicitly unavailable while
intake and ordinary work management remain functional.

An owner-triggered Refresh queries Invoice Ninja for invoice and payment state;
this is the initial reconciliation mechanism. Do not trust browser redirects,
public webhook bodies, or a client-supplied paid flag. No webhook endpoint is
required for the first release. Show last refreshed time and avoid implying
continuous synchronization.

Existing Stripe deposits must be explicitly reconciled in Invoice Ninja before
creating a remaining-balance invoice. The initial form requires the owner to
confirm whether a prior payment exists and record its provider reference; block
creation when an unresolved deposit is declared. Do not create a second payment
link or collect money through both systems for the same amount.

## Privacy

Invoice data is explicitly entered/confirmed billing data. Never serialize the
whole request into Invoice Ninja. Exclude uploads, model/download URLs, internal
costs, private notes and generator parameters, particularly sensitive fields.
Update privacy and operational documentation to describe the billing processor
and customer contact/payment handling. No requests from customizer pages.

## Verification and delivery

Use test-first domain/provider/repository coverage for authorization, input
validation, tax precision, provider URL/method/headers, sanitized errors,
timeouts, duplicate clicks, concurrent claims, ambiguous creation, refresh,
deposit blocking, and unconfigured mode. E2E verifies operator preview,
confirmation, draft link and recovery state on desktop and at 390 pixels.
Run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`,
and document deployment/environment setup and rollback.

Production readiness requires a secure server token setup, migration, deployment,
and one non-sent draft created through the deployed operator flow with matching
client, brand, lines and tax. Verify refresh against the actual invoice. Review
the rendered PDF. Confirm all four public intake paths and offline customizer
behavior remain intact. No test invoice is emailed or charged.

## References

- Existing architecture: `docs/ARCHITECTURE.md`, `docs/OPERATOR-INBOX.md`.
- Current setup: `docs/INVOICING.md`.
- [Invoice Ninja developer guide](https://invoiceninja.github.io/docs/developer-guide).
- [Invoice Ninja API reference](https://api-docs.invoicing.co/).
- [Oklahoma sourcing and sales tax](https://oklahoma.gov/tax/businesses/sales-use-tax.html).
