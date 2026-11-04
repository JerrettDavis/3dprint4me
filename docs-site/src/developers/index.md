# Run locally

## Prerequisites

Use **Node 22**, npm and Git. Browser verification uses Python and Playwright Chromium. Native partner integration tests also require the isolated PostgreSQL/container tooling described in the partner runbooks. Never point test harnesses at production databases.

```sh
git clone https://github.com/JerrettDavis/3dprint4me.git
cd 3dprint4me
git switch docs-source
npm ci
npm run customizer:build
npm run dev:workspace
```

The loopback workspace prints storefront and operator URLs, normally `http://127.0.0.1:4173` and `http://127.0.0.1:4180`. It enables loopback-only development authentication and ignored local work persistence. It does not establish hosted GitHub or partner authorization. Use `npm run dev` for just the storefront/local API. Stop with Ctrl+C.

## Configuration

Start with `.env.example` if you need an integration. Keep values private and server-only; never copy them into `public/`, screenshot fixtures or docs. The no-integration mode still provides a customer-recoverable request. Provider-backed production setup is covered in [deployment](deployment.md).

## Find the right module

- Public intake: `public/assets/js/order/`, `lib/project-request/` and thin `api/` handlers.
- Quick inquiry: `lib/quick-inquiry/` and the public homepage.
- Private work: `operator/`, `lib/work-management/` and related operator APIs.
- Customizers: `customizer/` builders and `public/assets/js/customize/` definitions.
- Print estimation: browser facts plus `lib/print-estimation/` server verification, snapshots and slicer workers.
- Partner: `partner/`, owner UI and the partner bounded context/API. See the [API contract](../../../docs/PARTNER-API.md).

Read [architecture](../../../docs/ARCHITECTURE.md) before changing boundaries. For customizer changes run `npm run customizer:build` and `npm run assets:version`; commit resulting version-query changes. Keep sensitive generator values out of metadata, drafts and requests.

## Your first change

Make one coherent change, add meaningful coverage, run the [verification sequence](testing.md), inspect screenshots and update the applicable guide/contract. Shared portal CSS has generated QA copies: run `npm run partner:qa:build`. The offline review reader has generated CSP-bound output: run `npm run review:reader:build` when changing its source.
