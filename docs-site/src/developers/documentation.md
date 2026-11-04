# Maintain this handbook

## Source and public artifact

Handwritten guide pages live in `docs-site/src/`. Canonical technical documents, BDD flows and representative forms remain under `docs/`. `docs-site/publication-manifest.json` lists exact reviewed files, output paths and checksums (text normalizes CRLF to LF). New files are not published automatically; changed bytes fail the build until the manifest is reviewed and updated. `scripts/build-docs.py` selects these explicit public sources, stages them in ignored `.docs-source/`, rewrites links and builds MkDocs into ignored `public/handbook/`. The output is the only directory uploaded to GitHub Pages.

The selection excludes environment files, private packages, runtime code, raw run metadata and authenticated hosted screenshots. Illustrated guides use synthetic/redacted fixtures. Review every new screenshot visually before making it public. Public documentation is not a secure handoff for legal packages or customer records.

## Preview locally

```sh
python -m pip install -r requirements-docs.txt
npm run docs:build
npm run docs:check
python -m http.server 8088 --directory public
```

Open `http://127.0.0.1:8088/handbook/`. For the exact production subpath, serve the generated directory through a local `/3dprint4me/` mapping in the docs browser tests. Search is built locally; no analytics or remote font service is configured.

## Publish

The repository's GitHub Pages source is **GitHub Actions**. `.github/workflows/docs-pages.yml` builds on pushes to `docs-source` (and `main`) and declares manual dispatch for when the workflow is present on the default branch. Until then, publish by pushing the reviewed docs source. It uploads only `public/handbook` and deploys through the `github-pages` environment with `pages: write` and `id-token: write` scoped to the deployment job. The dedicated branch permits docs publication without merging unrelated application work into main. The `github-pages` environment explicitly allows the `main` and `docs-source` branches; its default main-only rule must include `docs-source` for this workflow to deploy.

After reviewing a docs commit, push the intended source to `docs-source`, watch the **Publish handbook** workflow, then verify the [public handbook](https://jerrettdavis.github.io/3dprint4me/), a nested guide, search and screenshot URLs. `build-info.json` identifies the source commit. Do not force-push over another maintainer's changes; fetch and inspect the branch first.

## Rollback and evolve

Revert the faulty docs commit on `docs-source` by pushing the reviewed revert. Manual dispatch is available once the workflow definition is present on the default branch. Wait for successful deployment and verify `build-info.json`. No database rollback is involved. When application work later reaches main, retain the workflow and documentation source there, then choose one authoritative publishing branch to avoid competing releases.

Add a new reference or screenshot to the publication manifest and the reference index; review its contents and update its checksum. Keep the form disclaimers and evidence environments accurate. Do not refresh static pass counts without an actual run.


## Screenshot pairs and proportions

Every illustrated guide step presents a real desktop capture at **1440 × 810 (16:9)** and a real phone capture at **390 × 520 (3:4)**. The pair sits side by side on wide screens and stacks on phones. Follow the labels; select either image to inspect its original resolution.

Regenerate the synthetic guide fixtures with `python scripts/capture-docs-guides.py` after installing the app/test dependencies and building the customizers. You can pass `work`, `owner`, `partner` or `reader_and_customizer` to refresh one group. Captures mask private input fields and never use real customer records. Review each resulting pair before updating its manifest checksum.

`scripts/docs_screenshots.py` formats the built HTML. Guide filenames must have matching `-desktop.png` and `-mobile.png` siblings. Native BDD originals retain their recorded bytes and viewport sizes; their 16:9 / 3:4 preview frames are explicitly labeled **excerpt** and link to the original capture. A repeated native viewport links to its original rather than repeating the comparison. Missing counterparts fail the build. Do not stretch screenshots or crop away required evidence from the originals.
