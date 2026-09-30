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

## Dual-floor print pricing

The public rate card above is the **market** candidate. Model-aware print estimates also compute a private **economic floor** on the server (`lib/print-estimation/pricing-policy.js`, version `2026-09-30.1`):

```text
passive machine $/successful hour = (basis/life + basis*maintenance + monthly overhead*12)
                                     / (runtime h/week * weeks * productive utilization)
                                   + power kW * $/kWh, then / (1 - failure/rework rate)
active labor per plate            = wage * (1 + burden) * (1 + reserve) * touch hours per plate
material                          = grams * landed $/kg / 1000 * (1 + waste)
internal cost                     = material + machine hours * passive rate + plates * labor per plate
                                    + finishing hours * loaded rate + other direct cost
economic floor                    = internal cost / (1 - required minimum margin)
candidate price                   = max(market price, economic floor, minimum job charge)
```

| Assumption | Value |
|---|---:|
| Machine basis / life / maintenance | $1,000 / 3 years / 10% per year |
| Scheduled runtime / weeks / productive utilization | 32 h per week / 52 / 80% |
| Power / electricity | 0.20 kW / $0.15 per kWh |
| Failure and rework reserve | 10% |
| Passive machine cost | ≈ $0.395 per successful hour |
| Operator wage / burden / loaded rate | $10 / 25% / $12.50 per active hour |
| Default touch time | 0.25 h per print job/plate ($3.125) |
| Finishing touch time per unit | cleanup 0.1 h, sanded 0.5 h, painted 1.25 h |
| Material waste | 8% |
| Fallback landed cost | PLA $20, PETG $22, ASA $26, TPU $28, other $25 per kg |
| Required minimum margin | 50% |
| Minimum job charge | $15 (must equal the public rate card) |

Operator wages are never spread across unattended machine hours; routine touch labor is charged once per plate, so seven units on one plate share one $3.125 setup. Material cost uses the private filament inventory: weighted on-hand landed cost, then the estimate-default or most recent active row, then the explicit fallback above. The chosen source and inventory IDs are stored with each snapshot.

Confidence bands around the candidate price: catalog ±5%, slicer ±12%, manual grams/hours ±14%, geometry ±25%, size class ±28%. The low end never drops below the minimum charge or the economic floor. Customers see only the range, confidence, production estimate, and assumptions; operators see market price, floor, internal cost breakdown, and projected profit/margin at low/target/high.

Calibration fixtures (`tests/fixtures/print-estimation/pricing-calibration.json`) pin the workbook: Multicolor Sign 115 g/3.5 h ≈ $6.99 (76.7% at $30); Sign Base 200 g/7.25 h ≈ $10.31 (79.4% at $50); single-color Axolotl 22 g/1.25 h ≈ $4.09 (18.1% at $5); 7-up multicolor Axolotl 290 g/13 h ≈ $2.07 per unit (79.3% at $10). The low single-part margin is intentional evidence that batching and the minimum charge matter; a lone axolotl is priced at the $15 minimum.

To change assumptions, edit `DEFAULT_PRICING_MODEL`, bump `PRICING_MODEL_VERSION`, update the fixtures if the workbook changed, and run `npm test`. Historical snapshots keep their original numbers.

### Geometry is not a slice

Browser and server geometry estimates convert mesh volume and surface area into rough grams (1.2 mm walls, 15% infill, material density, support and color allowances) and time (draft 22, standard 15, fine 9 g/h). They are labelled "not a slice" everywhere and use the wide geometry band. A configured slicer replaces them with measured time/material and the narrower slicer band.

### Estimated versus actual

Operators can record actual grams, machine hours, labor minutes, failed attempts, and completed quantity against a work item. The job sheet shows variance against the linked estimate. Nothing auto-retunes prices; review variance with the worksheet below.

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

The print estimate’s lower uncertainty bound is clamped to the configured print minimum ($15 at this release). Blank slicer inputs continue to use the selected size assumptions; rates are unchanged.
