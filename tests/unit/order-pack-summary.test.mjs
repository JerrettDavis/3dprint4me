// The ZIP pack selection travels as plain request text, so every fallback path (no integrations,
// a refused or failed private estimate, an exhausted estimate cap) still tells the operator what
// the customer chose.
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProjectRequest } from "../../lib/validation.js";
import { projectRequestFromData } from "../../public/assets/js/order/model.js";
import { packRequestSpecifications } from "../../public/assets/js/print-estimation/pack.js";

const pack = (count, nameOf = index => `part-${index}.stl`) => ({
  parts: Array.from({ length: count }, (_, index) => ({ id: `part-${index}`, name: nameOf(index), error: index === count - 1 && count > 2 ? "empty_file" : null })),
  selection: Object.fromEntries(Array.from({ length: count }, (_, index) => [`part-${index}`, { selected: !(index === count - 1 && count > 2) && index !== 1, quantity: index + 1 }])),
  ignored: [{ name: "views/front.png", kind: "image" }, { name: "README.md", kind: "document" }]
});
const summaryOf = (data, estimate, files) => ({ service: data.service, projectTitle: data.projectTitle, description: data.description, estimate, files, specifications: { material: data.material }, contact: { name: "N", email: "n@example.com" }, consent: true });

test("a pack summary lists the selected entry labels and quantities and the ignored files", () => {
  const specs = packRequestSpecifications(pack(4));
  assert.equal(specs.packParts, "2 of 4 parts: part-0.stl ×1; part-2.stl ×3");
  assert.equal(specs.packIgnored, "views/front.png; README.md");
});

test("archive names are normalized with the shared entry label rule", () => {
  const specs = packRequestSpecifications({ parts: [{ id: "p", name: "a‮\u0007.stl", error: null }], selection: { p: { selected: true, quantity: 2 } }, ignored: [{ name: "x‮.png", kind: "image" }] });
  assert.equal(specs.packParts, "1 of 1 parts: a.stl ×2");
  assert.equal(specs.packIgnored, "x.png");
});

test("a long selection is bounded with an explicit (+N more) marker and survives server validation unchanged", () => {
  const long = index => `${"designer-pack/subfolder/".repeat(10)}part-${String(index).padStart(2, "0")}-${"x".repeat(5)}.stl`.slice(0, 255);
  const big = { parts: Array.from({ length: 16 }, (_, index) => ({ id: `p${index}`, name: long(index), error: null })), selection: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`p${index}`, { selected: true, quantity: 99 }])), ignored: Array.from({ length: 40 }, (_, index) => ({ name: long(index).replace(".stl", ".png"), kind: "image" })) };
  const specs = packRequestSpecifications(big);
  for (const value of Object.values(specs)) assert.ok(value.length <= 500, `${value.length} characters`);
  assert.match(specs.packParts, /^16 of 16 parts: .+ ×99; .*\(\+\d+ more\)$/);
  assert.match(specs.packIgnored, /\(\+\d+ more\)$/);
  const request = projectRequestFromData({ data: { service: "print", projectTitle: "Pack", description: "Print the pack.", material: "pla" }, estimate: { low: 10, high: 20 }, files: [{ name: "pack.zip", size: 10 }], buildSummary: summaryOf, packSelection: specs });
  const normalized = normalizeProjectRequest(request);
  assert.equal(normalized.specifications.packParts, specs.packParts, "nothing is silently truncated");
  assert.equal(normalized.specifications.packIgnored, specs.packIgnored);
});

test("only a print request carries the pack selection; without a pack the summary is unchanged", () => {
  const specs = packRequestSpecifications(pack(3));
  const base = { projectTitle: "P", description: "D", material: "pla" };
  const print = projectRequestFromData({ data: { ...base, service: "print" }, estimate: {}, files: [], buildSummary: summaryOf, packSelection: specs });
  assert.equal(print.specifications.packParts, specs.packParts);
  const design = projectRequestFromData({ data: { ...base, service: "design" }, estimate: {}, files: [], buildSummary: summaryOf, packSelection: specs });
  assert.equal(design.specifications.packParts, undefined);
  const single = projectRequestFromData({ data: { ...base, service: "print" }, estimate: {}, files: [], buildSummary: summaryOf, packSelection: packRequestSpecifications(null) });
  assert.deepEqual(single, summaryOf({ ...base, service: "print" }, {}, []));
  assert.deepEqual(packRequestSpecifications(null), {});
});

test("a pack where no part could be measured says so", () => {
  const none = { parts: [{ id: "p", name: "bad.stl", error: "empty_file" }], selection: { p: { selected: false, quantity: 1 } }, ignored: [] };
  assert.deepEqual(packRequestSpecifications(none), { packParts: "0 of 1 parts selected; none could be measured, a person will review the ZIP." });
});
