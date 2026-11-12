import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
// Include defaults, geometry helpers, builders, local fonts and dependency pins.
// Ignore release-query churn: version-assets changes no geometry behavior.
export async function productRenderInputHash() {
  const files = ['package-lock.json', 'scripts/export-product-render-meshes.mjs', 'scripts/product-render-inputs.mjs', 'scripts/finish-product-renders.py', 'scripts/generate-product-renders.py'];
  async function walk(path) {
    for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
      const name = `${path}${entry.name}`;
      if (entry.isDirectory()) await walk(`${name}/`);
      else if (/\.(js|ttf|otf|woff2?)$/.test(entry.name)) files.push(name);
    }
  }
  // Track actual geometry dependencies. Studio UI changes cannot change these
  // locally exported meshes, and should not invalidate every finished photograph.
  const seen = new Set();
  async function imports(path) {
    if (seen.has(path)) return;
    seen.add(path);
    files.push(path);
    const source = await readFile(new URL(path, root), 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = new URL(match[1].split('?')[0], new URL(path, root));
      const relative = target.href.slice(root.href.length);
      if (/\.m?js$/.test(relative)) await imports(relative);
    }
  }
  for (const path of ['customizer/generators/', 'customizer/static/fonts/', 'public/assets/js/customize/']) await walk(path);
  // Each normalized recipe (including camera and safe settings) is compared to
  // its shipped receipt separately. Shop URL/validation helpers are not geometry.
  for (const path of ['customizer/framework/model.js', 'customizer/framework/engine.js', 'customizer/framework/fonts.js']) await imports(path);
  // Every builder is a root (loadBuilder uses dynamic import); follow its shared helpers too.
  for (const path of [...files].filter(path => path.startsWith('customizer/generators/') && path.endsWith('.js'))) await imports(path);
  const hash = createHash('sha256');
  for (const path of [...new Set(files)].sort()) {
    let bytes = await readFile(new URL(path, root));
    if (/\.(m?js|json)$/.test(path)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\?v=[a-f0-9]{16}/g, ''));
    hash.update(path + '\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}
