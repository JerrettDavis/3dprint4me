# Partner offline shell and draft continuity

Implements the approved packet P-03/architecture Offline PWA requirement within the
existing static partner application. The overall portal/deployment goal stays intact.

1. Add failing draft-preparation and real-worker browser regressions. Prove failure.
2. Extend drafts.js with opt-in minimal account/gig/revision preparation, bounded
   validation and cleanup. No titles, contact, consent, credentials or API responses.
3. Add static-only, same-origin worker allowlist, atomic precache and version migration;
   generic navigation fallback only for shell routes. API/POST/unknown/query asset
   requests bypass caches. Logout serializes cache clearing; next real sign-in prepares
   the shell again. No automatic replacement of an open edited page.
4. Add manifest/icon, registration, explicit offline workspace and prepared visit form.
   Offline access is device access, never authentication; entering an account identifier
   selects only local drafts. Sending requires a fresh authenticated same-account client.
   Cached config is only a public API origin. Reconnect never automatically sends.
5. Test offline cold reload, capture after preparation, reconnect/replay, cache contents,
   migration, logout cleanup and unsupported/blocked storage. Add native runtime proof.
6. Run required regression/build/static checks and screenshots; inspect board/full views,
   update documentation and record limitations. Review the whole increment and commit.

Ruling: preparation contains only account/gig IDs and expected revision, with explicit
opt-in. Accepted terms and current authorization remain online-only. Account selection
is typed after a cold offline reload rather than persisting an authenticated identity.
Drafts remain unencrypted business-only data, with the existing explicit device warning;
contact consent and all contact fields remain online-only. Timer lifecycle is a separate
remaining packet requirement and is not represented as solved by the worker.


Execution record: all six steps completed. Native cold-reopen and delayed real-cookie
regressions pass with production runtime/restricted PostgreSQL. Review found and
confirmed fixes for canonical cleanUrls caching, late Set-Cookie revocation and
unreadable-auth uncertainty; focused regressions cover unavailable workers and active
release preservation. The final source-frozen pipeline passes 16 native browser cases,
131 screenshots (new/full states and board inspected), 1,194 unit/contract tests,
300 browser tests plus one Windows skip, and 241 UX checks. No deployment or launch
activation is included. The full packet remains the binding completion scope.
