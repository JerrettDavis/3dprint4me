import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS } from '../../public/assets/js/customize/registry.js';
import { editingSections, reviewEntries } from '../../customizer/framework/studio-sections.js';
import { optionArt } from '../../customizer/framework/option-art.js';
import { renderFormHtml } from '../../customizer/framework/form.js';

for (const generator of Object.values(GENERATORS)) {
  test(`${generator.id}: grouped editing covers every field once in a few sections`, () => {
    const sections = editingSections(generator);
    assert.ok(sections.length >= 2 && sections.length <= 3);
    const keys = sections.flatMap(s => s.keys);
    assert.deepEqual([...keys].sort(), Object.keys(generator.schema).sort());
    assert.equal(new Set(keys).size, keys.length);
  });
}
test('future schema groups fall back without losing controls', () => {
  assert.ok(editingSections({ id: 'unknown', schema: { future: { group: 'future' } } }).flatMap(s => s.keys).includes('future'));
});
test('review excludes sensitive, transient and invisible fields', () => {
  const generator = { schema: { secret: { sensitive: true }, temp: { transient: true }, hidden: { visibleWhen: { enabled: true } }, color: { type: 'color', label: 'Body' } } };
  assert.deepEqual(reviewEntries(generator, { secret: 'PRIVATE', temp: 'TEMP', hidden: 'HIDDEN', color: '#008e95' }), [{ key: 'color', label: 'Body', value: '#008e95' }]);
});
test('enum and color choices have visual inputs without changing authoritative values', () => {
  const generator = GENERATORS['pumpkin'];
  const html = renderFormHtml(generator, {});
  assert.match(html, /data-visual-choice="face"/);
  assert.match(html, /data-color-choice="body_color"/);
  assert.match(html, /name="face"/);
  assert.match(html, /aria-label="Face choices"/);
});
test('option illustrations are local, accessible decoration, and specific to the choice', () => {
  const witch = optionArt('pumpkin', 'topper', 'witch');
  assert.match(witch, /<svg/);
  assert.match(witch, /aria-hidden="true"/);
  assert.notEqual(witch, optionArt('pumpkin', 'topper', 'baseball'));
  assert.notEqual(optionArt('pumpkin', 'face', 'cute'), optionArt('pumpkin', 'face', 'traditional'));
  assert.doesNotMatch(optionArt('unknown', '<script>', '<img src=x>'), /<script|<img src=x|https?:/);
});
test('physical illustrations distinguish shells/adapters, assemblies/fit and texture direction',()=>{
  assert.notEqual(optionArt('gridfinity-bin','vase_part','shell'),optionArt('gridfinity-bin','vase_part','adapter'));
  assert.notEqual(optionArt('infinity-fidget','model_kind','assembly'),optionArt('infinity-fidget','model_kind','fit'));
  assert.notEqual(optionArt('infinity-fidget','texture','ridged'),optionArt('infinity-fidget','texture','lines'));
  assert.notEqual(optionArt('pumpkin','opening','top'),optionArt('pumpkin','opening','bottom'));
  assert.notEqual(optionArt('infinity-fidget','shape','spherical'),optionArt('infinity-fidget','shape','cube'));
});
