# Bambu Studio / OrcaSlicer user presets (optional)

`Dockerfile.bambu` flattens the presets it slices with at build time. By default it uses the
**vendor presets bundled with the pinned Bambu Studio release**, matching the owner's current
Bambu Studio selection:

| Role | Preset |
|------|--------|
| Printer | `Bambu Lab X2D 0.4 nozzle` |
| Process | `0.16mm High Quality @BBL X2D` |
| PLA / PETG / ASA / TPU | `Generic <material> @BBL X2D 0.4 nozzle` |

Other names from the same release can be passed with `--build-arg SLICER_MACHINE_PRESET=...`,
`SLICER_PROCESS_PRESET`, `SLICER_FILAMENT_PLA|PETG|ASA|TPU`.

To slice with a **customized user preset** instead, copy its `.json` (never the `.info`
sidecar) from `%APPDATA%\BambuStudio\user\<account id>\{machine,process,filament}\` (or
`%APPDATA%\OrcaSlicer\user\...`) into this directory and pass its in-image path, for example
`--build-arg SLICER_PROCESS_PRESET="/build/user-presets/My Process.json"`. User presets only
store overrides plus `inherits`; the build resolves the parent from the bundled vendor
profiles, so the parent must exist in the pinned release.

Before committing a preset, open it and check it holds slicing settings only. The flattener
drops LAN/account keys (`print_host`, `printhost_apikey`, `printhost_*`, `user_id`,
`setting_id`, `base_id`, `updated_time`, `sync_info`), but machine presets commonly contain
`print_host` with a LAN address, so strip it from the copy you commit as well. Never copy
`BambuNetworkEngine.conf`, `BambuStudio.conf`, `OrcaSlicer.conf`, or anything outside the
preset folders: those hold account tokens.

Bump `SLICER_PROFILE_ID` in `.env.worker` whenever the selection changes; it is recorded on
every estimate (the worker appends `:<material>` when a material-specific filament is used).
