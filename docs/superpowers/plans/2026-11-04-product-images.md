# Representative product images

**Goal:** Customers can browse representative images of every offered product without opening a generator. Correct the name-plate/display-sign mismatch and preserve honest descriptions.

**Architecture:** Keep the static home catalog and the existing Customize catalog. Share a small isomorphic product-media manifest between the customizer and contract tests; the static home markup uses the same paths, checked by tests. Preserve existing genuine photos and CAD renders where representative; generate optimized local WebP illustrations for name plates, Wi-Fi tags, rating cards and pumpkins. Reassign the existing display-sign photo to its actual product.

**Constraints:** Only public assets ship. No external requests from Customize, no changes to geometry, sensitive fields, intake, estimates, payment, or provider contracts. Generated scenes are illustrative, never customer examples or print proofs. Maintain themes, keyboard focus, reduced motion, and 390px layouts.

## Tasks

- [x] Add regression coverage: every public generator has an image on both browsing surfaces, all home cards have real image assets, name-plate image differs from display sign, alt text is meaningful, generated art disclosed. Update search/filter expectations for ten products (three business, three gifts, four practical).
- [x] Generate name-plate montage showing raised, outlined, shadowed and flush-inlay modes; Wi-Fi formats without credentials; rating cards; pumpkin variants; use the existing emergency-stop CAD render for a representative uploaded-model print. Inspect and optimize all outputs; save prompts and provenance.
- [x] Implement shared media manifest, replace customizer icons, update home images/copy, add Display sign and holder and Pumpkin cards, preserve photo attribution and add illustration captions.
- [ ] Build customizer, version assets, run targeted checks then npm test and npm run screenshots; inspect screenshots/preview-board.png and both catalogs in desktop/mobile themes. Review changes independently.
- [ ] Open PR, require green checks and deployment, merge to main, verify all main checks and production asset bytes plus actual browsing behavior.

## Review focus

Image-to-product fidelity; unsupported QR claims on name plate; illustrative QR patterns mistaken for working codes; image crop and caption contrast at 390px; static catalog and registry drifting apart; no model engine needed to browse; same-origin assets and complete offline operation.

## Decisions

The user authorized review, planning, implementation, deployment, and landing on main. Execute inline through those stages. Existing unrelated edits remain in the original checkout. Use the existing photographic display-sign and route-shield assets and existing practical-service examples. All generated imagery uses the built-in image tool and is labeled as illustration.

Review: Independent reviewer found unsupported Wi-Fi symbols and keychain lettering in the first generated scene. Correct those in the image before release; no other Critical or Important findings.

Verification so far: 1,283 unit/contract tests pass; four real-HTTP image browsing checks pass at 390px/1440px and light/dark with no worker or WASM; all shipped illustrations inspected. Review correction applied: removed unsupported radio symbols and keychain lettering from Wi-Fi scene. Full browser suite is still running and has a hand-off failure to diagnose before release.
