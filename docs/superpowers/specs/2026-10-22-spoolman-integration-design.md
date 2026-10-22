# Spoolman inventory integration

Status: approved by owner on 2026-10-22 at 12:36 CDT. Implemented and activated on 2026-10-22; see `docs/SPOOLMAN.md` for release evidence.

## Intent and observed state

Make the released private filament inventory, request matching, and estimate cost basis reflect physical spools managed in Spoolman. Retain manual entries for stock outside Spoolman. Use the existing JavaScript application, repository boundaries, operator UI, and native PostgreSQL platform.

Read-only observation on 2026-10-22 through the existing trusted Docker host SSH alias found both applications running on the same host. Spoolman's `GET /api/v1/spool` returned 80 active spools, all with remaining weights; six had fractional weights. Seventy-four lacked both spool and filament price. Nine had multicolor definitions and lacked a single hex color. Observed materials included ABS, PLA, PLA+, PETG, TPU, and Flexible (TPU). This is an observation, not seeded data or a promise that counts remain unchanged. The older homelab onboarding guide's zero-spool statement is outdated.

The current 3dprint4me inventory has no Spoolman connector. Costs and stock are manually maintained, inventory writes are revision checked, and matching can fall back from a missing hex to a color label. That fallback must not turn multicolor filament into a solid-color match.

The deployed `/api/v1/openapi.json` identifies Spoolman 0.27.0. Its spool endpoint supports `allow_archived` (default false), `limit` (default unlimited), and `offset` (default zero). Both spool and filament prices are nullable and use the system-configured currency; initial and remaining weights are nullable net filament grams. Request archived rows explicitly. These facts were checked against the running service; currency and detailed fallback semantics still need verification before activation.

Further read-only checks on 2026-10-22 confirmed `/api/v1/setting/currency` is explicitly set to USD. A `BEGIN READ ONLY` query through the running platform API's configured database returned zero inventory rows (total, active, and stocked all zero), so no existing manual inventory currently needs physical duplicate reconciliation. Recheck both facts immediately before activation; subsequent operator edits or source settings changes can invalidate this observation. Source price fallback semantics still require verification.

## Proposed ownership and behavior

These are builder recommendations for owner review, not previously approved requirements:

- Spoolman owns imported spool identity, product/vendor description, material, color information, nominal weight, remaining grams, archive state, and recorded purchase price. Do not write back to Spoolman or deduct stock a second time; the existing Home Assistant/SpoolmanSync integration already records printer usage.
- Keep one stable imported inventory identity per Spoolman instance and physical spool ID. Do not merge distinct spools by color or product. Existing proposal references and historical snapshots survive subsequent syncs, archives, and deletions.
- Retain separate manual inventory. Never silently merge a manual row into an imported spool. Before first activation, inspect existing rows and identify any duplicates with the owner; do not count the same physical stock twice.
- Lock source-owned fields in the operator inventory editor and provide a link to the spool in the human Spoolman UI. Keep local estimate-default selection, freight, private notes, and an explicitly labeled local cost override separate from source fields. Define editable-field authorization and revision checks server-side too.
- Pull automatically every minute from the existing jobs worker, with a shared lease preventing overlapping imports. Provide an owner-only manual refresh and authenticated sync status, including last attempt, last complete success, record counts, and a sanitized failure state.
- Fetch and validate a complete bounded snapshot before changing inventory. Publish inventory updates and sync success atomically; preserve stable IDs, update revisions only for meaningful changes, and never let concurrent stale snapshots replace a newer successful one. Deactivate imported records absent from a verified complete snapshot or archived in Spoolman; preserve their history. A failed or partial fetch must never look like an empty inventory.
- Mark data stale after five minutes without a successful sync. Preserve the last successful rows for recovery and display, but do not report stale imported grams as currently verified stock or produce a sufficient-stock status from them. Show matching unavailable/review warnings while request details remain usable. Label any retained cost snapshot with its source and age.

## Mapping and pricing

Preserve the original material label. Use explicit canonical mappings: PLA to `pla`, PLA+ to distinct `pla-plus`, PETG to `petg`, ABS to `abs`, and TPU/Flexible (TPU) to `tpu`. The TPU alias is a reviewable builder recommendation; verify actual products during reconciliation. Never silently treat PLA+ as PLA or introduce cross-material compatibility. Unknown material labels remain visible and require mapping/review before confident matching.

Preserve fractional source weights privately; conservatively floor remaining grams for the existing integer stock calculation. Display the source precision where useful. Unknown weight is unknown, never a full spool or verified zero. Validate nonnegative finite values and supported bounds. Do not silently clamp invalid quantities into apparently valid stock.

