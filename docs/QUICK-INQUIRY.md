# Quick inquiry contract and operations

Quick inquiries are initial questions, distinct from the four-service detailed project request. A received inquiry creates a private inbox work item needing a response, with no estimate, order, payment, or consulting selection. The storefront explains both choices before entry.

## Deployment

The production database is native PostgreSQL. Historical migration filenames remain under `neon/migrations/`; this does not authorize queries against the fenced Neon source. Apply `002_quick_inquiries.sql` and `009_inquiry_workflow.sql` using the private migration owner. Runtime `platform_app` inherits scoped `platform_backend` grants/RLS policies and neither owns tables nor bypasses RLS. No public role has access. Only `public/` is static output.

Use the existing private Blob store (`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` with Vercel-managed OIDC). Email uses the existing `RESEND_API_KEY`, `REQUEST_FROM_EMAIL`, and `REQUEST_TO_EMAIL`; no additional secrets are introduced. No database means `{mode:"local",live:false,uploads:[]}`. Configured storage failure returns a safe 502, never fallback success. Missing Blob with selected attachments returns 503 before creating a draft.

## Browser contract

Generate 32 cryptographically random bytes encoded as hex for `submissionKey` and retain it in memory across retries of unchanged inquiry details. Do not put it in a URL, logs, or analytics. Server stores only its SHA-256 digest. Changed details need a new key; reuse against a different normalized payload returns 409.

`POST /api/inquiry`, JSON:

```json
{"submissionKey":"<64 hex characters>","inquiry":{"intent":"unknown","message":"A replacement knob","referenceUrl":"","replyEmail":"person@example.com","name":"","context":{"entryPoint":"hero","exampleSlug":null}},"files":[{"name":"knob.stl","size":1234,"type":""}],"website":""}
```

Reply email plus at least one message, HTTP(S) reference URL, or file is required. Intent is one of unknown/replace/custom/print/repair/business, never a service identifier; unrecognized values normalize to neutral unknown. Context contains only an allowlisted UI entryPoint and published exampleSlug (otherwise unknown/null). Name is optional. Reference URLs are recorded, never fetched. Limits: 32 KiB JSON; message 4,000 characters; URL 2,000; email 254; name 100; intent and each context field 100. Files: six, 10 MiB each, 25 MiB total. Allowed extensions: jpg/jpeg/png/webp/pdf/stl/3mf/step/stp/obj/txt. Server chooses MIME type from extension and generates private object names.

Draft response (201): `{id,mode:"neon",live:false,uploads:[{index,path,uploadUrl,method:"PUT",contentType}]}`. Send each original file to its signed URL using the returned method and Content-Type. URLs expire after 15 minutes, prohibit overwrites, and constrain size/type. Retrying POST refreshes upload instructions, skipping objects whose path and exact size already verify. An existing wrong-size object cannot be overwritten: start a fresh submission after correcting the file selection.

Then `PATCH /api/inquiry` with `{id,submissionKey}`. No files or inquiry fields are accepted as completion authority. The server looks up the owned draft and checks every expected object through authenticated Blob SDK `head`. Missing/incomplete objects return 409. Success returns `{id,mode:"neon",live:true,uploads:[]}`; replay is safe. Even inquiries without files need PATCH. Neither draft creation nor honeypot handling claims receipt.

`live:true` means database acceptance, independently of email delivery. It never means a paid order. Preserve email/download recovery on local mode, network/API errors, and incomplete uploads. JSON errors omit provider errors and credentials.

## Abuse controls and retention

The API enforces a honeypot and a durable limit of 60 calls/hour per HMAC-hashed Vercel client IP (including replay and completion calls). Generic forwarded headers are not trusted. Outside Vercel all callers share a local bucket. The HMAC key comes from the server database secret; IP addresses are not stored. This is basic abuse mitigation, not a CAPTCHA or a global spend cap.

Inspect `quick_inquiries WHERE status='submitted'` for the intake queue. Owner email contains inquiry details and private Blob paths; retrieve attachments through the authenticated Vercel storage console. There is no public file URL and no public listing/read endpoint. Treat uploaded files as untrusted.

Periodically inspect drafts older than seven days, delete their private Blob objects and then their database rows under the business retention policy. Purge rate-limit rows whose bucket is older than seven days. Completed inquiry records, their persisted email payloads, and attachments need coordinated deletion when a privacy deletion request is fulfilled.

## Notification recovery

Only the owner receives a quick-inquiry email; no customer receipt or webhook is sent by this endpoint. `notification_status` is pending/sending/sent/failed. On accepted POST/PATCH replay, an atomic claim permits at most three attempts, at least one minute apart, within 23 hours of the first attempt. The complete provider payload is persisted before send and reused unchanged with `Idempotency-Key: quick-inquiry/<id>/owner`. This prevents duplicate owner delivery if a process dies after Resend accepts a message. Database acceptance survives notification failure.

