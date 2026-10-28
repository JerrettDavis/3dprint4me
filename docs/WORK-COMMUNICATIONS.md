# Work conversations and private model revisions

## Conversation

Every job sheet has a **Conversation** composer. **Add private comment** saves text for operators only; **Send email to client** saves and dispatches an email to the contact shown above the buttons. The server selects that address from the current request or inquiry. Existing private notes and activity remain below the sheet. Incoming replies arrive in the shop's email inbox; this release does not ingest incoming mail into the queue.

Each message shows its author, timestamp, recipient and delivery state. **Accepted by email provider** is not proof of inbox delivery or a client response. Failed, uncertain and unconfigured messages stay saved and copyable. **Retry email** reuses the exact original sender, reply address, recipient, subject and body after the first real attempt. A simultaneous click cannot acquire a second sending claim. A crashed claim becomes retryable after 30 seconds; uncertain/previously attempted mail cannot be retried after 23 hours. Check the shop/provider inbox before composing another message after that window. Drafts are held only in tab memory and cleared on sign-out/session rejection.

Mail uses `RESEND_API_KEY`, `REQUEST_FROM_EMAIL` and `REQUEST_TO_EMAIL`; the last is the reply address. When delivery has never been configured, the saved message can be retried after configuration is restored. Removing configuration after an uncertain actual attempt does not reset its original retry window. No client message is sent on page load or from a status change. The provider boundary follows [Resend's idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys) with a shorter application retry window.

Authenticated endpoints: `GET|POST /api/operator-work?resource=communications`. GET takes `workId`. POST takes `action=create` with `{ workId, command: { commandId, kind: 'comment'|'email', body } }`, or `action=retry` with `{ workId, messageId }`. Bodies are plain text up to 8,000 characters. The latest 200 records are shown; older records remain in the private database. Command replay is scoped to work and operator and rejects changed content. Migration `014_work_communications.sql` is required; an unavailable conversation store leaves the rest of the job sheet functional.

## Models and estimates

On a project request, including an operator-prepared incomplete draft, **Models & estimate revisions** accepts private STL, 3MF and ZIP files using the existing server size and content limits. **Upload & analyze model** saves the original bytes, measures them on the server and creates a new non-binding estimate. Draft planning leaves the request incomplete, preserves missing customer consent and keeps actual-production and invoice controls hidden; the corresponding server applications also reject draft production/billing commands. On a bare inquiry, choose a service with **Convert to project** first; customer completion is not required to plan. Analysis failures retain the downloadable source with an explicit failure state. **Pending private upload** lists interrupted uploads for this work; choose one and use **Finish pending upload** after a completed upload/lost response or page reload. A grant whose bytes never arrived reports an incomplete upload; choose the original file to upload again. Unattached sessions expire under the existing 24-hour cleanup policy.

Choose an attached model and adjust material, quality, supports, color count, quantity, finish or delivery, then **Update estimate**. For ZIPs, set each desired part quantity; zero excludes a part. The active revision retains those selections after refresh. Every estimate covers exactly the named model or selected pack, not all attached models. Existing models, intake assumptions and immutable estimate history are retained. The newest authoritative submission/operator revision owns the active model and profile; a later customer model submission supersedes earlier draft planning. Revision identity keeps older asynchronous slicer jobs from replacing it, including changed quantities or pack selections. Slicing produces a matching immutable result; a failed slicer leaves the geometry estimate available. Refresh the sheet to see completed analysis.

Filament readiness uses the current operator estimate's material and known total grams. Review named colors/per-color mass in **Review or correct filament requirements**; embedded material declarations and a numeric color count do not establish stock or approval. Explicit filament overrides remain reviewed requirements and should be corrected when the material changes. A new estimate does not approve a substitution, reserve stock, send a message or create an invoice.

Private actions use `POST /api/operator-print`:

- `authorize-model-upload`: `workId, filename, size, contentType, options`.
- `finish-model-upload`: `workId, sessionId, assetId`.
- `estimate-model`: `workId, assetId, options, commandId`, optional ZIP `selections: [{ partId, quantity }]`.

Operator sessions have a server-only work binding and never issue anonymous capabilities. Migration `015_operator_model_revisions.sql` permits additional operator sessions while preserving one customer-intake session per request. Replayed estimate commands reject changed model/options/selections. Active-revision lookup is independent of the bounded recent-history list.

## Privacy and recovery

Conversation text, recipient and exact envelope snapshots are private customer records in `work_communications`. Include all rows for the relevant `work_item_id` in an authorized access/export request, including records older than the UI's latest 200. Include legacy `work_notes` and the original request/inquiry separately. Provider credentials are not stored in message rows. Follow the existing retention/legal-hold decision for the customer's work record; no automatic conversation deletion period is introduced here. When an authorized deletion is due, delete conversation rows before deleting the work item, and include operator-bound pending print sessions in private-model cleanup. Whole-database encrypted backups include the new table; deletion from retained backups follows the existing backup lifecycle. Keep exports and recovered files outside `public/`.

The new schema is additive except for replacing the customer-only session uniqueness constraint with an equivalent partial index that permits operator revisions. Roll back application images/static deployments while retaining schema and customer data. Do not restore a stale database to roll back code. Existing approved guarded rollout now applies 014/015 with the prior additive migrations. Validate a fresh encrypted checkpoint and restore rehearsal before release.

## Acceptance evidence

Design and implementation plan: `docs/superpowers/specs/2026-10-28-work-communications-design.md` and `docs/superpowers/plans/2026-10-28-work-communications.md`. Unit coverage lives in `tests/unit/work-communications.test.mjs` and `operator-models.test.mjs`; native migration/concurrency/least-privilege coverage in `tests/integration/work-communications-postgres.test.mjs`; browser journeys in `tests/e2e/test_work_communications.py`. Release verification and deployed identities will be recorded after completion. Production has not yet been changed by this branch.
