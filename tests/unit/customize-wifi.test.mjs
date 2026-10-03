import assert from "node:assert/strict";
import test from "node:test";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { escapeWifiField, wifiPayload } from "../../public/assets/js/customize/wifi.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import build from "../../customizer/generators/wifi-tag/build.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const FORMATS = { placard: [90, 120], keychain: [45, 60], card: [85.6, 54] };

test("special characters are escaped per the WIFI: URI convention", () => {
  assert.equal(escapeWifiField('a;b,c:d"e\\f'), 'a\\;b\\,c\\:d\\"e\\\\f');
});

test("payload shapes", () => {
  assert.equal(wifiPayload({ ssid: "Cafe", password: "pw", security: "WPA", hidden: false }), "WIFI:T:WPA;S:Cafe;P:pw;;");
  assert.equal(wifiPayload({ ssid: "Open", password: "", security: "nopass", hidden: false }), "WIFI:T:nopass;S:Open;;");
  assert.equal(wifiPayload({ ssid: "H", password: "x", security: "WPA", hidden: true }), "WIFI:T:WPA;S:H;P:x;H:true;;");
  assert.equal(wifiPayload({ ssid: "Open", password: "ignored", security: "nopass" }), "WIFI:T:nopass;S:Open;;", "an open network never carries a password");
  assert.equal(wifiPayload({ ssid: "a;b", password: "p:q", security: "WEP" }), "WIFI:T:WEP;S:a\\;b;P:p\\:q;;");
});

const wasm = await loadEngine();
const gen = { ...getGenerator("wifi-tag"), build };
const { CrossSection } = wasm;
const NETWORK = { ssid: "Guest Network", password: "correct-horse-battery" };
const paramsFor = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, { ...NETWORK, ...extra });
  assert.ok(ok, errors.join("; "));
  return value;
};

for (const format of Object.keys(FORMATS)) {
  test(`${format} builds with a scannable QR at defaults`, async () => {
    const out = await buildModel(gen, paramsFor({ format }), { wasm, font: null });
    assert.ok(out.parts.length >= 2 && out.metrics.unique_colors <= 3);
    assert.ok(out.warnings.every(w => !/too dense/i.test(w)));
  });
}

test("the 3MF filename names only the format, never the network or password", async () => {
  for (const format of Object.keys(FORMATS)) {
    const out = await buildModel(gen, paramsFor({ format, ssid: "SecretNet", password: "hunter2-secret" }), { wasm, font: null });
    assert.equal(out.filename, `wifi-tag-${format}.3mf`);
    assert.ok(!/SecretNet|hunter2/.test(out.filename));
  }
});

test("the password never reaches the 3MF metadata, only the QR geometry", async () => {
  const out = await buildModel(gen, paramsFor({ password: "hunter2-secret" }), { wasm, font: null });
  // The model XML is deflated; search the raw bytes and the inflated entries.
  const { unzipSync, strFromU8 } = await import("fflate");
  const text = Object.values(unzipSync(out.data)).map(b => strFromU8(b)).join("\n");
  assert.ok(text.includes("[redacted]"));
  assert.ok(!text.includes("hunter2"));
});

// ---- QR scan correctness ------------------------------------------------------------------
// Expected matrix straight from qrcode-generator with the settings qr.js uses (auto version,
// error correction M). Sampling is derived independently here: viewed from +Z (the top face,
// held towards a phone), row 0 is the +Y edge and column 0 is the -X edge.
function expectedMatrix(payload) {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// Even-odd point-in-polygon over the CrossSection's outlines (holes are separate loops).
function inside(polys, x, y) {
  let hit = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

const partOf = (built, re) => built.solids.find(s => re.test(s.name));

// Slices the QR part at mid inlay depth and reads the module grid back from its geometry.
function readQr(built, n) {
  const qr = partOf(built, /QR/);
  const box = qr.solid.boundingBox();
  const midZ = (box.min[2] + box.max[2]) / 2;
  const slice = qr.solid.slice(midZ);
  const polys = slice.toPolygons();
  slice.delete();
  const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1];
  const m = w / n;
  const matrix = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) =>
    inside(polys, box.min[0] + (c + 0.5) * m, box.max[1] - (r + 0.5) * m)));
  return { box, w, h, m, polys, matrix, midZ };
}

function decodeImage(width, height, dark) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = dark(x, y) ? 0 : 255, i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return jsQR(data, width, height, { inversionAttempts: "dontInvert" });
}

