import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOperatorPrintHandler } from "../../api/operator-print.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createFilamentUseCases } from "../../lib/print-estimation/application/filament.js";
import { normalizeFilamentInput, selectEffectiveMaterialCost } from "../../lib/print-estimation/inventory.js";
import { splitStatements } from "../../scripts/migrate-neon.mjs";

const now = new Date("2026-09-30T12:00:00Z");
const row = patch => ({ id: "fil_aaaaaaaa", material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 2000, freightFeeCents: 0, onHandGrams: 0, active: true, estimateDefault: false, updatedAt: "2026-09-01T00:00:00Z", ...patch });

test("weighted landed cost uses on-hand active inventory", () => {
  const cost = selectEffectiveMaterialCost([
    row({ id: "fil_cheap0001", purchaseCostCents: 1800, freightFeeCents: 200, onHandGrams: 3000 }), // $20/kg
    row({ id: "fil_prem00001", purchaseCostCents: 2500, onHandGrams: 1000 }), // $25/kg
    row({ id: "fil_petg00001", material: "petg", purchaseCostCents: 9900, onHandGrams: 9000 })
  ], "pla", { now });
  assert.equal(cost.source, "inventory_weighted");
  assert.equal(cost.landedUsdPerKg, 21.25);
  assert.deepEqual(cost.inventoryIds, ["fil_cheap0001", "fil_prem00001"]);
  assert.equal(cost.onHandGrams, 4000);
  assert.equal(cost.capturedAt, now.toISOString());
});

test("zero on-hand inventory falls back to the default, then the latest active row", () => {
  const latest = selectEffectiveMaterialCost([
    row({ id: "fil_older0001", purchaseCostCents: 1900, updatedAt: "2026-08-01T00:00:00Z" }),
    row({ id: "fil_newer0001", purchaseCostCents: 2300, updatedAt: "2026-09-20T00:00:00Z" })
  ], "pla", { now });
  assert.equal(latest.source, "inventory_latest");
  assert.equal(latest.landedUsdPerKg, 23);
  const preferred = selectEffectiveMaterialCost([
    row({ id: "fil_default01", purchaseCostCents: 2100, estimateDefault: true, updatedAt: "2026-01-01T00:00:00Z" }),
    row({ id: "fil_newer0001", purchaseCostCents: 2300 })
  ], "pla", { now });
  assert.deepEqual(preferred.inventoryIds, ["fil_default01"]);
});

test("inactive rows are ignored and unknown materials use the explicit controlled fallback", () => {
  const inactive = selectEffectiveMaterialCost([row({ active: false, onHandGrams: 5000, purchaseCostCents: 99900 })], "pla", { now });
  assert.equal(inactive.source, "fallback");
  assert.equal(inactive.landedUsdPerKg, 20);
  const unknown = selectEffectiveMaterialCost([], "nylon-cf", { now });
  assert.equal(unknown.source, "fallback");
  assert.equal(unknown.material, "other");
  assert.equal(unknown.requestedMaterial, "nylon-cf");
});

test("filament input validation rejects unsafe or malformed values", () => {
  const valid = normalizeFilamentInput({ material: "PLA", spoolNominalGrams: 1000, purchaseCostCents: 1999, freightFeeCents: 150, onHandGrams: 800 });
  assert.equal(valid.material, "pla");
  assert.equal(valid.active, true);
  for (const bad of [
    { material: "p", spoolNominalGrams: 1000, purchaseCostCents: 1 },
    { material: "pla", spoolNominalGrams: 0, purchaseCostCents: 1 },
    { material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 12.5 },
    { material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 1, landedUsdPerKg: 3 },
    { material: "pla; drop table", spoolNominalGrams: 1000, purchaseCostCents: 1 }
  ]) assert.throws(() => normalizeFilamentInput(bad), error => error.status === 400);
});

