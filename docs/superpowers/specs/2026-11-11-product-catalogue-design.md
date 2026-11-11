# Product catalogue, generator galleries, and operator publishing

Status: design ready for review; implementation is not complete.

## Intent and scope

Customers should be able to see an appealing product, choose a pictured design,
and request that product without first learning a generator. Every public
customizer also needs its own gallery of rendered starting points. Selecting a
design must open the correct generator with the pictured settings. Operators
must be able to turn a customizer-originated request into another reusable
product, generate its preview images, review it, and publish it.

The user's reference is Vistaprint: a small set of fabrication capabilities
supports a growing catalogue of recognizable products and uses. This is a
storefront and an ongoing merchandising workflow, not just an image carousel.

## Authoritative starting point

The initial workspace is on `feat/filament-inventory-matching` at `551df3e`.
It contains six generators and unrelated uncommitted invoice documentation.
Do not build the feature on that old generator set or overwrite those edits.

The existing rendering implementation is in the linked worktree
`G:/git/3dprint4me-catalog-renders` at `1184b5d` (merged PR #82). It includes
ten registered generators: route-shield, wifi-tag, rating-card, name-plate,
pumpkin, display-sign, gridfinity-base, gridfinity-bin, infinity-fidget, vase.
Recheck upstream and integration branches before implementation and select a
base containing this work and the current storefront/operator changes.

Relevant existing seams:

- `public/assets/js/customize/registry.js`: public generator definitions.
- Generator `designs` and `presets`: existing curated parameter starting points.
- `customizer/framework/catalog.js`: current generator catalogue.
- `customizer/framework/app.js`, `designs.js`, and `form.js`: initialization,
  design selection, saved drafts, and sensitive-field filtering.
- `lib/customization/domain.js`: server validation of request provenance.
- `operator/assets/customization-detail.js`: private request provenance display.
- `scripts/product-render-recipes.json`, `export-product-render-meshes.mjs`,
  `render-products.py`, `generate-product-renders.py`, and
  `finish-product-renders.py`: real-builder geometry and reproducible renders.
- `docs/GENERATORS.md`, `ARCHITECTURE.md`, `DOMAIN-LANGUAGE.md`, and
  `PORTFOLIO-SOURCES.md`: existing boundaries and publication rules.

## Proposed product experience

These are implementation choices proposed by the agent, not prior user approvals.

### Shop and product pages

Make a product-led `/shop/` a primary destination from home and site navigation.
Use a welcoming image grid with category filtering, useful product names, and
short descriptions of the use. Include a clear path for customers who need
something custom. Existing service intake and portfolio links remain usable.

A product is a specific reusable configuration, not a generator category. For
example, several pumpkin designs can appear as separate products in Seasonal,
while all open the pumpkin generator. Category and search state must be usable
on a phone and accessible from the keyboard. Direct links and browser back
must preserve a useful browsing position/filter state.

Each product has a durable detail URL, multiple image views where useful,
descriptive alternative text, dimensions, intended use, customization options,
and relevant limitations. Label renders as renders; do not imply physical fit,
photography, included hardware, or food/heat suitability without evidence.

The primary action is **Request this design**. It opens the generator with the
selected configuration and a concise review/continue affordance, builds the
actual printable model locally, and continues through the existing private
model upload and print-request workflow. A secondary **Customize this design**
opens the same settings in the editing studio. Neither action can submit a
different default model while showing the selected product's image. A build
failure blocks continuation and offers an understandable recovery path.

This first catalogue release uses the existing request/estimate/quote model.
It must not present a non-binding estimate as a fixed price or a paid purchase.
Do not invent fixed prices, instant checkout eligibility, stock, or shipping
promises. Explain the quote step near the action. Once fixed-price products
are supported, the product model can add that explicit commercial policy.

### Every generator's gallery

Give all ten public generators rendered starting points, both in their category
gallery and in the generator's existing design-selection surface. Start with
at least three materially distinct, valid, printable configurations per
generator, using existing designs/presets where they represent meaningful
choices. Every launch item has at least one studio hero render; provide a
second angle for shapes whose function or construction is unclear in one view.
Do not substitute stock photos, SVG placeholders, or repeated crops for the
requested launch renders. Keep existing licensed/owned photography when useful
and distinguish it from an exact-settings preview.

The gallery must use the same canonical product records as the shop. Published
operator additions join the relevant category and generator gallery after a
successful release. An empty/unavailable gallery still lets customers start
from the generator's ordinary defaults.

### Exact preset links and drafts

Use stable product ID plus immutable published revision in generator links,
for example `/customize/g/pumpkin/?product=harvest-lantern&revision=1`.
Resolve these from a bundled same-origin manifest, not a private API. Product
records pin generator ID, generator version, validated non-sensitive parameters,
and the render/configuration fingerprint.

An explicit product link takes precedence over a saved draft, while preserving
the older draft for recovery. Ordinary generator navigation keeps existing
draft behavior. Selecting another product requires the existing unsaved-edit
protection or a clear replace/keep choice. Required sensitive fields begin
empty and must be supplied locally; never restore them from a product record.

Validate and normalize the complete configuration before first build. Missing,
withdrawn, incompatible, malformed, or generator-mismatched product references
show an explanation and a deliberate way to start fresh; do not silently show
a different model. Retain published revision snapshots so later edits do not
change the meaning of existing links. A withdrawn snapshot is not newly
discoverable or orderable; its link explains withdrawal. Generator-version
changes require compatibility verification or an explicit stale-design state.

Product provenance follows the existing private handoff as optional product
ID/revision plus the actual validated customization. Server revalidation must
not trust the catalogue reference as proof of model contents or pricing.

## Catalogue records and boundaries

Introduce a Product Catalogue context with a pure domain layer, an authenticated
operator application/transport, a persistence adapter, and a public projection.
Keep geometry generation outside the request-serving server. Reuse operator
authentication/authorization, concurrency, idempotency, and private file access
patterns instead of creating a second admin login.

A private draft owns:

- Stable ID, revision, title, slug, category, summary, description, alt text,
  ordering and discoverability, and product-use limitations.
- Generator ID/version and an allowlisted normalized public configuration.
- Rights/permission evidence and an operator approval record.
- Private source work-item reference; never copy its customer identity, notes,
  upload URL, filenames, or contact information into public fields.
- Render recipes, job status, bounded failure code, content fingerprints,
  generated asset references, reviewer, and publication history.

The public snapshot contains only reviewed merchandising fields, safe settings,
immutable revision IDs, and final local asset paths. No source request IDs,
private storage addresses, operator identities, private permission notes, job
logs, or unreviewed draft text enter `public/` or a browser bundle.

Treat customer-entered text, names, SSIDs, URLs, phone numbers, uploaded logos,
custom fonts, and proprietary features as potentially private even when the
schema does not mark them sensitive. Promotion starts with safe defaults and
explicit per-field inclusion/rewriting, rather than copying every non-sensitive
field into a public draft. Display the candidate values privately for operator
review. Require documented rights clearance before publication. Custom fonts
and traced/uploaded artwork are unsupported for publication until a deliberate
licensed public asset is supplied; never reuse a private attachment implicitly.

Sensitive schema fields are forbidden in draft configuration values, render
recipes, public metadata, URLs, logging, and exports. Drop existing redaction
markers as well. Reject attempts to submit those fields through the API.
Generators requiring sensitive content must use an explicitly public demo
mode/configuration that does not encode a customer secret. Do not render a
customer's submitted model file: it may contain the secret as geometry. Rebuild
all preview geometry from the approved safe configuration and current builder.

## Operator flow

Add **Create gallery product** to authorized customizer work detail in the
operator/admin panel. It is available only for supported provenance and roles
allowed to merchandise products. Partner/customer panels must not gain
publication authority. Provide a catalogue management list accessible without
a source request, with draft, rendering, review-ready, published, withdrawn,
and failed states.

1. Start a private draft from validated request provenance. Warn about old
   generator versions and unsupported assets. Fill shape/color fields only
   where safe; review or replace customer-entered content explicitly.
2. Edit the public name, category, description, safe configuration, image alt
   text, rights evidence, and render camera choices. Show exactly which values
   would be public. Save privately with revision checks.
3. **Build previews** enqueues a durable private render job for that exact
   configuration revision. Return promptly; do not run Blender inside an HTTP
   request. Show queued/running/failed/ready and allow safe retry.
4. Review full-size generated images and reopen the safe configuration in a
   generator for inspection. Record confirmation of rights and public fields.
5. **Publish** creates an immutable public snapshot only when rights, schema
   validation, compatible generator version, required images, and matching
   configuration fingerprints all pass. Editing settings invalidates prior
   renders and review. The previous published revision stays live until its
   replacement's deployment succeeds.
6. Report publication as queued/deploying/live/failed using actual release
   evidence. Offer the public link when the release is live. Support retry,
   withdrawal, and republishing without duplicate products or lost history.

Provider failures return bounded customer-safe/operator-safe messages. Keep
credentials and raw exceptions server-side and out of the UI and public data.
Keep a failed draft and its last valid published revision recoverable.

## Rendering and publication

Extend the existing reproducible studio pipeline rather than introducing
generative product imagery. Render actual generator geometry with its settings,
colors, camera, lighting, and ground contact. Reuse the studio quality approved
last session. Store renderer version, builder input hash, normalized safe
configuration hash, and outputs per revision. Ensure every hero image depicts
the exact settings opened by its link.

Use a trusted local/self-hosted job runner with Blender and the project's
pinned dependencies. It reads authenticated private jobs, validates inputs,
rebuilds safe geometry, produces preview assets, and reports results. Accept
only allowlisted generator IDs and camera/scene options; never accept scripts,
shell fragments, arbitrary local paths, or remote fetch URLs. Jobs have leases,
bounded resource use, retry limits, cancellation, and idempotent result writes.
Worker restart can resume queued/expired work without inventing success.

Publication must preserve static hosting and offline customizers. The proposed
default is a durable outbox consumed by the trusted runner: build an approved
public projection and optimized images, run catalogue/build validation, then
publish through the existing repository/deployment route. Deploy credentials
stay with that runner. Record the release identifier and verify its manifest
before marking a revision live. Concurrent publication batches must serialize
or merge safely. On failure, retain the previous release. Never widen customize
CSP or make generator startup depend on the publishing service.

Keep drafts, job inputs, and intermediate geometry outside `public/`. Only
reviewed manifest records, static product pages, and final images are static
output. The operator preview endpoint requires authorization. The unconfigured
runner/deploy state is explicit: draft saving works, render/publish actions
explain the missing integration, and no item is falsely marked live.

## Delivery sequence

### Proposed launch starting points

Use these existing design IDs as the initial render candidates:

- Vase: `dune`, `blossom`, `faceted-planter`.
- Infinity fidget: `classic`, `knurled`, `spheres`.
- Route shield: `route-66`, `i-95`, `us-101`.
- Wi-Fi tag: `placard`, `keychain`, `card`, each with `security: nopass`
  for public demonstration; explain that customers enter their own details.
- Rating card: `toilet`, `mug`, `five-star`.
- Name plate: `classic`, `keychain`, `desk` with generic example text.
- Pumpkin: `cute`, `witch`, `lattice`.
- Display sign: `starter`, `no-cards`, `sign-only` with generic example text.
- Gridfinity base: `standard`, `light`, `magnetic`.
- Gridfinity bin: `standard`, `divided`, `labeled`.

On 2026-11-11, all 30 candidate partial parameter sets passed the real
`validateParams` schema at `1184b5d`; none explicitly contains a key returned
by `sensitiveKeys`. This check does not prove geometry, printability, rights,
or visual quality. Complete builds, renders, and review remain required.

### Implementation stages

1. Select an integration base containing #82 and current storefront/admin
   changes; preserve unrelated work. Establish baseline verification.
2. Build catalogue schema/validation, immutable snapshots, seed configurations,
   preset-link resolution, and draft precedence tests.
3. Extend the render pipeline, generate and visually inspect all launch
   galleries, and verify image/configuration correspondence.
4. Implement shop/detail/category/generator galleries and request/customize
   actions through the real private handoff flow.
5. Implement authenticated draft promotion/editing, permissions review,
   durable render jobs, review, publication and withdrawal in admin.
6. Integrate the runner and release reporting; rehearse failures and recovery.
7. Run full regression/visual/offline verification, update operational docs,
   and complete a requirement-by-requirement audit before claiming delivery.

The builder may choose table/module names, exact API routes, pagination,
category taxonomy, camera presets, and visual details to fit the repository.
Do not reduce the scope to a static seed gallery or a manual developer-only
promotion script: both the customer and admin experiences are required.

## Completion evidence

- All ten public generators have at least three distinct rendered starting
  points visible in shop/category and generator galleries.
- Each pictured product's request/customize link loads its exact configuration
  with a preexisting conflicting browser draft, survives reload/deep linking,
  builds the correct model, and reaches recoverable private request intake.
- Requesting a product offers a short review/continue path; editing remains
  available without making the whole studio a prerequisite for understanding
  what is being requested. No unverified price or payment claim is introduced.
- Authorized admin can promote a real customizer-originated request, rewrite
  public content, save, render, inspect, publish, and withdraw from the UI.
  Restart/retry/concurrent edits and unconfigured integrations are covered.
- A customer secret seeded in provenance/model geometry cannot appear in
  drafts, preview jobs, published assets/metadata, URLs, logs, or webhook/email
  output. Separate tests cover non-sensitive customer PII and private artwork.
- Invalid/stale generator versions, hostile fields, unauthorized access,
  revision conflicts, render timeouts, failed deploys, and stale render hashes
  leave safe, truthful, recoverable state.
- `npm test`, `npm run screenshots`, and visual inspection of
  `screenshots/preview-board.png` pass, with added desktop/390px light/dark,
  system theme, keyboard, reduced-motion, galleries/admin/product paths.
  Offline E2E proves `/customize/*` still works without remote requests.
- Render validation demonstrates safe recipes and matching input fingerprints;
  `npm run customizer:build && npm run assets:version` changes are committed.
- Generator, architecture, deployment, privacy, and operator documentation
  describe the implemented contracts and render/release recovery procedures.
- Production readiness includes configured runner/deployment verification or
  an explicit remaining integration dependency; local green tests alone do
  not prove the full admin publication flow is live.
