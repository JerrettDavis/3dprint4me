# Private status provider capacity

Provider collection runs in the independent status Worker, at most hourly; protected page requests only read its cached snapshot. Nothing in this document authorizes provisioning, token scope expansion, plan upgrades, deployments or additional Blob reads. All variables below are Worker secrets/configuration, never storefront/browser environment values.

## Configuration and supported evidence

| Provider | Server-only configuration | Evidence |
| --- | --- | --- |
| Vercel | `CAPACITY_VERCEL_TOKEN`, `CAPACITY_VERCEL_TEAM_ID`, `CAPACITY_VERCEL_SKUS` | Team/account usage from documented FOCUS billing charges. No included allowances are returned. |
| Cloudflare | `CAPACITY_CLOUDFLARE_TOKEN`, `CAPACITY_CLOUDFLARE_ACCOUNT_ID` | Account Workers requests and SQLite Durable Object rows read/written, since UTC midnight. No plan limit is returned. |
| Resend | `CAPACITY_RESEND_KEY` | Account daily/monthly email used/limit/reset and API request ceiling/window. |

Use an existing appropriately scoped credential. Vercel documents supported team roles as Owner, Member, Developer, Security, Billing and Enterprise Viewer. Cloudflare requires account analytics read permission for the selected account and access to the queried datasets. Resend's usage endpoint requires a **full-access** key: a send-only key must not be silently upgraded or replaced. If an existing suitable key is unavailable, leave this integration unconfigured. Missing/rejected credentials and unsupported datasets/plans produce no new reading; previous readings keep their original evidence time and age out.

`providerCoverage(env)` returns only fixed provider names and `configured`/`unconfigured` codes; configured means configuration exists, not that an authenticated query succeeded. Collection's optional `onAvailability` callback reports only `{provider,status,retryAt}` with fixed statuses `ok`, `unavailable`, `rate-limited`. The Worker persists the callback and passes `skipUntil` back on later collection calls. A 429 honors numeric seconds or HTTP-date Retry-After, conservatively bounded between one hour and seven days; missing/invalid Retry-After waits at least an hour. There are no inline retries.

## Vercel billing and Blob

The only Vercel request is authenticated `GET https://api.vercel.com/v1/billing/charges?teamId=...&from=...&to=...`. It returns newline-delimited FOCUS 1.3 records. This is an account/team total, including other projects; it must never be described as this storefront alone. The collector deliberately makes **no** Blob object list/get/download requests.

Vercel documents `SkuId` as its stable product identifier, but its public endpoint schema does not publish the account's product catalog. Supply a reviewed mapping of actual SKU IDs from that account's documented billing response, for example this structural template (replace the placeholders with actual IDs):

```json
{"blob-transfer":"ACTUAL_BLOB_TRANSFER_SKU","blob-simple":"ACTUAL_BLOB_SIMPLE_SKU","blob-advanced":"ACTUAL_BLOB_ADVANCED_SKU","vercel-transfer":"ACTUAL_TRANSFER_SKU","vercel-functions":"ACTUAL_FUNCTION_SKU"}
```

The only supported mapping keys are `blob-transfer`, `blob-storage`, `blob-simple`, `blob-advanced`, `vercel-transfer`, `vercel-functions`. Mapping an unknown product or the same SKU twice is not a substitute for verification. The adapter ignores unmapped products, non-Usage charge categories, costs, project tags and provider display names. It requires the returned `SubAccountId` to match the configured team and validates every mapped quantity and charge interval. A bad mapped row invalidates that metric's aggregate rather than understating it.

Units are strict: byte/bytes, decimal GB or binary GiB become bytes; operation(s)/request(s) become operations; documented `GB-Seconds` becomes GB-seconds for function execution. `PricingQuantity` and currency costs are never treated as usage. In particular, **GB-month, byte-hours and similar storage integrals cannot become instantaneous bytes**. `blob-storage` stays unavailable unless the actual API returns a compatible byte quantity for a reviewed storage SKU. Unsupported active CPU, provisioned memory or other function SKUs also stay unavailable. Never map a differently dimensioned SKU to function execution.

The API promises daily granularity. The query covers the current UTC calendar month through the last completed UTC day; on the first day of a month no billing request is made. These are calendar-month reporting windows, not an assertion about a team's subscription anniversary. Every billing reading has `partial:true`, a monthly accounting interval, and `coverageEnd` for the last completed day. Fresh collection time does not imply today's charges are complete or that provider billing delay has ended. Usage is a lower bound; a threshold already crossed can warn, but below-threshold partial evidence must not show green/recovery and remaining allowance is only an upper bound. There is no fabricated zero for products missing from the response.

## Cloudflare analytics constraints

One authenticated `POST https://api.cloudflare.com/client/v4/graphql` queries `workersInvocationsAdaptive.sum.requests` and `durableObjectsPeriodicGroups.sum.rowsRead/rowsWritten`, using variables for the account and UTC day-to-collection interval. Queries select no script names, customer identifiers, logs or individual objects. They request the ungrouped aggregate (one result); empty/malformed groups do not become zero. GraphQL schema/permission errors leave the provider unavailable. Access and adaptive analytics availability depend on account plan; test with the existing credential before relying on coverage. Analytics can be delayed or sampled and is not a billing invoice.

