import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildModel, buildPresentationModel } from '../../customizer/framework/model.js';
import { handleBuildRequest } from '../../customizer/framework/worker-core.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { loadBuilder } from '../../customizer/generators/index.js';

const wasm = await loadEngine();
const bounds = part => [0, 1, 2].map(axis => {
  const values = part.mesh.vertices.map(v => v[axis]);
  return [Math.min(...values), Math.max(...values)];
});
const generator = async id => ({ ...getGenerator(id), build: (await loadBuilder[id]()).default });
const defaults = gen => Object.fromEntries(Object.entries(gen.schema).map(([k, v]) => [k, v.default]));
const volume = part => Math.abs(part.mesh.triangles.reduce((sum, triangle) => {
  const [a, b, c] = triangle.map(i => part.mesh.vertices[i]);
  return sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
}, 0));

test('presentation is geometry only and cannot change print bytes or params', async () => {
  const gen = await generator('pumpkin');
  const params = { ...defaults(gen), style: 'bowl', face: 'cute', face_style: 'cutout', optimize_cutouts: true, stem: 'peg' };
  const before = structuredClone(params);
  const print = await buildModel(gen, params, { wasm });
  const preview = await buildPresentationModel(gen, params, { wasm });
  assert.deepEqual(Object.keys(preview), ['parts']);
  assert.deepEqual(params, before);
  // ZIP headers carry the build time; compare every packaged file's actual bytes.
  const contents = data => Object.fromEntries(Object.entries(unzipSync(data)).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
  assert.deepEqual(contents((await buildModel(gen, params, { wasm })).data), contents(print.data));
  assert.notDeepEqual(preview.parts.find(p => p.name === 'Bowl').mesh, print.parts.find(p => p.name === 'Bowl').mesh);
  assert.ok(volume(print.parts.find(p => p.name === 'Bowl')) > volume(preview.parts.find(p => p.name === 'Bowl')) + .1, 'display omits physical face supports');
  const bowl = bounds(preview.parts.find(p => p.name === 'Bowl'));
  const lid = bounds(preview.parts.find(p => p.name === 'Lid'));
  const stem = bounds(preview.parts.find(p => p.name === 'Stem'));
  assert.ok(Math.abs((lid[0][0] + lid[0][1]) - (bowl[0][0] + bowl[0][1])) < 2, 'lid centered on bowl');
  assert.ok(stem[2][1] > lid[2][1], 'stem upright above lid');
});

test('display sign presentation stands in its holder', async () => {
  const gen = await generator('display-sign');
  const preview = await buildPresentationModel(gen, defaults(gen), { wasm });
  const sign = bounds(preview.parts.find(p => p.name === 'Sign body'));
  const holder = bounds(preview.parts.find(p => p.name === 'Holder'));
  assert.ok(sign[2][1] > holder[2][1] + 30);
  assert.ok(sign[1][1] - sign[1][0] < sign[2][1] - sign[2][0], 'sign is upright');
});

test('worker presentation request never packages or transfers a printable file', async () => {
  const deps = {
    getGenerator: () => ({ id: 'test' }), loadBuilder: { test: async () => ({ default: () => {} }) },
    loadEngine: async () => ({}), loadFont: async () => null,
    buildModel: () => { throw new Error('must not package'); },
    buildPresentationModel: async (_gen, _params, ctx) => { assert.equal(ctx.presentation, true); return { parts: [] }; }
  };
  const result = await handleBuildRequest({ id: 1, generatorId: 'test', params: {}, purpose: 'presentation' }, deps);
  assert.deepEqual(result, { message: { id: 1, ok: true, result: { parts: [] } }, transfer: [] });
});
