import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEngine } from '../../customizer/framework/engine.js';
import { printableFeature } from '../../customizer/generators/pumpkin/printability.js';

const { CrossSection } = await loadEngine();

// These spans are deliberately small: optimization must not replace an ordinary
// bridgeable roof with a pointed cone or erase the bottom half of a round eye.
test('cutout optimization preserves a small round eye', () => {
  const temps = [], t = x => { temps.push(x); return x; };
  try {
    const eye = t(CrossSection.circle(4, 40));
    const adapted = printableFeature(CrossSection, eye, t);
    assert.ok(Math.abs(adapted.area() - eye.area()) < .001,
      'an 8 mm round eye should keep its original outline');
  } finally { for (const x of temps) x.delete(); }
});

test('cutout optimization preserves a short flat bridge roof', () => {
  const temps = [], t = x => { temps.push(x); return x; };
  try {
    const mouth = t(CrossSection.square([10, 4], true));
    const adapted = printableFeature(CrossSection, mouth, t);
    assert.ok(Math.abs(adapted.area() - mouth.area()) < .001,
      'a 10 mm roof anchored on both sides should remain flat');
  } finally { for (const x of temps) x.delete(); }
});

// A wide flat mouth must retain its flat roof, with a removable support rather
// than a triangle. The contact is intentionally narrower than the support body.
test('wide flat roofs get supports with a break-away contact neck', () => {
  const temps = [], t = x => { temps.push(x); return x; };
  try {
    const mouth = t(CrossSection.square([20, 8], true));
    const adapted = printableFeature(CrossSection, mouth, t);
    const material = t(mouth.subtract(adapted));
    const widthAt = y => {
      const band = t(t(CrossSection.square([22, .1], true)).translate([0, y]));
      return t(material.intersect(band)).area() / .1;
    };
    assert.ok(widthAt(3.8) > .3 && widthAt(3.8) < .6, 'small break-away roof contact');
    assert.ok(widthAt(0) >= 1.1, 'sturdier support stem');
    assert.ok(adapted.area() > 140, 'preserves most of the original 160 mm² opening');
  } finally { for (const x of temps) x.delete(); }
});