Cloudflare's official Durable Objects documentation describes dataset discovery/introspection and permits selecting available additional fields. The rows selection is explicitly subject to the configured account's schema validation; an unavailable field fails safely. The collector does not infer a free plan or attach free-tier constants to a paid account. Its daily reporting window can use an explicit daily operator budget; paid monthly included allowances cannot be attached to that daily window.

**Durable Object storage remains unavailable in this initial adapter.** The published example's `durableObjectsStorageGroups.max.storedBytes` is not a verified sum of current SQLite-backed account storage. A maximum over objects/namespaces is not the account's stored bytes. Neither KV storage nor a peak storage sample is relabeled as SQLite account storage. Adding this requires verified SQL dataset semantics, complete namespace coverage and bounded pagination. The fixed `cf-do-storage` metric remains visibly unsupported rather than showing zero or a guessed total.

## Resend quota semantics

The request is authenticated `GET https://api.resend.com/usage`. Daily is documented as a **rolling 24-hour quota**, not a midnight calendar-day counter. The API reports `resets_at` but no start: `periodStart` remains null. Monthly reset is provider-reported too. A null daily limit explicitly means unlimited; null monthly limits and malformed/missing usage are rejected. Email usage includes sending and receiving as the provider reports it.

`rate_limit` reports only `{limit,duration}`, with duration such as `1000ms`. `resend-rate` preserves it as `rateWindowMs` with `used:null`. This is a ceiling, not an observed request rate or a claim of zero requests. Unsupported duration formats remain unavailable. Do not derive rate consumption from the hourly sample.

## Explicit limits and budgets

Optional `CAPACITY_PROVIDER_LIMITS_JSON` associates a fixed provider metric ID with `{limit,unit,periodStart,periodEnd,source,verifiedAt}`. Numbers use epoch milliseconds for dates. The unit must exactly match the registry, and both accounting boundaries must exactly match the provider reading. It never overrides an actual provider-reported limit. Example of an operator-selected monthly transfer budget (not an included provider allowance):

```json
{"blob-transfer":{"limit":10000000000,"unit":"bytes","periodStart":1793491200000,"periodEnd":1796083200000,"source":"configured"}}
```

`source:"configured"` means an explicit operator budget, not provider plan evidence. Missing source or `source:"manual"` means a manually checked allowance and requires `verifiedAt`. The snapshot retains `limitSource:"manual"`/`limitVerifiedAt`, including expired verification; the model expires manual allowances after 24 hours and suppresses percentage/threshold decisions until renewed. Do not use a configured budget label to bypass expiry of an assertion about the provider's plan. Set the current window deliberately; stale or mismatched windows are ignored.

## Failure and resource bounds

All origins/paths are fixed HTTPS endpoints. Redirects are rejected. Each request has an eight-second abort deadline and a one-MiB decoded response cap; JSONL has a 10,000-row cap. Provider requests run concurrently. No raw response, exception, account identifier or secret is returned or logged. Only successfully parsed, finite, nonnegative, safe-range values leave the adapter. Optional callback errors cannot discard valid readings. Failure in one provider does not discard another provider's evidence. HTTP 200 alone is not successful coverage: GraphQL errors, invalid response schemas and wholly invalid mapped billing rows report unavailable. A valid empty billing result is successful API availability but creates no fresh usage readings; existing evidence still ages.

At most three requests per hourly run (72/day when fully configured); there are no additional object reads, tracking integrations or email sends in this module. The existing scheduler and snapshot retention own caching/backoff/state limits. An account billing response larger than the cap remains unavailable; do not silently paginate/truncate and claim a complete total.

## Official references (verified 2026-11-25)

- [Vercel list FOCUS billing charges](https://vercel.com/docs/rest-api/billing/list-focus-billing-charges): endpoint, daily granularity, JSONL, team scope, role access and stable SKU identifiers.
- [Vercel billing API announcement](https://vercel.com/changelog/access-billing-usage-cost-data-api).
- [Vercel CLI FOCUS types](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/billing/focus-charge.ts) and [official CLI usage fixture](https://github.com/vercel/vercel/blob/main/packages/cli/test/unit/commands/usage/billing-costs-mock.ts): consumed quantities/units, including GB-Seconds.
- [Cloudflare Durable Objects metrics and analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/): datasets, schema discovery and the storage maximum example.
- [Cloudflare querying Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), [GraphQL discovery](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/), [GraphQL authorization](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/).
- [Resend retrieve usage](https://resend.com/docs/api-reference/usage/retrieve-usage) and [account usage announcement](https://resend.com/changelog/account-usage-api): schema, rolling daily quota, reset, unlimited daily quota and full-access key requirement.

Unit contract check: `node --test tests/unit/status-capacity-providers.test.mjs`. This suite makes no authenticated external requests. Live availability/permissions, actual Vercel SKU units and deployment resource budget still require existing-account verification before operational reliance.
