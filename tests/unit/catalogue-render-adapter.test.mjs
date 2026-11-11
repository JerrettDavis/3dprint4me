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