for (const format of Object.keys(FORMATS)) {
  test(`${format}: the QR on the top face reads back as the exact, unmirrored code for the payload`, async () => {
    const params = paramsFor({ format });
    const payload = wifiPayload(params);
    const expected = expectedMatrix(payload);
    const n = expected.length;
    const built = await build(params, { wasm, font: null });
    try {
      const got = readQr(built, n);
      assert.ok(Math.abs(got.w - got.h) < 1e-6, "the code is square");
      assert.ok(got.m >= 0.82, `module ${got.m} mm is above the 0.82 mm floor`);
      // The inlay sits flush in the top face: its top is the tag's top surface.
      assert.ok(Math.abs(got.box.max[2] - params.thickness_mm) < 1e-6, `QR top at z=${got.box.max[2]}`);
      assert.ok(Math.abs(got.box.min[2] - (params.thickness_mm - params.qr_depth_mm)) < 1e-6);
      assert.deepEqual(got.matrix, expected);
      const mirrored = expected.map(row => [...row].reverse());
      assert.notDeepEqual(got.matrix, mirrored, "sanity: a mirrored code would be detected");

      // Rasterize the as-built top face over the QR plus its 2-module quiet zone and decode it.
      const ppm = 4, q = 2, size = (n + 2 * q) * ppm;
      const x0 = got.box.min[0] - q * got.m, y1 = got.box.max[1] + q * got.m;
      const decoded = decodeImage(size, size, (px, py) => inside(got.polys, x0 + (px + 0.5) * got.m / ppm, y1 - (py + 0.5) * got.m / ppm));
      assert.ok(decoded, "jsQR found a code in the rendered top face");
      assert.equal(decoded.data, payload);
    } finally {
      built.solids.forEach(s => s.solid.delete());
    }
  });

  test(`${format}: the QR keeps at least a 2-module base-colored quiet zone inside the tag`, async () => {
    const params = paramsFor({ format, corner_radius_mm: 12 });
    const n = expectedMatrix(wifiPayload(params)).length;
    const built = await build(params, { wasm, font: null });
    const temps = [];
    const t = o => { temps.push(o); return o; };
    try {
      const got = readQr(built, n);
      const q = 2 * got.m;
      const zone = t(t(CrossSection.square([got.w + 2 * q, got.h + 2 * q], true)).translate([(got.box.min[0] + got.box.max[0]) / 2, (got.box.min[1] + got.box.max[1]) / 2]));
      const body = partOf(built, /body/i).solid;
      const outline = t(body.slice(0.1));
      assert.ok(t(zone.subtract(outline)).area() < 1e-6, "the quiet zone lies entirely on the tag");
      const text = partOf(built, /text/i);
      if (text) {
        const textSlice = t(text.solid.slice(got.midZ));
        assert.ok(t(textSlice.intersect(zone)).area() < 1e-9, "no text inside the quiet zone");
      }
      // The base (body) covers the whole quiet ring at the inlay level: light around the code.
      const qrSquare = t(t(CrossSection.square([got.w, got.h], true)).translate([(got.box.min[0] + got.box.max[0]) / 2, (got.box.min[1] + got.box.max[1]) / 2]));
      const ring = t(zone.subtract(qrSquare));
      const skin = t(body.slice(got.midZ));
      assert.ok(Math.abs(t(ring.intersect(skin)).area() - ring.area()) < 1e-6, "the ring around the code is base-colored");
    } finally {
      temps.forEach(o => o.delete());
      built.solids.forEach(s => s.solid.delete());
    }
  });
}

test("each format has its stated outline; the keychain adds a 12 mm loop with a 5.5 mm hole", async () => {
  for (const [format, [w, h]] of Object.entries(FORMATS)) {
    const params = paramsFor({ format });
    const built = await build(params, { wasm, font: null });
    try {
      const box = partOf(built, /body/i).solid.boundingBox();
      assert.ok(Math.abs(box.max[0] - box.min[0] - w) < 0.01, `${format} width`);
      const extra = format === "keychain" ? 12 - 3 : 0;  // loop boss overlaps the body by 3 mm
      assert.ok(Math.abs(box.max[1] - box.min[1] - (h + extra)) < 0.05, `${format} height ${box.max[1] - box.min[1]}`);
      assert.ok(Math.abs(box.max[2] - params.thickness_mm) < 1e-6);
      if (format === "keychain") {
        const slice = partOf(built, /body/i).solid.slice(0.1);
        const polys = slice.toPolygons();
        slice.delete();
        const cy = h / 2 + 3;
        assert.ok(!inside(polys, 0, cy), "the loop has a hole");
        assert.ok(!inside(polys, 2.6, cy) && inside(polys, 2.9, cy), "hole radius is 2.75 mm");
        assert.ok(inside(polys, 5.9, cy) && !inside(polys, 6.1, cy), "boss radius is 6 mm");
      }
    } finally {
      built.solids.forEach(s => s.solid.delete());
    }
  }
  const noLoop = await build(paramsFor({ format: "keychain", hole: false }), { wasm, font: null });
  const box = partOf(noLoop, /body/i).solid.boundingBox();
  assert.ok(Math.abs(box.max[1] - box.min[1] - 60) < 0.01);
  noLoop.solids.forEach(s => s.solid.delete());
});

