# Invoice Ninja invoicing

## Account setup

The hosted JDH Productions LLC account is at <https://app.invoicing.co/>.
The `3dprint4.me` client group was created on 2026-10-20 (group ID
`l9av2OLaG1`). Its company-name override is
`3dprint4.me | JDH Productions LLC` and website is `https://3dprint4.me`.
Group settings apply through the client's group membership; creating an invoice
alone does not assign that membership.

The group's invoice design was set to Clean, Letter paper, with shipping address
enabled. A rendered invoice still needs verification before this is considered
ready for customer use. The group invoice-number pattern is now
`3DP-{$year}-{$counter}`; no counter reset was requested. The dedicated logo,
reusable products and rendered customer-facing output remain to be checked.
Group colors are now primary `#1B6A4C` and secondary `#1C1B19`, matching the
existing site. Group contact email is `hello@3dprint4.me`. Invoice terms ask the
customer to reference the invoice number and contact that address with questions;
the footer identifies both the brand and JDH Productions LLC, website and email.

The existing site logo was selected for upload, but Edge denied file access;
the upload did not complete. Enable file-URL access for the browser extension
before retrying through the supported file chooser.

### PDF verification issue observed on 2026-10-20

The invoice editor and dedicated View PDF page both displayed a blank gray PDF
area in the connected Edge session. The same symptom occurred on an existing
JDH invoice outside the fabrication group. A Download click produced no browser
download event within 20 seconds. This does not establish whether generation,
the embedded viewer, or the connected browser is at fault; the PDF remains
unverified. Do not change historical invoices or claim the new template caused
the failure on this evidence. Check PDF viewing/download in the owner's browser
and investigate the hosted application's rendering path before sending.

## Oklahoma sales tax

The owner confirmed an active Oklahoma sales-tax permit on 2026-10-20.
For physical fabricated goods, determine tax from the customer's receipt location:
pickup uses the seller's location; delivery uses the delivery location. A Tulsa
mailing address alone is insufficient to establish city and county jurisdiction.
Do not apply one Tulsa rate to every customer or classify every service as exempt.
Record the verified jurisdiction, effective date, and rate with the confirmed job.

The City of Tulsa publishes 8.517% for Tulsa city within Tulsa County:
4.5% state, 0.367% county, and 3.65% city. This is a candidate for deliveries
in that jurisdiction, not a statewide default. Separately stated delivery and
standalone services need their own taxability assessment.

Sources checked on 2026-10-20:

