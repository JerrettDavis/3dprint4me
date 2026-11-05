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
- [x] Write and run failing unit tests for geometry-only builds, support separation and assembled bounds.
- [x] Add buildPresentationModel, explicit worker purpose and pumpkin/display-sign presentation placements.
- [x] Run geometry/worker tests; confirm downloadable bytes unchanged by preview.

### Task 2: Realistic viewer and UI
- [x] Add failing browser coverage for all generators, keyboard mode controls, reactive edits and same-origin/offline operation.
- [x] Add local studio lighting/materials/floor and accessible toggle; lazy presentation builds with stale/error guards.
- [x] Build/version assets, run focused browser checks and inspect rendered previews.

### Task 3: Verify and release
- [x] Update generator docs and exact reviewed handbook hashes.
- [x] Run npm test, screenshots, inspect preview board, handbook build/validation.
- [x] Independent whole-branch review and fix findings.
- Release tracking: [PR #68](https://github.com/JerrettDavis/3dprint4me/pull/68) records final CI, merge, deployment and live acceptance.

## Verification evidence

- Full local npm test: 1,286 unit tests; 455 browser tests passed with one existing Windows-only skip; 241/241 UX checks.
- Ten focused preview browser cases also pass with first entry into every realistic view offline after loading its Model view.
- 172 screenshots captured; preview board inspected as eight readable strips, plus full-size realistic desktop/mobile scenes.
- Local handbook build and 114-page link/asset validation pass; hosted handbook build (42039800134), four unit tests and two browser tests pass.
- Independent whole-branch review: no Critical or Important findings.
