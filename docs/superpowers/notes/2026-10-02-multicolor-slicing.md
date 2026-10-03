# Multi-color slicing check (Task 0)

Fixture: `tests/fixtures/customize/three-color-bambu.3mf` (14,193 bytes), three touching 18 mm cubes
(red/green/blue) written by the prototype's Bambu exporter.
Image: `deploy/slicer-worker/Dockerfile.bambu` built from the repo root (Bambu Studio 02.08.04.57,
X2D 0.4 nozzle, 0.16mm High Quality, Generic PLA). Smoke: `scripts/slicer-smoke.mjs <3mf> 3 pla`.

## Result: success, no adapter change needed

```json
{ "engine": "bambu-studio-cli", "engineVersion": "02.08.04.57", "profileId": "machine.json+process.json:pla",
  "elapsedSeconds": 20917.43, "materialGrams": 69.22, "materialMm": 23209.09,
  "purgeGrams": null, "supportGrams": null, "toolChanges": 224, "layerCount": 112, "warnings": [] }
```

- Exit was clean (return_code 0), `toolChanges` = 224 (> 0), so the CLI honours the 3MF's per-object
  filament assignments with only one `--load-filaments` entry.
- Loading 3 identical filament slots (`a;b;c`) vs 1 slot gave the same result (69.22 g, 224 changes,
  ~20,915 s), so slot count is irrelevant. `colorSlots()` was therefore NOT added.
- Grams are above the solid-cube bound (3 x 5.83 cm3 x 1.24 g/cm3 = 21.7 g): 69.22 g includes
  prime-tower/flush purge for 224 changes. `purgeGrams` is not separated by the adapter, so the
  estimate is total filament consumed (what the customer is billed for), time ~5.8 h is dominated
  by changes.
- Implication for later tasks: multi-color estimates are expensive for tiny parts; the quote
  should expect large purge-driven grams/time. `options.colors` in site estimates is a number 1-4
  (domain.js `normalizeEstimateOptions`) and does not influence slicing; colors come from the 3MF.
- Note: the Dockerfile build context is the repo root (`.`), not `deploy/slicer-worker`;
  `scripts/slicer-smoke.mjs` is not copied into the image, so it is mounted at run time.
