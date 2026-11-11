# Product catalogue

Implementation status: the static shop, launch galleries, exact configuration
links, private owner draft editor, and durable draft/render-job storage are
implemented on the feature branch. Durable render execution and authenticated
preview review have also passed a real Blender integration test.
Deployment-confirmed publication and withdrawal are wired through the trusted
worker and tested against temporary local Git destinations. This document does not claim that operator publication is
live in production.

## Customer experience

`/shop/` lists 30 starting designs across all ten public customizers. Each
product has a static detail page and two studio views built from the actual
generator geometry. Search, collection filters and generator filters stay in
the URL. Request/customize actions pin both product ID and immutable revision.

`public/assets/js/catalogue/products.js` is the reviewed static projection.
`contract.js` normalizes public records against the real generator schema,
rejects sensitive/unknown fields and external image paths, and resolves pinned
links. The generator bundles this projection, so product startup and subsequent
editing/downloads work offline without a catalogue API dependency.

An explicit product link overrides an ordinary saved draft. Edits on that page
use a separate `:product:<id>:r<revision>` session-storage key, preserving the
earlier draft. Invalid, withdrawn, mismatched or stale links stop with recovery
actions; they never silently build another design. Request mode starts with a
short review panel; **Change settings** opens the ordinary editor. Continue
uses the existing private 3MF handoff and recoverable intake, not a new checkout.
Reload/back navigation resumes this product's own non-sensitive edits; a newly
clicked gallery link starts from the pictured configuration. Home-page product
tiles open the relevant pictured collection, while the explicit Customize
navigation still leads to the design tools.

All estimates remain non-binding and final materials, scope and price require
confirmation. A render demonstrates model settings, not physical validation.

## Launch media and static build

- `scripts/catalogue-seeds.mjs`: curated launch choices; writes complete safe
  snapshot parameters. Initial unreleased revision 1 includes generic demo
  content, open-network Wi-Fi examples, and hollow vase configurations.
- `scripts/catalogue-render-recipes.mjs`: two safe cameras per product,
  configuration fingerprints and final image paths.
- `npm run products:render`: the existing actual-builder → Blender Cycles →
  optimized WebP pipeline, now including launch products. Requires Blender 5.2
  and Pillow. `BLENDER_BIN` can select the executable.
- Intermediate recipes, triangle meshes and PNGs remain in
  `.private/product-renders/`. Only final images go into
  `public/assets/images/products/catalogue/`.
- `scripts/product-render-manifest.json` records recipes, configuration hashes,
  mesh/studio hashes and final image hashes. `scripts/catalogue-media.json`
  contains derived model dimensions. UI-only edits do not invalidate geometry
  provenance; geometry/helper/font/dependency changes do.
- `screenshots/product-render-board.png` is the visual inspection board.
- `npm run catalogue:build` generates `/shop/`, detail pages and sitemap entries
  from reviewed snapshots. It reuses the current asset release key, so repeated
  builds are stable. Run `npm run customizer:build && npm run assets:version`
  after changing generator UI or bundled snapshots.

Do not rerun seed generation to rewrite a publicly released revision. New
settings require a new revision, renders and review. Old snapshots must retain
their original meaning, or explicitly report withdrawal/incompatibility.

## Private owner workflow

The operator workspace has **Product catalogue** in its tools and **Create
gallery product** on customizer work detail. These controls and all catalogue
API operations require an enabled owner; a partner/operator identity cannot
merchandise products. Authentication and origin checks reuse the operator API.

`GET /api/operator-work?resource=catalogue[&id=<product>]` lists/loads private
drafts. `POST` accepts revision-bound `promote`, `save`, `render` and `approve`
commands with a stable `commandId` per attempt. Exact replay returns the
original result; reusing a key for a different command returns a conflict.
Stale revisions never overwrite newer settings. Do not reuse command keys for
intentional subsequent actions.

