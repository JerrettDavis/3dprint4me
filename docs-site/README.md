# Public handbook

**GitHub Pages:** https://jerrettdavis.github.io/3dprint4me/

The handbook contains getting-started instructions, illustrated customer/work/owner/partner/QA guides, troubleshooting, developer setup/testing/deployment guidance, the canonical technical reference, all 60 BDD flows and all 15 representative forms.

The strict build produces 113 HTML pages, 183 PNG assets (including the theme favicon), 60 BDD scenarios, 142 redacted BDD screenshots and 683 indexed search sections. Twenty guide states have paired desktop 16:9 and phone 3:4 captures (40 guide screenshots); 142 original native screenshots remain available through bounded, labeled excerpts. Screenshots link directly to full-resolution images. Canonical forms remain unreviewed discussion stubs; QA does not enable real work or establish professional approval.

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

Pages deployment has a ten-minute action deadline inside a fifteen-minute job
limit. `actions/deploy-pages@v5` caps `timeout` at 600000 milliseconds; larger
values are ignored with a warning. Increasing the job limit cannot extend it.
If deployment stalls in `updating_pages`, inspect its status and GitHub Pages
service health before rerunning the failed deploy job against the existing
validated artifact. Keep the deployment failure visible; do not mark an accepted
deployment as successful or skip its completion check. On November 4, run
41893096715 timed out, then its failed-job rerun published the same build version
in five seconds. A successful build or accepted deployment does not prove
publication: verify the public `build-info.json` source and reviewed image hashes
after deployment completes.

## November 3 verified screenshot revision

[Release record](verification/release.json): deployed source `d97f68dace547c4d66551c4af804eb9b2eb102e2`, [successful Pages workflow](https://github.com/JerrettDavis/3dprint4me/actions/runs/41777149454). All 20 guide states have real desktop 1440 × 810 and phone 390 × 520 captures. The site presents 94 paired comparisons, side by side on wide screens and stacked on phones. Native BDD previews are bounded and labeled excerpts; their 142 original PNGs remain unchanged.

Three docs contracts and two browser cases passed locally and in CI. Live checks passed at both widths, including frame geometry, keyboard focus, search, themes and image loading; all 182 reviewed image byte checks passed. Fresh repository verification passed 1,277 unit/contract tests, 408 E2E tests (one existing Windows skip) and 241 UX checks. The 168-image matrix and preview board were regenerated and visually inspected. The new 40-image guide contact sheet and hosted comparison layouts were also inspected.

This verification commit adds records outside the published input set; the site's build-info source remains the deployed commit above. Existing root screenshot/audit changes remain unstaged. Test-generated changes in older reviewed documentation fixtures were restored to their committed snapshot bytes.

## November 4 workspace evidence refresh

The grouped workspace release refreshes all 40 guide captures and 142 redacted native BDD captures. All 60 native workflows pass with source/run/JUnit-bound provenance on `6d055960afc4a47b407e28d791ab5a87023f61e8` (run `workspace-release-20261104-05`). Evidence validation passes, and both the 168-image preview board and the new native screenshot contact sheet were visually inspected. The production operator and participant files match committed static source `6d055960afc4a47b407e28d791ab5a87023f61e8` (owner v35, participant v11 and QA participant v5). The publication manifest is updated only after reviewing these current inputs. Public Pages publication remains a separate verified release step.
