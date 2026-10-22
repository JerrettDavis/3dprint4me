import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, colorDifference } from '../../lib/filament-matching/color.js';
import { normalizeMatchingSettings, matchRequirement, matchWorkRequirements } from '../../lib/filament-matching/domain.js';

test('color conversion and circular asymmetric bounds', () => {
  assert.equal(parseColor('#00f').hex, '#0000ff');
  assert.deepEqual(parseColor('#0000ff').hsl, [240, 100, 50]);
  assert.equal(parseColor('not-a-color'), null);
  const limits = normalizeMatchingSettings({ hueClockwise: 60, hueCounterclockwise: 65, saturation: 100, lightness: 100, closePercent: 25, stepPercent: 25 });
  assert.equal(colorDifference('#0000ff', '#800080', limits).eligible, true);
  assert.equal(colorDifference('#0000ff', '#b0eeee', limits).eligible, true);
  for (const color of ['#ff0000', '#ff69b4', '#00ff00']) assert.equal(colorDifference('#0000ff', color, limits).eligible, false);
  assert.equal(colorDifference('#ff0011', '#ff1100', normalizeMatchingSettings({ hueClockwise: 10, hueCounterclockwise: 0 })).eligible, true);
  assert.equal(colorDifference('#0000ff', '#ffff00', normalizeMatchingSettings({ hueClockwise: 180, hueCounterclockwise: 0, saturation: 100, lightness: 100 })).eligible, true);
});

test('RGB intersection, zero tolerance, neutral review and invalid settings', () => {
  const exact = normalizeMatchingSettings({ mode: 'rgb', red: 0, green: 0, blue: 0 });
  assert.equal(colorDifference('#123456', '#123456', exact).eligible, true);
  assert.equal(colorDifference('#123456', '#123457', exact).eligible, false);
  assert.equal(colorDifference('#ffffff', '#eeeeee', normalizeMatchingSettings()).review, true);
  assert.equal(colorDifference('#ffffff', '#eeeeee', normalizeMatchingSettings({ mode: 'both' })).eligible, true);
  assert.equal(colorDifference('#0000ff', '#1000ff', normalizeMatchingSettings({ mode: 'both', red: 0 })).eligible, false);
  assert.equal(colorDifference('#808080', '#ff0000', normalizeMatchingSettings({ mode: 'both', red: 255, green: 255, blue: 255, saturation: 0, lightness: 0 })).eligible, false);
  assert.equal(colorDifference('#808080', '#818181', normalizeMatchingSettings({ mode: 'both', lightness: 0 })).eligible, false);
  for (const input of [{ red: -1 }, { hueClockwise: 181 }, { mode: 'unknown' }, { stockBufferGrams: Infinity }, { injected: true }]) assert.throws(() => normalizeMatchingSettings(input));
});

const row = (id, colorHex, material = 'pla', onHandGrams = 100) => ({ id, colorHex, material, onHandGrams, active: true });
test('progressive bands, deterministic recommendation, further options and hard stops', () => {
  const settings = normalizeMatchingSettings({ mode: 'rgb', red: 100, green: 100, blue: 100 });
  const result = matchRequirement({ id: 'blue', material: 'pla', colorHex: '#0000ff', grams: 20 }, [row('b', '#1000ff'), row('a', '#1000ff'), row('far', '#5000ff'), row('red', '#ff0000'), row('empty', '#0000ff', 'pla', 0)], settings);
  assert.equal(result.recommendedId, 'a');
  assert.deepEqual(result.candidates.map(x => x.id), ['a', 'b']);
  assert.deepEqual(result.furtherCandidates.map(x => x.id), ['far']);
  assert.equal(result.band, 25);
  const wider = matchRequirement({ material: 'pla', colorHex: '#0000ff' }, [row('far', '#5000ff')], settings);
  assert.equal(wider.band, 100);
  assert.equal(matchRequirement({ material: 'pla', colorHex: '#0000ff' }, [row('p', '#0000ff', 'petg')], settings).recommendedId, null);
});

test('unknown demand and stock shared between requirements are never sufficient twice', () => {
  const requirements = ['a', 'b'].map(id => ({ id, material: 'pla', colorHex: '#0000ff', grams: 60 }));
  const result = matchWorkRequirements(requirements, [row('stock', '#0000ff')], normalizeMatchingSettings({ mode: 'rgb', stockBufferGrams: 0 }));
  assert.equal(result.requirements[0].status, 'ready');
  assert.equal(result.requirements[1].status, 'purchase');
  assert.equal(matchRequirement({ material: 'pla', colorHex: '#0000ff' }, [row('s', '#0000ff')], normalizeMatchingSettings({ mode: 'rgb' })).status, 'review');
});

test('selected alternatives, rather than recommendations, share stock within a request', () => {
  const requirements = [{ id: 'a', material: 'pla', colorHex: '#0000ff', grams: 60 }, { id: 'b', material: 'pla', colorHex: '#1000ff', grams: 60 }];
  const result = matchWorkRequirements(requirements, [row('blue', '#0000ff', 'pla', 100), row('purple', '#1000ff', 'pla', 80)], normalizeMatchingSettings({ mode: 'rgb', stockBufferGrams: 0 }), { a: 'purple' });
  assert.equal(result.requirements[0].selectedId, 'purple');
  assert.equal(result.requirements[1].status, 'purchase');
});

test('CIELAB conversion uses standard D65 reference colors', () => {
  const red = parseColor('#ff0000').lab;
  [53.2408, 80.0925, 67.2032].forEach((value, i) => assert.ok(Math.abs(value - red[i]) < 0.001));
  assert.ok(Math.abs(parseColor('#ffffff').lab[0] - 100) < 0.001);
  assert.deepEqual(parseColor('#000000').lab, [0, 0, 0]);
});