Retries are request-triggered, not scheduled. Operators should monitor pending/failed/sending submitted rows. The `lib/quick-inquiry/notify-inquiry.js` use case claims and finishes retries through the repository port; `lib/inquiry-store.js` retains a compatibility facade for privileged callers. After the attempt/window limit, inspect Resend delivery history and handle manually; do not reset timestamps or keys blindly. There is deliberately no automatic retry after provider idempotency retention expires.

Primary provider references: [Blob SDK and head](https://vercel.com/docs/vercel-blob/using-blob-sdk), [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). Resend retains keys for 24 hours, hence the shorter server retry window.


## Inbox and conversion

`work_items.kind` distinguishes `inquiry` from `request`. Inquiry states display as Needs response, Reviewing, Waiting for customer, and Closed; production/quote states do not apply. Notes, follow-up dates, priority and private attachments remain on the same work identity. Filters can show either kind or both.

Operators can manually reply by email, generate/copy a private continuation link, or choose a service/title to prepare a project. Conversion retains the source inquiry and work ID. An operator-prepared project is explicitly incomplete (`projectDraft`), with no fabricated customer consent or estimate. Customer completion supplies validated project details and terms. The private source remains visible after conversion. Neither conversion nor invitation generation sends customer email or creates an invoice. All communications and invoice dispatch remain manual.

## Private continuation contract

A customer holding the original in-memory inquiry submission key can explicitly request continuation with `POST /api/inquiry?kind=handoff`, JSON `{action:"issue",id,submissionKey}`. An authorized operator can use `POST /api/operator-work?resource=inquiries` with `{action:"invite",workId}` or `{action:"prepare",command:{workId,revision,service,title}}`; preparation requires an `Idempotency-Key` header. These are existing function routes, not additional deployments.

Links use `/order.html#inquiry=<64 lowercase hex characters>`, expire after seven days and are private bearer capabilities. Copy/share only with the intended customer. Regenerating a link revokes the previous unused link. Hashes only are stored server-side. The form clears the fragment immediately, redeems it through POST JSON, and holds the token only in memory. Refreshing requires reopening the original link. Never place tokens in logs, analytics, local/session storage, receipts, notes or email templates automatically.

Read action `{action:"read",token}` returns only customer inquiry fields, attachment metadata and proposed project title/service. File action `{action:"file",token,index}` returns a 60-second signed URL for an exact stored attachment. Operator notes/history/billing are never available to the capability. Expired/revoked links fail closed; the form offers a fresh, separate request explicitly.

Create/complete/upload JSON carries top-level `handoffToken`, separate from the request. Bound drafts reject ordinary upload/completion calls even if the token field is omitted. One canonical project is selected transactionally across customer/operator races. Inherited attachments are merged by the server, verified outside the SQL transaction and rechecked against the locked source before commit. New uploads retain their normal request-prefix ownership checks. Completion consumes the capability atomically; a retry returns the existing reference without new notifications or checkout proof.

Private continuation uses a separate per-inquiry browser draft and never restores a different customer's generic draft. Terms must be confirmed again and an unknown inquiry requires a service choice. Offline/unconfirmed inquiries can copy bounded text into a separate form through one-use session storage; no submission key, private file authority or inherited association is copied. The UI states that delivery was not confirmed.

## Operations and recovery

`INQUIRY_WORKFLOW_ENABLED=1` enables new native invitation/conversion actions. Leave it unset during the first guarded API rollout; bound-draft scope checks remain active regardless. Existing private links can still complete on an inquiry-aware guarded release. Do not roll the API back to a release predating these checks after any inquiry draft is bound. Static UI rollback is independent; use a guarded API release or fix forward.

Migration 009 backfills at most 1,000 submitted inquiries per application, preserving submission timestamps and adding one historical work event. Draft inquiries are excluded. Rerun after API rollout until submitted inquiries without work items equal zero. It does not replay email, push or invoice actions. Normal acceptance/retry repairs a missing work item atomically.

Operator clients request `schema=2` for details. Inquiry-backed details return HTTP 426 to older clients; reopen the inbox to receive shell v10. Existing full-request details remain compatible. No signed proxy header contract changes are needed.

Retention/deletion must account for the inquiry, work history, canonical project, private files and invitation hashes together; foreign keys deliberately prevent accidental orphaning. Existing backup/restore procedures include these tables. Never delete the source inquiry to hide a conversion, and never reactivate Neon as an independent writer.
