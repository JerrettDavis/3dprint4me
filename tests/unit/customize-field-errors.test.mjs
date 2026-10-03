import assert from "node:assert/strict";
import test from "node:test";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { renderFormHtml, summaryHtml } from "../../customizer/framework/form.js";
import { continuePayload, continueState } from "../../customizer/framework/continue.js";

const shield = getGenerator("route-shield");

test("validateParams keeps errors[] and adds fieldErrors keyed by field", () => {
  const gen = { schema: { w: { type: "number", label: "Width", min: 1, max: 5, default: 2 }, t: { type: "text", label: "Name", max: 3, default: "", optional: true } } };
  const r = validateParams(gen, { w: 9, t: "toolong" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["Width must be 1–5.", "Name must be at most 3 characters."]);
  assert.deepEqual(r.fieldErrors, { w: "Width must be 1–5.", t: "Name must be at most 3 characters." });
  assert.deepEqual(validateParams(gen, {}).fieldErrors, {});
});

test("rules() fieldErrors are attached to their keys; keyless rule errors stay summary-only", () => {
  const gen = {
    schema: { a: { type: "int", label: "A", min: 0, max: 9, step: 1, default: 5 }, b: { type: "int", label: "B", min: 0, max: 9, step: 1, default: 5 } },
    rules: p => ({ errors: ["A and B together are too big.", "General problem."], fieldErrors: { b: "A and B together are too big.", zz: "unknown key ignored" } })
  };
  const r = validateParams(gen, {});
  assert.deepEqual(r.errors, ["A and B together are too big.", "General problem."]);
  assert.deepEqual(r.fieldErrors, { b: "A and B together are too big." });
});

test("unknown parameters are summary-only", () => {
  const r = validateParams({ schema: {} }, { nope: 1 });
  assert.deepEqual(r.fieldErrors, {});
  assert.match(r.errors[0], /Unknown parameter/);
});

test("route-shield cross-field rule errors carry their field key", () => {
  const r = validateParams(shield, { base_thickness_mm: 2.4, field_height_mm: -4 });
  assert.equal(r.ok, false);
  assert.ok(r.fieldErrors.field_height_mm, JSON.stringify(r.fieldErrors));
  const qr = validateParams(shield, { qr_enabled: true, qr_data: "" });
  assert.equal(qr.fieldErrors.qr_data, "QR content is required when QR is enabled.");
});

test("route-shield maps build errors to the closest control", () => {
  assert.equal(shield.errorField("Upper text doesn't fit at this size/position; reduce its size or move it back toward center."), "top_text");
  assert.equal(shield.errorField("Lower text doesn't fit at this size/position; …"), "lower_text");
  assert.equal(shield.errorField("Back text doesn't fit at this size/position; …"), "back_text");
  assert.equal(shield.errorField("QR payload is too dense for this badge. It needs about 40 mm"), "qr_data");
  assert.equal(shield.errorField("Something unrelated"), null);
});

test("an invalid field renders its message under the control with aria-invalid and merged aria-describedby", () => {
  const params = validateParams(shield, {}).value;
  const html = renderFormHtml(shield, params, { errors: ["Upper <b>bad</b>"], fieldErrors: { top_text: "Upper <b>bad</b>", width_mm: "Width must be 50–250 mm." } });
  const text = html.match(/<input[^>]*name="top_text"[^>]*>/)[0];
  assert.match(text, /aria-invalid="true"/);
  assert.match(text, /aria-describedby="cz-top_text-help cz-top_text-error"/);
  assert.match(html, /<p class="cz-field-error" id="cz-top_text-error">Upper &lt;b&gt;bad&lt;\/b&gt;<\/p>/);
  assert.ok(!html.includes("<b>bad"), "messages are escaped");
  const number = html.match(/<input[^>]*name="width_mm"[^>]*>/)[0];
  assert.match(number, /aria-invalid="true"/);
  assert.match(number, /aria-describedby="cz-width_mm-error"/);
  const field = html.slice(html.indexOf('data-field="width_mm"'), html.indexOf('data-field="height_mm"'));
  assert.ok(field.includes('id="cz-width_mm-error">Width must be 50–250 mm.'), "message sits inside its own field container");
  const clean = html.match(/<input[^>]*name="lower_text"[^>]*>/)[0];
  assert.ok(!/aria-invalid/.test(clean));
  assert.match(clean, /aria-describedby="cz-lower_text-help"/);
});

test("the summary is a persistent live region: unkeyed errors in full, keyed ones as a pointer", () => {
  const html = renderFormHtml(shield, validateParams(shield, {}).value);
  assert.match(html, /<div class="cz-form-errors" id="cz-form-errors" aria-live="polite"><\/div>/);
  assert.ok(!/id="cz-form-errors"[^>]*hidden/.test(html));
  const s = summaryHtml(["Keyed", "Loose <i>"], { a: "Keyed" });
  assert.match(s, /One setting needs attention/);
  assert.match(s, /<li>Loose &lt;i&gt;<\/li>/);
  assert.ok(!s.includes("<li>Keyed</li>"));
});

test("sensitive multiline text still renders as a masked single-line field", () => {
  const gen = { schema: { pw: { type: "text", label: "Secret", max: 40, multiline: true, sensitive: true, optional: true, default: "" } } };
  const out = renderFormHtml(gen, { pw: "" });
  assert.ok(!out.includes("<textarea"));
  assert.match(out, /<input[^>]*type="text"[^>]*class="input cz-secret"[^>]*data-key="pw"/);
  assert.doesNotMatch(out, /type="password"|name="pw"/);
});

test("continue state: Continue is enabled only for a ready model (the order hand-off is always wired)", () => {
  assert.deepEqual(continueState({ status: "ready", hasResult: true }), { disabled: false, note: "" });
  assert.equal(continueState({ status: "ready", hasResult: false }).disabled, true);
  assert.equal(continueState({ status: "building", hasResult: false }).disabled, true);
  assert.equal(continueState({ status: "error", hasResult: false }).disabled, true);
});

test("the continue payload redacts sensitive params", async () => {
  const gen = { id: "wifi-double", version: 2, schema: { ssid: { type: "text", max: 32, default: "" }, pw: { type: "text", max: 63, default: "", sensitive: true } } };
  const payload = continuePayload(gen, { ssid: "Home", pw: "hunter2" }, { data: new Uint8Array([1, 2]), filename: "x.3mf", warnings: ["w"] });
  assert.deepEqual(payload.params, { ssid: "Home", pw: "[redacted]" });
  assert.equal(payload.generatorId, "wifi-double");
  assert.equal(payload.generatorVersion, 2);
  assert.equal(payload.generatorTitle, "wifi-double", "falls back to the id when the generator has no title");
  assert.equal(payload.filename, "x.3mf");
  assert.deepEqual(payload.warnings, ["w"]);
  assert.equal(payload.file.size, 2);
  assert.equal(payload.file.type, "model/3mf");
});
