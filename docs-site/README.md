# Public handbook

**GitHub Pages:** https://jerrettdavis.github.io/3dprint4me/

The handbook contains getting-started instructions, illustrated customer/work/owner/partner/QA guides, troubleshooting, developer setup/testing/deployment guidance, the canonical technical reference, all 60 BDD flows and all 15 representative forms.

The strict build produces 113 HTML pages, 187 PNG assets (including the theme favicon), 60 BDD scenarios, 142 redacted BDD screenshots and 682 indexed search sections. Screenshots link directly to full-resolution images. Canonical forms remain unreviewed discussion stubs; QA does not enable real work or establish professional approval.

## Build and check

```sh
python -m pip install -r requirements-docs.txt
python scripts/build-docs.py
python scripts/validate-docs.py
python -m unittest tests.integration.test_docs_site
python -m pytest tests/integration/test_docs_site_browser.py -q
```

Browser checks additionally need the tooling in `requirements-dev.txt` and Playwright Chromium. On Windows, use the intended Python executable explicitly if a shell shim changes argument handling.

Only `public/handbook` is uploaded. `.docs-source` is temporary input staging. Both are ignored. Remove/move generated handbook output before running the storefront's separate static validation/build; do not include the handbook in a storefront release accidentally. The Pages workflow builds in a fresh checkout and never deploys the API or database.

## Publication and maintenance

`publication-manifest.json` lists every public input and destination with checksums. Text checksums normalize CRLF to LF. New files are not automatically published, and changed input bytes fail the build until explicitly reviewed and updated in the manifest. Hosted authenticated screenshots, raw evidence metadata, secrets and private review packages are excluded.

Push reviewed source changes to `docs-source`. The **Publish handbook** workflow builds, validates every local link/image/fragment, checks manifest enforcement, runs desktop/mobile browser tests and deploys through the `github-pages` environment. That environment permits `main` and `docs-source` only. Manual dispatch needs the workflow on the default branch; until then use a reviewed push/revert. Application changes are not merged into main by documentation publication.

The [online maintenance guide](https://jerrettdavis.github.io/3dprint4me/developers/documentation/) covers the workflow and rollback. `build-info.json` on the public site identifies the actual deployed source. [Verification artifacts](verification/) distinguish hosted observations from local screenshots. Screenshots named for the OS theme may show the opposite manual theme after the theme-switch check.

## Verified release

[Release record](verification/release.json): deployed source `e2ad432b895fcd64f12b769f274278663fbbc580`, [successful Pages workflow](https://github.com/JerrettDavis/3dprint4me/actions/runs/41772033083). All planned steps are complete. Hosted mobile/desktop navigation, search, themes, keyboard focus and screenshot loading passed; all 186 reviewed image byte checks passed. Fresh repository verification passed 1,277 unit/contract tests, 408 E2E tests (one existing Windows skip) and 241 UX checks. The 168-image matrix and preview board were regenerated and visually inspected.

The verification commit adds records outside the published input set; the site's build-info source remains the deployed commit above. Existing root screenshot/audit changes are intentionally unstaged. Test-generated differences in prior reviewed documentation fixtures were restored to their committed snapshot bytes; publishing changed fixtures requires a deliberate manifest update.