- [Oklahoma Tax Commission: sales and use tax, including sourcing](https://oklahoma.gov/tax/businesses/sales-use-tax.html)
- [City of Tulsa: sales tax](https://www.cityoftulsa.org/government/departments/finance/sales-tax-in-tulsa)

## Ad hoc invoices

Assign the customer to the `3dprint4.me` group. Describe the actual goods, quantity,
unit price, and agreed scope. For a bundle, make clear whether the quantity counts
individual pieces or complete bundles. Keep goods, separately charged delivery,
and independently sold services distinguishable. Verify the subtotal, applicable
tax, prior payments, balance, recipient, and PDF before sending.

Do not copy customer models, sensitive generator values, private intake text,
internal cost calculations, or signed download URLs into invoices. Store actual
customer billing records in Invoice Ninja and private operational storage, not
this public repository.

## Website automation: feature branch implemented; activation pending

The draft-only integration is implemented in `lib/invoicing/`, the operator job
sheet, and `/api/operator-work?resource=invoices`. It reuses an existing function
to preserve the Vercel twelve-function limit. Existing browser
estimates are non-binding; submitting an inquiry must not automatically turn its
estimate into a payable invoice.

The owner-approved policy is always draft, with manual dispatch in Invoice Ninja.
An owner explicitly previews and confirms the existing USD client, receipt
location, prices, tax decision and prior payments. The app never copies intake
estimates or private files into billing. Currency settings inherit from client,
then group, then current company. No send, mark-sent or payment API action exists.

### Setup and recovery

Apply `007_invoicing.sql` after 001–006. The billing table enables RLS with no
public policy or PUBLIC grants, immutable confirmed intent, and restrictive
foreign keys. It is accessible through the existing server database owner only.
Configure server-only `INVOICE_NINJA_TOKEN` for the intended company and
`INVOICE_NINJA_GROUP_ID` for the verified fabrication group. Keep
`INVOICE_NINJA_ENABLED=0` until an authorized activation sets it to `1`.
Never place a token in public config, tracked files or customer responses.

When unconfigured, the billing panel offers manual Invoice Ninja invoicing and
ordinary intake remains functional. The local file adapter supports single-process
loopback development; production claims are atomic Postgres operations.

One website billing operation is retained per work item. Repeated clicks reuse
it; confirmed payloads cannot be silently edited. Additional invoices can be
created manually in Invoice Ninja. A `creating` operation may have reached the
provider. A timeout becomes `needs_reconciliation`; neither state retries POST.
Reconcile searches the exact `3DP-year-operationId` invoice number and links one
match. Zero or multiple matches require owner investigation, never blind retry.
If necessary, manually create a verified draft with that exact number and then
reconcile. Client or total mismatches remain `needs_review` until corrected in
Invoice Ninja and refreshed. Refresh reads payment status and records when it
was checked; it does not continuously sync or verify browser return URLs.

The adapter pins HTTPS to `invoicing.co`, refuses redirects, bounds request and
body-read time, limits JSON to 512 KB, and sanitizes errors. Its conditional
`POST /companies/current` settings lookup is read-only in the official controller.
Prior Stripe deposits must be reconciled before confirming a balance invoice.

Implementation requirements:

- A server-only provider adapter; API credentials never enter `public/`, bundles,
  logs, or customer responses. Unconfigured billing must leave intake functional.
- Use the documented hosted API base `https://invoicing.co/api/v1` and required
  `X-API-TOKEN`, `X-Requested-With: XMLHttpRequest`, and JSON content-type headers.
  Confirm endpoint contracts against the official reference during implementation.
- A durable local invoice identity linked to the work item and approved revision.
  Prevent simultaneous duplicate creation. Reconcile ambiguous provider timeouts
  before retrying a create operation; a local idempotency key alone cannot prove
  that a remote invoice was not created.
- Confirmed customer identity and delivery jurisdiction; do not merge customers
  solely because their names match or silently assume a tax rate.
- Bounded provider timeouts and sanitized failures. Persist recoverable billing
  state independently of intake success.
- Reconcile payment status from the provider through authenticated API reads or
  verified provider events. A browser return URL is not proof of payment. Reconcile
  existing Stripe deposits before collecting a remaining balance.
- Provider contract and failure tests, operator authorization coverage, duplicate
  and timeout recovery coverage, and rendered desktop/390-pixel UI verification.

[Official API integration guide](https://invoiceninja.github.io/docs/developer-guide)
and [API reference](https://api-docs.invoicing.co/).

## Remaining release checks

Local verification: the final full project run passed 949 unit/contract tests, 199 E2E
tests and 241 UX audit checks. Review fixes also passed 27 focused billing
unit/contract tests and five billing browser scenarios. A fresh full run against
the latest main branch is recorded in the feature worktree's execution ledger.
The screenshot run produced 66 images; the preview board and mobile billing
form were visually inspected. A fresh reviewer verified the currency inheritance,
preflight and session-expiry fixes. Production Invoice Ninja environment variables
were absent in the read-only Vercel check on 2026-10-20; nothing is activated yet.

Finish and visually inspect the brand template and a real draft; confirm the
customer's actual delivery destination and current tax rate; finish full-suite
verification and deployment; configure the server credential through a secure setup flow;
deploy and verify production creation, recovery, and payment reconciliation.
A real ad hoc invoice was saved as Draft on 2026-10-20; Invoice Ninja applied
8.517% sales tax and the displayed totals agreed with the manual calculation.
The inherited late-interest wording was replaced on that draft only with payment
reference/contact instructions. Group-wide invoice terms now use equivalent
payment-reference/contact wording. Customer
identifiers and invoice details belong in the private account, not this document.
No invoice email or payment collection has been verified in this setup session.
