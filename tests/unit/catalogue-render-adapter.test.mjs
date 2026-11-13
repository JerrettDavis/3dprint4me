import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCatalogueRenderAdapter } from '../../lib/product-catalogue/render-adapter.js';
import { catalogueConfigurationHash } from '../../lib/product-catalogue/domain.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';

const product = PRODUCTS.find(p => p.id === 'wifi-tag-card');
const configuration = { generatorId: product.generatorId, generatorVersion: product.generatorVersion, params: product.params };
const job = { id: 'render-safe123', productId: 'wifi-card', configuration, configurationSha256: catalogueConfigurationHash(configuration) };

test('render adapter rejects secrets, unsafe IDs and public output roots before starting a subprocess', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catalogue-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const render = createCatalogueRenderAdapter({ privateRoot: directory, runProcess: async () => { assert.fail('invalid input must not reach a child process'); } });
  await assert.rejects(render({ ...job, id: '../../public' }));
  await assert.rejects(render({ ...job, configuration: { ...configuration, params: { ...configuration.params, password: 'private' } } }));
  await assert.rejects(render({ ...job, configurationSha256: 'a'.repeat(64) }));
  await assert.rejects(render({ ...job, renderCamera: 'https://untrusted.test' }));
  assert.deepEqual(await readdir(directory), []);
  assert.throws(() => createCatalogueRenderAdapter({ privateRoot: new URL('../../public/catalogue-private/', import.meta.url) }));
});

test('failed child processes expose a bounded failure without credentials, paths or command output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catalogue-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const render = createCatalogueRenderAdapter({ privateRoot: directory, runProcess: async () => { throw new Error('PRIVATE CREDENTIAL /internal/path'); } });
  await assert.rejects(render(job), error => !/PRIVATE CREDENTIAL|internal\/path/.test(error.message));
});

test('Blender script failures stop the render before finishing stale previews', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catalogue-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const render = createCatalogueRenderAdapter({ privateRoot: directory, runProcess: async (command, args) => {
    calls.push(args);
    if (calls.length === 2) throw new Error('Blender script failed');
  } });
  await assert.rejects(render(job), /private draft is preserved/);
  assert.equal(calls.length, 2, 'do not run the finishing step after Blender fails');
  const flag = calls[1].indexOf('--python-exit-code');
  assert.ok(flag >= 0, 'Blender must report Python exceptions as process failures');
  assert.equal(calls[1][flag + 1], '1');
});
