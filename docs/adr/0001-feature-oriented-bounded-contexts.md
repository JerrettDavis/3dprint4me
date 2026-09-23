# ADR 0001: Feature-oriented bounded contexts

- Status: accepted
- Date: 2026-09-22

## Context

3dprint4.me began as a small static storefront with a few serverless adapters. It now includes detailed project intake, quick inquiries, private uploads, notifications, checkout eligibility, an authenticated operator application, workflow state, and Push delivery. Several original entry points coordinate domain decisions and concrete providers directly, making otherwise well-tested behavior harder to change safely.

The storefront must remain static-first, inexpensive to operate, private by default, and useful without configured integrations. A framework or distributed-system rewrite would weaken those properties without solving a product problem.

## Decision

Organize server behavior into four bounded contexts: Project Request Intake, Quick Inquiry, Work Management, and Checkout. Each context owns its language, policies, use cases, ports, adapters, and tests. Vercel handlers remain transport adapters and browser entry points remain composition roots.

Dependencies point inward: transports and provider adapters may use application/domain contracts; application/domain modules do not import transports or provider SDKs. Cross-context sharing is limited to stable primitives such as HTTP parsing, safe strings, IDs/clocks, and application errors.

Use a layer only when it isolates a real policy or external dependency. Small focused adapters do not require ceremonial interfaces.

## Alternatives

- Global `domain/`, `application/`, and `infrastructure/` trees were rejected because they scatter each customer behavior across the repository.
- Hotspot-only file splitting was rejected because it leaves provider choice and domain ownership ambiguous.
- A framework rewrite was rejected because the current platform is appropriate for the storefront and would add operational cost.

## Consequences

- Feature behavior can be tested without HTTP or provider credentials.
- Provider selection has one composition boundary per feature.
- Some modules temporarily remain as compatibility adapters during incremental migration.
- Architecture fitness checks reject browser-to-server, domain-to-provider, feature-to-transport, and transport-to-provider-SDK dependencies.
- Every migration slice must preserve the public contracts and failure behavior before compatibility code is removed.

## Rollback

Each slice is independently deployable and committed. Application entry points can be returned to the prior compatibility adapter without reversing additive database changes. Schema and private data are not moved merely to match the new module structure.
