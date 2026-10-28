# Work conversations and operator model revisions

The queue job sheet must let shop operators communicate with a client and add or revise private fabrication models without asking the client to repeat intake. The user authorized review, planning, implementation, main integration and deployment.

## Conversation

Add a chronological conversation panel to request and inquiry detail. A labeled composer has explicit **Add private comment** and **Send email to client** actions. Private comments never send mail. Emails use the contact address from the server's current work record, the configured shop sender and reply address, and a subject identifying the project. Render text safely, retain line breaks, show author, timestamp, recipient and delivery status. Preserve existing private notes and activity.

Persist the message before delivery. A unique client command ID prevents duplicate messages after lost responses; frozen content and recipient snapshots prevent an uncertain retry from changing the original mail. Claim delivery atomically outside the provider call; simultaneous sends cannot both dispatch. Reuse the same provider idempotency key only within 23 hours. Show unconfigured, failed, sending, uncertain and sent truthfully. The UI exposes explicit retry where safe, preserves/copies message text, and never automatically sends on page load. Provider errors remain generic. No customer messages, addresses or filenames enter list summaries, push payloads or browser storage. Replies currently go to the shop's email inbox; automatic incoming email ingestion is outside this request and the UI must state where replies arrive.

## Private models and estimates

On full request detail, expose private STL, 3MF and ZIP upload using existing size/format limits, signed private storage and server analysis. An upload is authorized for one work item and cannot be attached to another using a client-supplied capability. Preserve every original asset and estimate. Failed analysis remains visible and downloadable when storage succeeded. Interrupted uploads must be recoverable without duplicating an attached session. Multiple operator revision sessions may attach to one request.

Provide material, quality, supports, color count, quantity, finish and delivery controls for generating a new immutable estimate. Use existing geometry, pricing and asynchronous slicer components. Existing attached models can be re-estimated after assumption changes without re-uploading. ZIP selection and quantities remain explicit. The latest operator revision becomes the active estimate; older submission/slicer snapshots cannot override a newer revision. Slicer completion must respect the revised profile and quantities. Estimates remain non-binding and do not create invoices, payments or customer mail.

Keep filament readiness corrections and approvals functional; use current estimate assumptions and known grams in readiness without inferring per-color mass or trusting embedded 3MF material claims. Point operators to existing per-color correction controls. Do not mutate the original intake or silently approve a substitution.

## Constraints and verification

Preserve all AGENTS.md privacy, output, generator, auth, theme, keyboard, reduced-motion and 390px invariants. Reuse existing app/API/runtime boundaries; no new public origin or dependency is required. Add additive migration and local adapter parity. Missing schema/storage must fail clearly without breaking the rest of detail.

Test message validation, authenticated scoping, immutable replay, delivery concurrency/failures, retry expiry, safe rendering, model scoping, upload verification, failed analysis, multiple attachments, re-estimation, ZIP handling, latest-estimate ordering and filament behavior. Run npm test, native PostgreSQL integration for migration/concurrency, screenshots and inspect preview-board.png. Deploy tested main with migration and verify live assets, auth protection and a synthetic work journey without messaging the real client.

Implementation choices above are agent defaults derived from existing architecture, not additional user approvals.
