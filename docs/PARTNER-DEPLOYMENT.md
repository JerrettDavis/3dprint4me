# Partner release evidence and remaining gates

## Verified isolated static preview, 2026-10-24

The dedicated `3dprint4me-partners` project now exists in the existing
`jerrettdavis-projects` workspace. The local link names that project and its matching
provider-issued project/team identifiers; the ignored link contains no API credential.
The effective CLI upload root is `partner/`, framework Other, output `public/`.
The existing storefront, operator, public status and operations projects were not
modified. No new project was connected to automatic Git deployments.

Current verified Preview:
<https://3dprint4me-partners-39l866vqm-jerrettdavis-projects.vercel.app>

The public application bytes include the reviewed authentication/error-notice increment
based on `60584f3`, with matching worker/HTML release `partner-shell-v3`. Provider output is
Ready / Preview. Authenticated verification used the official CLI's protection
bypass handling, without printing or copying its managed credential. It proved:

- All 14 static files match their local source bytes and SHA-256 exactly, including
  the HTML, worker, manifest, icons and complete JavaScript graph.
- CSP, no-store, noindex/nofollow, no-referrer, nosniff and frame denial match the
  tracked hosting configuration on the actual served assets.
- Activity/draft/gig deep links return the generic shell; `/index.html` redirects to `/`.
  Package metadata, `.env`, server source and an API path return 404.
- Anonymous access receives a 302 Vercel authentication redirect. This is preview
  protection, not partner authentication or proof that the application API works.
- Preview/production toolbar flags read back false, and the toolbar script is absent
  from the exact-byte HTML. Deployment protection remains enabled.

Private operational evidence is retained outside Git in the release-preview-proof
and activity-preview-proof folders of the session's private work directory: a redacted proof manifest, hashes,
status/header observations and CLI logs. No authorization/bypass header is copied
into this document, the repo, URLs or frontend configuration.

The first attempt failed after inheriting storefront function configuration and
being labeled Production. No functioning production deployment resulted. The helper
now explicitly chooses Preview and the partner config. The next preview exposed a
provider-injected toolbar; project-scoped toolbar settings were then disabled and
the current clean preview was deployed and reverified. Provider history is retained.

## Commands and provider contracts

[deploy-cloud.py](../deploy/platform/deploy-cloud.py) previews every command unless
`--apply` is supplied. The new partner target defaults to an explicit preview
environment; production requires `--environment production`. It validates the local
project name/identifier shape before any settings mutation, patches only toolbar
flags, stops on failure and reports `verified: false` after upload until separate
acceptance is completed. Focused command contracts check exact target, working
directory/configuration, settings endpoint/method/typed fields and failure behavior.

Primary references: [Vercel deployment CLI](https://vercel.com/docs/cli/deploy),
[authenticated curl](https://vercel.com/docs/cli/curl),
[project settings API](https://vercel.com/docs/rest-api/projects/update-an-existing-project).

## Still required before production acceptance

This is a static preview, not a completed staging or production rollout. Protected
preview hosting may redirect credential-free worker prefetches; it is not evidence
of offline behavior on the eventual production origin. A `vercel.app` preview is
also cross-site from the business API, whereas the intended partner/API subdomains
share the business site. Native local browser tests remain useful regression
proof, but do not replace real same-site cookie/CORS/TLS smoke tests.

1. Complete the packet requirement-by-requirement audit, remaining timer/operations
   work, full feature BDD and API/recovery evidence. Current test counts alone do not
   prove all named packet scenarios.
2. Prepare an isolated synthetic native staging environment and the correct origins;
   verify authenticated cookie/CORS/CSRF boundaries and mobile/offline behavior.
3. Discover and retain redacted current Cloudflare DNS/TTL/proxy data. Obtain the
   new domain's exact required target from Vercel; never guess a CNAME/IP or modify
   storefront/work/api/status records.
4. Preserve the verified `20261024T143246Z` complete encrypted checkpoint and isolated
   database restore evidence in [VERIFICATION.md](VERIFICATION.md). Repeat a current
   checkpoint before cutover, and complete replacement-host/private-object restore,
   reviewed exact release source, additive migration and safe cutover verification.
5. Deploy the partner domain and native API with launch flags off. Verify TLS,
   headers, scope, unauthenticated denial, actual authorized role boundaries and
   unchanged existing sites/services. Record rollback identities and provider IDs.
6. Real professional review and owner launch authorization are separate gates. Do not
   enable invitations/gigs or fabricate approval/payment evidence to test deployment.

No production native API deployment, production migration, custom domain assignment,
DNS mutation, real invitation, payment or professional review occurred in this
preview increment. The overall partner portal goal remains active.


## Optional activity preview refresh

The current URL above supersedes the original protected static preview, whose source
was `8608e18`. All 14 current static files match local bytes/SHA-256 and all configured
hosting headers. Eight route checks cover activity/drafts/gig navigation, canonical
index redirect and private/server-path denials; anonymous HEAD returns authentication
302. No provider toolbar is injected. This verifies static hosting only: the native
partner API and actual production cookie/CORS/TLS paths remain undeployed/unproven.

The reviewed activity controls and all three packet activity scenarios pass native
browser evidence. The final 19-case native suite, 1,194 unit/contract tests, 304 browser
tests (one Windows skip), 241 UX checks and 133-image screenshot capture are
recorded in [VERIFICATION.md](VERIFICATION.md). Only the two new activity views and
updated preview board are new visual baselines. The exact remaining scenario audit
is [PARTNER-ACCEPTANCE-GAPS.md](PARTNER-ACCEPTANCE-GAPS.md).

## Authentication preview refresh

The current protected URL supersedes the activity preview
`3dprint4me-partners-fr1qrhv6b-jerrettdavis-projects.vercel.app`. All 14 v3 static files
match local bytes/SHA-256; all hosting headers, eight route checks and anonymous
302 protection pass. Enrollment errors remain visible after form reset without
covering retry controls. Export expiry removes the private view; delayed export
failures do not interrupt a later page. This upload changes only the dedicated
static preview. The native API, same-site staging and production domain remain pending.