test("text is printed on placard and card, never on the keychain, and never includes the password", async () => {
  for (const format of ["placard", "card"]) {
    const built = await build(paramsFor({ format }), { wasm, font: null });
    assert.ok(partOf(built, /text/i), `${format} has text`);
    built.solids.forEach(s => s.solid.delete());
    const off = await build(paramsFor({ format, show_text: false }), { wasm, font: null });
    assert.equal(partOf(off, /text/i), undefined);
    off.solids.forEach(s => s.solid.delete());
  }
  // Bypasses the rule on purpose: the build itself is the backstop.
  const key = await build({ ...paramsFor({ format: "keychain" }), show_text: true }, { wasm, font: null });
  assert.equal(partOf(key, /text/i), undefined, "text is not shown on keychain tags");
  key.solids.forEach(s => s.solid.delete());
});

test("the keychain preset turns text off and the loop on", () => {
  assert.deepEqual(gen.presets.keychain, { format: "keychain", show_text: false, hole: true });
  assert.match(gen.schema.show_text.label, /Text is not shown on keychain tags/);
});

test("an unsupported character in the label becomes '?' with a warning; lower case is noted", async () => {
  const out = await buildModel(gen, paramsFor({ ssid: "Café Ñ" }), { wasm, font: null });
  assert.ok(out.warnings.some(w => /replaced with '\?'/.test(w)), out.warnings.join("|"));
  const plain = await buildModel(gen, paramsFor({ ssid: "GUEST-NET" }), { wasm, font: null });
  assert.ok(!plain.warnings.some(w => /replaced|capital/i.test(w)), plain.warnings.join("|"));
  const lower = await buildModel(gen, paramsFor({ ssid: "guest-net" }), { wasm, font: null });
  assert.ok(lower.warnings.some(w => /capital/i.test(w)));
  const key = await buildModel(gen, paramsFor({ format: "keychain", ssid: "Café" }), { wasm, font: null });
  assert.ok(!key.warnings.some(w => /replaced|capital/i.test(w)), "no label, no label warnings");
});

test("a maximum-length SSID and password still fit the keychain at or above the 0.82 mm floor", async () => {
  const params = paramsFor({ format: "keychain", ssid: "S".repeat(32), password: "p".repeat(63) });
  const n = expectedMatrix(wifiPayload(params)).length;
  const built = await build(params, { wasm, font: null });
  try {
    const got = readQr(built, n);
    assert.ok(got.m >= 0.82, `module ${got.m}`);
    assert.ok(built.warnings.some(w => /QR module size/.test(w)), "small modules are flagged");
  } finally {
    built.solids.forEach(s => s.solid.delete());
  }
});

test("a payload too dense for the keychain fails clearly instead of producing a tiny QR", async () => {
  // Every ';' is escaped to two characters, so this is the densest payload the schema allows.
  const value = paramsFor({ format: "keychain", ssid: ";".repeat(32), password: ";".repeat(63) });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), error => {
    assert.match(error.message, /too dense/);
    assert.match(error.message, /Use a shorter network name\/password or choose a larger tag format\./);
    assert.ok(!error.message.includes(";;;;"), "the error never echoes the network secrets");
    assert.equal(gen.errorField(error.message), "ssid");
    return true;
  });
});

test("the server never keeps the password", () => {
  const out = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2" } });
  assert.equal(out.params.password, "[redacted]");
  assert.deepEqual(out.redacted, ["password"]);
  assert.ok(!JSON.stringify(out).includes("hunter2"));
});

