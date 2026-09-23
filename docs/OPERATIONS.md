# Operations Playbook

## Service promise

The public site says straightforward work is typically completed in under five business days. Treat that as a normal-case expectation after scope approval, not a guarantee from the moment the request form is submitted.

Use the first response to establish:

- Whether the work is accepted
- What information is still needed
- Confirmed deliverables and exclusions
- Material, finish, quantity, and delivery
- Price, deposit, and payment schedule
- Start condition and estimated completion date
- Licensing or safety concerns

## Suggested status workflow

The Supabase table already constrains these statuses:

```text
draft
  -> submitted
  -> quoted
  -> approved
  -> in_progress
  -> completed
```

Alternative exits:

```text
submitted/quoted -> declined
submitted/quoted/approved -> cancelled
```

Use `draft` only for the short period between request creation and final file/metadata completion. Do not treat a draft as accepted work.

## Daily intake routine

1. Review newly submitted rows and owner notifications.
2. Open files only from the private signed link or trusted storage console.
3. Confirm the customer has the right to reproduce any third-party model.
4. Check the description, dimensions, material environment, deadline, quantity, and handoff.
5. For printing, open the file in an isolated viewer/slicer and inspect manifold state, scale, wall thickness, supports, orientation, and expected time/weight.
6. For modeling, identify required measurements, interfaces, tolerance assumptions, source deliverables, and revision limit.
7. For repair, ask for printer model, modifications, recent changes, symptoms, logs/photos, and safety state before energizing it.
8. Decide: quote, request more information, refer out, or decline.
9. Respond with a concrete next step and update the status.

## Home Assistant work peek

Home Assistant is a convenience read-only view of the work queue. The Neon work record and authenticated operator PWA at `https://work.3dprint4.me/` remain authoritative. An unavailable Home Assistant instance or snapshot endpoint must not block customer intake, operator updates, existing owner notifications, Web Push, or the notification outbox. Do all acknowledgements and status changes in the operator PWA.

Check `sensor.three_d_print_work` in Home Assistant Developer Tools → States. Its attributes hold `generatedAt`, counts, `latestCreatedId`, and up to 20 active summaries. The supplied package polls every 60 seconds; `generatedAt` should advance on successful polls. If it is stale beyond two expected intervals, check the entity's availability, the REST integration log, endpoint HTTP status, Vercel function health, and Neon connectivity. A fixed marker between polls is normal when no new work was created. The marker is newest-created work across all statuses, so it remains set when all work is terminal; active counts and items then fall to zero. The first successful poll only establishes state and should not alert.

For `401`, check that the API has the configured token and that the Home Assistant `three_d_print_work_authorization` secret has the exact `Bearer ` prefix and matching value. Check for stale configuration after rotation; never paste either secret into a ticket, log, or URL. For `503`, check whether `HOME_ASSISTANT_TOKEN` is missing or too short, whether the function can reach Neon, and whether the operator queue is otherwise healthy. Removing the Vercel variable intentionally produces `503`, not an anonymous feed. A polling outage makes the Home Assistant view unavailable; the next successful poll resumes the current snapshot and cannot reconstruct work created and completed between polls.

After editing `integrations/home-assistant/package.yaml` or the installed secret, run Home Assistant **Check configuration** before restart or reload. If validation fails, restore the last valid package and secret, then recheck. Inspect the dashboard links and alert against the exact operator work ID; opening a link may require operator sign-in. If a new-work alert seems duplicated, compare the prior and current valid markers and the automation trace. Repeated polls with the same marker should not alert or change work revision, acknowledgement, events, or outbox state. See [DEPLOYMENT.md](DEPLOYMENT.md) for coordinated token rotation and rollback.

## File safety

Customer files are untrusted input even when the extension looks harmless.

- Do not execute scripts, macros, installers, or arbitrary binaries.
- Extract ZIP files into a disposable directory and inspect contents before opening.
- Keep slicers, CAD tools, and operating systems patched.
- Prefer isolated or non-administrator environments for unknown files.
- Scan attachments where practical.
- Do not expose the private storage bucket publicly for convenience.
- Delete files according to the published retention policy.
- Never redistribute customer files or third-party models without authorization.

