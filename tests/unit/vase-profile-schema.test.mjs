import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParams } from '../../public/assets/js/customize/schema.js';
import { restoreParams, storableParams } from '../../customizer/framework/form.js';

const defaults = [
  { height: 0, radius: 0.5 }, { height: 0.5, radius: 1 }, { height: 1, radius: 0.4 },
];
const generator = {
  id: 'profile-test', schema: { profile: { type: 'profile', label: 'Vase profile', default: defaults } },
};

test('structured profile schema supplies independent validated defaults', () => {
  const result = validateParams(generator, {});
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.value.profile, defaults);
  assert.notEqual(result.value.profile, defaults);
  assert.notEqual(result.value.profile[0], defaults[0]);
});

test('structured profile validation rejects malformed data without string coercion', () => {
  for (const profile of [JSON.stringify(defaults), null, [],
    [{ height: 0, radius: 0.5 }, { height: 0.5, radius: 0.4 }, { height: 0.5, radius: 0.6 }],
    Array.from({ length: 13 }, (_, i) => ({ height: i / 12, radius: 0.5 })),
  ]) {
    const result = validateParams(generator, { profile });
    assert.equal(result.ok, false);
    assert.match(result.fieldErrors.profile, /profile/i);
    assert.equal(Object.hasOwn(result.value, 'profile'), false);
  }
});

test('profile drafts retain canonical points and invalid drafts restore defaults', () => {
  const edited = [defaults[0], { height: 0.6, radius: 0.8 }, defaults[2]];
  const draft = storableParams(generator, { profile: edited, unknown: 'discard' });
  assert.deepEqual(Object.keys(draft), ['profile']);
  assert.deepEqual(restoreParams(generator, JSON.stringify(draft)).profile, edited);
  assert.deepEqual(restoreParams(generator, JSON.stringify({ profile: 'bad' })).profile, defaults);
});
