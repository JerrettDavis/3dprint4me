# Native partner release implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline in the existing isolated worktree. Complete the running statement-health verification before changing its runtime source or committing that fix. One fresh read-only review after implementation.

**Goal:** Provide and verify an actual partner-aware native rehearsal/release path, so the new API can be staged and deployed with engagement disabled without reusing an inquiry-only migration/archive routine.

**Architecture:** Adapt the existing SSH-stdin/private-host release pattern. Separate the local committed-source archive builder from a testable host executor. Rehearsal uses disposable PostgreSQL and isolated API/probe containers; deployment applies only additive partner migrations and preserves unrelated service configuration, writer intent and immutable rollback evidence. No DNS, identity-provider, email-provider or payment-provider mutation is part of this tool.

**Tech stack:** Existing Python, Git archive, pinned SSH host trust, Docker Compose, native PostgreSQL, current Node image/runtime.

**Spec:** Private packet MASTER_PROMPT outcomes 8–10 and autonomy/approval policy; ops/DEPLOYMENT-DNS stages 0–5; existing docs/STACK-AUTOMATION.md and deploy/platform/release-inquiry.py. Private executed archive proof partner-release-path-gap.json establishes that the old archive lacks contracts/partner and its deploy phase applies only migration009. It is not the partner release path.

## Global constraints

- Production engagement remains PARTNER_PROGRAM_ENABLED=0, PARTNER_CLASSIFICATION_APPROVED=0 and PARTNER_ACCOUNTING_APPROVED=0 in API/jobs; existing enabled real engagement is a stop condition, not silently disabled.
- Existing GitHub owner subject/provider, customer intake/inquiry flag, payment/email credentials, proxy secret and native selection remain unchanged.
- Partner migration012+013 is additive and transactional with a bounded lock timeout. Never rerun the original Neon-to-native source-fence handover or restore over live data.
- Only reviewed committed files enter an archive. Include contracts/partner, package files, required runtime assets and the Docker build inputs. No local/private config or uncommitted source.
- SSH uses BatchMode and pinned host-key checking. Private values travel in stdin or owner-private files; never print credentials, raw child stderr or provider responses.
- Validate private-root ownership/modes, archive digest/size/regular members and contained paths; reject links/traversal/partial existing release directories.
- Stage0 owner source/trust-diagram approval and production DNS/identity/provider approval remain explicit packet gates. Prepare concrete executable handoff; do not infer an approval from elapsed time.
- Keep the full portal goal open while deployment or required acceptance is unverified. Actual counsel/CPA clearance is a separate launch gate; technical deployment is intentionally disabled.

## Files and interfaces

- deploy/platform/release-partner.py: local CLI, full40-hex commit validation, committed archive/host-executor retrieval, payload digest, pinned SSH invocation, sanitized aggregate output.
- deploy/platform/partner-release-host.py: private host preflight, source extraction/build, disposable native rehearsal, selected-native additive migration, guarded API/jobs rollout and bounded cleanup/failure evidence.
- scripts/rehearse-partner.mjs: synthetic native disabled-state/role/schema protocol smoke in the candidate image; no actual customer records or professional approvals.
- tests/unit/partner-release.test.mjs and focused Python support as needed: command/payload/flags/archive failure contracts and host-executor fake-runner tests.
- Existing Dockerfile: copy only the new rehearsal entry if needed; update exact runtime image verification file manifest accordingly.
- docs/PARTNER-DEPLOYMENT.md and docs/VERIFICATION.md: exact commands, tested source/image IDs, phase meanings, rollback limitations and owner actions.

## Review focus

- Shared PLATFORM_RELEASE selects API/jobs and slicer tags. A release must not leave a missing companion tag. Build candidate API and slicer companion tags from the committed source so shared release interpolation is valid; do not restart or recreate the running slicer merely to deploy the portal.
- A rehearsal must never change live env/source pointers, selected database, running writers, production rows, tunnel or provider credentials. Scratch DB is explicitly named/owned and dropped even on failure.
- Rollout preserves the existing native selected database and customer/inquiry data; every admission/readiness check occurs before exposing the replacement API.
- Jobs must not overlap or be enabled without the established writer handover. Compatible API/jobs releases are needed for statement heartbeat health.
- Failures retain additive partner data and private diagnostic references. No automatic destructive rollback or stale-source restore.

## Task 1: Complete committed archive and isolated native rehearsal

**Interfaces:** local build_payload(release: str, phase: str, repo: Path) -> dict validates committed inputs and produces release/phase/archive/archiveSha256; host run_release(config: dict, *, root: Path, runner) -> aggregate proof. Task2 consumes the verified private source directory, candidate image tags, selected native DB name and previous service/image identities; these stay host-side.

**Focused checks:** node --test tests/unit/partner-release.test.mjs; mocked local/host protocol cases must fail before implementation and pass afterward. Required cases: missing contracts, uncommitted source exclusion, invalid SHA/phase/host, unsafe archive/link, digest mismatch, partial release reuse, scratch cleanup after failure, disabled flags, secret-free argv/output, companion image tags and no live writer/service changes during rehearsal.

- [x] Add failing archive/argument/SSH/privacy contracts, including contracts required by Docker COPY and rejection of unreviewed/traversal/linked input.
- [x] Implement local CLI + host executor boundaries; default phase is explicitly rehearsal. Verify committed source and refuse partial source reuse.
- [x] Build candidate API and necessary companion image tags without changing running services or global selection. Record immutable IDs.
- [x] Create scratch native DB, apply the migration set and prove private partner tables/grants, disabled enrollment/new work, scoped session denials and current HTTP paths against actual candidate code. Rehearse healthy-origin overlap/drain in an isolated network.
- [x] Verify cleanup after success/failure, sanitized failures and no outgoing customer/provider messages. Test command shapes and actual local/disposable protocols.
- [x] Run appropriate full checks and image proof; commit a reviewed rehearsal-capable release source. Execute host rehearsal only after its committed inputs/tests are verified; retain redacted proof outside Git.

## Task 2: Disabled production rollout and executable owner handoff

**Interfaces:** deploy_release(verified_context, *, runner) -> aggregate stage proof; consumes Task1 verified artifacts and immutable prior image/service IDs. No private context is serialized to public proof.

**Focused checks:** node --test tests/unit/partner-release.test.mjs, plus disposable native rehearsal. Pin selected-native-only migrations012+013, 5-second migration lock timeout, all three flags0, unchanged existing auth/inquiry/provider env, guard ready before old API stop, no overlapping/newly enabled writers, no slicer/tunnel restart, and no destructive rollback on each injected failure boundary.

- [x] Implement explicit deploy phase with fresh verified backup/checkpoint precondition, exact selected-native database and all partner switches off. Preserve other env keys.
- [x] Apply012+013 atomically; stage guarded API readiness before draining old API; update/restart only previously enabled jobs with the same candidate. Preserve slicer/tunnel state.
- [x] Exercise injected failure boundaries and rollback instructions; preserve partner tables, accepted obligations and immutable documents on every path.
- [x] Add feature-off live smoke commands, existing-service checks and exact owner/source/DNS approval handoff. Do not claim the real production phase occurred from rehearsal or mocks.
- [x] Fresh final review and required checks; record CI/source/build evidence.
- [x] Execute the reviewed disabled production phase after owner approval; same-site TLS, actual existing GitHub owner authentication, exact static artifacts, API denials/CORS and existing workloads verified. See docs/PARTNER-PRODUCTION-RELEASE.md for identities, navigation fix and remaining independent operational boundaries.
