# Blob transfer optimization evidence

## Measured cause

On November 25, a metadata-only read of the live private store returned six objects totaling 23,523,371 bytes, one listing page, and provider ETags for every object. No customer object was downloaded for this measurement. The installed scheduled task runs hourly. At unchanged size, its former full export would transfer 16,936,827,120 bytes over 30 days, exceeding the included 10 GB allowance by itself.

Restic deduplication happens after the provider download and therefore did not prevent that transfer. The revised exporter reuses SHA-256 validated bytes from the previous complete encrypted checkpoint when current listing identity matches. Unchanged backup object transfer becomes zero after the initial ETag backfill; new/changed files still transfer. Listing operations, local Restic I/O and pinned SSH traffic remain.

## Verification so far

- Independent exporter/ZIP/cache review: no blockers; 24 focused Node tests passed.
- Independent controller review: no blockers; nine focused Python tests passed.
- Actual pinned Restic 0.19.1 rehearsal with synthetic objects: first checkpoint three GETs; unchanged checkpoint zero GETs; changed/new/deleted checkpoint two GETs. Each complete stream was encrypted, copied to the second repository, decrypted and hash checked. A damaged newest receipt failed closed.

Production rollout and final CI evidence will be recorded after verification. No customer bytes, object paths or credentials belong in this record.
