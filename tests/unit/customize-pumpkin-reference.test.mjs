import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEngine } from '../../customizer/framework/engine.js';
import pumpkin from '../../public/assets/js/customize/generators/pumpkin.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';
import { normalizeCustomization } from '../../lib/customization/domain.js';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DATA, REFERENCE } from '../../customizer/generators/pumpkin/reference-data.js';
import { partSection } from '../../customizer/framework/sections.js';

test('reference geometry is pinned to the supplied file and exact-coordinate main shell', () => {
  assert.equal(REFERENCE.sourceSha256, '8bf2485d6549eb3fdfaca9ac3ecf6e6911a4b961474a4787dfc13a6a3c7cd991');
  assert.equal(createHash('sha256').update(gunzipSync(Buffer.from(DATA, 'base64'))).digest('hex'), 'ecf577a6de345218ef9e8ff5a5b6a88787a20f7b2066084c4bd7bcab7901084d');
  assert.equal(REFERENCE.removedDebrisTriangles, 98);
});

test('reference pumpkin defaults and festive presets use the exact supplied body; legacy provenance stays parametric', () => {
  const d = validateParams(pumpkin, {});
  assert.equal(d.value.body_source, 'reference');
  assert.equal(d.value.topper, 'witch');
  for (const style of ['witch', 'santa', 'baseball']) {
    const preset = pumpkin.presets[style];
    assert.ok(preset, `${style} gallery preset`);
    assert.equal(validateParams(pumpkin, preset).value.body_source, 'reference');
  }
  for (const v of [1,2,3]) assert.equal(normalizeCustomization({ generatorId: 'pumpkin', generatorVersion: v, params: {} }).params.body_source, 'parametric');
  assert.equal(validateParams(pumpkin, { export_parts: 'hat', topper: 'none' }).ok, false);
  assert.equal(partSection(pumpkin, 'Pumpkin · original happy'), 'type', 'reference body links to its visible body selector');
});

const moduleUrl = new URL('../../customizer/generators/pumpkin/reference.js', import.meta.url);

test('exact reference pumpkin has a worker-only loader', () => {
  assert.ok(existsSync(moduleUrl), 'reference mesh loader must exist');
});

test('reference shell preserves measured dimensions and round socket without moving its axis', async () => {
  const { referencePumpkin, REFERENCE } = await import(moduleUrl);
  const wasm = await loadEngine();
  const body = referencePumpkin(wasm);
  try {
    assert.equal(body.status(), 'NoError');
    const box = body.boundingBox();
    const expected = [45.947322845458984, 45.988433837890625, 29.95484161376953];
    expected.forEach((v, i) => assert.ok(Math.abs(box.max[i] - box.min[i] - v) < 0.00001));
    assert.equal(box.min[2], 0);
    assert.equal(REFERENCE.triangles, 94074);
    const parts = body.decompose();
    assert.equal(parts.length, 1);
    parts.forEach(p => p.delete());
    // Ø4 is clear through the entire roof. Ø4.4 touches the roof: this catches
    // scaling, plugging the hole, changing the socket, and recentering its axis.
    const tube = r => wasm.Manifold.cylinder(2.5, r, r, 128).translate([0, 0, 16.8 - REFERENCE.minZ]);
    for (const [r, empty] of [[1.99, true], [2.2, false]]) {
      const probe = tube(r);
      const hit = body.intersect(probe);
      try { assert.equal(hit.isEmpty(), empty, `socket radius ${r}`); }
      finally { hit.delete(); probe.delete(); }
    }
  } finally { body.delete(); }
});