## Quote checklist

### Every project

- Request ID
- Customer identity and contact preference
- Description of accepted outcome
- Deliverables
- Price and whether tax/shipping are additional
- Deposit and balance timing
- Schedule start condition
- Estimated completion or review date
- Revision/change policy
- Cancellation/refund terms
- File and physical-property limitations
- Licensing representation

### Printing

- File version and unit scale
- Quantity
- Material and color
- Layer height/nozzle where relevant
- Strength and cosmetic priorities
- Orientation and support expectations
- Inserts/assembly/finishing
- Tolerance-sensitive interfaces
- Pickup, delivery, or shipping
- Replacement policy for transit or manufacturing defects

### Modeling

- Source evidence and dimensions
- Intended manufacturing process
- Environment and load assumptions
- Mating parts and clearance
- Editable source inclusion
- STL/STEP/3MF/drawing deliverables
- Number and type of revisions
- Test print or physical fit validation
- Ownership and commercial-use terms

### Repair

- Diagnostic authorization limit
- Data/configuration backup
- Replacement part approval threshold
- Mains-voltage and battery safety
- Existing modifications and warranty implications
- Definition of successful repair/tune
- Parts warranty versus labor warranty
- Unclaimed-equipment policy

## First response template

```text
Subject: [REQUEST ID] Project review

Hi NAME,

I reviewed your request for PROJECT. I can help with this.

Proposed scope:
- ...

Confirmed price: $...
Not included: tax/shipping/parts/etc.
Estimated completion: ... business days after approval and any required parts/files are received.

I still need:
- ...

Reply with approval, corrections, or the missing details. I will not begin paid work until the scope and payment terms are confirmed.

Jerrett
3dprint4.me
```

## More-information template

```text
Hi NAME,

I can evaluate this, but I need a few details before I can confirm the approach and price:

- ...
- ...

Your current browser estimate was RANGE. That remains a planning range until I review the missing information.

Reference: REQUEST ID
```

## Decline/referral template

```text
Hi NAME,

Thanks for the clear request. I am not the right fit for this project because REASON. I have not accepted the work or charged a deposit.

A shop that offers PROCESS/CAPABILITY may be a better route. Keep reference REQUEST ID for your records.
```

## Turnaround management

The under-five-business-day expectation works only when the queue is visible.

Track:

- Date submitted
- Date enough information was received
- Date quoted
- Date approved/paid
- Promised completion date
- Printer/material/bench dependency
- Waiting-on-customer state
- Waiting-on-parts state
- Actual completion date

When capacity is constrained, change the public copy before accepting work rather than repeatedly missing the promise.

## Quality handoff

### Printed part

- Compare count and version to the approved request.
- Inspect first/last layer, walls, seams, supports, warping, layer shifts, and obvious defects.
- Test specified fit or movement where the mating object is available.
- Remove debris and sharp support remnants.
- Photograph higher-value or shipped work.
- Package for the actual material and geometry.

### Model files

- Open each exported format after export.
- Confirm units and orientation.
- Check bodies/components and intended editability.
- Include a brief README for configurable or multi-part designs.
- State unvalidated assumptions.

### Repaired printer

- Record changed parts and settings.
- Preserve or provide backups where relevant.
- Run the agreed test print/calibration.
- Explain remaining limitations and maintenance needs.
- Do not return equipment in a less safe state.

## Quick inquiries

Apply the additive Neon inquiry migration before release. Monitor accepted inquiries and pending/failed notifications independently; quick inquiries send only an owner notification and do not create estimates or orders. See [quick inquiry operations](QUICK-INQUIRY.md) for private file retrieval, bounded notification retries, recovery, and draft cleanup.

## Retention suggestion

Choose and publish an actual policy. A practical starting point to review legally and operationally:

- Unaccepted request metadata: 90 days
- Unaccepted uploaded files: 30 days
- Completed project files: 12 months unless the customer requests earlier deletion or ongoing storage is part of the scope
- Invoices and tax records: according to legal/accounting requirements
- Security and delivery logs: shortest period that supports troubleshooting and abuse control

Automate deletion only after testing it against backups, active jobs, disputes, and recordkeeping requirements.
