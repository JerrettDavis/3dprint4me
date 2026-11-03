# Partner statement RLS correction

**Goal:** Restore the documented RLS invariant for weekly statement snapshots without changing API roles, records, immutability, or activation.

**Architecture:** Add migration 016, following migration 012's role-scoped backend policy. Wire it into native-only migration admission, committed archives and guarded rollout. Existing migration 013 remains byte-identical.

**Execution:** Inline in the existing linked worktree; no production schema changes during implementation.

- [x] Add a native regression that detects any partner table without RLS, plus a statement visitor granted SELECT who still sees no rows. Observe failure before implementation.
- [x] Add `016_partner_statement_rls.sql`, native target guard, and migration/rollout/archive fixtures.
- [x] Verify native permissions, concurrent statement generation and restore, migration targeting and release protocol tests. Update deployment/readiness documentation.
- [x] Run full regressions and required review before claiming the correction release-ready. Production application remains a separate guarded rollout with launch flags off.

Evidence: corrected full `npm test` passed 1,261 unit/contract, 383 browser (one platform skip) and 241 UX checks; native browser 59 passed; extended native upgrade/restore and schema rehearsal passed; archive images and isolated guarded rollout passed 205 continuity probes with zero failures. Both independent read-only reviews found no actionable issues. No production schema or activation changes were made.

Operational findings: three failed inherited `new_work` notifications need deliberate operator review; do not erase/requeue them as part of this schema repair. Current partner outbox and exports are empty, with no overdue export payloads. Healthy job heartbeats do not clear failed queue records.
