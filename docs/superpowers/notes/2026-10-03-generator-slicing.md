# Slicer verification of real generator output (spec "Slicing" step 1)

Branch `feat/generator-section` at `df25c89`. Every generator's real output (real `buildModel`: Manifold
`simplify(1e-6)`, real inlays/text/QR relief, Bambu `package3mf`) was sliced in the Bambu Studio CLI
worker image (Bambu Studio 02.08.04.57, X2D 0.4 nozzle, 0.16mm High Quality, Generic PLA, image
defaults for every `SLICER_*` variable). Earlier only the synthetic 3-cube fixture had been sliced
(`2026-10-02-multicolor-slicing.md`).

## Result: all 21 files sliced successfully, no SliceError, no warnings

| File | Format / preset | Parts | Colors (= arg) | Volume mm3 | Solid bound g | Grams | Print s (min) | Tool changes | Layers | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| route-shield-default | default | 6 | 4 | 26902.6 | 33.36 | 27.37 | 6826 (114) | 25 | 36 | ok |
| route-shield-preset-default | preset `default` (same bytes as default) | 6 | 4 | 26902.6 | 33.36 | 27.37 | 6834 (114) | 25 | 36 | ok |
| route-shield-preset-small-66 | preset `small-66` | 6 | 4 | 11530.3 | 14.30 | 16.48 | 4838 (81) | 25 | 36 | ok |
| rating-card-default | default (toilet, 3.5, "Would poop here again") | 5 | 5 | 4967.2 | 6.16 | 8.31 | 2135 (36) | 13 | 10 | ok |
| rating-card-canonical | toilet / 3.5 / caption (same bytes as default) | 5 | 5 | 4967.2 | 6.16 | 8.31 | 2135 (36) | 13 | 10 | ok |
| rating-card-preset-toilet | preset `toilet` (same bytes as default) | 5 | 5 | 4967.2 | 6.16 | 8.31 | 2135 (36) | 13 | 10 | ok |
| rating-card-preset-heart | preset `heart` | 5 | 5 | 5012.8 | 6.22 | 8.38 | 2098 (35) | 13 | 10 | ok |
| rating-card-preset-house | preset `house` | 5 | 5 | 5012.6 | 6.22 | 8.37 | 2125 (35) | 13 | 10 | ok |
| rating-card-preset-mug | preset `mug` | 5 | 5 | 4992.0 | 6.19 | 8.35 | 2106 (35) | 13 | 10 | ok |
| rating-card-preset-dark | preset `dark` | 5 | 5 | 4967.2 | 6.16 | 8.46 | 2145 (36) | 13 | 10 | ok |
| name-plate-default | default (block font, "Alex") | 2 | 2 | 6428.3 | 7.97 | 7.71 | 1535 (26) | 1 | 18 | ok |
| name-plate-preset-keychain | preset `keychain` | 2 | 2 | 2099.8 | 2.60 | 2.99 | 1064 (18) | 1 | 18 | ok |
| name-plate-preset-desk | preset `desk` | 2 | 2 | 11876.2 | 14.73 | 11.36 | 2168 (36) | 1 | 25 | ok |
| name-plate-preset-door | preset `door` (pill, shadow) | 3 | 3 | 24317.1 | 30.15 | 23.90 | 4104 (68) | 6 | 25 | ok |
| name-plate-pacifico-keychain | Pacifico, "Mary Ann", `keychain_loop: true` | 2 | 2 | 5917.5 | 7.34 | 7.41 | 1437 (24) | 1 | 18 | ok |
| wifi-tag-placard-guest | placard, ssid "Guest Network", canary pw | 3 | 2 | 32358.4 | 40.12 | 30.44 | 6574 (110) | 6 | 18 | ok |
| wifi-tag-keychain-guest | keychain (`hole: true`, `show_text: false`) | 2 | 2 | 8259.6 | 10.24 | 9.25 | 2822 (47) | 6 | 18 | ok |
| wifi-tag-card-guest | card | 3 | 2 | 13825.6 | 17.14 | 14.16 | 3695 (62) | 6 | 18 | ok |
| wifi-tag-preset-placard | preset `placard` (ssid "Guest WiFi", canary pw) | 3 | 2 | 32358.4 | 40.12 | 30.46 | 6622 (110) | 6 | 18 | ok |
| wifi-tag-preset-keychain | preset `keychain` | 2 | 2 | 8259.6 | 10.24 | 9.25 | 2843 (47) | 6 | 18 | ok |
| wifi-tag-preset-card | preset `card` | 3 | 2 | 13825.6 | 17.14 | 14.15 | 3723 (62) | 6 | 18 | ok |

