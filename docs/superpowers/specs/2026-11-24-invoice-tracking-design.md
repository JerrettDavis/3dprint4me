# Invoice tracking, Home Assistant and OKTAP reminders

Status: proceeding under the owner's Continue instruction on 2026-11-24. Authenticated Edge access is working; implementation and release verification remain in progress.

## Outcome and scope

The owner sees the same current billing state in the authenticated operator app and Home Assistant: needs invoicing, draft, sent, viewed, partially paid, paid, overdue, cancelled and synchronization unavailable/stale. Include invoices created directly in Invoice Ninja, including the expected existing paid invoice. Keep invoice delivery and payments in Invoice Ninja and preserve explicit confirmed billing before draft creation.

Home Assistant delivers new invoice-viewed and payment alerts and actionable Oklahoma sales-tax filing reminders. No automated invoice sending, payment collection, tax return submission or tax payment is included.

## Approach

Use a private server-side invoice read model, populated by bounded authenticated Invoice Ninja API reconciliation. Both dashboards consume this model. A durable change ledger and delivery checkpoint support recoverable notifications. Do not depend on an open browser, duplicate provider credentials in Home Assistant or infer payment from return URLs.

Direct Home Assistant polling of Invoice Ninja would duplicate provider credentials and business rules and cannot represent website jobs needing invoicing. Webhook-only synchronization would miss historical/manual invoices and needs independently verified event authentication. Scheduled reconciliation is the baseline; verified webhooks may accelerate it only after their hosted contract and authentication are established.

## Provider and identity

Keep the existing pinned hosted adapter, bounded calls, sanitized failures and draft-only write methods. Add paginated read-only collection access and explicit due date/view timestamp projection after checking the official API contract. Read all pages before treating a sync as complete; partial pagination must not imply missing invoices were removed. Preserve prior good data on failure and expose its timestamp and unavailable status.

Match scope using the configured fabrication client group and explicit owner-approved invoice inclusion overrides for mixed-brand clients. Do not import unrelated company billing silently or match customers by name. Provider invoice ID is unique within the configured account; local work links remain optional. Never create synthetic jobs just to display manually created invoices.

Invoice Ninja remains authoritative for payment status, amounts, currency and balance. Derive overdue only for collectible sent/partially paid invoices with positive balance and a valid applicable due date, using an explicit business timezone. Drafts and cancelled/deleted/reversed records are never overdue. Preserve provider status separately from derived presentation flags.

The official invoice invitation transformer exposes separate `viewed_date` and `opened_date` fields. Confirm their hosted semantics and availability with the API; project bounded invitation timestamps without copying recipient identities or invitation links. Use separate invoice-viewed and email-opened markers where supported, labelled as provider-reported activity rather than proof a specific person read it. Do not rely on the model-only `last_viewed` field: it was not found in the inspected invoice transformer. Payment alerts use verified payment changes; partial payments and refunds/reversals need distinct events. A provider total correction alone must not masquerade as a payment.

## Persistence and synchronization

Add an additive private migration with provider snapshots, sync health/cursor, durable change events, notification delivery state and tax filing periods. Use the existing repository patterns and owner authorization. Atomically claim sync runs; deduplicate provider IDs/events; persist progress without deleting unseen records after incomplete runs. Bound page count, response size and execution time; continue through durable checkpoints when required by the deployment runtime.

The first successful historical import establishes a baseline without sending old viewed/paid alerts. Subsequent changes generate durable events. A restart or temporary provider outage preserves the baseline and pending deliveries. Acknowledge each delivered notification by stable event ID; do not represent only the latest event, which could discard multiple payments between polls. Explain the delivery guarantee and provider limitations honestly.

Payment reconciliation reads the official payments collection and its invoice allocations, keyed by stable provider payment IDs and invoice allocation identity. Verify the hosted pagination, updated filtering, refunds/reversals and allocation fields before implementing the adapter. Retain transaction-level state; use overlapping incremental windows plus periodic full reconciliation to recover late changes. An invoice snapshot alone can update dashboard status but cannot emit a transaction-specific payment alert. Missing transaction evidence creates an actionable reconciliation warning instead of fabricated payment events.

Needs-invoicing is an explicit owner-controlled billing disposition on a confirmed project, not an inference that every inquiry or completed job is billable. Existing invoice links suppress conflicting needs-invoicing indicators. Exempt/no-charge work has an explicit disposition.

## Operator view

Add an owner-only Billing view with status counts, invoice number, balance, due date, viewed marker, optional work link and last successful synchronization. Filters include needs invoicing, outstanding/overdue, draft, paid and review required. Keep currency totals separate. Expose stale/error state clearly, retain last known values and provide manual reconciliation. Preserve existing per-work draft preview/create/recovery controls.

Desktop and 390px views use the existing light/dark/system themes, keyboard focus and reduced-motion behavior. Invoice provider links use fixed validated origins and paths. Read-only finance access for other operator roles requires a separate explicit product decision; default is owner-only.

## Home Assistant

Extend the dedicated machine integration with an explicitly allowlisted private billing projection. Include aggregate counts and minimum invoice details needed for the requested dashboard; exclude customer identity/contact/address, tax evidence, line descriptions, uploads and secrets. Keep financial information out of the existing general work queue and public assets. Version the billing payload and document its privacy scope.

