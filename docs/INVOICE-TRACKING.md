# Private invoice tracking and monthly OKTAP reminders

Billing is an owner-only view in the operator workspace. `GET /api/operator-work?resource=billing` returns invoice status, separate currency totals, freshness, project billing dispositions and tax acknowledgements. POST uses the existing operator authentication, origin checks and revisioned commands. The existing draft creation API remains separate and dispatch stays manual.

The native jobs process polls fabrication invoices each minute, advances tax reminders independently each minute and drains alert delivery every 15 seconds. Provider scope is the configured Invoice Ninja company and fabrication client group. Manual invoices in that group are included. Drafts with a zero provider balance remain drafts. Payment events come from payment allocations, not return URLs or balance changes. Initial import is silent; incomplete reads retain the prior complete snapshot with unavailable/stale health. Email opens and invoice views are distinct provider observations, not proof a customer read the content.

Private migration `020_invoice_tracking.sql` adds state, command audit receipts and a durable event outbox with RLS. Native transactions protect snapshots/events and command revisions. A separate local PGlite adapter supports loopback development using the same SQL migration; it never reconciles against production Invoice Ninja. Its work projection follows the single-process local-store convention. Full database dumps include these tables; apply migration 020 before starting new API/jobs code. Do not restore a snapshot without its event outbox and command receipts or historical events could replay.

## Monthly filing

The owner confirmed monthly filing on November 24, 2026. The [Oklahoma Tax Commission Businesses Help Center](https://oklahoma.gov/tax/helpcenter/businesses.html), inspected that day under “When are the returns due?” and “When a due date falls on a weekend or holiday, when is the report due?”, specifies the 20th of the following month and the next business day for weekends/observed state holidays. November 2026 therefore falls due December 21, 2026.

Before activation, confirm the first reporting period, observed state holidays and account-specific requirements, including zero returns. Enter the evidence reference in Billing settings. An empty holiday list explicitly confirms there are no applicable additional observed holidays; it is not an automatically fetched calendar. Review/extend the calendar before each new year. Existing period deadlines and acknowledgements survive settings changes. Overlapping schedule changes are rejected. Period history is bounded to 120 periods and requires an operational review before extending further.

Filing and tax payment acknowledgements are separate audited owner actions. Customer invoice payment does not acknowledge either. Corrections clear one acknowledgement with an audit reason and resume its reminders. Reminder stages are seven days ahead, one day ahead, due date and weekly overdue. No OKTAP credentials are stored and no return/payment is submitted automatically.

## Home Assistant

Install [billing.yaml](../integrations/home-assistant/billing.yaml) alongside the existing work package, using the existing read-only machine secret. Install [billing-dashboard.yaml](../integrations/home-assistant/billing-dashboard.yaml) as a dedicated private dashboard. The feed adds only normalized invoice facts, counts, currency totals, work links and tax period/action flags. It excludes customer contacts, addresses, line descriptions, private evidence and provider account/client identifiers.

Outbound alerts use a **distinct** server-only credential in native jobs configuration:

```text
HOME_ASSISTANT_BILLING_ORIGIN=https://YOUR_PRIVATE_HOME_ASSISTANT_HOST
HOME_ASSISTANT_BILLING_TOKEN=PRIVATE_OUTBOUND_CREDENTIAL
```

Do not put credentials in browser assets, repository YAML or dashboard content. Delivery posts only to the configured HTTPS origin's fixed `/api/services/persistent_notification/create` endpoint; redirects are rejected. See the official [persistent notification](https://www.home-assistant.io/integrations/persistent_notification/) and [REST API](https://developers.home-assistant.io/docs/api/rest/) contracts. Persistent IDs are stable per event, so retry after a crash replaces the same notification. Calls time out after ten seconds; event leases expire after three minutes. Eight failed attempts exhaust automatic retries, retaining failed entries for operational review. Notifications must also be enabled in owner settings; disabled events are suppressed permanently to avoid historical replay. No mobile push destination is enabled implicitly.

Validate with a clearly labelled synthetic alert and then inspect both dashboards. Never change a real customer invoice to generate a test event. Check the expected fabrication paid/draft counts, freshness, provider failure retention, no baseline alert replay and separate tax acknowledgement behavior before declaring production ready.
