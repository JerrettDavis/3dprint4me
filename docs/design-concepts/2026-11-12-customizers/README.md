# Approved customizer studies

The user selected A, then requested several related decisions per section, illustrated selections instead of dropdowns, and polished final icons. `grouped.html` records the final wireframe direction; `index.html` retains the original three alternatives. These are illustrative prototypes and do not build or submit models.

To inspect the historical studies locally:

```powershell
python -m http.server 4287 --bind 127.0.0.1 --directory docs/design-concepts/2026-11-12-customizers
```

The implemented shared layout lives in `customizer/framework/studio-shell.js`, `studio-sections.js`, `option-art.js`, and `customizer/studio.css`. Unlike these static studies, the implementation uses the existing real geometry worker, validation, draft and request handoff. Pumpkin face/feature thumbnails derive from the actual geometry, and other choices use consistent local illustrations and swatches.

See `docs/superpowers/specs/2026-11-12-guided-customizer-design.md` and its implementation plan for the approved requirements and verification scope. These design artifacts are outside production static output.
