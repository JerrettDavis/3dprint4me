# Display sign and holder generator: design

Goal: a freeform generator for countertop signs and holders (with or without a business-card pocket)
that can reproduce the commissioned Chef Curt and Bradley's Bakery displays (in `~/Downloads`: `Chef_Curt_Rebuilt_V2`,
`Bradleys_Bakery_Print_Pack`): free text placement, custom logo, custom fonts, decorations such as rounded rectangles.

## Review of the examples

Both are two pieces: a flat sign (board plus a 200 mm × 24–26 mm × 4 mm tongue, body 4.0 mm, art raised 0.8 mm)
and a 225 × 84 × 36 mm holder (slot 4.5 mm throat leaning 8°, 95 mm card pocket with a front notch, sloped front, accent stripes,
raised lettering left and right of the pocket). Sign art: a frame line, logo, contact lines with icons, a QR tile with a
border, a caption and dividers; 3–5 colors.

## Decisions

- Flat slot schema (8 texts, 10 shapes, 2 holder letterings, 5-color palette) rather than a new array field type, so the
  validation, draft, Randomize, designs and server re-validation machinery is unchanged. Unused slots hide.
- Colors are palette slots, so the five-color limit holds by construction.
- Logo: traced in the browser; multi-color by snapping to palette colors with the border color as background.
- Painter's-order 2D composition so colored parts never overlap.
- Holder geometry is derived from one `holderLayout()`.
- Out of scope for now: drag-to-place on the preview, curved text, importing SVG.

## Verification

Unit tests (`customize-display-sign.test.mjs`, the all-generators gate), e2e (design, logo trace, matrix flow), screenshots.
