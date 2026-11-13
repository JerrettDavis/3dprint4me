# Product browsing images

## Current reproducible studio renders (November 12, 2026)

All eight public customizer categories without a printed photograph now use Blender Cycles renders of the actual generator's finished-preview geometry. Route shield and Display sign retain their printed photographs. The historical AI prompts and capture instructions below describe superseded assets, not the current shipped images.

Install the repository's Node dependencies (`npm ci`), Python Pillow (`python -m pip install Pillow`) and Blender 5.2 (the reviewed run used 5.2.3 LTS). Run `npm run products:render`. The command resolves Blender from `BLENDER_BIN`, PATH, or its standard Windows 5.2 installation. It fails if a build or render fails. No renderer runs in the production site. CPU rendering is the portable default. Set `PRODUCT_RENDER_DEVICE=OPTIX` (NVIDIA RTX) or `CUDA` for a supported local GPU; unsupported or unavailable devices fail explicitly rather than silently falling back. The reviewed November 12 regeneration used Blender 5.2.3 LTS with OptiX on an RTX 4090.

`scripts/product-render-recipes.json` pins public example parameters and camera angles. Defaults come from the generator definitions; commit those alongside any regenerated images. `scripts/export-product-render-meshes.mjs` validates the examples and builds their real colored triangles through `buildPresentationModel`, including assembled presentation and support removal. It uses local curated fonts. No screenshots, invented QR geometry, customer uploads or external image service are involved. The Wi-Fi example is an open guest network, with no password. Sensitive keys are forbidden in recipes and parameters never enter the mesh JSON.

`scripts/render-products.py` is the shared studio. Cycles path tracing retains indirect illumination, occlusion and contact shadows. A dim neutral environment (strength 0.06) avoids washing out dark surfaces; three area softboxes use a 7:0.6:3 key/fill/rim power ratio and a smaller key to define form. Khronos PBR Neutral, exposure -0.7 and gamma 1 retain highlights while giving the polymer richer color and deeper shadows. The polymer shader uses roughness 0.46, IOR 1.46, restrained surface grain and subtle world-space 0.2 mm layer normals. These are illustrative material cues, not a promise of a particular printer's surface finish. The sampling seed is fixed at 41, with 192 samples and denoising. Orthographic framing fits the actual projected vertices with a 28% margin. Geometry is not beveled or reshaped by the renderer. Hardware and Blender versions can affect pixels; reproducibility means rebuilding the same model, camera, material and lighting recipe, not promising byte equality between render engines.

Mesh JSON and full-size PNGs stay in ignored `.private/product-renders/`. `scripts/finish-product-renders.py` produces the shipped 960 × 720 WebPs, `screenshots/product-render-board.png`, and `scripts/product-render-manifest.json` with image, mesh and studio source hashes. Inspect the board before accepting regeneration. Both catalogs retain the honest “Illustrative render” label: these are models, not photographed prints or fit/finish guarantees.

The finish step also updates both catalogs' image URLs with `?v=<first 16 image hash characters>`. Changed renders get new cache keys automatically, so returning visitors receive the new image without waiting for the ordinary asset cache to expire. Provenance verifies these URL versions along with the input-source fingerprint, including export and finishing scripts.

To add a category, add its default recipe, media entry and home card. The coverage contract fails when a public generator without a photograph lacks a recipe. To add an alternate variant, add a unique URL-safe `id` and a `generator` pointing to an existing generator, plus partial `params`, `elevation` and `azimuth`; the same command writes a separate WebP. Add that image to the relevant gallery explicitly. Recipes must not contain sensitive keys. Run `node --test tests/unit/product-render-recipes.test.mjs tests/unit/product-media.test.mjs`, `npm test`, and `npm run screenshots`; inspect the render board and `screenshots/preview-board.png` at desktop and 390px.

## Historical media notes (superseded)

The home shop (`public/index.html`) shows all ten public generators and four service starting points. `/customize/` uses `public/assets/js/customize/product-media.js` for the same generator images and descriptions. Browsing either page requires no geometry build, worker, WASM, credentials or external image host. The home markup stays static and works without JavaScript; unit contracts prevent drift against the public registry and Customize cards.

