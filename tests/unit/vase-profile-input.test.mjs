import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFormHtml, readControlValue } from '../../customizer/framework/form.js';
import generator from '../../public/assets/js/customize/generators/vase.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';
const input = await import('../../customizer/framework/profile-input.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const points = [{ height: 0, radius: 0.5 }, { height: 0.5, radius: 1 }, { height: 1, radius: 0.6 }];

test('adding a profile point splits the largest interval on the existing curve', () => {
  assert.equal(typeof input.addProfilePoint, 'function');
  const next = input.addProfilePoint(points);
  assert.equal(next.length, 4);
  assert.equal(next[1].height, 0.25);
  assert.ok(next[1].radius > 0.5 && next[1].radius < 1);
  assert.equal(points.length, 3);
});

test('profile point editing enforces endpoint and neighbor constraints', () => {
  assert.equal(typeof input.moveProfilePoint, 'function');
  const moved = input.moveProfilePoint(points, 1, { height: 2, radius: -1 });
  assert.equal(moved[1].height, 0.98);
  assert.equal(moved[1].radius, 0.05);
  assert.equal(input.moveProfilePoint(points, 0, { height: 0.5, radius: 0.8 })[0].height, 0);
  assert.equal(input.moveProfilePoint(points, 2, { height: 0.5, radius: 0.8 })[2].height, 1);
});

test('profile removal preserves endpoints and minimum point count', () => {
  assert.equal(typeof input.removeProfilePoint, 'function');
  assert.throws(() => input.removeProfilePoint(points, 1), /profile/i);
  const added = input.addProfilePoint(points);
  assert.throws(() => input.removeProfilePoint(added, 0), /profile/i);
  assert.deepEqual(input.removeProfilePoint(added, 1), points);
});

test('profile form includes labeled numeric alternatives and structured hidden state', () => {
  const generator = { schema: { profile: { type: 'profile', label: 'Vase profile', default: points } } };
  const html = renderFormHtml(generator);
  assert.match(html, /Point 1 height/);
  assert.match(html, /Point 1 radius/);
  assert.match(html, /Add point/);
  assert.match(html, /Remove point 2/);
  assert.match(html, /name="profile"/);
  assert.deepEqual(readControlValue({ type: 'profile' }, { value: JSON.stringify(points) }), points);
  assert.doesNotThrow(() => readControlValue({ type: 'profile' }, { value: 'broken' }));
});

test('vase profile includes synchronized physical endpoint controls without duplicate submitted fields', () => {
  const html = renderFormHtml(generator, validateParams(generator, {}).value);
  assert.match(html, /Base outside diameter \(mm\)/);
  assert.match(html, /Mouth outside diameter \(mm\)/);
  assert.match(html, /data-profile-diameter="base"/);
  assert.doesNotMatch(html, /name="base_diameter_mm"/);
});
