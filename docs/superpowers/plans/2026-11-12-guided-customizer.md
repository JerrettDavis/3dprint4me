# Guided Customizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement approved A across all ten generators with grouped sections, visual choices and a stable dominant preview.

**Architecture:** Keep existing form nodes and engine state authoritative. Add presentation-only section mapping, a shared navigation shell, and accurate same-origin option art; replace window overlay layout with a normal-flow preview and one editing region.

**Tech Stack:** Existing JavaScript modules, Vite, CSS, Node tests and Python/Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-guided-customizer-design.md`

## Global Constraints

- Only `public/` is static output; all customizer assets remain same-origin.
- No parameter, geometry, draft, export, provenance or handoff semantic changes.
- Sensitive fields never enter review, persisted UI preferences or option assets.
- Preserve light/dark/system, keyboard focus, reduced motion and 375/390px behavior.
- No merge/deploy; no added dependencies.

## Review Focus

- Switching sections while an edit settles retains its value, pending build and attachment state.
- A validation error in a different or advanced section remains reachable.
- Presets, Undo and reset update every visual selection without resetting unrelated values.
- Sensitive text stays live only and is absent from review/markup/persistence.
- Large schemas, text scaling and small viewports do not hide actions or overflow.

### Task 1: Grouping and truthful visual options

**Files:** create `customizer/framework/studio-sections.js`, `customizer/framework/option-art.js`; modify `customizer/framework/form.js`, `customizer/framework/explore-ui.js`; test `tests/unit/customize-studio.test.mjs` and `tests/unit/customize-form.test.mjs`.

**Interfaces:** `editingSections(generator)` returns `{key,label,keys}[]` covering every field exactly once; `optionArt(generatorId,key,value,params)` returns trusted SVG/image markup; form exposes `setEditingSection(key|null)` and calls `onPresentationChange` after visibility/value/error changes.

- [x] Write and run failing tests for mapping all registered schemas, art/escaping, visual selections and private review.
- [x] Implement pure mapping/art, accessible visual controls through existing native events, and preset imagery/fallbacks.
- [x] Run focused unit tests, confirm no geometry/schema modifications.

### Task 2: Shared guided shell and responsive layout

**Files:** create `customizer/framework/studio-shell.js`, `customizer/studio.css`; modify `customizer/framework/app.js`, `customizer/framework/form.js`, `customizer/styles.css`, `customizer/framework/windows.js` if needed.

**Interfaces:** `mountStudio({generator,form,root,getParams})` wraps existing settings/facts DOM, provides direct navigation, all-settings and review, and updates safe summary; form callback connects state/visibility without engine ownership. Viewer insets are zero because its stage never overlaps controls.

- [x] Add failing browser tests for guided default, no overlapping panels, keyboard visual selection, preserved state and safe review.
- [x] Implement normal-flow desktop/mobile shell, contextual form sections, review and advanced/error routing. Keep existing camera/view/export/request hooks.
- [x] Test all ten initial builds, 390px themes, selection changes and invalid/error recovery; inspect pilot screenshots.

### Task 3: Family regressions, documentation and release artifacts

**Files:** modify relevant tests in `tests/e2e/test_customize.py`, `scripts/capture_screenshots.py`, `docs/GENERATORS.md`; generated `public/customize/**`, versioned asset references, screenshots.

- [x] Update old window-layout assertions to the approved layout; explicitly select All settings for full-form engine regression scenarios. Add guided workflow coverage so this cannot hide broken navigation.
- [x] Run `npm run customizer:build && npm run assets:version`, then `npm test`; address failures with reproductions.
- [x] Run `npm run screenshots`, inspect the board and desktop/mobile theme samples; document results/limitations.
- [x] Obtain whole-branch review, resolve important findings, commit the reviewable implementation and report evidence without merging/deploying.

## Final verification (November 13)

The full test run passed 1,548 unit/contract checks and 560 browser cases, with seven capability skips. Its final audit caught the preview hint contrast; after the CSS fix, the rebuilt assets passed static validation, all 21 focused guided cases, and all 289 UX audit checks. No engine, schema, provider, backend, dependency or deployment changes were required.

The complete 236-capture screenshot run was followed by a final refresh of 71 customizer and 12 catalogue views. The actual contact sheet and desktop/mobile samples were visually inspected. Handbook build and links passed for 115 pages and 711 search entries.

Final regressions also cover dense display-sign editing without extra navigation steps, preset Browse/Undo/private intake, and catalogue Review retaining its Change settings shortcut and separate customer draft. Merge and deployment are not part of this implementation.

The hint bounds regression reproduced inherited overlay offsets on pumpkin and fidget at 1280px. Explicit normal-flow preview bounds keep the hint to one readable line; all 21 guided checks and the 289-check audit passed again after that final CSS correction. A final desktop-only capture refresh preserves the unchanged mobile captures.

## Loading feedback refinement (November 13)

Continue the approved studio with truthful feedback for first builds, rebuilding after edits,
and preparing Model/Realistic previews. Keep the previous view visibly stale during updates,
retain editing, and distinguish print-file readiness from presentation readiness. Explain long
waits after eight seconds without inventing progress percentages. Preserve retry, validation,
private parameters, same-origin operation, accessible announcements and reduced motion.

The shared feedback card receives presentation state only, never customer parameters. Its
polite live region sits outside the busy preview. Navigation hints are hidden while it is
visible. A fresh review caught default Model mode clearing loading before lazy viewer startup;
a delayed-import regression reproduced this and the phase now lasts through `setParts()`.
Focused browser checks cover delayed/rapid edits, preview preparation, worker failure/retry,
unavailable WebGL and reduced motion. Unit checks cover truthful copy and long-wait/reset timing.
Six reproducible desktop/light and 390px/dark loading captures are part of the screenshot suite.
The final `npm test` passed 1,552 unit/contract checks, 564 browser cases with seven
capability skips, and all 289 UX audit checks. The handbook build and link checks passed
for 115 pages and 711 search entries. The final fresh canonical screenshot run captured
242 images; the actual preview board and all six viewport loading captures were visually
inspected. Earlier refreshes encountered intermittent local owner-portal asset transport
failures; all 39 owner states passed two isolated diagnostic runs and the final complete
capture passed without transport failures. No production workaround or retry was added.
The implementation remains a reviewable branch, without merge or deployment.