Gridfinity baseplate and bin images are captured from the actual default Manifold geometry by
`python scripts/capture_gridfinity_media.py` after `npm run customizer:build`. UI overlays are
hidden during capture; the render is resized/cropped to 640 × 480 WebP. These are illustrative
renders, not photographs or physical fit evidence, and use no AI-generated imagery or customer
data. Generated files: `public/assets/images/products/gridfinity-{base,bin}.webp`.

The infinity-fidget image is rendered from the actual exported default geometry by `node scripts/fidget-evidence.mjs` and `python scripts/fidget-render-evidence.py --catalog`. It is a 640 x 480 WebP illustration, not a photographed print or proof of physical fit. No reference mesh or customer image is used.

## Provenance and honesty

The customizers separately offer **Model / Realistic preview**, rendered locally from the
customer's actual configured geometry. Those interactive studio views do not use these catalog
images or an image-generation service. See [Realistic preview](GENERATORS.md#realistic-preview)
for support removal, assembled presentation and the strict separation from printable files.

`public/assets/images/products/{name-plate,wifi-tag,rating-card,pumpkin}.webp` are AI-generated **illustrative renders**, created with the built-in image-generation tool on November 4, 2026. They show representative design possibilities, not customer prints, proofs, exact geometry exports, guaranteed finishes or verified QR codes. Both catalogs display “Illustrative render.” The QR patterns in the Wi-Fi scene are illustrative; do not scan them to join a network. No credentials were supplied to generation.

The existing `projects/plate-plug-signs.jpg` belongs to **Display sign and holder**, not Name plate. Existing `route-66-magnets.jpg` is a printed Route shield example. Practical-service cards retain their existing project assets; Print my file uses `emergency-stop-render.png`, marked “CAD example,” as an example of printable parts. These examples do not promise that an uploaded file will be printable or that a custom part will fit without review. Original portfolio provenance remains in `public/assets/evolution/projects.js` and `public/portfolio.html`.

The generated PNG originals remain in the tool's generated-images library. Delivered WebP assets are 960 × 720 pixels, quality 85, with no crop or content changes; originals were proportionally downscaled. Each generated asset is under 75 KB.

## Generation prompts

### Name plate

Use case: product-mockup. Create a premium ecommerce catalog image, landscape 4:3 composition, realistic stylized studio 3D render of FOUR small flat 3D printed personalized name plates, arranged with generous spacing on a warm ivory tabletop, elevated three-quarter overhead camera, all fully visible and readable. Product one: teal contour-hugging plate with raised white block letters "Alex". Product two: dark navy pill-shaped plate with raised lime letters "Sam" and a thin magenta outline around letters. Product three: cream pill-shaped plate with dark brown raised letters "Mia" and a visibly offset terracotta drop shadow under letters. Product four: black rounded rectangle plate with gold serif letters "JAMIE" set flush into the surface, no raised gold. Plates are only 3-4 mm thick, plausible fine FDM layer lines, matte plastic, crisp typography, soft natural studio shadows. No upright stands, no holders, no QR codes, no logos, no promotional text or overlay labels. Distinct letter styles clearly visible. Tasteful realistic rendered product photography suitable for browsing a custom print shop.

### Wi-Fi tag

Premium ecommerce catalog product render, landscape 4:3. Three flat FDM 3D printed guest Wi-Fi tags on warm ivory tabletop with soft studio shadows, three-quarter overhead camera, all clearly visible. One upright-format mint 90x120mm placard lying flat, one pale blue 86x54mm horizontal business card, one small blush 45x60mm keychain tag with a hole at top. Each has a dark inset square illustrative QR pattern with three square finder corners and generous white quiet zone, no real credentials, title "Wi-Fi" and placard network name "Guest". No password text anywhere. Thin matte plastic, subtle fine layer texture, simple restrained raised border, no stands or electronics. Attractive realistic stylized 3D studio render, no branding or overlay text. Illustrative nonfunctional QR patterns.

### Rating card

Premium ecommerce catalog product render, landscape 4:3, realistic stylized 3D studio photography, three small flat business-card-size 3D printed rating cards arranged with space on warm ivory tabletop, overhead three-quarter camera, all fully visible. Each card is horizontal rectangular thin matte plastic with rounded corners, embossed icon in upper center, a single row of exactly FIVE small five-point stars under it, one short caption below. Cream card: dark simple coffee mug icon, five gold stars, caption "Best coffee". Blush card: dark pink simple heart icon, five pink stars, caption "Loved it". Navy card: cream simple house icon, five gold stars, caption "Home sweet home". Fine FDM layer lines and shallow raised text, soft shadows, no holders, no QR, no electronics, no branding or promotional overlay.

### Final Wi-Fi accuracy correction

The original Wi-Fi scene was edited with the built-in tool before shipping. Final edit prompt:

Precise product-accuracy edit. Remove the radio-wave/Wi-Fi SYMBOL ICON from ALL THREE tags: mint placard, blue business card, pink keychain. Replace those icon regions with blank matching plastic. Also remove the WORDS "Wi-Fi" from ONLY the small pink keychain at bottom right; its face must have only the illustrative square QR code and the top circular key-ring hole, no words or icon. Keep the WORDS "Wi-Fi" on both the large mint placard and the blue card. Keep the word "Guest" on mint placard. Preserve all three illustrative QR patterns, borders, colors, hole, proportions, physical dimensions, positions, fine FDM plastic texture, tabletop, camera framing, aspect ratio and lighting. No other changes, no additional text, no credentials. Supported layouts: placard = title + QR + network; card = title + QR; keychain = QR + hole only.

### Final Wi-Fi geometry refinement

Before the final export, the Wi-Fi illustration received this additional geometry refinement:

Refine this catalog illustration to match precise supported printed geometry. Preserve the ivory tabletop, three products, mint/blue/pink body colors, camera, soft shadows, matte FDM material and 4:3 composition. Change these three details: (1) ALL QR modules and lettering are dark FLUSH INLAYS directly into the COLORED plastic surface. Remove the white rectangular panels behind the QR patterns. Their background/quiet zone must be the same uninterrupted mint, blue or pink color as that tag body, not a white sticker, insert or raised panel. Text is flush with the surface, not raised. (2) On the BLUE horizontal business card, put a large square dark illustrative QR pattern on its LEFT half and the short title "Wi-Fi" on the RIGHT half. Keep text clearly readable and dark. (3) The PINK keychain has no text or symbols. Center its dark illustrative square QR pattern on its flat rectangular body, with generous plain pink quiet margin, occupying most of the body width. Its key-ring hole belongs in a small circular PINK LOOP BOSS protruding from the center of the TOP edge, outside the rectangle, like a key tag ear; no hole within the rectangular face itself. The large MINT placard stays title "Wi-Fi" at top, dark QR in center and "Guest" at bottom. Keep thin restrained raised border rims on all three. No radio-wave icons, no credentials, no other text, no brand marks. All QR patterns are illustrative, not real credentials. Make the final result look like one coherent high quality product photograph.

### Pumpkin

Premium ecommerce catalog product render landscape 4:3, realistic stylized studio 3D render of three small FDM printed decorative pumpkins on warm ivory tabletop. Main orange squat ribbed pumpkin with dark inset cute smiling face and short green stem. Beside it a smaller ivory ribbed pumpkin bowl with round open top, its matching ribbed lid with short stem resting separately beside it. A muted terracotta tall ribbed pumpkin-shaped open vase in rear, completely visible. Matte plastic, visible fine print layers, believable manufacturable shapes, soft studio shadows, elevated three-quarter view, generous spacing no objects cut off. No real vegetables, no flame, no candle, no flowers, no leaves, no logos or overlay text.

## Updating the catalog

For a new public generator, add representative local media to the manifest and a home card. Use truthful alt text and visible provenance. Generated illustrations must not reuse a different product's photo. Run the product-media contract tests, browser browsing checks, full `npm test`, and screenshots. Rebuild the customizer and version assets as described in `GENERATORS.md`. Inspect both catalogs at desktop and 390px widths in light and dark themes. Keep every image same-origin, preserve original sources, and avoid customer uploads or personal data in generation prompts.

## Algorithmic vase

The 640 × 480 vase.webp is captured from actual default local realistic-preview geometry by scripts/render-vase-product.py after the customizer build. UI overlays are hidden. It is an illustrative render, not a photographed or verified physical print. No AI imagery, remote images or customer data is used.