File sizes (bytes): route-shield 113,110 / small-66 112,866; rating-card toilet/dark 69,309-69,326,
heart 40,738, house 40,861, mug 52,037; name-plate default 18,646, keychain 36,565, desk 18,609,
door 45,096, Pacifico 171,239; wifi placard 86,939-88,845, keychain 74,970-78,930, card 86,375-88,179.

- "Volume" is `volumeMm3` from the site analyzer (`analyzeModelBytes`); "Solid bound" = volume x
  1.24 g/cm3 PLA. "Print s" is the slicer's predicted print time (`elapsedSeconds`), not wall time;
  each slice took 1-2 s of wall time. No run came close to the 300 s slicer timeout.
- The colors argument (2nd positional) was the model's unique color count in every run. The
  rating-card default/canonical has 5 unique colors (the maximum).
- `rating-card-default`, `-canonical` and `-preset-toilet` are byte-identical (sha256 `295f0a6da8cd...`),
  as are `route-shield-default` and `-preset-default` (`e6b209047bc4...`); all were sliced anyway.
- The canary password `correct-horse-battery` appears in none of the six Wi-Fi 3MFs (all inflated
  entries searched).
- `purgeGrams` / `supportGrams` were `null` and `warnings` `[]` in every result.

## Judgement

- **No failures**: no `unsupported` (-50/-52), `unavailable` (-61) or `slicer_failed`. The real
  simplified meshes, inlays, text and QR relief are accepted as-is.
- **Grams are sane**: 0.76x-1.37x the solid bound; nothing near 3x, nothing 0 g. Thick single-ish
  color models (placard, desk, door, route-shield) land under the bound because infill is sparse;
  the thin multi-color cards land above it, which is purge. Rough purge per change for the cards:
  (8.31 - 6.16) / 13 = 0.17 g; real purge is higher than that, because the infilled part weighs less
  than the solid bound. That fits the 3-cube fixture (about 0.21 g per change).
- **Tool changes are plausible for flat inlays**: 1 for a raised 2-color name plate (one switch to the
  letter color for the top layers), 6 for Wi-Fi tags (about one per 0.16 mm layer of the 1 mm QR
  inlay), 6 for the 3-color door plate, 13 for a 5-color rating card, 25 for the 4-color route shield.
  Nothing close to the fixture's 224 (whose 3 colors ran the full 18 mm height). Purge does not dominate
  the price of any generator output.
- **Times are plausible, not absurd**: rating card about 35 min, name plates 18-68 min, Wi-Fi tags
  47-110 min, route shield 81-114 min. The longest are the largest-volume flat plates
  (placard 90 x 120 mm, route shield).

## Things that affect customer estimates

- A 5-color rating card costs about 35 % more filament than its solid volume suggests and about 36 min of
  print time: small, but the quote should come from the slicer, not from volume alone.
- The Wi-Fi placard and the full-size route shield come in at about 1.8-1.9 h and about 27-30 g.
  Customers may not expect that for a sign.
- `options.colors` does not change slicing (colors come from the 3MF); passing the unique count is
  only informational.
- Only PLA with the image's default profiles was checked.

## Exact commands (Git Bash on Windows, `MSYS_NO_PATHCONV=1`)

Export: a throwaway Node script outside the repo (deleted afterwards). It imported the repo's
`customizer/framework/{engine,model}.js`, `customizer/generators/index.js`,
`public/assets/js/customize/{registry,schema,fonts}.js` and `print-estimation/geometry.js` via
`file://` URLs. It applied each preset like `tests/unit/customize-all-generators.test.mjs` does
(`validateParams(g, clampParams(g, {...defaults, ...preset}))`). Then it ran the real `buildModel`
with `loadEngine()` WASM (Pacifico parsed with opentype.js from `customizer/static/fonts/`), wrote
each `.3mf`, and recorded parts, unique colors and analyzer volume.

```bash
docker build -f deploy/slicer-worker/Dockerfile.bambu -t 3dp-slicer-verify .   # cwd = repo root
# per file, sequentially, colors = the model's unique color count:
docker run --rm -v "$OUT:/in:ro" -v "$REPO/scripts/slicer-smoke.mjs:/app/scripts/slicer-smoke.mjs:ro" \
  --entrypoint node 3dp-slicer-verify scripts/slicer-smoke.mjs "/in/<file>.3mf" <colors> pla
docker rmi 3dp-slicer-verify
```
