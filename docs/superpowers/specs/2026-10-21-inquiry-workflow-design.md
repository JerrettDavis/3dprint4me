# Inquiries, project requests and customer handoff

## Intent and authorization

An inquiry is a conversation that needs a response. A project request contains
the details needed to scope work. Both belong in the private work inbox, without
making an inquiry look like a confirmed project, quote or order.

The owner requested clearer customer choices, inquiry work items, customer
handoff and operator conversion. They explicitly chose both customer completion
from a shared link and operator conversion. Their standing instruction is to
continue authorized work through completion; invoice dispatch remains manual,
no paid services are added, and secrets remain outside source and public output.

This design uses the existing static storefront/operator, private API/PostgreSQL,
Blob storage and notification boundaries. No new provider or dependency is needed.

## Customer experience

- Call the short path **Ask a question** and explain: send an idea, question,
  photo or reference; the shop will respond before agreeing on work or pricing.
- Call the longer path **Start a project request** and explain: choose a service,
  provide project details and files, and review a non-binding planning estimate.
  Neither path books work, takes payment or creates an invoice.
- Show these choices together where customers currently enter the inquiry flow;
  preserve direct access to the four existing service paths.
- After a received inquiry, offer **Continue to a project request**. Preserve its
  contact details, message, reference and privately received attachments. The
  customer still chooses the service, supplies missing fields and explicitly
  accepts terms. An inquiry's intent never silently selects consulting or another
  service. Review copied details before final submission.
- On failed/offline inquiry delivery, keep the recoverable copy and offer the
  detailed form with local text prefill, while stating that receipt is unconfirmed.
  Do not claim uploaded files were received or attach them by filename alone.

## Private work inbox

Use the existing work-item identity, notes, assignments, priority, revision checks
and append-only history. Add a source kind, `inquiry` or `request`. A new inquiry
appears in the default inbox as **Inquiry · Needs response**, with submitted time
and a neutral message excerpt. A full request retains its service and project title.
Filters distinguish inquiries from requests without treating an inquiry as a fifth
service. Inquiry detail shows contact information, the original message/reference,
authenticated attachments, notes, and follow-up controls.

Inquiry transitions are needs-response, reviewing, waiting-on-customer and closed.
Map these onto the existing submitted/triage/waiting_customer/completed storage
states, with kind-specific validation and labels. Do not expose production states
such as scheduled, printing, quoted or approved while the item is an inquiry.
Acknowledging an item is separate from recording that a response was sent.
Replies remain manual; provide a mail composer/copyable recipient and reference,
never send customer email automatically. Marking waiting/closed records an audited
operator action, not delivery verification.

Backfill every submitted inquiry missing a work item, including the inquiry
received on 2026-10-21. Never backfill unfinished drafts, replay owner email, or
silently mark old records responded. Preserve their actual submitted timestamps.

## Customer handoff and operator conversion

The inquiry detail offers **Copy project-request link**. Sharing is manual. The
public success screen can create the same scoped handoff using the existing
inquiry submission capability. Only an authorized operator or the exact inquiry
owner capability can issue a handoff. A plain inquiry ID/email is never authority.

A handoff uses at least 32 random bytes. Store only its digest, inquiry ID,
expiry, issuing actor and bound project draft; return the raw value once. Default
expiry is seven days. Regeneration revokes earlier unused links. Put the capability
in the URL fragment, never a query string; the landing script clears the fragment
immediately and sends it only in explicit HTTPS JSON requests. Keep it in memory,
not analytics, logs, filenames, downloads, browser-persisted drafts or model metadata.
The link is a deliberately scoped private customer invitation, not an operator
credential. It grants only inquiry prefill, associated draft uploads and completion
of that same project. It cannot read notes/history/billing or list other records.
No third-party scripts or tracking are introduced. A GET never mutates business data.

