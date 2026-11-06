import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../../customizer/framework/engine.js';
import { referencePumpkin } from '../../customizer/generators/pumpkin/reference.js';
import pumpkin from '../../public/assets/js/customize/generators/pumpkin.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';
import build from '../../customizer/generators/pumpkin/build.js';
import { buildModel } from '../../customizer/framework/model.js';
import { analyzeModelBytes } from '../../public/assets/js/print-estimation/geometry.js';
import { inflateRawSync } from 'node:zlib';
import { trackLiveObjects } from '../support/manifold-live.mjs';

test('reference export choices own only returned solids and free intermediates on failure', async () => {
  const wasm = await loadEngine();
  const tracked = trackLiveObjects(wasm);
  try {
    for (const topper of ['witch','santa','baseball']) for (const export_parts of ['both','hat','pumpkin']) {
      const p = validateParams(pumpkin, { ...pumpkin.presets[topper], export_parts }).value;
      const result = await build(p, { wasm: tracked.ctxWasm });
      assert.equal(tracked.live.size, result.solids.length);
      assert.equal(result.solids.some(s => s.name.startsWith('Pumpkin')), export_parts !== 'hat');
      assert.equal(result.solids.some(s => s.name.startsWith('Hat')), export_parts !== 'pumpkin');
      result.solids.forEach(s => s.solid.delete());
      assert.equal(tracked.live.size, 0);
    }
    await assert.rejects(() => build({ ...validateParams(pumpkin, {}).value, topper: 'invalid' }, { wasm: tracked.ctxWasm }), /supported pumpkin hat/);
    assert.equal(tracked.live.size, 0);
  } finally { tracked.restore(); }
});

test('festive export contains real contrasting trim volumes and analyzer-clean printable parts', async () => {
  const wasm = await loadEngine();
  for (const topper of ['witch', 'santa', 'baseball']) {
    const p = validateParams(pumpkin, pumpkin.presets[topper]).value;
    const out = await buildModel({ ...pumpkin, build }, p, { wasm });
    assert.ok(out.parts.some(s => s.name.includes('trim')), `${topper} printable trim`);
    const a = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw: async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max })) });
    assert.deepEqual(a.warnings.filter(w => w !== 'embedded_settings_ignored'), [], topper);
  }
});

for (const style of ['witch', 'santa', 'baseball']) {
  test(`${style}: detailed connected topper with a clear moulded seat and round fitted peg`, async () => {
    const { buildTopper } = await import('../../customizer/generators/pumpkin/toppers/index.js');
    const wasm = await loadEngine();
    const body = referencePumpkin(wasm);
    const hat = buildTopper(wasm, style, { clearance: 0.3 });
    try {
      assert.equal(hat.status(), 'NoError');
      assert.ok(hat.volume() > 500);
      assert.ok(hat.numTri() > 1500, 'hat should contain sculpted surface detail');
      const parts = hat.decompose();
      assert.equal(parts.length, 1, 'all details and peg are attached');
      parts.forEach(s => s.delete());
      const collision = body.intersect(hat);
      try { assert.ok(collision.volume() < 0.001, `assembled collision ${collision.volume()} mm³`); }
      finally { collision.delete(); }
      // Below the lowest brim, inside the pumpkin cavity, this isolates the peg.
      const pegSection = hat.slice(25);
      try {
        assert.ok(pegSection.area() > 8 && pegSection.area() < 11.5, 'round peg passes through hollow crown');
      } finally { pegSection.delete(); }
    } finally { body.delete(); hat.delete(); }
  });
}
