import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCataloguePreview } from '../../lib/product-catalogue/previews.js';

test('private previews serve only current matching checked image bytes, never caller-supplied paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'catalogue-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'render-sample'); await mkdir(path);
  const bytes = await readFile(new URL('../../public/assets/images/products/name-plate.webp', import.meta.url));
  const digest = createHash('sha256').update(bytes).digest('hex');
  const image = { src: `/assets/images/products/catalogue/sample.webp?v=${digest.slice(0, 16)}`, alt: 'Sample studio render', kind: 'render' };
  const receipt = { jobId: 'render-sample', configurationSha256: 'a'.repeat(64), images: [image], imageSha256s: [digest] };
  await writeFile(join(path, 'result.json'), JSON.stringify(receipt));
  await writeFile(join(path, 'preview-0.webp'), bytes);
  const product = { render: { jobId: 'render-sample', outcome: 'ready', configurationSha256: 'a'.repeat(64), images: [image] } };
  const result = await readCataloguePreview({ privateRoot: root, product, index: 0 });
  assert.equal(result.mime, 'image/webp');
  assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  await assert.rejects(readCataloguePreview({ privateRoot: root, product, index: '../secret' }));
  await assert.rejects(readCataloguePreview({ privateRoot: root, product: { render: { ...product.render, jobId: '../../public' } }, index: 0 }));
  await assert.rejects(readCataloguePreview({ privateRoot: root, product: { render: { ...product.render, configurationSha256: 'b'.repeat(64) } }, index: 0 }));
  await writeFile(join(path, 'preview-0.webp'), 'PRIVATE FILE');
  await assert.rejects(readCataloguePreview({ privateRoot: root, product, index: 0 }), error => !/PRIVATE FILE|catalogue-preview-/.test(error.message));
});
