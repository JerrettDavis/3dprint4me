# Product-counter redesign release

## Authorization and scope

The user selected D, approved the blue-and-teal refinement and explicitly requested “build and deploy” on October 26. Implementation is based on deployed portal release `bf14958`, preserving native API and program state. Source branch: `feat/product-counter-redesign`.

Approved specification: [product-counter design](superpowers/specs/2026-10-26-product-counter-design.md). Implementation and release checklist: [plan](superpowers/plans/2026-10-26-product-counter.md).

## Previous production identities

Captured with the authenticated installed Vercel CLI before publishing:

- Storefront: `dpl_6aQ6YNMUuwhJGUZ6xFUsbzYfgCfL`.
- Operator: `dpl_8Zrh7UCHkUria5VMiC134hT9UH3V`.
- Partner: `dpl_FQUrXT9PgPtnhMEwbvpwVC76QBvQ`.

Static rollback selects the corresponding prior deployment in the same existing project; no database rollback is involved. Preserve API origin, provider settings, security headers, authentication protection and domain ownership.

## Baseline evidence

Before implementation, all 1,231 unit/contract tests passed (133.7 seconds). Storefront, operator, partner and independent status returned HTTPS 200. Partner status reported private-invitation access; anonymous partner session returned 401. The 15-response live smoke passes with the current privateFiles/email integration requirements. Its legacy default Neon requirement fails because production now uses native PostgreSQL; that is not a redesign regression. Anonymous owner session returned 403. This supplies no new live authenticated workflow acceptance.

## Implemented behavior

- Product-led storefront with eight real starting points, purpose filters, search/count/empty recovery and working customization or service-scoped request links. Approved blue/teal visual system covers public pages and generator shells.
- Known catalog product context defaults carry into intake without overwriting existing draft/inquiry text. Existing customizer handoff, inquiry fallback and portfolio shares remain.
- Operator queue shows the next decision, acknowledgment summary and compact two-column phone filters. Partner overview prioritizes real active work, including unresolved cancellations/disputes, and separates unpaid obligations from verified settlements.
- Operator shell v28 and partner shell v7 invalidate static caches; private requests remain network-only. No API, schema, native services, partner switches, identities, payment settings or DNS changes.

## Review and focused verification

Public implementation `f1d6993`; workspace implementation `ab2ce59` with line-ending normalization `c9f86f6`. Focused public/order/inquiry suites passed, eleven new workspace hierarchy/state/contrast cases passed and 86 existing workspace regressions passed. Independent review is clear after fixing catalog context, QR wording, unresolved partner states, dark owner action contrast and header keyboard focus. The first full-suite unit phase passed 1,231 checks in 122.1 seconds. Its browser phase identified an outdated cached-upgrade palette/hero assertion and a real 6px customizer mobile-sheet overflow caused by header borders exceeding the viewport token. Commits `9a46310` and `41ca3d4` update the former and fix actual header sizing, respectively; the cache/theme/navigation and sheet-bound assertions remain intact and both focused tests passed. The superseded run was stopped, including its local fixture process tree, and a fresh full npm test is running against the corrected build. Independent re-review found no new issues.

## Prepared production candidates

The exact committed source archive at `41ca3d46ee191af44ddd62b3dd2a302a842bde0e` contains no private environment files. Existing project identities and settings were retained. Operator upload uses the repository root because the existing provider project already sets `rootDirectory: operator`; its build still outputs only `operator/dist`. The partner project uses its existing independent `public/` output.

Vercel reports Ready / Production for all three candidates, created with `--skip-domain` so existing domains remain on their prior deployments until final verification and promotion:

- Storefront candidate: `dpl_Fx5JCMeogYL1AGiTGYA31Hpt9Vgj`.
- Operator candidate: `dpl_BfPi5zdUqzfTTinhicmokvAaEpca`.
- Partner candidate: `dpl_CmvWhMaZMgS7xbacDKvjExPqu6j7`.

After building candidates, authenticated provider inspection confirmed all three custom domains still select their recorded previous deployment IDs. No provider setting or domain configuration was modified.

