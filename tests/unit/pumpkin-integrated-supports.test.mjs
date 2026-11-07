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

test('visor stitches retain relief on the contoured bill', async () => {
  const wasm=await loadEngine(), cap=buildTopper(wasm,'baseball');
  try {
    const at=a=>cap.rayCast([14.2*Math.cos(a),-5+16.2*Math.sin(a),60],
      [14.2*Math.cos(a),-5+16.2*Math.sin(a),0])[0].position[2];
    const a=Math.PI+.12+12/25*(Math.PI-.24), halfStep=(Math.PI-.24)/50;
    const relief=at(a)-(at(a-halfStep)+at(a+halfStep))/2;
    assert.ok(relief>.16, `stitch relief ${relief} mm`);
  } finally {cap.delete();}
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
    const underPom=support.rayCast([14.4,0,50],[14.4,0,0]);
    assert.ok(underPom.some(h=>h.position[2]>8),'support reaches the hanging pompom underside');
  } finally { for (const result of [model,preview]) result.solids.forEach(s=>s.solid.delete()); }
});

test('contoured cap exports fitted seat supports and a separate mounting pin', async () => {
  const wasm=await loadEngine();
  for(const diameter of [30,36,40]) {
    const p=validateParams(pumpkin,{...pumpkin.presets.baseball,cap_crown_mm:diameter}).value;
    const result=build(p,{wasm});

    try {
      const support=result.solids.find(s=>s.name.startsWith('Support · baseball'));
      assert.ok(support,'curved cap underside has removable supports');
      assert.ok(Math.abs(support.solid.boundingBox().min[2])<.001,'supports start at bed');
      const cap=wasm.Manifold.union(result.solids.filter(s=>s.name.startsWith('Hat')).map(s=>s.solid));
      const contact=support.solid.intersect(cap);
      try { assert.ok(contact.volume()<.001,'supports do not fuse to cap'); }
      finally { contact.delete(); cap.delete(); }
      assert.ok(result.solids.some(s=>s.name.startsWith('Mount pin')));
      assert.ok(!result.warnings.some(w=>w.includes('one flat base')));
    } finally {result.solids.forEach(s=>s.solid.delete());}
  }
});

test('reference pumpkin never adds supports, and the separate cap pin fits both assembled sockets', async () => {
  const wasm = await loadEngine();
  for (const topper of ['none', 'witch', 'santa', 'baseball']) for (const hat_supports of [false, true]) {
    const p = validateParams(pumpkin, { topper, hat_supports, export_parts: 'pumpkin' }).value;
    const result = build(p, { wasm });

    try {
      assert.equal(result.solids.length, 1);
      assert.equal(result.slicerSettings.enable_support, '0');
    } finally { result.solids.forEach(s => s.solid.delete()); }
  }
  for (const clearance of [.1, .3, .6]) {
    const p = validateParams(pumpkin, { ...pumpkin.presets.baseball, hat_clearance_mm: clearance }).value;
    const result = build(p, { wasm, presentation: true });

    try {
      const pin = result.solids.find(s => s.name.startsWith('Mount pin')).solid;
      assert.ok(pin.volume() > 50, 'substantial mounting pin');
      for (const other of result.solids.filter(s => !s.name.startsWith('Mount pin'))) {
        const collision = pin.intersect(other.solid);
        try { assert.ok(collision.volume() < .001, `pin clears ${other.name}`); }
        finally { collision.delete(); }
      }
      const seated = pin.slice(30.8);
      try { assert.ok(seated.area() > 8, 'pin extends into cap socket above the pumpkin'); }
      finally { seated.delete(); }
    } finally { result.solids.forEach(s => s.solid.delete()); }
  }
});
