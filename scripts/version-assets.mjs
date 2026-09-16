import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
async function walk(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (/\.(html|css|js)$/.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}

// One content-derived release key covers HTML and the entire module/style graph.
// Strip the previous key before hashing so generation is deterministic/idempotent.
const reference = /(["'])((?:\/assets\/|\.{1,2}\/)[^"'?\s]+\.(?:js|css))(?:\?v=[a-f0-9]{16})?\1/g;
const files = await Promise.all((await walk(root)).map(async path => {
  const source = await readFile(path, 'utf8');
  return { path, source, normalized: source.replace(reference, '$1$2$1').replace(/\r\n/g, '\n') };
}));
const hash = createHash('sha256');
for (const file of files) hash.update(relative(root, file.path).replaceAll('\\', '/') + '\0' + file.normalized + '\0');
const version = hash.digest('hex').slice(0, 16);
const stale = [];
for (const file of files) {
  const output = file.normalized.replace(reference, (_, quote, path) => `${quote}${path}?v=${version}${quote}`);
  if (output === file.source.replace(/\r\n/g, '\n')) continue;
  stale.push(relative(root, file.path));
  if (!process.argv.includes('--check')) await writeFile(file.path, output);
}
if (stale.length && process.argv.includes('--check')) {
  console.error('Asset versions are stale. Run npm run assets:version.\n' + stale.join('\n'));
  process.exitCode = 1;
} else console.log(`Asset release ${version}: ${stale.length ? 'updated' : 'verified'} ${files.length} HTML, CSS, and JavaScript files.`);
