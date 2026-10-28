# Native enrollment and access acceptance plan

**Goal:** Map all five partner-auth scenarios to real browser/API/native PostgreSQL evidence.
**Architecture:** Reuse the reviewed-program helper, retain transient synthetic invitation codes for replay tests, mount the actual owner-work API with actual cookie identity/store, and optionally seed one synthetic private work record. A boolean program-environment control lives only in the admitted disposable fixture file; the production HTTP/config surface is unchanged.
**Spec:** Private testing/features/partner-auth.feature and remaining acceptance audit.

- [x] Extend disposable fixture/helper for real owner-work positive controls and a narrowly scoped test-only program flag.
- [x] Execute initial enrollment/secure host cookie/no-GitHub, fresh-browser invite replay, live revocation, existing-other-partner earnings IDOR plus real owner-work auth denial, and environment-off enrollment denial with same-code recovery after reenabling.
- [x] Review and run native integration, full regression and screenshots; update acceptance map and evidence.
- [x] Commit, update draft PR and inspect hosted CI on the resulting head.

Authentication commit `5eaddab`; hosted run `40110565353` passed recovery, PostgreSQL
and 32 native cases and was running full regression when the gig increment followed.
This observation is not a claim that the remaining hosted steps passed.

Ruling: positive controls must prove a handler, record and invitation exist so 404/missing fixtures cannot masquerade as authorization. All tokens and records are synthetic and confined to disposable tests.
