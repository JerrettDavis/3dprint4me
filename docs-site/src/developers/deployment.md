# Deploy and recover

## Separate static and private services

The storefront publishes only `public/`. The private work inbox and partner shell have separate projects/origins; server handlers, private uploads and PostgreSQL are not static assets. The handbook is a separate GitHub Pages artifact generated into `public/handbook` and does not change storefront DNS or API deployment.

Before any operational change read the current [stack automation runbook](../../../docs/STACK-AUTOMATION.md), [self-hosting guide](../../../docs/SELF-HOSTING.md) and [recovery procedure](../../../docs/PLATFORM-RECOVERY.md). Use explicit cluster/database identities and the required preflight. Keep encrypted backups and restore tests separate from live data.

## Deploy application changes

Follow [deployment](../../../docs/DEPLOYMENT.md) for current providers and server-only configuration. For operator identity use [GitHub owner authentication](../../../docs/GITHUB-OPERATOR-AUTH.md). For partner changes use [partner deployment](../../../docs/PARTNER-DEPLOYMENT.md), with least privilege, immutable release artifacts, guarded migrations and rollback evidence.

Do not enable real partner work because QA passed. Real classification/accounting settings and agreement/outreach versions require actual review evidence. The [readiness record](../../../docs/CONTRACTOR-RELEASE-READINESS.md) records outstanding decisions.

## After deployment

Check expected static bytes, private-path denial, anonymous API denial, allowed-origin behavior and the relevant authenticated synthetic journey. Check worker upgrades and offline recovery when changing cached shells. Sanitize provider failures and never print environment values into logs. Preserve existing obligations when pausing work.

## Handbook deployment

The [documentation maintenance guide](documentation.md) explains the dedicated GitHub Pages branch, workflow, previews and rollback. A docs release never deploys private API or database changes.