test("the server accepts an open network whose browser-redacted password is the marker", () => {
  const out = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "[redacted]", security: "nopass" } });
  assert.equal(out.params.security, "nopass");
});

test("an SSID is required and control characters rejected", () => {
  assert.equal(validateParams(gen, { ssid: "" }).ok, false);
  assert.equal(validateParams(gen, { ssid: "a\nb" }).ok, false);
  assert.equal(validateParams(gen, { ssid: "S".repeat(33), password: "x" }).ok, false);
  assert.equal(validateParams(gen, { ssid: "x", password: "p".repeat(64) }).ok, false);
});

test("password is sensitive, required unless the network is open, and kept exactly as typed", () => {
  assert.equal(gen.schema.password.sensitive, true);
  assert.equal(gen.schema.security.default, "WPA");
  const missing = validateParams(gen, { ssid: "Cafe" });
  assert.equal(missing.ok, false);
  assert.equal(missing.fieldErrors.password, "Enter the network password, or choose 'No password'.");
  assert.equal(validateParams(gen, { ssid: "Cafe", security: "nopass" }).ok, true);
  // Leading/trailing spaces are part of a Wi-Fi password; trimming would encode the wrong one.
  assert.equal(validateParams(gen, { ssid: "Cafe", password: "  spaced  " }).value.password, "  spaced  ");
});

test("an open network ignores a typed password and says so", async () => {
  const out = await buildModel(gen, paramsFor({ security: "nopass", password: "leftover" }), { wasm, font: null });
  assert.ok(out.warnings.some(w => /password is not used/i.test(w)));
});

test("QR depth always leaves 0.8 mm of base under the inlay", () => {
  assert.deepEqual(gen.rules(paramsFor({ thickness_mm: 2 })).limits.qr_depth_mm, [0.6, 1.2]);
  assert.deepEqual(gen.rules(paramsFor({ thickness_mm: 3 })).limits.qr_depth_mm, [0.6, 1.6]);
  const bad = validateParams(gen, { ...NETWORK, thickness_mm: 2, qr_depth_mm: 1.6 });
  assert.equal(bad.ok, false);
  assert.match(bad.fieldErrors.qr_depth_mm, /0\.6–1\.2 mm/);
  const clamped = clampParams(gen, { ...paramsFor(), qr_depth_mm: 1.6 }, "thickness_mm");
  assert.equal(clamped.qr_depth_mm, 1.6);
  assert.equal(clampParams(gen, { ...paramsFor(), thickness_mm: 2, qr_depth_mm: 1.6 }, "thickness_mm").qr_depth_mm, 1.2);
});

test("colors default to a light base with a dark code, and low-contrast or inverted pairs are rejected", () => {
  const d = paramsFor();
  assert.equal(d.base_color, "#ffffff");
  assert.equal(d.qr_color, "#111111");
  assert.equal(d.text_color, "#111111");
  const low = validateParams(gen, { ...NETWORK, base_color: "#ffffff", qr_color: "#cccccc" });
  assert.equal(low.ok, false);
  assert.match(low.fieldErrors.base_color, /Base color.*QR code color|QR code color.*Base color/);
  assert.equal(low.fieldErrors.base_color, low.fieldErrors.qr_color);
  assert.match(low.fieldErrors.qr_color, /3:1/);
  const inverted = validateParams(gen, { ...NETWORK, base_color: "#111111", qr_color: "#ffffff" });
  assert.equal(inverted.ok, false);
  assert.match(inverted.fieldErrors.qr_color, /darker/);
  assert.equal(validateParams(gen, { ...NETWORK, base_color: "#ffd166", qr_color: "#1d3557" }).ok, true);
});

test("errorField maps a too-dense error to the network name and nothing else", () => {
  assert.equal(gen.errorField("QR payload is too dense for this badge. Use a shorter network name/password or choose a larger tag format."), "ssid");
  assert.equal(gen.errorField("something else"), null);
});

test("build() frees every temporary: only the returned solids stay alive", async () => {
  for (const extra of [{}, { format: "keychain" }, { format: "card" }, { format: "card", show_text: false }, { format: "keychain", hole: false }, { title: "" }, { ssid: "A VERY LONG NETWORK NAME 1234567" }]) {
    const value = paramsFor(extra);
    const tracker = trackLiveObjects(wasm);
    try {
      for (let i = 0; i < 2; i++) {
        const built = await build(value, { wasm: tracker.ctxWasm, font: null });
        assert.equal(tracker.live.size, built.solids.length, `live ${tracker.live.size} vs solids ${built.solids.length} (${JSON.stringify(extra)})`);
        for (const s of built.solids) assert.ok(tracker.live.has(s.solid));
        built.solids.forEach(s => s.solid.delete());
        assert.equal(tracker.live.size, 0);
      }
    } finally { tracker.restore(); }
  }
});

