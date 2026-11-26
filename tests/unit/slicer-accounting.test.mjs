import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGcodeSummary } from '../../lib/print-estimation/adapters/local-cli-slicer.js';
import { parseBambuResult } from '../../lib/print-estimation/adapters/bambu-cli-slicer.js';

test('missing G-code swap evidence is unknown; an explicit zero is measured', () => {
  assert.equal(parseGcodeSummary('; filament used [g] = 10').toolChanges, null);
  assert.equal(parseGcodeSummary('; total toolchanges = 0').toolChanges, 0);
  assert.equal(parseGcodeSummary('; total filament change: 14').toolChanges, 14);
});

test('Bambu missing and partial plate swap counts remain unknown', () => {
  const parse = sliced_plates => parseBambuResult(JSON.stringify({return_code: 0, sliced_plates}));
  assert.equal(parse([]).toolChanges, null);
  assert.equal(parse([{}]).toolChanges, null);
  assert.equal(parse([{filament_change_times: 2}, {}]).toolChanges, null);
  assert.equal(parse([{filament_change_times: 0}]).toolChanges, 0);
  assert.equal(parse([{filament_change_times: 2}, {filament_change_times: 3}]).toolChanges, 5);
});

test('Bambu incomplete time or filament totals cannot price a partial model', () => {
  const parsed = parseBambuResult(JSON.stringify({sliced_plates: [
    {total_predication: 100, filaments: [{total_used_g: 12}]},
    {filaments: [{total_used_g: null}]}
  ]}));
  assert.equal(parsed.elapsedSeconds, null);
  assert.equal(parsed.materialGrams, null);
});

test('malformed G-code material lists do not silently discard a filament', () => {
  assert.equal(parseGcodeSummary('; filament used [g] = 10,unknown').materialGrams, null);
  assert.equal(parseGcodeSummary('; filament used [g] = 10,-2').materialGrams, null);
  assert.equal(parseGcodeSummary('; filament used [g] = 10,2').materialGrams, 12);
});

test('Bambu waste excludes model and supports and is already included in total grams', () => {
  const parse = filaments => parseBambuResult(JSON.stringify({sliced_plates: [{filaments}]}));
  const measured = parse([{total_used_g: 30, main_used_g: 12}, {total_used_g: 10, main_used_g: 8}]);
  assert.equal(measured.materialGrams, 40);
  assert.equal(measured.wasteGrams, 20);
  assert.equal(parse([{total_used_g: 30}]).wasteGrams, null);
  assert.equal(parse([{total_used_g: 10, main_used_g: 12}]).wasteGrams, null);
  assert.equal(parse([{total_used_g: 10, main_used_g: 10}]).wasteGrams, 0);
});
