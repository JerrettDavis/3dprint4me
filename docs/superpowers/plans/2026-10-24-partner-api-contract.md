# Partner API contract implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Keep the existing isolated worktree; do not supersede current-head CI merely for a plan commit.

**Goal:** Deliver the actual native API schema and maintenance checks required by packet delivery gate J, without advertising proposal-only endpoints or changing authorization.

**Architecture:** Keep the schema in docs, outside static output. Document actual partner routes and owner resource/command multiplexing, independent cookies, exact origins, CSRF, JSON command keys, errors and bounded reads. Derive a command field/role inventory from existing command factory metadata without executing commands, querying databases or importing private data. Preserve unknown nested domain constraints as explicit incomplete work until typed per-command and per-resource schemas are verified.

**Tech stack:** Existing Node modules, JSON OpenAPI 3.1, Node contract tests; no runtime dependency.

**Spec:** Private packet api/openapi.yaml (proposal), agent/DELIVERY-GATES.md J; lib/partner-outreach/http.js and application.js are current transport authority. OpenAPI structure follows https://spec.openapis.org/oas/v3.1.1.html .

## Constraints and review focus

- No runtime behavior, database, cookies or provider changes.
- No private packet copies, secrets, actual partner data or live API assertions.
- Idempotency is JSON body key, not the proposal Idempotency-Key header.
- Authentication provisioning commands have different replay semantics from application command receipts; document that distinction.
- Server authorization and domain validation remain authoritative; an allowed field list does not prove a nested payload valid.
- Owner/partner data separation, error sanitization and no-store headers must agree with existing HTTP tests.

## Task 1: Actual transport and command inventory

- [x] Write failing assertions for actual routes, cookie names, CSRF, command envelope, auth exceptions, body limits and role inventory.
- [x] Add docs/partner-openapi.json and a maintained inventory builder/checker; schema has no production server URL claim.
- [x] Test command metadata against factories used by the application and references/path inventory against handlers.
- [x] Update portal/verification docs with exact schema coverage and remaining typed domain work; run required verification, review and commit locally. Hold push until current materials-head CI settles.

## Task 2: Complete domain contract

- [x] Specify typed inputs for all 57 commands and exercise representative actual positive/negative application journeys. Dynamic policy remains server-authoritative; complete response/query work is still required.
- [x] Specify resource-specific and command-result responses, canonical query requirements and bounded-history/download semantics; test populated application results and actual native HTTP reads.
- [x] Validate the maintained v1 OpenAPI structure/components against the official schema, document populated application examples plus native HTTP replay, complete focused review fixes and full regression. Production behavior remains a separate release gate.
