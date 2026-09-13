# Pricing Calibration

## Purpose

The site provides a planning range before human review. Its job is to discourage obviously mismatched expectations, surface the cost drivers, and gather better project information. It should not underwrite unknown geometry, machine failure, licensing, taxes, shipping, or revision risk.

All defaults are in `public/assets/js/config.js`.

## Delivered starting values

### Printing

| Input | Starting value |
|---|---:|
| Setup | $12 |
| Minimum job | $15 |
| Machine hour | $2.20 |
| PLA | $0.11/g |
| PETG | $0.13/g |
| ASA | $0.16/g |
| TPU | $0.19/g |
| Other | $0.17/g |
| Fine-quality multiplier | 1.35x |
| Two colors | +$6 |
| Three colors | +$10 |
| Four or more colors | +$16 |
| Cleanup | +$6 |
| Sanded | +$24 |
| Painted | +$48 |
| Local delivery | +$15 |
| Shipping planning allowance | +$18 |

Quantity multipliers reduce production cost, not setup or finishing, at 2, 5, 10, and 20 units.

### Modeling

| Input | Starting value |
|---|---:|
| Hourly rate | $65 |
| STEP deliverable | +$15 |
| Editable source | +$35 |
| Include a review print | +$25 planning allowance |

Complexity maps to hour ranges:

- Simple: 1 to 2.5 hours
- Fitted: 2.5 to 5 hours
- Assembly: 5 to 10 hours
- Complex: 9 to 18 hours

Source quality adjusts likely labor. Existing CAD reduces uncertainty, dimensions are neutral, photos add interpretation, and a concept-only request adds the largest allowance.

### Repair and tuning

| Scope | Starting range |
|---|---:|
| Diagnostic | $49 to $69 |
| Tune/calibration | $79 to $129 |
| Repair | $89 to $189 |
| Rebuild/major work | $175 to $425 |

Parts are not included.

### Consulting and printer design

| Scope | Starting range |
|---|---:|
| 30-minute session | $35 |
| One-hour session | $65 |
| On-site session | $95 to $145 |
| Custom printer design | $250 to $950 |

## Calibrate printing from actual cost

A useful machine-hour rate should recover more than electricity. Track at least:

```text
annual machine depreciation
+ replacement nozzles, beds, belts, bearings, fans, and hotend parts
+ preventive maintenance labor
+ failed-print material and machine time
+ electricity
+ enclosure, ventilation, and shop overhead
+ software and marketplace fees
+ payment processing
+ desired return on machine capacity
-------------------------------------------------------
/ realistically billable machine hours
```

Material rate per gram should include:

```text
landed spool price / usable grams
+ purge, skirt, support, and failed-print allowance
+ storage/drying overhead
+ handling and inventory risk
```

For multicolor work, machine time and purge mass can dominate. Use exact slicer data whenever possible and add a separate setup/handling rule if the current fixed color increment consistently underestimates jobs.

## Calibrate labor

Measure active labor separately from unattended machine time:

- Intake and model inspection
- Slicer preparation
- Material loading and drying
- Printer setup
- Support removal and cleanup
- Inserts and assembly
- Sanding and paint
- Packaging
- Customer communication
- Failed-print recovery

A low machine-hour rate can be rational when active labor and material cover the business. A low design or repair rate is harder to recover because the work is mostly active judgment.

## Confidence bands

### Print with exact grams and hours

The engine uses a narrower 14 percent spread around the calculated subtotal. This still does not include unknown model defects, licensing, tax, actual shipping, or requested changes.

### Print with a size category

When slicer grams or machine time are blank, the selected size category supplies the missing values. For the default palm-size PLA, one-part pickup example, that is 75 g and 3.5 machine hours, producing a $20–$36 planning range. The engine uses a 28 percent spread because grams and hours are assumptions.

### Design, repair, and custom printer work

Ranges are intentionally broader because unknowns are part of the service. Tighten only after the deliverables and evidence are reviewed.

## Calibration worksheet

For each completed project, record:

| Field | Why it matters |
|---|---|
| Service and subtype | Supports comparable cohorts |
| Estimated low/high | Baseline customer expectation |
| Confirmed price | Human-reviewed commitment |
| Final invoiced price | Actual revenue |
| Material grams and cost | Material model accuracy |
| Machine hours | Capacity and recovery |
| Active labor minutes | Labor recovery |
| Failed attempts | Risk allowance |
| Packaging and shipping | Delivery accuracy |
| Payment and marketplace fees | Net revenue |
| Revision count | Scope quality |
| Completion time | Scheduling accuracy |
| Reason for variance | Actionable calibration signal |

Review after the first 10 jobs and then monthly until estimate variance stabilizes.

## Guardrails

- Never lower the public range merely to improve conversion without checking margin and workload.
- Do not apply quantity discounts to first-article design, setup, fixture work, or finishing unless those costs truly repeat.
- Add a rush fee only when the scheduling policy and promise are explicit.
- Separate replacement parts and third-party purchases from repair labor.
- Require a license or customer authorization for models that are not the customer's original work.
- Define whether design source files and commercial rights are included.
- Do not collect a final payment from the rough browser estimate alone.

## Tax and shipping

The delivered calculator states that tax and shipping are not included by default. Keep that language until production tax and carrier calculations exist. A fixed shipping allowance is useful for planning but should not be treated as a label quote.

## Editing the rates

Change only `SITE_CONFIG.pricing` in `public/assets/js/config.js`, then run:

```bash
npm test
npm run screenshots
```

Review all four service paths, because shared delivery values can affect more than one estimate.
