import assert from "node:assert/strict";
import test from "node:test";
import { calculateEstimate } from "../../public/assets/js/quote-engine.js";
import { SITE_CONFIG } from "../../public/assets/js/config.js";

test("print uncertainty never discounts the published minimum", () => {
  const estimate = calculateEstimate({service: "print", grams: "1", machineHours: "0.25", quantity: "1", material: "pla", delivery: "pickup"});
  assert.ok(estimate.low >= SITE_CONFIG.pricing.print.minimum);
});

test("blank slicer fields use the selected print size assumptions", () => {
  const estimate = calculateEstimate({
    service: "print",
    sizeClass: "palm",
    material: "pla",
    quality: "standard",
    quantity: "1",
    colors: "1",
    finish: "none",
    delivery: "pickup",
    grams: "",
    machineHours: ""
  });

  // $12 setup + 75 g × $0.11 + 3.5 hr × $2.20 = $27.95; rough band ±28%.
  assert.equal(estimate.low, 20);
  assert.equal(estimate.high, 36);
  assert.equal(estimate.confidence, "rough");
  assert.equal(estimate.breakdown.assumption, "palm size assumption");
});
