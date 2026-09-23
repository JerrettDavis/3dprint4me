# Home Assistant Work Peek Design

## Purpose

Expose a privacy-minimized, read-only view of current 3dprint4.me work to the owner's Home Assistant instance. Home Assistant shows queue details and raises alerts for newly created work, while every user interaction opens the canonical item in the authenticated operator application at `https://work.3dprint4.me`.

This integration observes work. It must never acknowledge, claim, update, or otherwise consume work or notification-outbox entries.

## Scope

The first release includes:

- a token-protected snapshot endpoint in the storefront/API deployment;
- a work-management query that reads active queue summaries without mutation;
- Home Assistant REST sensors, template entities, alert automation, and a dashboard card;
- canonical deep links to the operator application;
- configuration, rotation, failure-recovery, and verification documentation.

It does not include MQTT, a custom Home Assistant integration, bidirectional commands, customer contact details, request descriptions, estimates, uploaded-file metadata, private notes, or work-event history.

## Architecture

Home Assistant polls `GET https://3dprint4.me/api/home-assistant-work` using a dedicated bearer token stored in `secrets.yaml`. The API validates that token against the server-only `HOME_ASSISTANT_TOKEN` environment variable using a timing-safe comparison, then asks the work-management repository for one bounded snapshot.

The snapshot query is purpose-built rather than composed from repeated operator-list calls. This gives one internally consistent result, one database round trip, explicit field minimization, and no dependency on a human Neon Auth session. The query is read-only and cannot reach repository command, acknowledgement, event-cursor, Push, or outbox methods.

Home Assistant's REST integration polls the endpoint once per minute. Multiple entities derive from the same response so one polling cycle makes one HTTP request. An automation compares the latest creation marker to its prior valid state and sends a notification only when a new work item appears. The first successful poll establishes state without an alert. Restarting Home Assistant must not notify for every existing item.

## Authentication and transport

`HOME_ASSISTANT_TOKEN` is a separate, high-entropy secret used only for this endpoint. It is never written to `public/`, operator assets, response bodies, logs, URLs, documentation examples, or browser bundles. Production stores it in the storefront Vercel environment; Home Assistant stores the matching `Bearer ...` value in `secrets.yaml`.

The endpoint accepts only `GET`. Missing, malformed, or incorrect authorization receives a generic `401` response. An unconfigured production endpoint returns a generic `503`; it must not silently become public. Provider and database failures return a generic `503` and do not expose credentials, SQL, or raw internal errors. Responses use `Cache-Control: no-store`.

Token rotation consists of generating a new value, updating Home Assistant and Vercel, redeploying the API, and verifying one authenticated request plus one rejected request using the old token.

## Snapshot contract

The response is versioned and deliberately bounded:

```json
{
  "version": 1,
  "generatedAt": "2026-09-22T12:00:00.000Z",
  "queueUrl": "https://work.3dprint4.me/",
  "counts": {
    "active": 3,
    "unacknowledged": 1,
    "urgent": 1,
    "waitingCustomer": 2
  },
  "latestCreatedId": "work_example123",
  "items": [
    {
      "id": "work_example123",
      "title": "Replacement bracket",
      "service": "print",
      "status": "submitted",
      "priority": "normal",
      "acknowledged": false,
      "submittedAt": "2026-09-22T11:55:00.000Z",
      "targetDate": null,
      "url": "https://work.3dprint4.me/work/work_example123"
    }
  ]
}
```

`items` contains at most 20 nonterminal work items, ordered with the same operational priority policy as the operator queue. `latestCreatedId` identifies the most recently created work item across **all** statuses, independently of the active display order; it is `null` only if no work has ever been created. When no active work exists, active counts are zero and `items` is empty, but the marker retains the newest created ID. This prevents a terminal transition from moving the marker backward or to `null` and then causing a false new-work alert.

The count meanings are:

- `active`: all work not in `completed`, `declined`, or `cancelled`;
- `unacknowledged`: active work with no acknowledgement timestamp;
- `urgent`: active work whose priority is `urgent`;
- `waitingCustomer`: active work in `waiting_customer`.