test("failed builds do not leak either", async () => {
  const value = paramsFor({ format: "keychain", ssid: ";".repeat(32), password: ";".repeat(63) });
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build(value, { wasm: tracker.ctxWasm, font: null }), /too dense/);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});

test("the form renders the password as a masked field that doesn't claim to be optional", async () => {
  const { renderFormHtml, storableParams } = await import("../../customizer/framework/form.js");
  const html = renderFormHtml(gen, paramsFor());
  assert.match(html, /<input class="input" type="password" id="cz-password"/);
  assert.match(html, /id="cz-password-help">Needed unless the network is open/);
  assert.match(html, /id="cz-password-note"/);
  assert.ok(!html.includes(NETWORK.password), "the typed password is never echoed into the markup");
  assert.equal(Object.hasOwn(storableParams(gen, paramsFor()), "password"), false);
});

test("rules force show_text off for keychain everywhere the schema runs: browser value, clamp and server", () => {
  assert.equal(validateParams(gen, { ...NETWORK, format: "keychain", show_text: true }).value.show_text, false);
  assert.equal(validateParams(gen, { ...NETWORK, format: "placard", show_text: true }).value.show_text, true);
  const switched = clampParams(gen, { ...paramsFor(), format: "keychain" }, "format");
  assert.equal(switched.show_text, false, "the form unchecks the box when the format changes to keychain");
  const server = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2", format: "keychain", show_text: true } });
  assert.equal(server.params.show_text, false, "the operator record matches the model: no text on a keychain");
});

// ---- Review round 1 -----------------------------------------------------------------------------

test("a card label that would print under 2.5 mm fails with a readable error mapped to the network name", async () => {
  const long = "S".repeat(32);
  const value = paramsFor({ format: "card", ssid: long, title: "" });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), error => {
    assert.equal(error.message, "The network name is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format.");
    assert.equal(gen.errorField(error.message), "ssid");
    return true;
  });
  // The same name fits the placard; the card works with the label off.
  await buildModel(gen, paramsFor({ format: "placard", ssid: long, title: "" }), { wasm, font: null });
  await buildModel(gen, paramsFor({ format: "card", ssid: long, show_text: false }), { wasm, font: null });
});

test("a card label between 2.5 and 3.5 mm builds with a small-label warning", async () => {
  // 22 characters split into two 11-character lines: about 2.9 mm cap height in the card column.
  const out = await buildModel(gen, paramsFor({ format: "card", ssid: "S".repeat(22), title: "" }), { wasm, font: null });
  const w = out.warnings.find(x => /label prints only/.test(x));
  assert.ok(w, out.warnings.join("|"));
  const mm = Number(/only ([\d.]+) mm/.exec(w)[1]);
  assert.ok(mm >= 2.5 && mm < 3.5, w);
});

test("a maximum-length title still fits the card (with a warning); a title error would map to the title field", async () => {
  // Card titles split onto two lines, so the 20-character maximum prints at about 2.9 mm.
  const out = await buildModel(gen, paramsFor({ format: "card", title: "W".repeat(20) }), { wasm, font: null });
  assert.ok(out.warnings.some(w => /label prints only/.test(w)), out.warnings.join("|"));
  assert.equal(gen.errorField("The title is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format."), "title");
});

