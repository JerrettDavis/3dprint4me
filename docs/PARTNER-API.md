# Native partner API contract

[partner-openapi.json](partner-openapi.json) describes the implemented native transport,
not the private packet's proposal paths. It is an OpenAPI 3.1.1 document following the
[official specification](https://spec.openapis.org/oas/v3.1.1.html). The relative server
URL deliberately makes no claim that a production origin is deployed.

The contract describes the current native API; deployment acceptance remains separate.
It covers every registered path, independent session cookies, exact-origin checks,
CSRF, JSON command envelopes, route body limits, shared errors and all 57 command
roles/allowed-field sets. Action-specific input schemas provide primitive types,
required fields, bounds and nested offer/contact/material/reviewer structures. The
role-scoped envelope selects the matching input schema; owner statement exports
require a partner ID. Resource and command-result schemas describe successful responses.
The owner multiplexer has an explicit x-resource-contracts map of response references
and canonical query schemas; ordinary partner reads expose x-query-schema. Server-state
and policy checks cannot be inferred from structural schema acceptance.

## Read and authenticate

Partner reads use `/api/partner/v1/<resource>` and only return that partner's records.
Owner reads use `/api/operator-partners?resource=<resource>`, defaulting to programs.
Read the matching session operation to obtain its CSRF token. Cookies are HttpOnly
and Secure: use browser credentials rather than reading or constructing cookie values.
The partner cookie is `__Host-3dp-partner`; the owner's independent session cookie is
`__Host-3dp-session`. A partner cookie never grants owner access.

Every POST and OPTIONS request requires the exact configured Origin. GET requests
may omit Origin; when present, it must match too. All private responses are no-store.
The native HTTP contract tests exercise wrong origins, independent cookies, CSRF,
role denial, unknown fields and sanitized failure behavior. Same-site HTTPS browser
cookie behavior still needs deployment acceptance.

The registered partner `export` route does not grant access to owner accounting
exports: it returns 404. Partners download their own generated data/statement copies
through `own-export`. Optional activity records are partner-only, including when the
caller is an owner. A registered transport path does not override application roles.

## Send a command

POST to `/api/partner/v1/commands` or `/api/operator-partners` with Content-Type
`application/json`, the matching Origin and `X-CSRF-Token`. The JSON body contains
exactly `action`, `input` and `key`. Use a fresh UUID key for a new application command;
retry the same action/input/key after an uncertain response. A changed payload under
the same key conflicts. `Idempotency-Key` is allowed by preflight but is not consumed
as the command key. Ordinary input values remain subject to server validation and
current lifecycle, ownership and revision checks.

**Authentication exception:** `partner.invite` and `partner.revoke` are handled by
the authentication subsystem, not application command receipts. Their required body
key does not deduplicate them. Reissuing an invitation revokes the prior unused link
and returns a new one-time token. Do not blindly retry invitation creation expecting
the same token. Tokens must be handed off privately and never logged or put in URLs.

## Maintain the document

Run `node scripts/build-partner-api-document.mjs` after command metadata changes.
`node scripts/build-partner-api-document.mjs --check` checks generated freshness.
The builder imports only existing command factories to read roles/allowed field names;
it does not run commands, access a database or consume environment credentials.
The ordinary contract suite checks generated freshness, local schema references,
registered paths, cookie/CSRF/envelope invariants and all application command factories.
No new production route, authorization behavior or database grant is added. The
Python test toolchain adds jsonschema (development only) to validate published
inputs against actual disposable synthetic application journeys.
The document remains under docs and does not enter static output.

## Input validation evidence and limits

`python -m pytest tests/e2e/test_partner_api_schema.py -q` runs no browser and makes
no remote request. It creates a disposable synthetic PGlite application and validates
actual successful command inputs plus malformed examples against local JSON schemas.
Examples include authorization, acceptance, materials, unconsented visit rejection,
settlement/reversal, profile clearing, statements, optional activity and draft editing.
No real invitation token is emitted or saved. This is application-validator evidence,
not native PostgreSQL privileges or hosted HTTPS evidence.

A structurally valid excessive return is intentionally accepted by the schema and
rejected with 409 by the actual server. The server also remains authoritative for
revision/lifecycle, complete-history balances, consent changes, normalized duplicate
identities, exact stored template variable bindings, review expiry/scopes, accepted
bonus rules, current program gates and independent settlement. Input schemas describe
intended client payloads; permissive ignored legacy values are not a promise of support.
String limits follow server JavaScript code-unit checks, which may be stricter than
JSON Schema code-point maxLength for supplementary Unicode characters. Deployment
acceptance remains required before treating hosted behavior as verified.

Canonical restrictions are intentional: with consent=false omit contact and purpose
rather than sending null/empty placeholders; omit unused contact fields rather than
sending ignored falsy values; if refundTreatment is supplied for a qualified-lead
rule, supply valid text even though the server ignores it for that trigger. These
restrictions define supported client payloads, not every permissive legacy input.
Optional clearable text permits null or exactly empty strings, but never whitespace
only. Template defaults must match their declared descriptor type. Consent/contact
failures can return HTTP 422, preserved by the shared error contract.

## Response and query models

Each command result is linked by action in x-command-responses; endpoint responses
use anyOf because overlapping result shapes do not carry an action discriminator.
Owner responses include the session CSRF token in addition to the application result.
SQL-backed row models allow additive fields; private audit/evidence/settings payloads
are explicitly extensible JSON. They are not an invitation to accept arbitrary client
input. Normalized OfferSnapshot output is distinct from canonical OfferTerms input.

Canonical query schemas identify required gig/export/version IDs, exact comparison
IDs, optional owner program scope and statement cursor rules. The owner resource
parameter selects its map entry; it defaults to programs. Transport also rejects
unknown or duplicate query parameters. Do not append a bare question mark to an empty
query: the platform rejects noncanonical URL forms before handler CORS processing.

Gig lists cap at 500; gig detail returns up to 200 work events, newest 200 material
events with materialsHasMore, and 100 negotiations. Visit/lead/activity lists cap at
1000. Statement history pages cap at 100 with nextCursor; id downloads the immutable
CSV and cannot be combined with before. Accounting/personal export scopes over 10000
records require owner-assisted reconciliation rather than a silent incomplete export.
Review packages expire and return 410; signed bytes/hashes and independently trusted
public-key fingerprints still require client verification. Own-data copies also expire
or become unavailable after corrections; a new copy is then required.

The maintained example journey now includes populated consented leads, an earned
referral, active optional activity, generated weekly statements and a statement CSV,
plus actual signed review-package and DOCX-feedback reads. The separate native case
`test_native_http_read_results_match_published_api_schemas` validates 20 real browser
HTTP reads against disposable PostgreSQL, including owner session/CSRF composition,
private no-store headers and zero observed outbound fetches. These are synthetic
loopback acceptance checks; production same-site HTTPS and actual review/provider
clearance remain independent release gates.