The existing inquiry/request functions serve fixed handoff actions; do not exceed
Vercel's existing function limit or widen the proxy into an arbitrary gateway.
Redeeming a valid link returns only customer-supplied inquiry context and safe
attachment descriptors. Downloads require the same scoped capability or operator
authorization; Blob objects remain private. Reference URLs are never fetched.
An expired/revoked link gives a safe error with a normal fresh-request alternative.
The capability remains required for every create, upload and completion action on
a handoff-bound draft, including requests that omit handoff fields; knowing its
request ID must not bypass revocation or expiry. A recovered local inquiry receipt
without its original submission capability may prefill text but cannot link private
files or claim association. Preserve inherited files from trusted server records,
verify their private objects, and merge them separately from new request uploads.
Do not relax ordinary uploaded-file path validation to accept arbitrary inquiry paths.

The operator can instead **Convert to project**, explicitly choosing service and
project title and confirming copied contact/context. This creates an **operator-
prepared project draft** when customer details are incomplete. Do not manufacture
customer consent, dimensions, estimates or service-specific answers. Clearly show
what remains missing and retain customer handoff for completing those details.
The operator has created actionable project work; a complete customer submission
is not claimed. Detailed completion still uses the existing server validation.

Both paths retain the same work-item ID and inquiry provenance, notes, attachments,
assignment and history. Customer completion binds the actual submitted request to
that work item and records a conversion event. If an operator already prepared a
draft, customer completion fills that draft instead of creating a second project.
Locks, unique constraints and idempotency make conversion/completion races choose
one request/work item. Replays return the original result. An existing confirmed
project cannot be overwritten using an old inquiry link. Reusing a completed
handoff may recover its receipt but never read or edit submitted private details.

## Storage and application boundaries

An additive migration extends `work_items` with kind and a unique inquiry foreign
key, making request_id nullable for inquiry work. Constraints require inquiry work
to have an inquiry and no request, and request work to have a request; converted
request work retains its optional unique source inquiry. Events can reference the
work item without a request ID before conversion. Keep all existing request FKs,
authorization and full-request behavior intact. Add private bounded handoff records
with expiry/revocation and indexes. Apply explicit backend grants/RLS; browsers
receive no SQL credentials. Runtime may not edit operator roles or identity bindings.

Complete an inquiry and create its work/event/outbox atomically. Successful receipt
does not depend on email or push success. Replay must repair a previously submitted
inquiry missing its work item without duplicating notifications. Backfill is
idempotent and reruns after deployment to cover submissions during the rollout.
Represent inquiry kind consistently in native/local adapters, event polling, push,
Home Assistant, pagination and public-safe aggregate status. Home Assistant uses
a neutral inquiry title rather than customer messages/contact details; push payloads
remain generic. Full requests retain backward-compatible response shapes where possible. Protect inquiry files
through the work-item source relationship; never accept arbitrary Blob paths.

Do not make inquiry or incomplete project-draft payloads look like valid public
project submissions by setting consent=true or a fabricated $0 estimate. Hide
service-specific print/payment actions until their actual prerequisites exist.
Invoicing stays owner-reviewed, draft-only and manually dispatched; no invoice or
external email is created by conversion or backfill.

## Rollout and verification

Keep changes in the existing isolated worktree. Test acceptance/replay atomicity,
kind-specific workflow, filters/pagination/events, race-safe conversion, all four
full-request services, invalid/expired/revoked capabilities and cross-inquiry file
access. Include actual PostgreSQL constraints/RLS and local-adapter contracts.
Browser coverage includes the two customer choices, continuation, operator inquiry
detail/conversion, local recovery, service-worker upgrade, 390px layouts, themes,
keyboard/focus and reduced motion. Run npm test and screenshots; inspect the board
and changed individual screens. Scan secrets and obtain independent design/code
review. Update the inquiry, operator, deployment and recovery documentation.

Deploy additively to the selected native business database, retain compatibility
with older API readers during rollout, deploy reviewed API/worker and static code,
rerun bounded backfill, verify the existing inquiry appears without sending customer
mail, and take/restore an encrypted checkpoint. Never migrate or poll the fenced
Neon source for this work. Use an overlap/rolling API deployment so healthy traffic
continues; retain a verified image rollback compatible with the additive schema.

Builder may settle module names and exact layout within existing design patterns.
The seven-day expiry, draft conversion behavior, state labels and fragment-based
capability transport are implementation recommendations, not separately stated
owner preferences; keep them explicit in the shipped documentation.
