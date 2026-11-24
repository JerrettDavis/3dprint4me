# Invoice tracking and Home Assistant: current-state review

Reviewed 2026-11-24. This is an evidence record and release checklist, not a claim of production readiness.

## Requested outcome

Track invoices needing creation, drafts, opened invoices, outstanding balances, overdue invoices and payments in the private operator app. Show consistent information in Home Assistant, deliver invoice-opened/payment alerts, and remind the owner when Oklahoma sales-tax reporting/payment requires action. Verify the owner's expected single paid invoice against Invoice Ninja. Land, deploy and validate the complete flow.

## Verified repository state

- `lib/invoicing/` already implements confirmed billing validation, draft-only provider access, durable operations, explicit refresh and ambiguous-creation reconciliation.
- `operator/assets/invoice-detail.js` shows a billing panel per project. It requires explicit confirmed billing and leaves sending to Invoice Ninja.
- `lib/invoicing/operator-api.js` restricts billing actions to enabled owners and preserves unconfigured intake behavior.
- `lib/work-management/home-assistant-snapshot.js` exports queue counts and work items, but no billing summary or invoice events.
- `integrations/home-assistant/` contains a queue-polling package and dashboard. Existing tests cover queue notifications, canonical links and keeping machine credentials out of browser assets.
- The provider summary currently retains status, totals and balance, but no due date or opened timestamp. It cannot establish overdue/opened behavior by itself.
- The old invoicing runbook/specification says automation is unimplemented despite existing modules. Reconcile documentation with the actual code as part of delivery; do not discard the existing draft-only safeguards.

## Verification performed

`node --test tests/unit/invoice-ninja.test.mjs tests/unit/operator-invoice.test.mjs tests/unit/invoice-form.test.mjs`: 17 passed, zero failed. This verifies the existing focused contracts only; it does not verify production, tax reminders, automatic sync or Home Assistant billing behavior.

## Work still required

1. Inspect the authenticated Edge tabs for Invoice Ninja and Home Assistant, verify the expected paid invoice, existing integration settings and dashboard configuration without copying private billing data or credentials into the repository.
2. Verify current official Invoice Ninja API/event contracts and Oklahoma filing rules. Determine the owner's actual filing frequency and reporting period from authoritative account evidence; do not infer them from invoice dates or sales volume.
3. Design a private billing read model covering existing manually created invoices as well as website-linked invoices, explicit needs-invoicing state, due dates, payment status and freshness. Define brand scope and how unrelated company invoices are excluded.
4. Add authenticated scheduled reconciliation and/or verified event ingestion with durable event deduplication, restart recovery, bounded provider calls and sanitized failures. Distinguish invoice views from email opens using the provider's actual supported evidence.
5. Extend the owner UI and explicitly authorized Home Assistant feed/dashboard with the minimum billing details needed. Add alerts for new view/payment events without replaying historical events on first sync or restart.
6. Add filing reminders with an owner-confirmed schedule and filing acknowledgement. Invoice payment is not evidence that a tax return or tax payment was submitted. Do not automatically file or pay taxes.
7. Test domain/provider/persistence/authorization/sync failure paths and desktop/390px UI. Run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`, review the whole change, then land and deploy using the project's release process.
8. Verify production against the real paid invoice, both rendered dashboards, controlled alert delivery, stale/provider-failure behavior and the tax-reminder schedule. Preserve private uploads, offline customizers and all public intake paths.

## Access recovery

The Windows helper failed, but it was the wrong connection path. The Browser skill's Edge extension connection succeeded on 2026-11-24; existing authenticated tabs were claimed directly. After the owner disabled a blocking extension popup, Invoice Ninja and Home Assistant both responded. Inspection confirmed one paid and one draft fabrication-numbered invoice, the paid client's fabrication-group membership, and the existing queue-only Home Assistant dashboard. No new authentication or replacement browser session was needed. Account credentials, customer details and portal capability links are excluded from this record.
