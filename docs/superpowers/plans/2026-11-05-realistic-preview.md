# Realistic Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Toggle each configured product between editing and realistic local presentation.
**Architecture:** Extend existing Three.js viewer; use geometry-only presentation worker requests for assembled pumpkin/display sign. Printable output remains authoritative and separate.
**Tech Stack:** Three.js 0.170, Manifold, Vite, existing JavaScript and pytest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-05-realistic-preview-design.md

## Global Constraints
- No remote customizer requests or raw sensitive values outside browser memory.
- No presentation file in download, hand-off or metadata.
- Preserve themes, keyboard, reduced motion, 390px and offline operation.

## Review Focus
- Fast edits and mode switches must not display stale presentation geometry.
- Presentation failures must not disable print download or request.
- Pumpkin face supports stay in printable geometry but disappear in presentation.
- Loose stems/lids/sign holders assemble correctly.
- WebGL failure keeps normal recovery and request available.

### Task 1: Geometry-only presentation boundary
- [ ] Write and run failing unit tests for geometry-only builds, support separation and assembled bounds.
- [ ] Add buildPresentationModel, explicit worker purpose and pumpkin/display-sign presentation placements.
- [ ] Run geometry/worker tests; confirm downloadable bytes unchanged by preview.

### Task 2: Realistic viewer and UI
- [ ] Add failing browser coverage for all generators, keyboard mode controls, reactive edits and same-origin/offline operation.
- [ ] Add local studio lighting/materials/floor and accessible toggle; lazy presentation builds with stale/error guards.
- [ ] Build/version assets, run focused browser checks and inspect rendered previews.

### Task 3: Verify and release
- [ ] Update generator docs and exact reviewed handbook hashes.
- [ ] Run npm test, screenshots, inspect preview board, handbook build/validation.
- [ ] Independent whole-branch review and fix findings.
- [ ] Commit, PR, wait green, merge/deploy and verify live toggles.
