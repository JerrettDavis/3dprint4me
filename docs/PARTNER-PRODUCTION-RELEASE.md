# Partner production release — 2026-10-24

The owner approved the prepared DNS record and disabled portal/API/owner deployment
in the captured browser session at 20:56 CDT. This supersedes the historical
production-pending notes in the deployment, verification and acceptance journals.

## Live entry points

- Partner: <https://partners.3dprint4.me>
- Owner: <https://work.3dprint4.me/partners>
- Existing work inbox: <https://work.3dprint4.me/>

The existing GitHub owner sign-in completed in the actual Edge browser. The inbox
and partner administration both authenticated the existing owner. No program,
partner account, invitation, approval, payment or new owner identity was created.
All three partner switches remain `0` in API and jobs. The owner workspace reports
“No partner program configured.” Professional review and deliberate activation
remain separate from this completed disabled technical rollout.

## Component identities and deployment checks

The native guarded protocol first deployed reviewed `116f3de`, then the
CI-qualified `8c93560103501614cb3cf59ce879b150136ac721` to load the initial persistent
review-package signing key. Their native archive file hashes are identical;
the latter commit changes documentation only. Both deployments passed all 13
protocol checks, including a fresh complete encrypted checkpoint with readback
from two stores, selected-native additive migrations012/013, guarded API handover,
preserved writer intent, fresh statement-worker evidence and feature-off smoke.
Neither rollout restarted the existing slicer or tunnel. The selected database
identity is unchanged, no guard remains, and the temporary override is removed.

Running API/jobs image:
`sha256:2c6094d611bff10856411c902d583593af97402b37f24388a618ddeb5dde4d64`.
The companion slicer image was built but the existing running slicer was retained.
The initial Ed25519 key is stored only in private host configuration and included
in the second encrypted checkpoint. The loaded API key passed a sign/verify
self-test; public-key fingerprint:
`fd9515a1a6c325826adaafad31ca1cd82e9c4a7732e1b9915ecdb7ed6524dd1f`.
This authenticates package provenance; it supplies no professional approval.

Partner static shell remains v5. Owner shell v26 is deployed from
`dda9edf607e80501350c988da729dd6e609a5372`, using an isolated committed-source upload
to the existing operator project. Production feedback settings and deployment
protection were preserved. All 15 partner and 35 owner public files match source
bytes and hashes; configured security headers match and private/source paths404.
Default certificate verification succeeds on both custom domains. Eight external
API checks pass: legitimate status, anonymous session/data denial, foreign-origin
and cross-realm denial, and credentialed owner/partner preflights. Storefront and
status remain HTTP200. Existing Cloudflare protections were not weakened.

Cloudflare now contains one new DNS-only CNAME, `partners` →
`e0db4d51d540ec73.vercel-dns-017.com`, TTL Auto. All 14 prior records are unchanged.
Vercel reports the associated partner domain verified, configured by CNAME and
not misconfigured. Exact DNS record ID and rollback data are held privately.

## Owner navigation regression

Real production navigation exposed `ERR_FAILED` when the v25 service worker
returned a cached redirected response for `/partners.html`. Production clean URLs
redirect308, unlike the development server. V26 wraps redirected navigation
responses while preserving body/status/headers and all network-only API rules.
The new real-HTTP308 browser regression failed before the fix, then passed online
and offline, including partner, reader and inbox navigation. A fresh focused
review found no actionable findings. Full `npm test` passed 1,231 unit tests,
336 browser tests plus one existing Windows skip (584.98s), and 241 UX checks.
The signed-in captured Edge session upgraded normally, followed the actual
Partners link successfully twice and returned to the inbox without cache deletion
or another sign-in. This changes navigation behavior, not visual layout; the
existing 153 inspected screenshot states remain the visual baseline. No physical
mobile or live390-pixel claim is made; local responsive fixtures remain separate.

## Recovery and remaining operational boundaries

Keep the host-private journals, two-store checkpoint receipts and immutable
previous source/image identities. Follow the forward-repair instructions in
[PARTNER-DEPLOYMENT.md](PARTNER-DEPLOYMENT.md); do not delete additive partner data
or blindly retry a completed release. Static rollback uses an explicitly selected
previous deployment. DNS rollback removes only the recorded new partners CNAME
and its new Vercel association, preserving every pre-existing record.

Existing status still reports estimates unavailable and files/email unknown;
these predate the portal rollout. Current statement-worker health passes.
Full replacement-host/private-object-provider recovery, real accounting import,
completed tax reporting and actual attorney/CPA clearance are not established by
these checks. They do not require enabling the partner program during deployment.
The disposable 59-case native suite supplies authorized partner-flow evidence;
production verifies disabled and anonymous boundaries plus real owner OAuth.
No synthetic professional approval was inserted into production to exercise flows.

Private proofs: `partner-production-signing-native-proof.json`,
`native-partner-release-preflight.json`, `partner-loaded-signing-proof.json`,
`partner-production-public-proof.json`, `partner-production-dns-proof.json`,
`owner-hotfix-source.json` and `operator-navigation-full-regression.log`.
Credentials, customer data, checkpoint receipts and private keys stay outside Git.
