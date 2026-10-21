# Direct GitHub operator authentication

The 2026-10-20 user decision supersedes Authentik as the planned platform identity dependency. GitHub hosts identity; Vercel hosts the storefront, operator shell, and independent status UI; Cloudflare hosts independent monitoring and the outbound API tunnel. Local services are the private PostgreSQL database, API, and necessary background workers. Existing unrelated Authentik remains untouched.

Create a separate GitHub OAuth app with homepage `https://work.3dprint4.me` and the single exact redirect `https://api.3dprint4.me/api/auth/callback`. Disable wildcard matching and device flow. The migration app ID is `3950573`. Do not change the legacy Neon OAuth app before cutover.

Keep `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in private server configuration or a secret store. Never place them in `public/`, the operator bundle, screenshots, or GitHub source. Set `PLATFORM_TARGET_AUTH_PROVIDER=github`, `OPERATOR_API_ORIGIN=https://api.3dprint4.me`, `OPERATOR_WEB_ORIGIN=https://work.3dprint4.me`, and `OPERATOR_OWNER_SUBJECT` to the independently confirmed numeric GitHub account ID. The owner account ID is `2610199`. The migration gate checks the exact `https://github.com/` issuer and subject binding against the existing enabled owner operator before switching. Username and email never grant access.

The server uses OAuth authorization code flow with PKCE S256 and a one-time cookie/state-bound flow. An empty scope requests no repository access. The server exchanges the code using its confidential credential, then calls GitHub's authenticated user endpoint with an ephemeral token. Only a positive numeric User account ID is accepted. Provider tokens are never retained or returned to the browser. This is OAuth identity verification through GitHub's API, not OIDC token verification.

The application issues its own eight-hour Secure, HttpOnly, SameSite=Lax host cookie and stores only its hash. Existing rate limits, shared flow capacity, exact-origin logout, explicit operator bindings, and sanitized provider failures apply. During bridge mode, native sign-in fails closed until target activation selects GitHub. Operator browser config publishes only the provider name and API base.

Recovery requires the encrypted database backup (including identity bindings), the private GitHub credential, and the documented HTTPS callback route. GitHub credential rotation requires reauthentication in GitHub settings; retain a working credential until replacement login is verified. An outage of the local API still affects sign-in and dynamic operations, while the hosted storefront and status dashboard remain independently reachable.

Protocol references: [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [authenticated user API](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).