test("an SSID of only spaces is still required; a password keeps its spaces", () => {
  const r = validateParams(gen, { ssid: "   ", password: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.fieldErrors.ssid, "Network name (SSID) is required.");
  assert.equal(validateParams(gen, { ssid: " Cafe ", password: " pw  pw " }).value.password, " pw  pw ");
  assert.equal(validateParams(gen, { ssid: " Cafe ", password: " pw  pw " }).value.ssid, " Cafe ");
});

test("contrast boundaries: 3:1 passes, just under fails, for the QR and for the label (when shown)", async () => {
  const { contrastRatio } = await import("../../public/assets/js/customize/generators/wifi-tag.js");
  // Verified pairs around the boundary (WCAG relative luminance): 3.033 / 2.995 and 3.045 / 2.998.
  assert.ok(contrastRatio("#ffffff", "#949494") >= 3 && contrastRatio("#ffffff", "#959595") < 3);
  assert.ok(contrastRatio("#000000", "#5a5a5a") >= 3 && contrastRatio("#000000", "#595959") < 3);
  assert.equal(validateParams(gen, { ...NETWORK, qr_color: "#949494", text_color: "#111111" }).ok, true);
  assert.equal(validateParams(gen, { ...NETWORK, qr_color: "#959595", text_color: "#111111" }).ok, false);
  assert.equal(validateParams(gen, { ...NETWORK, text_color: "#949494" }).ok, true);
  const low = validateParams(gen, { ...NETWORK, text_color: "#959595" });
  assert.equal(low.ok, false);
  assert.match(low.fieldErrors.text_color, /Base color and Text color are too similar/);
  assert.equal(low.fieldErrors.base_color, low.fieldErrors.text_color);
  // The label may be lighter than the base (no polarity rule), but still needs 3:1.
  const dark = { ...NETWORK, base_color: "#000000", qr_color: "#000000" };
  assert.equal(validateParams(gen, { ...dark, text_color: "#5a5a5a" }).fieldErrors.text_color, undefined);
  assert.match(validateParams(gen, { ...dark, text_color: "#595959" }).fieldErrors.text_color, /too similar/);
  assert.equal(validateParams(gen, { ...NETWORK, text_color: "#ffffff", show_text: false }).ok, true, "no label, no label contrast rule");
  assert.equal(validateParams(gen, { ...NETWORK, format: "keychain", text_color: "#ffffff", show_text: true }).ok, true, "keychain has no label");
});

test("the key-ring loop is keychain-only: hidden in the form and forced off by rules for other formats", async () => {
  assert.deepEqual(gen.schema.hole.visibleWhen, { format: "keychain" });
  assert.equal(validateParams(gen, { ...NETWORK, format: "placard", hole: true }).value.hole, false);
  assert.equal(validateParams(gen, { ...NETWORK, format: "keychain", hole: true }).value.hole, true);
  const { renderFormHtml } = await import("../../customizer/framework/form.js");
  assert.match(renderFormHtml(gen, paramsFor({ format: "placard" })), /<div class="cz-field cz-field-bool" data-field="hole" hidden>/);
  assert.match(renderFormHtml(gen, paramsFor({ format: "keychain" })), /<div class="cz-field cz-field-bool" data-field="hole">/);
});

test("changing the format restores that format's text and loop defaults; other edits do not", () => {
  const placard = paramsFor();
  const key = clampParams(gen, { ...placard, format: "keychain" }, "format");
  assert.equal(key.show_text, false);
  assert.equal(key.hole, true);
  const back = clampParams(gen, { ...key, format: "card" }, "format");
  assert.equal(back.show_text, true, "keychain -> card turns text back on");
  assert.equal(back.hole, false);
  // Turning text off on a placard sticks through other edits.
  const off = clampParams(gen, { ...placard, show_text: false }, "show_text");
  assert.equal(clampParams(gen, { ...off, thickness_mm: 4 }, "thickness_mm").show_text, false);
  assert.equal(clampParams(gen, { ...off, corner_radius_mm: 2 }).show_text, false);
});

test("credentials that may not join produce warnings that never echo the password", async () => {
  const warn = async extra => (await buildModel(gen, paramsFor(extra), { wasm, font: null })).warnings;
  const cases = [
    [{ password: "short12" }, /WPA passwords are normally 8–63/],
    [{ password: "pässwörd-long" }, /plain ASCII/],
    [{ security: "WEP", password: "abcdef" }, /WEP keys are 5 or 13 characters/],
    [{ ssid: "CAFE" }, /raw hex key/],
    [{ password: "deadbeefcafe" }, /raw hex key/]
  ];
  for (const [extra, re] of cases) {
    const ws = await warn(extra);
    assert.ok(ws.some(w => re.test(w)), `${JSON.stringify(extra)}: ${ws.join("|")}`);
    if (extra.password) for (const w of ws) assert.ok(!w.includes(extra.password), w);
  }
  for (const extra of [{}, { security: "WEP", password: "abcde" }, { security: "WEP", password: "0123456789" }, { security: "nopass", password: "" }, { ssid: "CAF" }]) {
    const ws = await warn(extra);
    assert.ok(!ws.some(w => /WPA passwords|WEP keys|plain ASCII|raw hex/.test(w)), `${JSON.stringify(extra)}: ${ws.join("|")}`);
  }
});