Promotion reads server-side work provenance, keeps geometry choices, replaces
all text with generic defaults, drops sensitive keys entirely, and resets
private-font/artwork dependencies. Owner editing deliberately supplies the
public text. A permission/rights note and review of matching studio previews
are required for approval. Any edit invalidates preview/review readiness.
Neither customer model uploads nor their embedded secret geometry are preview
inputs. Source work IDs are stored separately and never enter public snapshots.

Native PostgreSQL storage uses migration `019_product_catalogue.sql`, following
the existing work schema. It adds private drafts, idempotent command results
and durable jobs, with RLS, backend-only grants, and queue/lease indexes. Apply
the migration to the selected native PostgreSQL target through the established
migration procedure; it has not been applied by this feature implementation.
Local loopback development uses the private operator store path plus
`.invoices.json.catalogue.json`, with serialized atomic file updates. It is a
single-process development adapter, not a shared production job backend.

With no compatible storage, the API reports `configured: false` and refuses
writes. With storage but no runner, private draft saving still works and
**Build previews** is disabled. `CATALOGUE_WORKER_ENABLED=1` enables job
enqueueing; do not set it operationally until the trusted worker is installed.
Publication capability requires explicit trusted runner configuration. No failed/unconfigured action
is presented as a live product. Existing intake is independent of these flags.

Provider exceptions are converted to bounded operator errors without raw
credentials, paths or internal exception messages.

## Private preview worker

Install Node 22 dependencies, Blender 5.2 and Python with Pillow on the trusted
worker host. Configure `BLENDER_BIN` and `PYTHON_BIN` as executable paths when
they are not on PATH. On Windows, use the actual Python executable with Pillow,
not a `.bat` shim or an unrelated MSYS Python. A real Windows run of the complete
adapter has produced and verified both studio views successfully.

The standalone `npm run catalogue:worker -- --once` consumes one durable job;
without `--once` it runs continuously. It requires native PostgreSQL and
`CATALOGUE_WORKER_ENABLED=1`. Loopback development instead starts an in-process
worker behind the same flag, sharing the API process's serialized file store;
do not run a separate process against that development JSON file.

`CATALOGUE_PRIVATE_PATH` selects a dedicated directory outside `public/`.
The API server and worker must see the same directory/volume. Each job gets a
private subdirectory. Subprocesses receive OS/runtime paths without database or
provider credentials. Blender starts with factory settings and autoexec
disabled. Processes have bounded runtime and memory settings; leases heartbeat
and can be reclaimed after a worker crash. Failures retry at bounded intervals
up to three attempts, preserving the draft. Old lease holders and results from
superseded settings cannot overwrite current state.

Preview delivery is `GET /api/operator-work?resource=catalogue&id=<id>&preview=<index>`.
It requires the same owner authorization and allowed origin as draft access,
verifies the current configuration/receipt/image hashes, and returns uncached
image data. Preview assets are not static output or public URLs. The admin can
also inspect safe settings in the generator through a validated URL fragment;
it includes no source request data, permission notes or sensitive fields and
preserves the ordinary generator draft.

Run the actual render integration proof with
`CATALOGUE_RENDER_INTEGRATION=1 python -m pytest tests/integration/test_catalogue_render_worker.py -q`.
It exercises promotion, save, queue consumption, Blender, private image review
and approval; checks customer text was excluded; and proves the public image
path is still 404. It requires local Blender/Pillow and is opt-in in CI.

## Verification

Focused tests cover public contracts, exact startup/draft preservation, recipes,
shop rendering/filtering, promotion privacy, owner permissions, durable replay,
revision conflicts, native Postgres storage/RLS, offline model downloads, the
real request handoff and the owner create/edit/reopen flow. The full project
suite and screenshot workflow remain required before release. Full-goal
completion also requires verified publication/withdrawal evidence and the full regression checks.

## Trusted publication and withdrawal

