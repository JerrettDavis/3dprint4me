# Blob transfer efficiency

The included 10 GB transfer allowance is already 75% consumed. The hourly recovery job currently downloads every private object before Restic deduplication. Reduce recurring transfer without reducing backup frequency, recovery completeness, privacy, or validation.

## Approach

Reuse validated bytes streamed from the last completed encrypted Restic checkpoint, matching the current paginated Blob inventory by pathname, size and provider ETag. Download new or changed objects only. Each new checkpoint remains a complete, independently restorable NDJSON stream and is copied and read back from both repositories. No plaintext files are persisted. The prior stream travels over existing pinned SSH; memory stays bounded per object. A missing prior checkpoint bootstraps normally; a corrupt or inaccessible selected checkpoint fails closed. Legacy records without ETags require one fresh download.

Alternatives considered: reducing backup frequency weakens recovery; CDN cache options still transfer full bodies; persistent plaintext caches weaken privacy. Conditional GET per object saves bytes but adds avoidable hourly operations; the provider list already exposes ETags.

The prior source must be a completed receipt in the same encrypted repository. Validate its metadata, stream hash, footer, object hashes and producer exit before claiming success. Current listing remains authoritative for deletion and required database references. Reject repeated cursors, duplicate objects, unsafe paths, oversized input and mismatched download identities. Never log customer bytes, paths, provider URLs or credentials.

Review remaining request/slicer reads separately; eliminate redundant reads where trusted server bytes already exist. Preserve server revalidation and all project invariants. No UI change is intended.

## Acceptance

- An unchanged second backup performs zero object GETs and still restores all files.
- New/changed/deleted files and legacy checkpoints produce correct complete snapshots.
- Corruption, incomplete streams, provider failures and missing referenced files cannot report success.
- Full project checks pass; changes merge green to main and deploy to the native runtime and copied scheduled controller, plus hosted components where applicable.
- Run two real backups and verify the second downloads zero unchanged bytes; retain dual-store readback evidence and deployment receipts.

Provider contract: https://vercel.com/docs/vercel-blob/using-blob-sdk (list ETags and private get); https://vercel.com/docs/vercel-blob/usage-and-pricing (transfer and operation accounting).
