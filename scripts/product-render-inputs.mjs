import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
// Include defaults, geometry helpers, builders, local fonts and dependency pins.
// Ignore release-query churn: version-assets changes no geometry behavior.
export async function productRenderInputHash() {
  const files = ['package-lock.json', 'scripts/export-product-render-meshes.mjs', 'scripts/product-render-inputs.mjs'];
  async function walk(path) {
    for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
      const name = `${path}${entry.name}`;
      if (entry.isDirectory()) await walk(`${name}/`);
      else if (/\.(js|ttf|otf|woff2?)$/.test(entry.name)) files.push(name);
    }
  }
  for (const path of ['customizer/generators/', 'customizer/framework/', 'customizer/static/fonts/', 'public/assets/js/customize/']) await walk(path);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    let bytes = await readFile(new URL(path, root));
    if (/\.(m?js|json)$/.test(path)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\?v=[a-f0-9]{16}/g, ''));
    hash.update(path + '\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}
