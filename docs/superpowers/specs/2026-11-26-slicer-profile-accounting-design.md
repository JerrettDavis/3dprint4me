# Profile-aware slicing and production accounting

## Intent
Make estimates reflect the printer, material and quality profiles used in production, including automatic overhang supports, tool changes and material wasted during color changes. Preserve private uploads, bounded provider failures and non-binding recoverable estimates.

## Review evidence
- The Prusa fallback profile is explicitly a placeholder and sets support_material = 0.
- Bambu presets already support flattening vendor inheritance and sanitized user exports; the documented production selection is X2D 0.4 nozzle with 0.16 mm High Quality.
- The Bambu adapter selects a single material filament, does not apply quality/support options, returns null support/purge quantities and defaults absent tool-change metadata to zero.
- The job runner prices total slicer material and time, but the public projection describes the requested support assumption rather than verified slicing behavior.
- Main at review: 65485c90. This branch is isolated from unrelated uncommitted storefront changes.

## Approach
Use the existing provider boundaries and pinned vendor presets. Resolve actual machine/process/filament settings, apply bounded job-specific quality and automatic tree-support policy, and record a reproducible profile identity. Let the slicer determine which overhangs require support in the submitted orientation. Geometry-only analysis remains a planning estimate and must describe uncertainty honestly.

Alternatives considered: fixed percentage allowances alone cannot establish actual overhang support or swaps; importing arbitrary uploaded project settings introduces untrusted machine configuration and cannot establish the shop profile. Neither satisfies the objective. Preserve model geometry and supported material assignments while overriding machine/process settings with trusted shop settings.

## Required behavior
1. Resolve trusted physical printer, quality and material profiles; reject unsupported combinations instead of silently using a different material. Placeholder profiles cannot masquerade as calibrated production profiles.
2. Automatic tree supports must be enabled for overhang detection, with explicit support policy and orientation recorded. A customer selecting no supports cannot silently suppress needed support in an allegedly production-aware estimate.
3. Detect multi-material/color assignments in 3MF and facilitate their mapping to available filament slots. Preserve usable assignments; report unresolved mapping and require review rather than produce a misleading single-color slice. A color count alone cannot determine swap count.
4. Include full measured time and material, including support, tower, flushing and other extrusions. Record measured component quantities and swap counts where supported; keep unavailable measurements unknown. Define whether total includes each component and avoid double counting.
5. Surface verified profile/support/color assumptions and unresolved production requirements to customers and operators. Retain safe fallback estimates during slicer outages.
6. Preserve all repository privacy, offline-customizer, intake and accessibility invariants.

## Implementation and verification plan
- Inspect deployed worker configuration, pinned slicer CLI/source contracts, available sanitized profiles and existing test fixtures before selecting flags or parsing output fields.
- Add regression tests for profile selection, support settings, preserved/unsupported 3MF color mapping, unknown versus zero accounting, total-material semantics, bounded output and safe provider failures.
- Implement provider configuration and parsing, then carry production evidence through immutable snapshots and public/operator projections.
- Add real-slicer fixtures/rehearsals: flat part, unsupported overhang, two-color layer transition and repeated multicolor swaps. Compare support-on/off and verify totals include support/purge/tower. Use installed slicer or container without exposing worker credentials.
- Update operational/profile documentation and estimate UI guidance. Run npm test and required validation; run screenshots and inspect screenshots/preview-board.png for visible changes.
- Review final diff, open PR, resolve checks and review findings, merge only green, and verify main checks. Do not claim production profile calibration without evidence.

## Open evidence to gather
Actual worker profile artifacts and release/version, authoritative Bambu/Orca waste fields and CLI material assignment behavior, Prusa organic support compatibility, and how operator review currently represents multicolor requirements. These are implementation investigations, not reasons to reduce the requested scope.
