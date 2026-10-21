# Inquiry workflow release and recovery

Use the existing private Docker host, selected native PostgreSQL database, Cloudflare Tunnel and Vercel static apps. No provider or billing change is required. Do not use Neon as a second writer.

## Preflight

1. Commit and review the release; run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`, and scan the commit range for secrets.
2. Verify a fresh encrypted backup and a successful isolated restore. Check the independent status dashboard and preserve honest preexisting blockers.
3. Ensure the host has capacity for two additional short-lived API containers. Existing jobs and slicer remain unchanged; this release does not create a second background writer.
4. Confirm the native target selection in the control database and private `api.env`. No private value should be printed or copied into GitHub.

## Rehearsal and rollout

Run `python deploy/platform/release-inquiry.py --release <full-reviewed-commit-sha> --phase rehearse`. The helper archives only committed runtime source, builds a local image, creates a disposable PostgreSQL18 database, applies all migrations, and executes real concurrent customer/operator conversion using the least-privileged runtime role. It verifies one canonical project/work identity, retained private notes, omitted-token denial and replay. Synthetic addresses use `.invalid`; the rehearsal never calls notification delivery. The disposable database is dropped afterward.

After successful rehearsal and backup, `--phase deploy` repeats the rehearsal and applies migration 009 transactionally to the selected native database. Lock acquisition is bounded at five seconds; failure stops the release before API routing changes.

The helper starts an overlapping **guarded API** with new invitation/conversion actions disabled, waits for readiness, and gracefully drains the pre-feature API. Only then does it create the normal API service with `INQUIRY_WORKFLOW_ENABLED=1`. Both overlapping releases enforce bound-draft capability checks. After the enabled service is healthy, it drains/removes the temporary guard. Docker's existing `api` network alias stays served throughout. Cloudflare reconnects to a healthy origin as old connections drain; monitor external health continuously during deployment.

The committed source is retained under the private host's `releases/<sha>` directory; `candidate-source` points to the selected release, and `compose.env` records its image tag. Existing private configuration files and volume identities are reused. The helper never rebuilds the slicer, restarts the database, prints subprocess stderr, contacts Neon, or sends customer messages.

Deploy storefront/operator static apps only after the guarded rollout succeeds. Merge through the existing GitHub main deployment path. The operator shell is v10; reopen older installed clients when they receive HTTP426 for an inquiry detail. No proxy signing-header migration is needed.

## Verification

- Submitted inquiries without a work item must equal zero. Migration 009 repairs at most 1,000 per run; rerun until zero. Draft inquiries stay drafts.
- Today's received inquiry appears as Needs response; existing full requests remain accessible.
- Verify anonymous operator/file access remains denied and the private handoff scope cannot retrieve notes, billing or unrelated files.
- Confirm no customer email/invoice was created by migration, backfill or conversion. Do not issue/share a production invitation or convert a real inquiry merely to test the release.
- Verify external health, independent status collection, a new encrypted checkpoint and isolated restore after schema changes.

## Failure and rollback

Before any new invitation exists, a guarded API can remain active indefinitely while the UI stays on the previous static release. If the enabled API fails readiness, preserve the healthy guarded container and investigate; the helper intentionally does not restart the pre-feature API automatically.

After a draft has been bound, **never restore an API predating inquiry-aware scope checks**. Use this reviewed image with new actions disabled, or a corrected descendant. Existing scoped links still read/complete on a guarded release. Static UI can roll back independently. Additive schema and private source/history stay in place.

If a rollout stops between stages, inspect Docker service health and the private source pointer before rerunning. A leftover `inquiry-rollout.private.json` is an explicit stop marker: do not delete it or the healthy guard blindly. Finish the enabled service/drain sequence or restore the documented guarded service. No automated rollback should bypass the selected native target or capability checks.

This workflow requires existing SSH/Docker authority and private env files. GitHub contains only source, contracts and operational instructions; credentials, archive contents containing customer data, database URLs and invitation tokens remain private.