Preserve all multicolor hexes and direction. Multicolor, transparent, or otherwise unrepresentable appearances require review and are excluded from automatic solid-color eligibility, including label-based color fallback. Single known source hex values use the existing local matching calculation. Missing color remains explicitly unknown.

Enforce freshness, known material mapping, and appearance eligibility in candidate ranking, proposal creation/acceptance revalidation, and accepted-proposal status. An old acceptance remains historical evidence; it cannot upgrade stale, unmapped, or unrepresentable current stock to verified ready.

Spool price takes precedence over filament price when present, subject to verified source semantics. Missing price stays unknown, never zero. An explicit owner-maintained local cost override takes precedence for pricing, followed by a known source price; otherwise use the existing documented material fallback and label it as a fallback. Do not include unknown-cost rows as zero in weighted cost averages. Report partial cost coverage when some stocked grams lack a known price. Verify currency before using source prices: Spoolman prices do not establish USD by themselves. Do not import vendor estimates as owner-confirmed purchase prices or guess freight. Existing manual pricing remains unchanged.

For partial coverage, compute the weighted average using only stocked rows with known usable costs and report uncovered grams separately. If none have a known usable cost, use the documented material fallback. Imported nullable price/weight validation is separate from the existing manual-input contract, which requires integer cents and grams; unknown values must not be forced through zero-valued manual fields.

## Builder review

A fresh builder review found no blocking design ambiguity. It identified the proposal-readiness guard and nullable-import/partial-cost contracts above. The owner approved the design on 2026-10-22. Read-only checks resolved current currency and duplicate-inventory questions as described above; recheck at activation and request owner input only if a material conflict appears. Implementation mechanics remain builder decisions.

## Private architecture and failures

Use a dedicated HTTP provider adapter, a pure mapping/validation module, a sync application service, and repository methods for atomic snapshot application and status. Extend local and PostgreSQL repositories with equivalent behavior and add an additive migration. Preserve owner-only edits, origin checks, request matching, proposal audit history, private intake, and no-integration behavior.

Spoolman requests originate only from server-side jobs or authenticated server operations, never the storefront, customizer, or browser. Use a dedicated private Docker network connecting the jobs service to Spoolman's application service, without joining Spoolman's database network. Verify API reachability and allowed Host behavior using the deployed Spoolman version. Preserve the Authentik-protected human UI and existing restricted Home Assistant endpoint; do not broaden either endpoint's allowlist. Keep connection configuration outside Git and static output. Do not give the jobs service unrelated credentials.

Bound timeouts, response bytes, spool counts, and pagination. Disable redirects; validate response shape and content type. Do not log provider bodies, credentials, URLs containing credentials, or raw exceptions. Persist only safe failure codes and operator messages. Unconfigured integration leaves manual inventory functional and exposes an honest unconfigured status. Provider downtime retains the last complete snapshot and never marks a failed attempt successful. Syncing never modifies customer requirements, accepts a substitution, reserves filament, or consumes stock.

## Delivery and verification

1. Verify the deployed Spoolman API schema, price/weight semantics, pagination, archive inclusion, and currency configuration against official source and read-only runtime evidence.
2. Reconcile existing 3dprint4me inventory with all source spools before activation; explicitly resolve potential duplicate physical stock and missing-cost handling.
3. Add regression coverage for provider URL/method/headers, redirects, timeout, bounded payloads, malformed and partial snapshots, pagination, unknown prices/weights/materials, fractional weights, multicolor label fallback, archive/deletion/reactivation, stable IDs, unchanged revisions, concurrency, freshness, owner authorization, and local/PostgreSQL parity.
4. Exercise automatic and manual sync, imported-field editing restrictions, cost coverage, matching, proposal history, failure isolation, light/dark/system themes, keyboard use, reduced motion, and 390-pixel layout. Run `npm test`, `npm run screenshots`, and inspect `screenshots/preview-board.png`; regenerate versioned assets where required.
5. Update operator, architecture, print-estimation, deployment, and operational docs. Include migration order, private connection setup, material mapping, currency/cost policy, stale behavior, recovery, and disable/rollback instructions.
6. Deploy the migration and integration, enable private syncing, compare every imported spool against a fresh complete source snapshot, confirm a second automatic sync without duplicate rows, and verify production failure behavior without changing physical spool records. Verify pricing and matching with the actual imported records. Record evidence and any unresolved physical inventory accuracy limits.

Completion requires a live automatically maintained inventory with verified matching/pricing behavior and recoverable failure states, not just a connector that passes fixtures. Actual physical weight accuracy still depends on correct source onboarding and printer-to-spool assignment.
