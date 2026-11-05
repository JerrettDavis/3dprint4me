# Product browsing images

The home shop (`public/index.html`) shows all six public generators and four service starting points. `/customize/` uses `public/assets/js/customize/product-media.js` for the same generator images and descriptions. Browsing either page requires no geometry build, worker, WASM, credentials or external image host. The home markup stays static and works without JavaScript; unit contracts prevent drift against the public registry and Customize cards.

## Provenance and honesty

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

### Pumpkin

Premium ecommerce catalog product render landscape 4:3, realistic stylized studio 3D render of three small FDM printed decorative pumpkins on warm ivory tabletop. Main orange squat ribbed pumpkin with dark inset cute smiling face and short green stem. Beside it a smaller ivory ribbed pumpkin bowl with round open top, its matching ribbed lid with short stem resting separately beside it. A muted terracotta tall ribbed pumpkin-shaped open vase in rear, completely visible. Matte plastic, visible fine print layers, believable manufacturable shapes, soft studio shadows, elevated three-quarter view, generous spacing no objects cut off. No real vegetables, no flame, no candle, no flowers, no leaves, no logos or overlay text.

## Updating the catalog

For a new public generator, add representative local media to the manifest and a home card. Use truthful alt text and visible provenance. Generated illustrations must not reuse a different product's photo. Run the product-media contract tests, browser browsing checks, full `npm test`, and screenshots. Rebuild the customizer and version assets as described in `GENERATORS.md`. Inspect both catalogs at desktop and 390px widths in light and dark themes. Keep every image same-origin, preserve original sources, and avoid customer uploads or personal data in generation prompts.