Only operational summary fields are returned. The response excludes request IDs, customer names, email addresses, phone numbers, postal addresses, descriptions, specifications, model URLs, estimates, files, notes, event history, operator identities, and internal revisions.

All URLs are constructed server-side from the fixed canonical operator origin, not from request headers or stored customer data.

## Home Assistant behavior

The repository ships a copyable Home Assistant package and dashboard snippet under `integrations/home-assistant/`; it does not assume access to a separate Home Assistant configuration repository.

The package defines a single REST resource and derives:

- active, unacknowledged, urgent, and waiting-customer counts;
- the latest created work ID across all statuses;
- bounded item data used by the dashboard.

The dashboard presents count badges and a compact list of current work. The dashboard's queue action opens `https://work.3dprint4.me/`; each item action opens its exact `/work/<id>` URL. There are no acknowledge, status, priority, assignment, note, or other mutation controls in Home Assistant.

The alert automation triggers when `latestCreatedId` changes from one valid work ID to a different valid work ID. The first successful poll establishes state without an alert, including when the prior state is empty or unavailable. The notification title and message contain operational summary data only. Its click action uses the canonical operator URL derived from the validated marker, even if that work has already left the active list. The shipped baseline creates a Home Assistant persistent notification; optional mobile delivery uses an installation-specific notify action.

Polling failures make the integration unavailable without clearing or mutating work. Recovery on a later successful poll resumes from the current snapshot. The API does not promise delivery of every intermediate item created and completed entirely between polls; the operator inbox remains authoritative.

## Code boundaries

- `lib/work-management/` owns the snapshot policy and repository operation.
- Neon and local repository adapters implement the same read-only snapshot contract.
- `api/home-assistant-work.js` owns HTTP method handling, bearer authentication, response serialization, and generic errors.
- `integrations/home-assistant/` contains deployment examples only and is never part of `public/`.
- `.env.example`, architecture, deployment, operations, and verification documentation describe the new secret and runbook.

No Home Assistant code imports provider adapters directly. No API route queries Neon directly. No existing operator authentication or mutation route is weakened or reused as a machine credential.

## Testing and verification

Unit and contract coverage proves:

- exact bearer-token acceptance and rejection, including malformed headers;
- missing configuration fails closed;
- only `GET` is accepted;
- snapshot counts, active-status filtering, limits, ordering, latest-created semantics, empty state, and canonical URLs;
- local and Neon adapters satisfy the same snapshot contract;
- response field allowlisting excludes every private request/detail field;
- snapshot reads do not call mutation, event-cursor, Push, or outbox operations;
- database and unexpected failures yield generic responses without secrets or raw errors;
- `Cache-Control: no-store` remains present.

Repository validation checks the Home Assistant examples for the production endpoint, secret indirection, polling interval, notification deep link, dashboard deep links, and absence of mutation endpoints.

Before release, run `npm test`. This feature has no storefront visual change, so the storefront screenshot gate is not required. Validate the Home Assistant YAML with the target instance's configuration checker, then verify in production:

1. anonymous and incorrect tokens receive `401`;
2. the correct token receives the bounded snapshot;
3. one synthetic request appears on the dashboard without becoming acknowledged;
4. one alert arrives and opens its exact `work.3dprint4.me` item;
5. refreshing and polling repeatedly do not alter work revision, acknowledgement, events, or outbox state;
6. completing the synthetic item in the operator app removes it from the active snapshot;
7. removing or rotating the API secret fails closed and recovers after coordinated configuration.

## Operational guarantees

The operator application and database remain authoritative. Home Assistant is a convenience display and alerting client, not a workflow engine or delivery queue. An unavailable Home Assistant instance cannot block intake, persistence, existing email/webhook delivery, Web Push, or operator work management.

The integration adds no public analytics, third-party tracking, database migration, browser secret, public customer-data endpoint, or payment-state inference.
