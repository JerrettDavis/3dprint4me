import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customizationRows, CUSTOMIZATION_NOTE, renderCustomization, WITHHELD } from "../../operator/assets/customization-detail.js";

const customization = { generatorId: "route-shield", generatorVersion: 1, params: { top_text: "ROUTE", width_mm: 80, show_qr: false, password: "hunter2" }, redacted: ["password"] };

test("customization rows list generator, version and humanized parameters with redacted values withheld", () => {
  assert.deepEqual(customizationRows(customization), [
    ["Generator", "route-shield"],
    ["Version", "1"],
    ["Top text", "ROUTE"],
    ["Width mm", "80"],
    ["Show qr", "Off"],
    ["Password", WITHHELD]
  ]);
  assert.equal(WITHHELD, "withheld (in the model's QR code)");
  assert.equal(CUSTOMIZATION_NOTE, "The attached 3MF is the model to print; these values are provenance.");
});

test("a value that is the redaction marker is withheld even if the key list is missing", () => {
  const rows = customizationRows({ generatorId: "x", generatorVersion: 2, params: { pw: "[redacted]" } });
  assert.deepEqual(rows.at(-1), ["Pw", WITHHELD]);
});

test("structured vase profiles remain readable as normalized percentages on the operator sheet", () => {
  const rows = customizationRows({ generatorId: 'vase', generatorVersion: 1, params: { profile: [
    { height: 0, radius: 0.62 }, { height: 0.5, radius: 1 }, { height: 1, radius: 0.55 },
  ] } });
  assert.deepEqual(rows.at(-1), ['Profile', '0% height / 62% radius; 50% height / 100% radius; 100% height / 55% radius']);
});

test("no customization renders nothing", () => {
  assert.equal(renderCustomization({}), null);
  assert.equal(renderCustomization(undefined), null);
});

test("the operator section never uses innerHTML and is mounted only for customized requests", async () => {
  const source = await readFile(new URL("../../operator/assets/customization-detail.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  const operator = await readFile(new URL("../../operator/assets/operator.js", import.meta.url), "utf8");
  assert.match(operator, /request\?\.customization/);
  const worker = await readFile(new URL("../../operator/sw.js", import.meta.url), "utf8");
  assert.match(worker, /\/assets\/customization-detail\.js/, "the shell cache includes the new module");
});
