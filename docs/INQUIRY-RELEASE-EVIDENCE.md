# Inquiry workflow production evidence — 2026-10-21

Feature: [PR #47](https://github.com/JerrettDavis/3dprint4me/pull/47), merged to main as `b5a4d925a534868fe8838916a627ff2a9e2153e7`.

## Verification

- `npm test`: 1,054 unit/contract tests, 211 browser tests and 241 UX audit checks passed.
- Screenshot suite plus four real inquiry/conversion states captured; preview board and mobile inquiry detail inspected. Light/dark, 390px, keyboard navigation, reduced motion and installed shell v9→v10 upgrade covered.
- Independent feature and operational reviews completed. The rehearsal permission, host-Python compatibility and readiness-publication findings were corrected before production deployment.
- Staged changes and the entire feature commit range passed redacted secret scans.
- Real PostgreSQL18 scratch rehearsal passed under the application role: no operator-management privilege, real concurrent customer/operator transactions, one canonical project/work item, retained notes and replay safety. No notification-delivery module was called.
- Isolated API overlap/drain rehearsal: 48 checks, zero failures. Production Compose validation confirmed each replacement starts outside the tunnel network and joins only after readiness.

## Production rollout

The API image/source release is `84a1b7f9e1cb532dff0cc58038c2e39f55488efe` (image tag `84a1b7f9e1cb`). Migration 009 applied only to the selected native database. The API changed through a healthy guarded release before new invitation/conversion actions were enabled; the database, jobs and slicer were not restarted. External storefront API monitoring recorded 40 checks and zero failures during rollout.

Main deployments reached Ready/success:

- Storefront: `dpl_CWCwanB2Z6tFvo6uFENTnKUTQfQs`.
- Operator: `dpl_4yRtBC2pFxvcrrmUQQVhGsRx1MoY`.
- Live smoke: 15 responses checked, zero failures, including intake integrations and denied private-source paths.

The signed-in production inbox was reopened after the installed-shell update. It showed the two existing full requests and the received inquiry labeled **Inquiry · Needs response**. Opening that inquiry exposed private notes, manual link sharing and project conversion controls; no invoice panel appeared. No real customer invitation was issued, no real inquiry was converted merely for verification, and no customer data was put in screenshots or this report.

Database invariants after cutover: two full requests, three work items, one inquiry work item, zero submitted inquiries missing work, zero issued handoffs and zero invoice operations. Inquiry email count remained one, unchanged from preflight. Draft inquiries were excluded from backfill.

## Recovery and existing limitations

Fresh backups before and after release round-tripped through both existing encrypted repositories. The post-release checkpoint restored offline into isolated PostgreSQL: control database 25 tables; selected business database 26 tables, two requests and three work items. Runtime privilege-denial checks passed. No persistent restore volume or network access was used.

The independent collector was refreshed and confirmed native PostgreSQL availability. It still reports the preexisting queue-progress blocker; capability configuration alone remains unknown rather than falsely healthy. Offsite/key-custody verification and logged-out reboot recovery remain documented operational limitations. This release neither clears those warnings nor changes Neon billing, provider secrets, invoice dispatch policy or customer communications.

See [rollout/recovery instructions](INQUIRY-ROLLOUT.md) and [inquiry contracts](QUICK-INQUIRY.md). After inquiry drafts exist, rollback must retain inquiry-aware upload/completion guards. Do not restart a pre-feature API or reactivate Neon as a second writer.
