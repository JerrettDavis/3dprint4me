import assert from "node:assert/strict";
import test from "node:test";
import { renderFormHtml, storableParams, restoreParams, readControlValue } from "../../customizer/framework/form.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";

const gen = getGenerator("route-shield");
const html = renderFormHtml(gen, validateParams(gen, {}).value);

test("every schema field gets a labelled control", () => {
  for (const [key, def] of Object.entries(gen.schema)) {
    assert.ok(html.includes(`name="${key}"`), `missing control for ${key}`);
    assert.ok(html.includes(def.label), `missing label ${def.label}`);
  }
});

test("range fields expose min, max and step; text fields expose maxlength", () => {
  assert.match(html, /name="width_mm"[^>]*min="50"[^>]*max="250"/);
  assert.match(html, /name="top_text"[^>]*maxlength="/);
});

test("user-supplied defaults are HTML-escaped", () => {
  const evil = renderFormHtml(gen, { ...validateParams(gen, {}).value, top_text: '"><img src=x onerror=alert(1)>' });
  assert.ok(!evil.includes("<img"));
});

test("sensitive text fields are password-style, non-autofilled and labelled as stored only in the model", () => {
  const wifi = { schema: { pw: { type: "text", label: "Password", max: 20, default: "", sensitive: true, optional: true } } };
  const out = renderFormHtml(wifi, { pw: "" });
  assert.match(out, /type="password"/);
  assert.match(out, /autocomplete="off"/);
  assert.match(out, /only inside the model file/i);
});

test("each control has a unique id, every label points at one, and only one control per field carries the name", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids");
  for (const [, target] of html.matchAll(/<label[^>]*for="([^"]+)"/g)) assert.ok(ids.includes(target), `label for missing id ${target}`);
  for (const key of Object.keys(gen.schema)) assert.equal(html.split(`name="${key}"`).length - 1, 1, `${key} name count`);
});

test("number fields pair a named number box with a labelled range slider that carries data-for", () => {
  assert.match(html, /<input[^>]*type="range"[^>]*data-for="width_mm"[^>]*aria-label="Width slider"/);
  assert.match(html, /<input[^>]*type="number"[^>]*name="width_mm"/);
  const rangeTag = html.match(/<input[^>]*type="range"[^>]*data-for="width_mm"[^>]*>/)[0];
  assert.ok(!/\sname=/.test(rangeTag), "range must not carry name");
});

test("enum, bool, color and multiline text render the right element types", () => {
  assert.match(html, /<select[^>]*name="font_mode"/);
  assert.match(html, /<option value="block" selected>/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*name="qr_enabled"[^>]*checked/);
  assert.match(html, /<input[^>]*type="color"[^>]*name="base_color"[^>]*value="#ffffff"/);
  assert.match(html, /<textarea[^>]*name="back_text"[^>]*>100 Years/);
});

test("fields are grouped into labelled fieldsets in schema order", () => {
  const legends = [...html.matchAll(/<legend[^>]*>([^<]+)<\/legend>/g)].map(m => m[1]);
  assert.deepEqual(legends, ["Text", "Size and depth", "Text layout", "Back", "Colors"]);
});

test("a generator without groups or rules still renders", () => {
  const out = renderFormHtml({ schema: { n: { type: "int", label: "Count", min: 1, max: 5, step: 1, default: 2 } } }, {});
  assert.match(out, /name="n"[^>]*min="1"[^>]*max="5"[^>]*step="1"[^>]*value="2"/);
});

test("storableParams drops sensitive and unknown keys", () => {
  const g = { schema: { a: { type: "text", max: 5, default: "" }, pw: { type: "text", max: 5, default: "", sensitive: true } } };
  assert.deepEqual(storableParams(g, { a: "x", pw: "secret", zz: 1 }), { a: "x" });
});

test("restoreParams keeps only current schema keys, falls back to defaults when invalid", () => {
  const defaults = validateParams(gen, {}).value;
  const restored = restoreParams(gen, JSON.stringify({ top_text: "HELLO", removed_key: 4 }));
  assert.equal(restored.top_text, "HELLO");
  assert.equal(restored.width_mm, defaults.width_mm);
  assert.deepEqual(restoreParams(gen, "not json"), defaults);
  assert.deepEqual(restoreParams(gen, JSON.stringify({ width_mm: 9999 })), defaults);
  assert.deepEqual(restoreParams(gen, null), defaults);
});

test("a draft restores even though it can never hold a required secret, which stays empty", () => {
  // Drafts never store sensitive fields. A generator whose rules need the secret (Wi-Fi: WPA needs
  // a password) must still get the rest of the draft back; the secret starts empty and its rule
  // error shows in the form instead of the whole draft being discarded.
  const g = {
    schema: {
      ssid: { type: "text", max: 32, default: "Guest" },
      password: { type: "text", max: 63, default: "", optional: true, sensitive: true },
      size: { type: "number", min: 1, max: 9, step: 1, default: 5 }
    },
    rules: o => (o.password ? { errors: [] } : { errors: ["Enter the password."], fieldErrors: { password: "Enter the password." } })
  };
  const restored = restoreParams(g, JSON.stringify({ ssid: "Cafe", size: 7, password: "should-not-be-here" }));
  assert.deepEqual(restored, { ssid: "Cafe", password: "", size: 7 });
  assert.equal(restoreParams(g, JSON.stringify({ ssid: "Cafe", size: 99 })).size, 5, "a field-invalid draft still falls back");
});

test("a field's own help text replaces the generic optional/length line", () => {
  const g = { schema: { pw: { type: "text", label: "Password", max: 63, optional: true, sensitive: true, default: "", help: "Required unless the network is open. Up to 63 characters." } } };
  const html = renderFormHtml(g, {});
  assert.match(html, /<p class="help" id="cz-pw-help">Required unless the network is open\. Up to 63 characters\.<\/p>/);
  assert.doesNotMatch(html, /Optional\./);
});

test("readControlValue converts control values to schema types", () => {
  assert.equal(readControlValue({ type: "number" }, { value: "12.5" }), 12.5);
  assert.ok(Number.isNaN(readControlValue({ type: "number" }, { value: "" })));
  assert.equal(readControlValue({ type: "int" }, { value: "3" }), 3);
  assert.equal(readControlValue({ type: "bool" }, { checked: true }), true);
  assert.equal(readControlValue({ type: "text" }, { value: "hi" }), "hi");
});