The four selected native PostgreSQL browser journeys passed (66.05 seconds): cookie/CSRF/cross-account access and logout; owner authorization/obligations while paused; durable payment evidence/CSV after a lost response; unsafe-report routing without location tracking or retaliation. These are disposable synthetic local journeys, not production partner activation or live settlement evidence.

## Release status

The redesign is deployed and externally verified on all three existing custom domains. See final production acceptance below. No native services, DNS, program switches or payment settings were changed.

## Final local verification

The corrected full `npm test` run passed static validation and all 1,231 unit/contract cases (125.7 seconds), then completed its 363-case browser phase: 361 passed, one existing Windows-only skip and one failed asynchronous test assertion (649.5 seconds). The failure was `test_intake_to_interactive_work_inbox`: it immediately counted zero rows after the workspace became visible but before its async list arrived. The same workflow passed in isolation; the actual failure trace confirmed the missing readiness wait.

Tests-only commit `7fb1211` replaces that immediate count with Playwright's web-first `expect(...).to_have_count(1)`. It preserves the exact-one condition and all acknowledgment, revision, notes, reload and privacy checks. The repaired workflow plus eleven workspace regressions passed (12/12, 18.22 seconds). Independent re-review confirmed no weakening. Every browser case has passing evidence on the final unchanged production assets, apart from the documented platform skip; do not describe the earlier full npm command as an uninterrupted green run.

The separate UX audit passed all 241 checks. The four native PostgreSQL journeys above also passed. A git diff check confirms no production assets differ between candidate source `41ca3d4` and final test commit `7fb1211`. Final screenshot capture, visual inspection and live promotion/verification are complete as recorded below.

## Final production acceptance — October 26

Production serves the reviewed archive of `41ca3d46ee191af44ddd62b3dd2a302a842bde0e`:

- [Storefront](https://3dprint4.me): `dpl_Fx5JCMeogYL1AGiTGYA31Hpt9Vgj`.
- [Operator](https://work.3dprint4.me): `dpl_BfPi5zdUqzfTTinhicmokvAaEpca`.
- [Partners](https://partners.3dprint4.me): `dpl_CmvWhMaZMgS7xbacDKvjExPqu6j7`.

The official CLI promoted the three Ready production-environment candidates only after local review/checks and visual inspection. Subsequent authenticated provider inspection confirms each custom domain selects the intended Ready deployment. Previous deployment identities above remain the rollback points. Production assets are identical to final test/evidence commits; later changes affect tests, capture tooling, documentation and screenshots only.

`npm run screenshots` completed all 153 captures and the actual `screenshots/preview-board.png`. The board is 1680×68062; readable crops of that exact board were inspected for public, partner and owner/material/error states, together with the dedicated workspace board and phone render. Capture tooling now opens the retained gallery entry instead of the removed old hero selector. Images contain synthetic local fixture data, not production private records.

External acceptance passed:

- 109 deployed static files match archive bytes and SHA-256 exactly, including the changed storefront graph, generated customizers and all operator/partner files.
- Six live anonymous Chromium states (each frontend at 1440px light and 390px dark) return 200, render without page errors and have no horizontal document overflow. Live storefront search, unmatched-query recovery and product counts work.
- All 15 storefront smoke checks pass against the current native-platform privateFiles/email requirements. Security headers and private/source path denial pass; operator partner-admin headers match all six configured values, partner headers all eight.
- Anonymous owner session returns403, partner session401. Partner status remains private invitation-only. Independent public status remains200.

Authenticated production workflows were not newly exercised; signed-in layout and behavior evidence comes from synthetic browser fixtures and four disposable native PostgreSQL journeys. This UI release does not activate the partner program, establish professional/accounting approval, create accounts or send payments/messages. No customer request was submitted by the live smoke checks.

Sanitized exact-file/browser/security proof is retained in [product-counter-live-proof.json](product-counter-live-proof.json). Private CLI upload/inspection logs and source archives remain outside Git. The source is reviewable in [PR54](https://github.com/JerrettDavis/3dprint4me/pull/54), stacked on the already-deployed partner branch; no main-branch merge is claimed. Hosted CI is separate from the completed local and live evidence.
