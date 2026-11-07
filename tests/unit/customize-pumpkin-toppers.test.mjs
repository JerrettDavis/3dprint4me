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
      assert.equal(result.warnings.some(w=>w.includes('contoured hat seat')),export_parts!=='pumpkin');
      assert.equal(result.warnings.some(w=>w.includes('cap uses a separate mounting pin')),topper==='baseball' && export_parts!=='pumpkin');
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
      const fullSection = hat.slice(25);
      const center = wasm.CrossSection.circle(2.1,64);
      const pegSection = fullSection.intersect(center);
      fullSection.delete(); center.delete();
      try {
        if (style === 'baseball') assert.equal(pegSection.area(),0,'cap mounting pin remains separate');
        else assert.ok(pegSection.area() > 8 && pegSection.area() < 11.5, 'round peg passes through hollow crown');
      } finally { pegSection.delete(); }
    } finally { body.delete(); hat.delete(); }
  });
}

for (const [style, radius] of [['witch',17.4],['santa',14.5],['baseball',17.8]]) {
  test(`${style}: inner and outer seat follow the pumpkin around its lobes`, async () => {
    const { buildTopper } = await import('../../customizer/generators/pumpkin/toppers/index.js');
    const wasm = await loadEngine(), crown = referencePumpkin(wasm), hat = buildTopper(wasm,style);
    try {
      for (const r of [8,radius]) for (let i=0;i<16;i++) {
        const a=i*Math.PI/8, x=r*Math.cos(a), y=r*Math.sin(a);
        const bodyTop=crown.rayCast([x,y,60],[x,y,0])[0].position[2];
        const underside=hat.rayCast([x,y,bodyTop+.001],[x,y,60])[0];
        assert.ok(underside, `${style} covers seat at ${r} mm, angle ${i}`);
        const gap=underside.position[2]-bodyTop;
        assert.ok(gap>=.18 && gap<.5, `${style} seat gap ${gap.toFixed(3)} mm at ${r} mm, angle ${i}`);
      }
    } finally { crown.delete(); hat.delete(); }
  });
}

test('every cap size seats close around the pumpkin shoulders without collisions', async () => {
  const { buildTopper } = await import('../../customizer/generators/pumpkin/toppers/index.js');
  const wasm=await loadEngine(), body=referencePumpkin(wasm);
  try {
    for(let diameter=30;diameter<=40;diameter++) {
      const hat=buildTopper(wasm,'baseball',{crownDiameter:diameter});
      const collision=body.intersect(hat);
      try {
        assert.ok(collision.volume()<.001,`${diameter} mm cap clears pumpkin`);
        // Keep the sample on the upper shoulder for caps extending past it.
        const r=Math.min(17.8,diameter/2-.3);
        for(let i=0;i<16;i++) {
          const a=i*Math.PI/8,x=r*Math.cos(a),y=r*Math.sin(a);
          const z=body.rayCast([x,y,60],[x,y,0])[0].position[2];
          const hit=hat.rayCast([x,y,z+.001],[x,y,60])[0];
          assert.ok(hit && hit.position[2]-z<.5,`${diameter} mm cap edge follows shoulder at angle ${i}`);
        }
      } finally {collision.delete();hat.delete();}
    }
  } finally {body.delete();}
});
