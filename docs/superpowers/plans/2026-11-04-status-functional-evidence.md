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
