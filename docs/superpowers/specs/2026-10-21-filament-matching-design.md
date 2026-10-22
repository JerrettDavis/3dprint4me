# Filament inventory and work-request matching

Status: approved by owner at 21:07 CDT on 2026-10-21.

## Intent

Help operators see whether requested materials and colors are available before committing to a job. Maintain private filament inventory, rank the closest available matches, and raise actionable purchase, substitution, and review alerts in the work pane. Matching thresholds must be adjustable.

## Existing foundations

The print-estimation context already stores filament material, brand/line, color label, nominal spool grams, landed cost, on-hand grams, active/default flags, and notes. Owner-authorized save and operator list APIs exist in `/api/operator-print`. Inventory currently supplies pricing costs; there is no inventory management UI or request matching.

Use that inventory rather than introduce another stock ledger. Preserve pricing behavior and both local and PostgreSQL repository adapters. The operator app lives in `operator/`, outside the storefront's `public/` output.

## Proposed behavior

- Add private inventory management to the operator app: list, create, edit, and deactivate filament entries; record material, brand/line, color name and optional measured/representative hex color, quantity in grams, costs, and notes. Existing rows remain usable without a hex value. Only owners may change inventory or shared matching settings; authorized operators may inspect matches.
- Match each explicit material/color requirement on a work request, including ordinary print specifications and supported generator color parameters. Do not inspect arbitrary generator parameters or sensitive fields. Non-print services without explicit print requirements are not applicable.
- Permit operator corrections or structured requirements when customer wording is ambiguous. Retain the original request. Do not guess structured requirements from unrestricted prose and silently report stock as suitable.
- Rank active, positive-stock candidates by material compatibility and perceptual color distance, with deterministic ties. Show requested properties, candidate properties, distance, quantity, and reasons for warnings. Brand/line preferences remain visible; missing information cannot earn an exact match.
- Exact material is the default (builder recommendation, not an owner-specified compatibility policy). Cross-material suggestions require an explicit directional compatibility policy and always show a substitution warning. A color threshold never overrides material incompatibility. No implicit PLA/PETG/ABS interchangeability is assumed.
- Use a documented perceptual color-distance calculation for known hex values. Known color labels may resolve through a small explicit local alias table; unrecognized names require review. Explain that digital swatches approximate physical filament appearance and do not establish finish, transparency, or functional equivalence.
- Provide adjustable HSL/RGB limits, search bands, and minimum stock buffer, plus explicit material substitution controls. Persist validated shared settings privately. Provide defaults and clear units and ranges. Preview changes against the selected work request before saving shared settings.
- Show alerts in the work pane: purchase needed when no acceptable stocked option exists or known demand exceeds available grams; substitution available when only alternatives qualify; needs review for unknown material/color or quantity. Show sufficient-stock status only when both suitability and quantity are established.
- Account for all requested colors. Never allocate the entire stock of the same candidate independently to multiple requirements within one request. Where only total slicer grams are known, display total demand and mark per-color sufficiency unverified; do not invent per-color usage.
- Recompute against current inventory and settings when opening/refreshing work. Suggestions do not reserve, consume, or order filament. Selecting a recommended candidate prepares a proposal; substitution acceptance follows the explicit approval flow below. Clearly state that available grams are unreserved and can be shared across pending work.
- Matching covers requests without uploaded estimate-session assets. Inventory failure shows an unavailable state while leaving the work pane and request details functional.

## Owner clarification: bounded progressive color search

The owner requested adjustable H/S/L and R/G/B variance ranges. For bright blue, acceptable alternatives can stretch from dark purple through pale teal while stopping before pink/red and green. These are configurable boundaries, not a blanket rule that all blues, purples, and teals are equivalent.

Compute all comparisons against the originally requested color. Never grow the allowed range around a previous candidate: a chain of nearby candidates must not drift into a forbidden hue. Apply hard configured limits first, then use perceptual distance to rank eligible options.

Proposed controls (builder decisions for review):

- HSL mode: separate clockwise and counterclockwise hue tolerances in degrees, saturation tolerance and lightness tolerance in percentage points. Circular hue arithmetic must work across 0/360. Asymmetric hue tolerances permit the blue-to-purple versus blue-to-teal boundary to be tuned separately.
- RGB mode: maximum absolute differences for red, green, and blue, each in 0–255 channel units. Modes are HSL, RGB, or both; both requires both sets of bounds to pass.
- A close-search fraction and a widening step, expressed as percentages of the hard limits. Start with the close band; expand only when it has no candidates, stopping at the first populated band or the hard maximum. Provide an explicit way to inspect all remaining eligible candidates in further bands.
- Within a populated band, preselect the best fit and show every eligible candidate in that band for selection. A single eligible candidate is preselected directly. Further bands remain accessible without silently changing the recommendation. Never include out-of-bounds candidates as an acceptable substitute.
- For neutral/near-neutral colors where hue is unstable, do not invent a confident hue match; use RGB constraints when available or mark for review. Unknown color values require review.

