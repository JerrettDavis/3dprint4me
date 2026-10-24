# Owner weekly and program spend forecast plan

Implements packet O-18 and supports O-05 without inventing future gigs/conversion rates.
The forecast is an upper bound on recorded accepted commitments: verified net spend,
unpaid obligations, accepted fees without payables and still-unearned bonus maxima.
Unaccepted offers are separate, nonbinding. Amounts remain attached to the original
Central authorization week; lower caps and sunset never erase debt. Gifts are excluded.

- [x] RED unit/contract coverage for no double counting, original week, cancellation,
  cap reductions, unfunded adjustments, incomplete evidence and owner-only access.
- [x] Pure integer-cent projection plus bounded native reads under ordered program
  shared locks, using existing immutable records; no migration or write command.
- [x] Owner-only Forecasts view with program selection, assumptions and separate
  weekly totals. Preserve owner expiry/route guards, escaping and mobile access.
- [x] Native lifecycle/role proof; focused frontend tests, full regression and visual
  capture/inspection. Review code, update contracts/docs and build restricted API image.
- [ ] Commit/PR and deployment evidence. Actual native production rollout remains separate.

Chosen implementation: deterministic exposure bounds, not assumed future sales or a
promise of earnings. A payment, payable and reserved fee must never be added twice.
