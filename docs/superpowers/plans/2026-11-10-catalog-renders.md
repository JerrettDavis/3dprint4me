# Reproducible catalog renders

**Goal:** Replace every customizer category image without a real photograph with a realistic render of its actual geometry, then land on main and deploy.

**Architecture:** An offline Node exporter invokes the existing Manifold builders and validates public recipe parameters. Blender Cycles renders the colored meshes with a shared procedural polymer material, studio softboxes, indirect lighting and contact shadows. Pillow creates optimized local WebP assets. Browsers continue to load static same-origin images.

**Constraints:** Preserve photographs, private uploads, sensitive-field rules, offline customizers, all service paths and accessibility. Rendering is a development tool; no Blender or remote rendering service enters production. Render inputs stay under ignored `.private/`.

- [x] Inventory catalog media and isolate work from unrelated edits.
- [x] Add checked-in recipes and export all eight categories through real builders.
- [x] Render and visually inspect every category; correct framing and surface shading.
- [x] Add repeatable image optimization and evidence manifest; update truthful alt text and provenance.
- [x] Add contracts for complete non-photographic coverage, safe recipes and generated output provenance.
- [ ] Run npm test, screenshots, inspect preview board, and review changes.
- [ ] Merge with passing hosted checks, deploy production, verify both catalogs and offline customizers live.

**Review focus:** flat thin products remain legible; curved products retain facets only where geometry specifies; camera crops no vertices; examples never serialize sensitive parameters; photographs stay intact; adding a generator without a render recipe fails the coverage contract.

Independent review caught and corrected a closed vase blank (now hollow) and missing input-source provenance (now checked against builders, defaults, local fonts and dependency pins). The one-command pipeline completed successfully. All 1,444 unit/contract checks, focused media/provenance checks, both historical upgrade regressions and 115-page handbook build/link validation pass. Full browser checks, refreshed final screenshots and hosted release gates remain pending.

The user explicitly requires fully green main even for unrelated failures. Main's missing historical QA archive pin was replaced by its reachable equivalent after confirming byte-identical service workers. Five stale handbook hashes were reconciled after reviewing the current documentation; publication still uses exact-file hashes and no allowlist bypass.
