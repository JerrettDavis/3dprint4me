# Bookkeeping integration

Optional, off by default. Nothing here is specific to one business: the payer, amounts, accounts and
credentials are all configuration. Keep real values in private environment files, never in the repo.

## What it does

- **Expected-payment gap detection.** A payer who pays on a fixed cadence (default every 14 days, 5 days of grace) is
  compared with the payments recorded in Invoice Ninja. A missing or mismatched payment sends one alert email.
- **Payment mirroring.** Completed Invoice Ninja payments for one client are copied into `expected_payment_receipts`.
- **Supply expense sync.** Priced Spoolman spools become Invoice Ninja expenses numbered `SPOOL-<instance>-<spool>`,
  once each, tracked in `supply_ledger`. Unpriced spools alert once each.
- **Optional Spoolman write-back.** The expense ID can be stored in one spool extra field (`SPOOLMAN_WRITE_KEYS=1`).
  This is the only Spoolman write the integration performs.

## Design

- `lib/bookkeeping/expected-payments.js`: pure schedule and gap detector (`missing`, `amount_mismatch`, `upcoming`).
- `lib/bookkeeping/supply-sync.js`: key `spoolman:<instance>:<spool>`. It looks the expense number up before creating,
  so a timed-out create is adopted rather than duplicated. `baselineSpoolId` suppresses an existing unpriced backlog.
- `lib/bookkeeping/invoice-ninja-expenses.js` and `invoice-ninja-payments.js`: narrow adapters. The invoice adapter
  stays draft-only.
- `neon/migrations/018_supply_ledger.sql`: ledger, receipts and alert-dedupe tables, backend-only (RLS, no PUBLIC grants).
- `lib/bookkeeping/runtime.js` and the `bookkeeping` task in `scripts/platform-jobs.mjs`: runs every 5 minutes and is
  health-tracked like the other jobs.

## Configuration (jobs environment)

| Variable | Purpose |
|---|---|
| `INVOICE_NINJA_TOKEN` | API token. Secret. Only in the private jobs env file. |
| `INVOICE_NINJA_PAYER_CLIENT_ID` | Invoice Ninja client whose payments are mirrored. |
| `EXPECTED_PAYMENT_PAYER` | Name of the payer, used as the ledger key. |
| `EXPECTED_PAYMENT_CENTS` | Expected amount per payment, in cents. |
| `EXPECTED_PAYMENT_ANCHOR` | First expected payment date, `YYYY-MM-DD`. Gap alerts need payer, amount and anchor. |
| `INVOICE_NINJA_EXPENSES_ENABLED` | `1` turns on the supply sync. |
| `INVOICE_NINJA_SUPPLIES_CATEGORY_ID` | Optional expense category for synced supplies. |
| `BOOKKEEPING_UNPRICED_BASELINE_SPOOL_ID` | Highest existing spool ID; older unpriced spools do not alert. |
| `SPOOLMAN_WRITE_KEYS` | `1` enables the expense-ID write-back. |
| `RESEND_API_KEY`, `REQUEST_TO_EMAIL`, `REQUEST_FROM_EMAIL` | Alert delivery. Each alert is sent once per key; a failed send retries. |

## Enabling the supply sync safely

Expenses entered by hand are not spool-keyed. Before enabling the sync for spools that already have a matching
expense, seed the ledger so they are not duplicated:

1. Match spools to existing expenses and review the list (private, never committed).
2. Run `node scripts/bookkeeping-seed.mjs <matches.json> --confidence price+name` as a dry run, then add `--apply`.
   Leave `SPOOLMAN_BASE_URL` empty for the seed if the write-back should stay off.
3. Set `BOOKKEEPING_UNPRICED_BASELINE_SPOOL_ID`, then `INVOICE_NINJA_EXPENSES_ENABLED=1`, and recreate the jobs service.

`scripts/bookkeeping-rehearse.mjs` previews what the sync would create using real Invoice Ninja reads and no writes.
It takes everything from the environment (see its header).

## Release notes for operators

- The partner release helpers pin the migration list. Add new migrations to `release-partner.py`,
  `partner-release-host.py`, `partner-rollout-host.py` and `partner-qa-host.py`.
- The release helper recreates `jobs` from the base Compose file. If Spoolman is on its own private network, include
  `deploy/platform/compose.spoolman.yml` or reattach the network after the rollout.
- Job-health files stay failed after a failed tick until a job claims work. Clear a stale file only after confirming
  the job is healthy.
- On Windows, run the host helpers with a real Python interpreter (not a shim) and send the host program over stdin.

## Not included

An operator screen for logging received payments, and attaching receipt PDFs to expenses.