test("local repository persists inventory and only the owner may change it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-filament-"));
  try {
    const repository = createLocalPrintRepository({ path: join(directory, "print.json"), now: () => now });
    const useCases = createFilamentUseCases({ repository, now: () => now });
    await assert.rejects(() => useCases.save({ material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 2200 }, { role: "operator" }), error => error.status === 403);
    const saved = await useCases.save({ material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 2200, onHandGrams: 500 }, { role: "owner" });
    assert.equal(saved.landedUsdPerKg, 22);
    const listed = await useCases.list();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.effective.pla.source, "inventory_weighted");
    assert.equal(listed.effective.petg.source, "fallback");
    assert.equal((await useCases.materialCost("pla")).landedUsdPerKg, 22);
    const updated = await useCases.save({ id: saved.id, material: "pla", spoolNominalGrams: 1000, purchaseCostCents: 2400, onHandGrams: 0, active: false }, { role: "owner" });
    assert.equal(updated.active, false);
    assert.equal((await useCases.materialCost("pla")).source, "fallback");
    assert.equal(JSON.parse(await readFile(repository.path, "utf8")).filament.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Neon filament adapter reads active rows with parameters and maps integer cents", async () => {
  const calls = [];
  const query = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [{ id: "fil_aaaaaaaa", material: "pla", brand_line: null, color: "Black", spool_nominal_grams: "1000", purchase_cost_cents: "2000", freight_fee_cents: "150", on_hand_grams: "250", active: true, estimate_default: false, notes: null, created_at: now, updated_at: now }];
  };
  const [filament] = await createNeonPrintRepository({ query }).filamentForMaterial("pla");
  assert.match(calls[0].text, /FROM filament_inventory WHERE material = \? AND active = true/);
  assert.deepEqual(calls[0].values, ["pla"]);
  assert.equal(filament.freightFeeCents, 150);
  assert.equal(filament.updatedAt, now.toISOString());
});

test("operator print API requires an allowed origin and authorization before exposing cost basis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-filament-api-"));
  try {
    const printRuntime = { repository: createLocalPrintRepository({ path: join(directory, "print.json") }) };
    const call = async (handler, { method = "GET", url = "/api/operator-print?resource=filament", origin = "https://work.example", body } = {}) => {
      const headers = {};
      const res = { statusCode: 200, headers, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end(value) { this.body = value; this.writableEnded = true; }, writableEnded: false };
      const req = { method, url, headers: { origin, "content-type": "application/json" }, body };
      await handler(req, res);
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
    };
    const denied = createOperatorPrintHandler({ printRuntime, store: {}, allowedOrigins: ["https://work.example"], authorize: async () => { const { HttpError } = await import("../../lib/http.js"); throw new HttpError(401, "Sign in."); } });
    const anonymous = await call(denied);
    assert.equal(anonymous.status, 401);
    assert.equal(JSON.stringify(anonymous.body).includes("landed"), false);
    assert.equal((await call(denied, { origin: "https://evil.example" })).status, 403);
    const owner = createOperatorPrintHandler({ printRuntime, store: {}, allowedOrigins: ["https://work.example"], authorize: async () => ({ id: "op_1", role: "owner" }) });
    const saved = await call(owner, { method: "POST", body: { action: "save-filament", filament: { material: "petg", spoolNominalGrams: 1000, purchaseCostCents: 2600 } } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.filament.landedUsdPerKg, 26);
    const listed = await call(owner);
    assert.equal(listed.body.effective.petg.landedUsdPerKg, 26);
    assert.equal((await call(owner, { method: "POST", body: { action: "save-filament", filament: {}, extra: 1 } })).status, 400);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the migration runner keeps dollar-quoted function bodies together", () => {
  const statements = splitStatements("-- comment\nCREATE TABLE a (id int);\nCREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'x'; RETURN NEW; END $$;\nSELECT 1;");
  assert.equal(statements.length, 3);
  assert.match(statements[1], /RAISE EXCEPTION 'x'; RETURN NEW; END \$\$$/);
});