Set `CATALOGUE_WORKER_ENABLED=1`, `CATALOGUE_PUBLISH_ENABLED=1`,
`CATALOGUE_PUBLISH_REMOTE` (a credential-free HTTPS Git remote),
`CATALOGUE_PUBLISH_BRANCH` (default `main`), and `SITE_URL` (the public HTTPS
origin). Git authentication belongs in the worker host's credential helper.
Never put a token in the remote URL. `CATALOGUE_RELEASE_PATH` optionally selects
a dedicated private staging directory; the default is `releases/` beneath
`CATALOGUE_PRIVATE_PATH`. The host needs Git, Node/npm and network access to the
remote, package registry and public site. The configured remote branch must
already have a deployment integration serving its `public/` directory.

The owner reviews private previews, records rights, approves, then selects
**Publish reviewed product**. Durable jobs serialize release delivery across
products. A release fetches the branch into private staging, merges immutable
snapshots, copies hash-verified preview bytes, installs locked dependencies
without install scripts, builds the catalogue/customizers, versions assets,
validates and makes an ordinary fast-forward push. Concurrent branch changes
cannot be overwritten. Images include their byte hash in their filename;
existing public image bytes cannot be replaced.

Push success is not publication proof. The worker fetches the immutable
`/catalogue-releases/<release-id>.json` receipt from `SITE_URL`, without
authorization or redirects, and checks release, product, revision, operation
and snapshot hash. Only matching public delivery marks the product live.
A missing/mismatched receipt or interrupted operation remains locked and
reconciles the same release automatically every minute. Restart recovery
recognizes an already pushed receipt without creating another commit.
**Refresh product** shows progress; editing stays disabled until verified.
The previous public revision remains live during replacement. Withdrawal
uses the last published settings, publishes a new withdrawn revision, and
requires the same public verification. Previously withdrawn revisions cannot
be revived by a later republication.

An unconfirmed release deliberately blocks subsequent releases. Diagnose Git,
build and deployment availability on the trusted host, then let the same job
reconcile. Do not delete its job/receipt or unlock it by editing database JSON:
delivery may already have happened. Private release checkouts contain no
provider environment credentials; retain them only as long as needed for
operator diagnosis and remove completed staging directories during maintenance.
The adapter tests push only to temporary local Git repositories. This branch
has not been pushed or deployed by this implementation workflow.

## Product provenance and generator updates

Private print intake carries the optional starting product ID/revision and a
friendly title through the handoff. The server validates only the bounded
reference. It is customer-claimed provenance, never geometry, price, rights or
payment proof. Private preview links carry no published-product identity.

Old generator versions remain immutable snapshots when their settings still
pass the current safety schema. They disappear from discovery and detail links
explain that review is needed; their settings are never interpreted by a newer
builder. Unknown or newly sensitive fields fail the build for deliberate
privacy review rather than silently publishing their values. A breaking schema
change therefore requires reviewing/quarantining affected historical records
before release; do not normalize or rewrite an old public revision in place.


## Owner merchandising and launch management

Owner access idempotently imports missing bundled public products into private
management, retaining each latest immutable snapshot and its public revision
counter. Existing private records stay authoritative. All bundled IDs, including
withdrawn history, are reserved against promotion; open the existing product
instead. Imported records have no private render/review, so republishing requires
fresh previews and approval. Withdrawal can use their existing public snapshot.
The immutable product ID is also its URL slug; changing the title never changes
that URL.

The editor supports public description, use limitations, two image descriptions,
display order and discovery visibility. Unlisted products remain reachable by
exact links but disappear from shop and generator discovery. Three fixed studio
camera presets are supported: standard, lower front and overhead. Camera changes
participate in the render fingerprint; arbitrary coordinates/URLs are rejected.
Editing merchandising fields invalidates render/review so public text and images
are approved together. Preview delivery failure must leave edit/rebuild/withdraw
controls available, with a bounded unavailable-preview notice.

Publication also requires `CATALOGUE_PUBLISH_AUTHOR_NAME` and
`CATALOGUE_PUBLISH_AUTHOR_EMAIL`. Configure the real identity authorized by the
repository and deployment provider. The worker does not invent an author or
bypass provider membership/commit-author restrictions. Missing/invalid author
configuration disables publication before a job can be queued.
