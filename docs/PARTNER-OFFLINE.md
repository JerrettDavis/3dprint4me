# Partner offline operation

The partner shell is installable from its web manifest and works without installation.
It caches only its generic HTML, public API-origin configuration, fixed JavaScript/CSS,
manifest and brand icons. No API request, POST body, personal contact, session, CSRF,
legal document, payment record or accepted offer is placed in Cache Storage. Unknown
routes and asset URLs with query strings bypass the worker. Preparation uses requests
without credentials and rejects redirects; the native Cache.addAll operation commits
the static set atomically. Private API reads remain no-store.

## Prepare before losing connectivity

Open an accepted gig's visit form online and choose **Prepare this gig for offline
business drafts**. Successful preparation stores only your account identifier, gig ID
and expected revision, with an explicit device warning. At most 20 prepared gigs are
kept per account. It stores no private title, terms, account profile or authentication
state. Keep your account code privately available. Successful preparation requires an
available static worker/cache; if it fails, keep the current form open and use the
business-draft save button, or arrange the owner's no-app alternative.

Business-only drafts require a separate explicit device-storage acknowledgment. Never
put personal contact details in business fields. These device records are **not
encrypted**; anyone using this browser profile can read them. Browser storage limits,
device loss and clearing site data can remove them. A saved draft is not a submission.
The existing 100-draft limit applies separately from the prepared-gig limit.

## Reopen offline

After preparation, reopen the same partner origin and browser profile, including the
installed app if used. The generic offline workspace asks for the account code to
select that account's local records. This is device access, not a password or an
authenticated session. It never unlocks submitted records. You can inspect/remove
saved drafts or open a prepared business visit form. Prepared context is advisory:
check current permitted tasks/area and status online before undertaking new work.
Personal follow-up permission and contact fields cannot be used in this offline form;
server submission is disabled. Saving says **Saved on this device. Not submitted yet.**
Closing/reloading retains explicit saves, not unsaved form edits or contact details.

## Reconnect and send

Use **Reconnect and sign in** to reload and revalidate the server session, or sign in
again. Open **Device drafts** and explicitly send pending business drafts. Reconnection
never sends anything automatically. Only the currently authenticated account can send
its own local records. The server rechecks account, gig state and revision and validates
all fields. Each stored visit retains its client UUID and command key across uncertain
responses, reloads and retries. Successful receipts remove the device copy. Conflicts
stay marked **Needs review** and are not automatically resent or silently rewritten.
Check current gig and recorded visits before replacing a conflicted draft.

## Sign-out, shared devices and failure

Sign-out clears all account namespaces of device visits/preparation and all partner
shell cache versions, then revokes the server session. Other open partner tabs supporting BroadcastChannel receive
a sign-out broadcast and clear their private view/in-memory authorization. Delayed
reads cannot restore an old view. A late login/recovery/session response can already
have applied its cookie; superseded authentication revokes that result using its own
transient CSRF without restoring local sign-in. If its body/network or cleanup is
unavailable, the local view and broadcast-capable tabs receive a generic uncertainty warning: close the browser and
ask the owner to revoke access. Never treat a network failure as verified sign-out.
Close all partner tabs when finishing on a shared device, including browsers without
cross-tab broadcast support. Downloaded files remain on disk and must be removed separately on a shared device.
Browser features and storage can be blocked; failure messages retain the no-app path.

## Worker releases and hosting

`partner/public/sw.js` owns only caches beginning `partner-shell-`; unrelated origin
caches are preserved. Bump its cache version and the matching HTML release marker when changing any
precached file. Preparation preserves a complete active static set. If that cache
is absent and the deployed shell has a newer marker, an older worker refuses
reseeding until tabs are closed and the matching worker can activate. A newly
installed worker waits while old controlled tabs remain open. It never forces an
edited form to reload; save drafts and close partner tabs before reopening to use an
update. Activation removes prior partner cache versions and claims clients. Seed and
clear operations are serialized, and local generation checks discard queued preparation
after sign-out. A subsequent real sign-in prepares the public shell again.

The shell key is `/`, and Vercel rewrites use `/` as their destination. With
[cleanUrls enabled](https://vercel.com/docs/project-configuration/vercel-json#cleanurls),
Vercel redirects `.html` requests. The development host therefore returns 308 for
`/index.html`; regressions exercise this behavior so redirect-rejecting installation
cannot accidentally depend on a loopback-only URL. Chromium installability and manifest inspection reports no errors for the local
release candidate. The PNG icon sizes are rasterized
from the existing brand SVG, with no external font or asset dependency.

## Evidence and remaining scope

Unit/browser/native coverage includes minimal preparation, cold offline reopen,
explicit replay and no duplicate server visit, static cache exclusion, prior-cache
migration, unknown routes, account boundaries, sign-out across tabs and held real
login cookies arriving after another tab's completed sign-out. These synthetic tests
are separate from production DNS/TLS/cookie/cache smoke tests. Optional activity timer
lifecycle, the remaining complete packet scenarios and operational/deployment gates
remain separate requirements; this document does not mark the portal released.
