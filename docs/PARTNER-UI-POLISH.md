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
Release evidence remains pending; these UI changes are not yet deployed.
