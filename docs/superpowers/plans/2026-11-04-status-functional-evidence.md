# Dated functional evidence on public status

The public collector deliberately returns unknown for configured uploads, email
and slicing. Keep that distinction. Project separately signed, dated successful
functional checks into public status only while production API and platform
evidence are fresh, their providers match the verified target, and prerequisites
have not explicitly failed. Preserve real failure and history records.

1. Add failing unit cases in `tests/unit/status.test.mjs`: valid signed timestamps
   produce operational capability status; missing, expired, future, wrong-provider
   and failed prerequisites do not. Add a browser case proving open-tab expiry of
   functional evidence and visible check dates.
2. Extend control schema in `status/lib/model.js` with explicit provider and three
   actual verification timestamps. Functional evidence lasts at most 24 hours;
   arrival of another heartbeat never renews it. Emit only safe date/scope fields.
3. Update `status/public/assets/status.js` to preserve the 12-minute current
   telemetry gate, additionally expire functional evidence and show its actual
   date. Document these rules in `status/README.md`.
4. Run targeted regressions, full project checks, screenshot capture and inspect
   the status capture/board. Deploy the Worker and public status from committed
   bytes without changing secrets, schedules, bindings or protection. Publish
   actual existing upload/slicing/email proof dates, then verify both live pages,
   all eight public components, no private blockers, and anonymous protection.
5. Merge and publish documentation, preserving historical incidents. Recheck
   current public and private evidence before completing the goal.

## Verified execution

The unit and browser regressions failed before implementation and pass after it.
Review identified an API-age gap; functional component freshness now uses the
oldest API/platform timestamp, and its deadline also respects control expiry.
Four browser cases verify actual open-tab expiry when network refresh fails.

The documented alternate public origin initially failed its browser refresh due
to CORS. Its exact origin is now allowed alongside the primary; an unrelated
origin remains denied. This additional red/green transport regression and the
final ten status/alert unit checks pass. Independent review cleared both changes.

`npm test` completed successfully: 1,281 unit/contract checks, 438 browser cases
with one existing Windows skip, and 241/241 UX checks. All 168 screenshots were
recaptured; the board and the status-specific phone captures were inspected.
Unrelated generated image differences were discarded; relevant status captures
are retained. A local workerd scheduled invocation and signed functional records
also passed, followed by real production checks.

Committed source `2015380` was deployed to the public status project; its unchanged
public bytes also match the subsequent CORS source `b4b8c74`. The final Worker
version is `4ba60e6d-3552-403c-9769-8ebe1b7476d1`. Secrets, Durable Object binding,
route and five-minute schedule were preserved. Both documented public aliases
render eight operational components without refresh errors, with zero open
incidents. Private operations renders zero blockers; anonymous root and API
requests redirect to Vercel's authentication endpoint. Generated deployment
protection is retained. Historical incidents and actual evidence dates remain
visible. No additional email or upload was created for the status correction.

Functional evidence remains bounded to its actual check date. This release does
not automate future diagnostic emails or renew evidence without repeating checks.
