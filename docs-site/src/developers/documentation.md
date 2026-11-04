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

The repository's GitHub Pages source is **GitHub Actions**. `.github/workflows/docs-pages.yml` builds on pushes to `docs-source` (and `main`) and supports manual dispatch. It uploads only `public/handbook` and deploys through the `github-pages` environment with `pages: write` and `id-token: write` scoped to the deployment job. The dedicated branch permits docs publication without merging unrelated application work into main. The `github-pages` environment explicitly allows the `main` and `docs-source` branches; its default main-only rule must include `docs-source` for this workflow to deploy.

After reviewing a docs commit, push the intended source to `docs-source`, watch the **Publish handbook** workflow, then verify the [public handbook](https://jerrettdavis.github.io/3dprint4me/), a nested guide, search and screenshot URLs. `build-info.json` identifies the source commit. Do not force-push over another maintainer's changes; fetch and inspect the branch first.

## Rollback and evolve

Revert the faulty docs commit on `docs-source` or dispatch the workflow on a known reviewed source. Wait for successful deployment and verify `build-info.json`. No database rollback is involved. When application work later reaches main, retain the workflow and documentation source there, then choose one authoritative publishing branch to avoid competing releases.

Add a new reference or screenshot to the publication manifest and the reference index; review its contents and update its checksum. Keep the form disclaimers and evidence environments accurate. Do not refresh static pass counts without an actual run.