Show the original swatch beside candidate swatches, names, material, stock, differences, and the search band that produced the recommendation. Digital swatches are an aid to selection; finish and translucency remain separate properties for operator review.

## Substitution selection and approval

The owner explicitly requested both customer approval and operator acceptance on the customer's behalf, for example after a verbal call. Implement both paths; preselection alone does not record customer consent.

Persist a substitution proposal with its work/requirement identity, original requested material/color, selected inventory ID and a snapshot of offered material/color, matching settings/differences, creator, revision, timestamps, status, and approval history. Preserve the original request. Accepted choices remain visible after later inventory/settings edits; changed requirements or an edited proposal invalidate pending approval and require a new revision. Current stock shortages remain visible even for an accepted substitution.

- **Accept on customer's behalf:** operator explicitly accepts the selected proposal, records a required reason/source such as verbal call, and leaves an audit entry identifying the operator and time. The UI must distinguish operator-recorded acceptance from a direct customer response.
- **Request customer approval:** operator previews the exact substitution message and recipient, then explicitly sends it to the request's recorded customer contact. Include original and proposed color/material, approximate swatches or hex labels, request reference, and clear instructions to reply accepting or declining. Exclude inventory costs, internal notes, unrelated customer data, and model download links.
- **Customer response:** proposed initial channel is an email reply to the business's existing reply-to address (builder decision). The operator records acceptance or rejection and the response source in the work pane. Do not claim automated inbound-email processing or direct customer web approval. A decline keeps purchase/alternative-selection action visible. A customer email requesting approval is not itself approval.
- **Delivery:** use the existing email provider behind a module boundary, with a persisted proposal before delivery, stable idempotency keys, bounded timeouts, safe failure messages, and explicit send state. An unconfigured or failed provider leaves a recoverable copyable message and pending proposal, never a false sent/approved status. Retrying the same proposal must not create duplicate approval records.
- **Concurrency and authorization:** only authorized work operators can propose/send/record decisions, using revision checks. Owner-only inventory/settings writes remain separate. A stale screen cannot approve a replaced proposal. Reopening or changing an accepted choice appends history rather than deleting prior acceptance.

Automatic purchases, automatic substitutions without a recorded decision, stock reservations/consumption, inbound-email automation, and a new customer portal are outside this design.

## Architecture and privacy

Keep matching policy and validation in server domain/application modules and repository access in adapters. Compose the result into authenticated work detail independently of print-estimate availability. Expose only generic alert summaries if work-list visibility is added; no customer details, inventory costs, or requirement text enter Push or Home Assistant payloads.

Extend inventory storage through an additive migration for color values, private matching settings/requirement overrides, and revisioned substitution proposals/decision history. Validate every write server-side, maintain authorization and origin protection, handle stale edits explicitly, and preserve safe failure responses. No external color API, analytics, or generator network requests are needed. Sensitive customizer parameters never enter matching records, substitution messages, or logs.

## Builder decisions

Use the existing JavaScript modules, operator styling, and repository contracts. Select a standard local perceptual color metric, document its scale, and choose conservative clearly labeled defaults. Implement an inventory entry as a stock lot rather than promise individual-spool tracking. Do not seed fictional production inventory. No automatic purchasing or stock consumption is in scope.

## Verification and completion

Cover validation and authorization, local/PostgreSQL parity, legacy rows, HSL/RGB thresholds and mode intersection, circular hue/asymmetric hue limits, neutral colors, progressive band widening and hard stops, deterministic best fit and all candidate choices, material incompatibility, unknown colors, multiple colors sharing stock, insufficient and unknown quantities, generator-sensitive-field exclusion, requests without estimates, and inventory failure isolation. Include blue/purple/teal versus excluded red/pink/green fixtures using explicit bounds.

Cover proposal persistence/revisions, operator acceptance with source, pending customer approval, declined and recorded customer responses, changed proposals, stale decisions, email recipient/body safety, provider URL/method/headers, idempotent retries, unconfigured delivery, and delivery failures. Verify that recommendations, sending, and approval remain distinct states.

Exercise owner inventory editing, operator access, threshold preview/save, request alerts, candidate selection, operator acceptance, customer approval message preview/send, response recording, keyboard use, light/dark/system themes, reduced motion, and 390-pixel layout. Run `npm test`, `npm run screenshots`, and inspect `screenshots/preview-board.png`. Update architecture, operator, print-estimation, migration, and operational documentation for the final contracts. Regenerate versioned assets where required. Completion requires inventory management, matching, configurable thresholds, work-pane alerts, and both substitution approval paths to function together with verified failure behavior.
