# Design and Product Plan

## Product statement

3dprint4.me is the public front door for practical, small-scale fabrication work. It should let someone move from "I have a weird part or broken printer" to a useful, reviewable project request without forcing them to understand CAD, slicing, filament properties, or repair terminology first.

The site is not positioned as an anonymous print farm or an instant-price vending machine. The promise is direct access to the person who will reason about the fit, model, printer, material, and result.

## Primary audiences

### The person with an idea but no model

They may have a sketch, dimensions, photos, or the original object. Their real need is translation from intent to manufacturable geometry.

### The person with a model but no reliable way to print it

They need material, orientation, quality, color, finishing, quantity, and delivery decisions. They may also need a licensing check or a small model correction.

### The printer owner with a problem

They usually describe symptoms rather than root causes. The intake should capture the printer model, the type of work, handoff method, and enough narrative or media to begin diagnosis.

### The person planning a purchase, workflow, or custom machine

They need a decision, plan, or architecture rather than a physical part on the first interaction.

## Customer jobs

1. Understand whether the requested outcome belongs here.
2. See enough prior work to trust the capability.
3. Get a useful planning range without pretending it is a final quote.
4. Provide the information and files already available.
5. Understand the next step, typical timing, and boundaries.
6. Leave with a reference number and a recoverable copy of the request.

## Service model

The public taxonomy uses four choices because they map to customer outcomes and distinct pricing logic:

| Public choice | Internal scope |
|---|---|
| Print my model | Single and multicolor FDM, small batches, finishing, assembly, pickup, local delivery, or shipping |
| Design something for me | Replacement parts, fitted objects, organizers, adapters, enclosures, mechanisms, assemblies, and source deliverables |
| Repair or tune my printer | Diagnostics, repair, calibration, tuning, firmware, upgrades, and remote troubleshooting |
| Consulting or printer design | Project review, purchasing, workflow, training, shop planning, and custom-printer architecture |

Additional capabilities should be added as examples beneath these choices before creating a fifth top-level path. This keeps the first decision easy.

## Brand and visual direction

The visual system is based on a workshop dashboard rather than a novelty maker site:

- Teal and blue accents evoke precise digital modeling and clear technical communication without copying a printer brand.
- Neutral surfaces keep technical images, measurements, and text legible.
- Rounded but structured components feel approachable without becoming toy-like.
- Grid, layer, fastener, airflow, and measurement motifs support the fabrication subject.
- Published project names, source links, and concrete design constraints provide visual proof without invented likenesses or stand-in product renders. Use actual shop or product photography only when its source and rights are confirmed.
- Light and dark themes preserve the same hierarchy and meaning.

The voice is direct, practical, and specific. It avoids exaggerated claims, fake precision, and generic phrases such as "bringing dreams to life."

## Information architecture

| Route | Customer question answered |
|---|---|
| `/` | What is this, can it solve my problem, and what should I do next? |
| `/services.html` | What exactly is offered and how is pricing approached? |
| `/portfolio.html` | Has this person handled real fit, electronics, printer, and enclosure constraints? |
| `/about.html` | Who will receive the request and how do they think about the work? |
| `/order.html` | What details are needed and what might the project cost? |
| `/privacy.html` | What happens to my contact information and files? |
| `/terms.html` | What does a rough estimate or submitted request mean? |
| `/404.html` | How do I recover from a bad link? |

## Intake flow

### Step 1: Choose the outcome

Four large, plain-language choices establish the service and select the relevant estimate strategy.

### Step 2: Describe the work

Shared fields collect the project name, description, model/reference link, and target date. Only the selected service's additional fields are enabled and exposed to assistive technology.

### Step 3: Contact, delivery, and files

Contact preference and handoff method are gathered after the customer has received value from the estimate. Shipping address appears only when relevant. File selection is explained in plain language and constrained to eight files of 25 MB each.

### Step 4: Review and consent

