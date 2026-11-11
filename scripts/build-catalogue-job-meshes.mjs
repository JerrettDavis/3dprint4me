// Trusted worker child. It receives safe settings in a private file, never an uploaded model.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cataloguePrivateRoot } from '../lib/product-catalogue/render-adapter.js';
import { catalogueRenderRecipes } from './catalogue-render-recipes.mjs';
import { productRenderInputHash } from './product-render-inputs.mjs';
import { getGenerator } from '../public/assets/js/customize/registry.js';
import { validateParams } from '../public/assets/js/customize/schema.js';
import { loadEngine } from '../customizer/framework/engine.js';
import { loadFont } from '../customizer/framework/fonts.js';
import { loadBuilder } from '../customizer/generators/index.js';
import { buildPresentationModel } from '../customizer/framework/model.js';

const root = new URL('../', import.meta.url);
const work = cataloguePrivateRoot(process.env.PRODUCT_RENDER_WORK_DIR);
const input = JSON.parse(await readFile(resolve(work, 'input.json'), 'utf8'));
const g = getGenerator(input.configuration.generatorId);
const base = `/assets/images/products/catalogue/${input.productId}-${input.configurationSha256.slice(0, 16)}`;
const recipes = catalogueRenderRecipes([{ id: input.productId, revision: 1, ...input.configuration,
  title: g.title, category: 'Preview', summary: 'Preview of public settings.', status: 'published',
  images: [{ src: `${base}-hero.webp`, alt: `${g.title}, studio render`, kind: 'render' }, { src: `${base}-detail.webp`, alt: `${g.title}, alternate studio view`, kind: 'render' }] }]);
if (recipes.some(recipe => recipe.configurationSha256 !== input.configurationSha256)) throw new Error('Invalid configuration fingerprint.');
const checked = validateParams(g, input.configuration.params);
if (!checked.ok) throw new Error('Public demonstration settings are not buildable.');
const wasm = await loadEngine();
const font = await loadFont({ fontId: checked.value.font, fetchImpl: async path => {
  const bytes = await readFile(new URL(`customizer/static/fonts/${path.split('/').pop()}`, root));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
} });
const { default: build } = await loadBuilder[g.id]();
const model = await buildPresentationModel({ ...g, build }, checked.value, { wasm, font });
const hashes = [];
for (const recipe of recipes) {
  const text = JSON.stringify({ recipe, parts: model.parts });
  await writeFile(resolve(work, `${recipe.id}.json`), text, { mode: 0o600 });
  hashes.push(createHash('sha256').update(text).digest('hex'));
}
await writeFile(resolve(work, 'recipes.json'), JSON.stringify({ version: 1, renders: recipes }), { mode: 0o600 });
const hash = createHash('sha256').update(await productRenderInputHash());
for (const path of ['scripts/build-catalogue-job-meshes.mjs', 'scripts/finish-catalogue-job.py', 'scripts/render-products.py']) hash.update(await readFile(new URL(path, root)));
await writeFile(resolve(work, 'mesh-receipt.json'), JSON.stringify({ jobId: input.id, configurationSha256: input.configurationSha256,
  inputSha256: hash.digest('hex'), meshSha256: createHash('sha256').update(hashes.join('\n')).digest('hex') }), { mode: 0o600 });
