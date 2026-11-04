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


## November 3, 2026 portal spacing and motion release

Source `a72c529d88700d40e6d4dadb2f7e553c97050899` polishes work, owner, QA, participant and offline review surfaces. See the [release guide, populated screenshots and verification](portal-polish/README.md). Production owner deployment is `3dprint4me-operator-pof9s29zh`; participant deployment is `3dprint4me-partners-ckwm59bg1`. Worker versions are v32 / v9 / v3 (work / participant / QA participant). The API, database, actual approval flags and launch settings were unchanged.

## November 3–4 workspace redesign — local verification

Three [interactive directions](design-concepts/2026-11-03/index.html) were reviewed independently. Both reviewers selected the Fluent task workspace, with the focused partner detail treatment from the iOS/Metro direction. The [voting record](design-concepts/2026-11-03/DECISION.md) records scores and prototype limitations.

Partner and owner navigation is grouped, with a labeled mobile menu. Partner decisions use explicit state-specific actions; visit facts, permissioned contact and device drafts remain separate. Administration starts with gig review, with creation, private access, payment corrections and legal revision editing deliberately disclosed. The work inbox puts tools in normal page flow and collapses optional phone filters. Feedback has its own space above owner records and never overlays access controls. Existing server commands, revisions, consent, accepted terms, payment verification and rollout settings are preserved.

The full `npm test` run passed 1,277 unit/contract checks, 432 browser checks (one existing skip), and 241 UX checks. Eighteen native PostgreSQL/browser workflows passed, including paused-program debt preservation and recovery; their disposable containers were removed. Subsequent visual inspection found the owner feedback overlap: its correction passed 61 affected tests, including a new 320-pixel non-overlap regression, and final static/architecture validation. No application source changed after those follow-up checks.

Screenshot and handbook verification is recorded in the [implementation plan](superpowers/plans/2026-11-03-workspace-ux.md). At that local checkpoint, cache versions were work v33, participant v10 and QA participant v4. Deployment had not yet occurred; the November 4 production record below supersedes that checkpoint.

November 4 continuation verified the final source with 1,278 unit/contract tests, 433 browser tests (one existing skip), 241 UX checks, 168 regenerated screenshots and 40 refreshed guide captures. The full board and representative actual tasks were visually inspected. The strict 113-page handbook build, link checks, three documentation contracts and two desktop/mobile browser cases pass. Independent code review cleared the UI changes. Publication and production checks are separate release gates.

Production workspace release (November 4): runtime source `6023204ad1ef65def0338088ce3fffaf920f206f` is deployed as owner `3dprint4me-operator-1l7q45t59` and participant `3dprint4me-partners-8eqke2r52`. All 98 served static files match the committed archive. The full 60-case native workflow suite passed, and a separate complete source-bound evidence run passed all 60 with 142 validated redacted captures. Live owner sign-in, grouped navigation, desktop landing and route focus were checked. Responsive phone/dark coverage is established by the automated fixtures; see the viewport qualification below. Main integration and public handbook publication are tracked separately until their hosted checks finish.

The subsequent Linux CI pass exposed short-window scrolling and phone font-metric
bounds. Desktop navigation now uses document scrolling below 600 pixels high;
phone accounts have less top padding. Strict forward/reverse keyboard checks pass,
including 1440 × 390. Hosted upgrade tests fetch the pinned historical worker;
QA migration review includes 017. Eight participant live/QA offline and upgrade
checks pass, as does installed operator cache migration. Final cache versions are
work v34, participant v11 and QA participant v5, with matching release markers.

Static source `6db02713bef675a6f238b384441da3da410ff9a0` is deployed as owner
`3dprint4me-operator-oxaz8279x` and participant `3dprint4me-partners-pnlplgzco`.
All 98 files match the committed archive. The real owner accounts route loads,
route focus reaches `owner-content`, and the participant sign-in renders correctly.
Final native source `1360be638e664288f638d98124ac86585eab05d7` passes all 60
workflows with 142 validated redacted captures; its additional source change fixes
restore-monitor evidence expiry. The refreshed board, owner accounts and native
contact sheet were visually inspected.

Final local `npm test` passes 1,280 unit/contract tests, 435 browser tests with
one existing Windows skip, and 241 UX checks. The complete native suite passes
60/60, and all 142 evidence records validate against the final source fingerprint.
The guarded native deployment of `1360be638e664288f638d98124ac86585eab05d7`
passes schema, privileges, disabled-program checks, fresh backup, worker handover,
no-message and unchanged-live-state checks. Its API and slicer image digests match
the previously verified release; source includes the corrected QA host inventory.

Live viewport qualification: the extension browser did not apply a subsequently
requested 390 × 520 override to the existing owner tab; its measured viewport
remained 1440 × 810. The earlier live matrix records requested widths without
independent measured dimensions and therefore does not establish live phone-size
acceptance. Phone, short-window, light/dark, reduced-motion and keyboard behavior
are verified by the automated fixture/native runs and their actual-size captures.
The live checks establish authenticated routes, page focus and served-byte parity.
