import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildTopper } from '../../customizer/generators/pumpkin/toppers/index.js';
import build from '../../customizer/generators/pumpkin/reference-build.js';
import pumpkin from '../../public/assets/js/customize/generators/pumpkin.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';

test('cap has a broader crown and both bill roots overlap the dome', async () => {
  const wasm = await loadEngine();
  const cap = buildTopper(wasm, 'baseball', { crownDiameter: 36 });
  const section = cap.slice(34);
  try {
    const bounds = section.bounds();
    assert.ok(bounds.max[0] - bounds.min[0] > 34, 'broader crown above the bill');
    for (const x of [-16.5, 16.5]) {
      const probe = wasm.Manifold.cylinder(2, .3, .3, 16).translate([x,-5,29]);
      const hit = cap.intersect(probe);
      try { assert.ok(hit.volume() > .4, 'bill root meets dome across its full thickness'); }
      finally { hit.delete(); probe.delete(); }
    }
  } finally { section.delete(); cap.delete(); }
});

test('every fitted crown size keeps the bill roots inside its dome', async () => {
  const wasm=await loadEngine();
  for(let diameter=31;diameter<=40;diameter++) {
    const cap=buildTopper(wasm,'baseball',{crownDiameter:diameter});
    const strip=wasm.Manifold.cube([60,.2,.1]).translate([-30,-5.1,30.05]);
    const rootSlice=cap.intersect(strip);
    const root=rootSlice.boundingBox().max[0]-.25;
    rootSlice.delete();strip.delete();
    try {
      for(const side of [-1,1]) {
        const probe=wasm.Manifold.cylinder(.5,.2,.2,16).translate([side*root,-5,30.3]);
        const hit=cap.intersect(probe);
        try { assert.ok(hit.volume()>.04,`${diameter} mm crown connects above bill root`); }
        finally {hit.delete();probe.delete();}
      }
    } finally {cap.delete();}
  }
});

test('visor stitches retain printable relief above the bill surface', async () => {
  const wasm=await loadEngine(), cap=buildTopper(wasm,'baseball');
  const section=cap.slice(30.45);
  const front=wasm.CrossSection.square([40,10]).translate([-20,-30]);
  const detail=section.intersect(front);
  try {assert.ok(detail.area()>.25,'outboard stitching survives more than one 0.16 mm layer above bill');}
  finally {detail.delete();front.delete();section.delete();cap.delete();}
});

test('downloads include removable supports under Santa pompom; presentation omits them', async () => {
  const wasm = await loadEngine();
  const p = validateParams(pumpkin, { ...pumpkin.presets.santa, export_parts: 'hat' }).value;
  const model = build(p, { wasm });
  const preview = build(p, { wasm, presentation: true });
  try {
    const supports = model.solids.filter(s => s.name.startsWith('Support'));
    assert.ok(supports.length, 'actual support geometry is exported');
    assert.ok(!preview.solids.some(s => s.name.startsWith('Support')));
    const support = supports[0].solid;
    assert.ok(support.volume() > 20);
    const bounds = support.boundingBox();
    assert.ok(Math.abs(bounds.min[2]) < .001, 'supports start on export bed');
    const cap = model.solids.find(s => s.name.startsWith('Hat ·')).solid;
    const collision = support.intersect(cap);
    try { assert.ok(collision.volume() < .001, 'support does not fuse to finished geometry'); }
    finally { collision.delete(); }
    // Pompom is x=12,y=0; the hat is translated only vertically for hat-only export.
    const probe = wasm.Manifold.cylinder(.5,.2,.2,16).translate([12,0,11]);
    const hit = support.intersect(probe);
    try { assert.ok(hit.volume() > .01, 'support reaches beneath hanging pompom'); }
    finally { hit.delete(); probe.delete(); }
  } finally { for (const result of [model,preview]) result.solids.forEach(s=>s.solid.delete()); }
});
