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
- Probe (single observation each, raw output not kept beyond this): 1 slot -> 69.22 g, 20913.55 s,
  224 changes, 23208.95 mm; 3 identical slots (`a;b;c` passed as one filament path) -> 69.22 g,
  20919.42 s, 224 changes, 23209.15 mm. Grams/changes identical, time differs by ~6 s, so slot count
  appears irrelevant. `colorSlots()` was therefore NOT added.
- Grams are above the solid-cube bound (3 x 5.83 cm3 x 1.24 g/cm3 = 21.7 g): 69.22 g includes
  prime-tower/flush purge for 224 changes. `purgeGrams` is not separated by the adapter, so the
  estimate is total filament consumed (what the customer is billed for), time ~5.8 h is dominated
  by changes.
- Implication for later tasks: multi-color estimates are expensive for tiny parts; the quote
  should expect large purge-driven grams/time. `options.colors` in site estimates is a number 1-4
  (domain.js `normalizeEstimateOptions`) and does not influence slicing; colors come from the 3MF.
- Note: the Dockerfile build context is the repo root (`.`), not `deploy/slicer-worker`;
  `scripts/slicer-smoke.mjs` is not copied into the image, so it is mounted at run time.

## Fixture provenance
Three 18 mm cubes at x offsets 0/20/40, colors #ff0000/#00ff00/#0000ff, written with the prototype's
`package3mf` (`../model-customizer-pages/src/three-mf.js`) via a one-off script (deleted after use).

## Exact commands run (Git Bash on Windows, `MSYS_NO_PATHCONV=1`, cwd = repo root)
```bash
docker build -f deploy/slicer-worker/Dockerfile.bambu -t 3dp-slicer-test .   # context = repo root
docker run --rm -v "$PWD/tests/fixtures/customize:/in:ro"   -v "$PWD/scripts/slicer-smoke.mjs:/app/scripts/slicer-smoke.mjs:ro"   --entrypoint node 3dp-slicer-test scripts/slicer-smoke.mjs /in/three-color-bambu.3mf 3 pla
```
No `-e` flags: all SLICER_* variables are the image defaults from Dockerfile.bambu (SLICER_PROVIDER=bambu-cli,
SLICER_BIN=/opt/slicer/AppRun, SLICER_MACHINE_PROFILE=/app/profiles/machine.json,
SLICER_PROCESS_PROFILE=/app/profiles/process.json, SLICER_FILAMENT_PROFILES pla=/app/profiles/filament-pla.json ...,
SLICER_BED_TYPE="Textured PEI Plate"). The smoke script args are `<model> <colors> <material>`; colors is
passed as the second positional arg (`3`) and becomes `options.colors`.
`profileId` `machine.json+process.json:pla` is the basenames of those two flattened presets plus the
material key; they were flattened at build time from "Bambu Lab X2D 0.4 nozzle" and
"0.16mm High Quality @BBL X2D", filament "Generic PLA @BBL X2D 0.4 nozzle" (filament-pla.json).
The 1-vs-3 slot probe ran `node --input-type=module -e` in the same image calling `createBambuCliSlicer`
directly with `filamentPaths: { pla: "<f>" }` vs `{ pla: "<f>;<f>;<f>" }`.