The customer sees the service, rough range, contact, delivery, files, and narrative together before submission. Consent explicitly states that this is a request rather than a binding order or final charge.

### Completion

The result includes a stable request ID, next-step language, an owner email path, a downloadable JSON copy, and optional deposit checkout. The unconfigured state remains useful instead of producing a dead-end error.

## Quote design

The calculator exists to set expectations and improve the request, not to automatically accept production risk.

### Printing

Inputs include setup, material weight, machine time, quality, color changes, finishing, quantity, and delivery. Exact slicer weight and time narrow the range. Size categories provide a fallback when those values are unknown.

### Modeling

Inputs include complexity, source quality, requested deliverable, and whether a physical print is included. The range represents likely labor rather than arbitrary object dimensions.

### Repair

Ranges are selected by diagnostic, tune, repair, or rebuild scope, with local travel where relevant. Parts are explicitly outside the planning range.

### Consulting

Short sessions can be nearly fixed price. Custom printer design stays broad until requirements and deliverables are understood.

### Estimate invariant

No estimate is represented as a binding price. The confirmed scope should state deliverables, revision count, material, finish, quantity, pickup/shipping, taxes, licensing assumptions, timing, payment terms, and exclusions.

## Portfolio strategy

The selected public work emphasizes the strongest proof of capability:

- Parametric automotive organization
- Printer electronics integration
- Raspberry Pi camera and IR housings
- High-current power-supply guarding and airflow
- ESP32 display and RFID enclosure work
- Safety and machine-mounting hardware

These examples show fit, access, tolerances, heat, airflow, cables, fasteners, assembly, serviceability, and manufacturing judgment. New portfolio additions should explain the constraint solved, not only show a finished object.

## Experience invariants

- A primary project-start action is visible on every commercial page.
- The current theme follows the operating system until the visitor overrides it.
- Every action remains keyboard reachable and visibly focused.
- Hidden service fields are disabled and removed from the accessibility tree.
- A customer never loses the current draft because an integration is absent.
- Server-side validation never trusts the browser estimate or field constraints.
- Uploaded customer files are private by default.
- Mobile layouts do not require horizontal scrolling.
- Reduced-motion preferences remove nonessential movement.
- Color never carries status or meaning alone.

## Success measures

Initial launch should measure a small set of operationally useful signals:

- Visits to project-start actions
- Intake starts and completed submissions
- Completion rate by service
- Percentage of print requests with usable file/link and slicer data
- Time from request to first human response
- Time from approval to completion
- Estimate-to-confirmed-price variance by service
- Requests declined for licensing, safety, capability, or schedule
- Repeat customers and referrals

Avoid collecting behavioral analytics until there is a specific decision they will support and the privacy notice is updated.

## Delivery roadmap

### Delivered foundation

- Complete public site and responsive theme
- Guided quote/request flow
- Private file intake adapter
- Email, webhook, and deposit adapters
- SEO/PWA assets
- Tests, screenshots, and automated UX audit
- Deployment and operating documentation

### Launch configuration

- Connect Supabase, Resend, and production domain
- Calibrate rates against actual spool, machine, labor, failure, packaging, and shipping costs
- Replace placeholder legal language with reviewed business policies
- Perform a production screen-reader and real-device pass
- Test private file expiry, email deliverability, and Stripe sandbox checkout

### Near-term operations

- Add a simple authenticated request dashboard, preferably as a separate admin app
- Add quote, approval, status, and completion email templates
- Add request tags, internal notes, and schedule commitments
- Add Stripe webhook reconciliation before automating payment-based fulfillment
- Add customer-visible status links with expiring tokens

### Catalog expansion

- Add fixed-price repeatable products only after there is a stable SKU, known material/time, stock or capacity rule, packaging, and license to sell
- Connect Shopify through a Buy Button for a few products or Storefront API for a deeper catalog
- Syndicate appropriate products to marketplaces separately from custom-service intake