Use built-in dashboard cards for status counts, balances by currency, overdue invoices, needs-invoicing work, last sync and next tax filing action. Use durable event delivery for viewed/payment alerts, with stable notification IDs and canonical owner-app links. Verify the real notification target in the authenticated Home Assistant account before configuring phone delivery. Test first with a clearly labelled synthetic integration alert, without changing the real paid invoice or billing a customer.

Delivery uses a server-only adapter posting to Home Assistant's authenticated service API; the existing machine snapshot credential stays read-only. Keep a distinct outbound credential in private deployment secrets and pin the configured HTTPS Home Assistant origin. Workers lease durable outbox entries, call the configured persistent-notification service, and record acknowledgement only on successful service completion. Retry timeouts and transient failures with bounded exponential backoff; retain exhausted entries for owner replay. Stable notification IDs make a repeated persistent-notification call replace the same alert. Phone delivery, when configured, is a separate outbox destination and may deliver duplicates after an ambiguous timeout; disclose that at-least-once behavior. Recovery tests cover crash-before-call and crash-after-success-before-acknowledgement. No browser-visible credential or arbitrary caller-supplied service name is allowed.

## OKTAP

Represent reporting periods with owner-confirmed filing frequency, period boundaries, official due date, timezone and reminder lead times. Obtain frequency from the owner's account or confirmation; no inferred monthly default. Check current Oklahoma Tax Commission rules, including non-business-day adjustments and zero-return requirements, before calculating dates.

Show upcoming, due and overdue filing actions independently of customer invoice balances. Persist submitted/paid acknowledgements with an audit trail; one does not automatically prove the other. Reminder data is operational assistance, not an automatically prepared tax return. Do not store OKTAP login credentials or automate filing/payment.

An owner-only Billing settings screen/API manages validated timezone, fabrication invoice inclusion overrides, notification delivery enablement and the confirmed filing schedule with evidence/reference and effective date. The project detail screen manages revision-checked needs-invoicing/no-charge disposition. A Tax periods screen shows period boundaries and due dates and accepts separate submitted and paid acknowledgements with date/reference, plus audited correction actions. Tax reminders remain explicitly unconfigured until the schedule is confirmed. Client-supplied due dates, scope overrides and acknowledgements are revalidated server-side; changes are audited and do not silently rewrite closed periods or historical invoice identity. Deployment secrets are configured outside these browser forms.

## Release and evidence

Provider contract tests cover list pagination, group scope, due/view fields, status/balance validation, URL/method/headers, redirects, timeouts and sanitized failures. Domain and persistence tests cover overdue boundaries, baseline import, concurrent sync, multi-event delivery, restart/outage recovery, partial payments, reversal handling, explicit needs-invoicing and tax-period acknowledgements. Verify owner/machine isolation and that credentials never enter browser assets.

Run the required complete test suite and screenshots; inspect the preview board and rendered Billing/Home Assistant states. Review the complete change before landing. Deploy additive schema and API/jobs before dependent UI and Home Assistant configuration. Verify live freshness, expected single paid invoice, outstanding/overdue counts, both dashboards, controlled alerts and the confirmed OKTAP schedule. Check green CI, production failure behavior, all four intake paths and same-origin/offline customizers. Keep the goal open until all evidence exists.

## Evidence and unresolved facts

- Existing focused invoice/Home Assistant unit and repository checks: 51 passed on 2026-11-24. These do not establish live readiness.
- Official provider model source inspected: <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Models/Invoice.php> exposes due dates, `last_viewed`, paid totals and status constants. Hosted API serialization and event contracts still require verification against <https://api-docs.invoicing.co/>.
- Official API transformers inspected: <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Transformers/InvoiceTransformer.php> serializes due dates, partial due dates and paid totals and supports included invitations; <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Transformers/InvoiceInvitationTransformer.php> serializes distinct `viewed_date` and `opened_date`. Verify against the hosted account before activation.
- Payment source verified in <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Http/Controllers/PaymentController.php>: read-only `GET /api/v1/payments`, with include support. <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Transformers/PaymentTransformer.php> exposes payment amounts, refunded amounts, dates, currency, deletion and update timestamps; <https://github.com/invoiceninja/invoiceninja/blob/v5-stable/app/Transformers/PaymentableTransformer.php> exposes stable allocation ID, invoice ID, payment ID, amount, refunded amount and update timestamp. These support transaction/allocation reconciliation; verify actual hosted includes and pagination before activation. Exclude transaction references and unrelated payment details from Home Assistant.
- Oklahoma primary reference: <https://oklahoma.gov/tax/businesses/sales-use-tax.html>. The retrieved landing page did not establish this account's filing schedule.
- Authenticated Edge inspection confirmed a paid fabrication invoice, zero balance and the client's membership in the configured fabrication group. The fabrication-number filter showed one paid and one draft invoice. The live Home Assistant 3D Print Work dashboard currently shows queue counts and links only. Customer-specific details remain outside repository documentation.
- The Home Assistant notification target, tax filing frequency, credentials and complete account scope still require verification before activation.
