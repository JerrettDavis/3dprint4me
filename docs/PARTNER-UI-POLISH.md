# Partner and owner responsive polish

The existing private portal and owner controls remain the foundation. This pass
reduces navigation height on small screens and gives administration a persistent
desktop index, using the existing fonts, colors, themes and static deployment.

- Partner navigation becomes a single horizontal strip below 701 pixels.
- Owner navigation becomes a horizontal strip below 1000 pixels and a sticky
  sidebar above it. Content and clearance remain in the main desktop column.
  Sidebars scroll within short windows so every destination stays reachable.
- Native horizontal scrolling and keyboard focus reveal every destination.
  Focus explicitly scrolls the entire link into view: Chromium's default focus
  scrolling left the final owner link partially clipped at 320 pixels.
  Reopening a saved destination reveals its current item within the strip without
  scrolling the document to the navigation or moving keyboard focus.
- Cards use consistent corners, headings balance across lines, and financial
  figures use tabular numerals. Existing labels, controls and clearance remain.
- Partner shell v6 and owner shell v27 invalidate the previous static caches.
  No API, database, launch flag, invitation or payment behavior changes.

`tests/e2e/test_partner_responsive_navigation.py` covers both navigation systems
at 320, 390, 768 and 1440 pixels plus 844-pixel landscape and short desktop
windows, light/dark themes, reduced motion, horizontal
overflow, keyboard reachability through the final destination and selected-link
visibility after reopening a saved destination. Existing
workflow, authentication, offline and theme tests remain required for release.

Local checks: 1,231 unit/contract checks pass; the full browser run has 343 passes,
one existing Windows skip and one customizer navigation failure with Windows
`ERR_NO_BUFFER_SPACE`. That unchanged customizer case passes its isolated retry.
All 12 final responsive-navigation cases, 241 UX checks, static validation and
the operator build pass. Independent review found no actionable issues.

The initial screenshot command captured 153 views and its preview board, which
was inspected along with dedicated phone and desktop portal renders. The final
capture after selected-navigation visibility changes timed out acquiring a
service worker while the broad browser run was active; the serial repeat captured
all 153 views and the final preview board successfully.

## Production release

Committed source `75e9f0f002164e99303b32e588296a54df6f0398` is deployed to
[Partners](https://partners.3dprint4.me) and
[Partner administration](https://work.3dprint4.me/partners). Uploads used an
isolated archive of the committed operator/partner source and the exact existing
project links. Vercel reports both deployments Ready / Production:

- Partner v6: `dpl_FQUrXT9PgPtnhMEwbvpwVC76QBvQ`.
- Owner v27: `dpl_8Zrh7UCHkUria5VMiC134hT9UH3V`.

All 15 partner and 35 owner static files match the committed archive bytes and
SHA-256, including HTML, CSS, JavaScript and workers. The local Windows checkout
uses different line endings in some files; the committed archive is the deployed
byte authority. Custom-domain TLS, CSP, no-store, frame denial, no-referrer and
nosniff pass. Source/private paths return 404. Partner session/profile and owner
session reject anonymous requests with application JSON, and public partner
status remains invitation-only. Python's default user agent encountered the
existing Cloudflare protection; a browser user agent passes the public checks.
No Cloudflare setting was changed. Storefront and status remain HTTP 200.

Four live anonymous Chromium checks cover each frontend at 390-pixel dark and
1440-pixel light widths: expected sign-in screens, no horizontal document overflow
and no JavaScript page errors. Expected anonymous 401/403 resource messages are
not counted as application crashes. The live phone sign-in and desktop owner
sign-in renders were inspected. Authenticated workflow/layout evidence comes from
the local synthetic fixtures and full browser regression; this pass did not create
a production partner account or claim a new real-owner OAuth acceptance.

Production API/services, program switches, approvals and financial records were
not modified. The existing disabled rollout and operational boundaries remain in
[PARTNER-PRODUCTION-RELEASE.md](PARTNER-PRODUCTION-RELEASE.md).

Static rollback selects the prior deployment in its same existing project:
partner `dpl_52pR4hqKw3SUAcorMJbNWj4Fivzu`, owner
`dpl_EShS85z7kbpza5j6yUWcADCaFqvb`. No database rollback is needed for this UI pass.
Private local proofs are `partner-polish-live-proof.json`,
`partner-polish-live-browser-proof.json` and the named test/capture/deployment logs
in the session temporary directory. They contain no authentication credentials.
