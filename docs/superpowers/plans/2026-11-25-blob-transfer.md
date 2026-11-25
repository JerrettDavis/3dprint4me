# Blob Transfer Implementation Plan

> **For agentic workers:** Use test-driven development and independent review. User authorized review, delegation, optimization and deployment green on main.

**Goal:** Remove repeated private Blob downloads while preserving complete encrypted recovery and secure model validation.

**Architecture:** A fresh inventory reconciles validated prior encrypted checkpoint records. Complete output remains compatible with existing restore commands. Controller streams prior bytes without plaintext disk storage.

**Spec:** ../specs/2026-11-25-blob-transfer-design.md

## Tasks

- [x] Add failing regression tests then implement ETag-aware streaming reconciliation in lib/platform/blob-recovery.js and scripts/blob-recovery.mjs. Cover unchanged/new/changed/deleted, legacy, bounds, corruption, missing references and provider identity races.
- [x] Add failing controller tests then implement prior complete receipt selection, bounded stdin streaming, source digest/exit verification and failure propagation in deploy/platform/backup-controller.py. Preserve dual-store copy/readback. Update operations docs.
- [x] Remove redundant ZIP child analysis download using existing server-trusted bytes; test the provider read count and unchanged validation. Add bounded, verified worker-memory reuse for local slicer retries and option changes.
- [ ] Run npm test, independent whole-change review and any meaningful runtime rehearsals. No screenshots required unless visible behavior changes.
- [ ] Commit, push PR, pass CI, merge to main, deploy exact main native release and controller copy, verify two real complete backups with zero unchanged object downloads on second. Check hosted production where applicable and record evidence.

## Constraints and risks

No secrets or customer files in static output or logs. No plaintext cache files. Corrupt prior data fails closed. Keep backups hourly. Bound each object and record; do not accumulate all store bytes. Legacy migration may require one complete download. Listing metadata is not a byte-integrity substitute: validate reused records against SHA-256. Retention applies only to live listing; prior snapshots remain historical recovery.
