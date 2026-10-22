import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpoolmanSnapshot, importedEligibility } from '../../lib/spoolman/domain.js';
const spool = patch => ({ id: 7, archived: false, remaining_weight: 800.9, initial_weight: 1000, filament: { id: 3, material: 'PLA', name: 'Blue', color_hex: '0044FF', weight: 1000, vendor: { name: 'Maker' } }, ...patch });
const normalize = rows => normalizeSpoolmanSnapshot({ instanceId: 'home', currency: 'USD', spools: rows }).items;
test('mapping preserves physical identity, fractional weights, raw material and unknown cost', () => {
  const [row] = normalize([spool()]);
  assert.equal(row.material, 'pla'); assert.equal(row.onHandGrams, 800); assert.equal(row.purchaseCostCents, null);
  assert.equal(row.source.remainingGrams, 800.9); assert.equal(row.source.spoolId, 7); assert.equal(row.source.rawMaterial, 'PLA');
  assert.equal(row.colorHex, '#0044ff');
  assert.equal(normalize([spool({ price: 0 })])[0].purchaseCostCents, 0);
});
test('explicit aliases keep PLA+ distinct; unknown material never eligible', () => {
  for (const [label, expected] of [['PLA+', 'pla-plus'], ['Flexible (TPU)', 'tpu'], ['TPU', 'tpu'], ['ABS', 'abs'], ['PETG', 'petg']]) {
    assert.equal(normalize([spool({ filament: { material: label } })])[0].material, expected);
  }
  const [unknown] = normalize([spool({ filament: { material: 'Mystery' } })]);
  assert.equal(unknown.source.materialKnown, false);
});
test('source price precedence and non-USD costs, missing denominators, weights and invalid values', () => {
  assert.equal(normalize([spool({ price: 21 })])[0].purchaseCostCents, 2100);
  const foreign = normalizeSpoolmanSnapshot({ instanceId: 'home', currency: 'EUR', spools: [spool({ price: 21 })] }).items[0];
  assert.equal(foreign.purchaseCostCents, null);
  assert.equal(normalize([spool({ remaining_weight: undefined })])[0].onHandGrams, null);
  for (const value of [-1, NaN, Infinity, '800', 10000001]) assert.throws(() => normalize([spool({ remaining_weight: value })]));
  assert.throws(() => normalize([spool(), spool()]));
});
test('multicolor, alpha, transparent, missing color, unknown weights and stale source cannot match', () => {
  const now = new Date('2026-10-22T12:00:00Z'), fresh = '2026-10-22T11:59:59Z';
  const [solid] = normalize([spool()]);
  assert.equal(importedEligibility(solid, { now, lastSuccessAt: fresh }).eligible, true);
  for (const filament of [{ material: 'PLA', name: 'Blue', multi_color_hexes: '0000FF,FF0000' }, { material: 'PLA', color_hex: '0000FF80' }, { material: 'PLA', name: 'Transparent Blue', color_hex: '0000FF' }, { material: 'Unknown', color_hex: '0000FF' }, { material: 'PLA' }]) {
    const [row] = normalize([spool({ filament })]);
    assert.equal(importedEligibility(row, { now, lastSuccessAt: fresh }).eligible, false);
  }
  assert.equal(importedEligibility(solid, { now, lastSuccessAt: '2026-10-22T11:55:00Z' }).eligible, false);
});
