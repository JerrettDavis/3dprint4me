// Build catalog geometry locally using the same builders as customer downloads.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../customizer/framework/engine.js';
import { buildPresentationModel } from '../customizer/framework/model.js';
import { loadBuilder } from '../customizer/generators/index.js';
import { getGenerator } from '../public/assets/js/customize/registry.js';
import { validateParams, sensitiveKeys } from '../public/assets/js/customize/schema.js';
import { loadFont } from '../customizer/framework/fonts.js';
import { productRenderInputHash } from './product-render-inputs.mjs';
import { PRODUCTS } from '../public/assets/js/catalogue/products.js';
import { catalogueRenderRecipes } from './catalogue-render-recipes.mjs';

const root = new URL('../', import.meta.url);
const recipes = JSON.parse(await readFile(new URL('product-render-recipes.json', import.meta.url)));
recipes.renders.push(...catalogueRenderRecipes(PRODUCTS));
const wasm = await loadEngine();
await mkdir(new URL('.private/product-renders/', root), { recursive: true });
await writeFile(new URL('.private/product-renders/recipes.json', root), JSON.stringify(recipes));
await writeFile(new URL('.private/product-renders/input-hash.txt', root), await productRenderInputHash());
for (const recipe of recipes.renders) {
  const generator = getGenerator(recipe.generator ?? recipe.id);
  if (!generator || !/^[a-z0-9-]+$/.test(recipe.id)) throw new Error('Invalid render generator');
  for (const key of sensitiveKeys(generator)) {
    if (Object.hasOwn(recipe.params, key)) throw new Error(`Sensitive field in recipe: ${recipe.id}`);
  }
  const params = Object.fromEntries(Object.entries(generator.schema).map(([k, field]) => [k, field.default]));
  Object.assign(params, recipe.params);
  const checked = validateParams(generator, params);
  if (!checked.ok) throw new Error(`${recipe.id}: ${checked.errors.join('; ')}`);
  const font = await loadFont({ fontId: params.font, fetchImpl: async path => {
    const bytes = await readFile(new URL(`customizer/static/fonts/${path.split('/').pop()}`, root));
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  } });
  const { default: build } = await loadBuilder[generator.id]();
  const model = await buildPresentationModel({ ...generator, build }, checked.value, { wasm, font });
  // No parameters or model metadata are serialized, only colored triangles.
  const output = new URL(`.private/product-renders/${recipe.id}.json`, root);
  await writeFile(output, JSON.stringify({ recipe, parts: model.parts }));
  console.log(`${recipe.id}: ${model.parts.length} parts → ${fileURLToPath(output)}`);
}
