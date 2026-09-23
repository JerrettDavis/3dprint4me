# Quick inquiry contract and operations

Quick inquiries are neutral project leads, independent of the four-service detailed request flow. They create no estimate, order, payment, or consulting selection.

## Deployment

Apply `neon/migrations/002_quick_inquiries.sql` using the existing privileged Neon deployment role before releasing `/api/inquiry`. The server's `DATABASE_URL` role must own these tables or have explicitly scoped access that bypasses RLS. No public role has a policy or grant. Only `public/` is static output.

Use the existing private Blob store (`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` with Vercel-managed OIDC). Email uses the existing `RESEND_API_KEY`, `REQUEST_FROM_EMAIL`, and `REQUEST_TO_EMAIL`; no additional secrets are introduced. No Neon means `{mode:"local",live:false,uploads:[]}`. Configured storage failure returns a safe 502, never fallback success. Missing Blob with selected attachments returns 503 before creating a draft.

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
